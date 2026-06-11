import { getAptosFullnodeApiKey } from "@/lib/decibel";

/**
 * Server-side market name → address resolution against the Decibel indexer.
 * The indexer's chart/price endpoints key on market address, but callers
 * (and URLs) are friendlier with names like "BTC/USD".
 */

const DECIBEL_BASE = "https://api.mainnet.aptoslabs.com/decibel/api/v1";
const MARKET_CACHE_TTL_MS = 10 * 60 * 1000;

interface MarketEntry {
  market_addr: string;
  market_name: string;
  sz_decimals: number;
  px_decimals: number;
}

let marketCache: { byName: Map<string, MarketEntry>; expires: number } | null = null;

export function getDecibelApiKey(): string | undefined {
  return getAptosFullnodeApiKey("mainnet");
}

export async function getMarketsByName(
  apiKey: string,
  signal?: AbortSignal,
): Promise<Map<string, MarketEntry>> {
  if (marketCache && marketCache.expires > Date.now()) return marketCache.byName;

  const res = await fetch(`${DECIBEL_BASE}/markets`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Decibel markets API returned ${res.status}`);
  }
  const data = (await res.json()) as unknown;
  const items = Array.isArray(data) ? data : [];
  const byName = new Map<string, MarketEntry>();
  for (const m of items) {
    const entry = m as MarketEntry;
    if (typeof entry.market_addr === "string" && typeof entry.market_name === "string") {
      byName.set(entry.market_name.toUpperCase(), entry);
    }
  }
  marketCache = { byName, expires: Date.now() + MARKET_CACHE_TTL_MS };
  return byName;
}

/** Accepts "BTC/USD" or a 0x market address; returns the market address. */
export async function resolveMarketAddress(
  market: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (/^0x[0-9a-f]{1,64}$/i.test(market)) return market.toLowerCase();
  const byName = await getMarketsByName(apiKey, signal);
  return byName.get(market.toUpperCase())?.market_addr ?? null;
}

export { DECIBEL_BASE };
