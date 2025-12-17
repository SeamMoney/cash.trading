/**
 * SDK Test Endpoint
 *
 * Verifies that the @decibeltrade/sdk is working correctly.
 * Also useful for fetching new market addresses after testnet reset.
 *
 * GET /api/sdk-test - Test SDK connectivity and get market info
 */

import { NextResponse } from "next/server";
import { getReadDex, getAllMarketAddresses, TESTNET_CONFIG } from "@/lib/decibel-sdk";
import { MARKETS, DECIBEL_PACKAGE } from "@/lib/decibel-client";

export const runtime = 'nodejs';

export async function GET() {
  const results: {
    success: boolean;
    sdkVersion: string;
    network: string;
    packageAddress: string;
    packageAddressMatch: boolean;
    marketsCount: number;
    pricesCount: number;
    markets: Array<{ name: string; address: string; hardcodedMatch: boolean }>;
    errors: string[];
  } = {
    success: true,
    sdkVersion: "0.2.1",
    network: String(TESTNET_CONFIG.network),
    packageAddress: TESTNET_CONFIG.deployment.package,
    packageAddressMatch: false,
    marketsCount: 0,
    pricesCount: 0,
    markets: [],
    errors: [],
  };

  try {
    // Check if SDK package address matches our hardcoded one
    results.packageAddressMatch =
      TESTNET_CONFIG.deployment.package.toLowerCase() === DECIBEL_PACKAGE.toLowerCase();

    // Test 1: Get all markets
    const markets = await getAllMarketAddresses();
    results.marketsCount = markets.length;

    // Compare with our hardcoded markets
    results.markets = markets.map((m) => {
      const hardcodedMarket = MARKETS[m.name as keyof typeof MARKETS];
      return {
        name: m.name,
        address: m.address,
        tickSize: m.tickSize,
        szDecimals: m.szDecimals,
        pxDecimals: m.pxDecimals,
        hardcodedAddress: hardcodedMarket?.address || "NOT_FOUND",
        hardcodedMatch: hardcodedMarket?.address?.toLowerCase() === m.address.toLowerCase(),
      };
    });

    // Test 2: Get all prices
    const readDex = getReadDex();
    const prices = await readDex.marketPrices.getAll();
    results.pricesCount = Array.isArray(prices) ? prices.length : 0;

    // Check for any mismatched addresses (indicates testnet reset)
    const mismatchedMarkets = results.markets.filter((m) => !m.hardcodedMatch);
    if (mismatchedMarkets.length > 0) {
      results.errors.push(
        `WARNING: ${mismatchedMarkets.length} markets have different addresses than hardcoded. ` +
          `Testnet may have been reset! Update lib/decibel-client.ts and lib/bot-engine.ts`
      );
      // Still consider it a success - just a warning
    }
  } catch (error) {
    results.success = false;
    results.errors.push(error instanceof Error ? error.message : "Unknown error");
  }

  return NextResponse.json(results, {
    status: results.success ? 200 : 500,
  });
}
