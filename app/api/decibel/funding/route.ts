import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  DECIBEL_BASE,
  getDecibelApiKey,
  resolveMarketAddress,
} from "@/lib/decibel-market-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/** Upstream prices row for one market (funding + mark/oracle/mid/OI). */
interface PricesRow {
  market: string;
  oracle_px: number;
  mark_px: number;
  mid_px: number;
  funding_rate_bps: number;
  is_funding_positive: boolean;
  funding_period_s: number;
  transaction_unix_ms: number;
  open_interest: number;
}

function unavailable(reason: string) {
  return NextResponse.json(
    { unavailable: true, reason, fetchedAt: Date.now() },
    { headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "funding", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }
  const market = req.nextUrl.searchParams.get("market") ?? "";
  if (!market) {
    return NextResponse.json(
      { error: "market is required (name like BTC/USD or a 0x market address)" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const apiKey = getDecibelApiKey();
  if (!apiKey) {
    return unavailable("missing_api_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const marketAddr = await resolveMarketAddress(market, apiKey, controller.signal);
    if (!marketAddr) {
      return NextResponse.json(
        { error: `unknown market: ${market}` },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const res = await fetch(`${DECIBEL_BASE}/prices?market=${marketAddr}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`prices returned ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    const row = (Array.isArray(data) ? data[0] : undefined) as PricesRow | undefined;
    if (!row || typeof row.funding_rate_bps !== "number") {
      return unavailable("empty_series");
    }

    // funding_rate_bps is the per-period magnitude; sign comes separately.
    const signedRateBps = row.is_funding_positive
      ? row.funding_rate_bps
      : -row.funding_rate_bps;

    return NextResponse.json(
      {
        market: marketAddr,
        fundingRateBps: signedRateBps,
        fundingPeriodS: row.funding_period_s,
        markPx: row.mark_px,
        oraclePx: row.oracle_px,
        midPx: row.mid_px,
        openInterest: row.open_interest,
        asOf: row.transaction_unix_ms,
        fetchedAt: Date.now(),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream_unavailable";
    return unavailable(reason);
  } finally {
    clearTimeout(timer);
  }
}
