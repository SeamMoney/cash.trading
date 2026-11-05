import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictPine } from "../lib/pine-solana/parser";
import type { PineExpr, PineProgram, PineStmt } from "../lib/pine-solana/types";

const source = (body: string, version = 6): string => `//@version=${version}\n${body}\n`;
function parsed(body: string, version = 6): PineProgram {
  const program = parseStrictPine(source(body, version));
  assert.deepEqual(program.diagnostics, [], JSON.stringify(program.diagnostics));
  return program;
}
function statement<K extends PineStmt["kind"]>(program: PineProgram, index: number, kind: K): Extract<PineStmt, { kind: K }> {
  const node = program.statements[index];
  assert.equal(node?.kind, kind);
  return node as Extract<PineStmt, { kind: K }>;
}
function expression<K extends PineExpr["kind"]>(node: PineExpr, kind: K): Extract<PineExpr, { kind: K }> {
  assert.equal(node.kind, kind);
  return node as Extract<PineExpr, { kind: K }>;
}

test("nested blocks own every statement and preserve else branches", () => {
  const program = parsed(`strategy("Scope")
var float total = 0
if close > open
    total := total + 1
    if volume > 100
        strategy.entry("L", strategy.long)
        total += 2
    else
        total -= 1
else if close < open
    strategy.entry("S", strategy.short)
else
    total := 0
plot(total)`);
  assert.equal(program.statements.length, 4, "nested statements must never leak to top level");
  const outer = statement(program, 2, "if");
  assert.equal(outer.then.length, 2);
  assert.equal(outer.then[0].kind, "assign");
  const inner = outer.then[1] as Extract<PineStmt, { kind: "if" }>;
  assert.equal(inner.kind, "if");
  assert.equal(inner.then.length, 2);
  assert.equal(inner.otherwise.length, 1);
  assert.equal(outer.otherwise.length, 1);
  const elseIf = outer.otherwise[0] as Extract<PineStmt, { kind: "if" }>;
  assert.equal(elseIf.kind, "if");
  assert.equal(elseIf.otherwise.length, 1);
  assert.equal(outer.span.line, 4);
  assert.equal(outer.span.endLine, 14);
});

test("declarations, persistent declarations, and reassignment remain distinct", () => {
  const program = parsed(`var float x = na
varip int updates = 0
float y = 0
x := close
x += 1
updates -= 1
y *= 2
y /= 3
y %= 2`);
  assert.equal(statement(program, 0, "declare").mode, "var");
  assert.equal(statement(program, 0, "declare").typeName, "float");
  assert.equal(expression(statement(program, 0, "declare").value, "literal").value, null);
  assert.equal(statement(program, 1, "declare").mode, "varip");
  assert.equal(statement(program, 2, "declare").mode, "normal");
  assert.deepEqual(program.statements.slice(3).map(node => (node as Extract<PineStmt, { kind: "assign" }>).operator), [":=", "+=", "-=", "*=", "/=", "%="]);
});

test("inline functions retain the entire return expression", () => {
  const program = parsed(`double(x) => x * 2
y = double(close)`);
  const fn = statement(program, 0, "function");
  assert.deepEqual(fn.params, ["x"]);
  const returned = fn.body[0] as Extract<PineStmt, { kind: "expression" }>;
  assert.equal(returned.kind, "expression");
  assert.equal(expression(returned.expression, "binary").operator, "*");
  assert.equal(expression(statement(program, 1, "declare").value, "call").name, "double");
});

test("multiline functions preserve locals, tuple returns, and unary returns", () => {
  const program = parsed(`spread(a, b) =>
    difference = a - b
    ratio = a / b
    [difference, ratio]
negative(x) =>
    y = x * 2
    -y
[spreadValue, ratioValue] = spread(close, open)`);
  const first = statement(program, 0, "function");
  assert.equal(first.body.length, 3);
  const returned = first.body[2] as Extract<PineStmt, { kind: "expression" }>;
  assert.equal(expression(returned.expression, "tuple").items.length, 2);
  const second = statement(program, 1, "function");
  assert.equal(second.body.length, 2, "a signed expression on a block line is a separate return");
  assert.equal(expression((second.body[1] as Extract<PineStmt, { kind: "expression" }>).expression, "unary").operator, "-");
});

test("tuple declarations and namespace constants preserve their syntax", () => {
  const program = parsed(`[macd, signal, _] = ta.macd(close, 12, 26, 9)
strategy.entry("Long", strategy.long)`);
  const tuple = statement(program, 0, "declare");
  assert.deepEqual(tuple.names, ["macd", "signal", "_"]);
  assert.equal(expression(tuple.value, "call").name, "ta.macd");
  const entry = expression(statement(program, 1, "expression").expression, "call");
  assert.equal(entry.name, "strategy.entry");
  assert.equal(expression(entry.args[1], "identifier").name, "strategy.long");
});

test("history is attached to the full expression and retains dynamic offsets", () => {
  const program = parsed(`a = (close + open)[3]
b = ta.ema(close, 9)[2]
c = a[lookback + 1]
d = c[0]`);
  const a = expression(statement(program, 0, "declare").value, "history");
  assert.equal(a.source.kind, "binary");
  assert.equal(expression(a.offset, "literal").value, 3);
  assert.equal(expression(statement(program, 1, "declare").value, "history").source.kind, "call");
  assert.equal(expression(statement(program, 2, "declare").value, "history").offset.kind, "binary");
  assert.equal(expression(expression(statement(program, 3, "declare").value, "history").offset, "literal").value, 0);
});

test("operator precedence and right-associative ternaries are preserved", () => {
  const program = parsed(`x = 1 + 2 * 3 > 4 and not false or true
y = close > open ? 1 : close < open ? -1 : 0
z = 1 < 2 == true`);
  const top = expression(statement(program, 0, "declare").value, "binary");
  assert.equal(top.operator, "or");
  const conjunction = expression(top.left, "binary");
  assert.equal(conjunction.operator, "and");
  const comparison = expression(conjunction.left, "binary");
  assert.equal(comparison.operator, ">");
  assert.equal(expression(expression(comparison.left, "binary").right, "binary").operator, "*");
  assert.equal(expression(statement(program, 1, "declare").value, "conditional").whenFalse.kind, "conditional");
  assert.equal(expression(expression(statement(program, 2, "declare").value, "binary").left, "binary").operator, "<");
});

test("multiline calls, comments, named arguments, and continuations consume every token", () => {
  const program = parsed(`strategy(
    "Wrapped",
    overlay = true)
fast = ta.sma(
    close, // actual OHLC source
    5)
go = close >
    fast and
    volume > 0
label = go
   ? "go"
   : "wait"
inputLength = input.int(
    defval = 5,
    title = "Length",
    minval = 1)`);
  assert.equal(program.statements.length, 5);
  const header = expression(statement(program, 0, "expression").expression, "call");
  assert.equal(expression(header.kwargs.overlay, "literal").value, true);
  assert.equal(expression(statement(program, 2, "declare").value, "binary").operator, "and");
  assert.equal(statement(program, 3, "declare").value.kind, "conditional");
  const input = expression(statement(program, 4, "declare").value, "call");
  assert.equal(expression(input.kwargs.defval, "literal").value, 5);
  assert.equal(expression(input.kwargs.title, "literal").value, "Length");
});

test("strings, booleans, zero, na and numeric exponents are never coerced", () => {
  const program = parsed(`text = input.string("first\\nsecond")
enabled = input.bool(false)
zero = 0
missing = na
number = .5e-2
isMissing = na(missing)
shade = #ff00aa80`);
  const text = expression(statement(program, 0, "declare").value, "call");
  assert.equal(expression(text.args[0], "literal").value, "first\nsecond");
  const enabled = expression(statement(program, 1, "declare").value, "call");
  assert.equal(expression(enabled.args[0], "literal").value, false);
  assert.equal(expression(statement(program, 2, "declare").value, "literal").value, 0);
  assert.equal(expression(statement(program, 3, "declare").value, "literal").value, null);
  assert.equal(expression(statement(program, 4, "declare").value, "literal").value, 0.005);
  assert.equal(expression(statement(program, 5, "declare").value, "call").name, "na");
  assert.equal(expression(statement(program, 6, "declare").value, "literal").value, "#ff00aa80");
});

test("numeric literal spelling preserves Pine int versus float typing", () => {
  const program = parsed("a = 5\nb = 5.0\nc = 5e0\nd = .5\ne = 5.\nf = -5");
  assert.equal(expression(statement(program, 0, "declare").value, "literal").numericType, "int");
  for (const index of [1, 2, 3, 4]) assert.equal(expression(statement(program, index, "declare").value, "literal").numericType, "float");
  const negative = expression(statement(program, 5, "declare").value, "unary");
  assert.equal(expression(negative.operand, "literal").numericType, "int");
});

test("hex color literals remain distinct from string literals with identical text", () => {
  const program = parsed('a = #FF00AA\nb = "#FF00AA"');
  const color = expression(statement(program, 0, "declare").value, "literal");
  const string = expression(statement(program, 1, "declare").value, "literal");
  assert.equal(color.colorLiteral, true);
  assert.equal(string.colorLiteral, undefined);
  assert.equal(color.value, string.value);
});

test("string escapes use Pine's documented meanings rather than JavaScript control escapes", () => {
  const program = parsed(String.raw`text = "\r\b\f\T\n\t\\\""`);
  const text = expression(statement(program, 0, "declare").value, "literal");
  assert.equal(text.value, 'rbfT\n\t\\"');
});

test("CRLF and tab-indented source retains useful line and column spans", () => {
  const program = parseStrictPine('//@version=5\r\nif close > 0\r\n\tstrategy.entry("L", strategy.long)\r\n');
  assert.deepEqual(program.diagnostics, []);
  const branch = statement(program, 0, "if");
  assert.equal(branch.span.line, 2);
  assert.equal(branch.then[0].span.line, 3);
  assert.equal(branch.then[0].span.column, 5);
});

test("v4 and v5 calls are preserved for version-aware semantic lowering", () => {
  for (const version of [4, 5, 6]) {
    const program = parsed(`study("Legacy")
average = sma(close, 10)
strategy.entry("L", strategy.long, when = close > average)`, version);
    assert.equal(program.version, version);
    assert.equal(expression(statement(program, 1, "declare").value, "call").name, "sma");
    const order = expression(statement(program, 2, "expression").expression, "call");
    assert.equal(order.kwargs.when.kind, "binary");
  }
});

test("for and while loops retain full nested bodies and explicit step", () => {
  const program = parsed(`sum = 0
for i = 10 to 1 by 2
    sum += close[i]
    sum -= open[i]
while sum > 10
    sum -= 1
    if sum > 50
        sum /= 2`);
  const loop = statement(program, 1, "for");
  assert.equal(loop.variable, "i");
  assert.equal(expression(loop.from, "literal").value, 10);
  assert.equal(expression(loop.to, "literal").value, 1);
  assert.equal(expression(loop.step!, "literal").value, 2);
  assert.equal(loop.body.length, 2);
  const whileLoop = statement(program, 2, "while");
  assert.equal(whileLoop.body.length, 2);
  assert.equal(whileLoop.body[1].kind, "if");
});

const failures: Array<[string, string, string]> = [
  ["unknown characters", "x = close @ 1", "PINE_UNKNOWN_CHARACTER"],
  ["semicolon-separated statements", "x = 1; y = 2", "PINE_UNKNOWN_CHARACTER"],
  ["unclosed string", 'x = "hello', "PINE_UNTERMINATED_STRING"],
  ["unclosed call", "x = ta.sma(close, 10", "PINE_DELIMITER"],
  ["unmatched delimiter", "x = 1)", "PINE_DELIMITER"],
  ["missing operand", "x = close +", "PINE_SYNTAX"],
  ["trailing source", "x = close 123", "PINE_TRAILING_TOKEN"],
  ["malformed tuple", "[a, 1] = ta.macd(close, 12, 26, 9)", "PINE_TRAILING_TOKEN"],
  ["orphan else", "else\n    x = 1", "PINE_SYNTAX"],
  ["missing body", "if close > 0", "PINE_EMPTY_BLOCK"],
  ["invalid indentation", "if close > 0\n  x = 1", "PINE_INDENTATION"],
  ["duplicate kwargs", "x = input.int(defval=1, defval=2)", "PINE_DUPLICATE_ARGUMENT"],
  ["positional after keyword", "x = input.int(defval=1, 2)", "PINE_ARGUMENT_ORDER"],
  ["duplicate params", "f(x,x) => x", "PINE_DUPLICATE_PARAMETER"],
  ["duplicate tuple targets", "[x,x] = ta.bb(close,20,2)", "PINE_DUPLICATE_TARGET"],
  ["unsupported types", "type Point\n    float x", "PINE_UNSUPPORTED_SYNTAX"],
  ["typed params", "f(float x) => x", "PINE_UNSUPPORTED_SYNTAX"],
  ["default params", "f(x=1) => x", "PINE_UNSUPPORTED_SYNTAX"],
  ["switch expression", "x = switch close\n    1 => 0", "PINE_UNSUPPORTED_SYNTAX"],
  ["collection loops", "for x in values\n    plot(x)", "PINE_UNSUPPORTED_SYNTAX"],
  ["out of range number", "x = 9007199254740993", "PINE_NUMBER_RANGE"],
  ["nonfinite number", "x = 1e999", "PINE_INVALID_NUMBER"],
];
for (const [name, body, code] of failures) {
  test(`fails closed on ${name}`, () => {
    const program = parseStrictPine(source(body));
    assert.ok(program.diagnostics.some(issue => issue.severity === "error" && issue.code === code), JSON.stringify(program.diagnostics));
    for (const issue of program.diagnostics) {
      assert.ok(issue.line > 0 && issue.column > 0);
    }
  });
}

test("omitted, unsupported, or duplicate versions are never silently upgraded", () => {
  const omitted = parseStrictPine('strategy("No version")');
  assert.equal(omitted.version, 1);
  assert.ok(omitted.diagnostics.some(issue => issue.code === "PINE_VERSION"));
  assert.ok(parseStrictPine(source("x=1", 7)).diagnostics.some(issue => issue.code === "PINE_VERSION"));
  assert.ok(parseStrictPine("//@version=5\n//@version=6\nx=1").diagnostics.some(issue => issue.code === "PINE_VERSION"));
});

test("keyword names cannot mutate prototypes", () => {
  const program = parsed("value = f(__proto__=1, constructor=2)");
  const call = expression(statement(program, 0, "declare").value, "call");
  assert.equal(Object.getPrototypeOf(call.kwargs), null);
  assert.equal(expression(call.kwargs.__proto__, "literal").value, 1);
});

test("resource limits return diagnostics instead of throwing or hanging", () => {
  for (const text of [
    source("x = " + "(".repeat(200) + "1" + ")".repeat(200)),
    source("x = " + "not ".repeat(300) + "true"),
    source("x = 1\n".repeat(40_000)),
    source(" ".repeat(260_000)),
  ]) {
    let program: PineProgram | undefined;
    assert.doesNotThrow(() => { program = parseStrictPine(text); });
    assert.ok(program!.diagnostics.some(issue => issue.code === "PINE_RESOURCE_LIMIT"), JSON.stringify(program!.diagnostics));
  }
});

test("malformed input corpus always terminates with bounded diagnostic output", () => {
  let seed = 0x2468ace;
  const alphabet = "xyz_[]():=+->!?., \n\t0123456789'\"";
  for (let trial = 0; trial < 150; trial++) {
    let text = "";
    for (let i = 0; i < 150; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += alphabet[seed % alphabet.length];
    }
    const result = parseStrictPine(source(text));
    assert.ok(Array.isArray(result.statements));
    assert.ok(result.diagnostics.length <= 51);
  }
});
