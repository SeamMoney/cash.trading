/**
 * POST /api/sealed/backtest
 *
 * Backtest the exact program a vault would commit to, under the exact rules the
 * contract will enforce. Distinct from `/api/launchpad/backtest`, which simulates
 * one of five hardcoded indicator families — for a sealed vault that would report
 * a different strategy's numbers under this strategy's name.
 *
 * The source is used and discarded. Nothing is stored, and a private script stays
 * private: a creator can measure their strategy before deciding to launch it.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import { runSealedBacktest } from "@/lib/sealed-backtest";
import { SEALED_MARKETS, readPlatformTerms } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 40_000;

/** Resolution → (pyth code, days of history, seconds per bar). */
const WINDOWS = {
  "1h": { code: "60", days: 90 },
  "4h": { code: "240", days: 240 },
  "1d": { code: "D", days: 365 },
} as const;
type WindowKey = keyof typeof WINDOWS;

function bad(error: string, status = 400, detail?: string[]) {
  return NextResponse.json({ ok: false, error, detail }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-backtest", 8, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(rate.retryAfterS ?? 60) } },
    );
  }

  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return bad("Script is too large to backtest", 413);
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("A JSON body is required");
    body = parsed as Record<string, unknown>;
  } catch {
    return bad("A JSON body is required");
  }

  const pineScript = typeof body.pineScript === "string" ? body.pineScript : "";
  if (pineScript.trim().length === 0) return bad("pineScript is required");

  const asset = typeof body.asset === "string" ? body.asset : "BTC/USD";
  if (!Object.hasOwn(PYTH_FEED_IDS, asset)) return bad("Unsupported asset");

  const windowKey = (typeof body.window === "string" ? body.window : "1h") as WindowKey;
  if (!Object.hasOwn(WINDOWS, windowKey)) return bad("window must be 1h, 4h or 1d");

  const int = (v: unknown, fallback: number, lo: number, hi: number) => {
    const n = Number(v ?? fallback);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
  };
  const pctBps = int(body.pctBps, 1000, 1, 10_000);
  const maxLeverageX100 = int(body.maxLeverageX100, 200, 100, 2_000);
  const slippageBps = int(body.slippageBps, 30, 0, 500);
  const initialCapital = int(body.initialCapital, 100, 10, 10_000_000);
  // Signed: a strategy that is short most of the time RECEIVES funding when this
  // is positive, so the sign has to survive validation.
  const rawFunding = Number(body.fundingBps8h ?? 1);
  const fundingBps8h = Number.isFinite(rawFunding) && Math.abs(rawFunding) <= 100 ? rawFunding : null;

  if (pctBps === null) return bad("pctBps must be 1–10000");
  if (maxLeverageX100 === null) return bad("maxLeverageX100 must be 100–2000");
  if (slippageBps === null) return bad("slippageBps must be 0–500");
  if (initialCapital === null) return bad("initialCapital must be 10–10,000,000");
  if (fundingBps8h === null) return bad("fundingBps8h must be between -100 and 100");

  const market =
    SEALED_MARKETS.find((m) => m.name === asset)?.addr ?? SEALED_MARKETS[0]?.addr ?? "0x1";

  const { code, days } = WINDOWS[windowKey];
  const now = Math.floor(Date.now() / 1000);
  let candles;
  try {
    candles = await fetchPythCandles(
      asset,
      code,
      now - days * 86_400,
      now,
      AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    );
  } catch {
    return bad("Price history is unavailable right now — try again in a moment", 502);
  }

  // Quote our own builder fee from the chain rather than a constant, so the cost
  // side of the backtest matches what the vault will really be charged.
  let builderFeeBps = 2;
  try {
    builderFeeBps = (await readPlatformTerms()).builderFeeBps;
  } catch {
    /* fall through to the default — a stale fee is better than no backtest */
  }

  const result = runSealedBacktest({
    pineScript,
    candles,
    marketAddr: market,
    pctBps,
    maxLeverageX100,
    slippageBps,
    builderFeeBps,
    initialCapital,
    fundingBps8h,
  });

  if (!result.ok) return bad(result.error, 422, result.detail);

  return NextResponse.json(
    {
      ...result,
      asset,
      window: windowKey,
      builderFeeBps,
    },
    { status: 200, headers: NO_STORE },
  );
}
