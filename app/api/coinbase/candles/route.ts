import { NextRequest } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MAX_RANGE_SECONDS = 300 * 60;
const SUPPORTED_GRANULARITIES = new Set([60, 300, 900, 3_600, 21_600, 86_400]);
const COINBASE_TIMEOUT_MS = 8_000;

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "coinbase-candles", 30, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const rawGranularity = searchParams.get("granularity") ?? "60";
  const rawStart = searchParams.get("start");
  const rawEnd = searchParams.get("end");
  const granularity = Number(rawGranularity);
  const now = Math.floor(Date.now() / 1_000);
  const end = rawEnd === null ? now : Number(rawEnd);
  const requestedStart = rawStart === null ? end - 120 * 60 : Number(rawStart);

  if (
    !SUPPORTED_GRANULARITIES.has(granularity) ||
    !Number.isInteger(end) ||
    !Number.isInteger(requestedStart) ||
    end <= 0 ||
    requestedStart <= 0 ||
    requestedStart >= end ||
    end > now + 300
  ) {
    return Response.json(
      { candles: [], unavailable: true, reason: "Candle range or granularity is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const start = Math.max(requestedStart, end - MAX_RANGE_SECONDS);

  if (!productId || !/^[A-Z0-9-]{1,32}$/.test(productId)) {
    return Response.json(
      { candles: [], unavailable: true, reason: "A valid productId is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/candles`);
    url.searchParams.set("granularity", String(granularity));
    url.searchParams.set("start", new Date(start * 1000).toISOString());
    url.searchParams.set("end", new Date(end * 1000).toISOString());

    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(COINBASE_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Coinbase candles request failed (${response.status})`);
    }

    const raw = (await response.json()) as unknown;
    const candles = Array.isArray(raw) ? raw : [];
    return Response.json({ candles }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Coinbase candles";
    console.error("[coinbase-candles] upstream failed:", message);
    return Response.json(
      { candles: [], unavailable: true, reason: "Coinbase candles are temporarily unavailable" },
      { headers: NO_STORE_HEADERS },
    );
  }
}
