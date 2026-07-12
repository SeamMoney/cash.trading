import { NextRequest } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { fetchRecentBtcCandles } from "@/lib/btc-history";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "btc-candles", 60, 60_000);
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
  const rawLimit = searchParams.get("limit") ?? "300";
  if (!/^\d{1,4}$/.test(rawLimit)) {
    return Response.json(
      { error: "limit must be an integer from 1 to 1000" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    return Response.json(
      { error: "limit must be an integer from 1 to 1000" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const candles = await fetchRecentBtcCandles(limit);
    return Response.json(
      {
        candles,
        ...(candles.length === 0 ? { unavailable: true } : {}),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return Response.json(
      { error: "Failed to fetch candles" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
