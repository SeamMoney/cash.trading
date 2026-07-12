import { NextResponse } from "next/server";
import { runRandomizedBacktests, runBacktest } from "@/lib/launchpad/keeper";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import { PYTH_FEED_IDS } from "@/lib/launchpad/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const APTOS_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "A JSON request body is required" }, { status: 400 });
    }

    const indicatorAddr = typeof body.indicatorAddr === "string" ? body.indicatorAddr : "";
    if (!APTOS_ADDRESS_RE.test(indicatorAddr)) {
      return NextResponse.json({ error: "A valid indicatorAddr is required" }, { status: 400 });
    }

    const numSims = Number(body.numSims ?? 100);
    if (!Number.isInteger(numSims) || numSims < 1 || numSims > 10_000) {
      return NextResponse.json({ error: "numSims must be an integer from 1 to 10,000" }, { status: 400 });
    }

    const params = body.params ?? [10, 30];
    if (
      !Array.isArray(params) ||
      params.length < 1 ||
      params.length > 8 ||
      params.some((value) => !Number.isInteger(value) || value < 1 || value > 1_000)
    ) {
      return NextResponse.json(
        { error: "params must contain 1 to 8 positive integers no greater than 1,000" },
        { status: 400 },
      );
    }

    const asset = typeof body.asset === "string" ? body.asset : "BTC/USD";
    if (!(asset in PYTH_FEED_IDS)) {
      return NextResponse.json({ error: "Unsupported backtest asset" }, { status: 400 });
    }

    const indicatorType = Number(body.indicatorType ?? 0);
    if (!Number.isInteger(indicatorType) || indicatorType < 0 || indicatorType > 4) {
      return NextResponse.json({ error: "indicatorType must be an integer from 0 to 4" }, { status: 400 });
    }

    const startSeed = body.startSeed;
    const seedText = startSeed === undefined ? String(Date.now()) : String(startSeed);
    if (!/^\d{1,30}$/.test(seedText)) {
      return NextResponse.json({ error: "startSeed must be a positive integer" }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);
    const twoYearsAgo = now - 730 * 24 * 3600;
    // Daily candles over 2 years — captures major trends, better signal-to-noise for SMA crossover
    const candles = await fetchPythCandles(asset, "D", twoYearsAgo, now);

    if (candles.length < 100) {
      return NextResponse.json(
        { error: `Insufficient candle data: ${candles.length} candles. Pyth may be rate-limited, try again.` },
        { status: 400 },
      );
    }

    const seed = BigInt(seedText);

    // Baseline run (unshuffled) — used for equity curve
    const baseLine = runBacktest({ candles, params, initialCapital: 10000, positionSizePct: 100, indicatorType });

    // Monte Carlo randomized
    const results = runRandomizedBacktests(candles, params, numSims, seed, indicatorType);

    const profitable = results.filter((r) => r.profitable).length;
    const meanSharpe = results.reduce((s, r) => s + r.sharpe, 0) / results.length;
    const meanReturn = results.reduce((s, r) => s + r.returnBps, 0) / results.length;
    const maxDrawdown = Math.max(...results.map((r) => r.maxDrawdownBps));
    const profitablePct = Math.round((profitable / results.length) * 100);

    const sharpeScore = Math.min(40, Math.round((meanSharpe / 3000) * 40));
    const profitScore = Math.round((profitablePct / 100) * 40);
    const coverageScore = Math.min(20, Math.round((numSims / 10000) * 20));
    const robustnessScore = sharpeScore + profitScore + coverageScore;

    return NextResponse.json({
      success: true,
      indicatorAddr,
      summary: {
        totalSims: numSims,
        profitableCount: profitable,
        profitablePct,
        meanSharpe: Math.round(meanSharpe),
        meanReturnBps: Math.round(meanReturn),
        maxDrawdownBps: maxDrawdown,
        robustnessScore,
        seed: seed.toString(),
        candlesUsed: candles.length,
      },
      equityCurve: baseLine.equityCurve,
      results: results.slice(0, 50).map((r, i) => ({
        simId: i,
        sharpe: r.sharpe,
        returnBps: r.returnBps,
        maxDrawdownBps: r.maxDrawdownBps,
        profitable: r.profitable,
        trades: r.trades,
        winRate: Math.round(r.winRate * 100),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backtest failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
