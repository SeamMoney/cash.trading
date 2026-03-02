/**
 * Decibel SDK Singleton
 *
 * This module provides initialized SDK instances for read/write operations.
 * Uses @decibeltrade/sdk v0.4.0
 *
 * Configuration from dev chat:
 * - noFeePayer: true (fee payer had issues on testnet)
 * - skipSimulate: true (faster)
 *
 * SDK v0.4.0 changes (Mar 2, 2026):
 * - MAINNET_CONFIG now points to live contract (0x50ead) — no more override needed
 * - New readers: VaultsReader, TradingPointsReader, GlobalPointsStatsReader
 * - CompatVersion V0_4
 *
 * @see https://docs.decibel.trade/typescript-sdk/overview
 */

import {
  DecibelReadDex,
  DecibelWriteDex,
  TESTNET_CONFIG,
  MAINNET_CONFIG,
  type DecibelConfig,
} from "@decibeltrade/sdk";
import { Account, Ed25519PrivateKey, Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

export type DecibelNetwork = "testnet" | "mainnet";

// Determine active network from env — defaults to testnet
function getActiveNetwork(): DecibelNetwork {
  const env = process.env.DECIBEL_NETWORK || process.env.NEXT_PUBLIC_DECIBEL_NETWORK;
  if (env === "mainnet") return "mainnet";
  return "testnet";
}

function getConfig(network?: DecibelNetwork): DecibelConfig {
  const net = network ?? getActiveNetwork();
  return net === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
}

// Singleton instances (keyed by network to avoid cross-contamination)
let readDexTestnet: DecibelReadDex | null = null;
let readDexMainnet: DecibelReadDex | null = null;
let writeDexTestnet: DecibelWriteDex | null = null;
let writeDexMainnet: DecibelWriteDex | null = null;

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
export function getReadDex(network?: DecibelNetwork): DecibelReadDex {
  const net = network ?? getActiveNetwork();
  if (net === "mainnet") {
    if (!readDexMainnet) {
      readDexMainnet = new DecibelReadDex(MAINNET_CONFIG, {
        nodeApiKey: getNodeApiKey(),
        onWsError: (error) => {
          console.error("[SDK:mainnet] WebSocket error:", error);
        },
      });
    }
    return readDexMainnet;
  }
  if (!readDexTestnet) {
    readDexTestnet = new DecibelReadDex(TESTNET_CONFIG, {
      nodeApiKey: getNodeApiKey(),
      onWsError: (error) => {
        console.error("[SDK:testnet] WebSocket error:", error);
      },
    });
  }
  return readDexTestnet;
}

/**
 * Get the DecibelWriteDex singleton instance
 * Used for: placing orders, TP/SL, cancellations, delegation
 *
 * NOTE: Uses bot operator account from environment
 */
export function getWriteDex(network?: DecibelNetwork): DecibelWriteDex {
  const net = network ?? getActiveNetwork();
  const config = getConfig(net);

  if (net === "mainnet") {
    if (!writeDexMainnet) {
      writeDexMainnet = createWriteDex(config);
    }
    return writeDexMainnet;
  }
  if (!writeDexTestnet) {
    writeDexTestnet = createWriteDex(config);
  }
  return writeDexTestnet;
}

function createWriteDex(config: DecibelConfig): DecibelWriteDex {
  const privateKeyHex = process.env.BOT_OPERATOR_PRIVATE_KEY;
  if (!privateKeyHex) {
    throw new Error("BOT_OPERATOR_PRIVATE_KEY not set");
  }

  const cleanKey = privateKeyHex
    .replace("ed25519-priv-", "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();

  const privateKey = new Ed25519PrivateKey(cleanKey);
  const account = Account.fromPrivateKey({ privateKey });

  return new DecibelWriteDex(config, account, {
    nodeApiKey: getNodeApiKey(),
    skipSimulate: true,
    noFeePayer: true,
  });
}

/**
 * Get a WriteDex instance with a custom account (for user-specific operations)
 * Used when bot needs to act on behalf of a specific user's delegation
 */
export function getWriteDexForAccount(privateKeyHex: string, network?: DecibelNetwork): DecibelWriteDex {
  const config = getConfig(network);

  const cleanKey = privateKeyHex
    .replace("ed25519-priv-", "")
    .replace(/\\n/g, "")
    .replace(/\n/g, "")
    .trim();

  const privateKey = new Ed25519PrivateKey(cleanKey);
  const account = Account.fromPrivateKey({ privateKey });

  return new DecibelWriteDex(config, account, {
    nodeApiKey: getNodeApiKey(),
    skipSimulate: true,
    noFeePayer: true,
  });
}

/**
 * Utility: Get market address from market name using SDK
 * Falls back to null if not found
 */
export async function getMarketAddressFromSDK(marketName: string, network?: DecibelNetwork): Promise<string | null> {
  try {
    const dex = getReadDex(network);
    const markets = await dex.markets.getAll();
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
export async function getAllMarketAddresses(network?: DecibelNetwork): Promise<
  Array<{ name: string; address: string; tickSize: number; szDecimals: number; pxDecimals: number }>
> {
  try {
    const dex = getReadDex(network);
    const markets = await dex.markets.getAll();
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
 *
 * Mainnet uses API_KEY in clientConfig (not Authorization header)
 * Testnet uses Authorization: Bearer header
 */
export function createAuthenticatedAptos(network?: DecibelNetwork): Aptos {
  const net = network ?? getActiveNetwork();
  const nodeApiKey = getNodeApiKey();

  const config = new AptosConfig({
    network: net === "mainnet" ? Network.MAINNET : Network.TESTNET,
    clientConfig: nodeApiKey
      ? net === "mainnet"
        ? { API_KEY: nodeApiKey }
        : { HEADERS: { Authorization: `Bearer ${nodeApiKey}` } }
      : undefined,
  });

  return new Aptos(config);
}

// Re-export for use elsewhere
export { getNodeApiKey, getActiveNetwork };

// Export configs for reference
export { TESTNET_CONFIG, MAINNET_CONFIG };
export { TimeInForce } from "@decibeltrade/sdk";
