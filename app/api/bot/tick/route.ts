import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'
import { getMarkPrice } from '@/lib/price-feed'
import { getAllMarketAddresses, createAuthenticatedAptos } from '@/lib/decibel-sdk'

// Market configs for size/price decimals
const MARKET_CONFIG: Record<string, { pxDecimals: number; szDecimals: number }> = {
  'BTC/USD': { pxDecimals: 6, szDecimals: 8 },
  'APT/USD': { pxDecimals: 6, szDecimals: 4 },
  'WLFI/USD': { pxDecimals: 6, szDecimals: 3 },
  'SOL/USD': { pxDecimals: 6, szDecimals: 6 },
  'ETH/USD': { pxDecimals: 6, szDecimals: 7 },
}

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes - need time to wait for TWAP fills

/**
 * Manual bot tick endpoint - executes one trade cycle for a specific bot
 * Can be called from the frontend when cron isn't working
 *
 * POST /api/bot/tick
 * Body: { userWalletAddress: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userWalletAddress, userSubaccount } = body

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    console.log(`⏰ Manual tick for ${userWalletAddress} subaccount: ${userSubaccount?.slice(0, 20) || 'any'}`)

    // Get bot from database - use composite key if subaccount provided
    let bot
    if (userSubaccount) {
      bot = await prisma.botInstance.findUnique({
        where: {
          userWalletAddress_userSubaccount: {
            userWalletAddress,
            userSubaccount,
          }
        },
      })
      // Verify it's running
      if (bot && !bot.isRunning) {
        bot = null
      }
    } else {
      // Fallback: find first running bot for this wallet
      bot = await prisma.botInstance.findFirst({
        where: { userWalletAddress, isRunning: true },
      })
    }

    if (!bot) {
      return NextResponse.json(
        { error: 'No running bot found for this wallet' },
        { status: 404 }
      )
    }

    // Check rate limiting based on strategy
    // TX Spammer: 3 seconds (rapid fire transactions)
    // High risk: 3 seconds (very fast monitoring for TP/SL)
    // Other strategies: 30 seconds
    const rateLimit = bot.strategy === 'tx_spammer' ? 3000
      : bot.strategy === 'high_risk' ? 3000
      : 30000
    if (bot.lastOrderTime) {
      const timeSinceLastOrder = Date.now() - new Date(bot.lastOrderTime).getTime()
      if (timeSinceLastOrder < rateLimit) {
        return NextResponse.json({
          error: 'Rate limited',
          message: `Please wait ${Math.ceil((rateLimit - timeSinceLastOrder) / 1000)} seconds`,
          nextAllowedAt: new Date(new Date(bot.lastOrderTime).getTime() + rateLimit).toISOString(),
        }, { status: 429 })
      }
    }

    // Check if bot has reached volume target
    if (bot.cumulativeVolume >= bot.volumeTargetUSDC) {
      // For high_risk strategy, ALWAYS check on-chain position before stopping
      // DB might not reflect actual position state
      if (bot.strategy === 'high_risk') {
        // Check on-chain position (use authenticated client to avoid 429 rate limits)
        const aptos = createAuthenticatedAptos()
        try {
          const resources = await aptos.getAccountResources({
            accountAddress: bot.userSubaccount
          })
          const positionsResource = resources.find((r: any) =>
            r.type.includes('perp_positions::UserPositions')
          )
          if (positionsResource) {
            const data = positionsResource.data as any
            const entries = data.positions?.root?.children?.entries || []
            const marketPosition = entries.find((e: any) =>
              e.key.inner.toLowerCase() === bot.market.toLowerCase()
            )
            if (marketPosition && parseInt(marketPosition.value.value.size) > 0) {
              console.log(`📊 Volume target reached but ON-CHAIN position exists - must close first!`)
              console.log(`   On-chain size: ${marketPosition.value.value.size}`)
              // Don't stop - let engine close the position
            } else {
              // No on-chain position, safe to stop
              await prisma.botInstance.update({
                where: { id: bot.id },
                data: { isRunning: false },
              })
              return NextResponse.json({
                success: true,
                status: 'completed',
                message: 'Volume target reached, bot stopped',
              })
            }
          }
        } catch (e) {
          console.error('Failed to check on-chain position:', e)
          // If we can't check, don't stop - better safe than sorry
        }
      } else {
        // Non high_risk strategies - just stop
        await prisma.botInstance.update({
          where: { id: bot.id },
          data: { isRunning: false },
        })
        return NextResponse.json({
          success: true,
          status: 'completed',
          message: 'Volume target reached, bot stopped',
        })
      }
    }

    // Resolve market address from SDK (survives testnet resets)
    let resolvedMarket = bot.market
    try {
      const markets = await getAllMarketAddresses()
      const sdkMarket = markets.find((m) => m.name === bot.marketName)
      if (sdkMarket?.address) {
        if (sdkMarket.address.toLowerCase() !== bot.market.toLowerCase()) {
          console.log(`⚠️  [SDK] Market address changed! Updating...`)
          console.log(`   Old: ${bot.market.slice(0, 20)}...`)
          console.log(`   New: ${sdkMarket.address.slice(0, 20)}...`)
          // Update database with new address
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { market: sdkMarket.address },
          })
        }
        resolvedMarket = sdkMarket.address
      }
    } catch (error) {
      console.warn('⚠️  [SDK] Address resolution failed, using stored address:', error)
    }

    // Execute trade
    const config: BotConfig = {
      userWalletAddress: bot.userWalletAddress,
      userSubaccount: bot.userSubaccount,
      capitalUSDC: bot.capitalUSDC,
      volumeTargetUSDC: bot.volumeTargetUSDC,
      bias: bot.bias as 'long' | 'short' | 'neutral',
      strategy: bot.strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk',
      market: resolvedMarket,
      marketName: bot.marketName,
    }

    const botEngine = new VolumeBotEngine(config)

    // Pass the lastTwapOrderTime from database to engine for high_risk strategy
    console.log(`📅 Bot lastTwapOrderTime from DB: ${bot.lastTwapOrderTime?.toISOString() || 'null'}`)
    if (bot.lastTwapOrderTime) {
      botEngine.setLastTwapOrderTime(bot.lastTwapOrderTime)
    }

    const success = await botEngine.executeSingleTrade()

    // Get the updated lastTwapOrderTime from the engine and persist to database
    const newTwapTime = botEngine.getLastTwapOrderTime()
    console.log(`📅 Engine lastTwapOrderTime after trade: ${newTwapTime?.toISOString() || 'null'}`)
    if (newTwapTime) {
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { lastTwapOrderTime: newTwapTime },
      })
      console.log(`📅 Saved lastTwapOrderTime to DB`)
    }

    // Get updated bot status
    const updatedBot = await prisma.botInstance.findUnique({
      where: { id: bot.id },
    })

    // For high_risk: if volume target reached AND position is now closed, stop the bot
    if (updatedBot &&
        bot.strategy === 'high_risk' &&
        updatedBot.cumulativeVolume >= updatedBot.volumeTargetUSDC &&
        (!updatedBot.activePositionSize || updatedBot.activePositionSize === 0)) {
      console.log(`🎯 High risk: Volume target reached and position closed - stopping bot`)
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { isRunning: false },
      })
      // Refetch to get the updated isRunning status
      const finalBot = await prisma.botInstance.findUnique({
        where: { id: bot.id },
      })
      return NextResponse.json({
        success: true,
        status: 'completed',
        isRunning: false,
        cumulativeVolume: finalBot?.cumulativeVolume || updatedBot.cumulativeVolume,
        volumeTargetUSDC: finalBot?.volumeTargetUSDC || updatedBot.volumeTargetUSDC,
        progress: '100.0',
        ordersPlaced: finalBot?.ordersPlaced || updatedBot.ordersPlaced,
        message: '🎯 Volume target reached! Position closed and bot stopped.',
        market: bot.marketName,
      })
    }

    // Check if a NEW order was placed (ordersPlaced increased)
    const newOrderPlaced = updatedBot && updatedBot.ordersPlaced > bot.ordersPlaced

    // Only fetch latest order if a new one was placed
    let latestOrder = null
    if (newOrderPlaced) {
      latestOrder = await prisma.orderHistory.findFirst({
        where: { botId: bot.id },
        orderBy: { timestamp: 'desc' },
      })
    }

    // Check if bot was auto-stopped due to reaching target
    const wasAutoStopped = updatedBot && !updatedBot.isRunning
    const progress = updatedBot
      ? (updatedBot.cumulativeVolume / updatedBot.volumeTargetUSDC) * 100
      : 0

    // Fetch ALL open positions across all markets
    interface OpenPosition {
      market: string
      marketAddress: string
      direction: 'long' | 'short'
      size: number
      entryPrice: number
      currentPrice?: number
      pnlPercent?: number
      leverage: number
      isManual: boolean  // true if not tracked by bot
    }
    const allPositions: OpenPosition[] = []

    // Legacy single-position fields for backwards compatibility
    let currentPnl: number | undefined
    let positionDirection: string | undefined
    let positionSize: number | undefined
    let positionEntry: number | undefined
    let currentPrice: number | undefined
    let isManualPosition = false
    let manualPositionMarket: string | undefined

    // Always fetch real on-chain positions for accurate display
    try {
      const aptos = createAuthenticatedAptos()

      // Fetch all positions from on-chain
      const resources = await aptos.getAccountResources({
        accountAddress: bot.userSubaccount
      })

      const positionsResource = resources.find((r: any) =>
        r.type.includes('perp_positions::UserPositions')
      )

      if (positionsResource) {
        const data = positionsResource.data as any
        const entries = data.positions?.root?.children?.entries || []

        // Process ALL positions with non-zero size
        for (const entry of entries) {
          const pos = entry.value?.value
          const size = parseInt(pos?.size || '0')
          if (!pos || size === 0) continue

          const marketAddr = entry.key?.inner

          // Look up market name by fetching market config from chain
          let marketName = 'Unknown'
          let pxDecimals = 6  // default
          let szDecimals = 6  // default

          try {
            const marketRes = await fetch(
              `https://api.testnet.aptoslabs.com/v1/accounts/${marketAddr}/resources`
            )
            const marketResources = await marketRes.json()
            const configResource = marketResources.find((r: any) =>
              r.type.includes('perp_market_config::PerpMarketConfig')
            )
            if (configResource?.data?.name) {
              marketName = configResource.data.name
              // Use correct decimals based on market
              const mktConfig = MARKET_CONFIG[marketName]
              if (mktConfig) {
                pxDecimals = mktConfig.pxDecimals
                szDecimals = mktConfig.szDecimals
              }
            }
          } catch (e) {
            console.warn(`Could not fetch market info for ${marketAddr}`)
          }

          const entryPrice = parseInt(pos.avg_acquire_entry_px) / Math.pow(10, pxDecimals)
          const leverage = pos.user_leverage || 1
          const direction = pos.is_long ? 'long' : 'short'

          // Check if this is bot's tracked position
          const isBotMarket = marketAddr.toLowerCase() === bot.market.toLowerCase()
          const botTrackedSize = updatedBot?.activePositionSize || 0
          const isManual = !isBotMarket || (isBotMarket && botTrackedSize === 0)

          // Fetch current price for this market
          let mktCurrentPrice: number | undefined
          let mktPnlPercent: number | undefined
          try {
            const priceData = await getMarkPrice(marketAddr, 'testnet', 2000)
            if (priceData) {
              mktCurrentPrice = priceData.markPx
            } else {
              // Fallback to on-chain oracle
              const priceRes = await fetch(
                `https://api.testnet.aptoslabs.com/v1/accounts/${marketAddr}/resources`
              )
              const priceResources = await priceRes.json()
              const priceResource = priceResources.find((r: any) =>
                r.type.includes('price_management::Price')
              )
              if (priceResource) {
                mktCurrentPrice = Number(priceResource.data.oracle_px) / Math.pow(10, pxDecimals)
              }
            }

            if (mktCurrentPrice && entryPrice) {
              mktPnlPercent = pos.is_long
                ? ((mktCurrentPrice - entryPrice) / entryPrice) * 100
                : ((entryPrice - mktCurrentPrice) / entryPrice) * 100
            }
          } catch (e) {
            console.warn(`Could not fetch price for ${marketName}`)
          }

          allPositions.push({
            market: marketName,
            marketAddress: marketAddr,
            direction: direction as 'long' | 'short',
            size,
            entryPrice,
            currentPrice: mktCurrentPrice,
            pnlPercent: mktPnlPercent,
            leverage,
            isManual,
          })

          console.log(`📊 Position: ${direction.toUpperCase()} ${marketName} | Entry: $${entryPrice.toFixed(6)} | PnL: ${mktPnlPercent?.toFixed(2) || '?'}%`)

          // Set legacy fields for the bot's configured market (backwards compat)
          if (isBotMarket) {
            positionSize = size
            positionDirection = direction
            positionEntry = entryPrice
            currentPrice = mktCurrentPrice
            currentPnl = mktPnlPercent
            if (isManual) {
              isManualPosition = true
              manualPositionMarket = marketName
            }
          }
        }

        // If no position in bot's market but positions exist elsewhere, set manual flag
        if (!positionSize && allPositions.length > 0) {
          const firstPos = allPositions[0]
          positionSize = firstPos.size
          positionDirection = firstPos.direction
          positionEntry = firstPos.entryPrice
          currentPrice = firstPos.currentPrice
          currentPnl = firstPos.pnlPercent
          isManualPosition = true
          manualPositionMarket = firstPos.market
        }
      }
    } catch (e) {
      console.error('Failed to fetch on-chain positions:', e)
      // Fallback to database if on-chain fetch fails
      if (updatedBot?.activePositionSize && updatedBot?.activePositionEntry) {
        positionDirection = updatedBot.activePositionIsLong ? 'long' : 'short'
        positionSize = Number(updatedBot.activePositionSize)
        positionEntry = updatedBot.activePositionEntry
      }
    }

    return NextResponse.json({
      success,
      status: wasAutoStopped ? 'completed' : (newOrderPlaced ? 'executed' : 'monitoring'),
      isRunning: updatedBot?.isRunning ?? false,
      cumulativeVolume: updatedBot?.cumulativeVolume || bot.cumulativeVolume,
      volumeTargetUSDC: updatedBot?.volumeTargetUSDC || bot.volumeTargetUSDC,
      progress: progress.toFixed(1),
      ordersPlaced: updatedBot?.ordersPlaced || bot.ordersPlaced,
      lastOrderTime: updatedBot?.lastOrderTime?.toISOString(),
      message: wasAutoStopped ? '🎯 Volume target reached! Bot stopped.' : undefined,
      // Trade details for toast - only if new order was placed
      direction: latestOrder?.direction,
      volumeGenerated: latestOrder?.volumeGenerated,
      txHash: latestOrder?.txHash,
      market: bot.marketName,
      // ALL open positions across all markets
      allPositions,
      // Legacy single-position fields (backwards compat)
      currentPnl,
      positionDirection,
      positionSize,
      positionEntry,
      currentPrice,
      // Manual position detection (opened via Decibel UI, not by bot)
      isManualPosition,
      manualPositionMarket,
    })
  } catch (error) {
    console.error('Manual tick error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Check if this is a rate limit error (429)
    const isRateLimit = errorMessage.includes('429') || errorMessage.includes('Too Many Requests') || errorMessage.includes('rate limit')

    if (isRateLimit) {
      return NextResponse.json({
        error: 'Rate limited by Aptos API',
        message: 'Too many requests. Will retry automatically.',
        retryAfter: 10, // Suggest 10 second backoff
        isRateLimit: true,
      }, { status: 429 })
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
