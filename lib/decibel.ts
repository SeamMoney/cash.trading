/**
 * Decibel SDK Singleton + Constants
 *
 * Mirrors patterns from cash.trading/lib/decibel-sdk.ts and decibel-client.ts.
 * Uses @decibeltrade/sdk v0.3.1 with real DecibelReadDex for market data,
 * orderbook depth, positions, and account overview.
 */

import {
  AccountAddress,
  createObjectAddress,
  MoveString,
} from "@aptos-labs/ts-sdk";
import {
  DecibelReadDex,
  TESTNET_CONFIG as SDK_TESTNET_CONFIG,
  MAINNET_CONFIG as SDK_MAINNET_CONFIG,
  type DecibelConfig,
} from "@decibeltrade/sdk";

export type DecibelNetwork = "testnet" | "mainnet";

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

export function getActiveNetwork(): DecibelNetwork {
  const env =
    process.env.DECIBEL_NETWORK || process.env.NEXT_PUBLIC_APTOS_NETWORK;
  if (env === "mainnet") return "mainnet";
  return "testnet";
}

function getConfig(network?: DecibelNetwork): DecibelConfig {
  const net = network ?? getActiveNetwork();
  return net === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;
}

function sanitizeApiKey(key: string | undefined): string | undefined {
  const cleaned = key?.replace(/\\n/g, "").replace(/\n/g, "").trim();
  return cleaned || undefined;
}

export function getAptosFullnodeApiKey(
  network?: DecibelNetwork
): string | undefined {
  const net = network ?? getActiveNetwork();
  if (net === "mainnet") {
    return sanitizeApiKey(
      process.env.APTOS_API_KEY_MAINNET ||
        process.env.APTOS_NODE_API_KEY_MAINNET ||
        process.env.GEOMI_API_KEY_MAINNET ||
        process.env.APTOS_API_KEY ||
        process.env.APTOS_NODE_API_KEY ||
        process.env.GEOMI_API_KEY
    );
  }
  return sanitizeApiKey(
    process.env.APTOS_API_KEY_TESTNET ||
      process.env.APTOS_NODE_API_KEY_TESTNET ||
      process.env.GEOMI_API_KEY_TESTNET ||
      process.env.APTOS_NODE_API_KEY ||
      process.env.APTOS_API_KEY ||
      process.env.GEOMI_API_KEY
  );
}

function getNodeApiKey(network?: DecibelNetwork): string | undefined {
  return sanitizeApiKey(
    getAptosFullnodeApiKey(network) || process.env.GEOMI_API_KEY
  );
}

// ---------------------------------------------------------------------------
// ReadDex singletons (one per network)
// ---------------------------------------------------------------------------

let readDexTestnet: DecibelReadDex | null = null;
let readDexMainnet: DecibelReadDex | null = null;

export function getReadDex(network?: DecibelNetwork): DecibelReadDex {
  const net = network ?? getActiveNetwork();
  if (net === "mainnet") {
    if (!readDexMainnet) {
      readDexMainnet = new DecibelReadDex(MAINNET_CONFIG, {
        nodeApiKey: getNodeApiKey(net),
        onWsError: (error) =>
          console.error("[Decibel:mainnet] WS error:", error),
      });
    }
    return readDexMainnet;
  }
  if (!readDexTestnet) {
    readDexTestnet = new DecibelReadDex(TESTNET_CONFIG, {
      nodeApiKey: getNodeApiKey(net),
      onWsError: (error) =>
        console.error("[Decibel:testnet] WS error:", error),
    });
  }
  return readDexTestnet;
}

// ---------------------------------------------------------------------------
// Contract addresses
// ---------------------------------------------------------------------------

// Testnet (post Feb 11 2026 reset)
export const DECIBEL_PACKAGE =
  "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f";

// Mainnet
export const MAINNET_DECIBEL_PACKAGE =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";
export const MAINNET_ORDERBOOK_ADDR =
  "0x7bfee072c6886a68e4f2151f0bee56b05773d576ecddb0310870c72633fd97fb";
export const MAINNET_USDC_METADATA =
  "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";

// Predeposit
export const MAINNET_PREDEPOSIT_PACKAGE =
  "0xc5939ec6e7e656cb6fed9afa155e390eb2aa63ba74e73157161829b2f80e1538";
export const MAINNET_PREDEPOSIT_OBJECT =
  "0xbd0c23dbc2e9ac041f5829f79b4c4c1361ddfa2125d5072a96b817984a013d69";

function deriveObjectAddress(packageAddress: string, seed: string | Uint8Array): string {
  const seedBytes = typeof seed === "string" ? new TextEncoder().encode(seed) : seed;
  return createObjectAddress(
    AccountAddress.fromString(packageAddress),
    seedBytes
  ).toString();
}

function getPerpEngineGlobalAddress(packageAddress: string): string {
  return deriveObjectAddress(packageAddress, "GlobalPerpEngine");
}

function getMarketObjectAddress(packageAddress: string, marketName: string): string {
  return createObjectAddress(
    AccountAddress.fromString(getPerpEngineGlobalAddress(packageAddress)),
    new MoveString(marketName).bcsToBytes()
  ).toString();
}

export const TESTNET_CONFIG = SDK_TESTNET_CONFIG;
export const MAINNET_CONFIG: DecibelConfig = {
  ...SDK_MAINNET_CONFIG,
  deployment: {
    ...SDK_MAINNET_CONFIG.deployment,
    package: MAINNET_DECIBEL_PACKAGE,
    usdc: MAINNET_USDC_METADATA,
    testc: deriveObjectAddress(MAINNET_DECIBEL_PACKAGE, "TESTC"),
    perpEngineGlobal: getPerpEngineGlobalAddress(MAINNET_DECIBEL_PACKAGE),
  },
};

// Fee structure
export const MAKER_REBATE = 0.00015; // -0.015%
export const TAKER_FEE = 0.00045; // 0.045%

export const USDC_DECIMALS = 6;
export const PRICE_DECIMALS = 6;

export type DecibelEntryPayload = {
  function: string;
  typeArguments: string[];
  functionArguments: Array<string | number | boolean | null>;
};

export type DecibelOrderType = "market" | "limit";

export const TimeInForce = {
  GoodTillCanceled: 0,
  PostOnly: 1,
  ImmediateOrCancel: 2,
} as const;

// ---------------------------------------------------------------------------
// Market config (shared across networks — only address differs)
// ---------------------------------------------------------------------------

export interface MarketConfig {
  address: string;
  maxLeverage: number;
  minSizeRaw: number;
  sizeDecimals: number;
  priceDecimals: number;
  tickSize: number;
  lotSize: number;
}

const MARKET_SPECS: Record<string, Omit<MarketConfig, "address">> = {
  "BTC/USD": { maxLeverage: 40, minSizeRaw: 2000, sizeDecimals: 8, priceDecimals: 6, tickSize: 100000, lotSize: 1000 },
  "ETH/USD": { maxLeverage: 20, minSizeRaw: 50000, sizeDecimals: 8, priceDecimals: 6, tickSize: 100000, lotSize: 10000 },
  "SOL/USD": { maxLeverage: 10, minSizeRaw: 200000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "APT/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "XRP/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "DOGE/USD": { maxLeverage: 5, minSizeRaw: 200000, sizeDecimals: 4, priceDecimals: 6, tickSize: 10, lotSize: 10000 },
  "HYPE/USD": { maxLeverage: 5, minSizeRaw: 50000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10000 },
  "SUI/USD": { maxLeverage: 5, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "BNB/USD": { maxLeverage: 5, minSizeRaw: 20000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "ZEC/USD": { maxLeverage: 5, minSizeRaw: 50000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "SPY/USD": { maxLeverage: 50, minSizeRaw: 40000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "QQQ/USD": { maxLeverage: 30, minSizeRaw: 40000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "EWY/USD": { maxLeverage: 15, minSizeRaw: 20000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10000 },
  "SPCX/USD": { maxLeverage: 5, minSizeRaw: 100000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  // Commodities — specs from the live Decibel /markets API
  "COPPER/USD": { maxLeverage: 20, minSizeRaw: 20000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "NATGAS/USD": { maxLeverage: 10, minSizeRaw: 50000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
};

const TESTNET_MARKET_SPECS: Record<string, Omit<MarketConfig, "address">> = {
  "BTC/USD": { maxLeverage: 40, minSizeRaw: 100000, sizeDecimals: 8, priceDecimals: 6, tickSize: 100000, lotSize: 10 },
  "ETH/USD": { maxLeverage: 20, minSizeRaw: 100000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10 },
  "SOL/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10 },
  "APT/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 4, priceDecimals: 6, tickSize: 10, lotSize: 10 },
  "XRP/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 4, priceDecimals: 6, tickSize: 10, lotSize: 10 },
  "DOGE/USD": { maxLeverage: 5, minSizeRaw: 100000, sizeDecimals: 3, priceDecimals: 6, tickSize: 1, lotSize: 10 },
  "HYPE/USD": { maxLeverage: 3, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10 },
  "SUI/USD": { maxLeverage: 3, minSizeRaw: 100000, sizeDecimals: 4, priceDecimals: 6, tickSize: 10, lotSize: 10 },
  "BNB/USD": { maxLeverage: 3, minSizeRaw: 100000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10 },
  "ZEC/USD": { maxLeverage: 5, minSizeRaw: 100000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10 },
};

const TESTNET_MARKET_ADDRESSES: Record<string, string> = {
  "BTC/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "BTC/USD"),
  "ETH/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "ETH/USD"),
  "SOL/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "SOL/USD"),
  "APT/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "APT/USD"),
  "XRP/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "XRP/USD"),
  "DOGE/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "DOGE/USD"),
  "HYPE/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "HYPE/USD"),
  "SUI/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "SUI/USD"),
  "BNB/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "BNB/USD"),
  "ZEC/USD": getMarketObjectAddress(DECIBEL_PACKAGE, "ZEC/USD"),
};

const MAINNET_MARKET_ADDRESSES: Record<string, string> = {
  "BTC/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "BTC/USD"),
  "ETH/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "ETH/USD"),
  "SOL/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "SOL/USD"),
  "APT/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "APT/USD"),
  "XRP/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "XRP/USD"),
  "DOGE/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "DOGE/USD"),
  "HYPE/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "HYPE/USD"),
  "SUI/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "SUI/USD"),
  "BNB/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "BNB/USD"),
  "ZEC/USD": getMarketObjectAddress(MAINNET_DECIBEL_PACKAGE, "ZEC/USD"),
  "SPY/USD": "0xb4c1717658713ad5cffab87b6921ca51b66e753e2249c58089cf0631248ec6f9",
  "QQQ/USD": "0x8eef5222689f00c4fcbbaec2ff3f3e92ab41d8b89f1828c2f779700fc0e82eac",
  "EWY/USD": "0x4aab2fc83d5cee7de9cf4c9b4b90f8c5c47dc56292c31188ce00364d42f2de51",
  "SPCX/USD": "0xd279aca832542e097082d3905739983c74497d8f34319938464d94db4c8314c2",
  "COPPER/USD": "0x51c0cfddf76db06e4a56471a7216afd71b2f395d259e9f0ce3f13d92049a3ec4",
  "NATGAS/USD": "0x7c8eaf4161955cdfc8a11829e6a39d8bb931d7d1d599abc1cd38ebe60885e982",
};

// Build network-aware MARKETS object
function buildMarkets(): Record<string, MarketConfig> {
  const net = getActiveNetwork();
  const addrs = net === "mainnet" ? MAINNET_MARKET_ADDRESSES : TESTNET_MARKET_ADDRESSES;
  const specs = net === "mainnet" ? MARKET_SPECS : TESTNET_MARKET_SPECS;
  const result: Record<string, MarketConfig> = {};
  for (const [name, spec] of Object.entries(specs)) {
    result[name] = { ...spec, address: addrs[name] };
  }
  return result;
}

export const MARKETS = buildMarkets();

export type MarketName = keyof typeof MARKET_SPECS;

// Reverse lookup: address → market name
export const MARKET_NAMES: Record<string, string> = Object.entries(
  MARKETS
).reduce(
  (acc, [name, config]) => {
    acc[config.address.toLowerCase()] = name;
    return acc;
  },
  {} as Record<string, string>
);

export function getDecibelPackage(network?: DecibelNetwork): string {
  const net = network ?? getActiveNetwork();
  return net === "mainnet" ? MAINNET_DECIBEL_PACKAGE : DECIBEL_PACKAGE;
}

export function getDecibelCollateralMetadata(network?: DecibelNetwork): string {
  return getConfig(network).deployment.usdc;
}

function none(): null {
  return null;
}

function toRawAmount(value: unknown, decimals: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("amount must be a positive number");
  }
  return Math.round(n * Math.pow(10, decimals));
}

function alignSizeToLot(rawSize: number, lotSize: number, decimals: number): number {
  const aligned = Math.floor(rawSize / lotSize) * lotSize;
  if (aligned <= 0) {
    const minHuman = lotSize / Math.pow(10, decimals);
    throw new Error(`Order size is below the Decibel lot size (${minHuman})`);
  }
  return aligned;
}

function assertMinSize(rawSize: number, minSizeRaw: number, decimals: number) {
  if (rawSize >= minSizeRaw) return;
  const minHuman = minSizeRaw / Math.pow(10, decimals);
  throw new Error(`Order size is below the Decibel minimum (${minHuman})`);
}

function alignLimitPriceToTick(
  rawPrice: number,
  tickSize: number,
  isBuy: boolean
): number {
  if (!tickSize || rawPrice === 0) return rawPrice;
  const scaled = rawPrice / tickSize;
  const aligned = isBuy
    ? Math.floor(scaled) * tickSize
    : Math.ceil(scaled) * tickSize;
  if (aligned <= 0) {
    throw new Error("Limit price is below the Decibel tick size");
  }
  return aligned;
}

function alignMarketPriceToTick(
  rawPrice: number,
  tickSize: number,
  isBuy: boolean
): number {
  if (!tickSize || rawPrice === 0) return rawPrice;
  const scaled = rawPrice / tickSize;
  const aligned = isBuy
    ? Math.ceil(scaled) * tickSize
    : Math.floor(scaled) * tickSize;
  if (aligned <= 0) {
    throw new Error("Protective market price is below the Decibel tick size");
  }
  return aligned;
}

function applySlippage(rawPrice: number, isBuy: boolean, maxSlippageBps: number): number {
  const factor = isBuy
    ? 10_000 + maxSlippageBps
    : 10_000 - maxSlippageBps;
  if (factor <= 0) throw new Error("maxSlippageBps is too high");
  return Math.round((rawPrice * factor) / 10_000);
}

export function getDecibelMarketConfig(marketName: string): MarketConfig {
  const marketConfig = MARKETS[marketName as keyof typeof MARKETS];
  if (!marketConfig) {
    throw new Error(
      `Unknown market: ${marketName}. Available: ${Object.keys(MARKETS).join(", ")}`,
    );
  }
  return marketConfig;
}

function getStaticDecibelMarketConfig(
  marketNameOrAddress: string,
  network: DecibelNetwork = getActiveNetwork()
): { marketName: string; config: MarketConfig } | null {
  const specs = network === "mainnet" ? MARKET_SPECS : TESTNET_MARKET_SPECS;
  const addresses = network === "mainnet" ? MAINNET_MARKET_ADDRESSES : TESTNET_MARKET_ADDRESSES;
  const staticMarkets: Record<string, MarketConfig> = {};
  for (const [name, spec] of Object.entries(specs)) {
    staticMarkets[name] = { ...spec, address: addresses[name] };
  }

  if (marketNameOrAddress.startsWith("0x")) {
    const match = Object.entries(staticMarkets).find(
      ([, config]) =>
        config.address.toLowerCase() === marketNameOrAddress.toLowerCase()
    );
    return match ? { marketName: match[0], config: match[1] } : null;
  }

  const config = staticMarkets[marketNameOrAddress];
  return config ? { marketName: marketNameOrAddress, config } : null;
}

type DecibelMarketRegistryEntry = {
  market_addr: string;
  market_name: string;
  max_leverage: number;
  min_size: number;
  sz_decimals: number;
  px_decimals: number;
  tick_size: number;
  lot_size: number;
};

const MARKET_REGISTRY_TTL_MS = 60_000;
const marketRegistryCache = new Map<
  DecibelNetwork,
  {
    loadedAt: number;
    byName: Map<string, { marketName: string; config: MarketConfig }>;
    byAddress: Map<string, { marketName: string; config: MarketConfig }>;
    inflight: Promise<void> | null;
  }
>();

function getMarketRegistryBucket(network: DecibelNetwork) {
  let bucket = marketRegistryCache.get(network);
  if (!bucket) {
    bucket = {
      loadedAt: 0,
      byName: new Map(),
      byAddress: new Map(),
      inflight: null,
    };
    marketRegistryCache.set(network, bucket);
  }
  return bucket;
}

function registryEntryToConfig(entry: DecibelMarketRegistryEntry): {
  marketName: string;
  config: MarketConfig;
} {
  return {
    marketName: entry.market_name,
    config: {
      address: entry.market_addr,
      maxLeverage: entry.max_leverage,
      minSizeRaw: entry.min_size,
      sizeDecimals: entry.sz_decimals,
      priceDecimals: entry.px_decimals,
      tickSize: entry.tick_size,
      lotSize: entry.lot_size,
    },
  };
}

function cacheMarketRegistry(
  network: DecibelNetwork,
  entries: DecibelMarketRegistryEntry[]
) {
  const bucket = getMarketRegistryBucket(network);
  bucket.byName.clear();
  bucket.byAddress.clear();
  for (const entry of entries) {
    const normalized = registryEntryToConfig(entry);
    bucket.byName.set(entry.market_name.toLowerCase(), normalized);
    const baseName = entry.market_name.split("/")[0]?.toLowerCase();
    if (baseName) bucket.byName.set(baseName, normalized);
    bucket.byAddress.set(entry.market_addr.toLowerCase(), normalized);
  }
  bucket.loadedAt = Date.now();
}

function getCachedMarketRegistryConfig(
  marketNameOrAddress: string,
  network: DecibelNetwork
) {
  const bucket = getMarketRegistryBucket(network);
  const normalized = marketNameOrAddress.toLowerCase();
  if (marketNameOrAddress.startsWith("0x")) {
    return bucket.byAddress.get(normalized) ?? null;
  }
  return bucket.byName.get(normalized) ?? null;
}

async function loadMarketRegistry(
  network: DecibelNetwork,
  signal?: AbortSignal
) {
  const bucket = getMarketRegistryBucket(network);
  if (Date.now() - bucket.loadedAt < MARKET_REGISTRY_TTL_MS) return;
  if (bucket.inflight) return bucket.inflight;

  bucket.inflight = (async () => {
    const dex = getReadDex(network);
    const markets = (await dex.markets.getAll({
      fetchOptions: { signal },
    })) as DecibelMarketRegistryEntry[];
    cacheMarketRegistry(network, markets);
  })().finally(() => {
    bucket.inflight = null;
  });

  return bucket.inflight;
}

export async function getDecibelMarketConfigFromRegistry(
  marketNameOrAddress: string,
  options: { signal?: AbortSignal; network?: DecibelNetwork } = {}
): Promise<{ marketName: string; config: MarketConfig }> {
  const network = options.network ?? getActiveNetwork();

  // Live registry first: the static snapshot drifts (leverage limits changed
  // on ETH/SOL/HYPE between upgrades) and never learns new listings. Static
  // config is only a fallback when the registry is unreachable.
  const cachedConfig = getCachedMarketRegistryConfig(
    marketNameOrAddress,
    network
  );
  if (cachedConfig) return cachedConfig;

  try {
    await loadMarketRegistry(network, options.signal);
    const refreshedConfig = getCachedMarketRegistryConfig(
      marketNameOrAddress,
      network
    );
    if (refreshedConfig) return refreshedConfig;
  } catch {
    const staticConfig = getStaticDecibelMarketConfig(
      marketNameOrAddress,
      network
    );
    if (staticConfig) return staticConfig;
  }

  const staticConfig = getStaticDecibelMarketConfig(marketNameOrAddress, network);
  if (staticConfig) return staticConfig;

  throw new Error(`Unknown Decibel market: ${marketNameOrAddress}`);
}

export function getDecibelMarketNameForAddress(address: string, network?: DecibelNetwork): string | null {
  const net = network ?? getActiveNetwork();
  const normalized = address.toLowerCase();

  // Warm registry cache first — the static maps only know the original 15
  // markets. When cold, kick off a background load so the next poll resolves.
  const cached = getCachedMarketRegistryConfig(normalized, net);
  if (cached) return cached.marketName;
  void loadMarketRegistry(net).catch(() => {});

  const specs = net === "mainnet" ? MARKET_SPECS : TESTNET_MARKET_SPECS;
  const addresses = net === "mainnet" ? MAINNET_MARKET_ADDRESSES : TESTNET_MARKET_ADDRESSES;
  for (const name of Object.keys(specs)) {
    const config = { address: addresses[name] };
    if (config.address.toLowerCase() === normalized) return name;
  }
  return null;
}

export function getDecibelMarketAddress(marketNameOrAddress: string, network?: DecibelNetwork): string {
  if (marketNameOrAddress.startsWith("0x")) return marketNameOrAddress;
  return (getStaticDecibelMarketConfig(marketNameOrAddress, network)?.config ??
    getDecibelMarketConfig(marketNameOrAddress)).address;
}

export function buildDecibelOrderPayload(args: {
  marketName: string;
  marketConfig?: MarketConfig;
  network?: DecibelNetwork;
  price?: number | string | null;
  size: number | string;
  isBuy: boolean;
  orderType: DecibelOrderType;
  reduceOnly?: boolean;
  subaccount: string;
  clientOrderId?: string | null;
  maxSlippageBps?: number;
}): {
  payload: DecibelEntryPayload;
  marketConfig: MarketConfig;
  sizeRaw: number;
  priceRaw: number;
} {
  if (!args.subaccount) throw new Error("subaccount is required");

  const pkg = getDecibelPackage(args.network);
  const marketConfig =
    args.marketConfig ??
    getStaticDecibelMarketConfig(args.marketName, args.network)?.config ??
    getDecibelMarketConfig(args.marketName);
  const sizeRaw = alignSizeToLot(
    toRawAmount(args.size, marketConfig.sizeDecimals),
    marketConfig.lotSize,
    marketConfig.sizeDecimals
  );
  assertMinSize(sizeRaw, marketConfig.minSizeRaw, marketConfig.sizeDecimals);
  const reduceOnly = Boolean(args.reduceOnly);
  const clientOrderId = args.clientOrderId ?? none();

  if (args.orderType === "market") {
    const rawReferencePrice = toRawAmount(args.price, marketConfig.priceDecimals);
    const priceRaw = alignMarketPriceToTick(
      applySlippage(
        rawReferencePrice,
        Boolean(args.isBuy),
        args.maxSlippageBps ?? 800
      ),
      marketConfig.tickSize,
      Boolean(args.isBuy)
    );

    return {
      payload: {
        function: `${pkg}::dex_accounts_entry::place_order_to_subaccount`,
        typeArguments: [],
        functionArguments: [
          args.subaccount,
          marketConfig.address,
          String(priceRaw),
          String(sizeRaw),
          Boolean(args.isBuy),
          TimeInForce.ImmediateOrCancel,
          reduceOnly,
          clientOrderId,
          none(), // stop price
          none(), // take-profit trigger price
          none(), // take-profit limit price
          none(), // stop-loss trigger price
          none(), // stop-loss limit price
          none(), // builder address
          none(), // builder fee
        ],
      },
      marketConfig,
      sizeRaw,
      priceRaw,
    };
  }

  const rawLimitPrice = toRawAmount(args.price, marketConfig.priceDecimals);
  const priceRaw = alignLimitPriceToTick(
    rawLimitPrice,
    marketConfig.tickSize,
    Boolean(args.isBuy)
  );

  return {
    payload: {
      function: `${pkg}::dex_accounts_entry::place_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [
        args.subaccount,
        marketConfig.address,
        String(priceRaw),
        String(sizeRaw),
        Boolean(args.isBuy),
        TimeInForce.GoodTillCanceled,
        reduceOnly,
        clientOrderId,
        none(), // stop price
        none(), // take-profit trigger price
        none(), // take-profit limit price
        none(), // stop-loss trigger price
        none(), // stop-loss limit price
        none(), // builder address
        none(), // builder fee
      ],
    },
    marketConfig,
    sizeRaw,
    priceRaw,
  };
}

export function buildDecibelCancelOrderPayload(args: {
  subaccount: string;
  marketName?: string;
  marketAddress?: string;
  network?: DecibelNetwork;
  orderId: string | number;
}): {
  payload: DecibelEntryPayload;
  marketAddress: string;
} {
  if (!args.subaccount) throw new Error("subaccount is required");
  if (args.orderId === undefined || args.orderId === null || `${args.orderId}`.length === 0) {
    throw new Error("orderId is required");
  }
  const marketAddress = args.marketAddress
    ? getDecibelMarketAddress(args.marketAddress, args.network)
    : args.marketName
      ? getDecibelMarketAddress(args.marketName, args.network)
      : "";
  if (!marketAddress) throw new Error("marketName or marketAddress is required");

  return {
    payload: {
      function: `${getDecibelPackage(args.network)}::dex_accounts_entry::cancel_order_to_subaccount`,
      typeArguments: [],
      functionArguments: [args.subaccount, String(args.orderId), marketAddress],
    },
    marketAddress,
  };
}

export function buildDecibelCollateralPayload(args: {
  action: "deposit" | "withdraw";
  subaccount: string;
  amount: string | number;
  network?: DecibelNetwork;
}): DecibelEntryPayload {
  if (!args.subaccount) throw new Error("subaccount is required");
  const amountRaw = toRawAmount(args.amount, 0);
  const pkg = getDecibelPackage(args.network);
  const collateralMetadata = getDecibelCollateralMetadata(args.network);
  return {
    function:
      args.action === "deposit"
        ? `${pkg}::dex_accounts_entry::deposit_to_subaccount_at`
        : `${pkg}::dex_accounts_entry::withdraw_from_subaccount`,
    typeArguments: [],
    functionArguments: [args.subaccount, collateralMetadata, String(amountRaw)],
  };
}

// ---------------------------------------------------------------------------
// REST API helpers (authenticated via Geomi API key)
// ---------------------------------------------------------------------------

const TESTNET_API_URL =
  "https://api.testnet.aptoslabs.com/decibel/api/v1";
const MAINNET_API_URL =
  "https://api.mainnet.aptoslabs.com/decibel/api/v1";

export function getApiBaseUrl(network?: DecibelNetwork): string {
  const net = network ?? getActiveNetwork();
  return net === "mainnet" ? MAINNET_API_URL : TESTNET_API_URL;
}

export function getApiHeaders(): Record<string, string> {
  const key = getNodeApiKey();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { getConfig, getNodeApiKey };
