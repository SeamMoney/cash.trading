/**
 * Market Address Refresh Endpoint
 *
 * After testnet reset, market addresses change. This endpoint:
 * 1. Fetches current market addresses from SDK
 * 2. Updates all running bot instances in the database
 * 3. Returns the new addresses for reference
 *
 * GET /api/markets/refresh - Fetch and update all market addresses
 */

import { NextResponse } from "next/server";
import { getReadDex, getAllMarketAddresses } from "@/lib/decibel-sdk";
import { prisma } from "@/lib/prisma";

export const runtime = 'nodejs';

export async function GET() {
  const results: {
    success: boolean;
    timestamp: string;
    markets: Array<{
      name: string;
      address: string;
      tickSize: number;
      szDecimals: number;
      pxDecimals: number;
      maxLeverage?: number;
    }>;
    updatedBots: number;
    errors: string[];
  } = {
    success: true,
    timestamp: new Date().toISOString(),
    markets: [],
    updatedBots: 0,
    errors: [],
  };

  try {
    // Fetch all markets from SDK
    console.log('🔄 Fetching market addresses from SDK...');
    const markets = await getAllMarketAddresses();

    if (markets.length === 0) {
      results.success = false;
      results.errors.push('No markets returned from SDK - testnet may still be resetting');
      return NextResponse.json(results, { status: 503 });
    }

    // Get max leverage for each market
    const readDex = getReadDex();
    const fullMarkets = await readDex.markets.getAll();

    results.markets = markets.map((m) => {
      const fullMarket = fullMarkets.find((fm: any) => fm.market_name === m.name);
      return {
        ...m,
        maxLeverage: fullMarket?.max_leverage,
      };
    });

    console.log(`✅ Fetched ${results.markets.length} markets from SDK`);

    // Update all running bot instances with new market addresses
    const runningBots = await prisma.botInstance.findMany({
      where: { isRunning: true },
    });

    for (const bot of runningBots) {
      const newMarket = results.markets.find((m) => m.name === bot.marketName);
      if (newMarket && newMarket.address !== bot.market) {
        console.log(`📝 Updating ${bot.marketName} address for bot ${bot.userWalletAddress.slice(0, 10)}...`);
        console.log(`   Old: ${bot.market.slice(0, 20)}...`);
        console.log(`   New: ${newMarket.address.slice(0, 20)}...`);

        await prisma.botInstance.update({
          where: { id: bot.id },
          data: { market: newMarket.address },
        });
        results.updatedBots++;
      }
    }

    if (results.updatedBots > 0) {
      console.log(`✅ Updated ${results.updatedBots} bot instances with new addresses`);
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('❌ Failed to refresh market addresses:', error);
    results.success = false;
    results.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(results, { status: 500 });
  }
}

/**
 * POST /api/markets/refresh - Force refresh a specific market for a bot
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userWalletAddress, userSubaccount, marketName } = body;

    if (!userWalletAddress || !marketName) {
      return NextResponse.json(
        { error: 'Missing userWalletAddress or marketName' },
        { status: 400 }
      );
    }

    // Get market address from SDK
    const markets = await getAllMarketAddresses();
    const market = markets.find((m) => m.name === marketName);

    if (!market) {
      return NextResponse.json(
        { error: `Market ${marketName} not found in SDK` },
        { status: 404 }
      );
    }

    // Update bot instance - use composite key if subaccount provided, otherwise find by id
    let updated;
    if (userSubaccount) {
      updated = await prisma.botInstance.update({
        where: {
          userWalletAddress_userSubaccount: {
            userWalletAddress,
            userSubaccount,
          }
        },
        data: { market: market.address },
      });
    } else {
      // Fallback: find first bot for this wallet and update
      const bot = await prisma.botInstance.findFirst({
        where: { userWalletAddress },
      });
      if (!bot) {
        return NextResponse.json(
          { error: 'No bot found for this wallet' },
          { status: 404 }
        );
      }
      updated = await prisma.botInstance.update({
        where: { id: bot.id },
        data: { market: market.address },
      });
    }

    return NextResponse.json({
      success: true,
      marketName,
      newAddress: market.address,
      botId: updated.id,
    });
  } catch (error) {
    console.error('❌ Failed to refresh market for bot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
