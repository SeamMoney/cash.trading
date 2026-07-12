import { NextRequest, NextResponse } from 'next/server'
import {
  CASH_COIN_TYPE,
  CASH_DECIMALS,
  getCashRewardConfig,
  processPendingCashRewards,
} from '@/lib/cash-rewards'
import { prisma } from '@/lib/prisma'
import { checkApiRateLimit } from '@/lib/api-rate-limit'
import { isValidAptosAddress, normalizeAptosAddress } from '@/lib/decibel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4_000
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }

function serializeReward(reward: {
  amountAtomic: bigint
  createdAt: Date
  updatedAt: Date
  sentAt: Date | null
  [key: string]: unknown
}) {
  return {
    ...reward,
    amountAtomic: reward.amountAtomic.toString(),
    createdAt: reward.createdAt.toISOString(),
    updatedAt: reward.updatedAt.toISOString(),
    sentAt: reward.sentAt?.toISOString() ?? null,
  }
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'cash-rewards-read', 30, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { unavailable: true, reason: 'database_not_configured' },
      { status: 503, headers: NO_STORE_HEADERS }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const rawWalletAddress = searchParams.get('userWalletAddress')
    const rawSubaccount = searchParams.get('userSubaccount')

    if (
      !isValidAptosAddress(rawWalletAddress) ||
      (rawSubaccount !== null && !isValidAptosAddress(rawSubaccount))
    ) {
      return NextResponse.json(
        { error: 'A valid userWalletAddress is required; userSubaccount must be valid when provided' },
        { status: 400, headers: NO_STORE_HEADERS }
      )
    }
    const userWalletAddress = normalizeAptosAddress(rawWalletAddress, 'userWalletAddress')
    const userSubaccount = rawSubaccount
      ? normalizeAptosAddress(rawSubaccount, 'userSubaccount')
      : null

    const where = {
      userWalletAddress,
      ...(userSubaccount ? { userSubaccount } : {}),
    }

    const [rewards, sentTotals, pendingTotals] = await Promise.all([
      prisma.cashRewardTransfer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.cashRewardTransfer.aggregate({
        where: { ...where, status: 'SENT' },
        _sum: { amountCash: true },
      }),
      prisma.cashRewardTransfer.aggregate({
        where: { ...where, status: { in: ['PENDING', 'PROCESSING'] } },
        _sum: { amountCash: true },
      }),
    ])

    const config = getCashRewardConfig()

    return NextResponse.json({
      cash: {
        coinType: CASH_COIN_TYPE,
        decimals: CASH_DECIMALS,
      },
      config: {
        enabled: config.enabled,
        disabledReason: config.disabledReason,
        network: config.network,
        rewardRateCashPerUsd: config.rewardRateCashPerUsd,
        minVolumeUsd: config.minVolumeUsd,
        maxCashPerTrade: config.maxCashPerTrade,
        walletDailyCapCash: config.walletDailyCapCash,
        globalDailyCapCash: config.globalDailyCapCash,
      },
      totals: {
        sentCash: sentTotals._sum.amountCash ?? 0,
        pendingCash: pendingTotals._sum.amountCash ?? 0,
      },
      rewards: rewards.map(serializeReward),
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('Error fetching CASH rewards:', error)
    return NextResponse.json(
      { error: 'Failed to fetch CASH rewards' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, 'cash-rewards-process', 10, 60_000)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited', retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': String(rate.retryAfterS ?? 60) } },
    )
  }
  try {
    const adminSecret = process.env.CASH_REWARD_ADMIN_SECRET || process.env.CRON_SECRET
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    if (adminSecret && bearer !== adminSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    if (!adminSecret && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Set CASH_REWARD_ADMIN_SECRET or CRON_SECRET before enabling reward processing' },
        { status: 503, headers: NO_STORE_HEADERS }
      )
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { unavailable: true, reason: 'database_not_configured' },
        { status: 503, headers: NO_STORE_HEADERS },
      )
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0)
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Request body is too large' },
        { status: 413, headers: NO_STORE_HEADERS },
      )
    }
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: 'Request body is too large' },
        { status: 413, headers: NO_STORE_HEADERS },
      )
    }
    let body: { limit?: unknown }
    try {
      body = rawBody ? JSON.parse(rawBody) as { limit?: unknown } : {}
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    const limit = body.limit ?? 25
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'limit must be an integer from 1 to 100' },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    const rewards = await processPendingCashRewards(limit)

    return NextResponse.json({
      processed: rewards.length,
      rewards: rewards.map((reward) => reward ? serializeReward(reward) : null),
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('Error processing CASH rewards:', error)
    return NextResponse.json(
      { error: 'Failed to process CASH rewards' },
      { status: 500, headers: NO_STORE_HEADERS }
    )
  }
}
