import { NextRequest, NextResponse } from "next/server";
import { getReadDex } from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";

/**
 * GET /api/decibel/depth?market=BTC-USD&limit=15
 * Returns orderbook depth when the installed Decibel SDK exposes a real depth
 * read endpoint. Current SDK builds expose websocket subscriptions but no HTTP
 * depth reader, so this route reports unavailable instead of inventing levels.
 */
export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-depth", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterS ?? 60) } },
    );
  }

  const marketParam = req.nextUrl.searchParams.get("market");
  const limitParam = req.nextUrl.searchParams.get("limit") || "15";
  const limit = Number(limitParam);

  if (!marketParam) {
    return NextResponse.json(
      { error: "Missing market parameter (e.g. BTC-USD or BTC/USD)" },
      { status: 400 }
    );
  }

  if (
    !/^[A-Z0-9]{1,12}[/-][A-Z0-9]{1,12}$/i.test(marketParam) ||
    !/^\d{1,3}$/.test(limitParam) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return NextResponse.json(
      { error: "market or limit is invalid" },
      { status: 400 },
    );
  }

  const marketName = marketParam.replace("-", "/");

  try {
    const dex = getReadDex();
    const depthReader = dex.marketDepth as unknown as {
      getByName?: (args: { marketName: string; limit: number }) => Promise<{
        market: string;
        bids: { price: number; size: number }[];
        asks: { price: number; size: number }[];
        unix_ms: number;
      }>;
    };

    if (typeof depthReader.getByName !== "function") {
      return NextResponse.json(
        { error: "Decibel depth data is unavailable in the installed SDK" },
        { status: 503 }
      );
    }

    const depth = await depthReader.getByName({ marketName, limit });
    return NextResponse.json({
      market: depth.market,
      bids: depth.bids,
      asks: depth.asks,
      timestamp: depth.unix_ms,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch orderbook depth";
    console.error("[decibel-depth] lookup failed:", message);
    return NextResponse.json({ error: "Decibel depth data is temporarily unavailable" }, { status: 502 });
  }
}
