/** Emit native Rust differential tests from the actual compiler and TS reference engine.
 * This checks backend agreement, NOT independent TradingView conformance.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { createPineRuntime, PineIntegerRangeError } from "../lib/pine-solana/runtime";
import type { Bar, CompileOptions } from "../lib/pine-solana/ir";

const head = (body: string, version = 6) => `//@version=${version}\nstrategy("Differential fixture")\n${body}\nif close > 0\n    strategy.entry("L", strategy.long)\n`;
async function main() {
  const out = resolve(process.argv[2] ?? "build/pine-solana-parity");
  const candles: Bar[] = JSON.parse(await readFile("examples/pine-solana/candles.json", "utf8"));
  const cases: Array<{ name: string; source: string; bars: Bar[]; options?: CompileOptions; exact?: boolean; expectedFailureBars?: number[] }> = [];
  for (const name of ["ema-cross", "rsi", "macd", "ohlcv-bands"]) cases.push({ name, source: await readFile(`examples/pine-solana/${name}.pine`, "utf8"), bars: candles });
  cases.push({ name: "history_and_persistence", source: head(`var float total = 0.0\ntotal := nz(total[1]) + close\nprior = total[2]\nif close > open\n    total += 1\nelse\n    total -= 2`), bars: candles.slice(0, 40) });
  cases.push({ name: "missing_windows", source: head(`src = bar_index % 3 == 0 ? na : close - 100\ns = ta.sma(src, 5)\ne = ta.ema(src, 5)\nr = ta.rma(src, 5)\nw = ta.wma(src, 5)\nv = ta.variance(src, 5)\nd = ta.stdev(src, 5)\nh = ta.highest(src, 5)\nl = ta.lowest(src, 5)\nsum = math.sum(src, 5)`), bars: candles.slice(0, 40) });
  cases.push({ name: "functions", source: head(`f(x) =>\n    y = ta.ema(x, 3)\n    y + nz(x[2])\na = f(close)\nb = f(open * 2)\nc = (close - open)[3]`), bars: candles.slice(0, 40) });
  cases.push({ name: "legacy_bool", source: head(`b = close[1] > 0\nn = not b\na = b and true\no = b or false\ni = math.min(5, 6) / 2\nj = (true ? 5 : 6) / 2`, 5), bars: candles.slice(0, 20) });
  cases.push({ name: "math", source: head(`x = close - 105\na = math.abs(x)\nb = math.sqrt(a)\nc = math.floor(x)\nd = math.ceil(x)\ne = math.round(x)\nf = math.sign(x)\ng = x % 3\nh = math.min(x, open, 100)\ni = math.max(x, -100)\nj = float(int(x))`), bars: candles.slice(0, 40) });
  cases.push({ name: "bounded_loop", source: head(`hits = 0\nfor i = 0 to 7\n    hits += i`), bars: candles.slice(0, 5) });
  cases.push({ name: "large_state", source: head(Array.from({ length: 7 }, (_, i) => `s${i} = ta.sma(close + ${i}, 100)`).join("\n")), bars: candles });
  cases.push({ name: "large_comparisons", source: head(`same = close == open\ngreater = close > open`), bars: [{ time: 60000, open: 1e307, high: 1e308, low: 1e307, close: 1e308, volume: 1 }] });
  cases.push({ name: "rma_overflow_atomic", expectedFailureBars: [1], source: head(`r = ta.rma(close, 2)`), bars: [1, 2].map(i => ({ time: i * 60000, open: 1e308, high: 1e308, low: 1e308, close: 1e308, volume: 1 })) });
  cases.push({ name: "indicator_mapping", source: await readFile("examples/pine-solana/indicator.pine", "utf8"), bars: candles, options: { signals: { long: "buy", short: "sell", quantity: 1 } } });
  const numericBars = [1e-10, -1e-10, 0, 1.9, -1.9, 0.49999999999999994, 4_503_599_627_370_497].map((close, i) => ({ time: (i + 1) * 60_000, open: close, high: close, low: close, close, volume: 1 }));
  cases.push({ name: "numeric_conversion_boundaries_v6", exact: true, source: head(`truth = bool(close)\ntruncated = int(close)\nrounded = math.round(close)\nlength = 1.0000000001 == 1.0 ? 1 : 2\naverage = ta.sma(close, length)\noverflowLength = 1e308 * 1e308 > 0 ? 2 : 3\naverageOverflow = ta.sma(close, overflowLength)`), bars: numericBars });
  cases.push({ name: "numeric_conversion_boundaries_v5", exact: true, source: head(`q = -1 / 10000000000\nimplicit = close ? 1 : 0\nmissing = float(na)\nnotMissing = not missing\nint count = 0\ncount := nz(count[1]) + 1`, 5), bars: numericBars });
  cases.push({ name: "intent_kind_and_order", source: head(`strategy.entry("same id", strategy.short, qty=2)\nstrategy.close("same id")\nstrategy.close_all()`), bars: candles.slice(0, 3) });
  const edgeBar = (close: number, time: number): Bar => ({ time, open: close, high: close, low: close, close, volume: 1 });
  cases.push({ name: "integer_range_atomic", exact: true, expectedFailureBars: [1], source: head("average = ta.sma(close, 2)\nconverted = int(close)"), bars: [edgeBar(3.5, 60_000), edgeBar(1e16, 120_000), edgeBar(4.5, 120_000)] });
  cases.push({ name: "guarded_integer_ranges", exact: true, expectedFailureBars: [1], source: head(`convert(x) => int(x)\naverage = ta.sma(close, 2)\nvar int held = int(close)\npicked = 0\nif close > 0\n    picked := int(close)\n    strategy.entry("positive", strategy.long, qty=int(close))\nbranch = close > 0 ? convert(close) : 7\nleftOr = close < 0 or int(close) > 0\nleftAnd = close > 0 and int(close) > 0`), bars: [edgeBar(1.5, 60_000), edgeBar(1e16, 120_000), edgeBar(-1e16, 120_000), edgeBar(2.5, 180_000)] });
  cases.push({ name: "integer_modulo_boundaries", exact: true, source: head("positive = int(close) % 3\nnegative = int(close) % -3"), bars: [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -4_503_599_627_370_497, 4_503_599_627_370_497, -10, 0, 10].map((close, i) => edgeBar(close, (i + 1) * 60_000)) });
  cases.push({ name: "integer_change_atomic", exact: true, expectedFailureBars: [1], source: head("n = int(close)\ndelta = ta.change(n)"), bars: [edgeBar(-2, 60_000), edgeBar(Number.MAX_SAFE_INTEGER, 120_000), edgeBar(2, 120_000)] });
  const rust = (value: number | null) => value === null ? "f64::NAN" : Object.is(value, -0) ? "-0.0" : /[.eE]/.test(String(value)) ? String(value) : `${value}.0`;
  let testSource = "// Generated backend differential fixtures. These are not independent Pine reference outputs.\n#![allow(dead_code)]\n";
  let totalBars = 0, totalValues = 0, stateValues = 0, rejectedBars = 0;
  for (let i = 0; i < cases.length; i++) {
    const fixture = cases[i];
    const compiled = compilePineToSolana(fixture.source, fixture.options);
    if (!compiled.ok) throw new Error(`${fixture.name}: ${JSON.stringify(compiled.diagnostics)}`);
    if (i === 0) for (const [name, content] of Object.entries(compiled.files)) {
      const path = resolve(out, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
    }
    const module = compiled.files["strategy/src/lib.rs"];
    if (!module) throw new Error("Generator did not emit strategy module");
    testSource += `mod case_${i} {\n${module}\n}\n#[test]\nfn ${fixture.name.replace(/[^A-Za-z0-9_]/g, "_")}() {\nlet program = case_${i}::program();\nlet mut state = pine_solana_runtime::State::new(&program).unwrap();\n`;
    const runtime = createPineRuntime(compiled.ir!);
    for (let barIndex = 0; barIndex < fixture.bars.length; barIndex++) {
      const bar = fixture.bars[barIndex];
      const constructor = `pine_solana_runtime::Bar { open:${rust(bar.open)}, high:${rust(bar.high)}, low:${rust(bar.low)}, close:${rust(bar.close)}, volume:${rust(bar.volume)}, time:${bar.time} }`;
      let expected;
      try { expected = runtime.push(bar); } catch (error) {
        if (!fixture.expectedFailureBars?.includes(barIndex)) throw new Error(`${fixture.name} unexpectedly failed on bar ${barIndex}`, { cause: error });
        rejectedBars++;
        const assertion = error instanceof PineIntegerRangeError
          ? `assert_eq!(program.evaluate(&mut state, ${constructor}).unwrap_err(), pine_solana_runtime::Error::IntegerRange);`
          : `assert!(program.evaluate(&mut state, ${constructor}).is_err(), "expected atomic runtime rejection");`;
        testSource += `let before = state.clone();\n${assertion}\nassert_eq!(state, before);\n`;
        continue;
      }
      if (fixture.expectedFailureBars?.includes(barIndex)) throw new Error(`${fixture.name} should have rejected bar ${barIndex}`);
      totalBars++; totalValues += expected.values.length;
      const comparison = fixture.exact ? "got.to_bits() == want.to_bits()" : "got.is_finite() && (got-want).abs() <= 1e-9 + 1e-9*want.abs()";
      testSource += `let r = program.evaluate(&mut state, ${constructor}).unwrap();\nlet expected: [f64;${expected.values.length}] = [${expected.values.map(rust).join(",")}];\nfor (node, (&got,&want)) in r.values.iter().zip(expected.iter()).enumerate() { assert!(if want.is_nan() { got.is_nan() } else { ${comparison} }, "${fixture.name} bar ${barIndex} node {}: got {} want {}", node, got, want); }\nassert_eq!(r.intents.len(), ${expected.intents.length});\n`;
      expected.intents.forEach((intent, j) => {
        const idBytes = [...Buffer.from(intent.id, "utf8")].join(",");
        const kind = intent.kind === "entry" ? "Entry" : intent.kind === "close" ? "Close" : "CloseAll";
        testSource += `assert_eq!(r.intents[${j}].kind, pine_solana_runtime::OrderKind::${kind});\nlet expected_id: &[u8] = &[${idBytes}];\nassert_eq!(r.intents[${j}].id.as_bytes(), expected_id);\nassert_eq!(r.intents[${j}].side, ${intent.side});\nassert_eq!(r.intents[${j}].bar_index, ${intent.barIndex});\nassert_eq!(r.intents[${j}].time, ${intent.time});\n`;
        testSource += intent.quantity === null ? `assert!(r.intents[${j}].quantity.is_none());\n` : `assert!((r.intents[${j}].quantity.unwrap()-${rust(intent.quantity)}).abs() < 1e-9);\n`;
      });
      // Check every state cell at warm-up/wrap boundaries for the large fixture;
      // smaller fixtures compare persisted state on every successful bar.
      if (fixture.name !== "large_state" || [0, 98, 99, 100, fixture.bars.length - 1].includes(barIndex)) {
        const snapshot = runtime.snapshot(); stateValues += snapshot.data.length;
        testSource += `assert_eq!(state.bars, ${snapshot.bars});\nlet expected_state: [f64;${snapshot.data.length}] = [${snapshot.data.map(rust).join(",")}];\nfor (cell, (&bits,&want)) in state.data.iter().zip(expected_state.iter()).enumerate() { let got = f64::from_bits(bits); assert!(if want.is_nan() { got.is_nan() } else { ${comparison} }, "${fixture.name} bar ${barIndex} state {}: got {} want {}", cell, got, want); }\n`;
      }
    }
    testSource += "}\n";
  }
  await mkdir(resolve(out, "strategy/tests"), { recursive: true });
  await writeFile(resolve(out, "strategy/tests/differential.rs"), testSource);
  const report = { fixtures: cases.length, bars: totalBars, rejectedBars, graphValues: totalValues, stateValues, exactFixtures: cases.filter(c => c.exact).map(c => c.name), scope: "TypeScript-versus-generated-native-Rust; not-independent-TradingView-conformance", fixturesByName: cases.map(c => c.name) };
  await writeFile(resolve(out, "differential-manifest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ out, ...report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
