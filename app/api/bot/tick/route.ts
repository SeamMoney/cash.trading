import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'

export const runtime = 'nodejs'
export const maxDuration = 60

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
    const { userWalletAddress } = body

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    console.log(`⏰ Manual tick for ${userWalletAddress}`)

    // Get bot from database
    const bot = await prisma.botInstance.findFirst({
      where: { userWalletAddress, isRunning: true },
    })

    if (!bot) {
      return NextResponse.json(
        { error: 'No running bot found for this wallet' },
        { status: 404 }
      )
    }

    // Check rate limiting based on strategy
    // TX Spammer: 3 seconds (rapid fire transactions)
    // High risk: 5 seconds (fast monitoring for quick PnL trades)
    // Other strategies: 30 seconds
    const rateLimit = bot.strategy === 'tx_spammer' ? 3000
      : bot.strategy === 'high_risk' ? 5000
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
      // For high_risk strategy, must close any open position before stopping
      if (bot.strategy === 'high_risk' && bot.activePositionSize && bot.activePositionSize > 0) {
        console.log(`📊 Volume target reached but high_risk has open position - must close first!`)
        console.log(`   Position: ${bot.activePositionIsLong ? 'LONG' : 'SHORT'} ${bot.activePositionSize}`)
        // Don't stop yet - let the engine close the position first
        // The executeSingleTrade will handle closing it
      } else {
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

    // Execute trade
    const config: BotConfig = {
      userWalletAddress: bot.userWalletAddress,
      userSubaccount: bot.userSubaccount,
      capitalUSDC: bot.capitalUSDC,
      volumeTargetUSDC: bot.volumeTargetUSDC,
      bias: bot.bias as 'long' | 'short' | 'neutral',
      strategy: bot.strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk',
      market: bot.market,
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

    // Calculate current PnL for monitoring status
    let currentPnl: number | undefined
    let positionDirection: string | undefined
    let positionSize: number | undefined
    let positionEntry: number | undefined
    let currentPrice: number | undefined

    if (updatedBot?.activePositionSize && updatedBot?.activePositionEntry) {
      positionDirection = updatedBot.activePositionIsLong ? 'long' : 'short'
      positionSize = updatedBot.activePositionSize
      positionEntry = updatedBot.activePositionEntry

      // Fetch current price to calculate PnL
      try {
        const priceRes = await fetch(
          `https://api.testnet.aptoslabs.com/v1/accounts/${bot.market}/resources`
        )
        const resources = await priceRes.json()
        const priceResource = resources.find((r: any) => r.type.includes('price_management::Price'))
        if (priceResource) {
          // All markets on Decibel testnet use 6 decimals for prices
          currentPrice = Number(priceResource.data.oracle_px) / 1e6
          const entryPrice = updatedBot.activePositionEntry
          currentPnl = updatedBot.activePositionIsLong
            ? ((currentPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - currentPrice) / entryPrice) * 100
        }
      } catch (e) {
        console.error('Failed to fetch current price for PnL:', e)
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
      // Monitoring info - full position details
      currentPnl,
      positionDirection,
      positionSize,
      positionEntry,
      currentPrice,
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
