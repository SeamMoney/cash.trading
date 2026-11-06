import type { Bar, Evaluation, Node, OrderIntent, ProgramIR } from "./ir";
import { pineModulo, pineRound, pineRoundForComparison } from "./numeric";
import { copyProgramIR, validateProgramIR, validateRuntimeData } from "./validate-ir";

export interface RuntimeSnapshot { configHash: string; bars: number; lastTime: number | null; data: Array<number | null> }
export class PineIntegerRangeError extends RangeError {
  readonly code = "INTEGER_RANGE";
  constructor() {
    super("Pine integer is outside the exact -9007199254740991 through 9007199254740991 range");
    this.name = "PineIntegerRangeError";
  }
}
const NA = Number.NaN;
const finite = (n: number) => Number.isFinite(n) ? n : NA;
const truth = (n: number) => Number.isFinite(n) && n !== 0;

/** Reference evaluator for the emitted graph; it is not an independent TradingView oracle. */
export function createPineRuntime(program: ProgramIR, snapshot?: RuntimeSnapshot) {
  validateProgramIR(program);
  const ir = copyProgramIR(program);
  if (snapshot !== undefined && (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.data))) throw new Error("Invalid Pine runtime snapshot");
  let bars = snapshot?.bars ?? 0;
  let lastTime = snapshot?.lastTime ?? null;
  if (snapshot && (snapshot.configHash !== ir.configHash || snapshot.data.length !== ir.stateCells || !Number.isSafeInteger(snapshot.bars) || snapshot.bars < 0)) throw new Error("Snapshot does not match the compiled program");
  if (snapshot) for (const value of snapshot.data) if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid Pine runtime snapshot value");
  let data = snapshot ? snapshot.data.map(v => v === null ? NA : v) : Array<number>(ir.stateCells).fill(NA);
  if (snapshot && (bars === 0 ? snapshot.lastTime !== null : !Number.isSafeInteger(lastTime) || lastTime === null || lastTime < 0)) throw new Error("Snapshot timestamp does not match its bar count");
  validateRuntimeData(ir, bars, data);

  const push = (bar: Bar): Evaluation => {
    if (!bar || ![bar.open, bar.high, bar.low, bar.close, bar.volume, bar.time].every(Number.isFinite)) throw new Error("Every candle field must be finite");
    if (!Number.isSafeInteger(bar.time) || bar.time < 0 || (lastTime !== null && bar.time <= lastTime)) throw new Error("Candle times must be increasing, nonnegative integer milliseconds");
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.high < bar.low || bar.volume < 0) throw new Error("Invalid OHLCV candle");
    if (!Number.isSafeInteger(bars + 1)) throw new Error("Bar counter overflow");
    // Speculative state means a late invalid order cannot partially advance the engine.
    const next = data.slice();
    const values: number[] = [];
    const history = (id: number, offset: number): number => {
      if (offset === 0) return values[id];
      const layout = ir.layouts[id];
      const missing = ir.nodes[id].type === "bool" && ir.pineVersion >= 6 ? 0 : NA;
      if (!layout || offset > layout.historyLength || bars < offset) return missing;
      const v = data[layout.historyOffset + ((bars - offset) % layout.historyLength)];
      return Number.isNaN(v) ? missing : v;
    };
    function windowSamples(i: number, n: Node): number[] | null {
      const layout = ir.layouts[i], base = layout.auxOffset;
      let count = Number.isFinite(next[base]) ? next[base] : 0;
      let head = Number.isFinite(next[base + 1]) ? next[base + 1] : 0;
      const src = values[n.a];
      if (Number.isFinite(src)) {
        next[base + 2 + head] = src;
        head = (head + 1) % n.period;
        count = Math.min(count + 1, n.period);
      }
      next[base] = count; next[base + 1] = head;
      if (count < n.period) return null;
      return Array.from({ length: n.period }, (_, k) => next[base + 2 + ((head + k) % n.period)]);
    }
    for (let i = 0; i < ir.nodes.length; i++) {
      const n = ir.nodes[i], a = values[n.a], b = values[n.b];
      let result = NA;
      switch (n.op) {
        case "const": result = n.value === null ? NA : n.value; break;
        case "open": case "high": case "low": case "close": case "volume": case "time": result = bar[n.op]; break;
        case "bar_index": result = bars; break;
        case "add": result = a + b; break;
        case "sub": result = a - b; break;
        case "mul": result = a * b; break;
        case "div": result = b === 0 ? NA : a / b; break;
        // Pine's remainder follows division rounded down, unlike JS's signed remainder.
        case "mod": result = pineModulo(a, b); break;
        case "neg": result = -a; break;
        case "abs": result = Math.abs(a); break;
        case "min": result = Math.min(a, b); break;
        case "max": result = Math.max(a, b); break;
        case "floor": result = Math.floor(a); break;
        case "ceil": result = Math.ceil(a); break;
        case "round": result = pineRound(a); break;
        case "sqrt": result = a < 0 ? NA : Math.sqrt(a); break;
        case "sign": result = Math.sign(a); break;
        case "checked_int": {
          if (!truth(b)) break;
          if (!Number.isNaN(a) && !Number.isSafeInteger(a)) throw new PineIntegerRangeError();
          result = a; break;
        }
        case "is_na": result = Number.isNaN(a) ? 1 : 0; break;
        case "nz": result = Number.isNaN(a) ? b : a; break;
        case "eq": case "ne": case "lt": case "le": case "gt": case "ge": {
          if (Number.isNaN(a) || Number.isNaN(b)) result = ir.pineVersion >= 6 ? 0 : NA;
          else {
            const x = pineRoundForComparison(a), y = pineRoundForComparison(b);
            result = +(n.op === "eq" ? x === y : n.op === "ne" ? x !== y : n.op === "lt" ? x < y : n.op === "le" ? x <= y : n.op === "gt" ? x > y : x >= y);
          }
          break;
        }
        case "and": result = a === 0 || b === 0 ? 0 : Number.isNaN(a) || Number.isNaN(b) ? (ir.pineVersion >= 6 ? 0 : NA) : 1; break;
        case "or": result = truth(a) || truth(b) ? 1 : Number.isNaN(a) || Number.isNaN(b) ? (ir.pineVersion >= 6 ? 0 : NA) : 0; break;
        case "not": result = Number.isNaN(a) && ir.pineVersion < 6 ? NA : +!truth(a); break;
        case "select": result = truth(a) ? b : values[n.c]; break;
        case "history": result = history(n.a, n.period); break;
        case "persistent": result = bars === 0 ? b : history(n.a, 1); break;
        case "ema": {
          const previous = history(i, 1);
          result = Number.isNaN(a) ? previous : Number.isNaN(previous) ? a : (2 / (n.period + 1)) * a + (1 - 2 / (n.period + 1)) * previous;
          break;
        }
        case "rma": {
          const previous = history(i, 1), base = ir.layouts[i].auxOffset;
          if (Number.isNaN(a)) result = previous;
          else if (!Number.isNaN(previous)) {
            result = a / n.period + (1 - 1 / n.period) * previous;
            if (!Number.isFinite(result)) throw new Error("RMA recurrence overflow");
          }
          else {
            const count = (Number.isFinite(next[base]) ? next[base] : 0) + 1;
            const sum = (Number.isFinite(next[base + 1]) ? next[base + 1] : 0) + a;
            if (!Number.isFinite(sum) || count > n.period) throw new Error("RMA seed accumulation overflow");
            next[base] = count; next[base + 1] = sum;
            result = count >= n.period ? sum / n.period : NA;
          }
          break;
        }
        case "sma": case "wma": case "stdev": case "variance": {
          const samples = windowSamples(i, n);
          if (!samples) break;
          const mean = samples.reduce((sum, x) => sum + x, 0) / n.period;
          if (n.op === "sma") result = mean;
          else if (n.op === "wma") result = samples.reduce((sum, x, k) => sum + x * (k + 1), 0) / (n.period * (n.period + 1) / 2);
          else {
            const variance = samples.reduce((sum, x) => sum + (x - mean) * (x - mean), 0) / n.period;
            result = n.op === "stdev" ? Math.sqrt(variance) : variance;
          }
          break;
        }
        case "highest": case "lowest": case "sum": {
          const samples = Array.from({ length: n.period }, (_, k) => k === 0 ? a : history(n.a, k));
          if (n.op === "sum") result = samples.some(Number.isNaN) ? NA : samples.reverse().reduce((s, v) => s + v, 0);
          else {
            const available = samples.filter(Number.isFinite);
            result = !available.length ? NA : n.op === "highest" ? Math.max(...available) : Math.min(...available);
          }
          break;
        }
        default: throw new Error(`Unknown runtime operation ${(n as Node).op}`);
      }
      values.push(finite(result));
    }
    const intents: OrderIntent[] = [];
    for (const order of ir.orders) {
      if (!truth(values[order.condition])) continue;
      const quantity = order.quantity === null ? null : values[order.quantity];
      if (order.kind === "entry" && (quantity === null || !Number.isFinite(quantity) || quantity <= 0)) throw new Error("Triggered entry quantity must be positive and finite");
      intents.push({ kind: order.kind, id: order.id, side: order.side, quantity, barIndex: bars, time: bar.time });
    }
    ir.layouts.forEach((l, i) => { if (l.historyLength) next[l.historyOffset + (bars % l.historyLength)] = values[i]; });
    data = next; bars++; lastTime = bar.time;
    const outputs: Evaluation["outputs"] = Object.create(null);
    for (const [name, id] of Object.entries(ir.outputs)) outputs[name] = Number.isNaN(values[id]) ? null : ir.nodes[id].type === "bool" ? truth(values[id]) : values[id];
    return { values: values.map(n => Number.isNaN(n) ? null : n), outputs, intents };
  };
  return {
    push,
    snapshot: (): RuntimeSnapshot => ({ configHash: ir.configHash, bars, lastTime, data: data.map(n => Number.isNaN(n) ? null : n) }),
    get bars() { return bars; },
  };
}

/** Useful for CLI parity traces. Throws before returning any successful result for invalid input. */
export function replayPine(ir: ProgramIR, bars: Bar[]): Evaluation[] {
  const runtime = createPineRuntime(ir);
  return bars.map(bar => runtime.push(bar));
}
