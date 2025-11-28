import { NextRequest, NextResponse } from 'next/server'
import { botManager } from '@/lib/bot-manager'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

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

    // Initialize bot manager if needed
    await botManager.initialize()

    // Try to get bot from memory first
    const bot = botManager.getBot(userWalletAddress)

    if (bot) {
      // Fetch recent orders from database for the running bot
      const botInstance = await prisma.botInstance.findUnique({
        where: { userWalletAddress },
        include: {
          orders: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
      })

      return NextResponse.json({
        isRunning: true,
        status: {
          ...bot.getStatus(),
          orderHistory: botInstance?.orders || [],
        },
        config: bot.getConfig(),
      })
    }

    // If not in memory, check database
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress },
      include: {
        orders: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
    })

    if (!botInstance) {
      return NextResponse.json({
        isRunning: false,
        status: null,
        config: null,
      })
    }

    // Return database state
    return NextResponse.json({
      isRunning: botInstance.isRunning,
      status: {
        cumulativeVolume: botInstance.cumulativeVolume,
        ordersPlaced: botInstance.ordersPlaced,
        currentCapitalUsed: botInstance.currentCapitalUsed,
        lastOrderTime: botInstance.lastOrderTime,
        error: botInstance.error,
        orderHistory: botInstance.orders,
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
