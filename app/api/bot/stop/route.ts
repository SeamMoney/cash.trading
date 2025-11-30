import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userWalletAddress } = body

    console.log('🛑 Stop request for wallet:', userWalletAddress)

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    // Find the bot in the database
    const bot = await prisma.botInstance.findFirst({
      where: { userWalletAddress },
    })

    if (!bot) {
      console.log('❌ Bot not found in database for:', userWalletAddress)
      return NextResponse.json(
        { error: 'No bot found for this wallet' },
        { status: 404 }
      )
    }

    // Update the bot to stopped in the database
    const updatedBot = await prisma.botInstance.update({
      where: { id: bot.id },
      data: { isRunning: false },
    })

    console.log('✅ Bot stopped in database for:', userWalletAddress)

    return NextResponse.json({
      success: true,
      message: 'Volume bot stopped successfully',
      status: {
        isRunning: false,
        cumulativeVolume: updatedBot.cumulativeVolume,
        ordersPlaced: updatedBot.ordersPlaced,
        lastOrderTime: updatedBot.lastOrderTime,
      },
    })
  } catch (error) {
    console.error('Error stopping bot:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop bot' },
      { status: 500 }
    )
  }
}
