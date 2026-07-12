import { NextRequest } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "coinbase-ticker", 120, 60_000);
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

  if (!productId || !/^[A-Z0-9-]{1,32}$/.test(productId)) {
    return Response.json(
      { price: null, unavailable: true, reason: "A valid productId is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const response = await fetch(
      `https://api.exchange.coinbase.com/products/${productId}/ticker`,
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) {
      throw new Error(`Coinbase ticker request failed (${response.status})`);
    }

    const data = (await response.json()) as { price?: string };
    const price = Number(data.price);
    return Response.json(
      { price: Number.isFinite(price) && price > 0 ? price : null },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Coinbase ticker";
    console.error("[coinbase-ticker] upstream failed:", message);
    return Response.json(
      { price: null, unavailable: true, reason: "Coinbase ticker is temporarily unavailable" },
      { headers: NO_STORE_HEADERS },
    );
  }
}
