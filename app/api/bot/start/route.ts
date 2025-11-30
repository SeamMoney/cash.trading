import { NextRequest, NextResponse } from 'next/server'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'
import { botManager } from '@/lib/bot-manager'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias,
      market,
      marketName,
      strategy,
    } = body as BotConfig

    console.log('📥 Received userWalletAddress:', typeof userWalletAddress, userWalletAddress)

    // Validate inputs
    if (!userWalletAddress || !userSubaccount) {
      return NextResponse.json(
        { error: 'Missing required fields: userWalletAddress, userSubaccount' },
        { status: 400 }
      )
    }

    if (capitalUSDC <= 0 || volumeTargetUSDC <= 0) {
      return NextResponse.json(
        { error: 'Capital and volume target must be positive' },
        { status: 400 }
      )
    }

    if (!['long', 'short', 'neutral'].includes(bias)) {
      return NextResponse.json(
        { error: 'Bias must be long, short, or neutral' },
        { status: 400 }
      )
    }

    // Check if bot already running for this user (in memory or database)
    if (botManager.hasBot(userWalletAddress)) {
      return NextResponse.json(
        { error: 'Bot already running for this wallet. Stop it first.' },
        { status: 409 }
      )
    }

    const existingBot = await prisma.botInstance.findUnique({
      where: { userWalletAddress },
    })

    if (existingBot?.isRunning) {
      return NextResponse.json(
        { error: 'Bot already running for this wallet. Stop it first.' },
        { status: 409 }
      )
    }

    // Generate a new session ID for this bot run
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Create or update bot in database
    const botInstance = await prisma.botInstance.upsert({
      where: { userWalletAddress },
      create: {
        userWalletAddress,
        userSubaccount,
        capitalUSDC,
        volumeTargetUSDC,
        bias,
        strategy,
        market,
        marketName,
        isRunning: true,
        sessionId,
      },
      update: {
        userSubaccount,
        capitalUSDC,
        volumeTargetUSDC,
        bias,
        strategy,
        market,
        marketName,
        isRunning: true,
        cumulativeVolume: 0,
        ordersPlaced: 0,
        currentCapitalUsed: 0,
        error: null,
        sessionId,  // New session for each start
      },
    })

    // Create and start bot engine
    const config: BotConfig = {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias,
      strategy,
      market,
      marketName,
    }

    const bot = new VolumeBotEngine(config)
    await bot.start()

    // Store bot instance in memory
    botManager.setBot(userWalletAddress, bot)

    console.log('✅ Bot started and persisted to database:', botInstance.id)

    return NextResponse.json({
      success: true,
      message: 'Volume bot started successfully',
      status: bot.getStatus(),
      config: bot.getConfig(),
    })
  } catch (error) {
    console.error('Error starting bot:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start bot' },
      { status: 500 }
    )
  }
}
