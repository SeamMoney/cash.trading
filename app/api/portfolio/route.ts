import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'
const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'

// Market address to name mapping
const MARKET_NAMES: Record<string, string> = {
  '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e': 'BTC/USD',
  '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d': 'ETH/USD',
  '0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4': 'SOL/USD',
  '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2': 'APT/USD',
  '0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2': 'WLFI/USD',
}

// Price decimals for each market - all use 6 decimals on Decibel testnet
// Verified from on-chain oracle_px values (e.g., BTC: 87001041693 → $87,001)
const MARKET_PRICE_DECIMALS: Record<string, number> = {
  'BTC/USD': 6,
  'ETH/USD': 6,
  'SOL/USD': 6,
  'APT/USD': 6,
  'WLFI/USD': 6,
}

// Get price decimals for a market
function getPriceDecimals(marketName: string): number {
  return MARKET_PRICE_DECIMALS[marketName] || 6
}

// Default leverage for each market
const MARKET_MAX_LEVERAGE: Record<string, number> = {
  'BTC/USD': 40,
  'ETH/USD': 20,
  'SOL/USD': 20,
  'APT/USD': 10,
  'WLFI/USD': 10,
}

// Get default leverage for a market
function getDefaultLeverage(marketName: string): number {
  return MARKET_MAX_LEVERAGE[marketName] || 10
}

/**
 * Fetch on-chain trade history from Decibel events
 */
async function fetchOnChainTrades(subaccount: string): Promise<any[]> {
  const trades: any[] = []

  try {
    // Fetch account transactions
    const response = await fetch(
      `${APTOS_NODE}/accounts/${subaccount}/events/${DECIBEL_PACKAGE}::events::PositionUpdateEvent/position_update?limit=100`
    )

    if (!response.ok) {
      // Try alternate event path
      const txResponse = await fetch(
        `${APTOS_NODE}/accounts/${subaccount}/transactions?limit=50`
      )

      if (txResponse.ok) {
        const transactions = await txResponse.json()

        for (const tx of transactions) {
          if (!tx.success) continue

          // Look for Decibel trading functions
          const func = tx.payload?.function || ''
          if (func.includes('place_twap_order') ||
              func.includes('place_order') ||
              func.includes('place_market_order')) {

            // Extract market from arguments
            const marketArg = tx.payload?.arguments?.[1]?.inner || tx.payload?.arguments?.[1]
            const market = MARKET_NAMES[marketArg] || 'Unknown'

            // Determine direction from arguments
            const isLong = tx.payload?.arguments?.[3] === true || tx.payload?.arguments?.[3] === 'true'

            trades.push({
              id: tx.hash,
              timestamp: new Date(Number(tx.timestamp) / 1000),
              txHash: tx.hash,
              direction: isLong ? 'long' : 'short',
              strategy: func.includes('twap') ? 'twap' : 'market',
              market,
              size: 0,
              volumeGenerated: 0,
              success: true,
              entryPrice: null,
              exitPrice: null,
              pnl: 0,
              leverage: getDefaultLeverage(market),
            })
          }
        }
      }
    } else {
      const events = await response.json()

      for (const event of events) {
        const data = event.data
        const market = MARKET_NAMES[data.market?.inner] || 'Unknown'
        const pxDecimals = getPriceDecimals(market)
        const priceDivisor = Math.pow(10, pxDecimals)

        trades.push({
          id: event.sequence_number,
          timestamp: new Date(Number(event.timestamp) / 1000),
          txHash: event.transaction_hash || `event_${event.sequence_number}`,
          direction: data.is_long ? 'long' : 'short',
          strategy: 'manual',
          market,
          size: Number(data.size || 0),
          volumeGenerated: Number(data.notional || 0) / 1e6,
          success: true,
          entryPrice: Number(data.entry_price || 0) / priceDivisor,
          exitPrice: data.exit_price ? Number(data.exit_price) / priceDivisor : null,
          pnl: Number(data.realized_pnl || 0) / 1e6,
          leverage: getDefaultLeverage(market),
        })
      }
    }
  } catch (err) {
    console.error('Error fetching on-chain trades:', err)
  }

  return trades
}

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

    // Try to fetch real-time available margin from blockchain
    // Falls back to capitalUSDC from database if API fails
    let usdcBalance = botInstance?.capitalUSDC || 0

    if (botInstance?.userSubaccount) {
      try {
        const marginResponse = await fetch(`${APTOS_NODE}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
            type_arguments: [],
            arguments: [botInstance.userSubaccount],
          }),
        })

        if (marginResponse.ok) {
          const marginData = await marginResponse.json()
          const marginRaw = marginData[0] as string
          usdcBalance = Number(marginRaw) / 1_000_000 // 6 decimals
        }
      } catch (err) {
        console.warn('Could not fetch on-chain margin, using database value')
      }
    }

    // Get ALL trade history for this user (across all sessions)
    let botOrders: any[] = []
    if (botInstance) {
      const rawOrders = await prisma.orderHistory.findMany({
        where: { botId: botInstance.id },
        orderBy: { timestamp: 'desc' },
      })
      // Convert BigInt to Number for JSON serialization
      // Add fallback market/leverage for legacy orders
      botOrders = rawOrders.map(order => ({
        ...order,
        size: Number(order.size),
        source: 'bot' as const,
        // Fall back to bot instance values for legacy orders
        market: order.market || botInstance.marketName,
        leverage: order.leverage || getDefaultLeverage(botInstance.marketName),
      }))
    }

    // Fetch on-chain trade history from Decibel
    let onChainTrades: any[] = []
    if (botInstance?.userSubaccount) {
      try {
        onChainTrades = await fetchOnChainTrades(botInstance.userSubaccount)
      } catch (err) {
        console.warn('Could not fetch on-chain trades:', err)
      }
    }

    // Merge and dedupe trades (bot orders + on-chain trades)
    // On-chain trades that aren't in bot orders are manual trades
    const botTxHashes = new Set(botOrders.map(o => o.txHash))
    const manualTrades = onChainTrades
      .filter(t => !botTxHashes.has(t.txHash))
      .map(t => ({ ...t, source: 'manual' as const }))

    const allOrders = [...botOrders, ...manualTrades]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

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
        source: order.source || 'bot', // 'bot' or 'manual'
        market: order.market || botInstance?.marketName || 'Unknown',
        leverage: order.leverage,
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
