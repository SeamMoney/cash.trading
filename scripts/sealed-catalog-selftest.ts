/**
 * Every catalog strategy must actually commit. Offering one the commit step
 * rejects is a dead end the user cannot debug, so this is a hard gate.
 *
 *   pnpm test:catalog
 */
import assert from "node:assert/strict";
import { SEALED_CATALOG } from "../lib/sealed-catalog";
import { commitProgram, SEALED_MARKETS } from "../lib/sealed-vaults";

let failures = 0;
const market = SEALED_MARKETS[0];
console.log(`\ncatalog: ${SEALED_CATALOG.length} strategies, market ${market.name}\n`);

const seen = new Set<string>();
for (const s of SEALED_CATALOG) {
  if (seen.has(s.id)) {
    console.error(`  FAIL duplicate id ${s.id}`);
    failures++;
  }
  seen.add(s.id);
  const r = commitProgram({ pine: s.script, marketAddr: market.addr });
  if (r.ok) {
    console.log(`  ok   ${s.label.padEnd(26)} ${r.commitment.slice(0, 18)}… (${r.warmupBars} bar warmup)`);
  } else {
    failures++;
    console.error(`  FAIL ${s.label}: ${r.error}`);
    for (const e of r.errors ?? []) console.error(`         • ${e}`);
  }
  if (!s.blurb || s.blurb.length > 90) {
    failures++;
    console.error(`  FAIL ${s.label}: blurb must be present and <= 90 chars`);
  }
}


// ── Blurbs must match the code ──────────────────────────────────────────────
// Every catalog script calls strategy.entry(..., strategy.short), but the blurbs originally
// described only the long leg — "goes long when the fast average crosses above the slow one".
// A creator commits capital on the strength of that sentence, so an incomplete one understates
// the risk of the product. This fails the build if the two ever drift apart again.
for (const s of SEALED_CATALOG) {
  const takesLong = /strategy\.long/.test(s.script);
  const takesShort = /strategy\.short/.test(s.script);
  const claimed =
    takesLong && takesShort ? "Long/short" : takesShort ? "Short only" : "Long only";
  assert.equal(
    s.direction,
    claimed,
    `${s.id}: declares "${s.direction}" but the script takes ${claimed.toLowerCase()}`,
  );
  if (takesShort) {
    assert.ok(
      /short/i.test(s.blurb),
      `${s.id}: the script enters shorts but the blurb never says so — "${s.blurb}"`,
    );
  }
  assert.ok(s.blurb.length <= 90, `${s.id}: blurb too long for the dropdown`);
  assert.ok(s.category && s.turnover, `${s.id}: missing category/turnover metadata`);
}
console.log(`catalog metadata: ${SEALED_CATALOG.length} strategies, blurbs match their scripts`);

// ── Every strategy must actually draw ───────────────────────────────────────
// A script that computes an EMA but never plots it renders as a bare candle chart.
// That is what the whole catalog used to do, and it read as "the preview is broken".
// Run each one through the same runtime the preview uses and require real output.
import { runOwnRuntime } from "../lib/launchpad/pinets-runner";
import type { Candle } from "../lib/launchpad/types";

const candles: Candle[] = [];
{
  // Deterministic synthetic series — a sine with enough amplitude to force
  // crossings in both directions, so entry AND exit signals are exercised.
  let px = 60_000;
  for (let i = 0; i < 400; i++) {
    px *= 1 + Math.sin(i / 9) * 0.004 + Math.cos(i / 23) * 0.002;
    candles.push({
      timestamp: 1_700_000_000 + i * 3_600,
      open: px, high: px * 1.002, low: px * 0.998, close: px, volume: 1,
    });
  }
}

for (const s of SEALED_CATALOG) {
  assert.match(s.script, /\bplot\(/, `${s.id}: script never calls plot() — nothing would draw`);
  assert.ok(s.draws && s.draws.length <= 70, `${s.id}: missing or overlong "draws" description`);

  const r = runOwnRuntime(s.script, candles);
  assert.ok(r, `${s.id}: the preview runtime produced nothing`);

  // Every plotted series must carry data. A destructured series (`[macd, sig, hist] =
  // ta.macd(...)`) used to plot as an empty line because the parser dropped the
  // destructuring statement entirely, so this specifically guards that regression.
  const plotted = (s.script.match(/plot\(/g) ?? []).length;
  assert.equal(r.plots.length, plotted, `${s.id}: ${plotted} plot() calls but ${r.plots.length} series`);
  for (const p of r.plots) {
    assert.ok(p.data.length > 0, `${s.id}: plot "${p.title}" produced no points`);
  }

  // hline() must survive as a guide, fill() as a band.
  const hlines = (s.script.match(/hline\(/g) ?? []).length;
  assert.equal(r.guides.length, hlines, `${s.id}: ${hlines} hline() calls but ${r.guides.length} guides`);
  const fillCalls = (s.script.match(/\bfill\(/g) ?? []).length;
  assert.equal(r.fills.length, fillCalls, `${s.id}: ${fillCalls} fill() calls but ${r.fills.length} bands`);

  // Entry signals become the buy/sell markers on the chart. Zero markers is the
  // symptom of the parser mis-scoping if-block bodies.
  assert.ok(r.labels.length > 0, `${s.id}: produced no entry signals to mark on the chart`);
  if (s.direction === "Long/short") {
    assert.ok(
      r.labels.some((l) => l.style.includes("up")) && r.labels.some((l) => l.style.includes("down")),
      `${s.id}: declares long/short but only produced one side of signal`,
    );
  }
}
console.log(`catalog visuals: every strategy plots, and every plot has data`);

console.log(failures === 0 ? "\nAll catalog strategies commit." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
export {};
