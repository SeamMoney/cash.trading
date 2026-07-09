import { NextResponse } from "next/server";
import { getFastMarkets } from "@/lib/decibel-chain";
import { getAptosFullnodeApiKey, getReadDex, type DecibelNetwork } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REST_MARKETS_TIMEOUT_MS = 2_500;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function getRequestNetwork(req: Request): DecibelNetwork {
  const url = new URL(req.url);
  return url.searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";
}

function asNumber(value: unknown): number | null {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fallbackMarkets(error: string, network: DecibelNetwork) {
  return {
    degraded: true,
    network,
    error,
    markets: [],
  };
}

const DECIBEL_REST_BASE: Record<DecibelNetwork, string> = {
  mainnet: "https://api.mainnet.aptoslabs.com/decibel/api/v1",
  testnet: "https://api.testnet.aptoslabs.com/decibel/api/v1",
};

interface DayStats {
  volume24h: number | null;
  change24hPct: number | null;
}

/** 24h volume / price change per market name from the indexer's asset_contexts. */
async function fetchAssetContexts(network: DecibelNetwork): Promise<Map<string, DayStats>> {
  const map = new Map<string, DayStats>();
  const apiKey = getAptosFullnodeApiKey(network);
  if (!apiKey) return map;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_MARKETS_TIMEOUT_MS);
  try {
    const res = await fetch(`${DECIBEL_REST_BASE[network]}/asset_contexts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return map;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return map;
    for (const raw of data) {
      const row = raw as Record<string, unknown>;
      const name = asString(row.market);
      if (!name) continue;
      map.set(name.toUpperCase(), {
        volume24h: asNumber(row.volume_24h),
        change24hPct: asNumber(row.price_change_pct_24h),
      });
    }
    return map;
  } catch {
    return map;
  } finally {
    clearTimeout(timer);
  }
}

/** market_addr → category from the raw REST /markets payload; the SDK's
 * markets.getAll() strips fields it doesn't type (category included). */
async function fetchMarketCategories(
  network: DecibelNetwork,
  signal: AbortSignal
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const apiKey = getAptosFullnodeApiKey(network);
  if (!apiKey) return map;
  try {
    const res = await fetch(`${DECIBEL_REST_BASE[network]}/markets`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
      cache: "no-store",
    });
    if (!res.ok) return map;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return map;
    for (const raw of data) {
      const row = raw as Record<string, unknown>;
      const addr = asString(row.market_addr);
      const category = asString(row.category);
      if (addr && category) map.set(addr.toLowerCase(), category);
    }
    return map;
  } catch {
    return map;
  }
}

async function fetchSdkMarkets(network: DecibelNetwork) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_MARKETS_TIMEOUT_MS);
  try {
    const dex = getReadDex(network);
    const [markets, prices, categories] = await Promise.all([
      dex.markets.getAll({ fetchOptions: { signal: controller.signal } }),
      dex.marketPrices.getAll({ fetchOptions: { signal: controller.signal } }),
      fetchMarketCategories(network, controller.signal),
    ]);

    const priceMap = new Map<string, Record<string, unknown>>();
    for (const price of prices) {
      const market = (price as Record<string, unknown>).market;
      if (typeof market === "string") {
        priceMap.set(market.toLowerCase(), price as Record<string, unknown>);
      }
    }

    return markets.map((rawMarket) => {
      const market = rawMarket as Record<string, unknown>;
      const address = asString(market.market_addr);
      const rest = priceMap.get(address.toLowerCase());
      const markPrice =
        asNumber(rest?.mark_px) ?? asNumber(rest?.mid_px) ?? asNumber(rest?.oracle_px);

      return {
        name: asString(market.market_name),
        address,
        markPrice,
        midPrice: asNumber(rest?.mid_px),
        oraclePrice: asNumber(rest?.oracle_px),
        fundingRateBps: asNumber(rest?.funding_rate_bps),
        isFundingPositive:
          rest?.is_funding_positive == null
            ? null
            : Boolean(rest.is_funding_positive),
        openInterest: asNumber(rest?.open_interest),
        priceUpdatedAt: asNumber(rest?.transaction_unix_ms),
        maxLeverage: asNumber(market.max_leverage),
        tickSize: asNumber(market.tick_size),
        minSize: asNumber(market.min_size),
        lotSize: asNumber(market.lot_size),
        mode: asString(market.mode) || "Unknown",
        szDecimals: asNumber(market.sz_decimals),
        pxDecimals: asNumber(market.px_decimals),
        category:
          categories.get(address.toLowerCase()) ??
          (asString(market.category) || null),
        source: rest ? "sdk+rest" : "sdk",
      };
    }).filter((market) => market.name && market.address);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/decibel/markets
 *
 * Fullnode-first market config and mark/oracle prices. Decibel REST prices are
 * used only as a short-timeout enrichment for mid price, funding, and timestamps.
 */
export async function GET(req: Request) {
  const network = getRequestNetwork(req);
  const startedAt = Date.now();

  try {
    const dayStatsPromise = fetchAssetContexts(network);
    let markets = await fetchSdkMarkets(network);
    let sources = {
      config: "sdk",
      markOracle: "rest",
      enrichment: "rest",
    };

    if (markets.length === 0) {
      const chainMarkets = await getFastMarkets(network);
      markets = chainMarkets.map((market) => ({ ...market, category: null, source: market.source }));
      sources = {
        config: "chain",
        markOracle: "chain",
        enrichment: "unavailable",
      };
    }

    // 24h stats ride along when the indexer has them; null means "hide the cell",
    // never zero (DATA-NEEDS-FOR-UI.md #2). asset_contexts reports volume_24h in
    // QUOTE units (USD) — verified live: BTC volume_24h ≈ 15.79M against a $63k
    // price; multiplying by mark price again produced trillion-dollar headers.
    // change24hPct is already a percentage.
    const dayStats = await dayStatsPromise;
    const enriched = markets.map((market) => {
      const stats = dayStats.get(market.name.toUpperCase());
      const volume24hUsd = stats?.volume24h ?? null;
      const volume24h =
        volume24hUsd !== null && market.markPrice
          ? volume24hUsd / market.markPrice
          : null;
      return {
        ...market,
        volume24h,
        volume24hUsd,
        change24hPct: stats?.change24hPct ?? null,
      };
    });

    return NextResponse.json({
      network,
      markets: enriched,
      latencyMs: Date.now() - startedAt,
      sources,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch Decibel markets";
    return NextResponse.json(fallbackMarkets(message, network), {
      headers: NO_STORE_HEADERS,
    });
  }
}
