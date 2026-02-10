#!/usr/bin/env node
/**
 * Decibrrr Bot Runner
 *
 * Persistent bot execution service for Digital Ocean
 * Polls database for active bots and executes trades autonomously
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Tick intervals per strategy (milliseconds)
const TICK_INTERVALS = {
  tx_spammer: 4000,    // 4 seconds - rapid fire
  high_risk: 5000,     // 5 seconds - fast for TP/SL monitoring
  twap: 60000,         // 60 seconds - TWAP needs time to fill
  market_maker: 30000, // 30 seconds
  delta_neutral: 60000,// 60 seconds
  dlp_grid: 60000,     // 60 seconds - quote refresh cadence
};

// Track last tick time per bot
const lastTickTime = new Map();

// Track if a bot is currently executing (prevent overlap)
const executingBots = new Set();

console.log('🚀 Decibrrr Bot Runner starting...');
console.log(`   Database: ${process.env.DATABASE_URL?.slice(0, 30)}...`);

/**
 * Execute a single trade for a bot
 */
async function executeBotTrade(bot) {
  const botId = bot.id;

  // Prevent overlapping execution
  if (executingBots.has(botId)) {
    return;
  }

  executingBots.add(botId);

  try {
    // Dynamically import the bot engine (ESM module)
    const { VolumeBotEngine } = await import('../lib/bot-engine.ts');
    const { getAllMarketAddresses } = await import('../lib/decibel-sdk.ts');

    // Resolve market address from SDK
    let resolvedMarket = bot.market;
    try {
      const markets = await getAllMarketAddresses();
      const sdkMarket = markets.find((m) => m.name === bot.marketName);
      if (sdkMarket?.address) {
        if (sdkMarket.address.toLowerCase() !== bot.market.toLowerCase()) {
          console.log(`⚠️  Market address changed for ${bot.marketName}, updating...`);
          await prisma.botInstance.update({
            where: { id: bot.id },
            data: { market: sdkMarket.address },
          });
        }
        resolvedMarket = sdkMarket.address;
      }
    } catch (err) {
      console.warn('SDK address resolution failed, using stored address');
    }

    const config = {
      userWalletAddress: bot.userWalletAddress,
      userSubaccount: bot.userSubaccount,
      capitalUSDC: bot.capitalUSDC,
      volumeTargetUSDC: bot.volumeTargetUSDC,
      bias: bot.bias,
      strategy: bot.strategy,
      market: resolvedMarket,
      marketName: bot.marketName,
    };

    const engine = new VolumeBotEngine(config);

    // Load lastTwapOrderTime for high_risk strategy
    if (bot.lastTwapOrderTime) {
      engine.setLastTwapOrderTime(bot.lastTwapOrderTime);
    }

    console.log(`⚡ [${bot.userWalletAddress.slice(0, 8)}...] Executing ${bot.strategy} on ${bot.marketName}`);

    const success = await engine.executeSingleTrade();

    // Persist lastTwapOrderTime
    const newTwapTime = engine.getLastTwapOrderTime();
    if (newTwapTime) {
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { lastTwapOrderTime: newTwapTime },
      });
    }

    // Check if volume target reached
    const updatedBot = await prisma.botInstance.findUnique({
      where: { id: bot.id }
    });

    if (updatedBot && updatedBot.cumulativeVolume >= updatedBot.volumeTargetUSDC) {
      console.log(`🎯 [${bot.userWalletAddress.slice(0, 8)}...] Volume target reached! Stopping bot.`);
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { isRunning: false },
      });
    }

    if (success) {
      console.log(`✅ [${bot.userWalletAddress.slice(0, 8)}...] Trade executed`);
    }

  } catch (error) {
    console.error(`❌ [${bot.userWalletAddress.slice(0, 8)}...] Error:`, error.message);

    // Update bot with error
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { error: error.message },
    });
  } finally {
    executingBots.delete(botId);
    lastTickTime.set(botId, Date.now());
  }
}

/**
 * Main loop - polls for active bots and executes trades
 */
async function mainLoop() {
  while (true) {
    try {
      // Get all running bots
      const runningBots = await prisma.botInstance.findMany({
        where: { isRunning: true },
      });

      if (runningBots.length === 0) {
        // No bots running, wait longer
        await sleep(5000);
        continue;
      }

      // Process each bot
      for (const bot of runningBots) {
        const interval = TICK_INTERVALS[bot.strategy] || 30000;
        const lastTick = lastTickTime.get(bot.id) || 0;
        const timeSinceLastTick = Date.now() - lastTick;

        // Check if enough time has passed for this bot
        if (timeSinceLastTick >= interval) {
          // Execute in background (don't await)
          executeBotTrade(bot).catch(err => {
            console.error(`Unhandled error for bot ${bot.id}:`, err);
          });
        }
      }

      // Small sleep to prevent tight loop
      await sleep(1000);

    } catch (error) {
      console.error('Main loop error:', error);
      await sleep(5000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down bot runner...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start the main loop
mainLoop().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
