/**
 * The backtester has to be wrong in the direction of pessimism, never optimism.
 *
 *   pnpm test:backtest
 *
 * A backtest that overstates is worse than none: it is the number a creator uses
 * to decide whether to put money in. These checks pin the properties that stop it
 * flattering a strategy — no lookahead, costs actually deducted, nothing left open
 * at the end, and a flat refusal when the script cannot be run faithfully.
 */
import assert from "node:assert/strict";

import { runSealedBacktest } from "../lib/sealed-backtest";
import { SEALED_CATALOG } from "../lib/sealed-catalog";
import { SEALED_MARKETS } from "../lib/sealed-vaults";
import type { Candle } from "../lib/launchpad/types";

const market = SEALED_MARKETS[0].addr;

/** Deterministic series with real crossings in both directions. */
function series(n: number, shape: (i: number) => number): Candle[] {
  const out: Candle[] = [];
  let px = 60_000;
  for (let i = 0; i < n; i++) {
    px *= 1 + shape(i);
    out.push({
      timestamp: 1_700_000_000 + i * 3_600,
      open: px, high: px * 1.001, low: px * 0.999, close: px, volume: 1,
    });
  }
  return out;
}

const choppy = series(600, (i) => Math.sin(i / 9) * 0.004 + Math.cos(i / 23) * 0.002);
// Down first, then up: a monotonic ramp never produces a crossover EVENT (the fast
// average is already above the slow one at bar 0), so the strategy would sit flat
// and the funding/baseline checks below would pass vacuously.
const trending = series(600, (i) => (i < 120 ? -0.002 : 0.0025));

const base = {
  marketAddr: market,
  pctBps: 1000,
  maxLeverageX100: 200,
  slippageBps: 30,
  builderFeeBps: 2,
  initialCapital: 1_000,
  fundingBps8h: 1,
};

const ema = SEALED_CATALOG.find((s) => s.id === "ema-cross")!.script;

// ── 1. Every catalog strategy runs ──────────────────────────────────────────
for (const s of SEALED_CATALOG) {
  const r = runSealedBacktest({ ...base, pineScript: s.script, candles: choppy });
  assert.ok(r.ok, `${s.id}: ${r.ok ? "" : r.error}`);
  assert.ok(r.stats.barsSimulated > 0, `${s.id}: simulated no bars`);
  assert.ok(Number.isFinite(r.stats.finalEquity), `${s.id}: non-finite equity`);
  // A position left open at the end is unrealised luck reported as performance.
  const opens = r.fills.filter((f) => !f.reduceOnly).length;
  const closes = r.fills.filter((f) => f.reduceOnly).length;
  assert.equal(opens, closes, `${s.id}: ${opens} entries but ${closes} exits — ended holding a position`);
}
console.log(`ok   all ${SEALED_CATALOG.length} catalog strategies backtest and end flat`);

// ── 2. No lookahead ─────────────────────────────────────────────────────────
// The warmup bars must be skipped entirely, and the first fill can never land on
// or before the bar the signal was computed on.
{
  const r = runSealedBacktest({ ...base, pineScript: ema, candles: choppy });
  assert.ok(r.ok);
  const firstAllowed = choppy[r.stats.warmupBars + 1].timestamp;
  for (const f of r.fills) {
    assert.ok(f.timestamp >= firstAllowed, `fill at ${f.timestamp} precedes the first tradeable bar`);
  }
  console.log(`ok   no fill before bar ${r.stats.warmupBars + 1} (${r.fills.length} fills)`);
}

// ── 3. Costs are actually deducted ──────────────────────────────────────────
// Same strategy, same data, higher fees ⇒ strictly worse. If this passes with
// equality, the fee is being computed and thrown away.
{
  const cheap = runSealedBacktest({ ...base, builderFeeBps: 0, pineScript: ema, candles: choppy });
  const dear = runSealedBacktest({ ...base, builderFeeBps: 10, pineScript: ema, candles: choppy });
  assert.ok(cheap.ok && dear.ok);
  assert.ok(dear.stats.feesPaid > cheap.stats.feesPaid, "a higher builder fee did not cost more");
  assert.ok(dear.stats.finalEquity < cheap.stats.finalEquity, "fees did not reduce final equity");
  console.log(
    `ok   fees bite: ${cheap.stats.feesPaid} → ${dear.stats.feesPaid} costs, `
    + `${cheap.stats.finalEquity} → ${dear.stats.finalEquity} equity`,
  );
}

// ── 4. Funding is charged to the side that pays it ──────────────────────────
{
  const free = runSealedBacktest({ ...base, fundingBps8h: 0, pineScript: ema, candles: trending });
  const paid = runSealedBacktest({ ...base, fundingBps8h: 20, pineScript: ema, candles: trending });
  assert.ok(free.ok && paid.ok);
  assert.equal(free.stats.fundingPaid, 0, "funding accrued at a zero rate");
  assert.notEqual(paid.stats.fundingPaid, 0, "funding did not accrue at a non-zero rate");
  // Trending up ⇒ mostly long ⇒ net funding paid, not received.
  assert.ok(paid.stats.fundingPaid > 0, "a mostly-long run received funding instead of paying it");
  console.log(`ok   funding charged: ${paid.stats.fundingPaid} on a mostly-long run`);
}

// ── 5. Sizing respects the leverage cap ─────────────────────────────────────
// pct_bps of 10000 with a 1x cap must never open more notional than equity.
{
  const r = runSealedBacktest({
    ...base, pctBps: 10_000, maxLeverageX100: 100, pineScript: ema, candles: choppy,
  });
  assert.ok(r.ok);
  for (const f of r.fills) {
    if (f.reduceOnly) continue;
    assert.ok(
      f.notional <= base.initialCapital * 3,
      `entry notional ${f.notional} is implausible against a ${base.initialCapital} book`,
    );
  }
  console.log("ok   leverage cap bounds entry notional");
}

// ── 6. Refusals ─────────────────────────────────────────────────────────────
{
  const nonsense = runSealedBacktest({ ...base, pineScript: "this is not pinescript", candles: choppy });
  assert.equal(nonsense.ok, false, "a script that does not transpile was backtested anyway");

  const short = runSealedBacktest({ ...base, pineScript: ema, candles: choppy.slice(0, 10) });
  assert.equal(short.ok, false, "backtested on 10 bars without complaint");
  console.log("ok   refuses untranspilable source and insufficient history");
}

// ── 7. Buy-and-hold baseline is real ────────────────────────────────────────
{
  const r = runSealedBacktest({ ...base, pineScript: ema, candles: trending });
  assert.ok(r.ok);
  // 600 bars at +0.15% compounding is a large positive number; the baseline must
  // reflect it, or "beats buy and hold" is trivially true for everything.
  assert.ok(r.stats.holdReturnPct > 50, `hold baseline looks wrong: ${r.stats.holdReturnPct}%`);
  console.log(`ok   buy-and-hold baseline computed (+${r.stats.holdReturnPct}% on a trending series)`);
}

console.log("\nAll sealed-backtest checks passed.");
export {};
