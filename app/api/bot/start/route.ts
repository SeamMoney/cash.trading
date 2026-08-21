import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { VolumeBotEngine, BotConfig } from '@/lib/bot-engine'
import { botManager } from '@/lib/bot-manager'
import { prisma } from '@/lib/prisma'
import { getAllMarketAddresses, getActiveNetwork } from '@/lib/decibel-sdk'
import { denyUnlessBotOwner } from '@/lib/bot-owner-guard'
import { checkRateLimitForKey } from '@/lib/api-rate-limit'
import { findCatalogStrategy } from '@/lib/sealed-catalog'
import { canonicalizePine } from '@/lib/sealed-presets'
import { isClosedBarInterval } from '@/lib/decibel-candles'
import { isValidAptosAddress } from '@/lib/decibel'

export const runtime = 'nodejs'

/**
 * Ceiling on leverage a bot may be started with.
 *
 * The Personal Strategy Runner trades a user's own subaccount off a signal
 * nobody is watching in real time, so it gets a low ceiling (3x) even when the
 * env var is unset. The older strategies keep their existing behaviour — no
 * ceiling unless one is configured — because they were shipped that way and
 * this route is not the place to silently retune them.
 */
const PINE_DEFAULT_MAX_LEVERAGE_X = 3

function maxLeverageFor(strategy: string): number | null {
  const configured = Number(process.env.BOT_MAX_LEVERAGE_X ?? '')
  if (Number.isFinite(configured) && configured > 0) return configured
  return strategy === 'pine' ? PINE_DEFAULT_MAX_LEVERAGE_X : null
}

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

    // Personal Strategy Runner fields. They are not part of BotConfig — the
    // engine never sees them; the cron runner reads them off the row.
    const {
      strategyId,
      barInterval,
      stopLossPct,
      takeProfitPct,
    } = body as {
      strategyId?: unknown
      barInterval?: unknown
      stopLossPct?: unknown
      takeProfitPct?: unknown
    }

    // `strategy` is optional in the body (the column has a default), so widen
    // it once here rather than repeating the `?? ''` at every comparison.
    const strategyName: string = String(strategy ?? '')

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
    const KNOWN_STRATEGIES = ['twap', 'market_maker', 'delta_neutral', 'high_risk', 'tx_spammer', 'dlp_grid', 'pine']
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

    // Personal Strategy Runner: pin what the cron will evaluate. The id alone
    // is not enough — a later catalog edit would silently change what a running
    // bot trades — so the canonical script text is hashed and stored with it.
    let pineStrategyId: string | null = null
    let pineScriptHash: string | null = null
    let pineBarInterval: string | null = null
    if (strategyName === 'pine') {
      if (typeof strategyId !== 'string' || !strategyId.trim()) {
        return NextResponse.json(
          { error: 'Missing strategyId: a pine bot must name a catalog strategy' },
          { status: 400 }
        )
      }
      const catalogStrategy = findCatalogStrategy(strategyId.trim())
      if (!catalogStrategy) {
        return NextResponse.json(
          { error: `Unknown strategyId '${strategyId}'` },
          { status: 400 }
        )
      }
      const interval = barInterval ?? '1m'
      if (!isClosedBarInterval(interval)) {
        return NextResponse.json(
          { error: 'barInterval must be one of 1m, 5m, 15m' },
          { status: 400 }
        )
      }
      pineStrategyId = catalogStrategy.id
      pineBarInterval = interval
      pineScriptHash = createHash('sha256')
        .update(canonicalizePine(catalogStrategy.script), 'utf8')
        .digest('hex')
    }

    // Per-bot exits are fractions of price (0.02 = 2%), the same unit the
    // engine's HIGH_RISK_EXITS uses. Reject anything outside a sane band rather
    // than letting a mistyped `2` become a 200% stop that can never trigger.
    for (const [field, value] of [
      ['stopLossPct', stopLossPct],
      ['takeProfitPct', takeProfitPct],
    ] as const) {
      if (value === undefined || value === null) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 0.5) {
        return NextResponse.json(
          { error: `${field} must be a fraction between 0 and 0.5 (0.02 = 2%)` },
          { status: 400 }
        )
      }
    }

    // Server-side leverage ceiling, alongside the capital ceiling above.
    const maxLeverageX = maxLeverageFor(strategyName)
    if (leverageX !== undefined && leverageX !== null) {
      if (!Number.isInteger(leverageX) || leverageX < 1) {
        return NextResponse.json(
          { error: 'leverageX must be a positive whole number' },
          { status: 400 }
        )
      }
      if (maxLeverageX !== null && leverageX > maxLeverageX) {
        return NextResponse.json(
          { error: `Leverage exceeds the configured ceiling of ${maxLeverageX}x` },
          { status: 400 }
        )
      }
    } else if (strategyName === 'pine') {
      // Never inferred: the runner clamps a self-sizing script DOWN to this
      // number, so omitting it would hand the script the engine default (5x),
      // above the ceiling this route just enforced.
      return NextResponse.json(
        { error: 'leverageX is required for the pine strategy' },
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

    // The runner fetches candles for this address and signs orders against it.
    // A fallback that was never a market address would only surface as a failed
    // transaction a minute later, on the user's own subaccount.
    if (strategyName === 'pine' && !isValidAptosAddress(resolvedMarket)) {
      return NextResponse.json(
        { error: `Could not resolve a market address for '${marketName}'` },
        { status: 400 }
      )
    }

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
        strategyId: pineStrategyId,
        scriptHash: pineScriptHash,
        barInterval: pineBarInterval,
        stopLossPct: typeof stopLossPct === 'number' ? stopLossPct : null,
        takeProfitPct: typeof takeProfitPct === 'number' ? takeProfitPct : null,
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
        // Pine config is rewritten on every start (null for other strategies)
        // so a row reused for a different strategy cannot carry a stale script.
        strategyId: pineStrategyId,
        scriptHash: pineScriptHash,
        barInterval: pineBarInterval,
        stopLossPct: typeof stopLossPct === 'number' ? stopLossPct : null,
        takeProfitPct: typeof takeProfitPct === 'number' ? takeProfitPct : null,
        // A new session starts from a fresh bar cursor: the compare-and-set in
        // the runner is `lastBarTs < newBarTs`, and a stale cursor from a
        // previous run would otherwise decide which bars this one may act on.
        lastBarTs: null,
        lastSignal: null,
        lastSignalAt: null,
      },
    })

    // Pine bots are cron-driven. Starting the engine's in-process interval loop
    // here would add a second, unsynchronised driver on a serverless instance
    // that gets frozen between requests; runPersonalStrategyTick owns cadence
    // through the lastBarTs compare-and-set.
    if (strategyName === 'pine') {
      console.log('✅ Personal strategy runner started (cron-driven):', botInstance.id)
      return NextResponse.json({
        success: true,
        message: 'Personal strategy runner started',
        status: {
          isRunning: true,
          cumulativeVolume: 0,
          ordersPlaced: 0,
          lastSignal: null,
          lastSignalAt: null,
          lastBarTs: null,
        },
        config: {
          userWalletAddress,
          userSubaccount,
          capitalUSDC,
          volumeTargetUSDC,
          bias,
          strategy: strategyName,
          market: resolvedMarket,
          marketName,
          leverageX,
          strategyId: pineStrategyId,
          scriptHash: pineScriptHash,
          barInterval: pineBarInterval,
          stopLossPct: typeof stopLossPct === 'number' ? stopLossPct : null,
          takeProfitPct: typeof takeProfitPct === 'number' ? takeProfitPct : null,
        },
      })
    }

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
