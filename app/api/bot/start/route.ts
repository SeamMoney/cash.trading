import { NextRequest, NextResponse } from 'next/server'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'
import { botManager } from '@/lib/bot-manager'
import { prisma } from '@/lib/prisma'
import { getAllMarketAddresses, getActiveNetwork } from '@/lib/decibel-sdk'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'
import { checkRateLimitForKey } from '@/lib/api-rate-limit'

export const runtime = 'nodejs'

/**
 * Resolve market address from SDK (survives testnet resets)
 * Falls back to provided address if SDK fails
 */
async function resolveMarketAddress(marketName: string, fallbackAddress: string): Promise<string> {
  try {
    console.log(`🔍 [SDK] Resolving address for ${marketName}...`)
    const markets = await getAllMarketAddresses()
    const market = markets.find((m) => m.name === marketName)

    if (market?.address) {
      if (market.address.toLowerCase() !== fallbackAddress.toLowerCase()) {
        console.log(`⚠️  [SDK] Address changed for ${marketName}!`)
        console.log(`   Old: ${fallbackAddress.slice(0, 20)}...`)
        console.log(`   New: ${market.address.slice(0, 20)}...`)
      }
      console.log(`✅ [SDK] Using address: ${market.address.slice(0, 20)}...`)
      return market.address
    }
  } catch (error) {
    console.warn(`⚠️  [SDK] Failed to resolve ${marketName}, using fallback:`, error)
  }
  return fallbackAddress
}

export async function POST(request: NextRequest) {
  // Authorization happens after the body is parsed, because it is the body that
  // names the wallet and subaccount being acted on. See lib/bot-owner-guard.ts.
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
      leverageX,
    } = body as BotConfig

    console.log('📥 Received userWalletAddress:', typeof userWalletAddress, userWalletAddress)

    // Validate inputs
    if (!userWalletAddress || !userSubaccount) {
      return NextResponse.json(
        { error: 'Missing required fields: userWalletAddress, userSubaccount' },
        { status: 400 }
      )
    }

    // Allowlisted wallet AND on-chain proof it owns this subaccount, before we
    // hand the operator key anything to trade.
    const denied = await denyUnlessBotOwner({ walletAddress: userWalletAddress, subaccount: userSubaccount })
    if (denied) return denied

    // Keyed by wallet, not IP: the authorized identity is the thing worth
    // bounding, and these routes sign real orders.
    const rate = checkRateLimitForKey('bot-start', String(userWalletAddress).toLowerCase(), 6, 60000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfterS: rate.retryAfterS },
        { status: 429 },
      )
    }

    if (capitalUSDC <= 0 || volumeTargetUSDC <= 0) {
      return NextResponse.json(
        { error: 'Capital and volume target must be positive' },
        { status: 400 }
      )
    }

    // Server-side ceiling. The UI number stays authoritative below this, but a
    // mistyped amount or a client bug cannot commit more than the operator has
    // decided to risk. Unset means no ceiling (local development).
    const maxCapital = Number(process.env.BOT_MAX_CAPITAL_USDC ?? '')
    if (Number.isFinite(maxCapital) && maxCapital > 0 && capitalUSDC > maxCapital) {
      return NextResponse.json(
        { error: `Capital exceeds the configured ceiling of ${maxCapital} USDC` },
        { status: 400 }
      )
    }

    // `strategy` reached the DB unvalidated; an unknown value silently became
    // 'twap' deep inside the engine's dispatch.
    const KNOWN_STRATEGIES = ['twap', 'market_maker', 'delta_neutral', 'high_risk', 'tx_spammer', 'dlp_grid']
    if (strategy && !KNOWN_STRATEGIES.includes(strategy)) {
      return NextResponse.json(
        { error: `Unknown strategy '${strategy}'` },
        { status: 400 }
      )
    }

    if (!['long', 'short', 'neutral'].includes(bias)) {
      return NextResponse.json(
        { error: 'Bias must be long, short, or neutral' },
        { status: 400 }
      )
    }

    // Check if bot already running for this subaccount - trust database as source of truth
    const existingBot = await prisma.botInstance.findUnique({
      where: {
        userWalletAddress_userSubaccount: {
          userWalletAddress,
          userSubaccount,
        }
      },
    })

    if (existingBot?.isRunning) {
      return NextResponse.json(
        { error: 'Bot already running for this subaccount. Stop it first.' },
        { status: 409 }
      )
    }

    // Bot manager key includes subaccount for multi-bot support
    const botKey = `${userWalletAddress}_${userSubaccount}`

    // Clean up stale in-memory bot if database says it's not running
    if (botManager.hasBot(botKey) && !existingBot?.isRunning) {
      console.log('🧹 Cleaning up stale in-memory bot for', botKey)
      botManager.deleteBot(botKey)
    }

    // CRITICAL: Resolve market address from SDK (survives testnet resets!)
    const resolvedMarket = await resolveMarketAddress(marketName, market)

    // Generate a new session ID for this bot run
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // Create or update bot in database (with resolved market address)
    const botInstance = await prisma.botInstance.upsert({
      where: {
        userWalletAddress_userSubaccount: {
          userWalletAddress,
          userSubaccount,
        }
      },
      create: {
        userWalletAddress,
        userSubaccount,
        capitalUSDC,
        volumeTargetUSDC,
        bias,
        strategy,
        market: resolvedMarket,
        marketName,
        isRunning: true,
        sessionId,
        network: getActiveNetwork(),
        leverageX,
      },
      update: {
        capitalUSDC,
        volumeTargetUSDC,
        bias,
        strategy,
        market: resolvedMarket,
        marketName,
        isRunning: true,
        network: getActiveNetwork(),
        leverageX,
        tickFailures: 0,
        cumulativeVolume: 0,
        ordersPlaced: 0,
        currentCapitalUsed: 0,
        error: null,
        sessionId,  // New session for each start
        lastTwapOrderTime: null,  // Reset TWAP tracking on new session
      },
    })

    // Create and start bot engine (using resolved market address)
    const config: BotConfig = {
      userWalletAddress,
      userSubaccount,
      capitalUSDC,
      volumeTargetUSDC,
      bias,
      strategy,
      market: resolvedMarket,
      marketName,
      leverageX,
    }

    const bot = new VolumeBotEngine(config)
    await bot.start()

    // Store bot instance in memory (using combined key for multi-bot support)
    botManager.setBot(botKey, bot)

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
