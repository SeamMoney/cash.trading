/**
 * Decibel SDK Singleton
 *
 * This module provides initialized SDK instances for read/write operations.
 * Uses @decibeltrade/sdk v0.2.1
 *
 * Configuration from dev chat:
 * - noFeePayer: true (fee payer had issues)
 * - skipSimulate: true (faster)
 *
 * @see https://docs.decibel.trade/typescript-sdk/overview
 */

import { DecibelReadDex, DecibelWriteDex, TESTNET_CONFIG } from "@decibeltrade/sdk";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

// Singleton instances
let readDex: DecibelReadDex | null = null;
let writeDex: DecibelWriteDex | null = null;

/**
 * Get the DecibelReadDex singleton instance
 * Used for: markets, prices, account overview, positions, orders
 */
export function getReadDex(): DecibelReadDex {
  if (!readDex) {
    readDex = new DecibelReadDex(TESTNET_CONFIG, {
      nodeApiKey: process.env.APTOS_NODE_API_KEY,
      onWsError: (error) => {
        console.error("[SDK] WebSocket error:", error);
      },
    });
  }
  return readDex;
}

/**
 * Get the DecibelWriteDex singleton instance
 * Used for: placing orders, TP/SL, cancellations, delegation
 *
 * NOTE: Uses bot operator account from environment
 */
export function getWriteDex(): DecibelWriteDex {
  if (!writeDex) {
    const privateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY;
    if (!privateKeyHex) {
      throw new Error("BOT_OPERATOR_PRIVATE_KEY not set");
    }

    // Clean the key (remove prefix if present)
    const cleanKey = privateKeyHex
      .replace("ed25519-priv-", "")
      .replace(/\\n/g, "")
      .replace(/\n/g, "")
      .trim();

    const privateKey = new Ed25519PrivateKey(cleanKey);
    const account = Account.fromPrivateKey({ privateKey });

    // Use working config from dev chat
    // noFeePayer: true because fee payer service had issues
    // skipSimulate: true for faster transactions
    writeDex = new DecibelWriteDex(TESTNET_CONFIG, account, {
      nodeApiKey: process.env.APTOS_NODE_API_KEY,
      skipSimulate: true,
      noFeePayer: true,
    });
  }
  return writeDex;
}

/**
 * Get a WriteDex instance with a custom account (for user-specific operations)
 * Used when bot needs to act on behalf of a specific user's delegation
 */
export function getWriteDexForAccount(privateKeyHex: string): DecibelWriteDex {
  const cleanKey = privateKeyHex
    .replace("ed25519-priv-", "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();

  const privateKey = new Ed25519PrivateKey(cleanKey);
  const account = Account.fromPrivateKey({ privateKey });

  return new DecibelWriteDex(TESTNET_CONFIG, account, {
    nodeApiKey: process.env.APTOS_NODE_API_KEY,
    skipSimulate: true,
    noFeePayer: true,
  });
}

/**
 * Utility: Get market address from market name using SDK
 * Falls back to null if not found
 */
export async function getMarketAddressFromSDK(marketName: string): Promise<string | null> {
  try {
    const readDex = getReadDex();
    const markets = await readDex.markets.getAll();
    const market = markets.find((m) => m.market_name === marketName);
    return market?.market_addr || null;
  } catch (error) {
    console.warn("[SDK] Failed to get market address:", error);
    return null;
  }
}

/**
 * Utility: Get all market addresses from SDK
 * Useful after testnet reset to update hardcoded values
 */
export async function getAllMarketAddresses(): Promise<
  Array<{ name: string; address: string; tickSize: number; szDecimals: number; pxDecimals: number }>
> {
  try {
    const readDex = getReadDex();
    const markets = await readDex.markets.getAll();
    return markets.map((m) => ({
      name: m.market_name,
      address: m.market_addr,
      tickSize: m.tick_size,
      szDecimals: m.sz_decimals,
      pxDecimals: m.px_decimals,
    }));
  } catch (error) {
    console.error("[SDK] Failed to get markets:", error);
    return [];
  }
}

// Export config for reference
export { TESTNET_CONFIG };
