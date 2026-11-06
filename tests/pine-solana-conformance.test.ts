import assert from "node:assert/strict";
import test from "node:test";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { createPineRuntime } from "../lib/pine-solana/runtime";
import type { Bar, CompileOptions, CompileResult, Evaluation } from "../lib/pine-solana/ir";

/**
 * Hand-calculated semantic examples and fail-closed regression tests.
 * These are NOT exported TradingView fixtures and do not certify Pine parity.
 * The independent-fixture requirement is documented in PINE_SOLANA_COMPATIBILITY.md.
 */
const strategy = (body: string, version = 6): string =>
  `//@version=${version}\nstrategy("Conformance")\n${body}\nif false\n    strategy.close_all()\n`;
const indicator = (body: string): string => `//@version=6\nindicator("Conformance")\n${body}\n`;
const errors = (result: CompileResult): string => JSON.stringify(result.diagnostics, null, 2);
function accepted(source: string, options: CompileOptions = {}) {
  const result = compilePineToSolana(source, options);
  assert.equal(result.ok, true, errors(result));
  assert.ok(result.ir, "Successful compilation must include a typed program");
  assert.ok(Object.keys(result.files).length > 0, "Successful compilation must include files");
  assert.ok(!result.diagnostics.some(d => d.severity === "error"), errors(result));
  return result;
}
function rejected(source: string, code?: string, options: CompileOptions = {}) {
  let result!: CompileResult;
  assert.doesNotThrow(() => { result = compilePineToSolana(source, options); });
  assert.equal(result.ok, false, "Unsupported/invalid source must never produce an executable project");
  assert.deepEqual(result.files, {}, "A failed compilation must not leak a partial deployable project");
  assert.equal(result.ir, undefined);
  assert.ok(result.diagnostics.some(d => d.severity === "error" && (!code || d.code === code)), errors(result));
  for (const issue of result.diagnostics) assert.ok(issue.line > 0 && issue.column > 0, errors(result));
  return result;
}
function candle(close: number, index: number, overrides: Partial<Bar> = {}): Bar {
  return { open: close, high: close + 1, low: close - 1, close, volume: 100, time: 1_700_000_000_000 + index * 60_000, ...overrides };
}
function evaluate(body: string, closes: number[], options: CompileOptions = {}): Evaluation[] {
  const result = accepted(strategy(body), options);
  const runtime = createPineRuntime(result.ir!);
  return closes.map((close, i) => runtime.push(candle(close, i)));
}
function series(results: Evaluation[], name: string) { return results.map(r => r.outputs[name]); }
function near(actual: Array<number | boolean | null>, expected: Array<number | null>, tolerance = 1e-10) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => {
    if (expected[i] === null) assert.equal(value, null, `Expected NA at bar ${i}, got ${value}`);
    else {
      assert.equal(typeof value, "number", `Expected a number at bar ${i}, got ${value}`);
      assert.ok(Math.abs((value as number) - expected[i]!) <= tolerance * Math.max(1, Math.abs(expected[i]!)), `Bar ${i}: ${value} != ${expected[i]}`);
    }
  });
}

test("manifest makes the experimental order-intent execution contract explicit", () => {
  const result = accepted(strategy('if close > open\n    strategy.entry("L", strategy.long, qty=2)'));
  assert.equal(result.target, "solana");
  assert.equal(result.executionModel, "confirmed-bar-signal");
  assert.equal(result.manifest?.brokerEmulator, false);
  assert.equal(result.manifest?.dexAdapter, null);
  assert.equal(result.manifest?.tradingViewEquivalence, "not-certified");
  assert.equal(result.manifest?.deployment, "not-deployed");
  assert.equal(result.ir!.sourceHash.length, 64);
  assert.equal(result.ir!.configHash.length, 64);
  assert.deepEqual(JSON.parse(result.files["program.ir.json"]), JSON.parse(JSON.stringify(result.ir)));
});

const unsupported: Array<[string, string, string?]> = [
  ["cross-symbol/timeframe requests", 'x = request.security("BTCUSD", "60", close)', "EXTERNAL_DATA"],
  ["lower-timeframe arrays", 'x = request.security_lower_tf("BTCUSD", "1", close)', "EXTERNAL_DATA"],
  ["economic data", 'x = request.economic("US", "GDP")', "EXTERNAL_DATA"],
  ["financial data", 'x = request.financial("NASDAQ:AAPL", "TOTAL_REVENUE", "FQ")', "EXTERNAL_DATA"],
  ["corporate actions", 'x = request.dividends("NASDAQ:AAPL", dividends.gross)', "EXTERNAL_DATA"],
  ["currency conversion", 'x = request.currency_rate("USD", "EUR")', "EXTERNAL_DATA"],
  ["seed datasets", 'x = request.seed("repo", "symbol", close)', "EXTERNAL_DATA"],
  ["symbol metadata", "x = syminfo.mintick", "EXTERNAL_CONTEXT"],
  ["timeframe metadata", "x = timeframe.period", "EXTERNAL_CONTEXT"],
  ["synthetic charts", 'x = ticker.heikinashi("BTCUSD")', "UNSUPPORTED_CALL"],
  ["session calendar calls", 'x = time("60", "0930-1600")', "UNSUPPORTED_CALL"],
  ["realtime state", "x = barstate.isrealtime", "REALTIME_CONTEXT"],
  ["intrabar persistence", "varip x = 0", "INTRABAR_STATE"],
  ["local persistent initialization", "if close > 0\n    var x = 1", "LOCAL_VAR"],
  ["arrays", "x = array.new_float(2, close)", "UNSUPPORTED_CALL"],
  ["maps", "x = map.new<string, float>()"],
  ["matrices", "x = matrix.new<float>(2, 2, 0)"],
  ["user-defined object types", "type Point\n    float x", "PINE_UNSUPPORTED_SYNTAX"],
  ["methods", "method value(float x) => x", "PINE_UNSUPPORTED_SYNTAX"],
  ["enums", "enum Direction\n    up\n    down", "PINE_UNSUPPORTED_SYNTAX"],
  ["imports", "import author/library/1 as lib", "PINE_UNSUPPORTED_SYNTAX"],
  ["exported libraries", "export f(x) => x", "PINE_UNSUPPORTED_SYNTAX"],
  ["switch", "x = switch\n    close > 0 => 1\n    => 0", "PINE_UNSUPPORTED_SYNTAX"],
  ["unbounded loops", "x = 0\nwhile close > x\n    x += 1", "UNBOUNDED_LOOP"],
  ["dynamic for bounds", "x = 0\nfor i = 0 to close\n    x += i", "CONSTANT_REQUIRED"],
  ["oversized unrolled loops", "x = 0\nfor i = 0 to 32\n    x += i", "LOOP_LIMIT"],
  ["break/continue", "for i = 0 to 3\n    break", "PINE_UNSUPPORTED_SYNTAX"],
  ["recursive functions", "f(x) => f(x)\nx = f(close)", "RECURSION"],
  ["function persistent state", "f(x) =>\n    var n = 0\n    n + x\ny = f(close)", "FUNCTION_BODY"],
  ["unsupported actual TA algorithm", "x = ta.hma(close, 9)", "UNSUPPORTED_TA"],
  ["tuple TA without targets", "x = ta.macd(close, 2, 3, 2)", "TUPLE_REQUIRED"],
  ["unbiased variance", "x = ta.variance(close, 3, biased=false)", "UNBIASED_VARIANCE"],
  ["conditional stateful call", "x = close > open ? ta.ema(close, 3) : 0", "CONDITIONAL_STATE"],
  ["stateful lazy RHS", "x = close > open and ta.sma(close, 2) > 0", "CONDITIONAL_STATE"],
  ["conditional history", "if close > open\n    x = close[1]", "CONDITIONAL_HISTORY"],
  ["dynamic history", "x = close[bar_index]", "CONSTANT_REQUIRED"],
  ["object drawings", "x = line.new(bar_index, close, bar_index + 1, close)", "UNSUPPORTED_CALL"],
  ["table objects", 'x = table.new(position.top_right, 2, 2)', "UNSUPPORTED_CALL"],
  ["string processing", "x = str.tostring(close)", "UNSUPPORTED_CALL"],
  ["log side effects", 'log.info("value")', "UNSUPPORTED_CALL"],
  ["broker state", "x = strategy.position_size", "BROKER_STATE"],
  ["trade history", "x = strategy.closedtrades.profit(0)", "UNSUPPORTED_CALL"],
  ["stop/limit exits", 'strategy.exit("X", "L", stop=close)', "ORDER_SEMANTICS"],
  ["entry limit orders", 'strategy.entry("L", strategy.long, limit=close)', "UNKNOWN_ARGUMENT"],
  ["order cancellation", 'strategy.cancel("L")', "ORDER_SEMANTICS"],
  ["risk rules", "strategy.risk.max_drawdown(50, strategy.percent_of_equity)", "ORDER_SEMANTICS"],
  ["v6 removed when argument", 'strategy.entry("L", strategy.long, when=true)', "V6_WHEN"],
];
for (const [name, body, code] of unsupported) {
  test(`fails closed on ${name}`, () => { rejected(strategy(body), code); });
}

test("unsupported expressions cannot be hidden inside visual, alert or header arguments", () => {
  const expressions = [
    'plotshape(request.security("BTCUSD", "60", close) > 0)',
    'plot(close, color = request.security("BTCUSD", "60", close))',
    'alert(str.tostring(request.security("BTCUSD", "60", close)))',
    'plotshape(unknownIdentifier)',
  ];
  for (const expression of expressions) rejected(strategy(expression));
  rejected('//@version=6\nstrategy("x", precision=unknownIdentifier)\nstrategy.close_all()');
});

test("nondefault broker and tick settings cannot be silently discarded", () => {
  for (const setting of ["calc_on_every_tick=true", "calc_on_order_fills=true", "process_orders_on_close=true", "use_bar_magnifier=true", "pyramiding=2", "commission_value=0.1", "slippage=2", "default_qty_type=strategy.percent_of_equity"]) {
    rejected(`//@version=6\nstrategy("Unsupported settings", ${setting})\nstrategy.entry("L", strategy.long)`);
  }
});

test("malformed, unknown and incomplete source never produces partial generated files", () => {
  for (const body of [
    "x = close @ 2", "x = close 123", "x = (close", "if close > 0", "x = close +", "x = unknown(close)",
    'x = input.int(defval=1, defval=2)', 'x = input.int(defval=1, 2)', 'x = ta.sma(close, 2, 3)',
    'x = ta.sma(source=close, source=high, length=2)', 'x = ta.sma(close, length=2, nonsense=1)',
    'strategy.entry("L", strategy.long, qty=0)', 'strategy.entry("L", strategy.long, qty=na)',
  ]) rejected(strategy(body));
  rejected('strategy("Missing version")\nstrategy.close_all()', "PINE_VERSION");
  rejected('//@version=7\nstrategy("Unsupported version")\nstrategy.close_all()', "PINE_VERSION");
  rejected(strategy("x=1") + 'indicator("Duplicate declaration")');
  rejected(strategy("x=1").repeat(5000), "SOURCE_LIMIT");
});

test("zero, false and missing values remain different at every observable boundary", () => {
  const rows = evaluate("zero = 0\nmissing = na\nzeroMissing = na(zero)\nmissingMissing = na(missing)\nkeptZero = nz(zero, 42)\nreplacedMissing = nz(missing, 42)\nundefinedDivision = 0 / 0\nfalseValue = false", [2]);
  const o = rows[0].outputs;
  assert.equal(o.zero, 0);
  assert.equal(o.missing, null);
  assert.equal(o.zeroMissing, false);
  assert.equal(o.missingMissing, true);
  assert.equal(o.keptZero, 0);
  assert.equal(o.replacedMissing, 42);
  assert.equal(o.undefinedDivision, null);
  assert.equal(o.falseValue, false);
});

test("v6 boolean history begins false while numeric history begins missing", () => {
  const rows = evaluate("up = close > 0\npreviousUp = up[1]\npreviousClose = close[1]\ncomparedMissing = close[1] > 0", [2, 3, 4]);
  assert.deepEqual(series(rows, "previousUp"), [false, true, true]);
  assert.deepEqual(series(rows, "previousClose"), [null, 2, 3]);
  assert.deepEqual(series(rows, "comparedMissing"), [false, true, true]);
  rejected(strategy("x = na(true)"), "V6_BOOL_NA");
  rejected(strategy("x = nz(true)"), "V6_BOOL_NA");
  rejected(strategy('if close\n    strategy.entry("L", strategy.long)'), "TYPE_BOOL");
});

test("v5 missing booleans and constant integer division remain distinct from v6", () => {
  const body = "up = close > 0\nprevious = up[1]\nintegerDivision = 5 / 2\nfloatDivision = 5.0 / 2\ninputInteger = input.int(5)\ninputDivision = inputInteger / 2";
  const oldResult = accepted(strategy(body, 5)), currentResult = accepted(strategy(body, 6));
  const oldRow = createPineRuntime(oldResult.ir!).push(candle(1, 0));
  const currentRow = createPineRuntime(currentResult.ir!).push(candle(1, 0));
  assert.equal(oldRow.outputs.previous, null);
  assert.equal(currentRow.outputs.previous, false);
  assert.equal(oldRow.outputs.integerDivision, 2);
  assert.equal(currentRow.outputs.integerDivision, 2.5);
  assert.equal(oldRow.outputs.floatDivision, 2.5);
  assert.equal(currentRow.outputs.floatDivision, 2.5);
  assert.equal(oldRow.outputs.inputDivision, 2.5);
  assert.equal(currentRow.outputs.inputDivision, 2.5);
  const legacy = accepted(strategy('if close\n    strategy.entry("L", strategy.long, when=close > 0)', 5));
  assert.equal(createPineRuntime(legacy.ir!).push(candle(1, 0)).intents.length, 1);
});

test("v6 rejects literal history and invalid type declarations instead of interpreting a different script", () => {
  rejected(strategy("x = 1[1]"));
  rejected(strategy("int x = close"), "DECLARATION_TYPE");
  rejected(strategy("int x = 1.5"), "DECLARATION_TYPE");
  rejected(strategy("bool x = na"), "DECLARATION_TYPE");
});

test("computed expression histories preserve source values and warmup", () => {
  const rows = evaluate("spread = close * 2 + 1\nprevious = spread[1]\nexpressionHistory = (close + 2)[2]\nzeroOffset = spread[0]\npreviousAverage = ta.sma(close, 2)[1]", [2, 4, 7, 11]);
  near(series(rows, "spread"), [5, 9, 15, 23]);
  near(series(rows, "previous"), [null, 5, 9, 15]);
  near(series(rows, "expressionHistory"), [null, null, 4, 6]);
  near(series(rows, "zeroOffset"), [5, 9, 15, 23]);
  near(series(rows, "previousAverage"), [null, null, 3, 5.5]);
});

test("global var initialization and nested conditional updates commit once per bar", () => {
  const rows = evaluate("var total = 10.0\nif close > 3\n    total += close\n    if close > 6\n        total += 100\n    else\n        total -= 1\nelse\n    total -= 2\nresult = total", [2, 4, 7, 1]);
  near(series(rows, "total"), [8, 11, 118, 116]);
  near(series(rows, "result"), [8, 11, 118, 116]);
});

test("normal variables reset while var variables survive confirmed bars", () => {
  const rows = evaluate("normal = 10.0\nvar persistent = 10.0\nnormal += close\npersistent += close", [1, 2, 3]);
  near(series(rows, "normal"), [11, 12, 13]);
  near(series(rows, "persistent"), [11, 13, 16]);
});

test("history of reassigned variables observes the prior bar final value", () => {
  for (const declaration of ["var total = 0.0", "total = 0.0"]) {
    const rows = evaluate(`${declaration}\ntotal := nz(total[1]) + close\nprevious = total[1]`, [1, 2, 3, 4]);
    near(series(rows, "total"), [1, 3, 6, 10]);
    near(series(rows, "previous"), [null, 1, 3, 6]);
  }
});

test("branch-local shadowing never changes the outer variable", () => {
  const rows = evaluate("value = 5\nif close > 0\n    value = 100\n    value += 1\nobserved = value", [1, 2]);
  near(series(rows, "observed"), [5, 5]);
});

test("two written calls to a user function retain independent indicator histories", () => {
  const rows = evaluate("smooth(x) =>\n    adjusted = x + 1\n    ta.ema(adjusted, 3)\na = smooth(close)\nb = smooth(close * 10)", [1, 3, 2, 6]);
  near(series(rows, "a"), [2, 3, 3, 5]);
  near(series(rows, "b"), [11, 21, 21, 41]);
});

test("function parameters have separate histories and read lexical globals through local shadowing", () => {
  const rows = evaluate("scale = 2\nprior(x) => x[1]\nscaled(x) => x * scale\na = prior(close)\nb = prior(close * 10)\nresult = 0.0\nif close > 0\n    scale = 100\n    result := scaled(close)", [1, 3, 2]);
  near(series(rows, "a"), [null, 1, 3]);
  near(series(rows, "b"), [null, 10, 30]);
  near(series(rows, "result"), [2, 6, 4]);
});

test("a function's first missing sample does not merge with another written call", () => {
  const rows = evaluate("smooth(x) => ta.ema(x, 3)\na = smooth(close)\nb = smooth(bar_index == 0 ? na : close * 10)", [1, 3, 2, 6]);
  near(series(rows, "a"), [1, 2, 2, 4]);
  near(series(rows, "b"), [null, 30, 25, 42.5]);
});

test("constant bounded for loops honor source ordering, inclusive endpoints and direction", () => {
  const rows = evaluate("total = 0\nfor i = 1 to 3\n    total += i\ndescending = 0\nfor j = 5 to 1 by 2\n    descending += j", [1]);
  assert.equal(rows[0].outputs.total, 6);
  assert.equal(rows[0].outputs.descending, 9);
});

const prices = [1, 2, 3, 4, 3, 2, 6, 8];
test("hand-calculated SMA, EMA and Wilder RMA traces retain distinct seeds and recurrences", () => {
  const rows = evaluate("s = ta.sma(close, 3)\ne = ta.ema(close, 3)\nr = ta.rma(close, 3)", prices);
  near(series(rows, "s"), [null, null, 2, 3, 10 / 3, 3, 11 / 3, 16 / 3]);
  near(series(rows, "e"), [1, 1.5, 2.25, 3.125, 3.0625, 2.53125, 4.265625, 6.1328125]);
  near(series(rows, "r"), [null, null, 2, 8 / 3, 25 / 9, 68 / 27, 298 / 81, 1244 / 243]);
});

test("hand-calculated RSI includes missing first delta and the rising-only 100 boundary", () => {
  const rows = evaluate("r = ta.rsi(close, 3)", prices);
  near(series(rows, "r"), [null, null, null, 100, 200 / 3, 400 / 9, 2200 / 27, 7100 / 81]);
  near(series(evaluate("r = ta.rsi(close, 3)", [5, 4, 3, 2, 1]), "r"), [null, null, null, 0, 0]);
});

test("hand-calculated MACD uses fast minus slow, a separate signal EMA and signed histogram", () => {
  const rows = evaluate("[m, s, h] = ta.macd(close, 2, 3, 2)", prices);
  near(series(rows, "m"), [0, 1 / 6, 11 / 36, 85 / 216, 143 / 1296, -1091 / 7776, 24791 / 46656, 223813 / 279936]);
  near(series(rows, "s"), [0, 1 / 9, 13 / 54, 37 / 108, 365 / 1944, -361 / 11664, 8023 / 23328, 271951 / 419904]);
  near(series(rows, "h"), [0, 1 / 18, 7 / 108, 11 / 216, -301 / 3888, -2551 / 23328, 2915 / 15552, 127537 / 839808]);
});

test("SMA skips missing source samples without treating missing as zero", () => {
  const rows = evaluate("sample = bar_index % 2 == 0 ? close : na\naverage = ta.sma(sample, 3)", prices);
  near(series(rows, "sample"), [1, null, 3, null, 3, null, 6, null]);
  near(series(rows, "average"), [null, null, null, null, 7 / 3, 7 / 3, 4, 4]);
});

test("weighted average and population variance are actual algorithms, not SMA aliases", () => {
  const rows = evaluate("w = ta.wma(close, 3)\nv = ta.variance(close, 3)\ns = ta.stdev(close, 3)", [1, 2, 6]);
  near(series(rows, "w"), [null, null, 23 / 6]);
  near(series(rows, "v"), [null, null, 14 / 3]);
  near(series(rows, "s"), [null, null, Math.sqrt(14 / 3)]);
});

test("crossovers require the previous side and do not trigger from missing history", () => {
  const rows = evaluate('up = ta.crossover(close, 3)\ndown = ta.crossunder(close, 3)\nif up\n    strategy.entry("L", strategy.long)\nif down\n    strategy.close("L")', [4, 2, 3, 4, 4, 2]);
  assert.deepEqual(series(rows, "up"), [false, false, false, true, false, false]);
  assert.deepEqual(series(rows, "down"), [false, true, false, false, false, true]);
  assert.deepEqual(rows.map(r => r.intents.map(i => i.kind)), [[], ["close"], [], ["entry"], [], ["close"]]);
});

test("recognized indicators, plots and alerts never fabricate trading rules", () => {
  rejected(indicator("r = ta.rsi(close, 3)\nplot(r)"), "NO_TRADING_INTENT");
  rejected(indicator('longCondition = close > open\nalertcondition(longCondition, "Long", "Go")'), "NO_TRADING_INTENT");
  const result = accepted(indicator("r = ta.rsi(close, 3)\nplot(r)"), { signals: { long: "r < 30", short: "r > 70", quantity: 2 } });
  assert.equal(result.ir!.orders.length, 2);
  const runtime = createPineRuntime(result.ir!);
  const rows = [1, 2, 3, 4].map((close, i) => runtime.push(candle(close, i)));
  assert.deepEqual(rows.slice(0, 3).map(r => r.intents), [[], [], []]);
  assert.deepEqual(rows[3].intents.map(i => [i.side, i.quantity]), [[-1, 2]]);
});

test("nested conditions preserve source order of explicit order intents without invented fills", () => {
  const rows = evaluate('if close > 2\n    if close > 4\n        strategy.entry("high", strategy.long, qty=2)\n    else\n        strategy.entry("middle", strategy.short, qty=3)\n    strategy.close("old")\nelse\n    strategy.close_all()', [1, 3, 5]);
  assert.deepEqual(rows.map(r => r.intents.map(i => [i.kind, i.id, i.side, i.quantity])), [
    [["close_all", "", 0, null]],
    [["entry", "middle", -1, 3], ["close", "old", 0, null]],
    [["entry", "high", 1, 2], ["close", "old", 0, null]],
  ]);
  assert.ok(rows.every(r => r.intents.every(i => !Object.hasOwn(i, "fillPrice") && !Object.hasOwn(i, "profit"))));
});

test("input overrides change the actual recurrence and hash, not just the manifest", () => {
  const body = 'length = input.int(3, "Length", minval=1, maxval=8)\nenabled = input.bool(true)\nsource = input.source(close)\naverage = ta.sma(source, length)\nif enabled and close > average\n    strategy.entry("L", strategy.long)';
  const a = accepted(strategy(body));
  const b = accepted(strategy(body), { inputs: { length: 2, enabled: false, source: "high" } });
  assert.equal(a.ir!.sourceHash, b.ir!.sourceHash);
  assert.notEqual(a.ir!.configHash, b.ir!.configHash);
  assert.deepEqual({ ...b.ir!.inputs }, { length: 2, enabled: false, source: "high" });
  const runtime = createPineRuntime(b.ir!);
  const rows = [1, 3, 5].map((close, i) => runtime.push(candle(close, i)));
  near(series(rows, "average"), [null, 3, 5]);
  assert.deepEqual(rows.map(r => r.intents), [[], [], []]);
  rejected(strategy(body), "INPUT_RANGE", { inputs: { length: 0 } });
  rejected(strategy(body), "INPUT_TYPE", { inputs: { length: 2.5 } });
  rejected(strategy(body), "INPUT_TYPE", { inputs: { enabled: 1 } });
  rejected(strategy(body), "UNKNOWN_INPUT", { inputs: { typo: 2 } });
  rejected(strategy(body), "INPUT_SOURCE", { inputs: { source: "otherIndicator" } });
});

test("input overrides and display metadata cannot hide unsupported source or bypass options", () => {
  rejected(strategy('textValue=input.string("a", options=["a", "b"])'), "INPUT_OPTIONS", { inputs: { textValue: "c" } });
  rejected(strategy('n=input.int(2, title=unknownIdentifier)'));
  rejected(strategy('n=input.int(ta.hma(close, 3))'), "UNSUPPORTED_TA", { inputs: { n: 2 } });
  rejected(strategy('n=input.int(close)'), "INPUT_DEFAULT", { inputs: { n: 2 } });
  rejected(strategy('n=input.bool(close > open)'), "INPUT_DEFAULT");
  rejected(strategy('n=input.int(2, step=0)'), "INPUT_RANGE");
  rejected(strategy('x=ta.tr(close > open)'), "CONSTANT_REQUIRED");
});

test("resource limits reject excessive history, state, expanded graphs and order counts", () => {
  rejected(strategy("x = close[129]"), "HISTORY_LIMIT");
  rejected(strategy("x = ta.sma(close, 129)"), "PERIOD_LIMIT");
  rejected(strategy("x = close[2]"), "HISTORY_LIMIT", { maxHistory: 1 });
  rejected(strategy("x = ta.sma(close, 3)"), "STATE_LIMIT", { maxStateBytes: 8 });
  rejected(strategy(Array.from({ length: 8 }, (_, i) => `x${i} = ta.sma(close + ${i}, 128)`).join("\n")), "STATE_LIMIT");
  rejected(strategy(Array.from({ length: 100 }, (_, i) => `x${i} = close + ${i} * 2`).join("\n")), "NODE_LIMIT");
  rejected(strategy(Array.from({ length: 17 }, (_, i) => `strategy.entry("L${i}", strategy.long)`).join("\n")), "ORDER_LIMIT");
  for (const maxHistory of [0, 1.5, 1025, Infinity]) rejected(strategy("x=1"), "CONFIG_HISTORY", { maxHistory });
  for (const maxStateBytes of [0, 7, 7201, Infinity]) rejected(strategy("x=1"), "CONFIG_STATE", { maxStateBytes });
});

test("series storage is bounded over long streams and snapshots resume the same recurrence", () => {
  const result = accepted(strategy("a=ta.ema(close,3)\nb=ta.sma(close,4)\nc=close[5]"));
  const runtime = createPineRuntime(result.ir!);
  const cellCount = result.ir!.stateCells;
  for (let i = 0; i < 2000; i++) runtime.push(candle(10 + i % 7, i));
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.data.length, cellCount);
  assert.ok(cellCount * 8 <= 7200);
  const resumed = createPineRuntime(result.ir!, snapshot);
  assert.deepEqual(resumed.push(candle(20, 2000)), runtime.push(candle(20, 2000)));
  assert.equal(runtime.snapshot().data.length, cellCount);
  assert.throws(() => createPineRuntime(result.ir!, { ...snapshot, configHash: "bad" }));
});

test("invalid candles and triggered invalid quantities cannot partially advance runtime state", () => {
  const result = accepted(strategy('average=ta.ema(close,3)\nquantity=close-5\nif close > 0\n    strategy.entry("L", strategy.long, qty=quantity)'));
  const runtime = createPineRuntime(result.ir!);
  runtime.push(candle(8, 0));
  const snapshot = runtime.snapshot();
  for (const bad of [candle(9, 0), candle(9, -1), candle(9, 1, { volume: -1 }), candle(9, 1, { high: 1 }), candle(NaN, 1), candle(2, 1)]) {
    assert.throws(() => runtime.push(bad));
    assert.deepEqual(runtime.snapshot(), snapshot, "Rejected execution must roll back every series and counter");
  }
  const next = runtime.push(candle(10, 1));
  assert.equal(next.outputs.average, 9);
  assert.equal(next.intents[0].quantity, 5);
  assert.equal(next.intents[0].barIndex, 1);
});

test("canonical newline handling is deterministic and input configuration is bound to artifact hash", () => {
  const source = strategy("x=close[1]");
  const a = accepted(source), b = accepted("\uFEFF" + source.replaceAll("\n", "\r\n"));
  assert.equal(a.ir!.sourceHash, b.ir!.sourceHash);
  assert.equal(a.ir!.configHash, b.ir!.configHash);
  assert.deepEqual(a.files, b.files);
});
