import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * Portfolio API - Returns user's USDC balance, trade history, total volume, and PNL
 *
 * GET /api/portfolio?userWalletAddress=0x...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userWalletAddress = searchParams.get('userWalletAddress')

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress query parameter' },
        { status: 400 }
      )
    }

    // Get bot instance for this user
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress },
    })

    // Use the capitalUSDC from bot config as the balance
    // This is the deposited collateral on Decibel testnet
    const usdcBalance = botInstance?.capitalUSDC || 0

    // Get ALL trade history for this user (across all sessions)
    let allOrders: any[] = []
    if (botInstance) {
      allOrders = await prisma.orderHistory.findMany({
        where: { botId: botInstance.id },
        orderBy: { timestamp: 'desc' },
      })
    }

    // Calculate statistics from all orders
    const stats = calculateStats(allOrders)

    // Group orders by date for chart data
    const dailyStats = calculateDailyStats(allOrders)

    return NextResponse.json({
      success: true,
      balance: {
        usdc: usdcBalance,
        accountAddress: botInstance?.userSubaccount || userWalletAddress,
      },
      stats: {
        totalVolume: stats.totalVolume,
        totalPnl: stats.totalPnl,
        totalTrades: stats.totalTrades,
        winRate: stats.winRate,
        avgTradeSize: stats.avgTradeSize,
        bestTrade: stats.bestTrade,
        worstTrade: stats.worstTrade,
      },
      recentTrades: allOrders.slice(0, 50).map(order => ({
        id: order.id,
        timestamp: order.timestamp,
        txHash: order.txHash,
        direction: order.direction,
        strategy: order.strategy,
        size: order.size,
        volumeGenerated: order.volumeGenerated,
        success: order.success,
        entryPrice: order.entryPrice,
        exitPrice: order.exitPrice,
        pnl: order.pnl,
        positionHeldMs: order.positionHeldMs,
      })),
      dailyStats,
      botStatus: botInstance ? {
        isRunning: botInstance.isRunning,
        currentSession: botInstance.sessionId,
        market: botInstance.marketName,
        strategy: botInstance.strategy,
        bias: botInstance.bias,
      } : null,
    })
  } catch (error) {
    console.error('Portfolio API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch portfolio' },
      { status: 500 }
    )
  }
}

interface OrderRecord {
  volumeGenerated: number
  pnl: number
  success: boolean
  timestamp: Date
  size: number
}

function calculateStats(orders: OrderRecord[]) {
  if (orders.length === 0) {
    return {
      totalVolume: 0,
      totalPnl: 0,
      totalTrades: 0,
      winRate: 0,
      avgTradeSize: 0,
      bestTrade: 0,
      worstTrade: 0,
    }
  }

  const totalVolume = orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
  const totalPnl = orders.reduce((sum, o) => sum + (o.pnl || 0), 0)
  const tradesWithPnl = orders.filter(o => o.pnl !== 0 && o.pnl !== null)
  const winningTrades = tradesWithPnl.filter(o => o.pnl > 0).length

  const pnlValues = orders.map(o => o.pnl || 0).filter(p => p !== 0)
  const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0
  const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0

  return {
    totalVolume,
    totalPnl,
    totalTrades: orders.length,
    winRate: tradesWithPnl.length > 0 ? (winningTrades / tradesWithPnl.length) * 100 : 0,
    avgTradeSize: totalVolume / orders.length,
    bestTrade,
    worstTrade,
  }
}

function calculateDailyStats(orders: OrderRecord[]) {
  const dailyMap = new Map<string, { volume: number; pnl: number; trades: number }>()

  orders.forEach(order => {
    const date = new Date(order.timestamp).toISOString().split('T')[0]
    const existing = dailyMap.get(date) || { volume: 0, pnl: 0, trades: 0 }
    dailyMap.set(date, {
      volume: existing.volume + order.volumeGenerated,
      pnl: existing.pnl + (order.pnl || 0),
      trades: existing.trades + 1,
    })
  })

  // Convert to array and sort by date
  return Array.from(dailyMap.entries())
    .map(([date, data]) => ({
      date,
      volume: data.volume,
      pnl: data.pnl,
      trades: data.trades,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30) // Last 30 days
}
