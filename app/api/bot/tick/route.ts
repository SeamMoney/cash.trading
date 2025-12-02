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
    // High risk: 10 seconds (mostly monitoring, actual trades are infrequent)
    // Other strategies: 30 seconds
    const rateLimit = bot.strategy === 'high_risk' ? 10000 : 30000
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
    })
  } catch (error) {
    console.error('Manual tick error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
