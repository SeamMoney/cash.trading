/**
 * SDK Test Endpoint
 *
 * Verifies that the @decibeltrade/sdk is working correctly.
 * Also useful for fetching new market addresses after testnet reset.
 *
 * GET /api/sdk-test - Test SDK connectivity and get market info
 */

import { NextResponse } from "next/server";
import { getReadDex, getAllMarketAddresses, TESTNET_CONFIG, MAINNET_CONFIG, getActiveNetwork } from "@/lib/decibel-sdk";
import {
  MARKETS,
  MAINNET_MARKETS,
  DECIBEL_PACKAGE,
  MAINNET_DECIBEL_PACKAGE,
} from "@/lib/decibel-client";
import packageJson from "@/package.json";

export const runtime = 'nodejs';

export async function GET() {
  const net = getActiveNetwork();
  const config = net === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;

  const results: {
    success: boolean;
    sdkVersion: string;
    network: string;
    packageAddress: string;
    packageAddressMatch: boolean;
    marketsCount: number;
    pricesCount: number;
    markets: Array<{ name: string; address: string; hardcodedMatch: boolean | null }>;
    errors: string[];
  } = {
    success: true,
    sdkVersion: packageJson.dependencies["@decibeltrade/sdk"].replace(/^[^\d]*/, ""),
    network: String(config.network),
    packageAddress: config.deployment.package,
    packageAddressMatch: false,
    marketsCount: 0,
    pricesCount: 0,
    markets: [],
    errors: [],
  };

  try {
    const expectedPackage = net === "mainnet" ? MAINNET_DECIBEL_PACKAGE : DECIBEL_PACKAGE;
    const knownMarkets: Record<string, { address: string }> =
      net === "mainnet" ? MAINNET_MARKETS : MARKETS;

    // Check if SDK package address matches our hardcoded one
    results.packageAddressMatch =
      config.deployment.package.toLowerCase() === expectedPackage.toLowerCase();

    // Test 1: Get all markets
    const markets = await getAllMarketAddresses(net);
    results.marketsCount = markets.length;

    // Compare with our hardcoded markets
    results.markets = markets.map((m) => {
      const hardcodedMarket = knownMarkets[m.name];
      return {
        name: m.name,
        address: m.address,
        tickSize: m.tickSize,
        szDecimals: m.szDecimals,
        pxDecimals: m.pxDecimals,
        hardcodedAddress: hardcodedMarket?.address || "NOT_FOUND",
        hardcodedMatch: hardcodedMarket
          ? hardcodedMarket.address.toLowerCase() === m.address.toLowerCase()
          : null,
      };
    });

    // Test 2: Get all prices
    const readDex = getReadDex(net);
    const prices = await readDex.marketPrices.getAll();
    results.pricesCount = Array.isArray(prices) ? prices.length : 0;

    // Check for any mismatched addresses (indicates testnet reset)
    const mismatchedMarkets = results.markets.filter((m) => m.hardcodedMatch === false);
    if (mismatchedMarkets.length > 0) {
      results.errors.push(
        `WARNING: ${mismatchedMarkets.length} markets have different addresses than hardcoded. ` +
          `${net} market constants need review.`
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
