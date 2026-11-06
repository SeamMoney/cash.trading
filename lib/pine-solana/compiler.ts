import { createHash } from "node:crypto";
import { parseStrictPine } from "./parser";
import type { PineExpr, PineStmt } from "./types";
import { generateRustFiles } from "./rust-codegen";
import { IR_VERSION, SOLANA_COMPILER_VERSION } from "./ir";
import { computeConfigHash, NUMERIC_PROFILE } from "./commitment";
import type { CompileOptions, CompileResult, Diagnostic, Layout, Node, Op, Order, ProgramIR, ValueType } from "./ir";
import { pineModulo, pineRound, pineRoundForComparison } from "./numeric";

type Qualifier = "const" | "input" | "simple" | "series";
type Binding = { node?: number; text?: string; type: ValueType | "string"; input?: boolean; series?: number; integer?: boolean; qualifier?: Qualifier };
type Env = Map<string, Binding>;
type Location = { span?: { line: number; column: number } };
type ExecutionGuard = number | (() => number);
class Rejected extends Error {
  constructor(readonly diagnostic: Diagnostic) { super(diagnostic.message); }
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const canonicalizePine = (source: string) => source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const visualNames = new Set(["plot", "plotshape", "plotchar", "plotarrow", "plotbar", "plotcandle", "hline", "fill", "bgcolor", "barcolor"]);
const dataFields = new Set(["open", "high", "low", "close", "volume", "time", "bar_index"]);
const legacyTA = new Set(["sma", "ema", "rma", "wma", "rsi", "macd", "bb", "stdev", "variance", "highest", "lowest", "crossover", "crossunder", "cross", "change", "roc", "atr", "tr", "stoch", "sum"]);
const constantHeaders = new Set(["title", "shorttitle", "overlay", "precision", "format", "max_bars_back", "max_lines_count", "max_labels_count", "max_boxes_count", "explicit_plot_zorder"]);
const MAX_INPUTS = 128;
const MAX_INPUT_METADATA_BYTES = 64 * 1024;

/** Strict source -> bounded, typed graph -> Rust/Anchor project. No Move IR or inferred trading rules. */
export function compilePineToSolana(source: string, options: CompileOptions = {}): CompileResult {
  const failResult = (diagnostics: Diagnostic[]): CompileResult => ({ ok: false, target: "solana", executionModel: "confirmed-bar-signal", diagnostics, files: {} });
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > 128_000) return failResult([{ severity: "error", code: "SOURCE_LIMIT", message: "Pine source must be a string of at most 128,000 UTF-8 bytes.", line: 1, column: 1 }]);
  source = canonicalizePine(source);
  const ast = parseStrictPine(source);
  const diagnostics: Diagnostic[] = [...ast.diagnostics];
  const nodes: Node[] = [];
  const orders: Order[] = [];
  const inputs: ProgramIR["inputs"] = Object.create(null);
  const env: Env = new Map();
  const functions = new Map<string, Extract<PineStmt, { kind: "function" }>>();
  const functionGlobals = new Map<string, Set<string>>();
  const persistent = new Map<string, number>();
  const finalSeries = new Map<number, number>();
  const loopCounters = new Set<number>();
  const historyFixups: Array<{ node: number; series: number }> = [];
  let seriesCounter = 0;
  const outputs: Record<string, number> = Object.create(null);
  const callStack: string[] = [];
  let title = "Pine strategy";
  let headerCount = 0;
  let scriptKind = "";
  let defaultQuantity = 1;
  let firstExecutable = false;
  let loweringCount = 0;
  let inputCount = 0;
  let inputMetadataBytes = 0;
  const maxHistory = options.maxHistory ?? 128;
  const maxStateBytes = options.maxStateBytes ?? 7200;
  function error(code: string, message: string, location?: Location): never {
    throw new Rejected({ severity: "error", code, message, line: location?.span?.line ?? 1, column: location?.span?.column ?? 1 });
  }
  const info = (code: string, message: string, location?: Location, severity: Diagnostic["severity"] = "info") => {
    diagnostics.push({ severity, code, message, line: location?.span?.line ?? 1, column: location?.span?.column ?? 1 });
  };
  const add = (op: Op, a = 0, b = 0, c = 0, value: number | null = null, period = 0, type: ValueType = "number", location?: Location) => {
    if (nodes.length >= 256) error("NODE_LIMIT", "The expanded program exceeds 256 graph nodes; split the strategy or use an off-chain execution adapter.", location);
    const id = nodes.length;
    nodes.push({ op, a, b, c, value, period, type, line: location?.span?.line ?? 1 });
    return id;
  };
  const constant = (value: number | boolean | null, location?: Location): Binding => ({ node: add("const", 0, 0, 0, typeof value === "boolean" ? +value : value, 0, typeof value === "boolean" ? "bool" : "number", location), type: typeof value === "boolean" ? "bool" : "number", integer: typeof value === "number" && Number.isInteger(value), qualifier: "const" });
  const qualifier = (...values: Binding[]): Qualifier => values.some(v => !v.qualifier || v.qualifier === "series") ? "series" : values.some(v => v.qualifier === "simple") ? "simple" : values.some(v => v.qualifier === "input") ? "input" : "const";
  const number = (binding: Binding, location?: Location): number => {
    if (binding.type !== "number" || binding.node === undefined) error("TYPE_NUMBER", "Expected a numeric expression.", location);
    return binding.node!;
  };
  const boolean = (binding: Binding, location?: Location): number => {
    if (binding.type === "string" || binding.node === undefined) error("TYPE_BOOL", "Expected a boolean condition.", location);
    if (binding.type !== "bool") {
      if (ast.version >= 6) error("TYPE_BOOL", "Pine v6 requires a boolean condition; numeric-to-boolean conversion must be explicit.", location);
      // Numeric truth is exact nonzero truth, not Pine's rounded comparison to
      // zero. Legacy implicit casts also treat missing numbers as false.
      return add("select", binding.node!, constant(true).node!, constant(false).node!, null, 0, "bool", location);
    }
    return binding.node!;
  };
  const text = (binding: Binding, location?: Location): string => {
    if (binding.type !== "string") error("CONSTANT_STRING", "A compile-time string is required here.", location);
    return binding.text!;
  };
  const binding = (id: number): Binding => ({ node: id, type: nodes[id].type });
  function newSeries(value: Binding): Binding {
    const series = seriesCounter++;
    if (value.node !== undefined) finalSeries.set(series, value.node);
    return { ...value, series };
  }
  const binary = (op: Op, left: number, right: number, type: ValueType = "number", location?: Location) => add(op, left, right, 0, null, 0, type, location);
  const resolveGuard = (guard: ExecutionGuard): number => typeof guard === "number" ? guard : guard();
  const branchTruth = (condition: number, location?: Location): number => ast.version >= 6 ? condition : add("select", condition, constant(true).node!, constant(false).node!, null, 0, "bool", location);
  function withinGuard(parent: ExecutionGuard, condition: number, otherwise = false, location?: Location): ExecutionGuard {
    let resolved: number | undefined;
    return () => {
      if (resolved === undefined) {
        const truth = branchTruth(condition, location);
        const predicate = otherwise ? add("not", truth, 0, 0, null, 0, "bool", location) : truth;
        resolved = binary("and", resolveGuard(parent), predicate, "bool", location);
      }
      return resolved;
    };
  }
  let firstBarGuard: number | undefined;
  const initializationGuard = (): number => firstBarGuard ??= binary("eq", number(field("bar_index")), number(constant(0)), "bool");
  const truncate = (id: number, location?: Location): number => add("select",
    binary("lt", add("sign", id), number(constant(0)), "bool"),
    add("ceil", id), add("floor", id), null, 0, "number", location);
  function constValue(id: number): number | null | undefined {
    // Shared expression nodes form a DAG. Re-evaluating every reference can
    // expand exponentially even for a tiny source such as xN = xN-1 + xN-1.
    // Keep the memo local: later reassignment/history fixups can change nodes.
    const memo = new Map<number, number | null | undefined>();
    const active = new Set<number>();
    function evaluate(nodeId: number): number | null | undefined {
      if (memo.has(nodeId)) return memo.get(nodeId);
      if (active.has(nodeId)) return undefined;
      active.add(nodeId);
      const resolved = resolveNode(nodeId);
      // Every emitted operation normalizes non-finite results to missing. A
      // constant expression must use the same rule before it controls a period,
      // input, quantity, or loop bound.
      const value = typeof resolved === "number" && !Number.isFinite(resolved) ? null : resolved;
      active.delete(nodeId);
      memo.set(nodeId, value);
      return value;
    }
    function resolveNode(nodeId: number): number | null | undefined {
      const n = nodes[nodeId];
      if (n.op === "const") return n.value;
      if (n.op === "checked_int") {
        const enabled = evaluate(n.b);
        if (enabled === undefined) return undefined;
        if (enabled === null || enabled === 0) return null;
        const value = evaluate(n.a);
        if (value !== null && value !== undefined && !Number.isSafeInteger(value)) error("INTEGER_RANGE", "Integer values must be exactly representable between -9007199254740991 and 9007199254740991.", { span: { line: n.line, column: 1 } });
        return value;
      }
      const a = evaluate(n.a);
      if (n.op === "select") {
        if (a === undefined) return undefined;
        return evaluate(a !== null && a !== 0 ? n.b : n.c);
      }
      if (a === undefined) return undefined;
      if (n.op === "is_na") return +(a === null);
      if (n.op === "not") return a === null && ast.version < 6 ? null : +(a === null || a === 0);
      if (n.op === "neg") return a === null ? null : -a;
      if (n.op === "abs") return a === null ? null : Math.abs(a);
      if (n.op === "floor") return a === null ? null : Math.floor(a);
      if (n.op === "ceil") return a === null ? null : Math.ceil(a);
      if (n.op === "round") return a === null ? null : pineRound(a);
      if (n.op === "sqrt") return a === null || a < 0 ? null : Math.sqrt(a);
      if (n.op === "sign") return a === null ? null : Math.sign(a);
      const b = evaluate(n.b);
      if (b === undefined) return undefined;
      if (n.op === "nz") return a === null ? b : a;
      if (n.op === "and") return a === 0 || b === 0 ? 0 : a === null || b === null ? ast.version >= 6 ? 0 : null : 1;
      if (n.op === "or") return a !== null && a !== 0 || b !== null && b !== 0 ? 1 : a === null || b === null ? ast.version >= 6 ? 0 : null : 0;
      if (["eq", "ne", "lt", "le", "gt", "ge"].includes(n.op)) {
        if (a === null || b === null) return ast.version >= 6 ? 0 : null;
        const x = pineRoundForComparison(a), y = pineRoundForComparison(b);
        return +(n.op === "eq" ? x === y : n.op === "ne" ? x !== y : n.op === "lt" ? x < y : n.op === "le" ? x <= y : n.op === "gt" ? x > y : x >= y);
      }
      if (a === null || b === null) return null;
      if (n.op === "add") return a + b;
      if (n.op === "sub") return a - b;
      if (n.op === "mul") return a * b;
      if (n.op === "div") return b === 0 ? null : a / b;
      if (n.op === "mod") return b === 0 ? null : pineModulo(a, b);
      if (n.op === "min") return Math.min(a, b);
      if (n.op === "max") return Math.max(a, b);
      return undefined;
    }
    return evaluate(id);
  }
  function checkedInteger(value: Binding, location: Location, guard: ExecutionGuard = 0): Binding {
    if (!value.integer || value.type !== "number" || value.node === undefined) return value;
    const node = nodes[value.node];
    // Candle time and the bar counter have matching range validation at both
    // runtime boundaries. Existing guards and constants need no extra node.
    if (["checked_int", "time", "bar_index"].includes(node.op)) return value;
    const known = constValue(value.node);
    if (known !== undefined) {
      if (known !== null && !Number.isSafeInteger(known)) error("INTEGER_RANGE", "Integer values must be exactly representable between -9007199254740991 and 9007199254740991; use an explicit float expression for floating-point arithmetic.", location);
      return value;
    }
    return { ...value, node: add("checked_int", value.node, resolveGuard(guard), 0, null, 0, "number", location) };
  }
  function fixedBinding(resolved: Binding, location: Location, integer = false): number {
    const value = constValue(number(resolved, location));
    if (typeof value !== "number" || !Number.isFinite(value)) error("CONSTANT_REQUIRED", "This parameter must be a finite compile-time number (literals and input defaults are supported).", location);
    if (integer && !resolved.integer) error("INTEGER_REQUIRED", "This parameter requires an int expression; use int() to convert a float explicitly.", location);
    return value as number;
  }
  function fixed(expr: PineExpr | undefined, scope: Env, fallback?: number, integer = false): number {
    if (!expr && fallback !== undefined) return fallback;
    if (!expr) return error("ARGUMENT_MISSING", "A numeric argument is required.");
    return fixedBinding(expression(expr, scope), expr, integer);
  }
  function period(expr: PineExpr | undefined, scope: Env, location: Location, fallback?: number) {
    const value = fixed(expr, scope, fallback, true);
    if (!Number.isInteger(value) || value < 1 || value > maxHistory) error("PERIOD_LIMIT", `Periods must be integers between 1 and ${maxHistory}.`, location);
    return value;
  }
  function history(id: number, offset: number, location?: Location): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > maxHistory) error("HISTORY_LIMIT", `History offsets must be constant integers from 0 through ${maxHistory}.`, location);
    return offset === 0 ? id : add("history", id, 0, 0, null, offset, nodes[id].type, location);
  }
  function getArgument(call: Extract<PineExpr, { kind: "call" }>, position: number, name: string): PineExpr | undefined {
    if (call.args[position] && call.kwargs[name]) error("DUPLICATE_ARGUMENT", `Argument ${name} was supplied twice.`, call);
    return call.kwargs[name] ?? call.args[position];
  }
  function validateArgs(call: Extract<PineExpr, { kind: "call" }>, names: string[], required: number, extras: string[] = []) {
    if (call.args.length > names.length) error("ARGUMENT_COUNT", `${call.name} accepts at most ${names.length} positional arguments in this target.`, call);
    for (const name of Object.keys(call.kwargs)) if (!names.includes(name) && !extras.includes(name)) error("UNKNOWN_ARGUMENT", `Unsupported argument ${name} on ${call.name}; it cannot be discarded.`, call);
    for (let i = 0; i < names.length; i++) {
      const value = getArgument(call, i, names[i]);
      if (i < required && !value) error("ARGUMENT_MISSING", `${call.name} requires ${names[i]}.`, call);
    }
  }
  function ta(op: Op, sourceId: number, len: number, location: Location) { return add(op, sourceId, 0, 0, null, len, "number", location); }
  function field(name: string, location?: Location): Binding {
    const previous = nodes.findIndex(n => n.op === name && dataFields.has(name));
    return { ...binding(previous >= 0 ? previous : add(name as Op, 0, 0, 0, null, 0, "number", location)), qualifier: "series", integer: name === "time" || name === "bar_index" };
  }
  function expression(expr: PineExpr, scope: Env, conditional = false, guard: ExecutionGuard = 0): Binding {
    return checkedInteger(lowerExpression(expr, scope, conditional, guard), expr, guard);
  }
  function lowerExpression(expr: PineExpr, scope: Env, conditional: boolean, guard: ExecutionGuard): Binding {
    if (++loweringCount > 10_000) error("COMPLEXITY_LIMIT", "The expanded source exceeds the compiler's expression budget.", expr);
    switch (expr.kind) {
      case "literal": {
        if ("colorLiteral" in expr && expr.colorLiteral) error("COLOR_EXECUTION", "Color values are supported only as display metadata, not numeric/string execution values.", expr);
        return typeof expr.value === "string" ? { type: "string", text: expr.value, qualifier: "const" } : { ...constant(expr.value, expr), integer: expr.numericType === "int" };
      }
      case "identifier": {
        if (expr.name === "_") error("UNDERSCORE_READ", "The underscore identifier discards a value and cannot be read.", expr);
        const local = scope.get(expr.name);
        if (local) return local;
        if (dataFields.has(expr.name)) return field(expr.name, expr);
        if (expr.name === "barstate.isconfirmed") return constant(true, expr);
        if (expr.name === "barstate.isfirst") return binding(binary("eq", number(field("bar_index")), number(constant(0)), "bool", expr));
        if (["hl2", "hlc3", "ohlc4", "hlcc4"].includes(expr.name)) {
          const names = expr.name === "hl2" ? ["high", "low"] : expr.name === "hlc3" ? ["high", "low", "close"] : expr.name === "ohlc4" ? ["open", "high", "low", "close"] : ["high", "low", "close", "close"];
          const sum = names.map(n => number(field(n))).reduce((a, b) => binary("add", a, b));
          return binding(binary("div", sum, number(constant(names.length)), "number", expr));
        }
        if (expr.name.startsWith("request.") || expr.name.startsWith("syminfo.") || expr.name.startsWith("timeframe.")) error("EXTERNAL_CONTEXT", `${expr.name} needs an explicit market/context adapter; this compiler never invents it.`, expr);
        if (expr.name.startsWith("strategy.")) error("BROKER_STATE", `${expr.name} requires real execution/fill state from a venue adapter. A signal program cannot fabricate broker state.`, expr);
        if (expr.name.startsWith("barstate.")) error("REALTIME_CONTEXT", `${expr.name} depends on TradingView's historical/realtime context; the native target processes confirmed bars.`, expr);
        error("UNKNOWN_IDENTIFIER", `Unknown identifier ${expr.name}.`, expr);
      }
      case "history": {
        if (ast.version >= 6 && expr.source.kind === "literal") error("V6_LITERAL_HISTORY", "Pine v6 does not permit history indexing on literals.", expr);
        if (conditional) error("CONDITIONAL_HISTORY", "Series history inside a conditional execution context needs call-site history semantics; hoist it to a global series.", expr);
        const value = expression(expr.source, scope, false, guard);
        if (value.node === undefined) error("STRING_HISTORY", "String series history is not implemented by the native target.", expr);
        const offset = fixed(expr.offset, scope, undefined, true);
        const result = history(value.node!, offset, expr);
        if (offset > 0 && expr.source.kind === "identifier" && value.series !== undefined) historyFixups.push({ node: result, series: value.series });
        return { ...binding(result), integer: value.integer, qualifier: "series" };
      }
      case "unary": {
        const operand = expression(expr.operand, scope, conditional, guard);
        if (expr.operator === "not") return { ...binding(add("not", boolean(operand, expr), 0, 0, null, 0, "bool", expr)), qualifier: operand.qualifier };
        if (expr.operator === "+") { number(operand, expr); return operand; }
        if (expr.operator === "-") return { ...binding(add("neg", number(operand, expr), 0, 0, null, 0, "number", expr)), integer: operand.integer, qualifier: operand.qualifier };
        error("UNSUPPORTED_OPERATOR", `Unsupported unary operator ${expr.operator}.`, expr);
      }
      case "binary": {
        const left = expression(expr.left, scope, conditional, guard);
        const lazy = ast.version >= 6 && ["and", "or"].includes(expr.operator);
        if (["and", "or"].includes(expr.operator)) {
          const leftCondition = boolean(left, expr.left);
          const right = expression(expr.right, scope, conditional || lazy, lazy ? withinGuard(guard, leftCondition, expr.operator === "or", expr) : guard);
          return { ...binding(binary(expr.operator as Op, leftCondition, boolean(right, expr.right), "bool", expr)), qualifier: qualifier(left, right) };
        }
        const right = expression(expr.right, scope, conditional, guard);
        const comparison: Record<string, Op> = { "==": "eq", "!=": "ne", "<": "lt", "<=": "le", ">": "gt", ">=": "ge" };
        if (comparison[expr.operator]) {
          if (left.type !== right.type && !(left.type === "number" && right.type === "number")) error("TYPE_MISMATCH", "Comparison operands have different types.", expr);
          if (left.type === "string") {
            if (!["==", "!="].includes(expr.operator)) error("STRING_OPERATOR", "Only equality of compile-time strings is supported.", expr);
            return { ...constant(expr.operator === "==" ? left.text === right.text : left.text !== right.text, expr), qualifier: qualifier(left, right) };
          }
          return { ...binding(binary(comparison[expr.operator], left.node!, right.node!, "bool", expr)), qualifier: qualifier(left, right) };
        }
        const ops: Record<string, Op> = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod" };
        if (!ops[expr.operator]) error("UNSUPPORTED_OPERATOR", `Unsupported operator ${expr.operator}; no substitute is generated.`, expr);
        const resultQualifier = qualifier(left, right);
        let id = binary(ops[expr.operator], number(left, expr.left), number(right, expr.right), "number", expr);
        const legacyIntDivision = expr.operator === "/" && ast.version < 6 && left.integer && right.integer && resultQualifier === "const";
        if (legacyIntDivision) id = truncate(id, expr);
        return { ...binding(id), integer: expr.operator === "/" ? !!legacyIntDivision : !!left.integer && !!right.integer, qualifier: resultQualifier };
      }
      case "conditional": {
        const conditionValue = expression(expr.condition, scope, conditional, guard);
        const condition = boolean(conditionValue, expr.condition);
        const yes = expression(expr.whenTrue, scope, true, withinGuard(guard, condition, false, expr));
        const no = expression(expr.whenFalse, scope, true, withinGuard(guard, condition, true, expr));
        if (yes.type !== no.type || yes.type === "string") error("CONDITIONAL_TYPE", "Conditional branches must have the same numeric or boolean type.", expr);
        return { ...binding(add("select", condition, yes.node!, no.node!, null, 0, yes.type, expr)), integer: !!yes.integer && !!no.integer, qualifier: qualifier(conditionValue, yes, no) };
      }
      case "call": return callExpression(expr, scope, conditional, guard);
      case "tuple": error("TUPLE_CONTEXT", "Tuple values are supported only in tuple declarations.", expr);
    }
  }
  function callExpression(call: Extract<PineExpr, { kind: "call" }>, scope: Env, conditional: boolean, guard: ExecutionGuard): Binding {
    const name = ast.version <= 4 && legacyTA.has(call.name) ? call.name === "sum" ? "math.sum" : `ta.${call.name}` : call.name;
    if (name.startsWith("input")) error("INPUT_CONTEXT", "Inputs must be declared as a top-level variable.", call);
    if (functions.has(name)) {
      if (callStack.includes(name) || callStack.length >= 8) error("RECURSION", "Recursive or excessively nested Pine functions cannot be bounded on this target.", call);
      const fn = functions.get(name)!;
      validateArgs(call, fn.params, fn.params.length);
      // Functions see lexical globals, never a caller's shadowing local declarations.
      const local: Env = new Map();
      for (const key of functionGlobals.get(name)!) {
        const global = env.get(key)!;
        local.set(key, global);
        const caller = scope.get(key);
        if (caller && caller.series !== undefined && caller.series === global.series) local.set(key, caller);
      }
      fn.params.forEach((p, i) => {
        const value = expression(getArgument(call, i, p)!, scope, conditional, guard);
        if (p !== "_") local.set(p, newSeries(value));
      });
      callStack.push(name);
      try {
        const localNames = new Set(fn.params.filter(name => name !== "_"));
        for (let i = 0; i < fn.body.length - 1; i++) {
          const s = fn.body[i];
          if (s.kind !== "declare" || s.mode !== "normal" || s.names.length !== 1) error("FUNCTION_BODY", "Native functions support pure local declarations followed by one return expression; side effects require an execution adapter.", s);
          if (localNames.has(s.names[0])) error("DUPLICATE_DECLARATION", `${s.names[0]} is already declared in this function.`, s);
          if (s.names[0] !== "_") localNames.add(s.names[0]);
          const v = expression(s.value, local, conditional, guard);
          if (s.typeName && (s.typeName === "int" ? !v.integer : s.typeName === "float" ? v.type !== "number" : s.typeName !== v.type)) error("DECLARATION_TYPE", `Function local ${s.names[0]} does not match its declared type.`, s);
          if (s.names[0] !== "_") local.set(s.names[0], newSeries(s.typeName === "float" ? { ...v, integer: false } : v));
        }
        const last = fn.body[fn.body.length - 1];
        if (!last) error("FUNCTION_RETURN", "Function has no return expression.", fn);
        if (last.kind === "expression") return expression(last.expression, local, conditional, guard);
        if (last.kind === "declare" && last.names.length === 1 && last.mode === "normal") {
          if (localNames.has(last.names[0])) error("DUPLICATE_DECLARATION", `${last.names[0]} is already declared in this function.`, last);
          const v = expression(last.value, local, conditional, guard);
          if (last.typeName && (last.typeName === "int" ? !v.integer : last.typeName === "float" ? v.type !== "number" : last.typeName !== v.type)) error("DECLARATION_TYPE", "Function return declaration does not match its type.", last);
          return last.typeName === "float" ? { ...v, integer: false } : v;
        }
        error("FUNCTION_RETURN", "Function return control flow is not implemented; no body is dropped.", last);
      } finally { callStack.pop(); }
    }
    if (["na", "nz", "bool", "float", "int"].includes(name)) {
      validateArgs(call, name === "nz" ? ["source", "replacement"] : ["x"], 1);
      const first = getArgument(call, 0, name === "nz" ? "source" : "x")!;
      const source = expression(first, scope, conditional, guard);
      if (source.node === undefined) error("TYPE_NUMBER", `${name} expects a numeric or boolean value.`, call);
      if (source.type === "bool" && ast.version >= 6 && ["na", "nz"].includes(name)) error("V6_BOOL_NA", "Pine v6 na/nz do not accept boolean values.", call);
      if (name === "na") return { ...binding(add("is_na", source.node!, 0, 0, null, 0, "bool", call)), qualifier: qualifier(source, { type: "bool", qualifier: "simple" }) };
      if (name === "bool") {
        if (source.type === "bool") return source;
        // Use sign before comparison so small nonzero values do not round to
        // zero. This also preserves the legacy explicit bool(na) result.
        return { ...binding(binary("ne", add("sign", number(source, call)), number(constant(0)), "bool", call)), qualifier: source.qualifier };
      }
      if (name === "float") return { node: number(source, call), type: "number", integer: false, qualifier: source.qualifier };
      if (name === "int") {
        return { ...binding(truncate(number(source, call), call)), integer: true, qualifier: source.qualifier };
      }
      const replacement = getArgument(call, 1, "replacement");
      const other = replacement ? expression(replacement, scope, conditional, guard) : constant(source.type === "bool" ? false : 0);
      if (other.type !== source.type) error("TYPE_MISMATCH", "nz replacement must have the source's type.", call);
      if (source.type === "bool" && ast.version >= 6) error("V6_BOOL_NA", "Pine v6 na/nz do not accept boolean values.", call);
      return { ...binding(binary("nz", source.node!, other.node!, source.type as ValueType, call)), integer: !!source.integer && !!other.integer, qualifier: qualifier(source, other, { type: "number", qualifier: "simple" }) };
    }
    const unaryMath: Record<string, Op> = { "math.abs": "abs", "math.floor": "floor", "math.ceil": "ceil", "math.round": "round", "math.sqrt": "sqrt", "math.sign": "sign", abs: "abs", floor: "floor", ceil: "ceil", round: "round", sqrt: "sqrt", sign: "sign" };
    if (Object.prototype.hasOwnProperty.call(unaryMath, name) && (name.startsWith("math.") || ast.version <= 4)) {
      validateArgs(call, ["number"], 1);
      const operand = expression(getArgument(call, 0, "number")!, scope, conditional, guard);
      return { ...binding(add(unaryMath[name], number(operand, call), 0, 0, null, 0, "number", call)), integer: ["floor", "ceil", "round"].includes(unaryMath[name]) || operand.integer && unaryMath[name] === "abs", qualifier: operand.qualifier };
    }
    if (["math.min", "math.max"].includes(name) || (ast.version <= 4 && ["min", "max"].includes(name))) {
      if (call.args.length < 2 || Object.keys(call.kwargs).length) error("ARGUMENT_COUNT", `${name} needs at least two positional numbers.`, call);
      const args = call.args.map(a => expression(a, scope, conditional, guard));
      return { ...binding(args.map(a => number(a, call)).reduce((a, b) => binary(name.endsWith("min") ? "min" : "max", a, b))), integer: args.every(v => v.integer), qualifier: qualifier(...args) };
    }
    if (!name.startsWith("ta.") && name !== "math.sum") error(name.startsWith("request.") ? "EXTERNAL_DATA" : "UNSUPPORTED_CALL", `${name} is not implemented by the native backend. No result or trading rule is substituted.`, call);
    if (conditional) error("CONDITIONAL_STATE", `${name} has per-call series state. Move the call into a global variable so it executes on every confirmed bar.`, call);
    const fn = name === "math.sum" ? "sum" : name.slice(3);
    if (name === "ta.sum") error("UNKNOWN_NAMESPACE", "Pine uses math.sum in v5/v6, or sum in v4.", call);
    if (["sma", "ema", "rma", "wma", "highest", "lowest", "stdev", "variance", "sum"].includes(fn)) {
      if ((fn === "highest" || fn === "lowest") && call.args.length === 1 && !Object.keys(call.kwargs).length) return binding(ta(fn, number(field(fn === "highest" ? "high" : "low")), period(call.args[0], scope, call), call));
      validateArgs(call, ["source", "length", ...(["stdev", "variance"].includes(fn) ? ["biased"] : [])], 2);
      const src = number(expression(getArgument(call, 0, "source")!, scope), call);
      const len = period(getArgument(call, 1, "length"), scope, call);
      if (call.kwargs.biased || call.args[2]) {
        const biased = expression(getArgument(call, 2, "biased")!, scope);
        if (constValue(boolean(biased, call)) !== 1) error("UNBIASED_VARIANCE", "Unbiased variance is not yet implemented; biased=false cannot be ignored.", call);
      }
      return binding(ta(fn as Op, src, len, call));
    }
    if (["crossover", "crossunder", "cross"].includes(fn)) {
      validateArgs(call, ["source1", "source2"], 2);
      const a = number(expression(getArgument(call, 0, "source1")!, scope), call), b = number(expression(getArgument(call, 1, "source2")!, scope), call);
      const priorA = history(a, 1, call), priorB = history(b, 1, call);
      const cross = (up: boolean) => binary("and", binary(up ? "gt" : "lt", a, b, "bool"), binary(up ? "le" : "ge", priorA, priorB, "bool"), "bool", call);
      return binding(fn === "cross" ? binary("or", cross(true), cross(false), "bool", call) : cross(fn === "crossover"));
    }
    if (["change", "roc", "mom"].includes(fn)) {
      validateArgs(call, ["source", "length"], fn === "change" ? 1 : 2);
      const sourceValue = expression(getArgument(call, 0, "source")!, scope);
      if (sourceValue.node === undefined) error("TYPE_NUMBER", "String change is unsupported.", call);
      const len = period(getArgument(call, 1, "length"), scope, call, 1), previous = history(sourceValue.node!, len, call);
      if (fn === "change" && sourceValue.type === "bool") return binding(binary("ne", sourceValue.node!, previous, "bool", call));
      const src = number(sourceValue, call), delta = binary("sub", src, previous);
      return { ...binding(fn === "roc" ? binary("mul", binary("div", delta, previous), number(constant(100))) : delta), integer: ast.version >= 5 && fn === "change" && !!sourceValue.integer, qualifier: "series" };
    }
    if (fn === "rsi") {
      validateArgs(call, ["source", "length"], 2);
      const src = number(expression(getArgument(call, 0, "source")!, scope), call);
      const lengthArg = getArgument(call, 1, "length")!;
      const lengthValue = expression(lengthArg, scope);
      // In v4 a float or series-int second argument selected a different,
      // ratio-based RSI overload. It must never become a Wilder period.
      if (ast.version <= 4 && (!lengthValue.integer || !lengthValue.qualifier || lengthValue.qualifier === "series")) error("RSI_OVERLOAD", "Pine v4 rsi() with a float or series-int second argument uses the legacy ratio overload, which this target does not implement.", lengthArg);
      const len = fixedBinding(lengthValue, lengthArg, true);
      if (!Number.isInteger(len) || len < 1 || len > maxHistory) error("PERIOD_LIMIT", `Periods must be integers between 1 and ${maxHistory}.`, lengthArg);
      const delta = binary("sub", src, history(src, 1, call));
      const zero = number(constant(0)), hundred = number(constant(100));
      const up = ta("rma", binary("max", delta, zero), len, call), down = ta("rma", binary("max", add("neg", delta), zero), len, call);
      const ratio = binary("sub", hundred, binary("div", hundred, binary("add", number(constant(1)), binary("div", up, down))));
      // Pine's documented Wilder formula: 0/0 remains na; rising-only RSI is 100.
      const whenZeroDown = add("select", binary("gt", up, zero, "bool"), hundred, number(constant(null)));
      return binding(add("select", binary("eq", down, zero, "bool"), whenZeroDown, ratio, null, 0, "number", call));
    }
    if (fn === "tr" || fn === "atr") {
      validateArgs(call, fn === "tr" ? ["handle_na"] : ["length"], 1);
      const high = number(field("high")), low = number(field("low")), prev = history(number(field("close")), 1, call);
      let tr = binary("max", binary("sub", high, low), binary("max", add("abs", binary("sub", high, prev)), add("abs", binary("sub", low, prev))));
      const handleValue = fn === "atr" ? 1 : constValue(boolean(expression(getArgument(call, 0, "handle_na")!, scope), call));
      if (handleValue !== 0 && handleValue !== 1) error("CONSTANT_REQUIRED", "ta.tr(handle_na) requires a compile-time boolean in this backend.", call);
      const handleNA = handleValue === 1;
      if (handleNA) tr = binary("nz", tr, binary("sub", high, low));
      return binding(fn === "atr" ? ta("rma", tr, period(getArgument(call, 0, "length"), scope, call), call) : tr);
    }
    if (fn === "stoch") {
      validateArgs(call, ["source", "peak", "valley", "period"], 4);
      const src = number(expression(getArgument(call, 0, "source")!, scope), call), hi = number(expression(getArgument(call, 1, "peak")!, scope), call), lo = number(expression(getArgument(call, 2, "valley")!, scope), call);
      const len = period(getArgument(call, 3, "period"), scope, call);
      const h = ta("highest", hi, len, call), l = ta("lowest", lo, len, call);
      return binding(binary("mul", number(constant(100)), binary("div", binary("sub", src, l), binary("sub", h, l))));
    }
    if (["macd", "bb"].includes(fn)) error("TUPLE_REQUIRED", `${name} returns a tuple; declare its outputs using [a, b, c] = ... .`, call);
    error("UNSUPPORTED_TA", `${name} is not implemented. Add and validate its actual algorithm instead of mapping it to another indicator.`, call);
  }
  function tupleValues(value: PineExpr, scope: Env, conditional: boolean, guard: ExecutionGuard = 0): Binding[] {
    if (value.kind === "tuple") return value.items.map(v => expression(v, scope, conditional, guard));
    if (value.kind !== "call") error("TUPLE_REQUIRED", "Tuple declaration requires a tuple expression or tuple-returning function.", value);
    const name = value.name.startsWith("ta.") ? value.name.slice(3) : ast.version <= 4 ? value.name : "";
    if (conditional) error("CONDITIONAL_STATE", "Tuple TA calls must execute on every bar; declare the tuple globally.", value);
    if (name === "macd") {
      validateArgs(value, ["source", "fastlen", "slowlen", "siglen"], 4);
      const src = number(expression(getArgument(value, 0, "source")!, scope), value);
      const fast = ta("ema", src, period(getArgument(value, 1, "fastlen"), scope, value), value), slow = ta("ema", src, period(getArgument(value, 2, "slowlen"), scope, value), value);
      const line = binary("sub", fast, slow), signal = ta("ema", line, period(getArgument(value, 3, "siglen"), scope, value), value);
      return [binding(line), binding(signal), binding(binary("sub", line, signal))];
    }
    if (name === "bb") {
      validateArgs(value, ["series", "length", "mult"], 3);
      const src = number(expression(getArgument(value, 0, "series")!, scope), value), len = period(getArgument(value, 1, "length"), scope, value);
      const mean = ta("sma", src, len, value), width = binary("mul", ta("stdev", src, len, value), number(expression(getArgument(value, 2, "mult")!, scope), value));
      return [binding(mean), binding(binary("add", mean, width)), binding(binary("sub", mean, width))];
    }
    error("UNSUPPORTED_TUPLE", `Tuple-returning ${value.name} is not implemented.`, value);
  }
  function reserveInputMetadata(value: string, location: Location): void {
    inputMetadataBytes += Buffer.byteLength(value, "utf8");
    if (inputMetadataBytes > MAX_INPUT_METADATA_BYTES) error("INPUT_METADATA_LIMIT", "Resolved input names, string values, and presentation text exceed the combined 65536-byte UTF-8 metadata limit.", location);
  }
  function inputValue(call: Extract<PineExpr, { kind: "call" }>, name: string, scope: Env): Binding {
    if (++inputCount > MAX_INPUTS) error("INPUT_LIMIT", "The native target supports at most 128 input declarations.", call);
    reserveInputMetadata(name, call);
    const allowed = ["defval", "title", "minval", "maxval", "step", "options", "tooltip", "inline", "group", "confirm", "display", "active", "type"];
    for (const key of Object.keys(call.kwargs)) if (!allowed.includes(key)) error("INPUT_ARGUMENT", `Unknown input option ${key}.`, call);
    if (call.args.length > 2) error("INPUT_POSITIONAL", "Use named minval/maxval/step arguments for inputs.", call);
    const def = getArgument(call, 0, "defval");
    if (!def) error("INPUT_DEFAULT", "Every input needs an explicit default.", call);
    let type = call.name === "input" ? "auto" : call.name.slice(6);
    if (call.kwargs.type) {
      if (ast.version > 4 || call.name !== "input" || call.kwargs.type.kind !== "identifier" || !call.kwargs.type.name.startsWith("input.")) error("INPUT_TYPE", "Legacy input type must be an input.* constant in Pine v4.", call);
      type = call.kwargs.type.name.slice(6);
      if (type === "integer") type = "int";
    }
    if (!["auto", "int", "float", "bool", "string", "source"].includes(type)) error("INPUT_TYPE", `input.${type} requires an external context adapter.`, call);
    // Validate the original source even when the caller overrides its value.
    for (const key of ["title", "tooltip", "inline", "group"]) if (call.kwargs[key]) reserveInputMetadata(text(expression(call.kwargs[key], scope), call.kwargs[key]), call.kwargs[key]);
    for (const key of ["confirm", "active"]) if (call.kwargs[key]) {
      const v = expression(call.kwargs[key], scope);
      if (v.type !== "bool" || ![0, 1].includes(constValue(v.node!) as number)) error("INPUT_METADATA", `${key} must be a constant/input boolean.`, call);
    }
    if (call.args[1]) reserveInputMetadata(text(expression(call.args[1], scope), call.args[1]), call.args[1]);
    if (call.kwargs.display) sidecar(call.kwargs.display, scope);
    if (call.kwargs.options) error("INPUT_OPTIONS", "Input option lists need an implemented option validator; they cannot be ignored.", call);
    for (const key of ["minval", "maxval", "step"]) if (call.kwargs[key]) fixed(call.kwargs[key], scope);
    if (call.kwargs.step && fixed(call.kwargs.step, scope) <= 0) error("INPUT_RANGE", "Input step must be positive.", call);
    const override = Object.prototype.hasOwnProperty.call(options.inputs ?? {}, name) ? options.inputs![name] : undefined;
    if (type === "source") {
      if (def.kind !== "identifier" || ![...dataFields, "hl2", "hlc3", "ohlc4", "hlcc4"].includes(def.name)) error("INPUT_SOURCE", "input.source default must be an explicit OHLCV source.", call);
      const selected = override === undefined ? def : { kind: "identifier", name: String(override), span: call.span } as PineExpr;
      if (selected.kind !== "identifier" || ![...dataFields, "hl2", "hlc3", "ohlc4", "hlcc4"].includes(selected.name)) error("INPUT_SOURCE", "input.source must select one of this program's OHLCV source fields.", call);
      reserveInputMetadata(selected.name, call);
      inputs[name] = selected.name;
      return { ...expression(selected, scope), input: true, qualifier: "series" };
    }
    const original = expression(def, scope);
    if (original.qualifier !== "const" || original.node !== undefined && (constValue(original.node) === undefined || constValue(original.node) === null)) error("INPUT_DEFAULT", "Input defaults must be non-missing compile-time constants.", call);
    if (type === "auto") type = original.type === "number" ? original.integer ? "int" : "float" : original.type;
    if (type === "bool" && original.type !== "bool" || type === "string" && original.type !== "string" || ["int", "float"].includes(type) && original.type !== "number") error("INPUT_TYPE", "Input default does not match its declared type.", call);
    if (type === "int" && !original.integer) error("INPUT_TYPE", "input.int requires an integer default.", call);
    if (["bool", "string"].includes(type) && ["minval", "maxval", "step"].some(k => call.kwargs[k])) error("INPUT_ARGUMENT", "Numeric input constraints cannot be attached to bool/string inputs.", call);
    let resolved = override === undefined ? original : typeof override === "string" ? { type: "string" as const, text: override } : constant(override, call);
    if (type === "string") {
      const value = text(resolved, call);
      reserveInputMetadata(value, call);
      inputs[name] = value;
      return { ...resolved, input: true, qualifier: "input" };
    }
    if (type === "bool") {
      if (resolved.type !== "bool") error("INPUT_TYPE", `${name} must be a boolean.`, call);
      const v = constValue(resolved.node!);
      if (v !== 0 && v !== 1) error("INPUT_DEFAULT", "Boolean inputs require a constant true/false value.", call);
      inputs[name] = v === 1;
      return { ...resolved, input: true, qualifier: "input" };
    }
    const value = constValue(number(resolved, call));
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "int" && !Number.isInteger(value))) error("INPUT_TYPE", `${name} requires a finite ${type}.`, call);
    const min = call.kwargs.minval ? fixed(call.kwargs.minval, scope) : -Infinity, max = call.kwargs.maxval ? fixed(call.kwargs.maxval, scope) : Infinity;
    if (value! < min || value! > max) error("INPUT_RANGE", `${name} must be between ${min} and ${max}.`, call);
    if (call.kwargs.options) error("INPUT_OPTIONS", "Input option lists are not yet implemented; they cannot be ignored.", call);
    inputs[name] = value as number;
    return checkedInteger({ ...resolved, input: true, qualifier: "input", integer: type === "int" }, call);
  }
  /** Display-only expressions are still checked: external data or effects cannot hide inside them. */
  function sidecar(expr: PineExpr, scope: Env, conditional = false, guard: ExecutionGuard = 0): void {
    if (expr.kind === "literal" && "colorLiteral" in expr && expr.colorLiteral) return;
    if (expr.kind === "identifier" && /^(?:color|shape|size|location|display|format|scale|plot|hline)\.[A-Za-z_]\w*$/.test(expr.name)) return;
    if (expr.kind === "call" && ["color.new", "color.rgb", "color.from_gradient"].includes(expr.name)) {
      for (const arg of [...expr.args, ...Object.values(expr.kwargs)]) sidecar(arg, scope, conditional, guard);
      return;
    }
    if (expr.kind === "conditional") {
      const condition = boolean(expression(expr.condition, scope, conditional, guard), expr.condition);
      sidecar(expr.whenTrue, scope, true, withinGuard(guard, condition, false, expr));
      sidecar(expr.whenFalse, scope, true, withinGuard(guard, condition, true, expr)); return;
    }
    expression(expr, scope, conditional, guard);
  }
  function header(call: Extract<PineExpr, { kind: "call" }>, scope: Env) {
    headerCount++;
    if (headerCount !== 1 || firstExecutable) error("SCRIPT_DECLARATION", "Exactly one strategy()/indicator()/study() declaration must precede executable code.", call);
    scriptKind = call.name;
    if (call.args.length > 1) error("HEADER_POSITIONAL", "Use named arguments after the script title.", call);
    const name = getArgument(call, 0, "title");
    if (!name) error("SCRIPT_TITLE", "Script declaration requires a title.", call);
    title = text(expression(name, scope), call);
    for (const [key, value] of Object.entries(call.kwargs)) {
      if (constantHeaders.has(key)) {
        if (key !== "title") sidecar(value, scope);
        continue;
      }
      if (key === "default_qty_type") {
        if (value.kind !== "identifier" || value.name !== "strategy.fixed") error("POSITION_SIZING", "Equity/cash sizing needs a real portfolio/venue adapter. Native intents use fixed asset units.", value);
      } else if (key === "default_qty_value") {
        defaultQuantity = fixed(value, scope);
        if (defaultQuantity <= 0) error("QUANTITY", "Default quantity must be positive.", value);
      } else if (["calc_on_every_tick", "calc_on_order_fills", "process_orders_on_close", "use_bar_magnifier"].includes(key)) {
        const v = expression(value, scope);
        if (v.type !== "bool" || constValue(v.node!) !== 0) error("EXECUTION_MODEL", `${key}=true changes order/tick semantics and is outside confirmed-bar signal execution.`, value);
      } else if (key === "pyramiding") {
        if (fixed(value, scope) !== 0) error("BROKER_CONFIGURATION", "Pyramiding is a broker-emulator rule; this target emits intents and does not emulate fills.", value);
      } else error("BROKER_CONFIGURATION", `Declaration option ${key} is not reproduced by this signal target. It must be implemented by a venue adapter.`, value);
    }
  }
  function order(call: Extract<PineExpr, { kind: "call" }>, scope: Env, guard: number) {
    if (scriptKind !== "strategy") error("STRATEGY_CONTEXT", "strategy order commands require a strategy() script.", call);
    if (orders.length >= 16) error("ORDER_LIMIT", "At most 16 order instructions can be produced per bar.", call);
    const kind = call.name.slice(9);
    if (!["entry", "close", "close_all"].includes(kind)) error("ORDER_SEMANTICS", `${call.name} needs stop/limit/fill or broker-state semantics; no market order is substituted.`, call);
    const names = kind === "entry" ? ["id", "direction", "qty"] : kind === "close" ? ["id"] : [];
    validateArgs(call, names, kind === "entry" ? 2 : kind === "close" ? 1 : 0, ["when", "comment", "alert_message", "disable_alert"]);
    if (ast.version >= 6 && call.kwargs.when) error("V6_WHEN", "The when parameter was removed in Pine v6. Put this command inside an if statement.", call);
    for (const key of ["comment", "alert_message", "disable_alert"]) if (call.kwargs[key]) sidecar(call.kwargs[key], scope, true, guard);
    let condition = guard;
    if (call.kwargs.when) condition = binary("and", condition, boolean(expression(call.kwargs.when, scope, true, guard), call), "bool", call);
    let id = "", side: -1 | 0 | 1 = 0, quantity: number | null = null;
    if (kind !== "close_all") {
      id = text(expression(getArgument(call, 0, "id")!, scope, false, guard), call);
      if (Buffer.byteLength(id, "utf8") > 64) error("ORDER_ID_LIMIT", "Order identifiers are limited to 64 UTF-8 bytes.", call);
    }
    if (kind === "entry") {
      const direction = getArgument(call, 1, "direction")!;
      if (direction.kind !== "identifier" || !["strategy.long", "strategy.short"].includes(direction.name)) error("DIRECTION", "Order direction must be strategy.long or strategy.short.", direction);
      side = direction.name === "strategy.long" ? 1 : -1;
      const qty = getArgument(call, 2, "qty");
      quantity = qty ? number(expression(qty, scope, true, guard), qty) : number(constant(defaultQuantity));
      const value = constValue(quantity);
      const enabled = constValue(guard);
      if (enabled !== 0 && enabled !== null && value !== undefined && (value === null || !Number.isFinite(value) || value <= 0)) error("QUANTITY", "Explicit order quantity must be positive and finite; na defaults require broker semantics.", call);
    }
    orders.push({ kind: kind as Order["kind"], id, side, condition, quantity });
  }
  function block(statements: PineStmt[], scope: Env, guard: number, depth = 0, initialDeclarations: string[] = []): Set<string> {
    const assigned = new Set<string>();
    const declared = new Set(initialDeclarations);
    for (const stmt of statements) {
      try {
        if (stmt.kind === "function") {
          if (depth) error("FUNCTION_SCOPE", "Functions must be declared globally.", stmt);
          if (functions.has(stmt.name)) error("FUNCTION_OVERLOAD", "Function overloads are not implemented.", stmt);
          functions.set(stmt.name, stmt);
          functionGlobals.set(stmt.name, new Set(scope.keys()));
          continue;
        }
        if (stmt.kind === "expression" && stmt.expression.kind === "call" && ["strategy", "indicator", "study"].includes(stmt.expression.name)) {
          if (depth) error("SCRIPT_SCOPE", "Script declarations must be global.", stmt);
          header(stmt.expression, scope); continue;
        }
        firstExecutable = true;
        if (stmt.kind === "declare") {
          if (stmt.mode === "varip") error("INTRABAR_STATE", "varip preserves intrabar changes; this target accepts confirmed bars only. Use a tick-aware adapter.", stmt);
          if (stmt.mode === "var" && (depth || stmt.names.length !== 1)) error("LOCAL_VAR", "Persistent declarations currently require global scope and one variable.", stmt);
          const isInput = stmt.value.kind === "call" && (stmt.value.name === "input" || stmt.value.name.startsWith("input."));
          if (isInput && (depth || stmt.names.length !== 1)) error("INPUT_SCOPE", "Inputs require a single global declaration.", stmt);
          const valueGuard: ExecutionGuard = stmt.mode === "var" ? initializationGuard : guard;
          let values = stmt.names.length > 1 ? tupleValues(stmt.value, scope, depth > 0, valueGuard) : [isInput ? inputValue(stmt.value as Extract<PineExpr, { kind: "call" }>, stmt.names[0], scope) : expression(stmt.value, scope, depth > 0 || stmt.mode === "var", valueGuard)];
          if (values.length !== stmt.names.length) error("TUPLE_ARITY", "Tuple target count does not match the function's output count.", stmt);
          stmt.names.forEach((name, i) => {
            if (name === "_") return;
            if (declared.has(name) || (depth === 0 && scope.has(name))) error("DUPLICATE_DECLARATION", `${name} is already declared; use := to reassign it.`, stmt);
            let v = values[i];
            if (stmt.typeName) {
              if (!["float", "int", "bool", "string"].includes(stmt.typeName)) error("UNSUPPORTED_TYPE", `Type ${stmt.typeName} requires an object/collection implementation.`, stmt);
              const wanted = ["float", "int"].includes(stmt.typeName) ? "number" : stmt.typeName;
              if (v.type !== wanted) error("DECLARATION_TYPE", `Declared ${stmt.typeName} does not match the expression type.`, stmt);
              if (stmt.typeName === "int" && v.node !== undefined) {
                const known = constValue(v.node);
                if (known !== null && !v.integer) error("DECLARATION_TYPE", "An int requires an integer expression or an explicit int() conversion.", stmt);
              }
              if (stmt.typeName === "float") v = { ...v, integer: false };
              if (stmt.typeName === "int") v = { ...v, integer: true };
            }
            if (stmt.mode === "var") {
              if (v.node === undefined) error("PERSISTENT_STRING", "Persistent strings are not implemented by the native target.", stmt);
              const read = add("persistent", 0, v.node!, 0, null, 0, v.type as ValueType, stmt);
              persistent.set(name, read); v = { ...binding(read), integer: v.integer, qualifier: "series" };
            }
            v = newSeries(checkedInteger(v, stmt, guard));
            scope.set(name, v); declared.add(name);
          });
        } else if (stmt.kind === "assign") {
          const old = scope.get(stmt.name);
          if (!old) error("UNDECLARED_ASSIGNMENT", `Cannot reassign undeclared ${stmt.name}.`, stmt);
          if (old!.series !== undefined && loopCounters.has(old!.series)) error("LOOP_COUNTER", "Changing a for-loop counter is not supported by native unrolling; use a separate local variable for intermediate calculations.", stmt);
          if (old!.input) error("INPUT_REASSIGNMENT", "Input variables cannot be reassigned in this target.", stmt);
          let next = expression(stmt.value, scope, depth > 0, guard);
          if (stmt.operator !== ":=") {
            const op: Record<string, Op> = { "+=": "add", "-=": "sub", "*=": "mul", "/=": "div", "%=": "mod" };
            next = { ...binding(binary(op[stmt.operator], number(old!, stmt), number(next, stmt), "number", stmt)), integer: stmt.operator !== "/=" && !!old!.integer && !!next.integer, qualifier: "series" };
          }
          if (old!.type !== next.type) error("ASSIGNMENT_TYPE", `Reassignment changes ${stmt.name}'s type.`, stmt);
          if (old!.integer && !next.integer && next.node !== undefined && constValue(next.node) !== null) error("ASSIGNMENT_TYPE", `Integer ${stmt.name} needs an explicit int() conversion before assigning a fractional expression.`, stmt);
          next = checkedInteger({ ...next, series: old!.series, integer: old!.integer, qualifier: "series" }, stmt, guard);
          if (next.series !== undefined && next.node !== undefined) finalSeries.set(next.series, next.node);
          scope.set(stmt.name, next); assigned.add(stmt.name);
        } else if (stmt.kind === "if") {
          const cond = branchTruth(boolean(expression(stmt.condition, scope, depth > 0, guard), stmt.condition), stmt.condition);
          const yes = new Map(scope), no = new Map(scope);
          const yesWrites = block(stmt.then, yes, binary("and", guard, cond, "bool"), depth + 1);
          const noWrites = block(stmt.otherwise, no, binary("and", guard, add("not", cond, 0, 0, null, 0, "bool"), "bool"), depth + 1);
          for (const name of new Set([...yesWrites, ...noWrites])) {
            const a = yes.get(name)!, b = no.get(name)!;
            if (a.type !== b.type || a.node === undefined || b.node === undefined) error("BRANCH_TYPE", "Branch assignments require matching numeric/boolean types.", stmt);
            const merged = checkedInteger({ ...binding(add("select", cond, a.node!, b.node!, null, 0, a.type as ValueType, stmt)), series: scope.get(name)!.series, integer: !!a.integer && !!b.integer, qualifier: "series" }, stmt, guard);
            scope.set(name, merged);
            if (merged.series !== undefined) finalSeries.set(merged.series, merged.node!);
            assigned.add(name);
          }
        } else if (stmt.kind === "for") {
          if (ast.version >= 6) {
            const dependencies = new Set<string>(), writes = new Set<string>(), visitedFunctions = new Set<string>();
            function inspect(value: unknown, findWrites: boolean): void {
              if (!value || typeof value !== "object") return;
              if (Array.isArray(value)) { value.forEach(v => inspect(v, findWrites)); return; }
              const node = value as Record<string, unknown>;
              if (findWrites && node.kind === "assign") writes.add(String(node.name));
              if (!findWrites && node.kind === "identifier") dependencies.add(String(node.name));
              if (!findWrites && node.kind === "call" && functions.has(String(node.name)) && !visitedFunctions.has(String(node.name))) {
                visitedFunctions.add(String(node.name)); inspect(functions.get(String(node.name))!.body, false);
              }
              for (const [key, child] of Object.entries(node)) if (key !== "span") inspect(child, findWrites);
            }
            inspect(stmt.to, false); inspect(stmt.body, true);
            if ([...writes].some(name => dependencies.has(name))) error("DYNAMIC_LOOP_BOUND", "Pine v6 re-evaluates a for-loop end bound each iteration. This loop modifies a bound dependency; native unrolling requires an invariant bound.", stmt);
          }
          const from = fixed(stmt.from, scope, undefined, true), to = fixed(stmt.to, scope, undefined, true), step = fixed(stmt.step, scope, 1, true);
          if (![from, to, step].every(Number.isSafeInteger) || step <= 0) error("LOOP_LIMIT", "for loops need exactly representable integer bounds, a positive step, and at most 32 iterations.", stmt);
          // Count using exact integers, then iterate over that bounded count.
          // Advancing an f64 counter can stop making progress at its precision
          // limit or lose an endpoint when subtracting distant signed bounds.
          const start = BigInt(from), end = BigInt(to), magnitude = BigInt(step);
          const distance = start <= end ? end - start : start - end;
          const count = distance / magnitude + 1n;
          if (count > 32n) error("LOOP_LIMIT", "for loops need constant integer bounds, a positive step, and at most 32 iterations.", stmt);
          const delta = start <= end ? magnitude : -magnitude;
          for (let iteration = 0n; iteration < count; iteration++) {
            const i = Number(start + iteration * delta);
            const counter = newSeries(constant(i));
            loopCounters.add(counter.series!);
            const loopScope = new Map(scope); loopScope.set(stmt.variable, counter);
            const writes = block(stmt.body, loopScope, guard, depth + 1, [stmt.variable]);
            for (const name of writes) if (name !== stmt.variable && scope.has(name)) { scope.set(name, loopScope.get(name)!); assigned.add(name); }
          }
        } else if (stmt.kind === "while") {
          error("UNBOUNDED_LOOP", "while loops need a statically proven iteration bound before native compilation.", stmt);
        } else if (stmt.kind === "expression") {
          const e = stmt.expression;
          if (e.kind !== "call") error("UNUSED_EXPRESSION", "Standalone expressions are only valid as a function's return value.", stmt);
          if (e.name.startsWith("strategy.")) order(e, scope, guard);
          else if (visualNames.has(e.name)) {
            // Compile the data expression for plots; display metadata does not execute on chain.
            if (e.name === "plot") {
              const plotted = e.kwargs.series ?? e.args[0];
              if (plotted) { const v = expression(plotted, scope, depth > 0, guard); if (v.node !== undefined) outputs[`plot_${Object.keys(outputs).length}`] = v.node; }
            }
            const compiledPlotArg = e.name === "plot" ? e.kwargs.series ?? e.args[0] : undefined;
            for (const arg of [...e.args, ...Object.values(e.kwargs)]) if (arg !== compiledPlotArg) sidecar(arg, scope, depth > 0, guard);
            info("VISUAL_ONLY", `${e.name} remains a chart concern and emits no on-chain drawing instructions.`, e);
          } else if (["alert", "alertcondition"].includes(e.name)) {
            if (e.name === "alertcondition") {
              const c = e.kwargs.condition ?? e.args[0];
              if (!c) error("ALERT_CONDITION", "alertcondition needs a condition.", e);
              boolean(expression(c!, scope, depth > 0, guard), e);
            }
            for (const arg of [...e.args, ...Object.values(e.kwargs)]) sidecar(arg, scope, depth > 0, guard);
            info("ALERT_NOT_ORDER", "Alerts are not trading instructions. Provide explicit long/short/close mappings for an indicator.", e);
          } else expression(e, scope, depth > 0, guard);
        }
      } catch (e) {
        if (e instanceof Rejected) diagnostics.push(e.diagnostic); else throw e;
      }
    }
    for (const name of declared) assigned.delete(name);
    return assigned;
  }

  try {
    if (![4, 5, 6].includes(ast.version)) error("PINE_VERSION", "Native compilation currently parses Pine versions 4, 5, and 6. Add an explicit //@version directive.");
    if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 1024) error("CONFIG_HISTORY", "maxHistory must be an integer from 1 through 1024.");
    if (!Number.isInteger(maxStateBytes) || maxStateBytes < 8 || maxStateBytes > 7200) error("CONFIG_STATE", "maxStateBytes must be an integer from 8 through 7200.");
    if (diagnostics.some(d => d.severity === "error")) return failResult(diagnostics);
    block(ast.statements, env, boolean(constant(true)));
    if (headerCount !== 1) error("SCRIPT_DECLARATION", "Exactly one strategy, indicator, or study declaration is required.");
    for (const [name, read] of persistent) {
      const final = env.get(name);
      if (!final || final.node === undefined) error("PERSISTENT_STATE", `No final value exists for persistent ${name}.`);
      nodes[read].a = final!.node!;
    }
    for (const [name, value] of env) if (value.node !== undefined) outputs[name] = value.node;
    for (const name of Object.keys(options.inputs ?? {})) if (!Object.prototype.hasOwnProperty.call(inputs, name)) error("UNKNOWN_INPUT", `Input override ${name} does not name a declared Pine input.`);
    if (options.signals) {
      if (scriptKind === "strategy") error("SIGNAL_MAPPING", "Explicit signal mappings apply only to indicators; strategy commands already define intent.");
      const quantity = options.signals.quantity ?? 1;
      if (!Number.isFinite(quantity) || quantity <= 0) error("QUANTITY", "Mapped signal quantity must be positive and finite.");
      for (const [key, side] of [["long", 1], ["short", -1], ["close", 0]] as const) {
        const expressionSource = options.signals[key]; if (!expressionSource) continue;
        const parsed = parseStrictPine(`//@version=${ast.version}\n__mapped = ${expressionSource}\n`);
        if (parsed.diagnostics.some(d => d.severity === "error") || parsed.statements.length !== 1 || parsed.statements[0].kind !== "declare") error("SIGNAL_EXPRESSION", "Signal mappings must be one valid boolean expression.");
        const condition = boolean(expression((parsed.statements[0] as Extract<PineStmt, { kind: "declare" }>).value, env));
        orders.push({ kind: side ? "entry" : "close_all", id: side ? `mapped_${key}` : "", side, condition, quantity: side ? number(constant(quantity)) : null });
      }
    }
    for (const fixup of historyFixups) {
      const final = finalSeries.get(fixup.series);
      if (final === undefined) error("HISTORY_SERIES", "A historical series has no final value.");
      nodes[fixup.node].a = final;
    }
    if (!orders.length) error("NO_TRADING_INTENT", "This script has no executable order instructions. For an indicator, specify explicit long/short/close boolean signal mappings. Plots and recognized indicator names never invent trades.");
    if (diagnostics.some(d => d.severity === "error")) return failResult(diagnostics);
    const depths = nodes.map(() => 0);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.op === "history") depths[n.a] = Math.max(depths[n.a], n.period);
      if (n.op === "persistent") depths[n.a] = Math.max(depths[n.a], 1);
      if (["ema", "rma"].includes(n.op)) depths[i] = Math.max(depths[i], 1);
      if (["highest", "lowest", "sum"].includes(n.op)) depths[n.a] = Math.max(depths[n.a], n.period - 1);
    }
    let cells = 0;
    const layouts: Layout[] = nodes.map((n, i) => {
      const historyOffset = cells, historyLength = depths[i]; cells += historyLength;
      const auxOffset = cells, auxLength = ["sma", "wma", "stdev", "variance"].includes(n.op) ? n.period + 2 : n.op === "rma" ? 2 : 0;
      cells += auxLength;
      return { historyOffset, historyLength, auxOffset, auxLength };
    });
    if (cells * 8 > maxStateBytes) error("STATE_LIMIT", `This graph needs ${cells * 8} bytes of series state; the configured bound is ${maxStateBytes}. Reduce lookbacks or split the program.`);
    const sourceHash = sha(source);
    const program: Omit<ProgramIR, "title" | "configHash"> = { version: IR_VERSION, compilerVersion: SOLANA_COMPILER_VERSION, pineVersion: ast.version, sourceHash, nodes, orders, layouts, inputs, outputs, stateCells: cells, maxHistory };
    const configHash = computeConfigHash(program);
    const ir: ProgramIR = { ...program, title, configHash };
    info("NUMERIC_PROFILE", "The native engine uses bounded f64 arithmetic with explicit missing values. Cross-runtime tests do not establish full TradingView equivalence; validate exported TradingView series before real trading.", undefined, "warning");
    info("SIGNALS_NOT_FILLS", "strategy commands emit ordered intents. Broker-emulator fills, reversals, pyramiding, balances and P&L require a venue adapter.", undefined, "warning");
    info("FEED_TRUST", "The generated program trusts its configured candle-signing authority for OHLCV. It is not a trustless oracle.", undefined, "warning");
    const manifest = {
      schemaVersion: 1, compilerVersion: SOLANA_COMPILER_VERSION, sourceHash, configHash, title,
      target: "solana", executionModel: "confirmed-bar-signal", pineVersion: ast.version,
      nativeCompilation: "experimental", tradingViewEquivalence: "not-certified", deployment: "not-deployed",
      brokerEmulator: false, dexAdapter: null, oracleModel: "authenticated-trusted-candle-publisher",
      numericProfile: NUMERIC_PROFILE, inputOverrides: inputs,
      resources: { graphNodes: nodes.length, stateBytes: cells * 8, orderInstructions: orders.length, maxHistory, computeUnits: "requires-SBF-simulation" },
      sourceRepository: "https://github.com/SeamMoney/cash.trading", compatibility: "Every accepted execution expression is lowered; unsupported constructs are hard errors.",
    };
    const files = generateRustFiles(ir, options.programId);
    files["source.pine"] = source;
    files["program.ir.json"] = JSON.stringify(ir, null, 2) + "\n";
    files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
    return { ok: true, target: "solana", executionModel: "confirmed-bar-signal", diagnostics, ir, files, manifest };
  } catch (e) {
    if (e instanceof Rejected) diagnostics.push(e.diagnostic);
    else diagnostics.push({ severity: "error", code: "COMPILER_INTERNAL", message: e instanceof Error ? e.message : "Unexpected compiler error", line: 1, column: 1 });
    return failResult(diagnostics);
  }
}
