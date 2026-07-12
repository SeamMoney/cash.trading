/**
 * GET /api/launchpad/price-tick?asset=BTC/USD
 * Returns the latest price from Pyth Hermes for a given asset.
 * No on-chain interaction — pure HTTP fetch from Hermes.
 */
import { NextRequest, NextResponse } from "next/server";
import { PYTH_HERMES_URL, PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-price-tick", 120, 60_000);
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
  const asset = url.searchParams.get("asset") || "BTC/USD";

  const feedId = Object.hasOwn(PYTH_FEED_IDS, asset) ? PYTH_FEED_IDS[asset] : null;
  if (!feedId) {
    return NextResponse.json(
      { error: "unsupported asset" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const res = await fetch(
      `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`,
      {
        cache: "no-store",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(5_000)]),
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Pyth Hermes returned ${res.status}` },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await res.json() as {
      parsed?: Array<{ price?: { price?: unknown; expo?: unknown; publish_time?: unknown } }>;
    };
    const parsed = data.parsed?.[0]?.price;
    if (!parsed) {
      return NextResponse.json(
        { error: "no price data returned from Pyth" },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const price = Number(parsed.price) * Math.pow(10, Number(parsed.expo));
    const timestamp = Number(parsed.publish_time);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) || timestamp <= 0) {
      return NextResponse.json(
        { error: "Pyth returned invalid price data" },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { price, asset, timestamp },
      { headers: { "Cache-Control": "s-maxage=1, stale-while-revalidate=1" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pyth price lookup failed";
    console.error("[launchpad-price-tick] upstream failed:", message);
    return NextResponse.json(
      { error: "Pyth price is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
