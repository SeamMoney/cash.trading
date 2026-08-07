import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  parseTradingViewPopularPage,
  type TradingViewPopularScript,
} from "@/lib/launchpad/tradingview-popular";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_URL = "https://www.tradingview.com/scripts/";
const MAX_HTML_BYTES = 4_000_000;
const CACHE_MS = 10 * 60 * 1_000;

let memoryCache: { at: number; items: TradingViewPopularScript[] } | null = null;

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error("response_too_large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("response_too_large");
  return text;
}

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "launchpad-tv-popular", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterS ?? 60) } },
    );
  }

  if (memoryCache && Date.now() - memoryCache.at < CACHE_MS) {
    return NextResponse.json(
      { items: memoryCache.items, sourceUrl: SOURCE_URL, cached: true },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  }

  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`TradingView returned ${response.status}`);

    const items = parseTradingViewPopularPage(await readTextWithinLimit(response, MAX_HTML_BYTES));
    if (items.length === 0) throw new Error("TradingView returned no script cards");
    memoryCache = { at: Date.now(), items };

    return NextResponse.json(
      { items, sourceUrl: SOURCE_URL, cached: false },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    if (memoryCache?.items.length) {
      return NextResponse.json(
        { items: memoryCache.items, sourceUrl: SOURCE_URL, cached: true, stale: true },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400" } },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load TradingView scripts" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

