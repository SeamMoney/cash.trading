import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from '@aptos-labs/ts-sdk'
import { prisma } from './prisma'

export const CASH_COIN_TYPE =
  '0x61ed8b048636516b4eaf4c74250fa4f9440d9c3e163d96aeb863fe658a4bdc67::CASH::CASH'
export const CASH_DECIMALS = 6
export const CASH_ATOMIC_UNIT = 10 ** CASH_DECIMALS
const ZERO_ATOMIC = BigInt(0)

type CashRewardStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED'

type TradeRewardInput = {
  orderHistoryId?: string
  sourceType?: string
  sourceId: string
  userWalletAddress: string
  userSubaccount?: string | null
  sourceTxHash?: string | null
  volumeGenerated: number
  market?: string | null
  strategy?: string | null
}

type RewardConfig = {
  enabled: boolean
  explicitlyDisabled: boolean
  disabledReason?: string
  network: Network
  rewardRateCashPerUsd: number
  minVolumeUsd: number
  maxCashPerTrade: number
  walletDailyCapCash: number
  globalDailyCapCash: number
}

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getRewardNetwork(): Network {
  const raw = (
    process.env.CASH_REWARD_NETWORK ||
    process.env.DECIBEL_NETWORK ||
    process.env.NEXT_PUBLIC_DECIBEL_NETWORK ||
    process.env.APTOS_NETWORK ||
    'mainnet'
  ).toLowerCase()

  return raw === 'testnet' ? Network.TESTNET : Network.MAINNET
}

function getTreasuryPrivateKey(): string | undefined {
  const raw =
    process.env.CASH_REWARD_TREASURY_PRIVATE_KEY ||
    process.env.CASH_REWARD_PRIVATE_KEY

  return raw
    ?.replace('ed25519-priv-', '')
    .replace(/\\n/g, '')
    .replace(/\n/g, '')
    .trim()
}

function getNodeApiKey(): string | undefined {
  return (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY)
    ?.replace(/\\n/g, '')
    .replace(/\n/g, '')
    .trim()
}

export function getCashRewardConfig(): RewardConfig {
  const treasuryPrivateKey = getTreasuryPrivateKey()
  const explicitlyDisabled = process.env.CASH_REWARDS_ENABLED === 'false'
  const rewardRateCashPerUsd = getEnvNumber('CASH_REWARD_CASH_PER_USD_VOLUME', 0.01)
  const minVolumeUsd = getEnvNumber('CASH_REWARD_MIN_VOLUME_USD', 1)

  let disabledReason: string | undefined
  if (explicitlyDisabled) disabledReason = 'CASH_REWARDS_ENABLED=false'
  if (!treasuryPrivateKey) disabledReason = 'CASH_REWARD_TREASURY_PRIVATE_KEY is not set'
  if (rewardRateCashPerUsd <= 0) disabledReason = 'CASH_REWARD_CASH_PER_USD_VOLUME must be greater than 0'

  return {
    enabled: !disabledReason,
    explicitlyDisabled,
    disabledReason,
    network: getRewardNetwork(),
    rewardRateCashPerUsd,
    minVolumeUsd,
    maxCashPerTrade: getEnvNumber('CASH_REWARD_MAX_CASH_PER_TRADE', 100),
    walletDailyCapCash: getEnvNumber('CASH_REWARD_DAILY_WALLET_CAP', 1000),
    globalDailyCapCash: getEnvNumber('CASH_REWARD_DAILY_GLOBAL_CAP', 100000),
  }
}

function calculateCashRewardAtomic(volumeGenerated: number, config: RewardConfig): bigint {
  if (!Number.isFinite(volumeGenerated) || volumeGenerated < config.minVolumeUsd) {
    return ZERO_ATOMIC
  }

  const unclampedCash = volumeGenerated * config.rewardRateCashPerUsd
  const clampedCash = Math.min(unclampedCash, config.maxCashPerTrade)
  return BigInt(Math.floor(clampedCash * CASH_ATOMIC_UNIT))
}

function atomicToCash(amountAtomic: bigint): number {
  return Number(amountAtomic) / CASH_ATOMIC_UNIT
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

async function applyDailyCaps(
  recipientAddress: string,
  desiredAtomic: bigint,
  config: RewardConfig
): Promise<{ amountAtomic: bigint; skippedReason?: string }> {
  if (desiredAtomic <= ZERO_ATOMIC) {
    return { amountAtomic: ZERO_ATOMIC, skippedReason: 'Trade volume is below CASH reward minimum' }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [walletAgg, globalAgg] = await Promise.all([
    prisma.cashRewardTransfer.aggregate({
      where: {
        recipientAddress,
        status: { in: ['PENDING', 'PROCESSING', 'SENT'] },
        createdAt: { gte: since },
      },
      _sum: { amountCash: true },
    }),
    prisma.cashRewardTransfer.aggregate({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'SENT'] },
        createdAt: { gte: since },
      },
      _sum: { amountCash: true },
    }),
  ])

  const walletRemaining = Math.max(0, config.walletDailyCapCash - (walletAgg._sum.amountCash ?? 0))
  const globalRemaining = Math.max(0, config.globalDailyCapCash - (globalAgg._sum.amountCash ?? 0))
  const remainingCash = Math.min(walletRemaining, globalRemaining)

  if (remainingCash <= 0) {
    return { amountAtomic: ZERO_ATOMIC, skippedReason: 'CASH reward daily cap reached' }
  }

  const cappedAtomic = BigInt(Math.floor(remainingCash * CASH_ATOMIC_UNIT))
  return { amountAtomic: desiredAtomic > cappedAtomic ? cappedAtomic : desiredAtomic }
}

function createAptosClient(network: Network): Aptos {
  const nodeApiKey = getNodeApiKey()
  return new Aptos(
    new AptosConfig({
      network,
      clientConfig: nodeApiKey
        ? network === Network.MAINNET
          ? { API_KEY: nodeApiKey }
          : { HEADERS: { Authorization: `Bearer ${nodeApiKey}` } }
        : undefined,
    })
  )
}

async function submitCashTransfer(recipientAddress: string, amountAtomic: bigint, config: RewardConfig): Promise<string> {
  const treasuryPrivateKey = getTreasuryPrivateKey()
  if (!treasuryPrivateKey) {
    throw new Error('CASH reward treasury key is not configured')
  }

  const privateKey = new Ed25519PrivateKey(treasuryPrivateKey)
  const treasury = Account.fromPrivateKey({ privateKey })
  const aptos = createAptosClient(config.network)

  const transaction = await aptos.transaction.build.simple({
    sender: treasury.accountAddress,
    data: {
      function: '0x1::aptos_account::transfer_coins',
      typeArguments: [CASH_COIN_TYPE],
      functionArguments: [recipientAddress, amountAtomic.toString()],
    },
  })

  const committed = await aptos.signAndSubmitTransaction({
    signer: treasury,
    transaction,
  })

  const executed = await aptos.waitForTransaction({
    transactionHash: committed.hash,
  })

  if (!executed.success) {
    throw new Error(`CASH reward transfer failed: ${(executed as { vm_status?: string }).vm_status ?? 'unknown vm status'}`)
  }

  return committed.hash
}

export async function recordCashRewardForTrade(input: TradeRewardInput) {
  const config = getCashRewardConfig()
  const recipientAddress = normalizeAddress(input.userWalletAddress)
  const sourceType = input.sourceType ?? 'bot_trade'
  const sourceId = input.sourceId

  const existing = await prisma.cashRewardTransfer.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
  })
  if (existing) return existing

  const desiredAtomic = calculateCashRewardAtomic(input.volumeGenerated, config)
  const capResult = await applyDailyCaps(recipientAddress, desiredAtomic, config)
  const amountAtomic = capResult.amountAtomic
  const amountCash = atomicToCash(amountAtomic)
  const skippedReason = capResult.skippedReason || config.disabledReason
  const shouldSkip = amountAtomic <= ZERO_ATOMIC || config.explicitlyDisabled

  const reward = await prisma.cashRewardTransfer.create({
    data: {
      sourceType,
      sourceId,
      orderHistoryId: input.orderHistoryId,
      userWalletAddress: normalizeAddress(input.userWalletAddress),
      userSubaccount: input.userSubaccount ? normalizeAddress(input.userSubaccount) : null,
      recipientAddress,
      amountCash,
      amountAtomic,
      volumeGenerated: input.volumeGenerated,
      rewardRateCashPerUsd: config.rewardRateCashPerUsd,
      status: shouldSkip ? 'SKIPPED' : 'PENDING',
      error: shouldSkip || !config.enabled ? skippedReason : null,
      metadata: {
        sourceTxHash: input.sourceTxHash,
        market: input.market,
        strategy: input.strategy,
        cashCoinType: CASH_COIN_TYPE,
        cashDecimals: CASH_DECIMALS,
        network: config.network,
      },
    },
  })

  if (!config.enabled || amountAtomic <= ZERO_ATOMIC) {
    return reward
  }

  return sendCashRewardById(reward.id)
}

export async function sendCashRewardById(rewardId: string) {
  const config = getCashRewardConfig()
  if (!config.enabled) {
    return prisma.cashRewardTransfer.update({
      where: { id: rewardId },
      data: { error: config.disabledReason },
    })
  }

  const claimed = await prisma.cashRewardTransfer.updateMany({
    where: {
      id: rewardId,
      status: { in: ['PENDING', 'FAILED'] },
      amountAtomic: { gt: 0 },
    },
    data: {
      status: 'PROCESSING' satisfies CashRewardStatus,
      error: null,
    },
  })

  if (claimed.count === 0) {
    return prisma.cashRewardTransfer.findUnique({ where: { id: rewardId } })
  }

  const reward = await prisma.cashRewardTransfer.findUniqueOrThrow({
    where: { id: rewardId },
  })

  try {
    const txHash = await submitCashTransfer(reward.recipientAddress, reward.amountAtomic, config)
    return await prisma.cashRewardTransfer.update({
      where: { id: rewardId },
      data: {
        status: 'SENT' satisfies CashRewardStatus,
        txHash,
        sentAt: new Date(),
        attemptCount: { increment: 1 },
        error: null,
      },
    })
  } catch (error) {
    return await prisma.cashRewardTransfer.update({
      where: { id: rewardId },
      data: {
        status: 'FAILED' satisfies CashRewardStatus,
        attemptCount: { increment: 1 },
        error: error instanceof Error ? error.message : 'Unknown CASH reward transfer error',
      },
    })
  }
}

export async function processPendingCashRewards(limit = 25) {
  const rewards = await prisma.cashRewardTransfer.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      amountAtomic: { gt: 0 },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  const results = []
  for (const reward of rewards) {
    results.push(await sendCashRewardById(reward.id))
  }
  return results
}
