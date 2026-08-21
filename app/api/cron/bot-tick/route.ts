import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'
import { getAllMarketAddresses, getActiveNetwork } from '@/lib/decibel-sdk'
import { secretMatches } from '@/lib/sealed-source-vault'
import { runPersonalStrategyTick } from '@/lib/personal-runner'
import type { BotConfig } from '@/lib/bot-engine'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time

// How many trades to execute per cron invocation for each strategy
const TRADES_PER_CRON: Record<string, number> = {
  tx_spammer: 12,    // ~5 seconds per trade = 12 trades in 60 seconds
  high_risk: 6,      // ~8 seconds per trade = 6-7 trades per minute
  twap: 1,           // TWAP needs time to fill
  market_maker: 2,   // Moderate frequency
  delta_neutral: 1,  // Complex strategy, once per minute
  dlp_grid: 1,       // Quote refresh (can be heavy), keep to 1 per minute
  pine: 1,           // Personal Strategy Runner: at most one closed bar per tick
}

// Delay between trades (ms) to avoid rate limits
const TRADE_DELAY_MS: Record<string, number> = {
  tx_spammer: 4000,   // 4 seconds between trades
  high_risk: 8000,    // 8 seconds between trades
  twap: 0,            // Single trade, no delay
  market_maker: 20000,
  delta_neutral: 0,
  dlp_grid: 0,
  pine: 0,
}

/**
 * Cron job endpoint that executes bot trading logic
 * Called by Vercel Cron every minute
 *
 * For TX Spammer strategy: Executes multiple trades per invocation
 * to maximize volume even when browser is closed
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Verify this is a cron job request. Vercel Cron sends
    // `Authorization: Bearer $CRON_SECRET`; compare in constant time (same
    // helper as the sealed-tick cron) rather than with `!==`.
    const cronSecret = process.env.CRON_SECRET?.trim()
    if (!cronSecret) {
      return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
    }
    const provided = (
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    ).trim()
    if (!secretMatches(provided, cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('⏰ Cron tick: Processing active bots...')

    // Only bots for the chain this deployment actually trades, and only those
    // that are not in failure backoff. Previously this selected on isRunning
    // alone, so a stale testnet row would be ticked against mainnet, and a bot
    // erroring every minute was retried forever.
    const MAX_TICK_FAILURES = 5
    const runningBots = await prisma.botInstance.findMany({
      where: {
        isRunning: true,
        network: getActiveNetwork(),
        tickFailures: { lt: MAX_TICK_FAILURES },
      },
    })

    if (runningBots.length === 0) {
      console.log('No active bots to process')
      return NextResponse.json({ success: true, processed: 0 })
    }

    console.log(`Found ${runningBots.length} active bot(s)`)

    // Load bot operator wallet
    const botPrivateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY
    if (!botPrivateKeyHex) {
      throw new Error('BOT_OPERATOR_PRIVATE_KEY not set')
    }

    const cleanKey = botPrivateKeyHex
      .replace('ed25519-priv-', '')
      .replace(/\\n/g, '')
      .replace(/\n/g, '')
      .trim()
    const botPrivateKey = new Ed25519PrivateKey(cleanKey)
    const botAccount = Account.fromPrivateKey({ privateKey: botPrivateKey })

    console.log('🤖 Bot operator:', botAccount.accountAddress.toString())

    const results: Array<{
      wallet: string
      status: string
      tradesExecuted?: number
      volumeGenerated?: number
      error?: string
      // Personal Strategy Runner ('pine') only
      signal?: 'buy' | 'sell' | 'neutral' | null
      barTs?: number | null
      stage?: string
      txHash?: string
    }> = []

    // Process each bot
    for (const bot of runningBots) {
      try {
        // Check if bot has reached volume target
        if (bot.cumulativeVolume >= bot.volumeTargetUSDC) {
          console.log(`✅ Bot ${bot.userWalletAddress.slice(0, 10)}... reached volume target, stopping`)
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { isRunning: false },
          })
          results.push({ wallet: bot.userWalletAddress, status: 'completed' })
          continue
        }

        // Check if bot has used all capital
        if (bot.currentCapitalUsed >= bot.capitalUSDC) {
          console.log(`💰 Bot ${bot.userWalletAddress.slice(0, 10)}... used all capital, stopping`)
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { isRunning: false },
          })
          results.push({ wallet: bot.userWalletAddress, status: 'out_of_capital' })
          continue
        }

        // Resolve market address from SDK (survives testnet resets)
        let resolvedMarket = bot.market
        try {
          const markets = await getAllMarketAddresses()
          const sdkMarket = markets.find((m) => m.name === bot.marketName)
          if (sdkMarket?.address) {
            if (sdkMarket.address.toLowerCase() !== bot.market.toLowerCase()) {
              console.log(`⚠️  [SDK] Market address changed for ${bot.marketName}! Updating...`)
              await prisma.botInstance.update({
                where: { id: bot.id },
                data: { market: sdkMarket.address },
              })
            }
            resolvedMarket = sdkMarket.address
          }
        } catch (error) {
          console.warn('⚠️  [SDK] Address resolution failed, using stored address')
        }

        // Personal Strategy Runner: one catalog Pine strategy evaluated on the
        // latest closed candle, traded on the user's own subaccount through
        // the operator. The runner owns bar cadence (lastBarTs compare-and-set),
        // so it runs exactly once per invocation (TRADES_PER_CRON.pine = 1)
        // and never enters the multi-trade loop below.
        if (bot.strategy === 'pine') {
          const tick = await runPersonalStrategyTick(
            { ...bot, market: resolvedMarket },
            cleanKey,
          )
          const traded = tick.ok && Boolean(tick.txHash)
          console.log(
            `🧠 pine ${bot.userWalletAddress.slice(0, 10)}... ${bot.strategyId ?? '?'}` +
              ` signal=${tick.signal ?? 'none'} bar=${tick.barTs ?? '-'}` +
              ` stage=${tick.stage ?? '-'} ok=${tick.ok}${tick.txHash ? ` tx=${tick.txHash}` : ''}` +
              (tick.error ? ` error=${tick.error}` : ''),
          )
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: {
              lastTickAt: new Date(),
              // A quiet tick (no new bar, neutral, same side, bar taken by a
              // concurrent ticker) is not a failure; only a real error backs off.
              ...(tick.ok
                ? { tickFailures: 0, error: null }
                : { tickFailures: { increment: 1 }, error: tick.error ?? tick.stage ?? 'tick failed' }),
            },
          })
          results.push({
            wallet: bot.userWalletAddress,
            status: traded ? 'executed' : tick.ok ? 'no_trades' : 'error',
            tradesExecuted: traded ? 1 : 0,
            signal: tick.signal,
            barTs: tick.barTs,
            stage: tick.stage,
            txHash: tick.txHash,
            error: tick.ok ? undefined : tick.error ?? tick.stage ?? 'tick failed',
          })
          continue
        }

        // Import the bot engine
        const { VolumeBotEngine } = await import('@/lib/bot-engine')

        const config: BotConfig = {
          userWalletAddress: bot.userWalletAddress,
          userSubaccount: bot.userSubaccount,
          capitalUSDC: bot.capitalUSDC,
          volumeTargetUSDC: bot.volumeTargetUSDC,
          bias: bot.bias as 'long' | 'short' | 'neutral',
          strategy: bot.strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk' | 'tx_spammer' | 'dlp_grid',
          market: resolvedMarket,
          marketName: bot.marketName,
          leverageX: bot.leverageX ?? undefined,
        }

        const botEngine = new VolumeBotEngine(config)

        // Load lastTwapOrderTime for high_risk strategy
        if (bot.lastTwapOrderTime) {
          botEngine.setLastTwapOrderTime(bot.lastTwapOrderTime)
        }

        // Determine how many trades to execute this cron tick
        const tradesPerCron = TRADES_PER_CRON[bot.strategy] || 1
        const delayMs = TRADE_DELAY_MS[bot.strategy] || 0

        console.log(`🎯 Executing ${tradesPerCron} trade(s) for ${bot.userWalletAddress.slice(0, 10)}... (${bot.strategy})`)

        let tradesExecuted = 0
        let totalVolumeThisCron = 0
        let lastError: string | null = null

        // Execute multiple trades for TX Spammer / High Risk
        for (let i = 0; i < tradesPerCron; i++) {
          // Check time limit - leave 5 seconds buffer
          const elapsed = Date.now() - startTime
          if (elapsed > 55000) {
            console.log(`⏱️ Time limit approaching, stopping after ${tradesExecuted} trades`)
            break
          }

          // Re-fetch bot to check if still running and under target
          const currentBot = await prisma.botInstance.findUnique({
            where: { id: bot.id }
          })

          if (!currentBot || !currentBot.isRunning) {
            console.log(`Bot stopped, ending batch`)
            break
          }

          if (currentBot.cumulativeVolume >= currentBot.volumeTargetUSDC) {
            console.log(`Volume target reached, stopping bot`)
            await prisma.botInstance.update({
              where: { id: bot.id },
              data: { isRunning: false },
            })
            break
          }

          try {
            const success = await botEngine.executeSingleTrade()

            if (success) {
              tradesExecuted++
              // Fetch updated volume
              const updatedBot = await prisma.botInstance.findUnique({
                where: { id: bot.id }
              })
              if (updatedBot) {
                totalVolumeThisCron = updatedBot.cumulativeVolume - bot.cumulativeVolume
              }
              console.log(`   ✅ Trade ${i + 1}/${tradesPerCron} success`)
            } else {
              console.log(`   ⚠️ Trade ${i + 1}/${tradesPerCron} returned false`)
            }
          } catch (tradeError) {
            lastError = tradeError instanceof Error ? tradeError.message : 'Trade failed'
            console.error(`   ❌ Trade ${i + 1}/${tradesPerCron} error:`, lastError)

            // If rate limited, wait longer
            if (lastError.includes('429') || lastError.includes('rate')) {
              console.log(`   ⏳ Rate limited, waiting 10s...`)
              await new Promise(r => setTimeout(r, 10000))
            }
          }

          // Delay between trades (except for last trade)
          if (i < tradesPerCron - 1 && delayMs > 0) {
            await new Promise(r => setTimeout(r, delayMs))
          }
        }

        // Persist lastTwapOrderTime for high_risk strategy
        const newTwapTime = botEngine.getLastTwapOrderTime()
        if (newTwapTime) {
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { lastTwapOrderTime: newTwapTime },
          })
        }

        if (tradesExecuted > 0) {
          console.log(`✅ Executed ${tradesExecuted} trades, +$${totalVolumeThisCron.toFixed(0)} volume`)
          // A productive tick clears the failure streak.
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { lastTickAt: new Date(), tickFailures: 0 },
          })
          results.push({
            wallet: bot.userWalletAddress,
            status: 'executed',
            tradesExecuted,
            volumeGenerated: totalVolumeThisCron,
          })
        } else {
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: {
              lastTickAt: new Date(),
              // Only a real error counts toward backoff; a quiet tick (cooldown,
              // no signal) is not a failure.
              ...(lastError ? { tickFailures: { increment: 1 } } : {}),
            },
          })
          results.push({
            wallet: bot.userWalletAddress,
            status: lastError ? 'error' : 'no_trades',
            error: lastError || undefined,
          })
        }
      } catch (error) {
        console.error(`Error processing bot ${bot.userWalletAddress.slice(0, 10)}...:`, error)

        // Update bot with error. After MAX_TICK_FAILURES consecutive failures
        // this bot drops out of the cron's selection entirely rather than
        // retrying 6-12 times a minute forever.
        await prisma.botInstance.update({
          where: { id: bot.id },
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
            lastTickAt: new Date(),
            tickFailures: { increment: 1 },
          },
        })

        results.push({
          wallet: bot.userWalletAddress,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const totalElapsed = Date.now() - startTime
    console.log(`⏰ Cron completed in ${(totalElapsed / 1000).toFixed(1)}s`)

    return NextResponse.json({
      success: true,
      processed: results.length,
      executionTimeMs: totalElapsed,
      results,
    })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Cron job failed',
      },
      { status: 500 }
    )
  }
}
