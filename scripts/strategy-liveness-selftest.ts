/**
 * The liveness gate must catch strategies that transpile but do not trade.
 *
 *   pnpm test:liveness
 *
 * Each case below is a real failure that reached production, or the exact shape of one. The
 * gate exists because none of them is visible to the transpiler or to the preview: all three
 * render correct charts and produce a clean commitment.
 */
import assert from "node:assert/strict";

import { checkLiveness } from "../lib/strategy-liveness";
import { SEALED_CATALOG } from "../lib/sealed-catalog";
import { SEALED_MARKETS } from "../lib/sealed-vaults";

const market = SEALED_MARKETS[0].addr;

// ── 1. Every shipped strategy passes ────────────────────────────────────────
for (const s of SEALED_CATALOG) {
  const r = checkLiveness(s.script, market);
  assert.deepEqual(r.problems, [], `${s.id}: ${r.problems.join(" | ")}`);
  assert.ok(r.buys > 0, `${s.id}: no buys`);
  if (s.direction === "Long/short") assert.ok(r.sells > 0, `${s.id}: no sells`);
}
console.log(`ok   all ${SEALED_CATALOG.length} catalog strategies fire through the vault's evaluator`);

// ── 2. Saturating subtraction kills the short leg ───────────────────────────
// The IR lowers `a - b` to a u64 safe_sub that floors at zero, so `< 0` is never true.
{
  const r = checkLiveness(
    `//@version=5\n`
    + `strategy("Sat", overlay=true)\n`
    + `f = ta.ema(close, 10)\n`
    + `s = ta.ema(close, 30)\n`
    + `d = f - s\n`
    + `if (d > 0)\n    strategy.entry("Long", strategy.long)\n`
    + `if (d < 0)\n    strategy.entry("Short", strategy.short)\n`,
    market,
  );
  assert.ok(r.declaresShort, "the fixture must declare a short for this case to mean anything");
  assert.ok(
    r.problems.some((p) => p.includes("short side would be silently dead")),
    `a strategy whose short leg cannot fire was accepted (buys=${r.buys} sells=${r.sells})`,
  );
  // And the message must name the cause, not just the symptom — the fix is non-obvious.
  assert.ok(
    r.problems.some((p) => p.includes("saturates at zero")),
    "the rejection does not explain WHY the short leg is dead",
  );
  console.log("ok   saturating subtraction is caught, with the cause named");
}

// ── 3. A strategy that never signals at all ─────────────────────────────────
{
  const r = checkLiveness(
    `//@version=5\n`
    + `strategy("Never", overlay=true)\n`
    + `f = ta.ema(close, 10)\n`
    + `if (f > 100000000)\n    strategy.entry("Long", strategy.long)\n`
    + `if (f < 0)\n    strategy.entry("Short", strategy.short)\n`,
    market,
  );
  assert.ok(
    r.problems.some((p) => p.includes("never produces a signal")),
    `a strategy that cannot ever fire was accepted (buys=${r.buys} sells=${r.sells})`,
  );
  console.log("ok   a strategy that can never fire is caught");
}

// ── 4. A genuinely long-only strategy is NOT a problem ──────────────────────
// The gate compares the emitted program against what the SOURCE claims. A script that only
// ever asks to go long is keeping its promise, and rejecting it would be a false positive.
{
  const r = checkLiveness(
    `//@version=5\n`
    + `strategy("LongOnly", overlay=true)\n`
    + `f = ta.ema(close, 9)\n`
    + `s = ta.ema(close, 21)\n`
    + `if (ta.crossover(f, s))\n    strategy.entry("Long", strategy.long)\n`,
    market,
  );
  assert.equal(r.declaresShort, false);
  assert.deepEqual(r.problems, [], `long-only was wrongly rejected: ${r.problems.join(" | ")}`);
  assert.ok(r.buys > 0);
  console.log("ok   a genuinely long-only strategy is not flagged");
}

// ── 5. Determinism ──────────────────────────────────────────────────────────
// Two creators committing the same script must get the same verdict, and a re-run must not
// flip a launch decision. The series is synthetic precisely so this holds.
{
  const s = SEALED_CATALOG[0].script;
  const a = checkLiveness(s, market);
  const b = checkLiveness(s, market);
  assert.deepEqual([a.buys, a.sells, a.bars], [b.buys, b.sells, b.bars]);
  console.log(`ok   deterministic (${a.buys} buys / ${a.sells} sells over ${a.bars} bars)`);
}

console.log("\nAll strategy-liveness checks passed.");
export {};
