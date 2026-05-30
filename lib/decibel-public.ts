"use client";

export const DECIBEL_PUBLIC_PROXY_BASE = "/api/decibel/public";
export type DecibelPublicNetwork = "mainnet" | "testnet";
export const DECIBEL_NETWORK_STORAGE_KEY = "cash:decibel-network";
export const DECIBEL_NETWORK_CHANGE_EVENT = "cash:decibel-network-change";

const DECIBEL_PUBLIC_BASES: Record<DecibelPublicNetwork, string> = {
  mainnet: "https://api.mainnet.aptoslabs.com/decibel/api/v1",
  testnet: "https://api.testnet.aptoslabs.com/decibel/api/v1",
};

const DECIBEL_WS_BASES: Record<DecibelPublicNetwork, string> = {
  mainnet: "wss://api.mainnet.aptoslabs.com/decibel/ws",
  testnet: "wss://api.testnet.aptoslabs.com/decibel/ws",
};

function normalizeNetwork(value: unknown): DecibelPublicNetwork | null {
  return value === "mainnet" || value === "testnet" ? value : null;
}

function getDefaultNetwork(): DecibelPublicNetwork {
  return normalizeNetwork(process.env.NEXT_PUBLIC_DECIBEL_NETWORK) ??
    normalizeNetwork(process.env.NEXT_PUBLIC_APTOS_NETWORK) ??
    "testnet";
}

export function getDecibelPublicNetwork(): DecibelPublicNetwork {
  if (isBrowserRuntime()) {
    return normalizeNetwork(window.localStorage.getItem(DECIBEL_NETWORK_STORAGE_KEY)) ??
      getDefaultNetwork();
  }
  return getDefaultNetwork();
}

export function setDecibelPublicNetwork(network: DecibelPublicNetwork) {
  if (!isBrowserRuntime()) return;
  const previous = getDecibelPublicNetwork();
  if (previous === network) return;
  window.localStorage.setItem(DECIBEL_NETWORK_STORAGE_KEY, network);
  window.dispatchEvent(
    new CustomEvent(DECIBEL_NETWORK_CHANGE_EVENT, {
      detail: { network, previous },
    }),
  );
}

export function onDecibelPublicNetworkChange(
  callback: (network: DecibelPublicNetwork) => void,
) {
  if (!isBrowserRuntime()) return () => {};
  const onChange = (event: Event) => {
    const detail = (event as CustomEvent<{ network?: DecibelPublicNetwork }>).detail;
    callback(detail?.network ?? getDecibelPublicNetwork());
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === DECIBEL_NETWORK_STORAGE_KEY) {
      callback(getDecibelPublicNetwork());
    }
  };
  window.addEventListener(DECIBEL_NETWORK_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DECIBEL_NETWORK_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getDecibelPublicWsUrl(network = getDecibelPublicNetwork()) {
  return DECIBEL_WS_BASES[network];
}

export interface DecibelRestMarket {
  lot_size: number;
  market_addr: string;
  market_name: string;
  max_leverage: number;
  max_open_interest: number;
  min_size: number;
  mode: string;
  px_decimals: number;
  sz_decimals: number;
  tick_size: number;
  unrealized_pnl_haircut_bps: number;
}

export interface DecibelRestPrice {
  funding_rate_bps: number;
  is_funding_positive: boolean;
  mark_px: number;
  market: string;
  mid_px: number;
  open_interest: number;
  oracle_px: number;
  transaction_unix_ms: number;
}

export interface DecibelRestTrade {
  action: string;
  account: string;
  fee_amount: number;
  is_funding_positive: boolean;
  is_profit: boolean;
  market: string;
  price: number;
  realized_funding_amount: number;
  realized_pnl_amount: number;
  size: number;
  source?: string;
  trade_id?: string;
  transaction_unix_ms: number;
  transaction_version: number;
}

export interface DecibelRestCandle {
  T: number;
  c: number;
  h: number;
  i: string;
  l: number;
  o: number;
  t: number;
  v: number;
}

const marketsPromises: Partial<Record<DecibelPublicNetwork, Promise<DecibelRestMarket[]>>> = {};
const DEFAULT_TIMEOUT_MS = 4500;

export interface DecibelChartBootstrap {
  candles: DecibelRestCandle[];
  market: DecibelRestMarket;
  price: DecibelRestPrice | null;
  trades: DecibelRestTrade[];
}

function buildProxyUrl(
  resource: string,
  params: Record<string, string | number | undefined> = {},
  network = getDecibelPublicNetwork(),
) {
  const searchParams = new URLSearchParams({ resource, network });
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    searchParams.set(key, String(value));
  }
  return `${DECIBEL_PUBLIC_PROXY_BASE}?${searchParams.toString()}`;
}

function buildPublicUrl(
  path: string,
  params: Record<string, string | number | undefined> = {},
  network = getDecibelPublicNetwork(),
) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return `${DECIBEL_PUBLIC_BASES[network]}${path}${query ? `?${query}` : ""}`;
}

function isBrowserRuntime() {
  return typeof window !== "undefined";
}

async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    cache: "no-store",
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) {
    throw new Error(`Decibel request failed (${res.status}) for ${url}`);
  }
  return res.json() as Promise<T>;
}

async function fetchPreferredJson<T>(
  proxyUrl: string,
  publicUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const preferDirect =
    isBrowserRuntime() && getDecibelPublicNetwork() === "mainnet";
  const firstUrl = preferDirect ? publicUrl : proxyUrl;
  const secondUrl = preferDirect ? proxyUrl : publicUrl;

  try {
    return await fetchJson<T>(firstUrl, timeoutMs);
  } catch (firstError) {
    try {
      return await fetchJson<T>(secondUrl, timeoutMs);
    } catch {
      throw firstError;
    }
  }
}

export async function fetchDecibelMainnetMarkets(force = false, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const network = getDecibelPublicNetwork();
  if (!marketsPromises[network] || force) {
    marketsPromises[network] = fetchPreferredJson<DecibelRestMarket[]>(
      buildProxyUrl("markets", { timeoutMs }, network),
      buildPublicUrl("/markets", {}, network),
      timeoutMs,
    );
  }
  return marketsPromises[network]!;
}

export async function fetchDecibelMainnetPrices(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const network = getDecibelPublicNetwork();
  return fetchPreferredJson<DecibelRestPrice[]>(
    buildProxyUrl("prices", { timeoutMs }, network),
    buildPublicUrl("/prices", {}, network),
    timeoutMs,
  );
}

export async function fetchDecibelMainnetMarketBundle(marketName: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [markets, prices] = await Promise.all([
    fetchDecibelMainnetMarkets(false, timeoutMs),
    fetchDecibelMainnetPrices(timeoutMs),
  ]);

  const market = markets.find((entry) => entry.market_name === marketName);
  if (!market) {
    throw new Error(`Decibel market not found: ${marketName}`);
  }

  return {
    market,
    price: prices.find((entry) => entry.market === market.market_addr) ?? null,
  };
}

export async function fetchDecibelMainnetTrades(
  marketAddr: string,
  limit = 1200,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const network = getDecibelPublicNetwork();
  const safeLimit = Math.min(Math.max(limit, 1), 5000);
  const data = await fetchPreferredJson<{ items: DecibelRestTrade[] }>(
    buildProxyUrl("trades", { marketAddr, limit: safeLimit, timeoutMs }, network),
    buildPublicUrl("/trades", { market: marketAddr, limit: safeLimit }, network),
    timeoutMs,
  );
  return data.items;
}

export async function fetchDecibelMainnetCandles(
  marketAddr: string,
  interval: "1m" | "5m" | "15m" | "30m" | "1h",
  startTime: number,
  endTime: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const network = getDecibelPublicNetwork();
  return fetchPreferredJson<DecibelRestCandle[]>(
    buildProxyUrl("candles", {
      marketAddr,
      interval,
      startTime,
      endTime,
      timeoutMs,
    }, network),
    buildPublicUrl("/candlesticks", {
      market: marketAddr,
      interval,
      startTime,
      endTime,
    }, network),
    timeoutMs,
  );
}

export async function fetchDecibelMainnetChartBootstrap(
  marketName: string,
  tradeLimit = 900,
  candleWindowMs = 12 * 60 * 60 * 1000,
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const { market, price } = await fetchDecibelMainnetMarketBundle(marketName, timeoutMs);
  const now = Date.now();
  const [candlesResult, tradesResult] = await Promise.allSettled([
    fetchDecibelMainnetCandles(
      market.market_addr,
      "1m",
      now - candleWindowMs,
      now,
      timeoutMs,
    ),
    fetchDecibelMainnetTrades(
      market.market_addr,
      tradeLimit,
      timeoutMs,
    ),
  ]);

  return {
    market,
    price,
    candles: candlesResult.status === "fulfilled" ? candlesResult.value : [],
    trades: tradesResult.status === "fulfilled" ? tradesResult.value : [],
  };
}
