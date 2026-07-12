import { NextRequest } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";

type CoinbaseTrade = {
  price: string;
  time: string;
  trade_id: number;
};

const PAGE_SIZE = 300;
const MAX_PAGES = 30;
const DEFAULT_TARGET_SPAN_SECS = 8 * 60;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const COINBASE_TRADES_TIMEOUT_MS = 12_000;

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "coinbase-trades", 6, 60_000);
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
  const rawTargetSpan = searchParams.get("targetSpanSecs");
  const targetSpanSecs = rawTargetSpan === null
    ? DEFAULT_TARGET_SPAN_SECS
    : Number(rawTargetSpan);

  if (!productId || !/^[A-Z0-9-]{1,32}$/.test(productId)) {
    return Response.json(
      { error: "A valid productId is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (
    !Number.isInteger(targetSpanSecs) ||
    targetSpanSecs < 60 ||
    targetSpanSecs > 30 * 60
  ) {
    return Response.json(
      { error: "targetSpanSecs must be an integer from 60 to 1800" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const upstreamSignal = AbortSignal.timeout(COINBASE_TRADES_TIMEOUT_MS);
    const trades: Array<{ price: number; transaction_unix_ms: number }> = [];
    const cutoffMs = Date.now() - targetSpanSecs * 1000;
    let afterCursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/trades`);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (afterCursor) {
        url.searchParams.set("after", afterCursor);
      }

      const response = await fetch(url.toString(), {
        cache: "no-store",
        signal: upstreamSignal,
      });
      if (!response.ok) {
        throw new Error(`Coinbase trades request failed (${response.status})`);
      }

      const pageTrades = (await response.json()) as CoinbaseTrade[];
      if (!Array.isArray(pageTrades) || pageTrades.length === 0) break;

      for (const trade of pageTrades) {
        const price = Number(trade.price);
        const transaction_unix_ms = Date.parse(trade.time);
        if (!Number.isFinite(price) || !Number.isFinite(transaction_unix_ms)) continue;
        trades.push({ price, transaction_unix_ms });
      }

      const oldestTime = trades[trades.length - 1]?.transaction_unix_ms ?? Date.now();
      if (oldestTime <= cutoffMs) break;

      afterCursor = response.headers.get("cb-after");
      if (!afterCursor) break;
    }

    trades.sort((a, b) => a.transaction_unix_ms - b.transaction_unix_ms);
    return Response.json({ trades }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Coinbase trades";
    console.error("[coinbase-trades] upstream failed:", message);
    return Response.json(
      { trades: [], unavailable: true, reason: "Coinbase trades are temporarily unavailable" },
      { headers: NO_STORE_HEADERS },
    );
  }
}
