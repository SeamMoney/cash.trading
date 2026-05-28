/**
 * Keeper / Backtest Engine
 *
 * Runs Monte Carlo backtests for all supported indicator types using the
 * full TA engine (ta-engine.ts). Supports:
 *   type 0: SMA Crossover
 *   type 1: EMA Crossover
 *   type 2: RSI oversold/overbought
 *   type 3: MACD (fast/slow EMA crossover via MACD line vs signal)
 *   type 4: Bollinger Bands mean reversion
 */

import type { Candle, BacktestConfig, BacktestResult } from "./types";
import {
  sma, ema, rsi, macd, bollingerBands,
  crossover, crossunder, generateSignals,
  type MultiSignalConfig,
} from "./ta-engine";

// ─── Re-export legacy helpers ────────────────────────────────────────────────
// These are used by some API routes and components directly.

export function computeSMA(candles: Candle[], period: number): number[] {
  return sma(candles.map(c => c.close), period);
}

export function computeEMA(candles: Candle[], period: number): number[] {
  return ema(candles.map(c => c.close), period);
}

export function computeRSI(candles: Candle[], period: number): number[] {
  return rsi(candles.map(c => c.close), period);
}

export function computeMACD(candles: Candle[], fast: number, slow: number, sig: number) {
  const closes = candles.map(c => c.close);
  return macd(closes, fast, slow, sig);
}

export function detectCrossover(a: number[], b: number[], idx: number): boolean {
  return crossover(a, b, idx);
}

export function detectCrossunder(a: number[], b: number[], idx: number): boolean {
  return crossunder(a, b, idx);
}

// ─── Backtest Engine ─────────────────────────────────────────────────────────

export interface ExtendedBacktestConfig extends BacktestConfig {
  indicatorType?: number;   // 0=SMA, 1=EMA, 2=RSI, 3=MACD, 4=BB
}

export function runBacktest(config: ExtendedBacktestConfig): BacktestResult {
  const { candles, params, initialCapital, positionSizePct, indicatorType = 0 } = config;

  const minCandles = indicatorType === 3 ? 60 : 50;
  if (candles.length < minCandles) {
    return { sharpe: 0, returnBps: 0, maxDrawdownBps: 0, profitable: false, trades: 0, winRate: 0, equityCurve: [] };
  }

  const cfg: MultiSignalConfig = buildConfig(indicatorType, params);
  const signals = generateSignals(candles, cfg);
  const sizePct = Math.min(positionSizePct, 100) / 100;

  let capital = initialCapital;
  let position = 0;
  let entryPrice = 0;
  let peakCapital = initialCapital;
  let maxDrawdown = 0;
  let trades = 0;
  let wins = 0;
  const returns: number[] = [];
  const equityCurve: { t: number; v: number }[] = [];
  const equityStep = Math.max(1, Math.floor(candles.length / 60));

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const sig = signals[i];

    if (position === 0 && sig === 1) {
      position = 1; entryPrice = price; trades++;
    } else if (position === 1 && sig === 2) {
      const pnl = (price - entryPrice) / entryPrice;
      capital = Math.max(capital * (1 + pnl * sizePct), 1);
      returns.push(pnl);
      if (pnl > 0) wins++;
      position = 0;
    }

    if (capital > peakCapital) peakCapital = capital;
    const dd = (peakCapital - capital) / peakCapital;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (i % equityStep === 0) {
      equityCurve.push({ t: candles[i].timestamp, v: Math.round(capital * 100) / 100 });
    }
  }
  equityCurve.push({ t: candles[candles.length - 1].timestamp, v: Math.round(capital * 100) / 100 });

  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance   = returns.length > 1 ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1) : 1;
  const stdDev     = Math.sqrt(variance);

  // Downside deviation for Sortino ratio
  const downsideVars = returns.filter(r => r < 0).map(r => r ** 2);
  const downsideStd  = downsideVars.length > 0 ? Math.sqrt(downsideVars.reduce((a, b) => a + b, 0) / downsideVars.length) : 1;

  const sharpe  = stdDev > 0    ? (meanReturn / stdDev)     * Math.sqrt(252) : 0;
  const sortino = downsideStd > 0 ? (meanReturn / downsideStd) * Math.sqrt(252) : 0;
  const totalReturn = (capital - initialCapital) / initialCapital;

  return {
    sharpe:         Math.round(sharpe  * 1000),
    returnBps:      Math.round(totalReturn * 10000),
    maxDrawdownBps: Math.round(maxDrawdown * 10000),
    profitable:     capital > initialCapital,
    trades,
    winRate: trades > 0 ? wins / trades : 0,
    equityCurve,
    // Extended metrics (not in base BacktestResult type but available)
    ...(sortino > 0 ? { sortinoScaled: Math.round(sortino * 1000) } : {}),
  };
}

// ─── Config Builder ───────────────────────────────────────────────────────────

function buildConfig(type: number, params: number[]): MultiSignalConfig {
  switch (type) {
    case 0: return { type: 0, shortPeriod: params[0] || 10, longPeriod: params[1] || 30, thirdPeriod: 0 };
    case 1: return { type: 1, shortPeriod: params[0] || 12, longPeriod: params[1] || 26, thirdPeriod: 0 };
    case 2: return { type: 2, shortPeriod: params[0] || 14, longPeriod: params[1] || 14, thirdPeriod: 0 };
    case 3: return { type: 3, shortPeriod: params[0] || 12, longPeriod: params[1] || 26, thirdPeriod: params[2] || 9 };
    case 4: return { type: 4, shortPeriod: params[0] || 20, longPeriod: params[1] || 20, thirdPeriod: params[2] || 20 }; // thirdPeriod = mult * 10
    default: return { type: 0, shortPeriod: params[0] || 10, longPeriod: params[1] || 30, thirdPeriod: 0 };
  }
}

// ─── Monte Carlo ──────────────────────────────────────────────────────────────

export function runRandomizedBacktests(
  candles: Candle[],
  params: number[],
  numSims: number,
  startSeed: bigint,
  indicatorType = 0,
): BacktestResult[] {
  const results: BacktestResult[] = [];
  const shortBase = params[0] || defaultShort(indicatorType);
  const longBase  = params[1] || defaultLong(indicatorType);
  const thirdBase = params[2] || defaultThird(indicatorType);

  let lcg = Number(startSeed & 0x7FFFFFFFn);
  function rand() {
    lcg = (lcg * 1103515245 + 12345) & 0x7fffffff;
    return lcg / 0x7fffffff;
  }

  for (let i = 0; i < numSims; i++) {
    const variation = 0.6 + rand() * 0.8; // ±40% around nominal
    let shortVar: number, longVar: number, thirdVar: number;

    switch (indicatorType) {
      case 3: // MACD
        shortVar = Math.max(5, Math.round(shortBase * variation));
        longVar  = Math.max(shortVar + 5, Math.round(longBase * variation));
        thirdVar = Math.max(3, Math.round(thirdBase * variation));
        break;
      case 4: // BB — vary period and multiplier
        shortVar = Math.max(5, Math.round(shortBase * variation));
        longVar  = shortVar;
        thirdVar = Math.max(10, Math.min(30, Math.round(thirdBase * (0.7 + rand() * 0.6)))); // mult 1.0-3.0
        break;
      case 2: // RSI — vary period and thresholds
        shortVar = Math.max(5, Math.round(shortBase * variation));
        longVar  = shortVar;
        thirdVar = 0;
        break;
      default: // SMA/EMA crossover
        shortVar = Math.max(3, Math.round(shortBase * variation));
        longVar  = Math.max(shortVar + 5, Math.round(longBase * variation));
        thirdVar = 0;
    }

    results.push(runBacktest({
      candles,
      params: [shortVar, longVar, thirdVar],
      initialCapital: 10000,
      positionSizePct: 100,
      indicatorType,
    }));
  }
  return results;
}

function defaultShort(t: number) { return [10, 12, 14, 12, 20][t] ?? 10; }
function defaultLong(t: number)  { return [30, 26, 14, 26, 20][t] ?? 30; }
function defaultThird(t: number) { return [0, 0, 0, 9, 20][t] ?? 0; }

// ─── Block Bootstrap (kept for API compat, not recommended) ──────────────────

export function bootstrapShuffle(candles: Candle[], seed: bigint, blockSize = 20): Candle[] {
  const blocks: Candle[][] = [];
  for (let i = 0; i < candles.length; i += blockSize) {
    blocks.push(candles.slice(i, i + blockSize));
  }
  let s = Number(seed & 0x7FFFFFFFn);
  for (let i = blocks.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  return blocks.flat();
}
