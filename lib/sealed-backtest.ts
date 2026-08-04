/**
 * Backtest a sealed vault — the strategy AND the rules the contract will enforce.
 *
 * ## Why not the existing launchpad backtester
 *
 * `lib/launchpad/keeper.ts` backtests one of five hardcoded indicator families
 * selected by an integer. Pointed at a sealed vault it would report the Sharpe of
 * a generic SMA crossover regardless of what the creator actually wrote — a number
 * that looks like evidence and is not. For a product whose entire claim is "the
 * trades come from THIS program", a backtest of a different program is worse than
 * no backtest.
 *
 * This runs `createStrategyRunner` — the same evaluator that produces the attested
 * signal on every live bar — and then simulates `execute_flip`'s sizing, leverage
 * cap, tick rounding, slippage band, taker fee, builder fee and funding accrual.
 * What comes out is an estimate of what this vault would have done, under the rules
 * it will actually trade under.
 *
 * ## What it still cannot tell you
 *
 * Estimates, not guarantees, and the gaps are worth naming:
 *   - Fills are assumed at the slippage-capped limit price. A real book can be
 *     thinner than that, and a flip that crosses a wide spread pays more.
 *   - Funding is applied at a flat assumed rate; real funding varies per hour and
 *     is exactly the cost that decides whether a slow strategy is viable.
 *   - Bars are close-only, matching the on-chain trace. Intrabar wicks that would
 *     have liquidated the position are invisible here.
 * The caller is expected to show these, not bury them.
 */
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { canonicalizePine } from "@/lib/sealed-presets";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import type { Candle } from "@/lib/launchpad/types";

/** Decibel's taker fee, in basis points of notional. */
const TAKER_FEE_BPS = 4.5;

export interface BacktestParams {
  pineScript: string;
  candles: Candle[];
  marketAddr: string;
  /** Fraction of NAV committed per entry, in bps. Mirrors the vault's `pct_bps`. */
  pctBps: number;
  /** Leverage ceiling ×100. Mirrors `max_leverage_x100`. */
  maxLeverageX100: number;
  /** Slippage band applied to the limit price, in bps. Mirrors `slippage_bps`. */
  slippageBps: number;
  /** Our builder fee on notional, in bps. */
  builderFeeBps: number;
  /** Starting equity in USDC. */
  initialCapital: number;
  /**
   * Assumed funding paid by the side you are on, in bps per 8h.
   * Positive means longs pay shorts, the usual state of a perp in contango.
   */
  fundingBps8h: number;
}

export interface BacktestFill {
  timestamp: number;
  price: number;
  isBuy: boolean;
  /** True when this fill closed an existing position rather than opening one. */
  reduceOnly: boolean;
  size: number;
  notional: number;
  fee: number;
  /** Realised PnL on the closed leg, USDC. Zero for pure opens. */
  realized: number;
}

export interface BacktestOutcome {
  ok: true;
  equityCurve: Array<{ t: number; v: number }>;
  fills: BacktestFill[];
  stats: {
    barsSimulated: number;
    warmupBars: number;
    finalEquity: number;
    returnPct: number;
    /** Buy-and-hold over the same window, for an honest baseline. */
    holdReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    trades: number;
    winRatePct: number;
    /** Costs broken out — usually the reason a promising strategy is not one. */
    feesPaid: number;
    fundingPaid: number;
    /** Fraction of bars spent holding a position, in percent. */
    timeInMarketPct: number;
    longFills: number;
    shortFills: number;
  };
  /** Assumptions the numbers rest on, for display next to them. */
  assumptions: string[];
}

export type BacktestResult = BacktestOutcome | { ok: false; error: string; detail?: string[] };

export function runSealedBacktest(p: BacktestParams): BacktestResult {
  const canonical = canonicalizePine(p.pineScript);
  const t = transpileV3(canonical, undefined, { target: "vault", marketAddr: p.marketAddr });
  if (t.errors?.length) {
    return { ok: false, error: "This script does not transpile, so it cannot be backtested.", detail: t.errors };
  }

  // A script with no entry conditions transpiles cleanly — the transpiler has
  // nothing to object to — and would then "backtest" as a flat line at the starting
  // balance, with a 0% drawdown and a 0% return. That reads as a safe strategy
  // rather than as no strategy, so refuse it by name.
  const { buyCondition, sellCondition } = t.ir.signalLogic;
  // A missing condition lowers to a literal — `lit_bool false` for "never fires".
  const inert = (e: { kind?: string; value?: unknown } | undefined) =>
    !e || e.kind === "lit_bool" || e.kind === "lit_u64";
  if (inert(buyCondition) && inert(sellCondition)) {
    return {
      ok: false,
      error: "This script has no entry conditions — there is nothing to backtest.",
      detail: ["Add a `strategy.entry(...)` guarded by a condition."],
    };
  }

  const runner = createStrategyRunner(t.ir);

  const candles = p.candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
  if (candles.length < runner.warmupBars + 20) {
    return {
      ok: false,
      error: `Not enough price history: ${candles.length} bars, need at least ${runner.warmupBars + 20}.`,
    };
  }

  const maxLeverage = p.maxLeverageX100 / 100;
  const feeBps = TAKER_FEE_BPS + p.builderFeeBps;

  let equity = p.initialCapital;
  /** Signed position size in base units. Positive long, negative short. */
  let position = 0;
  let entryPrice = 0;
  let peak = equity;
  let maxDrawdown = 0;
  let feesPaid = 0;
  let fundingPaid = 0;
  let wins = 0;
  let closes = 0;
  let barsInMarket = 0;

  const fills: BacktestFill[] = [];
  const equityCurve: Array<{ t: number; v: number }> = [];
  const barReturns: number[] = [];
  const barSeconds = estimateBarSeconds(candles);

  let prevEquity = equity;

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    const signal = runner.pushBar(bar.close);

    // The attestor signs a digest through the PREVIOUS bar and the order executes
    // on the current one, so a signal computed here can only act from the next bar.
    // Trading on the bar that produced the signal is the classic lookahead bug and
    // would flatter every result in this file.
    if (i <= runner.warmupBars) {
      equityCurve.push({ t: bar.timestamp, v: equity });
      continue;
    }

    // Funding accrues on whatever is open, before any flip this bar.
    if (position !== 0) {
      barsInMarket++;
      const notional = Math.abs(position) * bar.close;
      const rate = (p.fundingBps8h / 10_000) * (barSeconds / 28_800);
      // Longs pay when funding is positive; shorts receive it.
      const cost = notional * rate * (position > 0 ? 1 : -1);
      fundingPaid += cost;
      equity -= cost;
    }

    const want: -1 | 0 | 1 = signal === "buy" ? 1 : signal === "sell" ? -1 : 0;
    const have: -1 | 0 | 1 = position > 0 ? 1 : position < 0 ? -1 : 0;

    if (want !== 0 && want !== have) {
      // Close the opposite leg first, exactly as `execute_flip` does — the contract
      // never pyramids and never holds both sides.
      if (have !== 0) {
        const exitPx = withSlippage(bar.close, have > 0 ? "sell" : "buy", p.slippageBps);
        const size = Math.abs(position);
        const notional = size * exitPx;
        const fee = (notional * feeBps) / 10_000;
        const realized = (exitPx - entryPrice) * position - fee;
        equity += realized;
        feesPaid += fee;
        closes++;
        if (realized > 0) wins++;
        fills.push({
          timestamp: bar.timestamp, price: exitPx, isBuy: have < 0, reduceOnly: true,
          size, notional, fee, realized,
        });
        position = 0;
      }

      if (equity <= 0) break;

      const entryPx = withSlippage(bar.close, want > 0 ? "buy" : "sell", p.slippageBps);
      // Sizing mirrors `resolve_size`: pct of NAV, then capped by leverage.
      const budget = Math.min((equity * p.pctBps) / 10_000, equity * maxLeverage);
      const size = budget / entryPx;
      if (size > 0) {
        const notional = size * entryPx;
        const fee = (notional * feeBps) / 10_000;
        equity -= fee;
        feesPaid += fee;
        position = want * size;
        entryPrice = entryPx;
        fills.push({
          timestamp: bar.timestamp, price: entryPx, isBuy: want > 0, reduceOnly: false,
          size, notional, fee, realized: 0,
        });
      }
    }

    // Mark to market for the curve, without realising anything.
    const marked = equity + (position === 0 ? 0 : (bar.close - entryPrice) * position);
    peak = Math.max(peak, marked);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - marked) / peak);
    if (prevEquity > 0) barReturns.push(marked / prevEquity - 1);
    prevEquity = marked;
    equityCurve.push({ t: bar.timestamp, v: Number(marked.toFixed(2)) });
  }

  // Refuse rather than substitute: a backtest of a strategy the evaluator cannot run would be
  // a backtest of something else, presented as this one. Checked HERE because `unsupported` is
  // populated as ops execute — checking it before the loop (as this did) meant the set was
  // always empty and the refusal was dead code.
  if (runner.unsupported.size > 0) {
    return {
      ok: false,
      error: "The evaluator cannot run every operation in this script.",
      detail: [...runner.unsupported],
    };
  }

  // Close whatever is still open at the last price. A backtest that leaves a
  // position running reports unrealised luck as performance.
  const last = candles.at(-1)!;
  if (position !== 0) {
    const exitPx = withSlippage(last.close, position > 0 ? "sell" : "buy", p.slippageBps);
    const size = Math.abs(position);
    const notional = size * exitPx;
    const fee = (notional * feeBps) / 10_000;
    const realized = (exitPx - entryPrice) * position - fee;
    equity += realized;
    feesPaid += fee;
    closes++;
    if (realized > 0) wins++;
    fills.push({
      timestamp: last.timestamp, price: exitPx, isBuy: position < 0, reduceOnly: true,
      size, notional, fee, realized,
    });
    position = 0;
    equityCurve.push({ t: last.timestamp, v: Number(equity.toFixed(2)) });
  }

  const simulated = Math.max(1, candles.length - runner.warmupBars - 1);
  const firstTradedClose = candles[Math.min(runner.warmupBars + 1, candles.length - 1)].close;

  return {
    ok: true,
    equityCurve,
    fills,
    stats: {
      barsSimulated: simulated,
      warmupBars: runner.warmupBars,
      finalEquity: round2(equity),
      returnPct: round2((equity / p.initialCapital - 1) * 100),
      holdReturnPct: round2((last.close / firstTradedClose - 1) * 100),
      maxDrawdownPct: round2(maxDrawdown * 100),
      sharpe: round2(annualisedSharpe(barReturns, barSeconds)),
      trades: closes,
      winRatePct: closes > 0 ? Math.round((wins / closes) * 100) : 0,
      feesPaid: round2(feesPaid),
      fundingPaid: round2(fundingPaid),
      timeInMarketPct: Math.round((barsInMarket / simulated) * 100),
      longFills: fills.filter((f) => f.isBuy && !f.reduceOnly).length,
      shortFills: fills.filter((f) => !f.isBuy && !f.reduceOnly).length,
    },
    assumptions: [
      `Fills at the ${p.slippageBps} bps slippage cap — a thin book costs more.`,
      `${TAKER_FEE_BPS} bps Decibel taker fee + ${p.builderFeeBps} bps builder fee on every fill, both legs.`,
      `Funding at a flat ${p.fundingBps8h} bps per 8h on open notional; real funding varies hour to hour.`,
      "Close-only bars, matching the on-chain price trace — intrabar wicks are invisible.",
      "Signals act on the bar after the one that produced them, as the attestor does.",
    ],
  };
}

function withSlippage(px: number, side: "buy" | "sell", bps: number): number {
  return side === "buy" ? px * (1 + bps / 10_000) : px * (1 - bps / 10_000);
}

function round2(n: number): number {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function estimateBarSeconds(candles: Candle[]): number {
  if (candles.length < 3) return 3_600;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(candles.length, 50); i++) {
    const d = candles[i].timestamp - candles[i - 1].timestamp;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return 3_600;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

/** Sharpe on per-bar returns, scaled to a year. Zero when the sample is degenerate. */
function annualisedSharpe(returns: number[], barSeconds: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  const barsPerYear = (365 * 24 * 3_600) / barSeconds;
  return (mean / sd) * Math.sqrt(barsPerYear);
}
