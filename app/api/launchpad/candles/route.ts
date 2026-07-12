/**
 * GET /api/launchpad/candles?asset=BTC/USD&resolution=D&days=180
 * Proxies Pyth Benchmarks TradingView shim — avoids client-side CORS.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import type { CandleResolution } from "@/lib/launchpad/types";
import { PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";

const VALID_RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "240", "D"]);
const MAX_DAYS_BY_RESOLUTION: Record<string, number> = {
  "1": 3,
  "5": 14,
  "15": 30,
  "30": 60,
  "60": 180,
  "240": 365,
  D: 365,
};
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-candles", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const url = new URL(req.url);
  const asset      = url.searchParams.get("asset")      || "BTC/USD";
  const resolution = url.searchParams.get("resolution") || "D";
  const rawDays = url.searchParams.get("days") || "180";
  const days = Number(rawDays);

  if (
    !Object.hasOwn(PYTH_FEED_IDS, asset) ||
    !VALID_RESOLUTIONS.has(resolution) ||
    !/^\d{1,3}$/.test(rawDays) ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > (MAX_DAYS_BY_RESOLUTION[resolution] ?? 0)
  ) {
    return NextResponse.json(
      { error: "asset, resolution, or days is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const toTs   = Math.floor(Date.now() / 1000);
  const fromTs = toTs - days * 24 * 3600;

  try {
    const candles = await fetchPythCandles(
      asset,
      resolution as CandleResolution,
      fromTs,
      toTs,
      AbortSignal.any([req.signal, AbortSignal.timeout(10_000)]),
    );
    return NextResponse.json({ candles }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pyth candle lookup failed";
    console.error("[launchpad-candles] upstream failed:", message);
    return NextResponse.json(
      { error: "Pyth candles are temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
