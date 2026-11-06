import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { createPineRuntime } from "../lib/pine-solana/runtime";
import type { Bar, CompileOptions, CompileResult } from "../lib/pine-solana/ir";

// These are independently calculated language examples, not TradingView exports.
// Semantic references:
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/
// https://www.tradingview.com/pine-script-docs/language/type-system/
// https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
const strategy = (body: string, version = 6) =>
  `//@version=${version}\nstrategy("Core semantics")\n${body}\nif false\n    strategy.close_all()\n`;
const details = (result: CompileResult) => JSON.stringify(result.diagnostics);
function accepted(body: string, version = 6) {
  const result = compilePineToSolana(strategy(body, version));
  assert.equal(result.ok, true, details(result));
  return result.ir!;
}
function rejected(body: string, code: string, version = 6, options: CompileOptions = {}) {
  const result = compilePineToSolana(strategy(body, version), options);
  assert.equal(result.ok, false, "Invalid or unsupported source must not emit a program");
  assert.deepEqual(result.files, {});
  assert.equal(result.ir, undefined);
  assert.ok(result.diagnostics.some(issue => issue.code === code), details(result));
  assert.ok(!result.diagnostics.some(issue => issue.code === "COMPILER_INTERNAL"), details(result));
}
const bar = (index: number, close = 10): Bar => ({
  time: 1_700_000_000_000 + 60_000 * index,
  open: close, high: close, low: close, close, volume: 1,
});

test("numeric bool casts use nonzero truth, independently of comparison rounding", () => {
  for (const version of [4, 5, 6]) {
    const runtime = createPineRuntime(accepted([
      "positive = bool(1e-10)",
      "negative = bool(-1e-10)",
      "zero = bool(0.0)",
      "dynamic = bool(close)",
      'if dynamic',
      '    strategy.entry("L", strategy.long)',
    ].join("\n"), version));
    const first = runtime.push(bar(0, 1e-10));
    assert.equal(first.outputs.positive, true, `v${version}`);
    assert.equal(first.outputs.negative, true, `v${version}`);
    assert.equal(first.outputs.zero, false, `v${version}`);
    assert.equal(first.outputs.dynamic, true, `v${version}`);
    assert.equal(first.intents.length, 1, "Tiny nonzero prices must not suppress an order condition");
    assert.equal(runtime.push(bar(1, 0)).intents.length, 0);
  }
});

test("legacy numeric conditions preserve tiny nonzero values and missing-to-false casts", () => {
  for (const version of [4, 5]) {
    const runtime = createPineRuntime(accepted([
      "tiny = 1e-10 ? 7 : 9",
      "missing = float(na)",
      "notMissing = not missing",
      "isTruthy = missing or true",
      "if close",
      '    strategy.entry("L", strategy.long)',
    ].join("\n"), version));
    const first = runtime.push(bar(0, 1e-10));
    assert.equal(first.outputs.tiny, 7, `v${version}`);
    assert.equal(first.outputs.notMissing, true, `v${version}`);
    assert.equal(first.outputs.isTruthy, true, `v${version}`);
    assert.equal(first.intents.length, 1);
  }
});

test("int truncation and legacy integer division use the true sign near zero", () => {
  for (const version of [4, 5, 6]) {
    const runtime = createPineRuntime(accepted([
      "negative = int(-1e-10)",
      "positive = int(1e-10)",
      "dynamic = int(close)",
      "normalNegative = int(-1.9)",
      "normalPositive = int(1.9)",
      "quotient = -1 / 10000000000",
    ].join("\n"), version));
    const output = runtime.push(bar(0, -1e-10)).outputs;
    assert.ok(output.negative === 0);
    assert.equal(output.positive, 0);
    assert.ok(output.dynamic === 0);
    assert.equal(output.normalNegative, -1);
    assert.equal(output.normalPositive, 1);
    assert.ok(output.quotient === (version < 6 ? 0 : -1e-10));
  }
});

test("compile-time comparison branches select the same periods as runtime", () => {
  const ir = accepted("length = 1.0000000001 == 1.0 ? 1 : 2\naverage = ta.sma(close, length)");
  assert.equal(ir.nodes.find(node => node.op === "sma")!.period, 1);
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(output.length, 1);
  assert.equal(output.average, 10, "The first bar must use length=1, not a hidden length=2");
});

test("constant overflow and missing comparisons cannot choose a different static branch", () => {
  for (const version of [5, 6]) {
    const ir = accepted("length = 1e308 * 1e308 > 0 ? 2 : 3\naverage = ta.sma(close, length)", version);
    assert.equal(ir.nodes.find(node => node.op === "sma")!.period, 3);
    const runtime = createPineRuntime(ir);
    assert.equal(runtime.push(bar(0)).outputs.length, 3);
    assert.equal(runtime.push(bar(1)).outputs.average, null);
    assert.equal(runtime.push(bar(2)).outputs.average, 10);
  }
});

test("constant rounding does not change odd integers or round a below-half value up", () => {
  const ir = accepted([
    "large = math.round(4503599627370497)",
    "length = math.round(0.49999999999999994) + 1",
    "average = ta.sma(close, length)",
  ].join("\n"));
  assert.equal(ir.nodes.find(node => node.op === "sma")!.period, 1);
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(output.large, 4503599627370497);
  assert.equal(output.length, 1);
  assert.equal(output.average, 10);
});

test("unsafe computed loop bounds terminate with an artifact-free rejection", () => {
  // At 2^53, i += 1 no longer advances a JavaScript number. Previously this
  // one-iteration source expanded until NODE_LIMIT instead of respecting its
  // bound. A subprocess deadline also contains any future unbounded regression.
  const compilerPath = resolve("lib/pine-solana/compiler.ts");
  const source = strategy("bound = 9007199254740991 + 1\nhits = 0\nfor i = bound to bound\n    hits += 1");
  const code = `const {compilePineToSolana} = require(${JSON.stringify(compilerPath)});
    const r = compilePineToSolana(${JSON.stringify(source)});
    process.stdout.write(JSON.stringify({ok:r.ok, files:r.files, codes:r.diagnostics.map(d=>d.code)}));`;
  const child = spawnSync(process.execPath, [...process.execArgv.filter(arg => arg !== "--test"), "-e", code], {
    encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.ok, false);
  assert.deepEqual(result.files, {});
  assert.ok(result.codes.includes("INTEGER_RANGE"), "Reject the unsafe integer before loop lowering");
  assert.ok(!result.codes.includes("COMPILER_INTERNAL"));
});

test("bounded ascending and descending loops still include their final reachable counter", () => {
  const output = createPineRuntime(accepted([
    "ascending = 0", "descending = 0", "edge = 0",
    "for i = 1 to 5 by 2", "    ascending += i",
    "for i = 5 to 1 by 2", "    descending += i",
    "for i = 9007199254740990 to 9007199254740991", "    edge += 1",
  ].join("\n"))).push(bar(0)).outputs;
  assert.equal(output.ascending, 9);
  assert.equal(output.descending, 9);
  assert.equal(output.edge, 2);
});

test("Pine v4 RSI float overload must not be replaced by Wilder RSI", () => {
  rejected("value = rsi(close, 3.0)", "RSI_OVERLOAD", 4);
  rejected("length = input(3.0)\nvalue = rsi(close, length)", "RSI_OVERLOAD", 4);
  rejected("length = 3\nlength := 3\nvalue = rsi(close, length)", "RSI_OVERLOAD", 4);
  accepted("value = rsi(close, 3)", 4);
});

test("integer-only lengths and history offsets do not accept whole-valued floats", () => {
  rejected("value = ta.sma(close, 3.0)", "INTEGER_REQUIRED");
  rejected("value = close[1.0]", "INTEGER_REQUIRED");
  accepted("value = ta.sma(close, int(3.0))\nprevious = close[int(1.0)]");
});

test("function free names are limited to globals visible at its definition", () => {
  rejected("readLater() => later\nlater = 7\nvalue = readLater()", "UNKNOWN_IDENTIFIER");
  const output = createPineRuntime(accepted("globalValue = 1\nreadGlobal() => globalValue\nglobalValue := 7\nvalue = readGlobal()")).push(bar(0)).outputs;
  assert.equal(output.value, 7, "A valid lexical global is read at call time");
});

test("underscore bindings are unreadable inside functions as well as global scope", () => {
  rejected("copy(x) =>\n    _ = x\n    _\nvalue = copy(close)", "UNDERSCORE_READ");
  rejected("copy(_) => _\nvalue = copy(close)", "UNDERSCORE_READ");
  const ir = accepted("copy(x) =>\n    _ = x\n    _ = x + 1\n    x\nvalue = copy(close)");
  assert.equal(createPineRuntime(ir).push(bar(0)).outputs.value, 10);
});

test("constant input metadata uses the same boolean and numeric calculations as emitted code", () => {
  const ir = accepted([
    "enabled = input.bool(not false and bool(1e-10))",
    "length = input.int((1.0000000001 == 1.0 ? 1 : 2) + int(-1e-10))",
    "average = ta.sma(close, length)",
  ].join("\n"));
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(ir.inputs.enabled, true);
  assert.equal(output.enabled, true);
  assert.equal(ir.inputs.length, 1);
  assert.equal(output.length, 1);
  assert.equal(output.average, 10);
});

test("input-derived constants cannot become defaults of another input", () => {
  rejected('first = input.string("value")\nsecond = input.string(first)', "INPUT_DEFAULT");
  rejected('first = input.string("value")\nsecond = input.bool(first == "value")', "INPUT_DEFAULT");
  rejected("first = input.bool(true)\nsecond = input.bool(not first)", "INPUT_DEFAULT");
});

test("nz retains integer type but does not acquire the const qualifier", () => {
  const ir = accepted("int count = 0\ncount := nz(count[1]) + 1\nquotient = nz(5, 0) / 2", 5);
  const runtime = createPineRuntime(ir);
  for (let i = 0; i < 3; i++) {
    const output = runtime.push(bar(i)).outputs;
    assert.equal(output.count, i + 1);
    assert.equal(output.quotient, 2.5, "nz returns simple/series, so v5 const-int division does not apply");
  }
  rejected("enabled = input.bool(na(1))", "INPUT_DEFAULT");
  rejected("length = input.int(nz(5))", "INPUT_DEFAULT");
});

test("v5 integer division follows qualifiers through boolean and string conditions", () => {
  for (const version of [5, 6]) {
    const output = createPineRuntime(accepted([
      "fromComparison = (1 < 2 ? 5 : 7) / 2",
      "fromNot = (not false ? 5 : 7) / 2",
      "fromLogical = (true and true ? 5 : 7) / 2",
      "toggle = input.bool(true)",
      "fromBoolInput = (toggle ? 5 : 7) / 2",
      'labelInput = input.string("on")',
      'fromStringInput = (labelInput == "on" ? 5 : 7) / 2',
    ].join("\n"), version)).push(bar(0)).outputs;
    for (const name of ["fromComparison", "fromNot", "fromLogical"]) {
      assert.equal(output[name], version === 5 ? 2 : 2.5, `${name}, v${version}`);
    }
    assert.equal(output.fromBoolInput, 2.5);
    assert.equal(output.fromStringInput, 2.5);
  }
});

test("mutating an unrolled loop counter is rejected at its lexical binding", () => {
  for (const version of [4, 5, 6]) {
    rejected("hits = 0\nfor i = 0 to 3\n    i += 1\n    hits += 1", "LOOP_COUNTER", version);
    rejected("hits = 0\nfor i = 0 to 3\n    if true\n        i := 10\n    hits += 1", "LOOP_COUNTER", version);
  }
});

test("loop counter protection does not make copied values or nested shadows immutable", () => {
  const ir = accepted([
    "copied = 0", "shadowed = 0", "nested = 0",
    "for i = 0 to 2", "    value = i", "    value += 10", "    copied += value",
    "for i = 1 to 2", "    if true", "        i = 10", "        i += 1", "        shadowed += i", "    shadowed += i",
    "for i = 1 to 2", "    for i = 3 to 4", "        nested += i", "    nested += i",
  ].join("\n"));
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(output.copied, 33);
  assert.equal(output.shadowed, 25);
  assert.equal(output.nested, 17);
});

test("a loop header and its body share one declaration scope", () => {
  rejected("for i = 0 to 1\n    i = 10", "DUPLICATE_DECLARATION");
});

test("computed integers cannot silently cross the exact numeric range", () => {
  for (const body of [
    "value = 9007199254740991 + 1 + 1",
    "value = (9007199254740991 + 1) - 1",
    "value = -9007199254740991 - 1",
    "value = 9007199254740991 * 2",
    "value = 9007199254740991\nvalue += 1",
    "value = -9007199254740991\nvalue -= 1",
    "value = 9007199254740991\nvalue *= 2",
    "value = int(1e308)",
    "value = math.floor(1e308)",
    "value = math.ceil(-1e308)",
    "value = math.round(1e308)",
    "convert(x) => int(x)\nvalue = convert(1e308)",
  ]) rejected(body, "INTEGER_RANGE");
});

test("integer inputs reject unsafe overrides and defaults while float inputs retain their range", () => {
  for (const value of [9_007_199_254_740_992, -9_007_199_254_740_992, 1e308]) {
    rejected("value = input.int(1)", "INTEGER_RANGE", 6, { inputs: { value } });
    rejected("value = input(1)", "INTEGER_RANGE", 6, { inputs: { value } });
    const floatResult = compilePineToSolana(strategy("value = input.float(1.0)"), { inputs: { value } });
    assert.equal(floatResult.ok, true, details(floatResult));
    assert.equal(floatResult.ir!.inputs.value, value);
    assert.equal(createPineRuntime(floatResult.ir!).push(bar(0)).outputs.value, value);
  }
  rejected("value = input.int(9007199254740991 + 1)", "INTEGER_RANGE");
});

test("known safe integer expressions do not require runtime guard nodes", () => {
  const ir = accepted([
    "upper = 9007199254740991",
    "lower = -9007199254740991",
    "sum = 4 + 5", "product = 7 * 8", "quotient = int(9.5)",
    "rounded = math.round(0.5)", "replacement = nz(int(na), 3)",
    "chosen = true ? 5 : 6", "minimum = math.min(upper, 7)",
  ].join("\n"));
  assert.ok(!ir.nodes.some(node => node.op === "checked_int"));
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(output.upper, Number.MAX_SAFE_INTEGER);
  assert.equal(output.lower, Number.MIN_SAFE_INTEGER);
  assert.equal(output.sum, 9);
  assert.equal(output.product, 56);
  assert.equal(output.quotient, 9);
  assert.equal(output.rounded, 1);
  assert.equal(output.replacement, 3);
  assert.equal(output.chosen, 5);
  assert.equal(output.minimum, 7);
});

test("explicit float arithmetic remains available beyond the exact integer range", () => {
  const ir = accepted([
    "large = 1e308",
    "fraction = large / 2.0",
    "promoted = float(9007199254740991) + 1",
    "missingInteger = int(na)",
  ].join("\n"));
  const output = createPineRuntime(ir).push(bar(0)).outputs;
  assert.equal(output.large, 1e308);
  assert.equal(output.fraction, 5e307);
  assert.equal(output.promoted, 9_007_199_254_740_992);
  assert.equal(output.missingInteger, null);
});

test("integer modulo does not lose an in-range remainder through an unsafe intermediate", () => {
  const ir = accepted([
    "positive = -9007199254740991 % 3",
    "negative = 9007199254740991 % -3",
    "dynamic = int(close) % 3",
    "compound = int(close)", "compound %= 3",
  ].join("\n"));
  const output = createPineRuntime(ir).push(bar(0, -9_007_199_254_740_991)).outputs;
  assert.equal(output.positive, 2);
  assert.equal(output.negative, -2);
  assert.equal(output.dynamic, 2);
  assert.equal(output.compound, 2);
});

test("integer change preserves its overload and rejects unsafe differences atomically", () => {
  // TradingView's CE10101 example identifies ta.change(month) as series int:
  // https://www.tradingview.com/pine-script-docs/errors/CE10101/
  for (const version of [5, 6]) {
    const ir = accepted("source = int(close)\nint difference = ta.change(source)", version);
    const runtime = createPineRuntime(ir);
    assert.equal(runtime.push(bar(0, -2)).outputs.difference, null);
    const before = runtime.snapshot();
    assert.throws(() => runtime.push(bar(1, Number.MAX_SAFE_INTEGER)), { code: "INTEGER_RANGE" });
    assert.deepEqual(runtime.snapshot(), before, "A failed integer difference must not advance history");
    assert.equal(runtime.push(bar(1, 3)).outputs.difference, 5);
    const floatRuntime = createPineRuntime(accepted("source = float(close)\ndifference = ta.change(source)", version));
    floatRuntime.push(bar(0, -Number.MAX_SAFE_INTEGER));
    assert.equal(floatRuntime.push(bar(1, Number.MAX_SAFE_INTEGER)).outputs.difference, 18_014_398_509_481_982);
  }
});

test("legacy missing if predicates take else branches for orders and values", () => {
  for (const version of [4, 5]) {
    const ir = accepted([
      "condition = close[1] > 0", "value = 0",
      "if condition", "    value := 1", '    strategy.entry("L", strategy.long)',
      "else", "    value := 2", '    strategy.entry("S", strategy.short)',
    ].join("\n"), version);
    const runtime = createPineRuntime(ir);
    const first = runtime.push(bar(0));
    assert.equal(first.outputs.condition, null);
    assert.equal(first.outputs.value, 2);
    assert.deepEqual(first.intents.map(intent => intent.id), ["S"]);
    const second = runtime.push(bar(1));
    assert.equal(second.outputs.value, 1);
    assert.deepEqual(second.intents.map(intent => intent.id), ["L"]);
  }
});
