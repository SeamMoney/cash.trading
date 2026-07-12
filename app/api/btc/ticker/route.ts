import { NextRequest } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { fetchCurrentBtcPrice } from "@/lib/btc-history";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "btc-ticker", 120, 60_000);
  if (!rate.allowed) {
    return Response.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  try {
    const price = await fetchCurrentBtcPrice();
    return Response.json({ price }, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { error: "Failed to fetch ticker" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
