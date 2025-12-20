import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DECIBEL_PACKAGE, MARKETS, BOT_OPERATOR } from '@/lib/decibel-client'

export const runtime = 'nodejs'

const APTOS_NODE = 'https://api.testnet.aptoslabs.com/v1'

// Testnet reset date - filter out all data before this
// Dec 17, 2025 at 00:00 UTC (when Decibel testnet was reset)
const TESTNET_RESET_DATE = new Date('2025-12-17T00:00:00Z')

// Market address to name mapping (updated Dec 17, 2025 after reset)
const MARKET_NAMES: Record<string, string> = Object.entries(MARKETS).reduce(
  (acc, [name, config]) => {
    acc[config.address.toLowerCase()] = name
    return acc
  },
  {} as Record<string, string>
)

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
 * Scans wallet transactions for trade-related events that reference the given subaccount
 * @param walletAddress - The main wallet address (sender of transactions)
 * @param subaccount - The subaccount to filter trades for (optional, if provided filters events by subaccount)
 */
async function fetchOnChainTrades(walletAddress: string, subaccount?: string): Promise<any[]> {
  const trades: any[] = []
  const seenTxHashes = new Set<string>()

  try {
    // Fetch recent transactions for this wallet
    const txResponse = await fetch(
      `${APTOS_NODE}/accounts/${walletAddress}/transactions?limit=100`
    )

    if (!txResponse.ok) {
      console.warn('Failed to fetch subaccount transactions:', txResponse.status)
      return trades
    }

    const transactions = await txResponse.json()
    console.log(`📊 Scanning ${transactions.length} transactions for trades...`)

    for (const tx of transactions) {
      if (!tx.success || seenTxHashes.has(tx.hash)) continue
      seenTxHashes.add(tx.hash)

      const events = tx.events || []
      const func = tx.payload?.function || ''

      // Look for trade-related events
      for (const event of events) {
        const eventType = event.type || ''

        // TradeEvent - actual fill happened
        if (eventType.includes('TradeEvent')) {
          const data = event.data
          // Filter by subaccount if specified
          const eventSubaccount = data.user || data.subaccount || data.account
          if (subaccount && eventSubaccount && eventSubaccount !== subaccount) continue

          const marketAddr = data.market?.inner || data.market
          const market = MARKET_NAMES[marketAddr?.toLowerCase()] || 'Unknown'
          const pxDecimals = getPriceDecimals(market)

          trades.push({
            id: `${tx.hash}_trade`,
            timestamp: new Date(Number(tx.timestamp) / 1000),
            txHash: tx.hash,
            direction: data.is_long ? 'long' : 'short',
            strategy: func.includes('twap') ? 'twap' : 'market',
            market,
            size: Number(data.size || 0),
            volumeGenerated: Number(data.notional || data.value || 0) / 1e6,
            success: true,
            entryPrice: Number(data.price || data.fill_price || 0) / Math.pow(10, pxDecimals),
            exitPrice: null,
            pnl: Number(data.realized_pnl || 0) / 1e6,
            leverage: getDefaultLeverage(market),
          })
          break // One trade per transaction
        }

        // BulkOrderFilledEvent - order was filled
        if (eventType.includes('BulkOrderFilledEvent')) {
          const data = event.data
          // Filter by subaccount if specified
          if (subaccount && data.user !== subaccount) continue

          const marketAddr = data.market?.inner || data.market
          const market = MARKET_NAMES[marketAddr?.toLowerCase()] || 'Unknown'
          const pxDecimals = getPriceDecimals(market)

          const filledSize = Number(data.filled_size || data.size || 0)
          const avgPrice = Number(data.avg_fill_price || data.price || 0) / Math.pow(10, pxDecimals)
          const notional = filledSize * avgPrice / Math.pow(10, getSizeDecimals(market))

          if (filledSize > 0) {
            trades.push({
              id: `${tx.hash}_fill`,
              timestamp: new Date(Number(tx.timestamp) / 1000),
              txHash: tx.hash,
              direction: data.is_buy ? 'long' : 'short',
              strategy: func.includes('twap') ? 'twap' : 'market',
              market,
              size: filledSize,
              volumeGenerated: notional,
              success: true,
              entryPrice: avgPrice,
              exitPrice: null,
              pnl: Number(data.realized_pnl || 0) / 1e6,
              leverage: getDefaultLeverage(market),
            })
            break
          }
        }

        // PositionOpenedEvent / PositionClosedEvent
        if (eventType.includes('PositionOpenedEvent') || eventType.includes('PositionClosedEvent')) {
          const data = event.data
          // Filter by subaccount if specified
          const eventSubaccount = data.user || data.subaccount || data.account
          if (subaccount && eventSubaccount && eventSubaccount !== subaccount) continue

          const marketAddr = data.market?.inner || data.market
          const market = MARKET_NAMES[marketAddr?.toLowerCase()] || 'Unknown'
          const pxDecimals = getPriceDecimals(market)
          const isClose = eventType.includes('Closed')

          trades.push({
            id: `${tx.hash}_pos`,
            timestamp: new Date(Number(tx.timestamp) / 1000),
            txHash: tx.hash,
            direction: data.is_long ? 'long' : 'short',
            strategy: func.includes('twap') ? 'twap' : 'market',
            market,
            size: Number(data.size || 0),
            volumeGenerated: Number(data.notional || 0) / 1e6,
            success: true,
            entryPrice: Number(data.entry_price || data.price || 0) / Math.pow(10, pxDecimals),
            exitPrice: isClose ? Number(data.exit_price || data.close_price || 0) / Math.pow(10, pxDecimals) : null,
            pnl: Number(data.realized_pnl || data.pnl || 0) / 1e6,
            leverage: getDefaultLeverage(market),
          })
          break
        }

        // TwapEvent - TWAP order placed (used for bot-initiated trades)
        if (eventType.includes('TwapEvent')) {
          const data = event.data
          // Filter by subaccount if specified (TwapEvent uses 'account' field)
          const eventSubaccount = data.account
          if (subaccount && eventSubaccount && eventSubaccount !== subaccount) continue

          const marketAddr = data.market?.inner || data.market
          const market = MARKET_NAMES[marketAddr?.toLowerCase()] || 'Unknown'
          const szDecimals = getSizeDecimals(market)

          // Calculate approximate notional value
          // We don't have fill price yet, so estimate based on order size
          const origSize = Number(data.orig_size || 0)
          const remainSize = Number(data.remain_size || 0)
          const filledSize = origSize - remainSize

          // For TWAP orders, we track the order placement
          // Volume is estimated (actual fill price may differ)
          // is_buy = true means long, is_buy = false means short
          const isBuy = data.is_buy === true || data.is_buy === 'true'

          trades.push({
            id: `${tx.hash}_twap`,
            timestamp: new Date(Number(tx.timestamp) / 1000),
            txHash: tx.hash,
            direction: isBuy ? 'long' : 'short',
            strategy: 'twap',
            market,
            size: origSize,
            // Estimate volume - will be refined when we can fetch fill prices
            volumeGenerated: 0, // Set to 0 since we don't know fill price yet
            success: true,
            entryPrice: null, // TWAP doesn't have entry price at order time
            exitPrice: null,
            pnl: 0,
            leverage: getDefaultLeverage(market),
            isTwapOrder: true,
            isReduceOnly: data.is_reduce_only === true || data.is_reduce_only === 'true',
          })
          break
        }
      }

      // If no events found, check if this is a Decibel order placement
      if (trades.filter(t => t.txHash === tx.hash).length === 0) {
        if (func.includes('place_twap_order') ||
            func.includes('place_order') ||
            func.includes('place_market_order') ||
            func.includes('close_position')) {

          // Extract subaccount from arguments (usually arg 0 for most Decibel functions)
          const args = tx.payload?.arguments || []
          const txSubaccount = args[0]?.inner || args[0]

          // Filter by subaccount if specified
          if (subaccount && txSubaccount && txSubaccount !== subaccount) continue

          // Extract market from arguments (usually arg 1 or 2)
          let marketAddr = tx.payload?.arguments?.[1]?.inner ||
                          tx.payload?.arguments?.[1] ||
                          tx.payload?.arguments?.[0]?.inner ||
                          tx.payload?.arguments?.[0]
          const market = MARKET_NAMES[marketAddr?.toLowerCase()] || 'Unknown'

          // Determine direction from arguments
          let isLong = false
          for (const arg of args) {
            if (arg === true || arg === 'true') {
              isLong = true
              break
            }
            if (arg === false || arg === 'false') {
              isLong = false
              break
            }
          }

          trades.push({
            id: tx.hash,
            timestamp: new Date(Number(tx.timestamp) / 1000),
            txHash: tx.hash,
            direction: func.includes('close') ? (isLong ? 'short' : 'long') : (isLong ? 'long' : 'short'),
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

    console.log(`📊 Found ${trades.length} on-chain trades`)
  } catch (err) {
    console.error('Error fetching on-chain trades:', err)
  }

  return trades
}

// Size decimals for each market
function getSizeDecimals(marketName: string): number {
  const SIZE_DECIMALS: Record<string, number> = {
    'BTC/USD': 8,
    'ETH/USD': 7,
    'SOL/USD': 6,
    'APT/USD': 4,
    'WLFI/USD': 3,
  }
  return SIZE_DECIMALS[marketName] || 6
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
    const querySubaccount = searchParams.get('userSubaccount')

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress query parameter' },
        { status: 400 }
      )
    }

    // Get bot instance for this user - use composite key if subaccount provided
    let botInstance
    if (querySubaccount) {
      botInstance = await prisma.botInstance.findUnique({
        where: {
          userWalletAddress_userSubaccount: {
            userWalletAddress,
            userSubaccount: querySubaccount,
          }
        },
      })
    } else {
      // Fallback: find first bot for this wallet
      botInstance = await prisma.botInstance.findFirst({
        where: { userWalletAddress },
      })
    }

    // Use the subaccount from query param if provided, otherwise fall back to bot instance
    const activeSubaccount = querySubaccount || botInstance?.userSubaccount

    // Try to fetch real-time available margin from blockchain
    // Falls back to capitalUSDC from database if API fails
    let usdcBalance = botInstance?.capitalUSDC || 0

    if (activeSubaccount) {
      try {
        const marginResponse = await fetch(`${APTOS_NODE}/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
            type_arguments: [],
            arguments: [activeSubaccount],
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

    // Get trade history for this user (only after testnet reset)
    // Filter by subaccount if provided to show only trades for the selected account
    let botOrders: any[] = []
    if (botInstance) {
      const rawOrders = await prisma.orderHistory.findMany({
        where: {
          botId: botInstance.id,
          // Filter out pre-reset data
          timestamp: { gte: TESTNET_RESET_DATE },
          // Filter by subaccount if one is specified
          ...(querySubaccount ? { userSubaccount: querySubaccount } : {}),
        },
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
      console.log(`📊 Found ${botOrders.length} bot orders for subaccount: ${querySubaccount?.slice(0, 20) || 'all'}...`)
    }

    // Fetch on-chain trade history from Decibel (only post-reset)
    // Scan the main wallet for transactions and filter by subaccount in the events
    // (Subaccounts are resource accounts that don't send transactions - the main wallet does)
    let onChainTrades: any[] = []
    const seenTxHashes = new Set<string>()

    try {
      console.log(`📊 Scanning main wallet trades for subaccount: ${activeSubaccount?.slice(0, 20) || 'all'}...`)
      const walletTrades = await fetchOnChainTrades(userWalletAddress, activeSubaccount || undefined)
      for (const t of walletTrades) {
        if (new Date(t.timestamp) >= TESTNET_RESET_DATE && !seenTxHashes.has(t.txHash)) {
          seenTxHashes.add(t.txHash)
          onChainTrades.push(t)
        }
      }
      console.log(`📊 Found ${onChainTrades.length} on-chain trades from user wallet`)

      // Also scan bot operator transactions for trades on this subaccount
      // (Close-position and bot trades are signed by the bot operator)
      if (activeSubaccount) {
        console.log(`📊 Scanning bot operator trades for subaccount: ${activeSubaccount?.slice(0, 20)}...`)
        const botTrades = await fetchOnChainTrades(BOT_OPERATOR, activeSubaccount)
        let botTradeCount = 0
        for (const t of botTrades) {
          if (new Date(t.timestamp) >= TESTNET_RESET_DATE && !seenTxHashes.has(t.txHash)) {
            seenTxHashes.add(t.txHash)
            onChainTrades.push(t)
            botTradeCount++
          }
        }
        console.log(`📊 Found ${botTradeCount} additional trades from bot operator`)
      }
    } catch (err) {
      console.warn('Could not fetch wallet trades:', err)
    }

    // Calculate realized PnL from deposits vs current balance
    // This is the most reliable way since TWAP fills don't emit trackable events
    let totalDeposits = 0
    let totalWithdrawals = 0
    try {
      // Scan user wallet transactions for deposit events
      const txResponse = await fetch(
        `${APTOS_NODE}/accounts/${userWalletAddress}/transactions?limit=100`
      )
      if (txResponse.ok) {
        const transactions = await txResponse.json()
        for (const tx of transactions) {
          if (!tx.success) continue
          // Filter by date
          const txDate = new Date(Number(tx.timestamp) / 1000)
          if (txDate < TESTNET_RESET_DATE) continue

          for (const event of (tx.events || [])) {
            // Look for deposit/withdraw to our subaccount
            if (event.type.includes('CollateralBalanceChangeEvent')) {
              const data = event.data
              // Check if this is for our subaccount
              const balanceAccount = data.balance_type?.Cross?.account || data.balance_type?.account
              if (activeSubaccount && balanceAccount &&
                  balanceAccount.toLowerCase() !== activeSubaccount.toLowerCase()) continue

              const delta = Number(data.delta || 0) / 1e6
              const changeType = data.change_type?.__variant__

              if (changeType === 'UserMovement') {
                // User deposit or withdrawal
                if (delta > 0) {
                  totalDeposits += delta
                } else {
                  totalWithdrawals += Math.abs(delta)
                }
              }
            }
          }
        }
      }
      console.log(`📊 Total deposits: $${totalDeposits.toFixed(2)}, withdrawals: $${totalWithdrawals.toFixed(2)}`)
    } catch (err) {
      console.warn('Could not calculate deposits:', err)
    }

    // Calculate realized PnL from balance difference
    const netDeposits = totalDeposits - totalWithdrawals
    const realizedPnlFromBalance = netDeposits > 0 ? usdcBalance - netDeposits : 0

    // Detect current positions and create synthetic trades for untracked ones
    // This ensures manual positions opened on Decibel UI show up in trade history
    if (activeSubaccount) {
      try {
        const posResponse = await fetch(`${APTOS_NODE}/accounts/${activeSubaccount}/resources`)
        if (posResponse.ok) {
          const resources = await posResponse.json()
          const positionsResource = resources.find((r: any) =>
            r.type.includes('perp_positions::UserPositions')
          )

          if (positionsResource) {
            const entries = positionsResource.data?.positions?.root?.children?.entries || []

            for (const entry of entries) {
              const pos = entry.value?.value
              const size = parseInt(pos?.size || '0')
              if (!pos || size === 0) continue

              const marketAddr = entry.key?.inner

              // Look up market name
              let marketName = 'Unknown'
              let pxDecimals = 6
              try {
                const marketRes = await fetch(`${APTOS_NODE}/accounts/${marketAddr}/resources`)
                const marketResources = await marketRes.json()
                const configResource = marketResources.find((r: any) =>
                  r.type.includes('perp_market_config::PerpMarketConfig')
                )
                if (configResource?.data?.name) {
                  marketName = configResource.data.name
                  pxDecimals = MARKET_PRICE_DECIMALS[marketName] || 6
                }
              } catch (e) {
                console.warn(`Could not fetch market info for ${marketAddr}`)
              }

              const entryPrice = parseInt(pos.avg_acquire_entry_px) / Math.pow(10, pxDecimals)
              const leverage = pos.user_leverage || 1
              const direction = pos.is_long ? 'long' : 'short'

              // Check if this position is already tracked in trades
              const positionKey = `${marketAddr}_${direction}`
              const isTracked = [...botOrders, ...onChainTrades].some(t =>
                t.market === marketName && t.direction === direction && t.size > 0
              )

              if (!isTracked) {
                // Create synthetic trade entry for this untracked position
                console.log(`📊 Adding synthetic trade for untracked ${direction} ${marketName} position`)

                // Get current price for PnL calculation
                let currentPrice = entryPrice
                try {
                  const priceRes = await fetch(`${APTOS_NODE}/accounts/${marketAddr}/resources`)
                  const priceResources = await priceRes.json()
                  const priceResource = priceResources.find((r: any) =>
                    r.type.includes('price_management::Price')
                  )
                  if (priceResource) {
                    currentPrice = Number(priceResource.data.oracle_px) / Math.pow(10, pxDecimals)
                  }
                } catch (e) {}

                const szDecimals = getSizeDecimals(marketName)
                const notionalValue = size * entryPrice / Math.pow(10, szDecimals)

                onChainTrades.push({
                  id: `manual_${marketAddr}_${Date.now()}`,
                  timestamp: new Date(), // Use current time since we don't know when it was opened
                  txHash: `manual_position_${marketAddr.slice(0, 10)}`,
                  direction,
                  strategy: 'manual',
                  market: marketName,
                  size,
                  volumeGenerated: notionalValue,
                  success: true,
                  entryPrice,
                  exitPrice: null,
                  pnl: 0,
                  leverage,
                  isOpenPosition: true, // Flag to indicate this is a current open position
                })
              }
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch positions for synthetic trades:', err)
      }
    }

    // Merge and dedupe trades (bot orders + on-chain trades)
    // On-chain trades that aren't in bot orders are manual trades
    const botTxHashes = new Set(botOrders.map(o => o.txHash))
    const manualTrades = onChainTrades
      .filter(t => !botTxHashes.has(t.txHash))
      .map(t => ({ ...t, source: 'manual' as const }))

    let allOrders = [...botOrders, ...manualTrades]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // Enrich TWAP orders with estimated volume (use current price * size)
    // This is approximate but better than showing 0 volume
    const marketsToFetchPrices = new Set(
      allOrders
        .filter(o => o.size > 0 && (o.volumeGenerated === 0 || o.volumeGenerated === null))
        .map(o => o.market)
        .filter(m => m !== 'Unknown')
    )

    const marketPrices: Record<string, number> = {}
    for (const marketName of marketsToFetchPrices) {
      try {
        const marketConfig = Object.values(MARKETS).find(m =>
          MARKET_NAMES[m.address.toLowerCase()] === marketName
        )
        if (marketConfig) {
          const priceRes = await fetch(`${APTOS_NODE}/accounts/${marketConfig.address}/resources`)
          if (priceRes.ok) {
            const priceResources = await priceRes.json()
            const priceResource = priceResources.find((r: any) =>
              r.type.includes('price_management::Price')
            )
            if (priceResource) {
              const pxDecimals = getPriceDecimals(marketName)
              marketPrices[marketName] = Number(priceResource.data.oracle_px) / Math.pow(10, pxDecimals)
            }
          }
        }
      } catch (e) {
        console.warn(`Could not fetch price for ${marketName}`)
      }
    }

    // Apply estimated volume to orders with size but no volume
    allOrders = allOrders.map(order => {
      if (order.size > 0 && (order.volumeGenerated === 0 || order.volumeGenerated === null)) {
        const price = marketPrices[order.market]
        if (price) {
          const szDecimals = getSizeDecimals(order.market)
          const estimatedVolume = (order.size * price) / Math.pow(10, szDecimals)
          return { ...order, volumeGenerated: estimatedVolume }
        }
      }
      return order
    })

    // Calculate statistics from all orders
    const stats = calculateStats(allOrders)

    // Use balance-based PnL if per-trade PnL is 0 (TWAP orders don't have fill data)
    const effectivePnl = stats.totalPnl !== 0 ? stats.totalPnl : realizedPnlFromBalance

    // Group orders by date for chart data
    const dailyStats = calculateDailyStats(allOrders)

    return NextResponse.json({
      success: true,
      balance: {
        usdc: usdcBalance,
        accountAddress: activeSubaccount || userWalletAddress,
        totalDeposits: netDeposits,  // Include for transparency
      },
      stats: {
        totalVolume: stats.totalVolume,
        totalPnl: effectivePnl,
        totalTrades: stats.totalTrades,
        winRate: stats.winRate,
        avgTradeSize: stats.avgTradeSize,
        bestTrade: stats.bestTrade,
        worstTrade: stats.worstTrade,
        pnlSource: stats.totalPnl !== 0 ? 'trades' : 'balance', // Indicate how PnL was calculated
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
