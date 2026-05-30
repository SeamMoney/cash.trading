import { NextResponse } from "next/server";
import { getFastMarkets } from "@/lib/decibel-chain";
import { getReadDex, type DecibelNetwork } from "@/lib/decibel";

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

async function fetchSdkMarkets(network: DecibelNetwork) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_MARKETS_TIMEOUT_MS);
  try {
    const dex = getReadDex(network);
    const [markets, prices] = await Promise.all([
      dex.markets.getAll({ fetchOptions: { signal: controller.signal } }),
      dex.marketPrices.getAll({ fetchOptions: { signal: controller.signal } }),
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
    let markets = await fetchSdkMarkets(network);
    let sources = {
      config: "sdk",
      markOracle: "rest",
      enrichment: "rest",
    };

    if (markets.length === 0) {
      const chainMarkets = await getFastMarkets(network);
      markets = chainMarkets.map((market) => ({ ...market, source: market.source }));
      sources = {
        config: "chain",
        markOracle: "chain",
        enrichment: "unavailable",
      };
    }

    return NextResponse.json({
      network,
      markets,
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
