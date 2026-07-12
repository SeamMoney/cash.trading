import { NextRequest, NextResponse } from 'next/server'
import {
  CASH_COIN_TYPE,
  CASH_DECIMALS,
  getCashRewardConfig,
  processPendingCashRewards,
} from '@/lib/cash-rewards'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

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
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { unavailable: true, reason: 'database_not_configured' },
      { status: 503 }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const userWalletAddress = searchParams.get('userWalletAddress')?.toLowerCase()
    const userSubaccount = searchParams.get('userSubaccount')?.toLowerCase()

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress query parameter' },
        { status: 400 }
      )
    }

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
    })
  } catch (error) {
    console.error('Error fetching CASH rewards:', error)
    return NextResponse.json(
      { error: 'Failed to fetch CASH rewards' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminSecret = process.env.CASH_REWARD_ADMIN_SECRET || process.env.CRON_SECRET
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    if (adminSecret && bearer !== adminSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!adminSecret && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Set CASH_REWARD_ADMIN_SECRET or CRON_SECRET before enabling reward processing' },
        { status: 503 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const limit = Math.max(1, Math.min(Number(body.limit || 25), 100))
    const rewards = await processPendingCashRewards(limit)

    return NextResponse.json({
      processed: rewards.length,
      rewards: rewards.map((reward) => reward ? serializeReward(reward) : null),
    })
  } catch (error) {
    console.error('Error processing CASH rewards:', error)
    return NextResponse.json(
      { error: 'Failed to process CASH rewards' },
      { status: 500 }
    )
  }
}
