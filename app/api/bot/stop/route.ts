import { NextRequest, NextResponse } from 'next/server'
import { botManager } from '@/lib/bot-manager'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userWalletAddress } = body

    console.log('🛑 Stop request for wallet:', userWalletAddress)
    console.log('📋 Active bots:', Array.from(botManager['activeBots'].keys()))

    if (!userWalletAddress) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress' },
        { status: 400 }
      )
    }

    const bot = botManager.getBot(userWalletAddress)

    if (!bot) {
      console.log('❌ Bot not found in memory for:', userWalletAddress)
      return NextResponse.json(
        { error: 'No active bot found for this wallet' },
        { status: 404 }
      )
    }

    // Stop the bot (this now updates the database internally)
    await bot.stop()

    // Remove from active bots in memory
    botManager.deleteBot(userWalletAddress)

    console.log('✅ Bot stopped and removed from memory for:', userWalletAddress)

    return NextResponse.json({
      success: true,
      message: 'Volume bot stopped successfully',
      status: bot.getStatus(),
    })
  } catch (error) {
    console.error('Error stopping bot:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop bot' },
      { status: 500 }
    )
  }
}
