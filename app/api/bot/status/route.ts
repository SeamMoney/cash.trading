import { NextRequest, NextResponse } from 'next/server'
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

    // Get bot from database
    const botInstance = await prisma.botInstance.findUnique({
      where: { userWalletAddress },
    })

    if (!botInstance) {
      return NextResponse.json({
        isRunning: false,
        status: null,
        config: null,
      })
    }

    // Get orders filtered by current session
    const sessionOrders = await prisma.orderHistory.findMany({
      where: {
        botId: botInstance.id,
        sessionId: botInstance.sessionId,  // Only orders from current session
      },
      orderBy: { timestamp: 'desc' },
      take: 50,
    })

    // Calculate progress
    const progress = (botInstance.cumulativeVolume / botInstance.volumeTargetUSDC) * 100

    // Return database state with session info
    return NextResponse.json({
      isRunning: botInstance.isRunning,
      sessionId: botInstance.sessionId,
      status: {
        cumulativeVolume: botInstance.cumulativeVolume,
        volumeTargetUSDC: botInstance.volumeTargetUSDC,
        progress: progress.toFixed(1),
        ordersPlaced: botInstance.ordersPlaced,
        currentCapitalUsed: botInstance.currentCapitalUsed,
        lastOrderTime: botInstance.lastOrderTime,
        error: botInstance.error,
        orderHistory: sessionOrders,  // Only orders from current session
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
