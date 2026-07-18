import rewardConfig from '@/config/cash-rewards.json'
import {
  builderFeeBpsToChainUnits,
  DECIBEL_BUILDER_CHAIN_UNITS_PER_BPS,
  getAptosFullnodeApiKey,
  getDecibelPackage,
  normalizeAptosAddress,
  type DecibelEntryPayload,
  type DecibelNetwork,
} from '@/lib/decibel'

const DEFAULT_BUILDER_FEE_BPS = 1
const MAX_APP_BUILDER_FEE_BPS = 10
const BUILDER_APPROVAL_READ_TIMEOUT_MS = 2_000

export type DecibelBuilderStatus = {
  enabled: boolean
  enrollmentOpen: boolean
  builderAddress: string
  feeBps: number
  feePercent: number
  approval: {
    readable: boolean
    approved: boolean
    maxFeeBps: number | null
    maxFeeChainUnits: number | null
  }
}

function getFullnodeUrl(network: DecibelNetwork) {
  return network === 'mainnet'
    ? 'https://api.mainnet.aptoslabs.com/v1'
    : 'https://api.testnet.aptoslabs.com/v1'
}

function configuredFeeBps() {
  const parsed = Number.parseInt(process.env.DECIBEL_BUILDER_FEE_BPS ?? '', 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_BUILDER_FEE_BPS
  return Math.min(parsed, MAX_APP_BUILDER_FEE_BPS)
}

export function getDecibelBuilderConfig(network: DecibelNetwork) {
  const rawAddress =
    process.env.DECIBEL_BUILDER_ADDRESS?.trim() || rewardConfig.managerAddress
  return {
    enabled:
      network === 'mainnet' && process.env.DECIBEL_BUILDER_ENABLED === 'true',
    enrollmentOpen: network === 'mainnet' && rewardConfig.status === 'live',
    builderAddress: normalizeAptosAddress(rawAddress, 'builderAddress'),
    feeBps: configuredFeeBps(),
  }
}

function readMoveOptionU64(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const vec = (value as { vec?: unknown }).vec
  if (!Array.isArray(vec) || vec.length === 0) return null
  const parsed = Number(vec[0])
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function readApprovedBuilderFee(args: {
  network: DecibelNetwork
  subaccount: string
  builderAddress: string
  signal?: AbortSignal
}): Promise<number | null> {
  const subaccount = normalizeAptosAddress(args.subaccount, 'subaccount')
  const builderAddress = normalizeAptosAddress(args.builderAddress, 'builderAddress')
  const apiKey = getAptosFullnodeApiKey(args.network)
  const timeoutSignal = AbortSignal.timeout(BUILDER_APPROVAL_READ_TIMEOUT_MS)
  const signal = args.signal
    ? AbortSignal.any([args.signal, timeoutSignal])
    : timeoutSignal
  const response = await fetch(`${getFullnodeUrl(args.network)}/view`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-aptos-client': 'cash-trading/decibel-builder',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      function: `${getDecibelPackage(args.network)}::builder_code_registry::get_approved_max_fee`,
      type_arguments: [],
      arguments: [subaccount, builderAddress],
    }),
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    throw new Error(`Builder approval lookup failed (${response.status})`)
  }
  const body = (await response.json()) as unknown
  return readMoveOptionU64(Array.isArray(body) ? body[0] : null)
}

export async function getDecibelBuilderStatus(args: {
  network: DecibelNetwork
  subaccount: string
  signal?: AbortSignal
}): Promise<DecibelBuilderStatus> {
  const config = getDecibelBuilderConfig(args.network)
  if (!config.enabled) {
    return {
      ...config,
      feePercent: config.feeBps / 100,
      approval: {
        readable: true,
        approved: false,
        maxFeeBps: null,
        maxFeeChainUnits: null,
      },
    }
  }

  try {
    const maxFeeChainUnits = await readApprovedBuilderFee({
      ...args,
      builderAddress: config.builderAddress,
    })
    const requiredChainUnits = Number(builderFeeBpsToChainUnits(config.feeBps))
    return {
      ...config,
      feePercent: config.feeBps / 100,
      approval: {
        readable: true,
        approved:
          maxFeeChainUnits !== null && maxFeeChainUnits >= requiredChainUnits,
        maxFeeBps:
          maxFeeChainUnits === null
            ? null
            : maxFeeChainUnits / DECIBEL_BUILDER_CHAIN_UNITS_PER_BPS,
        maxFeeChainUnits,
      },
    }
  } catch {
    return {
      ...config,
      feePercent: config.feeBps / 100,
      approval: {
        readable: false,
        approved: false,
        maxFeeBps: null,
        maxFeeChainUnits: null,
      },
    }
  }
}

export function buildDecibelBuilderApprovalPayload(args: {
  action: 'approve' | 'revoke'
  network: DecibelNetwork
  subaccount: string
}): DecibelEntryPayload {
  const config = getDecibelBuilderConfig(args.network)
  if (!config.enabled) throw new Error('cash.trading Builder routing is not enabled')
  if (args.action === 'approve' && !config.enrollmentOpen) {
    throw new Error('CASH rewards enrollment is not live yet')
  }
  const subaccount = normalizeAptosAddress(args.subaccount, 'subaccount')
  return {
    function:
      args.action === 'approve'
        ? `${getDecibelPackage(args.network)}::dex_accounts_entry::approve_max_builder_fee_for_subaccount`
        : `${getDecibelPackage(args.network)}::dex_accounts_entry::revoke_max_builder_fee_for_subaccount`,
    typeArguments: [],
    functionArguments:
      args.action === 'approve'
        ? [subaccount, config.builderAddress, builderFeeBpsToChainUnits(config.feeBps)]
        : [subaccount, config.builderAddress],
  }
}
