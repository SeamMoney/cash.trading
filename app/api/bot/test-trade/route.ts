import { NextRequest, NextResponse } from 'next/server'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Test endpoint to manually trigger a single trade
 * This bypasses the cron job and lets us test the bot directly
 */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

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

    // Validate configuration without ever logging private-key material.
    if (!process.env.BOT_OPERATOR_PRIVATE_KEY) {
      return NextResponse.json({ error: 'Bot operator not configured' }, { status: 503 })
    }

    // Create bot instance
    console.log('🤖 Creating bot engine instance...')
    const config: BotConfig = {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias: bias as 'long' | 'short' | 'neutral',
      strategy: strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk' | 'tx_spammer' | 'dlp_grid',
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

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
