"use client";

import { useMemo } from "react";
import type { Candle } from "./types";
import type { ParsedPine } from "./pine-parser";
import { executeRuntime } from "./pine-runtime";
import * as ta from "./ta-engine";

// ─── VisualConfig types (from pine-visual.ts) ───────────────────────────────

type DynamicColor =
  | { kind: "static"; value: string }
  | { kind: "conditional"; condition: any; trueColor: string; falseColor: string };

interface PlotConfig {
  id: string;
  source: string;
  sourceExpr: any;
  title?: string;
  color: DynamicColor;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  visible?: boolean;
}

interface FillConfig {
  plot1Id: string;
  plot2Id: string;
  color: DynamicColor;
  opacity: number;
}

interface HLineConfig {
  price: number;
  title?: string;
  color: string;
  lineStyle: string;
  lineWidth: number;
}

interface MarkerConfig {
  conditionExpr: any;
  style: string;
  location: string;
  color: DynamicColor;
  text?: string;
  size: number;
}

export interface VisualConfig {
  plots: PlotConfig[];
  fills: FillConfig[];
  bgColors: any[];
  hlines: HLineConfig[];
  markers: MarkerConfig[];
  lines: any[];
  boxes: any[];
}

// ─── Rendered output types ──────────────────────────────────────────────────

export interface RenderedPlot {
  id: string;
  title?: string;
  data: Array<{ time: number; value: number }>;
  color: string;
  lineWidth: number;
  lineStyle: "solid" | "dashed" | "dotted";
  /** When false, the plot data is computed (for fills etc.) but should not be drawn. */
  visible: boolean;
}

export interface RenderedFill {
  upperData: Array<{ time: number; value: number }>;
  lowerData: Array<{ time: number; value: number }>;
  color: string;
  opacity: number;
}

export interface RenderedMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
  size: number;
}

export interface RenderedHLine {
  price: number;
  color: string;
  lineWidth: number;
  lineStyle: string;
  title?: string;
}

export interface RenderedVisuals {
  plots: RenderedPlot[];
  fills: RenderedFill[];
  markers: RenderedMarker[];
  hlines: RenderedHLine[];
}

// ─── Empty result constant ──────────────────────────────────────────────────

const EMPTY_VISUALS: RenderedVisuals = {
  plots: [],
  fills: [],
  markers: [],
  hlines: [],
};

// ─── Expression evaluator ───────────────────────────────────────────────────

function evaluateExpr(
  expr: any,
  vars: Map<string, number[]>,
  candles: Candle[],
): number[] | null {
  if (expr == null) return null;
  const n = candles.length;

  // Literal number — fill array with constant
  if (expr.k === "num") {
    const v = typeof expr.v === "number" ? expr.v : Number(expr.v);
    if (Number.isNaN(v)) return null;
    return new Array(n).fill(v);
  }

  // na — PineScript "not available". Propagates as NaN through computations.
  if (expr.k === "na") {
    return new Array(n).fill(NaN);
  }

  // Boolean literal — treat true as 1.0, false as 0.0
  if (expr.k === "bool") {
    return new Array(n).fill(expr.v ? 1.0 : 0.0);
  }

  // Variable reference — look up in the vars map
  if (expr.k === "id") {
    const name = expr.name as string;
    return vars.get(name) ?? null;
  }

  // History reference (e.g. close[1])
  if (expr.k === "hist") {
    const base = vars.get(expr.name as string);
    if (!base) return null;
    const offset = typeof expr.offset === "number" ? expr.offset : 1;
    if (offset <= 0) return base;
    const shifted = new Array(n).fill(0);
    for (let i = offset; i < n; i++) {
      shifted[i] = base[i - offset];
    }
    return shifted;
  }

  // TA function call
  if (expr.k === "call" && expr.ns === "ta") {
    const fn = expr.fn as string;
    const args: any[] = expr.args ?? [];

    // Resolve the source argument (first arg is typically a series)
    const resolveSeriesArg = (arg: any): number[] | null => {
      if (typeof arg === "string") return vars.get(arg) ?? null;
      if (typeof arg === "object" && arg !== null) return evaluateExpr(arg, vars, candles);
      return null;
    };

    const resolveNumArg = (arg: any): number => {
      if (typeof arg === "number") return arg;
      if (typeof arg === "object" && arg !== null && arg.k === "num") return arg.v;
      // If it's a reference to a constant in vars, take the first value
      if (typeof arg === "object" && arg !== null && arg.k === "id") {
        const arr = vars.get(arg.name);
        if (arr && arr.length > 0) return arr[0];
      }
      return Number(arg) || 0;
    };

    switch (fn) {
      case "sma": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.sma(source, Math.round(period));
      }
      case "ema": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.ema(source, Math.round(period));
      }
      case "wma": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.wma(source, Math.round(period));
      }
      case "hma": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.hma(source, Math.round(period));
      }
      case "dema": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.dema(source, Math.round(period));
      }
      case "tema": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.tema(source, Math.round(period));
      }
      case "rsi": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.rsi(source, Math.round(period));
      }
      case "macd": {
        const source = resolveSeriesArg(args[0]);
        const fast = resolveNumArg(args[1]) || 12;
        const slow = resolveNumArg(args[2]) || 26;
        const signal = resolveNumArg(args[3]) || 9;
        if (!source) return null;
        const result = ta.macd(source, Math.round(fast), Math.round(slow), Math.round(signal));
        // MACD returns multiple series. Convention: "macd" = macdLine,
        // the caller should use "macd.signal" and "macd.hist" via separate calls.
        // Default to macdLine.
        return result.macdLine;
      }
      case "macd.signal": case "macdSignal": {
        const source = resolveSeriesArg(args[0]);
        const fast = resolveNumArg(args[1]) || 12;
        const slow = resolveNumArg(args[2]) || 26;
        const signal = resolveNumArg(args[3]) || 9;
        if (!source) return null;
        return ta.macd(source, Math.round(fast), Math.round(slow), Math.round(signal)).signalLine;
      }
      case "macd.hist": case "macdHist": {
        const source = resolveSeriesArg(args[0]);
        const fast = resolveNumArg(args[1]) || 12;
        const slow = resolveNumArg(args[2]) || 26;
        const signal = resolveNumArg(args[3]) || 9;
        if (!source) return null;
        return ta.macd(source, Math.round(fast), Math.round(slow), Math.round(signal)).histogram;
      }
      case "bb": case "bbands": case "bollingerBands": {
        // Returns the middle band by default. Use bb.upper / bb.lower for others.
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]) || 20;
        const mult = resolveNumArg(args[2]) || 2;
        if (!source) return null;
        return ta.bollingerBands(source, Math.round(period), mult).mid;
      }
      case "bb.upper": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]) || 20;
        const mult = resolveNumArg(args[2]) || 2;
        if (!source) return null;
        return ta.bollingerBands(source, Math.round(period), mult).upper;
      }
      case "bb.lower": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]) || 20;
        const mult = resolveNumArg(args[2]) || 2;
        if (!source) return null;
        return ta.bollingerBands(source, Math.round(period), mult).lower;
      }
      case "atr": {
        const period = resolveNumArg(args[0]) || 14;
        return ta.atr(candles, Math.round(period));
      }
      case "stoch": {
        // Returns %K by default
        const kPeriod = resolveNumArg(args[0]) || 14;
        const dPeriod = resolveNumArg(args[1]) || 3;
        const smoothK = resolveNumArg(args[2]) || 3;
        return ta.stoch(candles, Math.round(kPeriod), Math.round(dPeriod), Math.round(smoothK)).k;
      }
      case "stoch.d": {
        const kPeriod = resolveNumArg(args[0]) || 14;
        const dPeriod = resolveNumArg(args[1]) || 3;
        const smoothK = resolveNumArg(args[2]) || 3;
        return ta.stoch(candles, Math.round(kPeriod), Math.round(dPeriod), Math.round(smoothK)).d;
      }
      case "stochrsi": case "stochRsi": {
        const source = resolveSeriesArg(args[0]);
        const rsiPeriod = resolveNumArg(args[1]) || 14;
        const stochPeriod = resolveNumArg(args[2]) || 14;
        const smoothK = resolveNumArg(args[3]) || 3;
        const smoothD = resolveNumArg(args[4]) || 3;
        if (!source) return null;
        return ta.stochRsi(source, Math.round(rsiPeriod), Math.round(stochPeriod), Math.round(smoothK), Math.round(smoothD)).k;
      }
      case "cci": {
        const period = resolveNumArg(args[0]) || 20;
        return ta.cci(candles, Math.round(period));
      }
      case "williams_r": case "williamsR": {
        const period = resolveNumArg(args[0]) || 14;
        return ta.williamsR(candles, Math.round(period));
      }
      case "mfi": {
        const period = resolveNumArg(args[0]) || 14;
        return ta.mfi(candles, Math.round(period));
      }
      case "vwap": {
        return ta.vwap(candles);
      }
      case "obv": {
        return ta.obv(candles);
      }
      case "supertrend": {
        const period = resolveNumArg(args[0]) || 10;
        const mult = resolveNumArg(args[1]) || 3;
        return ta.supertrend(candles, Math.round(period), mult).line;
      }
      case "supertrend.dir": case "supertrendDir": {
        const period = resolveNumArg(args[0]) || 10;
        const mult = resolveNumArg(args[1]) || 3;
        return ta.supertrend(candles, Math.round(period), mult).direction;
      }
      case "keltner": {
        const emaPeriod = resolveNumArg(args[0]) || 20;
        const atrPeriod = resolveNumArg(args[1]) || 10;
        const mult = resolveNumArg(args[2]) || 1.5;
        return ta.keltnerChannel(candles, Math.round(emaPeriod), Math.round(atrPeriod), mult).mid;
      }
      case "keltner.upper": {
        const emaPeriod = resolveNumArg(args[0]) || 20;
        const atrPeriod = resolveNumArg(args[1]) || 10;
        const mult = resolveNumArg(args[2]) || 1.5;
        return ta.keltnerChannel(candles, Math.round(emaPeriod), Math.round(atrPeriod), mult).upper;
      }
      case "keltner.lower": {
        const emaPeriod = resolveNumArg(args[0]) || 20;
        const atrPeriod = resolveNumArg(args[1]) || 10;
        const mult = resolveNumArg(args[2]) || 1.5;
        return ta.keltnerChannel(candles, Math.round(emaPeriod), Math.round(atrPeriod), mult).lower;
      }
      case "donchian": {
        const period = resolveNumArg(args[0]) || 20;
        return ta.donchianChannel(candles, Math.round(period)).mid;
      }
      case "donchian.upper": {
        const period = resolveNumArg(args[0]) || 20;
        return ta.donchianChannel(candles, Math.round(period)).upper;
      }
      case "donchian.lower": {
        const period = resolveNumArg(args[0]) || 20;
        return ta.donchianChannel(candles, Math.round(period)).lower;
      }
      case "highest": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.highest(source, Math.round(period));
      }
      case "lowest": {
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        if (!source || period <= 0) return null;
        return ta.lowest(source, Math.round(period));
      }
      case "crossover": {
        const a = resolveSeriesArg(args[0]);
        const b = resolveSeriesArg(args[1]);
        if (!a || !b) return null;
        return a.map((_, i) => ta.crossover(a, b, i) ? 1.0 : 0.0);
      }
      case "crossunder": {
        const a = resolveSeriesArg(args[0]);
        const b = resolveSeriesArg(args[1]);
        if (!a || !b) return null;
        return a.map((_, i) => ta.crossunder(a, b, i) ? 1.0 : 0.0);
      }
      case "linreg": {
        // ta.linreg(source, length, offset) — linear regression value
        const source = resolveSeriesArg(args[0]);
        const period = resolveNumArg(args[1]);
        const offset = resolveNumArg(args[2]);
        if (!source || period <= 0) return null;
        const len = Math.round(period);
        const off = Math.round(offset) || 0;
        const out = new Array(n).fill(0);
        for (let i = len - 1; i < n; i++) {
          // Compute least-squares linear regression over [i-len+1 .. i]
          let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
          for (let j = 0; j < len; j++) {
            const x = j;
            const y = source[i - len + 1 + j];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
          }
          const denom = len * sumX2 - sumX * sumX;
          if (denom === 0) { out[i] = source[i]; continue; }
          const slope = (len * sumXY - sumX * sumY) / denom;
          const intercept = (sumY - slope * sumX) / len;
          // Value at position (len - 1 + offset)
          out[i] = intercept + slope * (len - 1 + off);
        }
        return out;
      }
      case "pivothigh": {
        // ta.pivothigh(source, leftbars, rightbars) — NaN except at pivot highs
        const source = resolveSeriesArg(args[0]);
        const leftBars = resolveNumArg(args[1]) || 5;
        const rightBars = resolveNumArg(args[2]) || 5;
        if (!source) return null;
        const lb = Math.round(leftBars);
        const rb = Math.round(rightBars);
        const out = new Array(n).fill(NaN);
        for (let i = lb; i < n - rb; i++) {
          const val = source[i];
          let isPivot = true;
          for (let j = i - lb; j < i; j++) {
            if (source[j] >= val) { isPivot = false; break; }
          }
          if (isPivot) {
            for (let j = i + 1; j <= i + rb; j++) {
              if (source[j] >= val) { isPivot = false; break; }
            }
          }
          if (isPivot) out[i + rb] = val; // Pivot confirmed rb bars later
        }
        return out;
      }
      case "pivotlow": {
        // ta.pivotlow(source, leftbars, rightbars) — NaN except at pivot lows
        const source = resolveSeriesArg(args[0]);
        const leftBars = resolveNumArg(args[1]) || 5;
        const rightBars = resolveNumArg(args[2]) || 5;
        if (!source) return null;
        const lb = Math.round(leftBars);
        const rb = Math.round(rightBars);
        const out = new Array(n).fill(NaN);
        for (let i = lb; i < n - rb; i++) {
          const val = source[i];
          let isPivot = true;
          for (let j = i - lb; j < i; j++) {
            if (source[j] <= val) { isPivot = false; break; }
          }
          if (isPivot) {
            for (let j = i + 1; j <= i + rb; j++) {
              if (source[j] <= val) { isPivot = false; break; }
            }
          }
          if (isPivot) out[i + rb] = val; // Pivot confirmed rb bars later
        }
        return out;
      }
      case "change": {
        // ta.change(source, length?) — difference from N bars ago (default 1)
        const source = resolveSeriesArg(args[0]);
        if (!source) return null;
        const period = args[1] != null ? resolveNumArg(args[1]) : 1;
        const len = Math.max(1, Math.round(period));
        const out = new Array(n).fill(0);
        for (let i = len; i < n; i++) {
          out[i] = source[i] - source[i - len];
        }
        return out;
      }
      default:
        return null;
    }
  }

  // Binary operations
  if (expr.k === "binop") {
    const left = evaluateExpr(expr.l, vars, candles);
    const right = evaluateExpr(expr.r, vars, candles);
    if (!left || !right) return null;
    const op = expr.op as string;

    switch (op) {
      case "+":
        return left.map((l, i) => l + right[i]);
      case "-":
        return left.map((l, i) => l - right[i]);
      case "*":
        return left.map((l, i) => l * right[i]);
      case "/":
        return left.map((l, i) => (right[i] === 0 ? 0 : l / right[i]));
      case "%":
        return left.map((l, i) => (right[i] === 0 ? 0 : l % right[i]));
      case ">":
        return left.map((l, i) => (l > right[i] ? 1.0 : 0.0));
      case "<":
        return left.map((l, i) => (l < right[i] ? 1.0 : 0.0));
      case ">=":
        return left.map((l, i) => (l >= right[i] ? 1.0 : 0.0));
      case "<=":
        return left.map((l, i) => (l <= right[i] ? 1.0 : 0.0));
      case "==":
        return left.map((l, i) => (l === right[i] ? 1.0 : 0.0));
      case "!=":
        return left.map((l, i) => (l !== right[i] ? 1.0 : 0.0));
      case "and": case "&&":
        return left.map((l, i) => (l !== 0 && right[i] !== 0 ? 1.0 : 0.0));
      case "or": case "||":
        return left.map((l, i) => (l !== 0 || right[i] !== 0 ? 1.0 : 0.0));
      default:
        return null;
    }
  }

  // Unary operations
  if (expr.k === "unop") {
    const operand = evaluateExpr(expr.operand, vars, candles);
    if (!operand) return null;
    const op = expr.op as string;
    switch (op) {
      case "-":
        return operand.map((v) => -v);
      case "not": case "!":
        return operand.map((v) => (v === 0 ? 1.0 : 0.0));
      default:
        return null;
    }
  }

  // Ternary / conditional — supports na branches (produces NaN per-bar)
  if (expr.k === "ternary") {
    const cond = evaluateExpr(expr.cond, vars, candles);
    if (!cond) return null;
    // Allow either branch to be null (na) — use NaN-filled array as fallback
    const nanArr = new Array(n).fill(NaN);
    const yes = evaluateExpr(expr.yes, vars, candles) ?? nanArr;
    const no = evaluateExpr(expr.no, vars, candles) ?? nanArr;
    return cond.map((c, i) => (c !== 0 && !isNaN(c) ? yes[i] : no[i]));
  }

  // math.* namespace calls (e.g. { k: "call", ns: "math", fn: "max", args: [...] })
  if (expr.k === "call" && expr.ns === "math") {
    const fn = expr.fn as string;
    const args: any[] = expr.args ?? [];

    switch (fn) {
      case "abs": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.abs);
      }
      case "max": {
        const a = evaluateExpr(args[0], vars, candles);
        const b = evaluateExpr(args[1], vars, candles);
        if (!a || !b) return null;
        return a.map((v, i) => Math.max(v, b[i]));
      }
      case "min": {
        const a = evaluateExpr(args[0], vars, candles);
        const b = evaluateExpr(args[1], vars, candles);
        if (!a || !b) return null;
        return a.map((v, i) => Math.min(v, b[i]));
      }
      case "round": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.round);
      }
      case "floor": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.floor);
      }
      case "ceil": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.ceil);
      }
      case "sqrt": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map((v) => Math.sqrt(Math.abs(v)));
      }
      case "log": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map((v) => (v > 0 ? Math.log(v) : 0));
      }
      case "pow": {
        const base = evaluateExpr(args[0], vars, candles);
        const exp = evaluateExpr(args[1], vars, candles);
        if (!base || !exp) return null;
        return base.map((v, i) => Math.pow(v, exp[i]));
      }
      case "sign": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.sign);
      }
      default:
        return null;
    }
  }

  // Function call without namespace (math functions, nz, etc.)
  if (expr.k === "call" && !expr.ns) {
    const fn = expr.fn as string;
    const args: any[] = expr.args ?? [];

    switch (fn) {
      case "abs": case "math.abs": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.abs);
      }
      case "max": case "math.max": {
        const a = evaluateExpr(args[0], vars, candles);
        const b = evaluateExpr(args[1], vars, candles);
        if (!a || !b) return null;
        return a.map((v, i) => Math.max(v, b[i]));
      }
      case "min": case "math.min": {
        const a = evaluateExpr(args[0], vars, candles);
        const b = evaluateExpr(args[1], vars, candles);
        if (!a || !b) return null;
        return a.map((v, i) => Math.min(v, b[i]));
      }
      case "round": case "math.round": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.round);
      }
      case "floor": case "math.floor": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.floor);
      }
      case "ceil": case "math.ceil": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.ceil);
      }
      case "sign": case "math.sign": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map(Math.sign);
      }
      case "sqrt": case "math.sqrt": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map((v) => Math.sqrt(Math.abs(v)));
      }
      case "log": case "math.log": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        return source.map((v) => (v > 0 ? Math.log(v) : 0));
      }
      case "pow": case "math.pow": {
        const base = evaluateExpr(args[0], vars, candles);
        const exp = evaluateExpr(args[1], vars, candles);
        if (!base || !exp) return null;
        return base.map((v, i) => Math.pow(v, exp[i]));
      }
      // nz(value, replacement) — replace NaN with replacement (default 0)
      case "nz": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        const replacement = args[1] != null ? evaluateExpr(args[1], vars, candles) : null;
        if (replacement) {
          return source.map((v, i) => (isNaN(v) ? replacement[i] : v));
        }
        return source.map((v) => (isNaN(v) ? 0 : v));
      }
      // fixnan(value) — replace NaN with previous non-NaN value
      case "fixnan": {
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return null;
        const out = new Array(n).fill(0);
        let lastValid = 0;
        for (let i = 0; i < n; i++) {
          if (!isNaN(source[i])) lastValid = source[i];
          out[i] = lastValid;
        }
        return out;
      }
      // na(value) — returns 1 if NaN, 0 otherwise (boolean test)
      case "na": {
        if (args.length === 0) return new Array(n).fill(NaN);
        const source = evaluateExpr(args[0], vars, candles);
        if (!source) return new Array(n).fill(1.0);
        return source.map((v) => (isNaN(v) ? 1.0 : 0.0));
      }
      default:
        return null;
    }
  }

  // Unknown expression type
  return null;
}

// ─── Color resolution ───────────────────────────────────────────────────────

function resolveColor(color: DynamicColor): string {
  if (!color) return "#2196F3";
  if (color.kind === "static") return color.value;
  // For conditional colors, default to trueColor (we can't evaluate
  // per-bar conditions at the series level for a single color string)
  if (color.kind === "conditional") return color.trueColor;
  return "#2196F3";
}

/**
 * Resolve a DynamicColor per-bar, returning an array of color strings.
 * Falls back to resolveColor() for static colors.
 */
function resolveColorPerBar(
  color: DynamicColor,
  vars: Map<string, number[]>,
  candles: Candle[],
): string[] {
  if (!color) return new Array(candles.length).fill("#2196F3");
  if (color.kind === "static") return new Array(candles.length).fill(color.value);
  if (color.kind === "conditional") {
    const cond = evaluateExpr(color.condition, vars, candles);
    if (!cond) return new Array(candles.length).fill(color.trueColor);
    return cond.map((c) => (c !== 0 ? color.trueColor : color.falseColor));
  }
  return new Array(candles.length).fill("#2196F3");
}

// ─── Marker shape / position mapping ────────────────────────────────────────

function mapMarkerShape(style: string): "arrowUp" | "arrowDown" | "circle" | "square" {
  switch (style) {
    case "triangleup": case "arrowup": case "arrow_up":
      return "arrowUp";
    case "triangledown": case "arrowdown": case "arrow_down":
      return "arrowDown";
    case "circle": case "dot":
      return "circle";
    case "square": case "diamond": case "cross": case "xcross":
      return "square";
    default:
      return "circle";
  }
}

function mapMarkerPosition(location: string): "aboveBar" | "belowBar" {
  switch (location) {
    case "abovebar": case "above": case "top":
      return "aboveBar";
    case "belowbar": case "below": case "bottom":
      return "belowBar";
    default:
      return "belowBar";
  }
}

// ─── The hook ───────────────────────────────────────────────────────────────

export function useIndicatorVisuals(
  candles: Candle[],
  config: VisualConfig | null,
  ast?: ParsedPine | null,
): RenderedVisuals {
  return useMemo(() => {
    if (!config || !candles || candles.length === 0) return EMPTY_VISUALS;

    const n = candles.length;

    // If we have a full AST, use the bar-by-bar runtime for accurate computation
    let vars: Map<string, number[]>;
    if (ast) {
      try {
        vars = executeRuntime(ast, candles).history;
      } catch {
        // Runtime failed — fall back to basic variable map
        vars = new Map<string, number[]>();
      }
    } else {
      vars = new Map<string, number[]>();
    }

    // Ensure base variables exist (runtime may have set them, but add if missing)
    if (!vars.has("close")) vars.set("close", candles.map((c) => c.close));
    if (!vars.has("open")) vars.set("open", candles.map((c) => c.open));
    if (!vars.has("high")) vars.set("high", candles.map((c) => c.high));
    if (!vars.has("low")) vars.set("low", candles.map((c) => c.low));
    if (!vars.has("volume")) vars.set("volume", candles.map((c) => c.volume));
    if (!vars.has("hl2")) vars.set("hl2", candles.map((c) => (c.high + c.low) / 2));
    if (!vars.has("hlc3")) vars.set("hlc3", candles.map((c) => (c.high + c.low + c.close) / 3));
    if (!vars.has("ohlc4")) vars.set("ohlc4", candles.map((c) => (c.open + c.high + c.low + c.close) / 4));

    // ── Compute plots ─────────────────────────────────────────────────────
    const renderedPlots: RenderedPlot[] = [];
    const plotDataById = new Map<string, Array<{ time: number; value: number }>>();

    for (const plot of config.plots) {
      const series = evaluateExpr(plot.sourceExpr, vars, candles);
      if (!series) continue;

      // Store the computed series in vars so later plots can reference it
      vars.set(plot.id, series);

      const data: Array<{ time: number; value: number }> = [];
      for (let i = 0; i < n; i++) {
        // Skip NaN values (from na / conditional branches) and warmup zeros
        if (isNaN(series[i])) continue;
        if (series[i] !== 0 || i === 0) {
          data.push({ time: candles[i].timestamp, value: series[i] });
        }
      }

      plotDataById.set(plot.id, data);

      renderedPlots.push({
        id: plot.id,
        title: plot.title,
        data,
        color: resolveColor(plot.color),
        lineWidth: plot.lineWidth,
        lineStyle: plot.lineStyle,
        visible: plot.visible !== false, // default to true if not set
      });
    }

    // ── Compute fills ─────────────────────────────────────────────────────
    const renderedFills: RenderedFill[] = [];

    for (const fill of config.fills) {
      const upper = plotDataById.get(fill.plot1Id);
      const lower = plotDataById.get(fill.plot2Id);
      if (!upper || !lower) continue;

      renderedFills.push({
        upperData: upper,
        lowerData: lower,
        color: resolveColor(fill.color),
        opacity: fill.opacity,
      });
    }

    // ── Compute markers ───────────────────────────────────────────────────
    const renderedMarkers: RenderedMarker[] = [];

    for (const marker of config.markers) {
      // Skip markers with literal true/false conditions (dynamic label.new inside if blocks)
      // These are created conditionally at runtime, not per-bar
      if (marker.conditionExpr?.k === "bool") continue;
      if (marker.conditionExpr?.k === "num" && marker.conditionExpr.v === 1) continue;

      const condSeries = evaluateExpr(marker.conditionExpr, vars, candles);
      if (!condSeries) continue;

      const colors = resolveColorPerBar(marker.color, vars, candles);

      for (let i = 0; i < n; i++) {
        if (condSeries[i] && condSeries[i] !== 0 && !isNaN(condSeries[i])) {
          renderedMarkers.push({
            time: candles[i].timestamp,
            position: mapMarkerPosition(marker.location),
            color: colors[i],
            shape: mapMarkerShape(marker.style),
            text: marker.text,
            size: marker.size,
          });
        }
      }
    }

    // Cap markers to prevent chart overload
    if (renderedMarkers.length > 100) {
      renderedMarkers.splice(100);
    }

    // Keep markers chronological for deterministic rendering.
    renderedMarkers.sort((a, b) => a.time - b.time);

    // ── Hlines — pass through ─────────────────────────────────────────────
    const renderedHlines: RenderedHLine[] = config.hlines.map((h) => ({
      price: h.price,
      color: h.color,
      lineWidth: h.lineWidth,
      lineStyle: h.lineStyle,
      title: h.title,
    }));

    return {
      plots: renderedPlots,
      fills: renderedFills,
      markers: renderedMarkers,
      hlines: renderedHlines,
    };
  }, [candles, config]);
}
