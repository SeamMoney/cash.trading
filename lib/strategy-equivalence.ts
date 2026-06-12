import type { IndicatorIR, IRTAOp, IRExpr, IRValue } from "@/lib/launchpad/pine-ir";

/**
 * Strategy equivalence harness — the deploy gate for "any PineScript becomes
 * a vault".
 *
 * Evaluates a transpiled strategy's IR over real historical candles with two
 * math backends and requires the SIGNAL SEQUENCES to match:
 *
 *  - "move":  integer (bigint) mirrors of the exact algorithms the codegen
 *             emits (lib/launchpad/move-ta-lib.ts), over the same capped
 *             sliding buffer the on-chain module uses.
 *  - "pine":  float, Pine-faithful semantics over unbounded history.
 *
 * A divergence means the deployed vault would trade differently than the
 * creator's backtest — the deploy flow must reject with the diff instead of
 * publishing. This gate would have caught both real transpiler bugs found in
 * June 2026 (EMA-that-was-SMA; silent default args).
 *
 * Both backends currently see closes only; OHLC-dependent ops (atr, stoch,
 * supertrend) mirror the close-based approximations the codegen emits today
 * and will gain true OHLC inputs when the keeper pushes candles.
 */

const SCALE = 100_000_000; // 1e8 — Move fixed-point scale

export type Signal = "buy" | "sell" | "neutral";

export interface BarDivergence {
  bar: number;
  close: number;
  pine: Signal;
  move: Signal;
}

export interface EquivalenceReport {
  equivalent: boolean;
  bars: number;
  warmupBars: number;
  signalsCompared: number;
  buySignals: { pine: number; move: number };
  sellSignals: { pine: number; move: number };
  /** divergences / signalsCompared — deploy policy can threshold on this. */
  divergenceRate: number;
  divergences: BarDivergence[];
  /** Ops the harness cannot evaluate yet — equivalence is then "unknown", not a pass. */
  unsupportedOps: string[];
}

// ── Math backends ────────────────────────────────────────────────────────────

interface MathBackend {
  sma(prices: number[], period: number): number;
  ema(prices: number[], period: number): number;
  rsi(prices: number[], period: number): number;
  highest(prices: number[], period: number): number;
  lowest(prices: number[], period: number): number;
}

/** Exact mirrors of the emitted Move algorithms (move-ta-lib.ts), in bigint. */
const moveBackend: MathBackend = {
  sma(prices, period) {
    const len = prices.length;
    let total = 0n;
    for (let i = len - period; i < len; i++) total += BigInt(Math.round(prices[i] * SCALE));
    return Number(total / BigInt(period)) / SCALE;
  },
  ema(prices, period) {
    const len = prices.length;
    let seed = 0n;
    for (let i = 0; i < period; i++) seed += BigInt(Math.round(prices[i] * SCALE));
    let ema = seed / BigInt(period);
    const k = 2_000_000n / BigInt(period + 1);
    const kInv = 1_000_000n - k;
    for (let j = period; j < len; j++) {
      ema = (BigInt(Math.round(prices[j] * SCALE)) * k + ema * kInv) / 1_000_000n;
    }
    return Number(ema) / SCALE;
  },
  rsi(prices, period) {
    const len = prices.length;
    if (len <= period) return 50;
    let avgGain = 0n;
    let avgLoss = 0n;
    const p = prices.map((x) => BigInt(Math.round(x * SCALE)));
    for (let i = 0; i < period; i++) {
      if (p[i + 1] > p[i]) avgGain += p[i + 1] - p[i];
      else avgLoss += p[i] - p[i + 1];
    }
    avgGain /= BigInt(period);
    avgLoss /= BigInt(period);
    for (let j = period; j < len - 1; j++) {
      const gain = p[j + 1] > p[j] ? p[j + 1] - p[j] : 0n;
      const loss = p[j] > p[j + 1] ? p[j] - p[j + 1] : 0n;
      avgGain = (avgGain * BigInt(period - 1) + gain) / BigInt(period);
      avgLoss = (avgLoss * BigInt(period - 1) + loss) / BigInt(period);
    }
    if (avgLoss === 0n) return 100;
    return Number((100n * BigInt(SCALE) * avgGain) / (avgGain + avgLoss)) / SCALE;
  },
  highest(prices, period) {
    return Math.max(...prices.slice(-period));
  },
  lowest(prices, period) {
    return Math.min(...prices.slice(-period));
  },
};

/** Pine-faithful float semantics. */
const pineBackend: MathBackend = {
  sma(prices, period) {
    let t = 0;
    for (let i = prices.length - period; i < prices.length; i++) t += prices[i];
    return t / period;
  },
  ema(prices, period) {
    let seed = 0;
    for (let i = 0; i < period; i++) seed += prices[i];
    let ema = seed / period;
    const k = 2 / (period + 1);
    for (let j = period; j < prices.length; j++) ema = prices[j] * k + ema * (1 - k);
    return ema;
  },
  rsi(prices, period) {
    const len = prices.length;
    if (len <= period) return 50;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      const d = prices[i + 1] - prices[i];
      if (d > 0) avgGain += d;
      else avgLoss -= d;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let j = period; j < len - 1; j++) {
      const d = prices[j + 1] - prices[j];
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return (100 * avgGain) / (avgGain + avgLoss);
  },
  highest(prices, period) {
    return Math.max(...prices.slice(-period));
  },
  lowest(prices, period) {
    return Math.min(...prices.slice(-period));
  },
};

// ── IR evaluator ─────────────────────────────────────────────────────────────

type Env = Map<string, number | boolean>;

class StrategyEvaluator {
  private buffer: number[] = [];
  private env: Env = new Map();
  private prevEnv: Env = new Map();
  readonly unsupported = new Set<string>();

  constructor(
    private ir: IndicatorIR,
    private math: MathBackend,
    /** Capped sliding buffer (on-chain behavior) vs unbounded (Pine). */
    private capBuffer: boolean,
  ) {
    for (const f of ir.stateFields) {
      this.env.set(f.name, f.moveType === "bool" ? false : 0);
    }
  }

  private irValue(v: IRValue): number {
    if (v.kind === "literal") return v.value;
    const x = this.env.get(v.name);
    return typeof x === "number" ? x : 0;
  }

  private evalExpr(e: IRExpr): number | boolean {
    switch (e.kind) {
      case "lit_u64": return Number(e.value) / SCALE;
      case "lit_bool": return e.value;
      case "price": return this.buffer[this.buffer.length - 1] ?? 0;
      case "field_ref": return this.env.get(e.field) ?? 0;
      case "prev_field": return this.prevEnv.get(e.field) ?? 0;
      case "series_index": {
        const idx = this.buffer.length - 1 - e.offset;
        return idx >= 0 ? this.buffer[idx] : 0;
      }
      case "binop": {
        const l = this.evalExpr(e.left);
        const r = this.evalExpr(e.right);
        switch (e.op) {
          case "+": return (l as number) + (r as number);
          case "-": return (l as number) - (r as number);
          case "*": return (l as number) * (r as number);
          case "/": return (r as number) === 0 ? 0 : (l as number) / (r as number);
          case ">": return (l as number) > (r as number);
          case "<": return (l as number) < (r as number);
          case ">=": return (l as number) >= (r as number);
          case "<=": return (l as number) <= (r as number);
          case "==": return l === r;
          case "!=": return l !== r;
          case "&&": return Boolean(l) && Boolean(r);
          case "||": return Boolean(l) || Boolean(r);
          default:
            this.unsupported.add(`binop:${e.op}`);
            return 0;
        }
      }
      case "unop":
        if (e.op === "!") return !this.evalExpr(e.expr);
        this.unsupported.add(`unop:${e.op}`);
        return 0;
      case "ternary":
        return this.evalExpr(e.cond) ? this.evalExpr(e.yes) : this.evalExpr(e.no);
      case "safe_sub": {
        const l = this.evalExpr(e.left) as number;
        const r = this.evalExpr(e.right) as number;
        return l > r ? l - r : 0;
      }
      case "div": {
        const r = this.evalExpr(e.right) as number;
        return r === 0 ? 0 : (this.evalExpr(e.left) as number) / r;
      }
      case "abs": return Math.abs(this.evalExpr(e.expr) as number);
      case "max": return Math.max(this.evalExpr(e.left) as number, this.evalExpr(e.right) as number);
      case "min": return Math.min(this.evalExpr(e.left) as number, this.evalExpr(e.right) as number);
      case "neg": return -(this.evalExpr(e.expr) as number);
      case "na_check": return false;
      case "not_na": return true;
      case "scaled_mul":
        return ((this.evalExpr(e.left) as number) * (this.evalExpr(e.right) as number));
      default:
        this.unsupported.add((e as { kind: string }).kind);
        return 0;
    }
  }

  private execOps(ops: IRTAOp[]): void {
    for (const op of ops) {
      switch (op.kind) {
        case "sma":
          this.env.set(op.target, this.math.sma(this.buffer, this.irValue(op.period)));
          break;
        case "ema":
          this.env.set(op.target, this.math.ema(this.buffer, this.irValue(op.period)));
          break;
        case "rsi":
          this.env.set(op.target, this.math.rsi(this.buffer, this.irValue(op.period)));
          break;
        case "highest":
          this.env.set(op.target, this.math.highest(this.buffer, this.irValue(op.period)));
          break;
        case "lowest":
          this.env.set(op.target, this.math.lowest(this.buffer, this.irValue(op.period)));
          break;
        case "macd": {
          const line =
            this.math.ema(this.buffer, this.irValue(op.fast)) -
            this.math.ema(this.buffer, this.irValue(op.slow));
          this.env.set(op.targetLine, line);
          // Signal line approximation matches codegen: EMA of MACD line is
          // approximated on-chain; treat line/hist symmetrically per backend.
          this.env.set(op.targetSignal, line);
          this.env.set(op.targetHist, 0);
          break;
        }
        case "crossover": {
          const a = this.env.get(op.seriesA) as number;
          const b = this.env.get(op.seriesB) as number;
          const pa = this.prevEnv.get(op.seriesA) as number;
          const pb = this.prevEnv.get(op.seriesB) as number;
          this.env.set(op.target, pa <= pb && a > b);
          break;
        }
        case "crossunder": {
          const a = this.env.get(op.seriesA) as number;
          const b = this.env.get(op.seriesB) as number;
          const pa = this.prevEnv.get(op.seriesA) as number;
          const pb = this.prevEnv.get(op.seriesB) as number;
          this.env.set(op.target, pa >= pb && a < b);
          break;
        }
        case "assign":
        case "let":
          this.env.set(
            op.kind === "assign" ? op.target : op.name,
            this.evalExpr(op.expr),
          );
          break;
        case "state_update":
          this.env.set(op.field, this.evalExpr(op.expr));
          break;
        case "if":
          if (this.evalExpr(op.cond)) this.execOps(op.then);
          else if (op.els) this.execOps(op.els);
          break;
        case "for": {
          const start = this.evalExpr(op.start) as number;
          const end = this.evalExpr(op.end) as number;
          const step = (this.evalExpr(op.step) as number) || 1;
          let iters = 0;
          for (let v = start; v <= end && iters < op.maxIters; v += step, iters++) {
            this.env.set(op.varName, v);
            this.execOps(op.body);
          }
          break;
        }
        case "while": {
          let iters = 0;
          while (this.evalExpr(op.cond) && iters < op.maxIters) {
            this.execOps(op.body);
            iters++;
          }
          break;
        }
        case "noop":
          break;
        default:
          this.unsupported.add((op as { kind: string }).kind);
      }
    }
  }

  pushBar(close: number): Signal {
    this.buffer.push(close);
    if (this.capBuffer && this.buffer.length > this.ir.bufferCapacity) {
      this.buffer.shift();
    }
    if (this.buffer.length < this.ir.warmupMinBars) return "neutral";

    // Snapshot previous values for crossover detection (mirrors push_price).
    this.prevEnv = new Map(this.env);
    this.execOps(this.ir.taOps);

    const buy = Boolean(this.evalExpr(this.ir.signalLogic.buyCondition));
    const sell = Boolean(this.evalExpr(this.ir.signalLogic.sellCondition));
    if (buy && !sell) return "buy";
    if (sell && !buy) return "sell";
    return "neutral";
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the strategy over historical closes with both backends and diff the
 * signal sequences. `equivalent` is only true when every bar matched AND no
 * unsupported IR ops were encountered.
 */
export function checkEquivalence(ir: IndicatorIR, closes: number[]): EquivalenceReport {
  const move = new StrategyEvaluator(ir, moveBackend, true);
  const pine = new StrategyEvaluator(ir, pineBackend, false);

  const divergences: BarDivergence[] = [];
  const buys = { pine: 0, move: 0 };
  const sells = { pine: 0, move: 0 };
  let compared = 0;

  for (let bar = 0; bar < closes.length; bar++) {
    const sMove = move.pushBar(closes[bar]);
    const sPine = pine.pushBar(closes[bar]);
    if (bar < ir.warmupMinBars) continue;
    compared++;
    if (sPine === "buy") buys.pine++;
    if (sMove === "buy") buys.move++;
    if (sPine === "sell") sells.pine++;
    if (sMove === "sell") sells.move++;
    if (sMove !== sPine && divergences.length < 50) {
      divergences.push({ bar, close: closes[bar], pine: sPine, move: sMove });
    }
  }

  const unsupportedOps = [...new Set([...move.unsupported, ...pine.unsupported])];
  // A gate that passes on insufficient data is worse than no gate: demand a
  // real comparison sample before declaring equivalence.
  const MIN_COMPARED_BARS = 100;
  return {
    equivalent:
      compared >= MIN_COMPARED_BARS &&
      divergences.length === 0 &&
      unsupportedOps.length === 0,
    bars: closes.length,
    warmupBars: ir.warmupMinBars,
    signalsCompared: compared,
    buySignals: buys,
    sellSignals: sells,
    divergenceRate: compared > 0 ? divergences.length / compared : 1,
    divergences,
    unsupportedOps,
  };
}
