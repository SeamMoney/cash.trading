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
import { requestedLeverageX100, requestedPctBps } from "@/lib/pine-declarations";
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

  // A portfolio vault runs the same program on every market in its allowlist, so a backtest
  // of one market would understate both the diversification and the correlated drawdown. Take
  // the list; a single-market vault is just the one-element case.
  const rawAssets = Array.isArray(body.assets) && body.assets.length > 0
    ? body.assets
    : [typeof body.asset === "string" ? body.asset : "BTC/USD"];
  if (rawAssets.length > 8) return bad("at most 8 markets can be backtested at once");
  const assets: string[] = [];
  for (const a of rawAssets) {
    if (typeof a !== "string" || !Object.hasOwn(PYTH_FEED_IDS, a)) {
      return bad(`Unsupported asset: ${String(a)}`);
    }
    if (!assets.includes(a)) assets.push(a);
  }
  const asset = assets[0];

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

  const { code, days } = WINDOWS[windowKey];
  const now = Math.floor(Date.now() / 1000);
  const series = new Map<string, Awaited<ReturnType<typeof fetchPythCandles>>>();
  for (const a of assets) {
    try {
      series.set(
        a,
        await fetchPythCandles(
          a,
          code,
          now - days * 86_400,
          now,
          AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
        ),
      );
    } catch {
      return bad(`Price history for ${a} is unavailable right now — try again in a moment`, 502);
    }
  }

  // A script that declares its own size or leverage must be backtested with THOSE numbers,
  // not the vault's defaults — otherwise the backtest measures a strategy the live vault will
  // not run, which is the one thing a backtest must never do. Both are still clamped by the
  // form controls' values, exactly as the contract clamps them on chain.
  const effectivePctBps = Math.min(requestedPctBps(pineScript) ?? pctBps, pctBps);
  const effectiveLeverageX100 = Math.min(
    requestedLeverageX100(pineScript) ?? maxLeverageX100,
    maxLeverageX100,
  );

  // Quote our own builder fee from the chain rather than a constant, so the cost
  // side of the backtest matches what the vault will really be charged.
  let builderFeeBps = 2;
  try {
    builderFeeBps = (await readPlatformTerms()).builderFeeBps;
  } catch {
    /* fall through to the default — a stale fee is better than no backtest */
  }

  // Capital is SPLIT across markets, not replicated. Running each leg on the full balance and
  // summing would report the returns of N vaults, not of one vault holding N positions — an
  // N-fold overstatement dressed as diversification.
  const perMarket = initialCapital / assets.length;
  const legs: Array<{ asset: string; result: ReturnType<typeof runSealedBacktest> }> = [];
  for (const a of assets) {
    legs.push({
      asset: a,
      result: runSealedBacktest({
        pineScript,
        candles: series.get(a) ?? [],
        marketAddr: SEALED_MARKETS.find((m) => m.name === a)?.addr ?? SEALED_MARKETS[0]?.addr ?? "0x1",
        pctBps: effectivePctBps,
        maxLeverageX100: effectiveLeverageX100,
        slippageBps,
        builderFeeBps,
        initialCapital: perMarket,
        fundingBps8h,
      }),
    });
  }

  const ok = legs.filter((l) => l.result.ok) as Array<{
    asset: string;
    result: Extract<ReturnType<typeof runSealedBacktest>, { ok: true }>;
  }>;
  if (ok.length === 0) {
    const first = legs[0].result as Extract<ReturnType<typeof runSealedBacktest>, { ok: false }>;
    return bad(first.error, 422, first.detail);
  }

  const combined = combineLegs(ok, initialCapital);

  return NextResponse.json(
    {
      ok: true,
      asset,
      assets,
      window: windowKey,
      builderFeeBps,
      /** Echoed so the panel can say when the SCRIPT chose these, not the form. */
      effectivePctBps,
      effectiveLeverageX100,
      scriptChoseSizing: requestedPctBps(pineScript) !== null,
      scriptChoseLeverage: requestedLeverageX100(pineScript) !== null,
      ...combined,
      /** Per-market breakdown, so a portfolio result cannot hide one market carrying it. */
      perMarket: ok.map((l) => ({
        asset: l.asset,
        returnPct: l.result.stats.returnPct,
        holdReturnPct: l.result.stats.holdReturnPct,
        trades: l.result.stats.trades,
        maxDrawdownPct: l.result.stats.maxDrawdownPct,
      })),
      /** Markets that could not be simulated at all, named rather than silently dropped. */
      unavailable: legs
        .filter((l) => !l.result.ok)
        .map((l) => ({
          asset: l.asset,
          error: (l.result as Extract<ReturnType<typeof runSealedBacktest>, { ok: false }>).error,
        })),
    },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * Fold per-market legs into one portfolio result.
 *
 * Equity curves are summed on a UNION of timestamps with each leg's last known value carried
 * forward — markets have different bar counts and gaps, and inner-joining would silently drop
 * every bar where any one feed was missing, shortening the window without saying so.
 */
function combineLegs(
  legs: Array<{ asset: string; result: Extract<ReturnType<typeof runSealedBacktest>, { ok: true }> }>,
  initialCapital: number,
) {
  if (legs.length === 1) {
    const only = legs[0].result;
    return { equityCurve: only.equityCurve, fills: only.fills, stats: only.stats, assumptions: only.assumptions };
  }

  const times = [...new Set(legs.flatMap((l) => l.result.equityCurve.map((p) => p.t)))].sort((a, b) => a - b);
  const cursors = legs.map(() => 0);
  const last = legs.map((l) => l.result.equityCurve[0]?.v ?? 0);
  const equityCurve: Array<{ t: number; v: number }> = [];
  for (const t of times) {
    legs.forEach((l, i) => {
      const c = l.result.equityCurve;
      while (cursors[i] < c.length && c[cursors[i]].t <= t) {
        last[i] = c[cursors[i]].v;
        cursors[i]++;
      }
    });
    equityCurve.push({ t, v: Number(last.reduce((s, v) => s + v, 0).toFixed(2)) });
  }

  const sum = (f: (s: Extract<ReturnType<typeof runSealedBacktest>, { ok: true }>["stats"]) => number) =>
    legs.reduce((acc, l) => acc + f(l.result.stats), 0);
  const finalEquity = legs.reduce((acc, l) => acc + l.result.stats.finalEquity, 0);

  // Portfolio drawdown from the COMBINED curve, not the worst leg's. Two markets that draw
  // down at different times partially offset; taking the max per-leg figure would report a
  // loss the portfolio never actually experienced.
  let peak = equityCurve[0]?.v ?? initialCapital;
  let maxDrawdown = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.v);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - p.v) / peak);
  }

  const trades = sum((s) => s.trades);
  const weighted = (f: (s: Extract<ReturnType<typeof runSealedBacktest>, { ok: true }>["stats"]) => number) =>
    legs.reduce((acc, l) => acc + f(l.result.stats) * l.result.stats.trades, 0) / (trades || 1);

  return {
    equityCurve,
    fills: legs.flatMap((l) => l.result.fills).sort((a, b) => a.timestamp - b.timestamp),
    assumptions: legs[0].result.assumptions,
    stats: {
      barsSimulated: Math.max(...legs.map((l) => l.result.stats.barsSimulated)),
      warmupBars: Math.max(...legs.map((l) => l.result.stats.warmupBars)),
      finalEquity: Number(finalEquity.toFixed(2)),
      returnPct: Number(((finalEquity / initialCapital - 1) * 100).toFixed(2)),
      // An equal-weight basket of the same markets — the right baseline for a basket strategy.
      holdReturnPct: Number(
        (legs.reduce((a, l) => a + l.result.stats.holdReturnPct, 0) / legs.length).toFixed(2),
      ),
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(2)),
      // Trade-weighted, so a market with two round trips does not swing the number as much as
      // one with two hundred.
      sharpe: Number(weighted((s) => s.sharpe).toFixed(2)),
      trades,
      winRatePct: Math.round(weighted((s) => s.winRatePct)),
      feesPaid: Number(sum((s) => s.feesPaid).toFixed(2)),
      fundingPaid: Number(sum((s) => s.fundingPaid).toFixed(2)),
      timeInMarketPct: Math.round(sum((s) => s.timeInMarketPct) / legs.length),
      longFills: sum((s) => s.longFills),
      shortFills: sum((s) => s.shortFills),
    },
  };
}
