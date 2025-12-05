import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

/**
 * GET /api/stats
 *
 * Returns aggregate volume statistics for the platform.
 *
 * Query params:
 *   - user: (optional) wallet address to filter by specific user
 *   - period: (optional) '24h' | '7d' | '30d' | 'all' (default: 'all')
 *   - leaderboard: (optional) 'true' to include top users by volume
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const userWallet = searchParams.get('user')
    const period = searchParams.get('period') || 'all'
    const includeLeaderboard = searchParams.get('leaderboard') === 'true'

    // Calculate time filter
    let dateFilter: Date | undefined
    const now = new Date()
    switch (period) {
      case '24h':
        dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case '7d':
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        dateFilter = undefined
    }

    // Build where clause for orders
    const orderWhereClause: any = {
      volumeGenerated: { gt: 0 }, // Only count orders with actual volume
      txHash: { not: 'cooldown' }, // Exclude cooldown entries
    }

    if (dateFilter) {
      orderWhereClause.timestamp = { gte: dateFilter }
    }

    // If filtering by user, get their bot first
    let botIds: string[] | undefined
    if (userWallet) {
      const userBot = await prisma.botInstance.findFirst({
        where: { userWalletAddress: userWallet },
        select: { id: true }
      })
      if (!userBot) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
      botIds = [userBot.id]
      orderWhereClause.botId = userBot.id
    }

    // Get all matching orders
    const orders = await prisma.orderHistory.findMany({
      where: orderWhereClause,
      select: {
        volumeGenerated: true,
        pnl: true,
        timestamp: true,
        direction: true,
        botId: true,
      }
    })

    // Calculate aggregate stats
    const totalVolume = orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
    const totalPnl = orders.reduce((sum, o) => sum + (o.pnl || 0), 0)
    const totalTrades = orders.length

    // Win/Loss stats (only for orders with PnL recorded)
    const tradesWithPnl = orders.filter(o => o.pnl !== null && o.pnl !== 0)
    const winningTrades = tradesWithPnl.filter(o => (o.pnl || 0) > 0)
    const losingTrades = tradesWithPnl.filter(o => (o.pnl || 0) < 0)
    const winRate = tradesWithPnl.length > 0
      ? (winningTrades.length / tradesWithPnl.length) * 100
      : 0

    // Best/worst trade
    const pnlValues = orders.map(o => o.pnl || 0).filter(p => p !== 0)
    const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0
    const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0

    // Average trade size
    const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0

    // Long vs Short breakdown
    const longTrades = orders.filter(o => o.direction === 'long')
    const shortTrades = orders.filter(o => o.direction === 'short')
    const longVolume = longTrades.reduce((sum, o) => sum + o.volumeGenerated, 0)
    const shortVolume = shortTrades.reduce((sum, o) => sum + o.volumeGenerated, 0)

    // Unique users count (by botId)
    const uniqueBotIds = new Set(orders.map(o => o.botId))
    const activeUsers = uniqueBotIds.size

    // Get total registered users
    const totalUsers = await prisma.botInstance.count()

    // Build response
    const stats: any = {
      period,
      timestamp: new Date().toISOString(),

      // Volume stats
      volume: {
        total: Math.round(totalVolume * 100) / 100,
        formatted: formatCurrency(totalVolume),
        avgPerTrade: Math.round(avgTradeSize * 100) / 100,
        byDirection: {
          long: Math.round(longVolume * 100) / 100,
          short: Math.round(shortVolume * 100) / 100,
        }
      },

      // Trade stats
      trades: {
        total: totalTrades,
        withPnl: tradesWithPnl.length,
        wins: winningTrades.length,
        losses: losingTrades.length,
        winRate: Math.round(winRate * 10) / 10,
        byDirection: {
          long: longTrades.length,
          short: shortTrades.length,
        }
      },

      // PnL stats
      pnl: {
        total: Math.round(totalPnl * 100) / 100,
        formatted: formatCurrency(totalPnl),
        bestTrade: Math.round(bestTrade * 100) / 100,
        worstTrade: Math.round(worstTrade * 100) / 100,
        avgWin: winningTrades.length > 0
          ? Math.round((winningTrades.reduce((s, o) => s + (o.pnl || 0), 0) / winningTrades.length) * 100) / 100
          : 0,
        avgLoss: losingTrades.length > 0
          ? Math.round((losingTrades.reduce((s, o) => s + (o.pnl || 0), 0) / losingTrades.length) * 100) / 100
          : 0,
      },

      // User stats
      users: {
        total: totalUsers,
        activeInPeriod: activeUsers,
      }
    }

    // Add leaderboard if requested
    if (includeLeaderboard) {
      stats.leaderboard = await getLeaderboard(dateFilter)
    }

    // Add user-specific data if filtering by user
    if (userWallet) {
      const userBot = await prisma.botInstance.findFirst({
        where: { userWalletAddress: userWallet },
        select: {
          userWalletAddress: true,
          cumulativeVolume: true,
          ordersPlaced: true,
          strategy: true,
          marketName: true,
          createdAt: true,
          isRunning: true,
        }
      })
      stats.user = {
        wallet: userWallet,
        ...userBot,
        periodVolume: totalVolume,
        periodTrades: totalTrades,
        periodPnl: totalPnl,
      }
    }

    return NextResponse.json(stats)
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}

/**
 * Get leaderboard of top users by volume
 */
async function getLeaderboard(dateFilter?: Date): Promise<any[]> {
  // Get all bots with their orders
  const bots = await prisma.botInstance.findMany({
    select: {
      id: true,
      userWalletAddress: true,
      strategy: true,
      marketName: true,
      orders: {
        where: {
          volumeGenerated: { gt: 0 },
          txHash: { not: 'cooldown' },
          ...(dateFilter ? { timestamp: { gte: dateFilter } } : {}),
        },
        select: {
          volumeGenerated: true,
          pnl: true,
        }
      }
    }
  })

  // Calculate stats per user
  const userStats = bots.map(bot => {
    const volume = bot.orders.reduce((sum, o) => sum + o.volumeGenerated, 0)
    const pnl = bot.orders.reduce((sum, o) => sum + (o.pnl || 0), 0)
    const trades = bot.orders.length
    const wins = bot.orders.filter(o => (o.pnl || 0) > 0).length
    const winRate = trades > 0 ? (wins / trades) * 100 : 0

    return {
      wallet: bot.userWalletAddress.slice(0, 6) + '...' + bot.userWalletAddress.slice(-4),
      walletFull: bot.userWalletAddress,
      strategy: bot.strategy,
      market: bot.marketName,
      volume: Math.round(volume * 100) / 100,
      volumeFormatted: formatCurrency(volume),
      pnl: Math.round(pnl * 100) / 100,
      trades,
      winRate: Math.round(winRate * 10) / 10,
    }
  })

  // Sort by volume descending and take top 10
  return userStats
    .filter(u => u.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10)
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`
  } else if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`
  } else {
    return `$${value.toFixed(2)}`
  }
}
