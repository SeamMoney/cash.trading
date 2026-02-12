/**
 * Decibel SDK Singleton
 *
 * This module provides initialized SDK instances for read/write operations.
 * Uses @decibeltrade/sdk v0.2.9
 *
 * Configuration from dev chat:
 * - noFeePayer: true (fee payer had issues)
 * - skipSimulate: true (faster)
 *
 * Updated Feb 11, 2026:
 * - New contract address after testnet reset
 * - New orderbook types package
 * - trigger_matching renamed to process_perp_market_pending_requests
 *
 * @see https://docs.decibel.trade/typescript-sdk/overview
 */

import { DecibelReadDex, DecibelWriteDex, TESTNET_CONFIG, type DecibelConfig } from "@decibeltrade/sdk";
import { Account, Ed25519PrivateKey, Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

// Custom config with updated contract addresses (Feb 11, 2026 - testnet reset)
// Override SDK's TESTNET_CONFIG with new package address
// Note: orderbook types package is 0xb4e85b1328eeba5398a62585d9c15e55980f9c8acefbbe484b8232ddad0cc6c7
// but SDK Deployment type only has: package, usdc, testc, perpEngineGlobal
const CUSTOM_TESTNET_CONFIG: DecibelConfig = {
  ...TESTNET_CONFIG,
  deployment: {
    ...TESTNET_CONFIG.deployment,
    package: "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f",
  },
};

// Singleton instances
let readDex: DecibelReadDex | null = null;
let writeDex: DecibelWriteDex | null = null;

// Get API key - try APTOS_NODE_API_KEY first, fall back to GEOMI_API_KEY
// Clean the key to remove any newlines or whitespace that could cause header errors
const getNodeApiKey = () => {
  const key = process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY;
  return key?.replace(/\\n/g, '').replace(/\n/g, '').trim();
};

/**
 * Get the DecibelReadDex singleton instance
 * Used for: markets, prices, account overview, positions, orders
 */
export function getReadDex(): DecibelReadDex {
  if (!readDex) {
    readDex = new DecibelReadDex(CUSTOM_TESTNET_CONFIG, {
      nodeApiKey: getNodeApiKey(),
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
    writeDex = new DecibelWriteDex(CUSTOM_TESTNET_CONFIG, account, {
      nodeApiKey: getNodeApiKey(),
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

  return new DecibelWriteDex(CUSTOM_TESTNET_CONFIG, account, {
    nodeApiKey: getNodeApiKey(),
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

/**
 * Create an authenticated Aptos client with API key
 * Use this instead of new Aptos(new AptosConfig({...})) to avoid 429 rate limits
 */
export function createAuthenticatedAptos(): Aptos {
  const nodeApiKey = getNodeApiKey();

  const config = new AptosConfig({
    network: Network.TESTNET,
    clientConfig: nodeApiKey ? {
      HEADERS: { Authorization: `Bearer ${nodeApiKey}` }
    } : undefined
  });

  return new Aptos(config);
}

// Export getNodeApiKey for use elsewhere
export { getNodeApiKey };

// Export config and TimeInForce for reference
export { CUSTOM_TESTNET_CONFIG as TESTNET_CONFIG };
export { TimeInForce } from "@decibeltrade/sdk";
