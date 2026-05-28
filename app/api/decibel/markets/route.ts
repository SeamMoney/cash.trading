import { NextResponse } from "next/server";
import { getFastMarkets } from "@/lib/decibel-chain";
import { MARKETS, getReadDex } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REST_MARKETS_TIMEOUT_MS = 750;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function fallbackMarkets(error: string) {
  return {
    degraded: true,
    error,
    markets: Object.entries(MARKETS).map(([name, config]) => ({
      name,
      address: config.address,
      markPrice: null,
      midPrice: null,
      oraclePrice: null,
      fundingRateBps: null,
      isFundingPositive: null,
      openInterest: null,
      priceUpdatedAt: null,
      maxLeverage: config.maxLeverage,
      tickSize: config.tickSize,
      minSize: config.minSizeRaw,
      lotSize: config.lotSize,
      mode: "Unavailable",
      szDecimals: config.sizeDecimals,
      pxDecimals: config.priceDecimals,
      source: "static",
    })),
  };
}

async function fetchRestMarketPriceMap() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_MARKETS_TIMEOUT_MS);
  try {
    const dex = getReadDex();
    const prices = await dex.marketPrices.getAll({
      fetchOptions: { signal: controller.signal },
    });
    const priceMap = new Map<string, Record<string, unknown>>();
    for (const price of prices) {
      const market = (price as Record<string, unknown>).market;
      if (typeof market === "string") {
        priceMap.set(market.toLowerCase(), price as Record<string, unknown>);
      }
    }
    return priceMap;
  } catch {
    return null;
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
export async function GET() {
  const startedAt = Date.now();

  try {
    const [chainMarkets, restPrices] = await Promise.all([
      getFastMarkets(),
      fetchRestMarketPriceMap(),
    ]);

    const markets = chainMarkets.map((market) => {
      const rest = restPrices?.get(market.address.toLowerCase());
      return {
        ...market,
        markPrice:
          rest?.mark_px == null ? market.markPrice : Number(rest.mark_px),
        midPrice: rest?.mid_px == null ? market.midPrice : Number(rest.mid_px),
        oraclePrice:
          rest?.oracle_px == null
            ? market.oraclePrice
            : Number(rest.oracle_px),
        fundingRateBps:
          rest?.funding_rate_bps == null
            ? market.fundingRateBps
            : Number(rest.funding_rate_bps),
        isFundingPositive:
          rest?.is_funding_positive == null
            ? market.isFundingPositive
            : Boolean(rest.is_funding_positive),
        openInterest:
          rest?.open_interest == null
            ? market.openInterest
            : Number(rest.open_interest),
        priceUpdatedAt:
          rest?.transaction_unix_ms == null
            ? market.priceUpdatedAt
            : Number(rest.transaction_unix_ms),
        source: rest ? "chain+rest" : market.source,
      };
    });

    return NextResponse.json({
      markets,
      latencyMs: Date.now() - startedAt,
      sources: {
        config: "chain",
        markOracle: "chain",
        enrichment: restPrices ? "rest" : "unavailable",
      },
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch Decibel markets";
    return NextResponse.json(fallbackMarkets(message), {
      headers: NO_STORE_HEADERS,
    });
  }
}
