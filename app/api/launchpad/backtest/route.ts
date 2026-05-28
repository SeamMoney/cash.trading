import { NextResponse } from "next/server";
import { runRandomizedBacktests, runBacktest } from "@/lib/launchpad/keeper";
import { fetchPythCandles } from "@/lib/launchpad/pyth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      indicatorAddr,
      params = [10, 30],
      numSims = 100,
      asset = "BTC/USD",
      timeframe = "60",
      startSeed,
      indicatorType = 0,   // 0=SMA, 1=EMA, 2=RSI, 3=MACD, 4=BB
    } = body;

    if (numSims > 10000) {
      return NextResponse.json({ error: "Max 10,000 simulations per request" }, { status: 400 });
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

    const seed = startSeed ? BigInt(startSeed) : BigInt(Date.now());

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
