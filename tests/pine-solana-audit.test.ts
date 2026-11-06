import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { POST } from "../app/api/launchpad/compile-solana/route";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { createPineRuntime } from "../lib/pine-solana/runtime";
import type { Bar, CompileOptions, CompileResult } from "../lib/pine-solana/ir";

/** Adversarial regressions from reviewing the new frontend and signal engine. */
const strategy = (body: string, version = 6) => `//@version=${version}\nstrategy("Audit")\n${body}\nif false\n    strategy.close_all()\n`;
const details = (result: CompileResult) => JSON.stringify(result.diagnostics, null, 2);
function reject(body: string, options: CompileOptions = {}, version = 6) {
  const result = compilePineToSolana(strategy(body, version), options);
  assert.equal(result.ok, false, "The source or input configuration must be rejected, not silently changed");
  assert.deepEqual(result.files, {});
  assert.equal(result.ir, undefined);
  assert.ok(result.diagnostics.some(issue => issue.severity === "error" && issue.code !== "COMPILER_INTERNAL"), details(result));
  assert.ok(!result.diagnostics.some(issue => issue.code === "COMPILER_INTERNAL"), details(result));
  return result;
}
function accept(body: string) {
  const result = compilePineToSolana(strategy(body));
  assert.equal(result.ok, true, details(result));
  assert.ok(result.ir);
  return result.ir!;
}
function bar(index: number, overrides: Partial<Bar> = {}): Bar {
  return { open: 1, high: 2, low: 1, close: 2, volume: 1, time: 1_700_000_000_000 + 60_000 * index, ...overrides };
}

test("function free names cannot capture a caller's shadowing local variable", () => {
  const result = compilePineToSolana(strategy(`x = 1.0
readGlobal() => x
if close > open
    x = 2.0
    strategy.entry("L", strategy.long, qty=readGlobal())`));
  // Explicitly rejecting unsupported captures is safe; dynamic capture is not.
  if (!result.ok) {
    assert.ok(result.diagnostics.some(issue => issue.severity === "error" && issue.code !== "COMPILER_INTERNAL"), details(result));
    assert.deepEqual(result.files, {});
    return;
  }
  const evaluated = createPineRuntime(result.ir!).push(bar(0));
  assert.equal(evaluated.intents.length, 1);
  assert.equal(evaluated.intents[0].quantity, 1, "Pine functions use lexical global scope, not the caller's local x=2");
});

test("dynamic boolean input defaults cannot masquerade as constant inputs", () => {
  reject("enabled = input.bool(close > open)");
  reject("enabled = input.bool(close > open)", { inputs: { enabled: true } });
});

test("generic input overrides retain the original declared input type", () => {
  reject('length = input(3, "Length")', { inputs: { length: true } });
  reject('length = input(3, "Length")', { inputs: { length: 3.5 } });
});

test("string option restrictions cannot be silently bypassed by overrides", () => {
  reject('side = input.string("long", options=["long", "short"])', { inputs: { side: "invalid" } });
});

test("constant boolean expressions have matching metadata and execution or an explicit diagnostic", () => {
  const result = compilePineToSolana(strategy("enabled = input.bool(not false)"));
  if (!result.ok) {
    assert.ok(result.diagnostics.some(issue => issue.severity === "error" && issue.code !== "COMPILER_INTERNAL"), details(result));
    return;
  }
  assert.equal(result.ir!.inputs.enabled, true);
  assert.equal(createPineRuntime(result.ir!).push(bar(0)).outputs.enabled, true);
});

test("unused input metadata cannot hide unsupported execution expressions", () => {
  reject('length = input.int(3, tooltip=request.security("OTHER", "D", close))');
  reject('length = input.int(3, step=request.security("OTHER", "D", close))');
});

test("ta.tr handle_na must not silently turn a dynamic value into false", () => {
  reject("trueRange = ta.tr(close > open)");
});

test("function-local declared types are validated", () => {
  reject("f(x) =>\n    int n = x\n    n\ny = f(close)");
  reject("f(x) =>\n    int n = x\ny = f(close)");
});

test("duplicate function-local declarations cannot silently overwrite bindings", () => {
  reject("f(x) =>\n    y = 1\n    y = 2\n    y\nz = f(close)");
  reject("f(x) =>\n    x = 2\n    x\ny = f(close)");
});

test("JavaScript prototype property names cannot become v4 math operations", () => {
  for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    reject(`x = ${name}(1)`, {}, 4);
  }
});

test("input metadata preserves an input named __proto__ or explicitly rejects it", () => {
  const result = compilePineToSolana(strategy("__proto__ = input.int(3)"));
  if (!result.ok) {
    assert.ok(result.diagnostics.some(issue => issue.severity === "error" && issue.code !== "COMPILER_INTERNAL"), details(result));
    return;
  }
  assert.ok(Object.hasOwn(result.ir!.inputs, "__proto__"), "Valid input names must not disappear through an Object.prototype setter");
  assert.equal(result.ir!.inputs.__proto__, 3);
  assert.equal(JSON.parse(result.files["program.ir.json"]).inputs.__proto__, 3);
});

test("compile-time order quantity overflow cannot produce an unusable order program", () => {
  reject('strategy.entry("L", strategy.long, qty=1e308 * 1e308)');
});

test("float comparison precision rounding must not overflow distinct finite values", () => {
  const ir = accept("same = close == open\ngreater = close > open\nless = open < close");
  const output = createPineRuntime(ir).push(bar(0, { open: 1e307, high: 1e308, low: 1e307, close: 1e308 })).outputs;
  assert.equal(output.same, false);
  assert.equal(output.greater, true);
  assert.equal(output.less, true);
});

test("RMA seed overflow cannot commit a snapshot containing Infinity", () => {
  const ir = accept("average = ta.rma(close, 2)");
  const runtime = createPineRuntime(ir);
  for (let i = 0; i < 2; i++) {
    const before = runtime.snapshot();
    try {
      runtime.push(bar(i, { open: 1e308, high: 1e308, low: 1e308, close: 1e308 }));
    } catch {
      assert.deepEqual(runtime.snapshot(), before, "Numeric-domain failures must not partially commit state");
      return;
    }
    const after = runtime.snapshot();
    assert.ok(after.data.every(value => value === null || Number.isFinite(value)), "Internal accumulators must obey the finite-or-NA snapshot contract");
    assert.doesNotThrow(() => createPineRuntime(ir, after), "An engine must be able to restore its own snapshot");
  }
});

test("snapshot timestamps must preserve the monotonic candle invariant", () => {
  const ir = accept("average = ta.ema(close, 3)");
  const runtime = createPineRuntime(ir);
  runtime.push(bar(0));
  const snapshot = runtime.snapshot();
  for (const lastTime of [NaN, Infinity, -1, 1.5, null]) {
    assert.throws(() => createPineRuntime(ir, { ...snapshot, lastTime }), `Invalid lastTime=${lastTime} must be rejected`);
  }
});

test("v6 loops cannot silently freeze a bound modified by their body", () => {
  const body = "n = 3\nhits = 0\nfor i = 0 to n\n    hits += 1\n    n := 1";
  const current = compilePineToSolana(strategy(body, 6));
  if (current.ok) {
    assert.equal(createPineRuntime(current.ir!).push(bar(0)).outputs.hits, 2, "Pine v6 evaluates the end bound before every iteration");
  } else {
    assert.ok(current.diagnostics.some(issue => issue.severity === "error" && issue.code !== "COMPILER_INTERNAL"), details(current));
    assert.deepEqual(current.files, {});
  }
  const previous = compilePineToSolana(strategy(body, 5));
  assert.equal(previous.ok, true, details(previous));
  assert.equal(createPineRuntime(previous.ir!).push(bar(0)).outputs.hits, 4, "Pine v5 evaluates the end bound once before iteration");
});

test("v6 dynamic-bound detection includes a function's captured global names", () => {
  reject("n = 3\ngetEnd() => n\nhits = 0\nfor i = 0 to getEnd()\n    hits += 1\n    n := 1");
});

test("literal history retains its version-specific validity", () => {
  reject("prior = 6[1]", {}, 6);
  reject("prior = true[1]", {}, 6);
  const previous = compilePineToSolana(strategy("prior = 6[1]", 5));
  assert.equal(previous.ok, true, details(previous));
  const runtime = createPineRuntime(previous.ir!);
  assert.equal(runtime.push(bar(0)).outputs.prior, null);
  assert.equal(runtime.push(bar(1)).outputs.prior, 6);
});

test("v5 const-int division preserves types through min, max, and ternary expressions", () => {
  for (const [body, expected] of [
    ["x = math.min(5, 6) / 2", 2],
    ["x = math.max(4, 5) / 2", 2],
    ["x = (true ? 5 : 6) / 2", 2],
    ["x = math.min(5.0, 6) / 2", 2.5],
    ["x = (true ? 5.0 : 6) / 2", 2.5],
  ] as const) {
    for (const version of [5, 6]) {
      const result = compilePineToSolana(strategy(body, version));
      assert.equal(result.ok, true, `${body}, v${version}: ${details(result)}`);
      const output = createPineRuntime(result.ir!).push(bar(0)).outputs.x;
      assert.equal(output, version === 6 ? 2.5 : expected, `${body}, v${version}`);
    }
  }
});

test("assigning an int value to a float variable must not narrow the declared type", () => {
  const ir = accept("float x = 1\nx := 2\nx := close");
  assert.equal(createPineRuntime(ir).push(bar(0, {close: 1.5})).outputs.x, 1.5);
});

test("color literals must not masquerade as strings in executable expressions", () => {
  reject("value = input.string(#FFFFFF)");
  reject('same = #FFFFFF == "#FFFFFF"');
});

test("input declaration count is bounded even when string inputs need no graph nodes", () => {
  const body = Array.from({ length: 128 }, (_, i) => `setting${i} = input.string("a")`).join("\n");
  assert.equal(Object.keys(accept(body).inputs).length, 128);
  const rejected = reject(body + '\nextra = input.string("a")');
  assert.ok(rejected.diagnostics.some(issue => issue.code === "INPUT_LIMIT"), details(rejected));
});

test("resolved input string aliases share an aggregate UTF-8 metadata budget", () => {
  const acceptedBody = `textValue = "${"a".repeat(1024)}"\n` + Array.from({ length: 60 }, (_, i) => `setting${i} = input.string(textValue)`).join("\n");
  assert.equal(Object.keys(accept(acceptedBody).inputs).length, 60);
  const rejected = reject(`textValue = "${"é".repeat(20_000)}"\na = input.string(textValue)\nb = input.string(textValue)`);
  assert.ok(rejected.diagnostics.some(issue => issue.code === "INPUT_METADATA_LIMIT"), details(rejected));
});

test("repeated presentation aliases and resolved overrides consume the same metadata budget", () => {
  const presentation = reject(`textValue = "${"😀".repeat(5000)}"\na = input.string("", title=textValue, tooltip=textValue, group=textValue, inline=textValue)`);
  assert.ok(presentation.diagnostics.some(issue => issue.code === "INPUT_METADATA_LIMIT"), details(presentation));
  const body = Array.from({ length: 17 }, (_, i) => `setting${i} = input.string("")`).join("\n");
  const overrides = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`setting${i}`, "a".repeat(4096)]));
  const overrideResult = reject(body, { inputs: overrides });
  assert.ok(overrideResult.diagnostics.some(issue => issue.code === "INPUT_METADATA_LIMIT"), details(overrideResult));
});

test("compile API rejects input-alias amplification with 422 and a bounded artifact-free response", async () => {
  const body = `textValue = "${"a".repeat(6000)}"\n` + Array.from({ length: 200 }, (_, i) => `setting${i} = input.string(textValue)`).join("\n");
  const pineScript = strategy(body);
  assert.ok(Buffer.byteLength(pineScript, "utf8") < 16_000, "Regression source should remain much smaller than the request limit");
  const response = await POST(new Request("http://localhost/api/launchpad/compile-solana", { method: "POST", body: JSON.stringify({ pineScript }) }));
  assert.equal(response.status, 422);
  const serialized = await response.text();
  assert.ok(Buffer.byteLength(serialized, "utf8") < 64 * 1024, "A small input must not amplify into a multi-megabyte error response");
  const result = JSON.parse(serialized) as CompileResult;
  assert.equal(result.ok, false);
  assert.deepEqual(result.files, {});
  assert.equal(result.ir, undefined);
  assert.equal(result.manifest, undefined);
  assert.ok(result.diagnostics.some(issue => issue.code === "INPUT_METADATA_LIMIT"), details(result));
});

test("constant folding visits shared graph nodes once and rejects overflow within a bounded time", () => {
  // A subprocess deadline protects the test runner if DAG memoization regresses:
  // the old evaluator expanded this 202-node graph into roughly 2^200 visits.
  const compilerPath = resolve("lib/pine-solana/compiler.ts");
  const code = `
    const { compilePineToSolana } = require(${JSON.stringify(compilerPath)});
    function source(operator) {
      return ['//@version=6', 'strategy("DAG")', 'v0 = 2.0',
        ...Array.from({length: 200}, (_, i) => 'v' + (i + 1) + ' = v' + i + ' ' + operator + ' v' + i),
        'strategy.entry("L", strategy.long, qty=v200)'].join('\\n');
    }
    const finite = compilePineToSolana(source('+'));
    const overflow = compilePineToSolana(source('*'));
    process.stdout.write(JSON.stringify({finite: finite.ok, nodes: finite.ir?.nodes.length, overflow: overflow.ok,
      overflowCodes: overflow.diagnostics.filter(issue => issue.severity === 'error').map(issue => issue.code)}));
  `;
  const child = spawnSync(process.execPath, [...process.execArgv.filter(arg => arg !== "--test"), "-e", code], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.finite, true);
  assert.ok(result.nodes <= 256);
  assert.equal(result.overflow, false);
  assert.ok(result.overflowCodes.includes("QUANTITY"));
  assert.ok(!result.overflowCodes.includes("COMPILER_INTERNAL"));
});
