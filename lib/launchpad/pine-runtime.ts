/**
 * PineScript Bar-by-Bar Runtime Interpreter
 *
 * Executes a ParsedPine AST sequentially for each candle bar, maintaining
 * persistent `var` state between bars. Produces a Map<string, number[]>
 * containing the full history of every named variable across all bars.
 *
 * Designed to handle complex PineScript patterns such as BOS Adaptive
 * Structure Average (conditional reassignment, historical lookbacks,
 * TA functions, custom function calls, and tuple destructuring).
 */

import type { ParsedPine, Expr, Stmt } from "./pine-parser";
import type { Candle } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuntimePlot {
  title: string;
  lineWidth: number;
  data: Array<{ time: number; value: number; color: string }>;
}

export interface RuntimeSignal {
  time: number;  // unix seconds
  price: number; // candle close at signal bar
  type: "buy" | "sell";
}

interface BarContext {
  barIndex: number;
  candle: Candle;
  candles: Candle[];
  vars: Map<string, number>;        // persistent var state (survives across bars)
  locals: Map<string, number>;      // per-bar locals (reset each bar)
  history: Map<string, number[]>;   // variable name → value at each past bar
  functions: Map<string, { params: string[]; body: Stmt[] }>;
  taState: Map<string, number>;     // internal TA function state (prev EMA, etc.)
  plots: Map<string, RuntimePlot>;  // plot key → accumulated plot data
  plotOrder: string[];              // insertion order of plot keys
  signals: RuntimeSignal[];         // strategy.entry / strategy.close events
}

/** Return value from a custom function — may be a single number or a tuple */
type ReturnValue = number | number[];

// Maximum iterations for for/while loops to prevent infinite loops
const MAX_ITERATIONS = 256;

// ─── Main Entry ─────────────────────────────────────────────────────────────

/**
 * Execute the PineScript AST against a candle array, returning the full
 * history of every variable.
 *
 * Usage:
 * ```
 *   const history = executeRuntime(ast, candles);
 *   const avgMain = history.get("avgMain"); // number[] with one value per bar
 * ```
 */
export function executeRuntime(
  ast: ParsedPine,
  candles: Candle[],
): { history: Map<string, number[]>; plots: RuntimePlot[]; signals: RuntimeSignal[] } {
  if (!candles || candles.length === 0) {
    return { history: new Map(), plots: [], signals: [] };
  }

  // Shared state across all bars
  const vars = new Map<string, number>();
  const history = new Map<string, number[]>();
  const functions = new Map<string, { params: string[]; body: Stmt[] }>();
  const taState = new Map<string, number>();
  const plots = new Map<string, RuntimePlot>();
  const plotOrder: string[] = [];
  const signals: RuntimeSignal[] = [];

  // ── Phase 0: Register function definitions ────────────────────────────────
  for (const stmt of ast.statements) {
    if (stmt.k === "funcdef") {
      functions.set(stmt.name, { params: stmt.params, body: stmt.body });
    }
  }

  // ── Phase 0.5: Initialize var declarations with their init expressions ────
  // var declarations are only initialized on bar 0 in PineScript, but we
  // register the names here so executeStmt knows they are persistent.
  if (ast.varDeclarations) {
    for (const [name] of ast.varDeclarations) {
      // Mark the name as a persistent var (will be initialized during bar 0 execution)
      vars.set(name, NaN);
    }
  }

  // ── Phase 0.6: Initialize input params as persistent vars ─────────────────
  if (ast.params) {
    for (const [name, value] of Object.entries(ast.params)) {
      vars.set(name, value);
    }
  }

  // ── Phase 1: Bar-by-bar execution ─────────────────────────────────────────
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const locals = new Map<string, number>();

    // Inject built-in variables as locals
    locals.set("close", candle.close);
    locals.set("open", candle.open);
    locals.set("high", candle.high);
    locals.set("low", candle.low);
    locals.set("volume", candle.volume);
    locals.set("bar_index", i);
    locals.set("hlc3", (candle.high + candle.low + candle.close) / 3);
    locals.set("hl2", (candle.high + candle.low) / 2);
    locals.set("ohlc4", (candle.open + candle.high + candle.low + candle.close) / 4);

    const ctx: BarContext = {
      barIndex: i,
      candle,
      candles,
      vars,
      locals,
      history,
      functions,
      taState,
      plots,
      plotOrder,
      signals,
    };

    // Execute every statement in order
    for (const stmt of ast.statements) {
      executeStmt(stmt, ctx);
    }

    // ── Phase 2: Snapshot all variables into history ─────────────────────────
    snapshotHistory(ctx);
  }

  return { history, plots: plotOrder.map(k => plots.get(k)!), signals };
}

// ─── History Snapshotting ───────────────────────────────────────────────────

function snapshotHistory(ctx: BarContext): void {
  const { barIndex, vars, locals, history } = ctx;

  // Helper: ensure array exists and is padded to current barIndex
  const snap = (name: string, value: number) => {
    let arr = history.get(name);
    if (!arr) {
      arr = [];
      history.set(name, arr);
    }
    // Pad with NaN if we somehow skipped bars (shouldn't happen, but be safe)
    while (arr.length < barIndex) {
      arr.push(NaN);
    }
    arr.push(value);
  };

  // Snapshot vars first (persistent state)
  for (const [name, value] of vars) {
    snap(name, value);
  }
  // Snapshot locals (per-bar values)
  for (const [name, value] of locals) {
    snap(name, value);
  }
}

// ─── Plot Capture ─────────────────────────────────────────────────────────────

let _plotCounter = 0;

function executePlot(stmt: Extract<Stmt, { k: "visual" }>, ctx: BarContext): void {
  if (stmt.fn !== "plot") return; // only handle plot() — plotshape/fill etc. ignored for now

  const value = toNumber(evalExpr(stmt.args[0], ctx));
  if (!Number.isFinite(value)) return; // skip NaN/Infinity bars

  // Determine plot title (keyword arg "title" or fallback)
  const titleExpr = stmt.kw["title"] ?? stmt.args[1];
  const title = titleExpr?.k === "str" ? titleExpr.v : `plot${_plotCounter}`;

  // Determine color (keyword arg "color")
  const colorExpr = stmt.kw["color"];
  const color = colorExpr?.k === "str" ? colorExpr.v : "#ffffff";

  // Determine line width
  const lwExpr = stmt.kw["linewidth"] ?? stmt.args[3];
  const lineWidth = lwExpr ? Math.max(1, Math.min(4, Math.round(toNumber(evalExpr(lwExpr, ctx))))) : 2;

  // Use title as key (stable across bars); fall back to synthetic key
  const key = title;

  if (!ctx.plots.has(key)) {
    _plotCounter++;
    ctx.plots.set(key, { title, lineWidth, data: [] });
    ctx.plotOrder.push(key);
  }

  const candle = ctx.candle;
  ctx.plots.get(key)!.data.push({
    time: candle.timestamp < 1e12 ? candle.timestamp : candle.timestamp / 1000,
    value,
    color,
  });
}

// ─── Statement Execution ────────────────────────────────────────────────────

function executeStmt(stmt: Stmt, ctx: BarContext): void {
  switch (stmt.k) {
    case "assign":
      executeAssign(stmt, ctx);
      break;
    case "if":
      executeIf(stmt, ctx);
      break;
    case "for":
      executeFor(stmt, ctx);
      break;
    case "while":
      executeWhile(stmt, ctx);
      break;
    case "funcdef":
      // Already registered in Phase 0 — skip
      break;
    case "visual":
      executePlot(stmt as Extract<Stmt, { k: "visual" }>, ctx);
      break;
    case "expr":
      executeExprStmt(stmt, ctx);
      break;
  }
}

function executeAssign(
  stmt: Extract<Stmt, { k: "assign" }>,
  ctx: BarContext,
): void {
  const { targets, value, reDecl } = stmt;

  if (targets.length === 1) {
    // Single target assignment
    const name = targets[0];
    const val = evalExpr(value, ctx);

    if (typeof val === "number") {
      setVariable(name, val, reDecl, ctx);
    } else if (Array.isArray(val)) {
      // Custom function returned a tuple — take the first element
      setVariable(name, val[0] ?? NaN, reDecl, ctx);
    }
  } else {
    // Destructuring assignment: [a, b, c] = someFunc(...)
    const result = evalExpr(value, ctx);

    if (Array.isArray(result)) {
      for (let i = 0; i < targets.length; i++) {
        setVariable(targets[i], result[i] ?? NaN, reDecl, ctx);
      }
    } else if (typeof result === "number") {
      // Single value — assign to first target, NaN to rest
      setVariable(targets[0], result, reDecl, ctx);
      for (let i = 1; i < targets.length; i++) {
        setVariable(targets[i], NaN, reDecl, ctx);
      }
    }
  }
}

/** Determine where to store a variable and store it */
function setVariable(
  name: string,
  value: number,
  reDecl: boolean,
  ctx: BarContext,
): void {
  // If this is a var/varip declaration (reDecl: true and first occurrence)
  // or the name is already in vars → persistent
  if (ctx.vars.has(name)) {
    ctx.vars.set(name, value);
  } else if (reDecl) {
    // Initial declaration with = (not :=), becomes a local unless var keyword was used
    // The parser sets reDecl=true for `var` declarations AND for destructuring assignments.
    // If the name was pre-registered in vars (Phase 0.5), it stays there.
    // Otherwise, it's a fresh local.
    ctx.locals.set(name, value);
  } else {
    // := reassignment to something not in vars → local
    ctx.locals.set(name, value);
  }
}

function executeIf(
  stmt: Extract<Stmt, { k: "if" }>,
  ctx: BarContext,
): void {
  const condVal = toNumber(evalExpr(stmt.cond, ctx));
  if (isTruthy(condVal)) {
    for (const s of stmt.then) {
      executeStmt(s, ctx);
    }
  } else if (stmt.els) {
    for (const s of stmt.els) {
      executeStmt(s, ctx);
    }
  }
}

function executeFor(
  stmt: Extract<Stmt, { k: "for" }>,
  ctx: BarContext,
): void {
  const start = toNumber(evalExpr(stmt.start, ctx));
  const end = toNumber(evalExpr(stmt.end, ctx));
  const step = stmt.step ? toNumber(evalExpr(stmt.step, ctx)) : 1;

  if (isNaN(start) || isNaN(end) || isNaN(step) || step === 0) return;

  let iterations = 0;
  const goingUp = step > 0;

  for (
    let i = start;
    goingUp ? i <= end : i >= end;
    i += step
  ) {
    if (++iterations > MAX_ITERATIONS) break;
    ctx.locals.set(stmt.varName, i);
    for (const s of stmt.body) {
      executeStmt(s, ctx);
    }
  }
}

function executeWhile(
  stmt: Extract<Stmt, { k: "while" }>,
  ctx: BarContext,
): void {
  let iterations = 0;
  while (iterations++ < MAX_ITERATIONS) {
    const condVal = toNumber(evalExpr(stmt.cond, ctx));
    if (!isTruthy(condVal)) break;
    for (const s of stmt.body) {
      executeStmt(s, ctx);
    }
  }
}

function executeExprStmt(
  stmt: Extract<Stmt, { k: "expr" }>,
  ctx: BarContext,
): void {
  const expr = stmt.e;
  // Skip strategy.* and indicator() calls — they have no runtime effect
  if (expr.k === "call") {
    if (expr.ns === "strategy") return;
    if (expr.fn === "indicator") return;
    if (expr.fn === "strategy") return;
  }
  evalExpr(expr, ctx);
}

// ─── Expression Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate an expression. Returns a number (or NaN). For custom functions that
 * return tuples, this is handled at the call site by checking the return value
 * of evalExprRaw.
 */
function evalExpr(expr: Expr, ctx: BarContext): number | number[] {
  return evalExprRaw(expr, ctx);
}

function evalExprRaw(expr: Expr, ctx: BarContext): number | number[] {
  switch (expr.k) {
    case "num":
      return expr.v;

    case "bool":
      return expr.v ? 1 : 0;

    case "str":
      // Strings don't have numeric values — but some contexts use them
      // Return NaN to keep the system numeric
      return NaN;

    case "na":
      return NaN;

    case "id":
      return lookupVariable(expr.name, ctx);

    case "hist":
      return lookupHistory(expr.name, expr.offset, ctx);

    case "call":
      return evalCall(expr, ctx);

    case "binop":
      return evalBinop(expr, ctx);

    case "unop":
      return evalUnop(expr, ctx);

    case "ternary":
      return evalTernary(expr, ctx);

    default:
      return NaN;
  }
}

// ─── Variable Lookup ────────────────────────────────────────────────────────

function lookupVariable(name: string, ctx: BarContext): number {
  // Check locals first (per-bar values including built-ins)
  const local = ctx.locals.get(name);
  if (local !== undefined) return local;

  // Check persistent vars
  const v = ctx.vars.get(name);
  if (v !== undefined) return v;

  // Some well-known PineScript constants
  switch (name) {
    case "true":  return 1;
    case "false": return 0;
    case "na":    return NaN;
    // strategy.long / strategy.short are just constants used in strategy.entry
    case "strategy": return NaN;
  }

  return NaN;
}

function lookupHistory(name: string, offset: number, ctx: BarContext): number {
  const targetBar = ctx.barIndex - offset;
  if (targetBar < 0) return NaN;

  const arr = ctx.history.get(name);
  if (!arr || targetBar >= arr.length) return NaN;
  return arr[targetBar];
}

// ─── Call Evaluation ────────────────────────────────────────────────────────

function evalCall(
  expr: Extract<Expr, { k: "call" }>,
  ctx: BarContext,
): number | number[] {
  const { ns, fn, args, kw } = expr;

  // ── TA namespace calls ──────────────────────────────────────────────────
  if (ns === "ta") {
    return evalTACall(fn, args, kw, expr, ctx);
  }

  // ── Math namespace calls ────────────────────────────────────────────────
  if (ns === "math") {
    return evalMathCall(fn, args, ctx);
  }

  // ── Built-in na() check ─────────────────────────────────────────────────
  if (!ns && fn === "na") {
    if (args.length === 0) return NaN; // na literal
    const val = toNumber(evalExpr(args[0], ctx));
    return isNaN(val) ? 1 : 0;
  }

  // ── Built-in nz() — replace NaN ────────────────────────────────────────
  if (!ns && fn === "nz") {
    const val = toNumber(evalExpr(args[0], ctx));
    if (isNaN(val)) {
      return args.length >= 2 ? toNumber(evalExpr(args[1], ctx)) : 0;
    }
    return val;
  }

  // ── fixnan() — replace NaN with last non-NaN ──────────────────────────
  if (!ns && fn === "fixnan") {
    const val = toNumber(evalExpr(args[0], ctx));
    if (!isNaN(val)) return val;
    // Look back through history for a non-NaN value
    const sourceExpr = args[0];
    if (sourceExpr.k === "id") {
      const arr = ctx.history.get(sourceExpr.name);
      if (arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
          if (!isNaN(arr[i])) return arr[i];
        }
      }
    }
    return NaN;
  }

  // ── Built-in array access: array.get ───────────────────────────────────
  if (ns === "array" || ns === "str") {
    // Not fully supported — return NaN
    return NaN;
  }

  // ── strategy namespace — capture entry/close signals ─────────────────
  if (ns === "strategy") {
    const candle = ctx.candle;
    const time = candle.timestamp < 1e12 ? candle.timestamp : candle.timestamp / 1000;
    if (fn === "entry") {
      // Detect direction: second arg is strategy.long or strategy.short
      const dirArg = args[1];
      const isShort = dirArg?.k === "id" && dirArg.name.includes("short");
      ctx.signals.push({ time, price: candle.low, type: isShort ? "sell" : "buy" });
    } else if (fn === "close" || fn === "close_all" || fn === "exit") {
      ctx.signals.push({ time, price: candle.high, type: "sell" });
    }
    return NaN;
  }

  // ── indicator() — skip ─────────────────────────────────────────────────
  if (fn === "indicator" || fn === "strategy") {
    return NaN;
  }

  // ── input functions — return default value ─────────────────────────────
  if (ns === "input" || fn === "input") {
    const defVal = kw["defval"] ?? args[0];
    if (defVal) return toNumber(evalExpr(defVal, ctx));
    return NaN;
  }

  // ── color functions — skip ─────────────────────────────────────────────
  if (ns === "color") {
    return NaN;
  }

  // ── Custom function call ────────────────────────────────────────────────
  const funcDef = ctx.functions.get(fn);
  if (funcDef) {
    return evalCustomFunction(funcDef, args, ctx);
  }

  // ── Unknown call — return NaN ──────────────────────────────────────────
  return NaN;
}

// ─── TA Function Evaluation ─────────────────────────────────────────────────

function evalTACall(
  fn: string,
  args: Expr[],
  kw: Record<string, Expr>,
  fullExpr: Expr,
  ctx: BarContext,
): number | number[] {
  switch (fn) {
    case "sma":
      return evalTA_SMA(args, ctx);
    case "ema":
      return evalTA_EMA(args, fullExpr, ctx);
    case "rma":
      return evalTA_RMA(args, fullExpr, ctx);
    case "wma":
      return evalTA_WMA(args, ctx);
    case "vwma":
      return evalTA_VWMA(args, ctx);
    case "atr":
      return evalTA_ATR(args, fullExpr, ctx);
    case "linreg":
      return evalTA_Linreg(args, ctx);
    case "pivothigh":
      return evalTA_PivotHigh(args, ctx);
    case "pivotlow":
      return evalTA_PivotLow(args, ctx);
    case "highest":
      return evalTA_Highest(args, ctx);
    case "lowest":
      return evalTA_Lowest(args, ctx);
    case "crossover":
      return evalTA_Crossover(args, ctx);
    case "crossunder":
      return evalTA_Crossunder(args, ctx);
    case "rsi":
      return evalTA_RSI(args, fullExpr, ctx);
    case "macd":
      return evalTA_MACD(args, fullExpr, ctx);
    case "bb":
    case "bbands":
      return evalTA_BB(args, ctx);
    case "stoch":
      return evalTA_Stoch(args, ctx);
    case "cci":
      return evalTA_CCI(args, ctx);
    case "supertrend":
      return evalTA_Supertrend(args, fullExpr, ctx);
    case "change":
      return evalTA_Change(args, ctx);
    case "tr":
      return evalTA_TR(ctx);
    case "hma":
      return evalTA_HMA(args, fullExpr, ctx);
    case "swma":
      return evalTA_SWMA(args, ctx);
    case "alma":
      return evalTA_ALMA(args, ctx);
    case "cum":
      return evalTA_Cum(args, fullExpr, ctx);
    case "stdev":
      return evalTA_Stdev(args, ctx);
    case "variance":
      return evalTA_Variance(args, ctx);
    case "barssince":
      return evalTA_BarsSince(args, ctx);
    case "valuewhen":
      return evalTA_ValueWhen(args, ctx);
    case "falling":
      return evalTA_Falling(args, ctx);
    case "rising":
      return evalTA_Rising(args, ctx);
    default:
      return NaN;
  }
}

/** ta.sma(source, period) */
function evalTA_SMA(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;
  return computeSMA(args[0], period, source, ctx);
}

/** Compute SMA from history for a given source expression */
function computeSMA(sourceExpr: Expr, period: number, currentValue: number, ctx: BarContext): number {
  const values = collectSourceValues(sourceExpr, period, currentValue, ctx);
  if (values.length < period) return NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (isNaN(values[i])) return NaN;
    sum += values[i];
  }
  return sum / period;
}

/** ta.ema(source, period) */
function evalTA_EMA(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const k = 2 / (period + 1);
  const key = `_ema_${stableExprKey(fullExpr)}`;
  const prev = ctx.taState.get(key) ?? NaN;
  const result = isNaN(prev) ? source : prev + k * (source - prev);
  ctx.taState.set(key, result);
  return result;
}

/** ta.rma(source, period) — Wilder's running MA */
function evalTA_RMA(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const key = `_rma_${stableExprKey(fullExpr)}`;
  const prev = ctx.taState.get(key) ?? NaN;
  const result = isNaN(prev) ? source : prev * (period - 1) / period + source / period;
  ctx.taState.set(key, result);
  return result;
}

/** ta.wma(source, period) — Weighted Moving Average */
function evalTA_WMA(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;

  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < period; i++) {
    const w = i + 1;
    weightedSum += values[i] * w;
    weightTotal += w;
  }
  return weightedSum / weightTotal;
}

/** ta.vwma(source, period) — Volume Weighted Moving Average */
function evalTA_VWMA(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const startBar = ctx.barIndex - period + 1;
  if (startBar < 0) return NaN;

  let sumSrcVol = 0;
  let sumVol = 0;
  for (let b = startBar; b <= ctx.barIndex; b++) {
    const c = ctx.candles[b];
    const srcVal = b === ctx.barIndex ? source : getSourceValueAtBar(args[0], b, ctx);
    sumSrcVol += srcVal * c.volume;
    sumVol += c.volume;
  }
  return sumVol === 0 ? NaN : sumSrcVol / sumVol;
}

/** ta.atr(period) — Average True Range using RMA */
function evalTA_ATR(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const period = Math.round(toNumber(evalExpr(args[0], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const tr = computeTrueRange(ctx);
  const key = `_atr_rma_${stableExprKey(fullExpr)}`;
  const prev = ctx.taState.get(key) ?? NaN;
  const result = isNaN(prev) ? tr : prev * (period - 1) / period + tr / period;
  ctx.taState.set(key, result);
  return result;
}

/** ta.tr — True Range for current bar */
function evalTA_TR(ctx: BarContext): number {
  return computeTrueRange(ctx);
}

function computeTrueRange(ctx: BarContext): number {
  const { high, low } = ctx.candle;
  if (ctx.barIndex === 0) return high - low;
  const prevClose = ctx.candles[ctx.barIndex - 1].close;
  return Math.max(
    high - low,
    Math.abs(high - prevClose),
    Math.abs(low - prevClose),
  );
}

/** ta.linreg(source, length, offset) — Linear regression value */
function evalTA_Linreg(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = Math.round(toNumber(evalExpr(args[1], ctx)));
  const offset = args.length >= 3 ? Math.round(toNumber(evalExpr(args[2], ctx))) : 0;
  if (isNaN(length) || length < 1) return NaN;

  const values = collectSourceValues(args[0], length, source, ctx);
  if (values.length < length) return NaN;

  // Simple linear regression: y = mx + b
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < length; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const n = length;
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return NaN;
  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return m * (n - 1 - offset) + b;
}

/** ta.pivothigh(source, leftbars, rightbars) */
function evalTA_PivotHigh(args: Expr[], ctx: BarContext): number {
  // Determine arguments — could be (leftbars, rightbars) or (source, leftbars, rightbars)
  let sourceExpr: Expr;
  let leftBars: number;
  let rightBars: number;

  if (args.length >= 3) {
    sourceExpr = args[0];
    leftBars = Math.round(toNumber(evalExpr(args[1], ctx)));
    rightBars = Math.round(toNumber(evalExpr(args[2], ctx)));
  } else {
    sourceExpr = { k: "id", name: "high" };
    leftBars = Math.round(toNumber(evalExpr(args[0], ctx)));
    rightBars = Math.round(toNumber(evalExpr(args[1], ctx)));
  }

  if (isNaN(leftBars) || isNaN(rightBars) || leftBars < 1 || rightBars < 1) return NaN;

  // The pivot is confirmed `rightBars` bars ago
  const pivotBar = ctx.barIndex - rightBars;
  if (pivotBar < leftBars) return NaN;

  const pivotVal = getSourceValueAtBar(sourceExpr, pivotBar, ctx);
  if (isNaN(pivotVal)) return NaN;

  // Check left side: all values within leftBars to the left must be <= pivotVal
  for (let i = 1; i <= leftBars; i++) {
    const val = getSourceValueAtBar(sourceExpr, pivotBar - i, ctx);
    if (isNaN(val) || val > pivotVal) return NaN;
  }

  // Check right side: all values within rightBars to the right must be <= pivotVal
  for (let i = 1; i <= rightBars; i++) {
    const val = getSourceValueAtBar(sourceExpr, pivotBar + i, ctx);
    if (isNaN(val) || val > pivotVal) return NaN;
  }

  return pivotVal;
}

/** ta.pivotlow(source, leftbars, rightbars) */
function evalTA_PivotLow(args: Expr[], ctx: BarContext): number {
  let sourceExpr: Expr;
  let leftBars: number;
  let rightBars: number;

  if (args.length >= 3) {
    sourceExpr = args[0];
    leftBars = Math.round(toNumber(evalExpr(args[1], ctx)));
    rightBars = Math.round(toNumber(evalExpr(args[2], ctx)));
  } else {
    sourceExpr = { k: "id", name: "low" };
    leftBars = Math.round(toNumber(evalExpr(args[0], ctx)));
    rightBars = Math.round(toNumber(evalExpr(args[1], ctx)));
  }

  if (isNaN(leftBars) || isNaN(rightBars) || leftBars < 1 || rightBars < 1) return NaN;

  const pivotBar = ctx.barIndex - rightBars;
  if (pivotBar < leftBars) return NaN;

  const pivotVal = getSourceValueAtBar(sourceExpr, pivotBar, ctx);
  if (isNaN(pivotVal)) return NaN;

  for (let i = 1; i <= leftBars; i++) {
    const val = getSourceValueAtBar(sourceExpr, pivotBar - i, ctx);
    if (isNaN(val) || val < pivotVal) return NaN;
  }

  for (let i = 1; i <= rightBars; i++) {
    const val = getSourceValueAtBar(sourceExpr, pivotBar + i, ctx);
    if (isNaN(val) || val < pivotVal) return NaN;
  }

  return pivotVal;
}

/** ta.highest(source, period) — max of last period values */
function evalTA_Highest(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;
  let max = -Infinity;
  for (const v of values) {
    if (isNaN(v)) return NaN;
    if (v > max) max = v;
  }
  return max;
}

/** ta.lowest(source, period) — min of last period values */
function evalTA_Lowest(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;
  let min = Infinity;
  for (const v of values) {
    if (isNaN(v)) return NaN;
    if (v < min) min = v;
  }
  return min;
}

/** ta.crossover(a, b) — true when a crosses above b */
function evalTA_Crossover(args: Expr[], ctx: BarContext): number {
  if (ctx.barIndex < 1) return 0;
  const aCurr = toNumber(evalExpr(args[0], ctx));
  const bCurr = toNumber(evalExpr(args[1], ctx));
  const aPrev = getSourceValueAtBar(args[0], ctx.barIndex - 1, ctx);
  const bPrev = getSourceValueAtBar(args[1], ctx.barIndex - 1, ctx);

  if (isNaN(aCurr) || isNaN(bCurr) || isNaN(aPrev) || isNaN(bPrev)) return 0;
  return (aPrev <= bPrev && aCurr > bCurr) ? 1 : 0;
}

/** ta.crossunder(a, b) — true when a crosses below b */
function evalTA_Crossunder(args: Expr[], ctx: BarContext): number {
  if (ctx.barIndex < 1) return 0;
  const aCurr = toNumber(evalExpr(args[0], ctx));
  const bCurr = toNumber(evalExpr(args[1], ctx));
  const aPrev = getSourceValueAtBar(args[0], ctx.barIndex - 1, ctx);
  const bPrev = getSourceValueAtBar(args[1], ctx.barIndex - 1, ctx);

  if (isNaN(aCurr) || isNaN(bCurr) || isNaN(aPrev) || isNaN(bPrev)) return 0;
  return (aPrev >= bPrev && aCurr < bCurr) ? 1 : 0;
}

/** ta.rsi(source, period) — RSI using RMA of gains and losses */
function evalTA_RSI(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  // Get previous source value
  const prevSource = getSourceValueAtBar(args[0], ctx.barIndex - 1, ctx);
  const change = ctx.barIndex > 0 && !isNaN(prevSource) ? source - prevSource : 0;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;

  const gainKey = `_rsi_gain_${stableExprKey(fullExpr)}`;
  const lossKey = `_rsi_loss_${stableExprKey(fullExpr)}`;

  const prevGain = ctx.taState.get(gainKey) ?? NaN;
  const prevLoss = ctx.taState.get(lossKey) ?? NaN;

  const avgGain = isNaN(prevGain) ? gain : prevGain * (period - 1) / period + gain / period;
  const avgLoss = isNaN(prevLoss) ? loss : prevLoss * (period - 1) / period + loss / period;

  ctx.taState.set(gainKey, avgGain);
  ctx.taState.set(lossKey, avgLoss);

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** ta.macd(source, fastlen, slowlen, siglen) — returns [macd, signal, hist] */
function evalTA_MACD(args: Expr[], fullExpr: Expr, ctx: BarContext): number[] {
  const source = toNumber(evalExpr(args[0], ctx));
  const fastLen = Math.round(toNumber(evalExpr(args[1], ctx)));
  const slowLen = Math.round(toNumber(evalExpr(args[2], ctx)));
  const sigLen = Math.round(toNumber(evalExpr(args[3], ctx)));

  if (isNaN(fastLen) || isNaN(slowLen) || isNaN(sigLen)) return [NaN, NaN, NaN];

  const exprKey = stableExprKey(fullExpr);

  // Fast EMA
  const fastK = 2 / (fastLen + 1);
  const fastKey = `_macd_fast_${exprKey}`;
  const prevFast = ctx.taState.get(fastKey) ?? NaN;
  const fastEMA = isNaN(prevFast) ? source : prevFast + fastK * (source - prevFast);
  ctx.taState.set(fastKey, fastEMA);

  // Slow EMA
  const slowK = 2 / (slowLen + 1);
  const slowKey = `_macd_slow_${exprKey}`;
  const prevSlow = ctx.taState.get(slowKey) ?? NaN;
  const slowEMA = isNaN(prevSlow) ? source : prevSlow + slowK * (source - prevSlow);
  ctx.taState.set(slowKey, slowEMA);

  // MACD line
  const macdLine = fastEMA - slowEMA;

  // Signal line (EMA of MACD)
  const sigK = 2 / (sigLen + 1);
  const sigKey = `_macd_sig_${exprKey}`;
  const prevSig = ctx.taState.get(sigKey) ?? NaN;
  const signalLine = isNaN(prevSig) ? macdLine : prevSig + sigK * (macdLine - prevSig);
  ctx.taState.set(sigKey, signalLine);

  // Histogram
  const histogram = macdLine - signalLine;

  return [macdLine, signalLine, histogram];
}

/** ta.bb(source, length, mult) — returns [middle, upper, lower] */
function evalTA_BB(args: Expr[], ctx: BarContext): number[] {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = Math.round(toNumber(evalExpr(args[1], ctx)));
  const mult = args.length >= 3 ? toNumber(evalExpr(args[2], ctx)) : 2;

  if (isNaN(length) || length < 1) return [NaN, NaN, NaN];

  const values = collectSourceValues(args[0], length, source, ctx);
  if (values.length < length) return [NaN, NaN, NaN];

  const middle = values.reduce((a, b) => a + b, 0) / length;
  let sqSum = 0;
  for (const v of values) sqSum += (v - middle) ** 2;
  const stdev = Math.sqrt(sqSum / length);

  return [middle, middle + mult * stdev, middle - mult * stdev];
}

/** ta.stoch(source, high, low, period) */
function evalTA_Stoch(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args.length >= 4 ? args[3] : args[1], ctx)));

  if (isNaN(period) || period < 1 || ctx.barIndex < period - 1) return NaN;

  let highest = -Infinity;
  let lowest = Infinity;
  for (let b = ctx.barIndex - period + 1; b <= ctx.barIndex; b++) {
    if (b < 0) return NaN;
    const c = ctx.candles[b];
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }

  const range = highest - lowest;
  return range === 0 ? 50 : ((source - lowest) / range) * 100;
}

/** ta.cci(source, period) — Commodity Channel Index */
function evalTA_CCI(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;

  const mean = values.reduce((a, b) => a + b, 0) / period;
  let madSum = 0;
  for (const v of values) madSum += Math.abs(v - mean);
  const mad = madSum / period;

  return mad === 0 ? 0 : (source - mean) / (0.015 * mad);
}

/** ta.supertrend(factor, atrPeriod) — returns [supertrend, direction] */
function evalTA_Supertrend(args: Expr[], fullExpr: Expr, ctx: BarContext): number[] {
  const factor = toNumber(evalExpr(args[0], ctx));
  const atrPeriod = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(factor) || isNaN(atrPeriod) || atrPeriod < 1) return [NaN, NaN];

  const exprKey = stableExprKey(fullExpr);
  const hl2 = (ctx.candle.high + ctx.candle.low) / 2;

  // Compute ATR via RMA of TR
  const tr = computeTrueRange(ctx);
  const atrKey = `_st_atr_${exprKey}`;
  const prevATR = ctx.taState.get(atrKey) ?? NaN;
  const atr = isNaN(prevATR) ? tr : prevATR * (atrPeriod - 1) / atrPeriod + tr / atrPeriod;
  ctx.taState.set(atrKey, atr);

  const upperBand = hl2 + factor * atr;
  const lowerBand = hl2 - factor * atr;

  const prevUpper = ctx.taState.get(`_st_ub_${exprKey}`) ?? upperBand;
  const prevLower = ctx.taState.get(`_st_lb_${exprKey}`) ?? lowerBand;
  const prevDir = ctx.taState.get(`_st_dir_${exprKey}`) ?? 1;

  const finalUpper = (upperBand < prevUpper || ctx.candles[Math.max(0, ctx.barIndex - 1)]?.close > prevUpper)
    ? upperBand : prevUpper;
  const finalLower = (lowerBand > prevLower || ctx.candles[Math.max(0, ctx.barIndex - 1)]?.close < prevLower)
    ? lowerBand : prevLower;

  let dir: number;
  if (prevDir === -1 && ctx.candle.close > prevUpper) {
    dir = 1;
  } else if (prevDir === 1 && ctx.candle.close < prevLower) {
    dir = -1;
  } else {
    dir = prevDir;
  }

  ctx.taState.set(`_st_ub_${exprKey}`, finalUpper);
  ctx.taState.set(`_st_lb_${exprKey}`, finalLower);
  ctx.taState.set(`_st_dir_${exprKey}`, dir);

  const supertrend = dir === 1 ? finalLower : finalUpper;
  return [supertrend, dir];
}

/** ta.change(source, length?) — source - source[length] */
function evalTA_Change(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = args.length >= 2 ? Math.round(toNumber(evalExpr(args[1], ctx))) : 1;
  if (isNaN(length) || length < 1) return NaN;

  const prev = getSourceValueAtBar(args[0], ctx.barIndex - length, ctx);
  if (isNaN(prev)) return NaN;
  return source - prev;
}

/** ta.hma(source, period) — Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) */
function evalTA_HMA(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 2) return NaN;

  // HMA is complex to compute incrementally. Simplified approach:
  // Use the stateKey to store intermediate WMA values.
  // For a proper implementation, we'd need the full series, but we approximate
  // using what history we have.
  const halfPeriod = Math.round(period / 2);
  const sqrtPeriod = Math.round(Math.sqrt(period));

  const valuesN = collectSourceValues(args[0], period, source, ctx);
  const valuesHalf = collectSourceValues(args[0], halfPeriod, source, ctx);

  if (valuesN.length < period || valuesHalf.length < halfPeriod) return NaN;

  const wmaN = computeWMA(valuesN, period);
  const wmaHalf = computeWMA(valuesHalf, halfPeriod);

  // Store intermediate: 2*WMA(n/2) - WMA(n)
  const key = `_hma_series_${stableExprKey(fullExpr)}`;
  const intermediateVal = 2 * wmaHalf - wmaN;

  // Store in history for WMA(sqrt(n))
  let series = ctx.taState.get(key + "_count") ?? 0;
  ctx.taState.set(key + `_v${series}`, intermediateVal);
  ctx.taState.set(key + "_count", series + 1);

  if (series + 1 < sqrtPeriod) return NaN;

  // Collect last sqrtPeriod intermediate values
  const intValues: number[] = [];
  for (let i = series + 1 - sqrtPeriod; i <= series; i++) {
    intValues.push(ctx.taState.get(key + `_v${i}`) ?? NaN);
  }

  return computeWMA(intValues, sqrtPeriod);
}

function computeWMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < period; i++) {
    const w = i + 1;
    weightedSum += values[i] * w;
    weightTotal += w;
  }
  return weightedSum / weightTotal;
}

/** ta.swma(source) — Symmetrically Weighted Moving Average (4-period) */
function evalTA_SWMA(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const values = collectSourceValues(args[0], 4, source, ctx);
  if (values.length < 4) return NaN;
  // Weights: 1/6, 2/6, 2/6, 1/6
  return (values[0] * 1 + values[1] * 2 + values[2] * 2 + values[3] * 1) / 6;
}

/** ta.alma(source, length, offset, sigma) — Arnaud Legoux Moving Average */
function evalTA_ALMA(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = Math.round(toNumber(evalExpr(args[1], ctx)));
  const offset = args.length >= 3 ? toNumber(evalExpr(args[2], ctx)) : 0.85;
  const sigma = args.length >= 4 ? toNumber(evalExpr(args[3], ctx)) : 6;
  if (isNaN(length) || length < 1) return NaN;

  const values = collectSourceValues(args[0], length, source, ctx);
  if (values.length < length) return NaN;

  const m = offset * (length - 1);
  const s = length / sigma;
  let wSum = 0;
  let wNorm = 0;
  for (let i = 0; i < length; i++) {
    const w = Math.exp(-((i - m) ** 2) / (2 * s * s));
    wSum += values[i] * w;
    wNorm += w;
  }
  return wNorm === 0 ? NaN : wSum / wNorm;
}

/** ta.cum(source) — cumulative sum */
function evalTA_Cum(args: Expr[], fullExpr: Expr, ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const key = `_cum_${stableExprKey(fullExpr)}`;
  const prev = ctx.taState.get(key) ?? 0;
  const result = prev + (isNaN(source) ? 0 : source);
  ctx.taState.set(key, result);
  return result;
}

/** ta.stdev(source, period) — standard deviation */
function evalTA_Stdev(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;

  const mean = values.reduce((a, b) => a + b, 0) / period;
  let sqSum = 0;
  for (const v of values) sqSum += (v - mean) ** 2;
  return Math.sqrt(sqSum / period);
}

/** ta.variance(source, period) */
function evalTA_Variance(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const period = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(period) || period < 1) return NaN;

  const values = collectSourceValues(args[0], period, source, ctx);
  if (values.length < period) return NaN;

  const mean = values.reduce((a, b) => a + b, 0) / period;
  let sqSum = 0;
  for (const v of values) sqSum += (v - mean) ** 2;
  return sqSum / period;
}

/** ta.barssince(condition) — bars since condition was true */
function evalTA_BarsSince(args: Expr[], ctx: BarContext): number {
  // Walk backward through history looking for when condition was true
  // This is tricky because the condition changes per bar. We'd need to evaluate
  // the condition at past bars. Instead, we track the condition in taState.
  const cond = toNumber(evalExpr(args[0], ctx));
  const key = `_barssince_${stableExprKey(args[0])}`;

  if (isTruthy(cond)) {
    ctx.taState.set(key, 0);
    return 0;
  }

  const prev = ctx.taState.get(key);
  if (prev === undefined || isNaN(prev)) return NaN;
  const result = prev + 1;
  ctx.taState.set(key, result);
  return result;
}

/** ta.valuewhen(condition, source, occurrence) — value of source when condition was true */
function evalTA_ValueWhen(args: Expr[], ctx: BarContext): number {
  const cond = toNumber(evalExpr(args[0], ctx));
  const source = toNumber(evalExpr(args[1], ctx));
  const occurrence = args.length >= 3 ? Math.round(toNumber(evalExpr(args[2], ctx))) : 0;
  if (isNaN(occurrence) || occurrence < 0) return NaN;

  const key = `_valuewhen_${occurrence}_${stableExprKey(args[0])}`;

  if (isTruthy(cond)) {
    ctx.taState.set(key, source);
  }

  return ctx.taState.get(key) ?? NaN;
}

/** ta.falling(source, length) — true if source has been falling for length bars */
function evalTA_Falling(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(length) || length < 1 || ctx.barIndex < length) return 0;

  const values = collectSourceValues(args[0], length + 1, source, ctx);
  if (values.length < length + 1) return 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] >= values[i - 1]) return 0;
  }
  return 1;
}

/** ta.rising(source, length) — true if source has been rising for length bars */
function evalTA_Rising(args: Expr[], ctx: BarContext): number {
  const source = toNumber(evalExpr(args[0], ctx));
  const length = Math.round(toNumber(evalExpr(args[1], ctx)));
  if (isNaN(length) || length < 1 || ctx.barIndex < length) return 0;

  const values = collectSourceValues(args[0], length + 1, source, ctx);
  if (values.length < length + 1) return 0;

  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) return 0;
  }
  return 1;
}

// ─── Math Function Evaluation ───────────────────────────────────────────────

function evalMathCall(fn: string, args: Expr[], ctx: BarContext): number {
  switch (fn) {
    case "abs":
      return Math.abs(toNumber(evalExpr(args[0], ctx)));
    case "max": {
      if (args.length === 0) return NaN;
      let max = toNumber(evalExpr(args[0], ctx));
      for (let i = 1; i < args.length; i++) {
        const v = toNumber(evalExpr(args[i], ctx));
        if (v > max) max = v;
      }
      return max;
    }
    case "min": {
      if (args.length === 0) return NaN;
      let min = toNumber(evalExpr(args[0], ctx));
      for (let i = 1; i < args.length; i++) {
        const v = toNumber(evalExpr(args[i], ctx));
        if (v < min) min = v;
      }
      return min;
    }
    case "avg": {
      if (args.length === 0) return NaN;
      let sum = 0;
      for (const a of args) sum += toNumber(evalExpr(a, ctx));
      return sum / args.length;
    }
    case "round": {
      const val = toNumber(evalExpr(args[0], ctx));
      if (args.length >= 2) {
        const precision = toNumber(evalExpr(args[1], ctx));
        const factor = Math.pow(10, precision);
        return Math.round(val * factor) / factor;
      }
      return Math.round(val);
    }
    case "ceil":
      return Math.ceil(toNumber(evalExpr(args[0], ctx)));
    case "floor":
      return Math.floor(toNumber(evalExpr(args[0], ctx)));
    case "sqrt":
      return Math.sqrt(toNumber(evalExpr(args[0], ctx)));
    case "pow":
      return Math.pow(
        toNumber(evalExpr(args[0], ctx)),
        toNumber(evalExpr(args[1], ctx)),
      );
    case "log":
      return Math.log(toNumber(evalExpr(args[0], ctx)));
    case "log10":
      return Math.log10(toNumber(evalExpr(args[0], ctx)));
    case "exp":
      return Math.exp(toNumber(evalExpr(args[0], ctx)));
    case "sign":
      return Math.sign(toNumber(evalExpr(args[0], ctx)));
    case "sin":
      return Math.sin(toNumber(evalExpr(args[0], ctx)));
    case "cos":
      return Math.cos(toNumber(evalExpr(args[0], ctx)));
    case "tan":
      return Math.tan(toNumber(evalExpr(args[0], ctx)));
    case "asin":
      return Math.asin(toNumber(evalExpr(args[0], ctx)));
    case "acos":
      return Math.acos(toNumber(evalExpr(args[0], ctx)));
    case "atan":
      return Math.atan(toNumber(evalExpr(args[0], ctx)));
    case "todegrees":
      return toNumber(evalExpr(args[0], ctx)) * (180 / Math.PI);
    case "toradians":
      return toNumber(evalExpr(args[0], ctx)) * (Math.PI / 180);
    case "random":
      return Math.random();
    default:
      return NaN;
  }
}

// ─── Custom Function Evaluation ─────────────────────────────────────────────

function evalCustomFunction(
  funcDef: { params: string[]; body: Stmt[] },
  args: Expr[],
  ctx: BarContext,
): number | number[] {
  // Create a nested context with a new locals scope
  const nestedLocals = new Map<string, number>();

  // Inherit built-in variables
  for (const [k, v] of ctx.locals) {
    nestedLocals.set(k, v);
  }

  // Map arguments to parameter names
  for (let i = 0; i < funcDef.params.length; i++) {
    const argVal = i < args.length ? toNumber(evalExpr(args[i], ctx)) : NaN;
    nestedLocals.set(funcDef.params[i], argVal);
  }

  const nestedCtx: BarContext = {
    ...ctx,
    locals: nestedLocals,
  };

  // Execute body statements
  let lastValue: number | number[] = NaN;
  for (const s of funcDef.body) {
    executeStmt(s, nestedCtx);

    // Track the last expression's value
    if (s.k === "expr") {
      lastValue = evalExpr(s.e, nestedCtx);
    } else if (s.k === "assign" && s.targets.length === 1) {
      const name = s.targets[0];
      lastValue = nestedCtx.locals.get(name) ?? nestedCtx.vars.get(name) ?? NaN;
    }
  }

  // If the function body has multiple assignments that should be returned as tuple,
  // check if the last statement hints at a tuple pattern.
  // For simple functions, just return the last computed value.
  // Propagate any locals set in the nested context back to the parent if
  // they were already in vars (since vars is shared by reference, this
  // happens automatically).

  return lastValue;
}

// ─── Binary/Unary/Ternary Evaluation ────────────────────────────────────────

function evalBinop(
  expr: Extract<Expr, { k: "binop" }>,
  ctx: BarContext,
): number {
  const { op, l, r } = expr;

  // Short-circuit for logical operators
  if (op === "and") {
    const lv = toNumber(evalExpr(l, ctx));
    if (!isTruthy(lv)) return 0;
    return isTruthy(toNumber(evalExpr(r, ctx))) ? 1 : 0;
  }
  if (op === "or") {
    const lv = toNumber(evalExpr(l, ctx));
    if (isTruthy(lv)) return 1;
    return isTruthy(toNumber(evalExpr(r, ctx))) ? 1 : 0;
  }

  const lv = toNumber(evalExpr(l, ctx));
  const rv = toNumber(evalExpr(r, ctx));

  switch (op) {
    case "+":  return lv + rv;
    case "-":  return lv - rv;
    case "*":  return lv * rv;
    case "/":  return rv === 0 ? NaN : lv / rv;
    case "%":  return rv === 0 ? NaN : lv % rv;
    case "^":  return Math.pow(lv, rv);
    case ">":  return (!isNaN(lv) && !isNaN(rv) && lv > rv) ? 1 : 0;
    case "<":  return (!isNaN(lv) && !isNaN(rv) && lv < rv) ? 1 : 0;
    case ">=": return (!isNaN(lv) && !isNaN(rv) && lv >= rv) ? 1 : 0;
    case "<=": return (!isNaN(lv) && !isNaN(rv) && lv <= rv) ? 1 : 0;
    case "==": {
      // NaN == NaN should be false in PineScript (na == na is false)
      if (isNaN(lv) && isNaN(rv)) return 0;
      return lv === rv ? 1 : 0;
    }
    case "!=": {
      if (isNaN(lv) && isNaN(rv)) return 0;
      if (isNaN(lv) || isNaN(rv)) return 1;
      return lv !== rv ? 1 : 0;
    }
    case "index":
      // Dynamic indexing — fallback, should be caught by hist
      return NaN;
    default:
      return NaN;
  }
}

function evalUnop(
  expr: Extract<Expr, { k: "unop" }>,
  ctx: BarContext,
): number {
  const val = toNumber(evalExpr(expr.e, ctx));
  switch (expr.op) {
    case "-":   return -val;
    case "not": return isTruthy(val) ? 0 : 1;
    default:    return NaN;
  }
}

function evalTernary(
  expr: Extract<Expr, { k: "ternary" }>,
  ctx: BarContext,
): number | number[] {
  const cond = toNumber(evalExpr(expr.cond, ctx));
  return isTruthy(cond) ? evalExpr(expr.yes, ctx) : evalExpr(expr.no, ctx);
}

// ─── Utility Functions ──────────────────────────────────────────────────────

/** Convert a return value to a number (extract first element if tuple) */
function toNumber(val: number | number[]): number {
  if (Array.isArray(val)) return val[0] ?? NaN;
  return val;
}

/** PineScript truthiness: non-zero, non-NaN is truthy */
function isTruthy(val: number): boolean {
  return !isNaN(val) && val !== 0;
}

/**
 * Collect the last `period` values of a source expression, including the
 * current bar's value. Returns values in chronological order (oldest first).
 */
function collectSourceValues(
  sourceExpr: Expr,
  period: number,
  currentValue: number,
  ctx: BarContext,
): number[] {
  const values: number[] = [];
  const startBar = ctx.barIndex - period + 1;

  for (let b = startBar; b < ctx.barIndex; b++) {
    if (b < 0) {
      values.push(NaN);
    } else {
      values.push(getSourceValueAtBar(sourceExpr, b, ctx));
    }
  }
  values.push(toNumber(currentValue));
  return values;
}

/**
 * Get the value of a source expression at a specific past bar.
 * Uses the history map for identifier lookups.
 */
function getSourceValueAtBar(expr: Expr, bar: number, ctx: BarContext): number {
  if (bar < 0 || bar >= ctx.candles.length) return NaN;

  switch (expr.k) {
    case "id": {
      // Check history for named variables
      const arr = ctx.history.get(expr.name);
      if (arr && bar < arr.length) return arr[bar];
      // For built-ins, compute from candle data
      const c = ctx.candles[bar];
      if (!c) return NaN;
      switch (expr.name) {
        case "close":  return c.close;
        case "open":   return c.open;
        case "high":   return c.high;
        case "low":    return c.low;
        case "volume": return c.volume;
        case "hlc3":   return (c.high + c.low + c.close) / 3;
        case "hl2":    return (c.high + c.low) / 2;
        case "ohlc4":  return (c.open + c.high + c.low + c.close) / 4;
        default:       return NaN;
      }
    }

    case "num":
      return expr.v;

    case "na":
      return NaN;

    case "hist": {
      // Historical reference at a past bar: e.g., close[1] evaluated at bar=b
      // means close at bar b-1
      const targetBar = bar - expr.offset;
      if (targetBar < 0) return NaN;
      return getSourceValueAtBar({ k: "id", name: expr.name }, targetBar, ctx);
    }

    case "call": {
      // For computed values (e.g., ta.sma at a past bar), look up the result
      // variable in history. We cannot re-evaluate TA functions at past bars.
      // Return NaN if not available.
      return NaN;
    }

    case "binop": {
      const lv = getSourceValueAtBar(expr.l, bar, ctx);
      const rv = getSourceValueAtBar(expr.r, bar, ctx);
      switch (expr.op) {
        case "+": return lv + rv;
        case "-": return lv - rv;
        case "*": return lv * rv;
        case "/": return rv === 0 ? NaN : lv / rv;
        default:  return NaN;
      }
    }

    case "unop": {
      const v = getSourceValueAtBar(expr.e, bar, ctx);
      switch (expr.op) {
        case "-": return -v;
        default:  return NaN;
      }
    }

    default:
      return NaN;
  }
}

/**
 * Generate a stable, unique key for an expression so that TA functions with
 * stateful accumulators (EMA, RMA, RSI, etc.) can store their state without
 * collisions.
 */
function stableExprKey(expr: Expr): string {
  switch (expr.k) {
    case "num":     return `n${expr.v}`;
    case "bool":    return `b${expr.v}`;
    case "str":     return `s${expr.v}`;
    case "na":      return "na";
    case "id":      return `id_${expr.name}`;
    case "hist":    return `h_${expr.name}_${expr.offset}`;
    case "call": {
      const ns = expr.ns ? `${expr.ns}.` : "";
      const argKeys = expr.args.map(stableExprKey).join(",");
      return `c_${ns}${expr.fn}(${argKeys})`;
    }
    case "binop":   return `(${stableExprKey(expr.l)}${expr.op}${stableExprKey(expr.r)})`;
    case "unop":    return `(${expr.op}${stableExprKey(expr.e)})`;
    case "ternary": return `(${stableExprKey(expr.cond)}?${stableExprKey(expr.yes)}:${stableExprKey(expr.no)})`;
    default:        return "?";
  }
}
