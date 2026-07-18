import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { getDecibelTradeHistory, type DecibelTrade } from "@/lib/decibel-api";
import { summarizeDecibelFees } from "@/lib/decibel-fees";
import {
  isValidAptosAddress,
  normalizeAptosAddress,
  resolveDecibelNetwork,
} from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const PAGE_SIZE = 500;
const MAX_TRADE_HISTORY = 20_000;

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "decibel-fees", 12, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const rawAddress = request.nextUrl.searchParams.get("address");
  if (!isValidAptosAddress(rawAddress)) {
    return NextResponse.json(
      { error: "A valid Decibel subaccount is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const address = normalizeAptosAddress(rawAddress, "address");
  const network = resolveDecibelNetwork(request.nextUrl.searchParams.get("network"));
  const trades: DecibelTrade[] = [];
  let truncated = false;

  try {
    for (let offset = 0; offset < MAX_TRADE_HISTORY; offset += PAGE_SIZE) {
      const page = await getDecibelTradeHistory(address, {
        network,
        limit: PAGE_SIZE,
        offset,
        strict: true,
      });
      trades.push(...page);
      if (page.length < PAGE_SIZE) break;
      if (offset + PAGE_SIZE >= MAX_TRADE_HISTORY) truncated = true;
    }

    return NextResponse.json(
      {
        ...summarizeDecibelFees(trades),
        address,
        fetchedAt: Date.now(),
        network,
        truncated,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error(
      "[decibel-fees] trade history unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Decibel fee history is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
