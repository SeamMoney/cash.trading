import assert from "node:assert/strict";
import test from "node:test";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { parseStrictPine } from "../lib/pine-solana/parser";
import { createPineRuntime } from "../lib/pine-solana/runtime";

const script = (body: string, version = 6) => `//@version=${version}\nstrategy("Syntax regression")\n${body}\nstrategy.entry("L", strategy.long)\n`;

function rejected(body: string, code: string, version = 6): void {
  const source = script(body, version);
  const parsed = parseStrictPine(source);
  assert.ok(parsed.diagnostics.some(d => d.code === code && d.severity === "error"), `${body}: ${JSON.stringify(parsed.diagnostics)}`);
  const compiled = compilePineToSolana(source);
  assert.equal(compiled.ok, false, body);
  assert.deepEqual(compiled.files, {}, "invalid syntax must not yield a deployable source project");
}

function accepted(body: string, version = 6) {
  const source = script(body, version);
  const parsed = parseStrictPine(source);
  assert.deepEqual(parsed.diagnostics, [], `${body}: ${JSON.stringify(parsed.diagnostics)}`);
  const compiled = compilePineToSolana(source);
  assert.equal(compiled.ok, true, `${body}: ${JSON.stringify(compiled.diagnostics)}`);
  return compiled;
}

// TradingView reserves four-space indentation for blocks outside delimiters:
// https://www.tradingview.com/pine-script-docs/language/script-structure/#line-wrapping
test("trailing operators cannot consume a four-space block as a wrapped expression", () => {
  for (const version of [4, 5, 6]) {
    for (const body of [
      "value =\n    close",
      "value = close +\n    1",
      "value = -\n        close",
      "value = true ?\n    close : open",
      "value = true ? close :\n    open",
      "value = close +\n    // A comment does not turn the next block line into a continuation.\n    1",
      "value = close +\n\t1",
      "value = close\nvalue +=\n    1",
      "addOne(x) =>\n    value = x +\n        1\n    value\nresult = addOne(close)",
    ]) rejected(body, "PINE_INDENTATION", version);
  }
});

test("leading binary and ternary operators cannot create continuations at block boundaries", () => {
  for (const body of [
    "value = close\n    * 2",
    "value = close\n    > open",
    "value = close > open\n    and true",
    "value = close > open\n    ? close : open",
    "value = true ? close\n    : open",
  ]) rejected(body, "PINE_INDENTATION");
});

test("valid non-block continuations preserve operators, branches and statement ownership", () => {
  const result = accepted(`first = close +
  1
second = close
   * 2
third = close > open
     ? first
  : second
negate(x) =>
    localValue = x +
      2
    -localValue
fourth = negate(close)`);
  const bar = { time: 1, open: 9, high: 10, low: 9, close: 10, volume: 1 };
  const outputs = createPineRuntime(result.ir!).push(bar).outputs;
  assert.deepEqual([outputs.first, outputs.second, outputs.third, outputs.fourth], [11, 20, 11, -12]);
});

test("parentheses and brackets retain Pine's unrestricted wrapped indentation", () => {
  const result = accepted(`first = (
close +
    1
)
second = (close
    * 2)
prior = close[
    1
]
choose(x) =>
    localValue = (
 x +
        2)
    -localValue
third = choose(
close)`);
  const outputs = createPineRuntime(result.ir!).push({ time: 1, open: 9, high: 10, low: 9, close: 10, volume: 1 }).outputs;
  assert.deepEqual([outputs.first, outputs.second, outputs.prior, outputs.third], [11, 20, null, -12]);
});

// These additional reserved names were introduced in Pine v5:
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-5/#reserved-keywords
const v5ReservedNames = ["catch", "class", "do", "ellipse", "in", "is", "polygon", "range", "return", "struct", "text", "throw", "try"];

test("v5 and v6 reject reserved names in every binding position", () => {
  for (const version of [5, 6]) {
    for (const name of v5ReservedNames) {
      rejected(`${name} = close`, "PINE_RESERVED_IDENTIFIER", version);
      rejected(`${name}(x) => x\nvalue = ${name}(close)`, "PINE_RESERVED_IDENTIFIER", version);
      rejected(`identity(${name}) => ${name}\nvalue = identity(close)`, "PINE_RESERVED_IDENTIFIER", version);
      rejected(`[${name}, validName] = [close, open]`, "PINE_RESERVED_IDENTIFIER", version);
      rejected(`for ${name} = 1 to 2\n    value = close`, "PINE_RESERVED_IDENTIFIER", version);
      rejected(`${name} := close`, "PINE_RESERVED_IDENTIFIER", version);
    }
  }
});

test("v5-reserved names remain available to v4 programs", () => {
  for (const name of v5ReservedNames) {
    accepted(`${name} = close\nvalue = ${name} + 1`, 4);
    accepted(`${name}(x) => x + 1\nvalue = ${name}(close)`, 4);
  }
});

test("reserved binding checks preserve built-in text argument names and namespace constants", () => {
  accepted('textValue = "signal"\nplotshape(close > open, text = textValue)\nRange = close\nreturnValue = Range + 1');
  const parsed = parseStrictPine('//@version=6\nvalue = text.align_center\n');
  assert.deepEqual(parsed.diagnostics, []);
  const declaration = parsed.statements[0];
  assert.equal(declaration.kind, "declare");
  if (declaration.kind === "declare") assert.deepEqual(declaration.value.kind === "identifier" && declaration.value.name, "text.align_center");
});

// A history result cannot receive another history operator on the same value:
// https://www.tradingview.com/pine-script-docs/language/operators/#-history-referencing-operator
test("repeated history operators fail closed instead of inventing a second delayed series", () => {
  for (const version of [4, 5, 6]) {
    for (const value of ["close[1][2]", "close[0][0]", "(close[1])[2]", "((close[1]))[2]", "-close[1][2]"]) {
      rejected(`value = ${value}`, "PINE_HISTORY_CHAIN", version);
    }
  }
});

test("declared or computed series can use their own history after another series is delayed", () => {
  const result = accepted("prior = close[1]\ndelayed = prior[1]\ntransformed = (close[1] + 1)[1]");
  const runtime = createPineRuntime(result.ir!);
  const trace = [10, 20, 30].map((close, i) => runtime.push({ time: i + 1, open: close, high: close, low: close, close, volume: 1 }).outputs);
  assert.deepEqual(trace.map(row => row.delayed), [null, null, 10]);
  assert.deepEqual(trace.map(row => row.transformed), [null, null, 11]);
});
