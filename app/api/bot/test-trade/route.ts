import { NextRequest, NextResponse } from 'next/server'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Test endpoint to manually trigger a single trade
 * This bypasses the cron job and lets us test the bot directly
 */
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

    console.log('🧪 TEST TRADE ENDPOINT CALLED')
    console.log('📋 Config:', {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias,
      market,
      marketName,
      strategy,
    })

    // Validate env vars
    console.log('🔍 Checking environment variables...')
    const botKey = process.env.BOT_OPERATOR_PRIVATE_KEY
    console.log('BOT_OPERATOR_PRIVATE_KEY exists:', !!botKey)
    console.log('BOT_OPERATOR_PRIVATE_KEY length:', botKey?.length || 0)
    console.log('BOT_OPERATOR_PRIVATE_KEY preview:', botKey?.substring(0, 30) + '...')

    // Create bot instance
    console.log('🤖 Creating bot engine instance...')
    const config: BotConfig = {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias: bias as 'long' | 'short' | 'neutral',
      strategy: strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk',
      market,
      marketName,
    }

    const bot = new VolumeBotEngine(config)
    console.log('✅ Bot engine created')

    // Get initial status
    const statusBefore = bot.getStatus()
    console.log('📊 Status before trade:', statusBefore)

    // Execute single trade
    console.log('🎯 Executing single trade...')
    const success = await bot.executeSingleTrade()
    console.log('Trade execution result:', success)

    // Get final status
    const statusAfter = bot.getStatus()
    console.log('📊 Status after trade:', statusAfter)

    return NextResponse.json({
      success,
      statusBefore,
      statusAfter,
      message: success ? 'Trade executed successfully' : 'Trade execution failed',
    })
  } catch (error) {
    console.error('❌ TEST TRADE ERROR:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
