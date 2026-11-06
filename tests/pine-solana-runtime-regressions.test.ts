import test from "node:test";
import assert from "node:assert/strict";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { computeConfigHash } from "../lib/pine-solana/commitment";
import { createPineRuntime, PineIntegerRangeError } from "../lib/pine-solana/runtime";
import { generateRustFiles } from "../lib/pine-solana/rust-codegen";
import { validateProgramIR } from "../lib/pine-solana/validate-ir";
import type { Bar, Op, ProgramIR } from "../lib/pine-solana/ir";

const bar = (close: number, index: number): Bar => ({ open: close, high: close, low: close, close, volume: 1, time: index * 60_000 });
function compile(body: string, version = 6): ProgramIR {
  const result = compilePineToSolana(`//@version=${version}\nstrategy("Runtime regression")\n${body}\nif false\n    strategy.close_all()\n`);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.ir!;
}

test("nearest integer rounding preserves large integers and distinguishes values just below a tie", () => {
  // Reference contract: TradingView math.round rounds to nearest, ties upward.
  // These expectations are arithmetic boundary cases, not another evaluator.
  const cases = [
    [0.49999999999999994, 0], [0.5, 1], [0.5000000000000001, 1],
    [-0.49999999999999994, -0], [-0.5, -0], [-0.5000000000000001, -1],
    [4_503_599_627_370_497, 4_503_599_627_370_497],
    [-4_503_599_627_370_497, -4_503_599_627_370_497],
  ];
  const runtime = createPineRuntime(compile("rounded = math.round(close)"));
  for (const [i, [value, expected]] of cases.entries()) {
    assert.equal(runtime.push(bar(value, i)).outputs.rounded, expected, `math.round(${value})`);
  }
});

test("dynamic integer conversions reject out-of-range values without advancing any state", () => {
  for (const expression of ["int(close)", "math.floor(close)", "math.ceil(close)", "math.round(close)"]) {
    const ir = compile(`average = ta.sma(close, 2)\nconverted = ${expression}`);
    const runtime = createPineRuntime(ir);
    runtime.push(bar(3.5, 0));
    const before = runtime.snapshot();
    for (const value of [1e16, -1e16, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => runtime.push(bar(value, 1)), PineIntegerRangeError, expression);
      assert.deepEqual(runtime.snapshot(), before, "A rejected integer cannot commit preceding TA updates or timestamp changes");
    }
    const expected = createPineRuntime(ir, before).push(bar(4.5, 1));
    assert.deepEqual(runtime.push(bar(4.5, 1)), expected);
    assert.equal(expected.outputs.average, 4);
  }
  const bounds = createPineRuntime(compile("converted = int(close)"));
  assert.equal(bounds.push(bar(Number.MAX_SAFE_INTEGER, 0)).outputs.converted, Number.MAX_SAFE_INTEGER);
  assert.equal(bounds.push(bar(-Number.MAX_SAFE_INTEGER, 1)).outputs.converted, -Number.MAX_SAFE_INTEGER);
  const missing = createPineRuntime(compile("converted = int(close[1])"));
  assert.equal(missing.push(bar(2, 0)).outputs.converted, null);
});

test("safe integer modulo agrees with exact integer arithmetic at the representable limits", () => {
  const runtime = createPineRuntime(compile("remainder = int(close) % int(open)"));
  let index = 0;
  for (const a of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -4_503_599_627_370_497, 4_503_599_627_370_497, -10, 0, 10]) {
    for (const b of [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -7, -3, 3, 7]) {
      const left = BigInt(a), right = BigInt(b), signed = left % right;
      const expected = Number(signed !== 0n && (signed < 0n) !== (right < 0n) ? signed + right : signed);
      const result = runtime.push({ ...bar(a, index++), open: b, high: Math.max(a, b), low: Math.min(a, b) });
      assert.ok(result.outputs.remainder === expected, `${a} % ${b} must be ${expected}, got ${result.outputs.remainder}`);
    }
  }
  const floating = createPineRuntime(compile("remainder = close % 3"));
  assert.equal(floating.push(bar(Number.MAX_VALUE, 0)).outputs.remainder, 2, "Finite floating remainder cannot become missing because an intermediate product overflowed");
});

test("integer checks respect inactive branches, function calls, order arguments and initialized var values", () => {
  const ir = compile(`convert(x) => int(x)
average = ta.sma(close, 2)
var int held = int(close)
picked = 0
if close > 0
    picked := int(close)
    strategy.entry("positive", strategy.long, qty=int(close))
branch = close > 0 ? convert(close) : 7
leftOr = close < 0 or int(close) > 0
leftAnd = close > 0 and int(close) > 0`);
  const runtime = createPineRuntime(ir);
  assert.equal(runtime.push(bar(1.5, 0)).outputs.held, 1);
  const before = runtime.snapshot();
  assert.throws(() => runtime.push(bar(1e16, 1)), PineIntegerRangeError);
  assert.deepEqual(runtime.snapshot(), before);
  const inactive = runtime.push(bar(-1e16, 1));
  assert.deepEqual([inactive.outputs.held, inactive.outputs.picked, inactive.outputs.branch, inactive.outputs.leftOr, inactive.outputs.leftAnd], [1, 0, 7, true, false]);
  assert.deepEqual(inactive.intents, []);
  const next = runtime.push(bar(2.5, 2));
  assert.deepEqual([next.outputs.held, next.outputs.picked, next.outputs.branch], [1, 2, 2]);
  assert.equal(next.intents[0].quantity, 2);
});

test("integer range checks follow Pine-version-specific boolean evaluation", () => {
  const body = "result = false and int(close) > 0";
  assert.equal(createPineRuntime(compile(body, 6)).push(bar(1e16, 0)).outputs.result, false);
  assert.throws(() => createPineRuntime(compile(body, 5)).push(bar(1e16, 0)), PineIntegerRangeError, "Pine v5 evaluates both boolean operands");
  for (const version of [5, 6]) {
    const row = createPineRuntime(compile("result = close > 0 ? int(close) : 1", version)).push(bar(-1e16, 0));
    assert.equal(row.outputs.result, 1, `Pine v${version} ternary evaluates only the selected branch`);
  }
});

test("comparison rounding cannot collapse distinct values once f64 spacing exceeds nine decimal places", () => {
  const ir = compile("same = close == open\nabove = close > open");
  for (const [index, [open, close]] of [[8_388_608.000000019, 8_388_608.00000002], [1e307, 1e308]].entries()) {
    const row = createPineRuntime(ir).push({ ...bar(close, index), open, low: open });
    assert.equal(row.outputs.same, false);
    assert.equal(row.outputs.above, true);
  }
  const row = createPineRuntime(ir).push({ ...bar(0.49999999999999994 / 1e9, 0), open: 0, low: 0 });
  assert.equal(row.outputs.same, true, "A value strictly below half of 1e-9 rounds down");
  assert.equal(row.outputs.above, false);
});

test("runtime and source generator reject structurally invalid IR even with a fresh commitment", () => {
  const original = compile("var float total = 0.0\ntotal := nz(total[1]) + close\naverage = ta.sma(close, 3)\nvalid = close > open");
  const addId = original.nodes.findIndex(node => node.op === "add");
  const closeId = original.nodes.findIndex(node => node.op === "close");
  const averageId = original.outputs.average;
  const stateId = original.nodes.findIndex((_, i) => original.layouts[i].historyLength > 0);
  const mutations: Array<[string, (ir: ProgramIR) => void]> = [
    ["unknown operation", ir => { ir.nodes[addId].op = "invented" as Op; }],
    ["current-bar cycle", ir => { ir.nodes[addId].a = addId; }],
    ["negative edge", ir => { ir.nodes[addId].a = -1; }],
    ["fractional edge", ir => { ir.nodes[addId].a = 0.5; }],
    ["out-of-range output", ir => { ir.outputs.average = ir.nodes.length; }],
    ["wrong field type", ir => { ir.nodes[closeId].type = "bool"; }],
    ["wrong auxiliary allocation", ir => { ir.layouts[averageId].auxLength--; }],
    ["overlapping rings", ir => { ir.layouts[averageId].auxOffset = ir.layouts[stateId].historyOffset; }],
    ["unallocated cell", ir => { ir.stateCells++; }],
    ["history exceeds declared bound", ir => { ir.maxHistory = 1; }],
    ["numeric order condition", ir => { ir.orders[0].condition = closeId; }],
    ["close with an entry side", ir => { ir.orders[0].side = 1; }],
    ["close with quantity", ir => { ir.orders[0].quantity = closeId; }],
    ["close_all with identifier", ir => { ir.orders[0].id = "unrelated"; }],
    ["empty graph", ir => { ir.nodes = []; ir.layouts = []; }],
  ];
  for (const [label, mutate] of mutations) {
    const ir = structuredClone(original);
    mutate(ir);
    ir.configHash = computeConfigHash(ir);
    assert.throws(() => createPineRuntime(ir), /Invalid Pine IR/, label);
    assert.throws(() => generateRustFiles(ir), /Invalid Pine IR/, label);
  }
  const sparse = structuredClone(original);
  delete sparse.nodes[addId];
  assert.throws(() => createPineRuntime(sparse), /Invalid Pine IR/);
  const nonfinite = structuredClone(original);
  nonfinite.nodes[0].value = Infinity;
  assert.throws(() => createPineRuntime(nonfinite), /Invalid Pine IR/);
});

test("positive history edges can reference later final writes and persistent state can resume", () => {
  const original = compile("var float total = 0.0\nprior = total[1]\ntotal := nz(prior) + close\nlast = total[2]");
  const ir: ProgramIR = JSON.parse(JSON.stringify(original));
  assert.ok(ir.nodes.some((node, i) => node.op === "history" && node.a > i), "Fixture must exercise a forward history edge");
  assert.doesNotThrow(() => validateProgramIR(ir));
  const runtime = createPineRuntime(ir);
  assert.equal(runtime.push(bar(1, 0)).outputs.total, 1);
  assert.equal(runtime.push(bar(2, 1)).outputs.total, 3);
  const resumed = createPineRuntime(ir, runtime.snapshot());
  const next = runtime.push(bar(4, 2));
  assert.deepEqual(resumed.push(bar(4, 2)), next);
  assert.equal(next.outputs.total, 7);
  assert.equal(next.outputs.prior, 3);
  assert.equal(next.outputs.last, 1);
});

test("unknown or recursive IR metadata cannot reach the commitment serializer", () => {
  const original = compile("average = ta.sma(close, 2)");
  for (const target of ["program", "node", "layout", "order"] as const) {
    const ir = structuredClone(original);
    const object = (target === "program" ? ir : target === "node" ? ir.nodes[0] : target === "layout" ? ir.layouts[0] : ir.orders[0]) as unknown as Record<string, unknown>;
    object.extra = object;
    assert.throws(() => createPineRuntime(ir), /Invalid Pine IR/, target);
    assert.throws(() => generateRustFiles(ir), /Invalid Pine IR/, target);
  }
  const oversized = structuredClone(original);
  oversized.outputs = { ["x".repeat(128_001)]: 0 };
  assert.throws(() => createPineRuntime(oversized), /Invalid Pine IR/);
  const invalidName = structuredClone(original);
  invalidName.outputs["not a Pine identifier"] = 0;
  assert.throws(() => createPineRuntime(invalidName), /Invalid Pine IR/);
});

test("corrupt rolling-window snapshots are rejected before evaluation", () => {
  const ir = compile("average = ta.sma(close, 3)");
  const runtime = createPineRuntime(ir);
  runtime.push(bar(1, 0));
  const good = runtime.snapshot();
  const base = ir.layouts[ir.outputs.average].auxOffset;
  const corruptions = [
    { offset: 0, value: 1.5 }, { offset: 0, value: -1 }, { offset: 0, value: 3 },
    { offset: 1, value: 1.5 }, { offset: 1, value: -1 }, { offset: 1, value: 3 },
    { offset: 1, value: 0 }, { offset: 2, value: null }, { offset: 3, value: 99 },
  ];
  for (const { offset, value } of corruptions) {
    const bad = structuredClone(good);
    bad.data[base + offset] = value;
    assert.throws(() => createPineRuntime(ir, bad), /runtime state/);
  }
  const sparse = structuredClone(good);
  delete sparse.data[base + 2];
  assert.throws(() => createPineRuntime(ir, sparse), /snapshot/);
  assert.deepEqual(runtime.snapshot(), good, "Rejected restoration cannot alter the original engine");
  assert.deepEqual(createPineRuntime(ir, good).push(bar(2, 1)), runtime.push(bar(2, 1)));
});

test("missing-only windows have canonical restorable state and fill on nonmissing samples", () => {
  const ir = compile("sample = bar_index < 2 ? na : close\naverage = ta.sma(sample, 2)\nweighted = ta.wma(sample, 2)\nrma = ta.rma(sample, 2)");
  let runtime = createPineRuntime(ir);
  for (let i = 0; i < 4; i++) {
    const row = runtime.push(bar(i + 1, i));
    const snapshot = runtime.snapshot();
    runtime = createPineRuntime(ir, snapshot);
    assert.equal(row.outputs.average, i === 3 ? 3.5 : null);
    assert.equal(row.outputs.rma, i === 3 ? 3.5 : null);
    if (i < 2) {
      const base = ir.layouts[ir.outputs.average].auxOffset;
      assert.deepEqual(snapshot.data.slice(base, base + 4), [0, 0, null, null]);
    }
  }
});

test("RMA snapshots reject impossible seed counts and mismatched seed/history phases", () => {
  const ir = compile("average = ta.rma(close, 3)");
  const runtime = createPineRuntime(ir);
  runtime.push(bar(1, 0));
  const good = runtime.snapshot(), layout = ir.layouts[ir.outputs.average];
  for (const count of [-1, 0, 0.5, 2, 4, null]) {
    const bad = structuredClone(good);
    bad.data[layout.auxOffset] = count;
    assert.throws(() => createPineRuntime(ir, bad), /runtime state/);
  }
  const missingSum = structuredClone(good);
  missingSum.data[layout.auxOffset + 1] = null;
  assert.throws(() => createPineRuntime(ir, missingSum), /runtime state/);
  const prematureAverage = structuredClone(good);
  prematureAverage.data[layout.historyOffset] = 1;
  assert.throws(() => createPineRuntime(ir, prematureAverage), /runtime state/);
  runtime.push(bar(2, 1)); runtime.push(bar(3, 2));
  const seeded = runtime.snapshot();
  seeded.data[layout.historyOffset] = null;
  assert.throws(() => createPineRuntime(ir, seeded), /runtime state/);
});

test("boolean and unwritten histories cannot contain impossible restored values", () => {
  const ir = compile("condition = close > 0\nprior = condition[2]");
  const runtime = createPineRuntime(ir);
  runtime.push(bar(1, 0));
  const good = runtime.snapshot(), layout = ir.layouts[ir.outputs.condition];
  for (const value of [null, 2, -1, 0.5]) {
    const bad = structuredClone(good); bad.data[layout.historyOffset] = value;
    assert.throws(() => createPineRuntime(ir, bad), /runtime state/);
  }
  const unwritten = structuredClone(good); unwritten.data[layout.historyOffset + 1] = 0;
  assert.throws(() => createPineRuntime(ir, unwritten), /runtime state/);
  const beforeFirst = createPineRuntime(ir).snapshot(); beforeFirst.data[layout.historyOffset] = 1;
  assert.throws(() => createPineRuntime(ir, beforeFirst), /runtime state/);
});
