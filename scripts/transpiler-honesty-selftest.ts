/**
 * Self-test for the transpiler "honesty" guarantees — the class of bug where a
 * strategy compiles, publishes and passes the equivalence gate while trading
 * something the author never wrote.
 *
 * The equivalence gate cannot catch any of these: it runs the same IR through
 * two backends, so an IR-level mis-lowering diverges in neither. These have to
 * be caught at transpile time, which is what this file pins.
 *
 *   pnpm exec tsx scripts/transpiler-honesty-selftest.ts
 */

const MARKET_ADDR = "0x" + "ab".repeat(32);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

const head = (s: string) => `//@version=5\nstrategy("${s}", overlay=true)\n`;

async function main() {
  const { transpileV3 } = await import("../lib/launchpad/transpiler-v3");
  const { parsePine } = await import("../lib/launchpad/pine-parser");
  const { astToIndicatorIR, TA_SILENT_SUBSTITUTIONS } = await import("../lib/launchpad/pine-ir");
  const { checkEquivalence, createStrategyRunner } = await import("../lib/strategy-equivalence");

  const emit = (pine: string) =>
    transpileV3(pine, undefined, { target: "vault", marketAddr: MARKET_ADDR });

  // ── 1. Baseline: a supported strategy still transpiles ────────────────────
  console.log("\n1. baseline (no regression)");
  const baseline = emit(
    head("EMA Cross") +
      `fast = ta.ema(close, 9)\n` +
      `slow = ta.ema(close, 21)\n` +
      `if (ta.crossover(fast, slow))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow))\n    strategy.entry("Short", strategy.short)\n`,
  );
  check("EMA 9/21 cross transpiles clean", !baseline.errors?.length, baseline.errors);
  check("emits a Move module", (baseline.moveSource ?? "").includes("module "), null);
  check(
    "ordinary strategies keep byte-stable error declarations",
    !(baseline.moveSource ?? "").includes("E_HISTORY_OFFSET_OUT_OF_BOUNDS"),
    "dynamic-history error code leaked into an ordinary strategy",
  );

  // ── 2. Silent indicator substitution is now rejected ──────────────────────
  // Previously: ta.vwap → compute_sma, no warning. A "verified" vault would
  // have traded an SMA of closes.
  console.log("\n2. silent indicator substitution");
  for (const fn of Object.keys(TA_SILENT_SUBSTITUTIONS)) {
    const r = emit(
      head(`Sub ${fn}`) +
        `v = ta.${fn}(close, 14)\n` +
        `if (close > v)\n    strategy.entry("Long", strategy.long)\n`,
    );
    const errs = (r.errors ?? []).join(" | ");
    check(
      `ta.${fn} is rejected (was: silently ta.${TA_SILENT_SUBSTITUTIONS[fn].was})`,
      (r.errors?.length ?? 0) > 0 && errs.includes(`ta.${fn}`),
      errs || "(no errors returned)",
    );
  }
  const vwapMove = emit(
    head("VWAP") + `v = ta.vwap(close, 14)\nif (close > v)\n    strategy.entry("L", strategy.long)\n`,
  ).moveSource;
  check(
    "rejected ta.vwap emits no Move at all",
    !vwapMove || !vwapMove.includes("compute_sma"),
    "emitted a module containing compute_sma",
  );

  // ── 3. close[N] no longer collapses to close[1] ───────────────────────────
  console.log("\n3. history offsets");
  const ir1 = astToIndicatorIR(
    parsePine(head("H1") + `x = close[1]\nif (close > x)\n    strategy.entry("L", strategy.long)\n`),
    "0x1",
  );
  const ir5 = astToIndicatorIR(
    parsePine(head("H5") + `x = close[5]\nif (close > x)\n    strategy.entry("L", strategy.long)\n`),
    "0x1",
  );
  const json1 = JSON.stringify(ir1.signalLogic) + JSON.stringify(ir1.taOps);
  const json5 = JSON.stringify(ir5.signalLogic) + JSON.stringify(ir5.taOps);
  check("close[1] lowers to prev_field", json1.includes("prev_field"), json1.slice(0, 200));
  check("close[5] lowers to series_index", json5.includes("series_index"), json5.slice(0, 200));
  check("close[5] carries offset 5", json5.includes('"offset":5'), json5.slice(0, 200));
  check("close[1] and close[5] are NOT identical IR", json1 !== json5);

  const m3 = emit(
    head("H3") + `x = close[3]\nif (close > x)\n    strategy.entry("L", strategy.long)\n`,
  );
  check("close[3] transpiles to Move", !m3.errors?.length, m3.errors);
  check(
    "emitted Move indexes the trace by the real offset",
    (m3.moveSource ?? "").includes("buf_len - 1 - 3"),
    "expected `buf_len - 1 - 3` in emitted Move",
  );

  // Buffer must be deep enough that `buf_len - 1 - offset` cannot underflow.
  const irDeep = astToIndicatorIR(
    parsePine(
      head("Deep") +
        `f = ta.ema(close, 9)\nx = close[50]\nif (f > x)\n    strategy.entry("L", strategy.long)\n`,
    ),
    "0x1",
  );
  check(
    "deep offset drives buffer capacity (>50)",
    irDeep.bufferCapacity > 50,
    `capacity=${irDeep.bufferCapacity}`,
  );
  check(
    "deep offset drives warmup (>50)",
    irDeep.warmupMinBars > 50,
    `warmup=${irDeep.warmupMinBars}`,
  );

  // ── 4. Named-series deep history is rejected, not flattened ───────────────
  console.log("\n4. named-series history");
  // NOTE: these use a two-TA crossover shape on purpose. A single-ta.* strategy
  // falls back to pattern-based signal logic that references fast_ma/slow_ma,
  // which fails for unrelated reasons and would mask what we're testing here.
  const namedBody = (hist: string) =>
    `f = ta.ema(close, 9)\ns = ta.ema(close, 21)\n` +
    `if (ta.crossover(f, s) and f > ${hist})\n    strategy.entry("L", strategy.long)\n` +
    `if (ta.crossunder(f, s))\n    strategy.entry("S", strategy.short)\n`;

  const namedDeep = emit(head("NamedDeep") + namedBody("f[3]"));
  check(
    "f[3] on a named series is rejected",
    (namedDeep.errors ?? []).some((e) => e.includes("f[3]")),
    namedDeep.errors ?? "(no errors)",
  );
  const namedOne = emit(head("NamedOne") + namedBody("f[1]"));
  check("f[1] on a named series still works", !namedOne.errors?.length, namedOne.errors);

  // ── 5. OHLC components are rejected, not aliased to close ─────────────────
  // Previously: `high` silently returned the close, so ta.highest(high, 20)
  // computed the highest CLOSE — while the derived hlc3 was already a hard
  // reject. The composite was blocked and its raw components were faked.
  console.log("\n5. OHLC aliasing");
  for (const src of ["high", "low", "open"]) {
    const r = emit(
      head(`Src ${src}`) +
        `v = ta.highest(${src}, 20)\nif (close > v)\n    strategy.entry("L", strategy.long)\n`,
    );
    check(`bare \`${src}\` is rejected`, (r.errors?.length ?? 0) > 0, r.errors ?? "(no errors)");
  }
  const hi1 = emit(
    head("HiHist") + `if (close > high[1])\n    strategy.entry("L", strategy.long)\n`,
  );
  check("`high[1]` is rejected", (hi1.errors?.length ?? 0) > 0, hi1.errors ?? "(no errors)");
  check(
    "hlc3 stays rejected (unchanged)",
    (emit(head("C") + `if (close > hlc3)\n    strategy.entry("L", strategy.long)\n`).errors
      ?.length ?? 0) > 0,
  );

  // ── 5b. Indicators that need OHLC emit no fabricated stand-in ─────────────
  // ATR's emitted true range was |close - prev_close| * 2; SuperTrend used an
  // SMA of closes as its ATR; Stochastic used the highest/lowest close. Each
  // returned a plausible number that was not the indicator.
  console.log("\n5b. fabricated OHLC-dependent indicators");
  const { TA_REQUIRES_OHLC } = await import("../lib/launchpad/pine-ir");
  for (const fn of Object.keys(TA_REQUIRES_OHLC)) {
    const r = emit(
      head(`OHLC ${fn}`) +
        `f = ta.ema(close, 9)\ns = ta.ema(close, 21)\nv = ta.${fn}(14)\n` +
        `if (ta.crossover(f, s) and v > 0)\n    strategy.entry("L", strategy.long)\n`,
    );
    check(
      `ta.${fn} is rejected rather than faked`,
      (r.errors ?? []).some((e) => e.includes(`ta.${fn}`)),
      r.errors ?? "(no errors)",
    );
  }

  // ── 6. Dynamic indexing is accepted only with statically proven bounds ────
  console.log("\n6. dynamic indexing");
  const dyn = emit(
    head("Dyn") +
      `n = input.int(3, "N")\nif (close > close[n])\n    strategy.entry("L", strategy.long)\n`,
  );
  check("unbounded close[n] is rejected", (dyn.errors?.length ?? 0) > 0, dyn.errors ?? "(none)");

  const boundedSource =
    head("BoundedDyn") +
    `n = input.int(3, "N", minval=0, maxval=50)\n` +
    `if (close > close[n])\n    strategy.entry("L", strategy.long)\n` +
    `if (close < close[n])\n    strategy.entry("S", strategy.short)\n`;
  const bounded = emit(boundedSource);
  check("bounded close[n] transpiles", !bounded.errors?.length, bounded.errors ?? "(none)");
  check(
    "bounded close[n] emits a checked runtime lookup",
    (bounded.moveSource ?? "").includes("history_at(&buf.prices, state.n, 50)"),
    "missing bounded history_at call",
  );
  check(
    "bounded lookup emits a runtime upper-bound assertion",
    (bounded.moveSource ?? "").includes("offset <= max_offset"),
    "missing history offset assertion",
  );

  const boundedIR = astToIndicatorIR(parsePine(boundedSource), "0x1");
  check(
    "dynamic maxval drives buffer capacity",
    boundedIR.bufferCapacity > 50,
    `capacity=${boundedIR.bufferCapacity}`,
  );
  check(
    "dynamic maxval drives warmup",
    boundedIR.warmupMinBars > 50,
    `warmup=${boundedIR.warmupMinBars}`,
  );

  const closes = Array.from({ length: 400 }, (_, i) =>
    100 + i * 0.05 + Math.sin(i / 7) * 2 + Math.cos(i / 19),
  );
  const eq = checkEquivalence(boundedIR, closes);
  check("bounded dynamic history passes equivalence", eq.equivalent, eq);
  const runner = createStrategyRunner(boundedIR);
  closes.forEach((close) => runner.pushBar(close));
  check(
    "bounded dynamic history is executable by the sealed runner",
    runner.unsupported.size === 0,
    [...runner.unsupported],
  );

  for (const [name, declaration] of [
    ["missing minval", `n = input.int(3, "N", maxval=50)`],
    ["missing maxval", `n = input.int(3, "N", minval=0)`],
    ["negative minval", `n = input.int(3, "N", minval=-1, maxval=50)`],
  ] as const) {
    const result = emit(
      head(`Bad ${name}`) +
      `${declaration}\nif (close > close[n])\n    strategy.entry("L", strategy.long)\n`,
    );
    check(`${name} is rejected`, (result.errors?.length ?? 0) > 0, result.errors ?? "(none)");
  }

  const namedDynamic = emit(
    head("Named dynamic") +
      `n = input.int(3, "N", minval=0, maxval=10)\n` +
      `f = ta.ema(close, 9)\ns = ta.ema(close, 21)\n` +
      `if (ta.crossover(f, s) and f > f[n])\n    strategy.entry("L", strategy.long)\n`,
  );
  check(
    "named-series dynamic history is rejected",
    (namedDynamic.errors ?? []).some((error: string) => error.includes("per-series buffer")),
    namedDynamic.errors ?? "(none)",
  );

  for (const [name, offset] of [
    ["negative literal", "-1"],
    ["fractional literal", "1.5"],
    ["literal above the on-chain cap", "2049"],
  ] as const) {
    const result = emit(
      head(`Bad ${name}`) +
      `if (close > close[${offset}])\n    strategy.entry("L", strategy.long)\n`,
    );
    check(`${name} history is rejected`, (result.errors?.length ?? 0) > 0, result.errors ?? "(none)");
  }

  console.log(
    failures === 0
      ? "\nAll transpiler honesty checks passed.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
