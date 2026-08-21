import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'
import { checkRateLimitForKey } from '@/lib/api-rate-limit'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // Read-only, but it exposes bot config and PnL, so it is owner-gated too.
  try {
    const { searchParams } = new URL(request.url)
    const userWalletAddress = searchParams.get('userWalletAddress')
    const userSubaccount = searchParams.get('userSubaccount')

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress query parameter' },
        { status: 400 }
      )
    }

    // When a subaccount is named, prove it belongs to this wallet too — this
    // route returns that subaccount's position sizing, PnL and strategy config.
    const denied = await denyUnlessBotOwner({
      walletAddress: userWalletAddress,
      subaccount: userSubaccount,
    })
    if (denied) return denied

    // Keyed by wallet, not IP: the authorized identity is the thing worth
    // bounding. Polled by the dashboard, so the ceiling is generous.
    const rate = checkRateLimitForKey('bot-status', userWalletAddress.toLowerCase(), 120, 60000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterS: rate.retryAfterS },
        { status: 429 },
      )
    }

    // Get bot from database - if subaccount provided, look for exact match
    // Otherwise, find any bot for this wallet (backwards compatibility)
    let botInstance
    if (userSubaccount) {
      botInstance = await prisma.botInstance.findUnique({
        where: {
          userWalletAddress_userSubaccount: {
            userWalletAddress,
            userSubaccount,
          }
        },
      })
    } else {
      // Fallback: find first bot for this wallet
      botInstance = await prisma.botInstance.findFirst({
        where: { userWalletAddress },
      })
    }

    if (!botInstance) {
      return NextResponse.json({
        isRunning: false,
        status: null,
        config: null,
      })
    }

    // Get orders filtered by current session
    const sessionOrdersRaw = await prisma.orderHistory.findMany({
      where: {
        botId: botInstance.id,
        sessionId: botInstance.sessionId,  // Only orders from current session
      },
      include: {
        cashReward: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 50,
    })

    // Convert BigInt fields to numbers for JSON serialization
    const sessionOrders = sessionOrdersRaw.map(order => ({
      ...order,
      size: Number(order.size),  // BigInt -> number for JSON
      cashReward: order.cashReward
        ? {
            ...order.cashReward,
            amountAtomic: order.cashReward.amountAtomic.toString(),
            createdAt: order.cashReward.createdAt.toISOString(),
            updatedAt: order.cashReward.updatedAt.toISOString(),
            sentAt: order.cashReward.sentAt?.toISOString() ?? null,
          }
        : null,
    }))

    // Calculate progress
    const progress = (botInstance.cumulativeVolume / botInstance.volumeTargetUSDC) * 100

    // Return database state with session info
    return NextResponse.json({
      isRunning: botInstance.isRunning,
      sessionId: botInstance.sessionId,
      status: {
        cumulativeVolume: botInstance.cumulativeVolume,
        volumeTargetUSDC: botInstance.volumeTargetUSDC,
        progress: progress.toFixed(1),
        ordersPlaced: botInstance.ordersPlaced,
        currentCapitalUsed: botInstance.currentCapitalUsed,
        lastOrderTime: botInstance.lastOrderTime,
        error: botInstance.error,
        orderHistory: sessionOrders,  // Only orders from current session
        // Personal Strategy Runner: what the last evaluated bar decided.
        // lastBarTs is a BigInt column (epoch ms) — JSON cannot serialize
        // BigInt, and ms timestamps are well inside Number's exact range.
        lastSignal: botInstance.lastSignal,
        lastSignalAt: botInstance.lastSignalAt,
        lastBarTs: botInstance.lastBarTs === null ? null : Number(botInstance.lastBarTs),
      },
      config: {
        userWalletAddress: botInstance.userWalletAddress,
        userSubaccount: botInstance.userSubaccount,
        capitalUSDC: botInstance.capitalUSDC,
        volumeTargetUSDC: botInstance.volumeTargetUSDC,
        bias: botInstance.bias,
        strategy: botInstance.strategy,
        market: botInstance.market,
        marketName: botInstance.marketName,
        leverageX: botInstance.leverageX,
        strategyId: botInstance.strategyId,
        scriptHash: botInstance.scriptHash,
        barInterval: botInstance.barInterval,
        stopLossPct: botInstance.stopLossPct,
        takeProfitPct: botInstance.takeProfitPct,
      },
    })
  } catch (error) {
    console.error('Error getting bot status:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    )
  }
}
