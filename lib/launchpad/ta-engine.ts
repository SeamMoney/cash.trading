/**
 * TA Engine — Comprehensive Technical Analysis Library
 *
 * All functions operate on arrays of Candle objects and return series arrays
 * (one value per candle, 0/NaN for warmup bars).
 *
 * Used by:
 *   - keeper.ts backtest engine (multi-type indicator simulation)
 *   - backtest API route
 *   - Move transpiler (determines params for on-chain deployment)
 */

import type { Candle } from "./types";

// ─── Source Series Extraction ────────────────────────────────────────────────

export type PriceSource = "close" | "open" | "high" | "low" | "volume" | "hl2" | "hlc3" | "ohlc4" | "hlcc4";

export function extractSource(candles: Candle[], src: PriceSource = "close"): number[] {
  return candles.map(c => {
    switch (src) {
      case "open":   return c.open;
      case "high":   return c.high;
      case "low":    return c.low;
      case "volume": return c.volume;
      case "hl2":    return (c.high + c.low) / 2;
      case "hlc3":   return (c.high + c.low + c.close) / 3;
      case "ohlc4":  return (c.open + c.high + c.low + c.close) / 4;
      case "hlcc4":  return (c.high + c.low + c.close + c.close) / 4;
      default:       return c.close;
    }
  });
}

// ─── Moving Averages ─────────────────────────────────────────────────────────

export function sma(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  for (let i = period - 1; i < series.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += series[j];
    out[i] = sum / period;
  }
  return out;
}

export function ema(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  const k = 2 / (period + 1);
  let prevEma = 0;
  let initialized = false;
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) { out[i] = 0; continue; }
    if (!initialized) {
      // Seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += series[j];
      prevEma = sum / period;
      initialized = true;
    } else {
      prevEma = (series[i] - prevEma) * k + prevEma;
    }
    out[i] = prevEma;
  }
  return out;
}

/** Wilder's Smoothed Moving Average (1/period multiplier instead of 2/(period+1)) */
export function wilderSma(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  let prevEma = 0;
  let initialized = false;
  for (let i = 0; i < series.length; i++) {
    if (i < period - 1) { out[i] = 0; continue; }
    if (!initialized) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += series[j];
      prevEma = sum / period;
      initialized = true;
    } else {
      prevEma = (series[i] + prevEma * (period - 1)) / period;
    }
    out[i] = prevEma;
  }
  return out;
}

/** Weighted Moving Average (linearly weighted, newer bars get higher weight) */
export function wma(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < series.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += series[i - j] * (period - j);
    }
    out[i] = sum / denom;
  }
  return out;
}

/** Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) — reduces lag */
export function hma(series: number[], period: number): number[] {
  const half = Math.floor(period / 2);
  const sqrtP = Math.floor(Math.sqrt(period));
  const wmaHalf = wma(series, half);
  const wmaFull = wma(series, period);
  const diff = wmaHalf.map((h, i) => 2 * h - wmaFull[i]);
  return wma(diff, sqrtP);
}

/** Double Exponential Moving Average: 2*EMA - EMA(EMA) — faster response */
export function dema(series: number[], period: number): number[] {
  const ema1 = ema(series, period);
  const ema2 = ema(ema1, period);
  return ema1.map((e1, i) => 2 * e1 - ema2[i]);
}

/** Triple Exponential Moving Average: 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)) */
export function tema(series: number[], period: number): number[] {
  const ema1 = ema(series, period);
  const ema2 = ema(ema1, period);
  const ema3 = ema(ema2, period);
  return ema1.map((e1, i) => 3 * e1 - 3 * ema2[i] + ema3[i]);
}

// ─── Oscillators ─────────────────────────────────────────────────────────────

/** RSI using Wilder's smoothing method */
export function rsi(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(50);
  let avgGain = 0, avgLoss = 0;
  let initialized = false;

  for (let i = 1; i < series.length; i++) {
    const delta = series[i] - series[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;

    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i === period) initialized = true;
    } else if (initialized) {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (initialized || i === period) {
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/** MACD: returns { macdLine, signalLine, histogram } */
export function macd(
  series: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const emaFast = ema(series, fastPeriod);
  const emaSlow = ema(series, slowPeriod);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((m, i) => m - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

/** Stochastic Oscillator: returns { k, d } */
export function stoch(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3,
  smoothK = 3,
): { k: number[]; d: number[] } {
  const n = candles.length;
  const rawK: number[] = new Array(n).fill(50);

  for (let i = kPeriod - 1; i < n; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest  = Math.min(lowest, candles[j].low);
    }
    rawK[i] = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
  }

  const closes = candles.map(c => c.close);
  const kSmoothed = smoothK > 1 ? sma(rawK, smoothK) : rawK;
  const d = sma(kSmoothed, dPeriod);
  return { k: kSmoothed, d };
}

/** Stochastic RSI: Stochastic applied to RSI values */
export function stochRsi(
  series: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  smoothK = 3,
  smoothD = 3,
): { k: number[]; d: number[] } {
  const rsiSeries = rsi(series, rsiPeriod);
  const n = rsiSeries.length;
  const rawK: number[] = new Array(n).fill(50);

  for (let i = stochPeriod - 1; i < n; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsiSeries[j] > 0) {
        highest = Math.max(highest, rsiSeries[j]);
        lowest  = Math.min(lowest, rsiSeries[j]);
      }
    }
    rawK[i] = highest === lowest ? 50 : ((rsiSeries[i] - lowest) / (highest - lowest)) * 100;
  }

  const kSmoothed = smoothK > 1 ? sma(rawK, smoothK) : rawK;
  const d = sma(kSmoothed, smoothD);
  return { k: kSmoothed, d };
}

/** Commodity Channel Index */
export function cci(candles: Candle[], period = 20): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  const typical = candles.map(c => (c.high + c.low + c.close) / 3);

  for (let i = period - 1; i < n; i++) {
    let sumTP = 0;
    for (let j = i - period + 1; j <= i; j++) sumTP += typical[j];
    const meanTP = sumTP / period;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(typical[j] - meanTP);
    meanDev /= period;
    out[i] = meanDev === 0 ? 0 : (typical[i] - meanTP) / (0.015 * meanDev);
  }
  return out;
}

/** Williams %R (returns -100 to 0, overbought near 0, oversold near -100) */
export function williamsR(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(-50);

  for (let i = period - 1; i < n; i++) {
    let highest = -Infinity, lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest  = Math.min(lowest, candles[j].low);
    }
    out[i] = highest === lowest ? -50 : ((highest - candles[i].close) / (highest - lowest)) * -100;
  }
  return out;
}

// ─── Volatility ──────────────────────────────────────────────────────────────

/** Average True Range */
export function atr(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const tr: number[] = new Array(n).fill(0);

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
    );
  }
  return wilderSma(tr, period);
}

/** Bollinger Bands: returns { upper, mid, lower } */
export function bollingerBands(
  series: number[],
  period = 20,
  multiplier = 2,
): { upper: number[]; mid: number[]; lower: number[] } {
  const mid = sma(series, period);
  const upper: number[] = new Array(series.length).fill(0);
  const lower: number[] = new Array(series.length).fill(0);

  for (let i = period - 1; i < series.length; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (series[j] - mid[i]) ** 2;
    }
    const stdDev = Math.sqrt(variance / period);
    upper[i] = mid[i] + multiplier * stdDev;
    lower[i] = mid[i] - multiplier * stdDev;
  }
  return { upper, mid, lower };
}

/** Keltner Channel (ATR-based envelope) */
export function keltnerChannel(
  candles: Candle[],
  emaPeriod = 20,
  atrPeriod = 10,
  multiplier = 1.5,
): { upper: number[]; mid: number[]; lower: number[] } {
  const closes = candles.map(c => c.close);
  const mid = ema(closes, emaPeriod);
  const atrSeries = atr(candles, atrPeriod);
  const upper = mid.map((m, i) => m + multiplier * atrSeries[i]);
  const lower = mid.map((m, i) => m - multiplier * atrSeries[i]);
  return { upper, mid, lower };
}

/** Donchian Channel (highest high / lowest low over N periods) */
export function donchianChannel(
  candles: Candle[],
  period = 20,
): { upper: number[]; mid: number[]; lower: number[] } {
  const n = candles.length;
  const upper: number[] = new Array(n).fill(0);
  const lower: number[] = new Array(n).fill(0);

  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    upper[i] = hi;
    lower[i] = lo;
  }
  const mid = upper.map((u, i) => (u + lower[i]) / 2);
  return { upper, mid, lower };
}

// ─── Volume / Price-Volume ────────────────────────────────────────────────────

/** On-Balance Volume */
export function obv(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  out[0] = candles[0].volume;
  for (let i = 1; i < candles.length; i++) {
    const dir = candles[i].close > candles[i - 1].close ? 1
              : candles[i].close < candles[i - 1].close ? -1 : 0;
    out[i] = out[i - 1] + dir * candles[i].volume;
  }
  return out;
}

/** Money Flow Index (volume-weighted RSI) */
export function mfi(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(50);
  const typical = candles.map(c => (c.high + c.low + c.close) / 3);
  const rawMF = typical.map((tp, i) => tp * candles[i].volume);

  for (let i = period; i < n; i++) {
    let posFlow = 0, negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typical[j] > typical[j - 1]) posFlow += rawMF[j];
      else negFlow += rawMF[j];
    }
    out[i] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  }
  return out;
}

/** VWAP — Volume Weighted Average Price (daily, resets each session) */
export function vwap(candles: Candle[]): number[] {
  const out: number[] = [];
  let cumTP = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTP  += tp * c.volume;
    cumVol += c.volume;
    out.push(cumVol === 0 ? tp : cumTP / cumVol);
  }
  return out;
}

// ─── Trend ───────────────────────────────────────────────────────────────────

/** Supertrend — ATR-based trailing stop trend indicator
 *  Returns { direction (1=up, -1=down), supertrend } */
export function supertrend(
  candles: Candle[],
  period = 10,
  multiplier = 3,
): { direction: number[]; line: number[] } {
  const n = candles.length;
  const atrSeries = atr(candles, period);
  const direction: number[] = new Array(n).fill(1);
  const line: number[] = new Array(n).fill(0);

  let upperBand = 0, lowerBand = 0;
  let prevUpperBand = 0, prevLowerBand = 0;
  let prevDir = 1;

  for (let i = 1; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const atrVal = atrSeries[i];
    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;

    upperBand = (basicUpper < prevUpperBand || candles[i - 1].close > prevUpperBand) ? basicUpper : prevUpperBand;
    lowerBand = (basicLower > prevLowerBand || candles[i - 1].close < prevLowerBand) ? basicLower : prevLowerBand;

    if (candles[i].close > upperBand) {
      direction[i] = 1;
    } else if (candles[i].close < lowerBand) {
      direction[i] = -1;
    } else {
      direction[i] = prevDir;
    }

    line[i] = direction[i] === 1 ? lowerBand : upperBand;
    prevUpperBand = upperBand;
    prevLowerBand = lowerBand;
    prevDir = direction[i];
  }

  return { direction, line };
}

// ─── Signal Detection ─────────────────────────────────────────────────────────

/** Returns true at index i if series a crosses above series b */
export function crossover(a: number[], b: number[], i: number): boolean {
  if (i < 1) return false;
  return a[i - 1] <= b[i - 1] && a[i] > b[i];
}

/** Returns true at index i if series a crosses below series b */
export function crossunder(a: number[], b: number[], i: number): boolean {
  if (i < 1) return false;
  return a[i - 1] >= b[i - 1] && a[i] < b[i];
}

/** Returns array of crossover signals (+1=crossover, -1=crossunder, 0=none) */
export function crossSignals(a: number[], b: number[]): number[] {
  return a.map((_, i) => {
    if (crossover(a, b, i))  return  1;
    if (crossunder(a, b, i)) return -1;
    return 0;
  });
}

// ─── Candle Helpers ──────────────────────────────────────────────────────────

export function highest(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  for (let i = period - 1; i < series.length; i++) {
    let hi = -Infinity;
    for (let j = i - period + 1; j <= i; j++) hi = Math.max(hi, series[j]);
    out[i] = hi;
  }
  return out;
}

export function lowest(series: number[], period: number): number[] {
  const out: number[] = new Array(series.length).fill(0);
  for (let i = period - 1; i < series.length; i++) {
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) lo = Math.min(lo, series[j]);
    out[i] = lo;
  }
  return out;
}

// ─── Multi-Type Signal Generator ─────────────────────────────────────────────
// Used by the backtest engine to generate signals for any indicator type

export type IndicatorSignal = 0 | 1 | 2; // NEUTRAL, BUY, SELL

export interface MultiSignalConfig {
  type: 0 | 1 | 2 | 3 | 4; // matches Move indicator types
  shortPeriod: number;
  longPeriod: number;
  thirdPeriod: number;
}

export function generateSignals(candles: Candle[], cfg: MultiSignalConfig): IndicatorSignal[] {
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const out: IndicatorSignal[] = new Array(n).fill(0) as IndicatorSignal[];

  switch (cfg.type) {
    case 0: { // SMA Crossover
      const fast = sma(closes, cfg.shortPeriod);
      const slow = sma(closes, cfg.longPeriod);
      let inLong = false;
      for (let i = cfg.longPeriod; i < n; i++) {
        if (crossover(fast, slow, i)) { out[i] = 1; inLong = true; }
        else if (crossunder(fast, slow, i)) { out[i] = 2; inLong = false; }
        else out[i] = inLong ? 1 : 0;
      }
      break;
    }
    case 1: { // EMA Crossover
      const fast = ema(closes, cfg.shortPeriod);
      const slow = ema(closes, cfg.longPeriod);
      let inLong = false;
      for (let i = cfg.longPeriod; i < n; i++) {
        if (crossover(fast, slow, i)) { out[i] = 1; inLong = true; }
        else if (crossunder(fast, slow, i)) { out[i] = 2; inLong = false; }
        else out[i] = inLong ? 1 : 0;
      }
      break;
    }
    case 2: { // RSI
      const rsiSeries = rsi(closes, cfg.shortPeriod);
      let inLong = false;
      const ob = 70, os = 30;
      for (let i = cfg.shortPeriod + 1; i < n; i++) {
        if (!inLong && rsiSeries[i] < os) { out[i] = 1; inLong = true; }
        else if (inLong && rsiSeries[i] > ob) { out[i] = 2; inLong = false; }
        else out[i] = inLong ? 1 : 0;
      }
      break;
    }
    case 3: { // MACD
      const { macdLine, signalLine } = macd(closes, cfg.shortPeriod, cfg.longPeriod, cfg.thirdPeriod);
      let inLong = false;
      const warmup = cfg.longPeriod + cfg.thirdPeriod;
      for (let i = warmup; i < n; i++) {
        if (!inLong && crossover(macdLine, signalLine, i)) { out[i] = 1; inLong = true; }
        else if (inLong && crossunder(macdLine, signalLine, i)) { out[i] = 2; inLong = false; }
        else out[i] = inLong ? 1 : 0;
      }
      break;
    }
    case 4: { // Bollinger Bands (mean reversion)
      const { upper, lower } = bollingerBands(closes, cfg.shortPeriod, cfg.thirdPeriod / 10 || 2);
      let inLong = false;
      for (let i = cfg.shortPeriod; i < n; i++) {
        if (!inLong && closes[i] < lower[i] && lower[i] > 0) { out[i] = 1; inLong = true; }
        else if (inLong && closes[i] > upper[i] && upper[i] > 0) { out[i] = 2; inLong = false; }
        else out[i] = inLong ? 1 : 0;
      }
      break;
    }
  }
  return out;
}
