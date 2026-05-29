/**
 * Decibel SDK Singleton + Constants
 *
 * Mirrors patterns from decibrrr/lib/decibel-sdk.ts and decibel-client.ts.
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
};

const TESTNET_MARKET_SPECS: Record<string, Omit<MarketConfig, "address">> = {
  "BTC/USD": { maxLeverage: 40, minSizeRaw: 20000, sizeDecimals: 9, priceDecimals: 6, tickSize: 1000000, lotSize: 10000 },
  "ETH/USD": { maxLeverage: 20, minSizeRaw: 50000, sizeDecimals: 8, priceDecimals: 6, tickSize: 100000, lotSize: 10000 },
  "SOL/USD": { maxLeverage: 10, minSizeRaw: 200000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "APT/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "XRP/USD": { maxLeverage: 10, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "DOGE/USD": { maxLeverage: 5, minSizeRaw: 200000, sizeDecimals: 4, priceDecimals: 6, tickSize: 10, lotSize: 10000 },
  "HYPE/USD": { maxLeverage: 5, minSizeRaw: 50000, sizeDecimals: 6, priceDecimals: 6, tickSize: 1000, lotSize: 10000 },
  "SUI/USD": { maxLeverage: 5, minSizeRaw: 100000, sizeDecimals: 5, priceDecimals: 6, tickSize: 100, lotSize: 10000 },
  "BNB/USD": { maxLeverage: 5, minSizeRaw: 20000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
  "ZEC/USD": { maxLeverage: 5, minSizeRaw: 50000, sizeDecimals: 7, priceDecimals: 6, tickSize: 10000, lotSize: 10000 },
};

const TESTNET_MARKET_ADDRESSES: Record<string, string> = {
  "BTC/USD": "0x161b7b3f58327d057ee5824de0c1a4fc4fa3d121b847c138e921a255768a0dca",
  "ETH/USD": "0x12cf0b34f9ba0a1144f1e7c6f7d0aa28e4a7815a55bf637ba96d66256becc559",
  "SOL/USD": "0xc2f9b548d2b75afa0aa449ec36c7b1279b2c88022233b4c44965b5b27507ed7c",
  "APT/USD": "0x2bfe28c0de988afd44843ddd8ddf9a81d0e106eb8d85d9275d330b2d93a02bb6",
  "XRP/USD": "0xe11411f3e859b19745c699598c218076728e2f0fd397bf12cd7d8e75cc70c2c9",
  "DOGE/USD": "0x90d20af890b0672cae552fc74e8a870241b106e91f0287dbd34fc2114bf1ebcb",
  "HYPE/USD": "0x944547402c4cc6dba3d7724354ba7280f648d4d856613a8479fec40b2c252179",
  "SUI/USD": "0x4cdee0065ed00b281c6979d425a6ead15f357a2c83d785e56693eb566b54d02e",
  "BNB/USD": "0x7a38c627803df2198bebdc8d7e78ba9070da702e4dd3691ef48c528f0e12ad28",
  "ZEC/USD": "0xe8b091045020f58f2ab4acdbf609bfec50444fbe02d3a23f849322dc21af3ffd",
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
  marketNameOrAddress: string
): { marketName: string; config: MarketConfig } | null {
  if (marketNameOrAddress.startsWith("0x")) {
    const match = Object.entries(MARKETS).find(
      ([, config]) =>
        config.address.toLowerCase() === marketNameOrAddress.toLowerCase()
    );
    return match ? { marketName: match[0], config: match[1] } : null;
  }

  const config = MARKETS[marketNameOrAddress as keyof typeof MARKETS];
  return config ? { marketName: marketNameOrAddress, config } : null;
}

export async function getDecibelMarketConfigFromRegistry(
  marketNameOrAddress: string,
  options: { signal?: AbortSignal; network?: DecibelNetwork } = {}
): Promise<{ marketName: string; config: MarketConfig }> {
  const staticConfig = getStaticDecibelMarketConfig(marketNameOrAddress);
  if (staticConfig) return staticConfig;

  const dex = getReadDex(options.network);
  const markets = await dex.markets.getAll({
    fetchOptions: { signal: options.signal },
  });
  const normalized = marketNameOrAddress.toLowerCase();
  const market = markets.find((entry) => {
    const byAddress = entry.market_addr.toLowerCase() === normalized;
    const byName = entry.market_name.toLowerCase() === normalized;
    const byBaseName =
      !marketNameOrAddress.includes("/") &&
      entry.market_name.toLowerCase().startsWith(`${normalized}/`);
    return byAddress || byName || byBaseName;
  });

  if (!market) {
    throw new Error(`Unknown Decibel market: ${marketNameOrAddress}`);
  }

  return {
    marketName: market.market_name,
    config: {
      address: market.market_addr,
      maxLeverage: market.max_leverage,
      minSizeRaw: market.min_size,
      sizeDecimals: market.sz_decimals,
      priceDecimals: market.px_decimals,
      tickSize: market.tick_size,
      lotSize: market.lot_size,
    },
  };
}

export function getDecibelMarketNameForAddress(address: string): string | null {
  const normalized = address.toLowerCase();
  for (const [name, config] of Object.entries(MARKETS)) {
    if (config.address.toLowerCase() === normalized) return name;
  }
  return null;
}

export function getDecibelMarketAddress(marketNameOrAddress: string): string {
  if (marketNameOrAddress.startsWith("0x")) return marketNameOrAddress;
  return getDecibelMarketConfig(marketNameOrAddress).address;
}

export function buildDecibelOrderPayload(args: {
  marketName: string;
  marketConfig?: MarketConfig;
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

  const pkg = getDecibelPackage();
  const marketConfig = args.marketConfig ?? getDecibelMarketConfig(args.marketName);
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
    ? getDecibelMarketAddress(args.marketAddress)
    : args.marketName
      ? getDecibelMarketAddress(args.marketName)
      : "";
  if (!marketAddress) throw new Error("marketName or marketAddress is required");

  return {
    payload: {
      function: `${getDecibelPackage()}::dex_accounts_entry::cancel_order_to_subaccount`,
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
}): DecibelEntryPayload {
  if (!args.subaccount) throw new Error("subaccount is required");
  const amountRaw = toRawAmount(args.amount, 0);
  const pkg = getDecibelPackage();
  const collateralMetadata = getDecibelCollateralMetadata();
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
