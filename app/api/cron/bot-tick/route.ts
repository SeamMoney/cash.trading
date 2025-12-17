import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } from '@aptos-labs/ts-sdk'
import { getAllMarketAddresses } from '@/lib/decibel-sdk'
import type { BotConfig } from '@/lib/bot-engine'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 seconds max execution time

/**
 * Cron job endpoint that executes bot trading logic
 * Called by Vercel Cron every minute
 *
 * This replaces the continuous bot loop with a stateless cron-based approach
 * suitable for serverless deployment
 */
export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron job request
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('⏰ Cron tick: Processing active bots...')

    // Get all running bots from database
    const runningBots = await prisma.botInstance.findMany({
      where: { isRunning: true },
    })

    if (runningBots.length === 0) {
      console.log('No active bots to process')
      return NextResponse.json({ success: true, processed: 0 })
    }

    console.log(`Found ${runningBots.length} active bot(s)`)

    // Initialize Aptos SDK
    const aptosConfig = new AptosConfig({ network: Network.TESTNET })
    const aptos = new Aptos(aptosConfig)

    // Load bot operator wallet
    const botPrivateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY
    if (!botPrivateKeyHex) {
      throw new Error('BOT_OPERATOR_PRIVATE_KEY not set')
    }

    const cleanKey = botPrivateKeyHex.replace('ed25519-priv-', '')
    const botPrivateKey = new Ed25519PrivateKey(cleanKey)
    const botAccount = Account.fromPrivateKey({ privateKey: botPrivateKey })

    console.log('🤖 Bot operator:', botAccount.accountAddress.toString())

    const results = []

    // Process each bot
    for (const bot of runningBots) {
      try {
        // Check if bot has reached volume target
        if (bot.cumulativeVolume >= bot.volumeTargetUSDC) {
          console.log(`✅ Bot ${bot.userWalletAddress} reached volume target, stopping`)
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { isRunning: false },
          })
          results.push({ wallet: bot.userWalletAddress, status: 'completed' })
          continue
        }

        // Check if bot has used all capital
        if (bot.currentCapitalUsed >= bot.capitalUSDC) {
          console.log(`💰 Bot ${bot.userWalletAddress} used all capital, stopping`)
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { isRunning: false },
          })
          results.push({ wallet: bot.userWalletAddress, status: 'out_of_capital' })
          continue
        }

        // Execute trade based on strategy
        console.log(`🎯 Executing trade for ${bot.userWalletAddress} (${bot.strategy})`)

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

        // Import the bot engine to execute a single trade
        const { VolumeBotEngine } = await import('@/lib/bot-engine')

        const config: BotConfig = {
          userWalletAddress: bot.userWalletAddress,
          userSubaccount: bot.userSubaccount,
          capitalUSDC: bot.capitalUSDC,
          volumeTargetUSDC: bot.volumeTargetUSDC,
          bias: bot.bias as 'long' | 'short' | 'neutral',
          strategy: bot.strategy as 'twap' | 'market_maker' | 'delta_neutral' | 'high_risk',
          market: resolvedMarket,
          marketName: bot.marketName,
        }

        const botEngine = new VolumeBotEngine(config)

        // Execute one trading cycle
        const success = await botEngine.executeSingleTrade()

        if (success) {
          console.log(`✅ Successfully executed trade for ${bot.userWalletAddress}`)
          results.push({ wallet: bot.userWalletAddress, status: 'executed' })
        } else {
          console.log(`❌ Failed to execute trade for ${bot.userWalletAddress}`)
          results.push({ wallet: bot.userWalletAddress, status: 'failed' })
        }
      } catch (error) {
        console.error(`Error processing bot ${bot.userWalletAddress}:`, error)

        // Update bot with error
        await prisma.botInstance.update({
          where: { id: bot.id },
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        })

        results.push({
          wallet: bot.userWalletAddress,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
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
