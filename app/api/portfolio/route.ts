import { NextRequest, NextResponse } from 'next/server'
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

// Decibel testnet USDC token address
const DECIBEL_USDC = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::test_usdc::TestUSDC'

/**
 * Portfolio API - Returns user's USDC balance, trade history, total volume, and PNL
 *
 * GET /api/portfolio?userWalletAddress=0x...&userSubaccount=0x...
 */
export async function GET(request: NextRequest) {
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

    const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }))

    // Fetch USDC balance from subaccount (if provided) or main wallet
    let usdcBalance = 0
    const accountToCheck = userSubaccount || userWalletAddress

    try {
      // Try to get CoinStore resource for USDC
      const resources = await aptos.getAccountResources({
        accountAddress: accountToCheck
      })

      // Look for USDC coin balance
      const usdcResource = resources.find(r =>
        r.type.includes('CoinStore') && r.type.includes('TestUSDC')
      )

      if (usdcResource) {
        const data = usdcResource.data as any
        // USDC has 6 decimals on Decibel testnet
        usdcBalance = parseInt(data.coin?.value || '0') / 1_000_000
      }

      // Also check for native Aptos coin balance as fallback info
      const aptResource = resources.find(r =>
        r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
      )

      // Get subaccount USDC collateral from Decibel if subaccount exists
      if (userSubaccount) {
        const subaccountResources = await aptos.getAccountResources({
          accountAddress: userSubaccount
        })

        // Look for Decibel trading collateral
        const collateralResource = subaccountResources.find(r =>
          r.type.includes('collateral') || r.type.includes('Collateral')
        )

        if (collateralResource) {
          const data = collateralResource.data as any
          // Add collateral to balance if found
          const collateralValue = parseInt(data.value || data.amount || '0') / 1_000_000
          if (collateralValue > 0) {
            usdcBalance += collateralValue
          }
        }
      }
    } catch (balanceError) {
      console.error('Error fetching balance:', balanceError)
      // Continue with 0 balance if fetch fails
    }

    // Get bot instance for this user
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress },
    })

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
        accountAddress: accountToCheck,
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
      recentTrades: allOrders.slice(0, 20).map(order => ({
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
  const successfulTrades = orders.filter(o => o.success).length
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
