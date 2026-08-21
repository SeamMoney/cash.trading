/**
 * Personal Strategy Runner — the pure half, proved without a network or a DB.
 *
 *   pnpm test:personal-runner
 *
 * The runner trades a USER's own subaccount off a signal nobody watches in real
 * time, so the parts that decide WHAT it trades have to be provable offline.
 * Everything asserted here is a pure function: `evaluateCatalogSignal`,
 * `pineScriptHash`, and the closed-bar helpers. The stages that need a chain or
 * a database (`cas`, `execute`, `persist`) are deliberately out of scope — this
 * file must stay runnable in CI with no secrets.
 *
 * What it is actually guarding:
 *
 *  1. Every catalog strategy runs through the runner's evaluator with NOTHING
 *     unsupported. An unsupported op means the signal was derived from values
 *     that were never computed, and "neutral" would be a lie.
 *  2. The evaluator REFUSES rather than saying "neutral" when it cannot know:
 *     unknown id, series shorter than warmup, NaN/non-positive closes. A
 *     pre-warmup "neutral" is indistinguishable from a real one, and trading it
 *     is how a runner takes a position on nothing.
 *  3. The script hash the runner re-checks each tick is byte-identical to the
 *     one `/api/bot/start` pins. If the two hashing expressions ever drift, a
 *     catalog edit stops changing what a running bot trades — it silently
 *     changes it. The route's expression is READ FROM ITS SOURCE here so the
 *     drift cannot hide.
 *  4. Self-sizing clamps DOWN only. A script asking 10x under a 3x cap gets 3x.
 *  5. The bar feed drops the in-progress candle. A strategy scored mid-bar
 *     flips sides several times inside one minute and trades every flip.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { evaluateCatalogSignal, pineScriptHash } from "../lib/personal-runner";
import { SEALED_CATALOG, findCatalogStrategy } from "../lib/sealed-catalog";
import { canonicalizePine } from "../lib/sealed-presets";
import {
  CLOSED_BAR_INTERVAL_MS,
  MAX_CLOSED_BARS,
  isClosedBarInterval,
  latestClosedBarOpenMs,
  toClosedBars,
  type ClosedBarInterval,
} from "../lib/decibel-candles";

/**
 * A real market address. The transpiler embeds it in the emitted program, so it
 * has to be a well-formed 32-byte address, but nothing here touches the chain.
 */
const MARKET = "0x161b7b3f58327d057ee5824de0c1a4fc4fa3d121b847c138e921a255768a0dca";

/** Long enough for every catalog warmup (the deepest today is a 200-bar SMA). */
const BARS = 320;

/**
 * Deterministic synthetic closes. `drift` sets the direction, the two waves put
 * enough curvature in it that crossovers and band touches actually happen — a
 * straight line produces no signals at all and would prove nothing.
 */
function series(drift: number, n = BARS): number[] {
  const closes: number[] = [];
  let px = 60_000;
  for (let i = 0; i < n; i++) {
    px *= 1 + drift + Math.sin(i / 9) * 0.004 + Math.cos(i / 23) * 0.002;
    closes.push(px);
  }
  return closes;
}

/**
 * Drift per bar on the trending series. It has to be larger than the wave
 * amplitude above, or the last bar's local wobble decides the signal instead of
 * the trend and "a trend follower is long in an uptrend" stops being true for
 * the reason the name suggests.
 */
const TREND_DRIFT = 0.004;

const UPTREND = series(TREND_DRIFT);
const DOWNTREND = series(-TREND_DRIFT);
/** No drift: mean-reverting AND trend strategies both fire on this one. */
const WAVE = series(0);

for (const [name, s] of [["uptrend", UPTREND], ["downtrend", DOWNTREND], ["wave", WAVE]] as const) {
  assert.ok(s.length >= 250, `${name} series must be at least 250 bars, got ${s.length}`);
  assert.ok(s.every((c) => Number.isFinite(c) && c > 0), `${name} series must be all-positive finite`);
}
assert.ok(UPTREND[UPTREND.length - 1] > UPTREND[0] * 1.2, "uptrend must actually trend up");
assert.ok(DOWNTREND[DOWNTREND.length - 1] < DOWNTREND[0] * 0.8, "downtrend must actually trend down");

const evaluate = (strategyId: string, closes: number[]) =>
  evaluateCatalogSignal({ strategyId, closes, marketAddr: MARKET });

// ── 1. Warmup is discoverable, and the boundary is exact ────────────────────
// The refusal message carries the number, which is what makes a short-series
// refusal debuggable instead of a mystery "neutral". One bar below warmup must
// refuse; exactly warmup must not.
const warmupOf = new Map<string, number>();
for (const entry of SEALED_CATALOG) {
  const tooShort = evaluate(entry.id, [60_000]);
  assert.equal(tooShort.signal, null, `${entry.id}: a 1-bar series must not produce a signal`);
  const reason = tooShort.unsupported[0] ?? "";
  const m = reason.match(/needs (\d+) bars of warmup, got 1$/);
  assert.ok(m, `${entry.id}: refusal must name the warmup it needs, got "${reason}"`);
  const warmup = Number(m[1]);
  assert.ok(warmup >= 1 && warmup < BARS, `${entry.id}: implausible warmup ${warmup}`);
  warmupOf.set(entry.id, warmup);

  const justUnder = evaluate(entry.id, WAVE.slice(0, warmup - 1));
  assert.equal(justUnder.signal, null, `${entry.id}: ${warmup - 1} bars is below warmup and must refuse`);
  assert.notEqual(
    justUnder.signal,
    "neutral",
    `${entry.id}: a pre-warmup evaluation reported "neutral" — that is indistinguishable from a real neutral`,
  );
  assert.ok(justUnder.unsupported.length > 0, `${entry.id}: refusal must carry a reason`);

  const atWarmup = evaluate(entry.id, WAVE.slice(0, warmup));
  assert.notEqual(atWarmup.signal, null, `${entry.id}: exactly ${warmup} bars is warm and must evaluate`);
  assert.deepEqual(atWarmup.unsupported, [], `${entry.id}: warm series still reported unsupported ops`);
}
console.log(
  `warmup: ${SEALED_CATALOG.length} strategies refuse below warmup and evaluate at it `
  + `(${[...warmupOf.values()].sort((a, b) => a - b).join(", ")} bars)`,
);

// ── 2. Every catalog strategy evaluates, on every series ────────────────────
// `unsupported` is populated statically at construction, so an op hidden in a
// branch that never fires on this data still shows up.
const SIGNALS = new Set(["buy", "sell", "neutral"]);
for (const entry of SEALED_CATALOG) {
  for (const [name, closes] of [["uptrend", UPTREND], ["downtrend", DOWNTREND], ["wave", WAVE]] as const) {
    const r = evaluate(entry.id, closes);
    assert.deepEqual(
      r.unsupported,
      [],
      `${entry.id} on ${name}: the runner's evaluator cannot run ${r.unsupported.join(", ")}`,
    );
    assert.notEqual(r.signal, null, `${entry.id} on ${name}: no signal from a ${closes.length}-bar series`);
    assert.ok(SIGNALS.has(String(r.signal)), `${entry.id} on ${name}: bogus signal ${r.signal}`);
  }
}
console.log(`evaluate: ${SEALED_CATALOG.length} strategies × 3 series, all signalled, none unsupported`);

// ── 3. The signals are real, not a constant "neutral" ───────────────────────
// A strategy whose only reachable output is "neutral" would pass everything
// above while being completely dead. Walk prefixes of the wave series through
// the SAME public entry point the cron uses and require both sides to appear.
for (const entry of SEALED_CATALOG) {
  const warmup = warmupOf.get(entry.id)!;
  let sawBuy = false;
  let sawSell = false;
  for (let len = warmup; len <= WAVE.length && !(sawBuy && sawSell); len++) {
    const sig = evaluate(entry.id, WAVE.slice(0, len)).signal;
    if (sig === "buy") sawBuy = true;
    if (sig === "sell") sawSell = true;
  }
  assert.ok(sawBuy, `${entry.id}: never produced a buy — the long leg is dead through evaluateCatalogSignal`);
  assert.ok(sawSell, `${entry.id}: never produced a sell — the short leg is dead through evaluateCatalogSignal`);
}
console.log("liveness: every strategy produces both a buy and a sell through evaluateCatalogSignal");

// A trend follower on a clean trend is the one case where the FINAL bar's
// signal is predictable, so it is asserted directly rather than by scanning.
assert.equal(evaluate("multi-asset-momentum", UPTREND).signal, "buy", "trend follower must be long in an uptrend");
assert.equal(evaluate("multi-asset-momentum", DOWNTREND).signal, "sell", "trend follower must be short in a downtrend");

// ── 4. Refusals ─────────────────────────────────────────────────────────────
// Each of these is a case where the honest answer is "I don't know". Reporting
// "neutral" would close a position, and reporting buy/sell would open one, off
// data the evaluator never had.
const unknown = evaluate("no-such-strategy", WAVE);
assert.equal(unknown.signal, null, "unknown strategy id must not produce a signal");
assert.match(unknown.unsupported[0] ?? "", /unknown catalog strategy: no-such-strategy/);

// Ids are exact: near-misses are unknown ids, not fuzzy matches onto a real script.
for (const near of ["Breakout-Channel", " breakout-channel", "breakout_channel", ""]) {
  const r = evaluate(near, WAVE);
  assert.equal(r.signal, null, `id "${near}" must not resolve to a catalog strategy`);
  assert.ok(r.unsupported.length > 0, `id "${near}" must refuse with a reason`);
  assert.equal(findCatalogStrategy(near), null, `findCatalogStrategy must agree that "${near}" is unknown`);
}

const liveId = "breakout-channel";
const dirty: Array<[string, number[]]> = [
  ["NaN", [...WAVE.slice(0, -1), Number.NaN]],
  ["Infinity", [...WAVE.slice(0, -1), Number.POSITIVE_INFINITY]],
  ["zero", [...WAVE.slice(0, -1), 0]],
  ["negative", [...WAVE.slice(0, -1), -1]],
  ["leading NaN", [Number.NaN, ...WAVE.slice(1)]],
];
for (const [label, closes] of dirty) {
  const r = evaluate(liveId, closes);
  assert.equal(r.signal, null, `${label} close must refuse, not be silently filtered out`);
  assert.match(
    r.unsupported[0] ?? "",
    /non-positive or non-finite close/,
    `${label}: refusal must say the series was unusable`,
  );
}
// Two bad closes must be counted, not collapsed — the message is the only
// evidence an operator gets about how bad the feed was.
const twoBad = evaluate(liveId, [Number.NaN, ...WAVE.slice(1, -1), -3]);
assert.match(twoBad.unsupported[0] ?? "", /contains 2 non-positive or non-finite close/);
console.log("refusals: unknown ids, short series and dirty closes all refuse with a reason");

// ── 5. The pinned script hash (c) ───────────────────────────────────────────
// `/api/bot/start` pins sha256(canonicalizePine(script)) into
// BotInstance.scriptHash; `runPersonalStrategyTick` recomputes it every tick
// and stops the bot when it differs. Both halves have to hash the same bytes
// the same way — so the route's expression is parsed out of the route source
// rather than restated from memory. A change to the digest, the encoding, or
// what gets hashed fails here.
const startRoute = readFileSync("app/api/bot/start/route.ts", "utf8");
const hashExpr = startRoute.match(
  /createHash\(\s*'([a-z0-9]+)'\s*\)[\s\S]{0,80}?\.update\(\s*canonicalizePine\(\s*([A-Za-z.]+)\s*\)\s*,\s*'([a-z0-9-]+)'\s*\)[\s\S]{0,40}?\.digest\(\s*'([a-z0-9]+)'\s*\)/,
);
assert.ok(
  hashExpr,
  "app/api/bot/start/route.ts no longer pins sha256(canonicalizePine(script)) in a shape this test can read — "
  + "if the route changed how it hashes, lib/personal-runner.ts:pineScriptHash must change with it",
);
const [, routeAlgo, routeInput, routeEncoding, routeDigest] = hashExpr;
assert.equal(routeInput, "catalogStrategy.script", "the route must hash the CATALOG script, not the request body");
assert.ok(
  /findCatalogStrategy\(/.test(startRoute),
  "the route must resolve strategyId through findCatalogStrategy before pinning a hash",
);

for (const entry of SEALED_CATALOG) {
  const canonical = canonicalizePine(entry.script);
  const asRouteDoesIt = createHash(routeAlgo).update(canonical, routeEncoding as BufferEncoding).digest(routeDigest as "hex");
  const asRunnerDoesIt = pineScriptHash(canonical);
  assert.equal(
    asRunnerDoesIt,
    asRouteDoesIt,
    `${entry.id}: the runner's hash and the start route's pinned hash disagree — every running bot would refuse to tick`,
  );
  assert.match(asRunnerDoesIt, /^[0-9a-f]{64}$/, `${entry.id}: pinned hash must be lowercase hex, unprefixed`);
}

// Canonicalisation must matter and must be stable: whitespace-only edits keep a
// bot running, a real edit stops it.
const sample = SEALED_CATALOG[0];
assert.equal(
  pineScriptHash(canonicalizePine(sample.script)),
  pineScriptHash(canonicalizePine(`${sample.script}\n`)),
  "a trailing newline must not change the pinned hash",
);
assert.notEqual(
  pineScriptHash(canonicalizePine(sample.script)),
  pineScriptHash(canonicalizePine(sample.script.replace("close", "open"))),
  "editing the script MUST change the pinned hash — this is the whole point of pinning it",
);
console.log(`scriptHash: ${SEALED_CATALOG.length} catalog ids hash identically in the runner and /api/bot/start`);

// ── 6. Self-sizing is a request, never a grant (d) ──────────────────────────
// multi-asset-momentum is the only entry that declares its own size/leverage:
// 20% of equity (2000 bps) at 50% margin (2x → 200 ×100).
const selfSizing = evaluate("multi-asset-momentum", WAVE);
assert.equal(selfSizing.requestedPctBps, 2000, "multi-asset-momentum declares 20% of equity");
assert.equal(selfSizing.requestedLeverageX100, 200, "multi-asset-momentum declares 50% margin = 2x");
for (const entry of SEALED_CATALOG) {
  const r = evaluate(entry.id, WAVE);
  const declares = r.requestedPctBps !== undefined && r.requestedLeverageX100 !== undefined;
  assert.equal(
    declares,
    Boolean(entry.selfSizing),
    `${entry.id}: selfSizing=${Boolean(entry.selfSizing)} but the evaluator reports size=${r.requestedPctBps} lev=${r.requestedLeverageX100}`,
  );
}
assert.equal(
  SEALED_CATALOG.filter((s) => s.selfSizing).length,
  1,
  "multi-asset-momentum is the only self-sizing entry; a second one needs its own clamp coverage here",
);

/**
 * Mirror of `resolveSizing()` in lib/personal-runner.ts, which is module-private.
 * The source guard below is what keeps this mirror honest: if the real
 * arithmetic changes, the regexes stop matching and this test fails rather than
 * quietly asserting the wrong rule.
 */
function resolveSizingMirror(
  bot: { leverageX: number | null; capitalUSDC: number },
  cap: number,
  script: { pctBps: number | null; levX100: number | null },
): { leverageX: number; capitalUSDC: number } {
  const userLeverage = Math.max(1, Math.min(bot.leverageX ?? 3, cap));
  const asked = script.levX100 !== null ? Math.max(1, Math.floor(script.levX100 / 100)) : userLeverage;
  const askedCapital = script.pctBps !== null ? (bot.capitalUSDC * script.pctBps) / 10_000 : bot.capitalUSDC;
  return {
    leverageX: Math.min(userLeverage, asked),
    capitalUSDC: Math.max(0, Math.min(bot.capitalUSDC, askedCapital)),
  };
}

const bot3x = { leverageX: 3, capitalUSDC: 100 };
// Asking for MORE than the cap gets the cap, not the request.
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: 1000 }).leverageX, 3, "10x under a 3x cap must yield 3x");
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: 5000 }).leverageX, 3, "50x under a 3x cap must yield 3x");
// Asking for LESS is honoured — the clamp is one-directional.
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: 100 }).leverageX, 1, "1x under a 3x cap must yield 1x");
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: 200 }).leverageX, 2, "2x under a 3x cap must yield 2x");
// A user who picked less than the cap keeps their own number.
assert.equal(resolveSizingMirror({ leverageX: 2, capitalUSDC: 100 }, 3, { pctBps: null, levX100: null }).leverageX, 2);
// Never below 1x, whatever the script says.
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: 50 }).leverageX, 1, "a sub-1x request must floor at 1x");
// Capital: the same rule, in bps of the user's own cap.
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: 2000, levX100: 200 }).capitalUSDC, 20, "2000bps of 100 USDC is 20");
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: 10_000, levX100: null }).capitalUSDC, 100, "100% is the user's cap, not more");
assert.equal(resolveSizingMirror(bot3x, 3, { pctBps: null, levX100: null }).capitalUSDC, 100, "no request means the user's cap");
// The real declaration, end to end: 100 USDC at 3x, script asks 20% and 2x.
const applied = resolveSizingMirror(bot3x, 3, {
  pctBps: selfSizing.requestedPctBps ?? null,
  levX100: selfSizing.requestedLeverageX100 ?? null,
});
assert.deepEqual(applied, { leverageX: 2, capitalUSDC: 20 }, "multi-asset-momentum on a 100 USDC 3x bot: 20 USDC at 2x");

const runnerSrc = readFileSync("lib/personal-runner.ts", "utf8").replace(/\s+/g, " ");
for (const [what, pattern] of [
  ["user leverage is capped", /const userLeverage = Math\.max\(1, Math\.min\(bot\.leverageX \?\? PINE_DEFAULT_LEVERAGE_X, leverageCap\)\)/],
  ["script leverage is floored at 1x", /Math\.max\(1, Math\.floor\(program\.requestedLeverageX100 \/ 100\)\)/],
  ["leverage clamps DOWN only", /const leverageX = Math\.min\(userLeverage, askedLeverage\)/],
  ["capital is bps of the user's cap", /\(bot\.capitalUSDC \* program\.requestedPctBps\) \/ 10_000/],
  ["capital clamps DOWN only", /const capitalUSDC = Math\.max\(0, Math\.min\(bot\.capitalUSDC, askedCapital\)\)/],
] as const) {
  assert.match(
    runnerSrc,
    pattern,
    `resolveSizing() no longer reads as "${what}" — the mirror in this test is now asserting a rule the runner does not follow`,
  );
}
// The two files that decide leverage must default to the same number.
assert.match(runnerSrc, /const PINE_DEFAULT_LEVERAGE_X = 3/, "runner default leverage must be 3x");
assert.match(startRoute, /const PINE_DEFAULT_MAX_LEVERAGE_X = 3/, "start route default leverage ceiling must be 3x");
assert.match(startRoute, /BOT_MAX_LEVERAGE_X/, "start route must read the leverage ceiling from env");
assert.match(startRoute, /BOT_MAX_CAPITAL_USDC/, "start route must read the capital ceiling from env");
assert.match(runnerSrc, /process\.env\.BOT_MAX_LEVERAGE_X/, "runner must re-read the leverage ceiling at tick time");
console.log("sizing: self-sizing clamps DOWN only, in both leverage and capital");

// ── 7. Closed bars only (e) ─────────────────────────────────────────────────
assert.equal(MAX_CLOSED_BARS, 990, "upstream rejects spans over 1000 candles");
assert.deepEqual(CLOSED_BAR_INTERVAL_MS, { "1m": 60_000, "5m": 300_000, "15m": 900_000 });
for (const good of ["1m", "5m", "15m"]) assert.ok(isClosedBarInterval(good));
for (const bad of ["1h", "1M", "", "60", undefined, null, 60_000]) {
  assert.equal(isClosedBarInterval(bad), false, `${String(bad)} must not pass as a bar interval`);
}

const intervals: ClosedBarInterval[] = ["1m", "5m", "15m"];
for (const interval of intervals) {
  const ms = CLOSED_BAR_INTERVAL_MS[interval];
  for (const offset of [0, 1, ms / 2, ms - 1]) {
    const now = 1_700_000_000_000 + offset;
    const open = latestClosedBarOpenMs(interval, now);
    assert.equal(open % ms, 0, `${interval}: a bar open must sit on an interval boundary`);
    assert.ok(open + ms <= now, `${interval}: returned bar has not closed yet at offset ${offset}`);
    assert.ok(open + 2 * ms > now, `${interval}: returned bar is older than the latest closed one`);
    assert.notEqual(
      open,
      Math.floor(now / ms) * ms,
      `${interval}: returned the FORMING bar's open time — a strategy scored on it flips mid-bar`,
    );
  }
}

// toClosedBars: the in-progress candle is the one that must not survive.
const now = 1_700_000_400_000; // aligned to a whole minute
const minute = CLOSED_BAR_INTERVAL_MS["1m"];
const bars = toClosedBars(
  [
    { t: now - 3 * minute, c: 100 },                          // closed (no T: t + interval)
    { t: now - 2 * minute, T: now - minute, c: 101 },          // closed
    { t: now - 2 * minute, T: now - minute, c: 101.5 },        // duplicate open time, later row wins
    { t: now - minute, T: now, c: 102 },                       // closes exactly at now → closed
    { t: now, T: now + minute, c: 103 },                       // IN PROGRESS
    { t: now + minute, T: now + 2 * minute, c: 104 },          // entirely in the future
    { t: now - 4 * minute, c: -5 },                            // non-positive close
    { t: now - 5 * minute, c: Number.NaN },                    // non-finite close
    { t: Number.NaN, c: 99 },                                  // unusable open time
  ],
  minute,
  now,
);
assert.deepEqual(
  bars,
  [
    { t: now - 3 * minute, c: 100 },
    { t: now - 2 * minute, c: 101.5 },
    { t: now - minute, c: 102 },
  ],
  "toClosedBars must drop the forming candle, the future candle and the unusable rows, and sort by open time",
);
assert.ok(bars.every((b) => b.t + minute <= now), "every returned bar must have already closed");
assert.equal(bars.at(-1)!.c, 102, "the last bar must be the most recently CLOSED one, not the forming one");

// A candle whose own T says it is still forming is dropped even when
// t + interval would say otherwise (irregular upstream spans).
assert.deepEqual(
  toClosedBars([{ t: now - 10 * minute, T: now + minute, c: 500 }], minute, now),
  [],
  "an explicit close time in the future must win over t + interval",
);
console.log("candles: the in-progress bar never reaches the evaluator");

console.log("\npersonal runner self-test passed");
export {};
