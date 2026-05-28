/**
 * GET /api/launchpad/candles?asset=BTC/USD&resolution=D&days=180
 * Proxies Pyth Benchmarks TradingView shim — avoids client-side CORS.
 */
import { NextResponse } from "next/server";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import type { CandleResolution } from "@/lib/launchpad/types";

export const runtime = "nodejs";

const VALID_RESOLUTIONS = new Set(["1", "5", "15", "30", "60", "240", "D"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset      = url.searchParams.get("asset")      || "BTC/USD";
  const resolution = url.searchParams.get("resolution") || "D";
  const days       = Math.min(parseInt(url.searchParams.get("days") || "180"), 365);

  if (!VALID_RESOLUTIONS.has(resolution)) {
    return NextResponse.json({ error: "invalid resolution" }, { status: 400 });
  }

  const toTs   = Math.floor(Date.now() / 1000);
  const fromTs = toTs - days * 24 * 3600;

  try {
    const candles = await fetchPythCandles(asset, resolution as CandleResolution, fromTs, toTs);
    return NextResponse.json({ candles }, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=30" },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
