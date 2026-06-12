"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { AccountAddress, createResourceAddress } from "@aptos-labs/ts-sdk";
import { cn } from "@/lib/utils";
import { transpile, type TranspileResult } from "@/lib/launchpad/transpiler";
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { DeployVaultRail } from "@/components/launchpad/DeployVaultRail";
import { PineVisualPreview } from "./PineVisualPreview";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="h-full min-h-[300px] bg-[#1e1e1e] animate-pulse" />
    ),
  }
);

const LAUNCHPAD_CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";

// Testnet Decibel perp markets the vault target can bind to (object addresses
// derived from GlobalPerpEngine + market-name seed; specs from the live API).
const VAULT_MARKETS = {
  "BTC/USD": {
    addr: "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a",
    lotSize: 10, minSize: 100000, szDecimalsPow: "100000000",
  },
  "ETH/USD": {
    addr: "0x0dd1772998bb9bbb1189ef7d680353f1b97adb947b178167b03ace95dd2fcf8e",
    lotSize: 10, minSize: 100000, szDecimalsPow: "10000000",
  },
  "APT/USD": {
    addr: "0x57ba43880ee443eebd5021af91d5a8156fb3e04247c97c30912e6501c187a428",
    lotSize: 10, minSize: 100000, szDecimalsPow: "10000",
  },
} as const;

// ─── Type name map ────────────────────────────────────────────────────────────

const TYPE_NAMES: Record<number, string> = {
  0: "SMA Crossover",
  1: "EMA Crossover",
  2: "RSI",
  3: "MACD",
  4: "Bollinger Bands",
  5: "Stochastic",
  6: "SuperTrend",
  7: "Donchian Channel",
  8: "KAMA",
  9: "ALMA",
  10: "T3",
  11: "Laguerre RSI",
};

// ─── Example Pine Scripts ─────────────────────────────────────────────────────

const EXAMPLES: Record<string, { label: string; script: string }> = {
  lorentzian: {
    label: "Lorentzian Classification",
    script: `//@version=5
// Lorentzian Classification — k-NN with Lorentzian distance metric
// Based on the Lorentzian Distance formula for non-Euclidean feature space
// Significantly outperforms traditional crossover methods in trending markets
strategy("Lorentzian Classification", overlay=true, max_bars_back=500)

// ── Inputs ────────────────────────────────────────────────────────────
neighborCount  = input.int(8,   "k Neighbors",      minval=3, maxval=20)
featurePeriod  = input.int(14,  "Feature Period",   minval=8, maxval=50)
filterPeriod   = input.int(200, "Trend Filter EMA", minval=50, maxval=500)
fast           = input.int(12,  "Fast EMA",         minval=2)
slow           = input.int(26,  "Slow EMA",         minval=5)

// ── Features ─────────────────────────────────────────────────────────
rsiFeature   = ta.rsi(close, featurePeriod)
wt1          = ta.ema(hlc3, featurePeriod)
wt2          = ta.sma(wt1,  featurePeriod)
wtOscillator = wt1 - wt2

// Lorentzian distance between current and historical feature vectors
lorentzDist(i) =>
    math.log(1 + math.abs(rsiFeature - rsiFeature[i])) +
    math.log(1 + math.abs(wtOscillator - wtOscillator[i]))

// k-NN vote accumulation
bullVotes = 0.0
bearVotes = 0.0
maxNeighbors = 50
for i = 1 to maxNeighbors
    d = lorentzDist(i)
    weight = 1.0 / (d + 1e-10)
    if close[i] > close[i+1]
        bullVotes += weight
    else
        bearVotes += weight

bullSignal = bullVotes / (bullVotes + bearVotes + 1e-10)

// ── Confirmation: EMA trend filter ───────────────────────────────────
fastEMA  = ta.ema(close, fast)
slowEMA  = ta.ema(close, slow)
trendEMA = ta.ema(close, filterPeriod)
inUpTrend = close > trendEMA

// ── Entry logic ───────────────────────────────────────────────────────
if bullSignal > 0.65 and ta.crossover(fastEMA, slowEMA) and inUpTrend
    strategy.entry("Long", strategy.long)

if bullSignal < 0.35 or ta.crossunder(fastEMA, slowEMA)
    strategy.close("Long")`,
  },

  waveTrend: {
    label: "WaveTrend Oscillator",
    script: `//@version=5
// WaveTrend Oscillator — LazyBear implementation with divergence detection
// Dual-smoothed oscillator that identifies market waves and exhaustion points
strategy("WaveTrend + Divergence", overlay=false)

// ── Inputs ────────────────────────────────────────────────────────────
channelLen   = input.int(9,   "Channel Length",  minval=2)
avgLen       = input.int(12,  "Average Length",  minval=2)
obLevel1     = input.int(60,  "Overbought 1",    minval=50)
osLevel1     = input.int(-60, "Oversold 1",      maxval=-50)
rsiLen       = input.int(14,  "RSI Confirm",     minval=2)

// ── WaveTrend Calculation ─────────────────────────────────────────────
hlcAvg  = hlc3
esa     = ta.ema(hlcAvg, channelLen)
d       = ta.ema(math.abs(hlcAvg - esa), channelLen)
ci      = (hlcAvg - esa) / (0.015 * d)
tci     = ta.ema(ci, avgLen)
wt1     = tci
wt2     = ta.sma(wt1, 4)

// ── RSI confirmation filter ───────────────────────────────────────────
rsiVal  = ta.rsi(close, rsiLen)

// ── Divergence detection (simplified) ────────────────────────────────
pivotHigh = ta.pivothigh(wt1, 5, 5)
pivotLow  = ta.pivotlow(wt1,  5, 5)
priceHigh = ta.pivothigh(close, 5, 5)
priceLow  = ta.pivotlow(close,  5, 5)

bearDiv = not na(pivotHigh) and not na(priceHigh) and pivotHigh < pivotHigh[1] and priceHigh > priceHigh[1]
bullDiv = not na(pivotLow)  and not na(priceLow)  and pivotLow  > pivotLow[1]  and priceLow  < priceLow[1]

// ── Entry signals ─────────────────────────────────────────────────────
longCond  = (ta.crossover(wt1, wt2) and wt2 < osLevel1 and rsiVal < 50) or (bullDiv and rsiVal < 45)
shortCond = (ta.crossunder(wt1, wt2) and wt2 > obLevel1) or bearDiv

if longCond
    strategy.entry("Long", strategy.long)

if shortCond
    strategy.close("Long")`,
  },

  ichimoku: {
    label: "Ichimoku + MACD",
    script: `//@version=5
// Ichimoku Cloud + MACD Confluence System
// Japanese charting method with Western momentum confirmation
// Trades only when price, cloud, and MACD alignment agree
strategy("Ichimoku + MACD Confluence", overlay=true)

// ── Ichimoku Inputs ───────────────────────────────────────────────────
conversionLen  = input.int(9,  "Tenkan (Conversion)", minval=1)
baseLen        = input.int(26, "Kijun (Base)",        minval=1)
laggingSpanLen = input.int(52, "Senkou B Span",       minval=1)
displacement   = input.int(26, "Cloud Displacement",  minval=1)

// ── MACD Inputs ───────────────────────────────────────────────────────
fast   = input.int(12, "MACD Fast",   minval=2)
slow   = input.int(26, "MACD Slow",   minval=5)
signal = input.int(9,  "MACD Signal", minval=2)

// ── Ichimoku Components ───────────────────────────────────────────────
highestHigh(len) => ta.highest(high, len)
lowestLow(len)   => ta.lowest(low,  len)

tenkan  = (highestHigh(conversionLen) + lowestLow(conversionLen)) / 2
kijun   = (highestHigh(baseLen) + lowestLow(baseLen)) / 2
senkouA = (tenkan + kijun) / 2
senkouB = (highestHigh(laggingSpanLen) + lowestLow(laggingSpanLen)) / 2

cloudTop    = math.max(senkouA[displacement], senkouB[displacement])
cloudBottom = math.min(senkouA[displacement], senkouB[displacement])

// ── MACD ──────────────────────────────────────────────────────────────
[macdLine, signalLine, histogram] = ta.macd(close, fast, slow, signal)
macdBull = ta.crossover(macdLine, signalLine)
macdBear = ta.crossunder(macdLine, signalLine)

// ── Confluence conditions ─────────────────────────────────────────────
aboveCloud   = close > cloudTop
belowCloud   = close < cloudBottom
tkaKijunBull = tenkan > kijun
tkaKijunBear = tenkan < kijun

// ── Execution ─────────────────────────────────────────────────────────
if macdBull and aboveCloud and tkaKijunBull
    strategy.entry("Long", strategy.long)

if macdBear or belowCloud
    strategy.close("Long")`,
  },

  vwap: {
    label: "VWAP + Bollinger Bands",
    script: `//@version=5
// VWAP + Bollinger Bands Mean Reversion System
// Institutional-grade entries at VWAP standard deviation extremes
// High win rate in range-bound and trending conditions
strategy("VWAP + Bollinger Bands", overlay=true)

// ── Inputs ────────────────────────────────────────────────────────────
bbPeriod    = input.int(20,   "BB Period",         minval=5)
bbMult      = input.float(2.0,"BB Multiplier",     minval=0.5, maxval=5.0)
volFilter   = input.bool(true, "Volume Filter")
volMaPeriod = input.int(20,   "Volume MA Period",  minval=5)

// ── VWAP Calculation ─────────────────────────────────────────────────
vwapSrc = hlc3 * volume
var float cumVol  = 0.0
var float cumVwap = 0.0
isNewAnchor = timeframe.change("W")
if isNewAnchor
    cumVol  := 0.0
    cumVwap := 0.0
cumVol  += volume
cumVwap += vwapSrc
vwap = cumVwap / cumVol

// VWAP standard deviation bands
vwapDev   = ta.stdev(close - vwap, bbPeriod)
vwapUpper = vwap + bbMult * vwapDev
vwapLower = vwap - bbMult * vwapDev

// ── Bollinger Bands ───────────────────────────────────────────────────
[bbUpper, bbMid, bbLower] = ta.bb(close, bbPeriod, bbMult)

// ── Volume confirmation ───────────────────────────────────────────────
volMa   = ta.sma(volume, volMaPeriod)
highVol = not volFilter or volume > volMa

// ── Confluence zones ──────────────────────────────────────────────────
supportZone    = close < bbLower and close < vwapLower
resistanceZone = close > bbUpper and close > vwapUpper

if supportZone and highVol
    strategy.entry("Long", strategy.long)

if resistanceZone
    strategy.close("Long")`,
  },

  hullMA: {
    label: "Hull MA Triple",
    script: `//@version=5
// Hull Moving Average Triple System — Alan Hull's HMA with trend filter
// Virtually eliminates lag while maintaining smoothness
// Triple HMA crossover with ADX regime filter
strategy("Hull MA Triple System", overlay=true)

// ── Inputs ────────────────────────────────────────────────────────────
fastLen   = input.int(9,  "Fast HMA",   minval=2)
midLen    = input.int(16, "Mid HMA",    minval=4)
slowLen   = input.int(25, "Slow HMA",   minval=6)
adxLen    = input.int(14, "ADX Period", minval=5)
adxThresh = input.int(20, "ADX Min",    minval=10, maxval=40)
fast      = input.int(12, "EMA Fast",   minval=2)
slow      = input.int(26, "EMA Slow",   minval=5)

// ── Hull Moving Average ───────────────────────────────────────────────
hma(src, length) =>
    ta.wma(2 * ta.wma(src, length / 2) - ta.wma(src, length), math.round(math.sqrt(length)))

fastHMA = hma(close, fastLen)
midHMA  = hma(close, midLen)
slowHMA = hma(close, slowLen)

// ── EMA confirmation ──────────────────────────────────────────────────
fastEMA = ta.ema(close, fast)
slowEMA = ta.ema(close, slow)

// ── ADX trend strength ────────────────────────────────────────────────
[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)
trending = adxVal > adxThresh

// ── Triple alignment + momentum ───────────────────────────────────────
bullAlign = fastHMA > midHMA and midHMA > slowHMA
bearAlign = fastHMA < midHMA and midHMA < slowHMA
emaBull   = ta.crossover(fastEMA, slowEMA)
emaBear   = ta.crossunder(fastEMA, slowEMA)

if emaBull and bullAlign and trending
    strategy.entry("Long", strategy.long)

if emaBear or bearAlign
    strategy.close("Long")`,
  },

  keltnersqueeze: {
    label: "Keltner Squeeze",
    script: `//@version=5
// Keltner Channel Squeeze Breakout — TTM Squeeze adaptation
// Detects consolidation (BB inside KC) then trades momentum breakout
strategy("Keltner Squeeze Breakout", overlay=false)

// ── Inputs ────────────────────────────────────────────────────────────
bbLen  = input.int(20,   "BB Length",     minval=5)
bbMult = input.float(2.0,"BB Multiplier", minval=0.5)
kcLen  = input.int(20,   "KC Length",     minval=5)
kcMult = input.float(1.5,"KC Multiplier", minval=0.5)
momLen = input.int(12,   "Momentum",      minval=5)

// ── Bollinger Bands ───────────────────────────────────────────────────
[bbUpper, bbMid, bbLower] = ta.bb(close, bbLen, bbMult)

// ── Keltner Channel ───────────────────────────────────────────────────
kcMid   = ta.ema(close, kcLen)
atrVal  = ta.atr(kcLen)
kcUpper = kcMid + kcMult * atrVal
kcLower = kcMid - kcMult * atrVal

// ── Squeeze detection ─────────────────────────────────────────────────
sqzOn  = bbLower > kcLower and bbUpper < kcUpper
sqzOff = bbLower < kcLower and bbUpper > kcUpper

// ── Momentum histogram ────────────────────────────────────────────────
highest = ta.highest(high, momLen)
lowest  = ta.lowest(low,  momLen)
midVal  = (highest + lowest) / 2.0
val     = ta.linreg(close - midVal, momLen, 0)

momUp   = val > 0 and val > val[1]
momDown = val < 0 and val < val[1]

// ── Entry signals: breakout from squeeze ─────────────────────────────
if sqzOff and momUp
    strategy.entry("Long", strategy.long)

if close < bbLower or momDown
    strategy.close("Long")`,
  },

  adaptiveLaguerre: {
    label: "Adaptive Laguerre RSI",
    script: `//@version=5
// Adaptive Laguerre RSI — John Ehlers' 4-pole digital filter
// Gamma adapts based on fractal dimension / cycle efficiency ratio
// Near-zero lag, exceptional noise rejection in volatile markets
strategy("Adaptive Laguerre RSI", overlay=false)

// ── Inputs ────────────────────────────────────────────────────────────
gammaFixed = input.float(0.8, "Base Gamma",       minval=0.1, maxval=0.99, step=0.01)
adaptive   = input.bool(true, "Adaptive Gamma")
effPeriod  = input.int(10,   "Efficiency Period", minval=5)
rsiLen     = input.int(14,   "RSI Period",        minval=2)
obLevel    = input.int(80,   "Overbought",        minval=60)
osLevel    = input.int(20,   "Oversold",          maxval=40)
fast       = input.int(12,   "Fast EMA",          minval=2)
slow       = input.int(26,   "Slow EMA",          minval=5)

// ── Kaufman Efficiency Ratio for adaptive gamma ───────────────────────
direction  = math.abs(close - close[effPeriod])
volatility = math.sum(math.abs(close - close[1]), effPeriod)
effRatio   = volatility != 0 ? direction / volatility : 0.0
gamma      = adaptive ? math.max(0.1, math.min(0.99, 1.0 - effRatio)) : gammaFixed

// ── 4-pole Laguerre filter ────────────────────────────────────────────
var float L0 = close
var float L1 = close
var float L2 = close
var float L3 = close

L0 := (1 - gamma) * close + gamma * nz(L0[1], close)
L1 := -gamma * L0  + nz(L0[1], close) + gamma * nz(L1[1], close)
L2 := -gamma * L1  + nz(L1[1], close) + gamma * nz(L2[1], close)
L3 := -gamma * L2  + nz(L2[1], close) + gamma * nz(L3[1], close)

// ── Laguerre RSI ──────────────────────────────────────────────────────
cu = (L0 > L1 ? L0 - L1 : 0) + (L1 > L2 ? L1 - L2 : 0) + (L2 > L3 ? L2 - L3 : 0)
cd = (L0 < L1 ? L1 - L0 : 0) + (L1 < L2 ? L2 - L1 : 0) + (L2 < L3 ? L3 - L2 : 0)
lrsi = cu + cd != 0 ? cu / (cu + cd) * 100 : 0

// ── Standard RSI + EMA confirmation ──────────────────────────────────
rsiVal  = ta.rsi(close, rsiLen)
fastEMA = ta.ema(close, fast)
slowEMA = ta.ema(close, slow)

if lrsi < osLevel and rsiVal < 40 and ta.crossover(fastEMA, slowEMA)
    strategy.entry("Long", strategy.long)

if lrsi > obLevel or rsiVal > 65
    strategy.close("Long")`,
  },

  supertrend_adx: {
    label: "SuperTrend + ADX",
    script: `//@version=5
// SuperTrend + ADX Regime Filter — Professional Trend Following
// SuperTrend direction confirmed by ADX trend strength and DI alignment
// Eliminates whipsaws in low-volatility, ranging market conditions
strategy("SuperTrend + ADX Regime", overlay=true)

// ── SuperTrend inputs ─────────────────────────────────────────────────
atrPeriod  = input.int(10,   "ATR Period",    minval=1)
multiplier = input.float(3.0,"Multiplier",    minval=0.5, maxval=10, step=0.1)

// ── ADX / DMI inputs ──────────────────────────────────────────────────
adxLen    = input.int(14, "ADX Length",    minval=5)
adxSmooth = input.int(14, "ADX Smoothing", minval=1)
adxThresh = input.int(20, "ADX Threshold", minval=10, maxval=50)

// ── Volume filter ─────────────────────────────────────────────────────
volPeriod = input.int(20,  "Volume MA",     minval=5)
volFactor = input.float(1.0,"Volume Factor",minval=0.5, maxval=3.0)

// ── SuperTrend ────────────────────────────────────────────────────────
[supertrend, direction] = ta.supertrend(multiplier, atrPeriod)

// ── ADX / DMI ─────────────────────────────────────────────────────────
[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxSmooth)

// ── Volume confirmation ───────────────────────────────────────────────
volMA   = ta.sma(volume, volPeriod)
highVol = volume > volMA * volFactor

// ── ATR normalization (filters false signals in low-vol environments) ─
atrRaw  = ta.atr(atrPeriod)
atrNorm = atrRaw / close * 100

// ── Regime filter: only trade when market is trending ─────────────────
inTrend = adxVal > adxThresh and highVol

// ── Entry signals ─────────────────────────────────────────────────────
longEntry = ta.crossunder(direction, 0) and inTrend and diPlus > diMinus
shortExit = ta.crossover(direction,  0) or adxVal < adxThresh * 0.7

if longEntry
    strategy.entry("Long", strategy.long)

if shortExit
    strategy.close("Long")`,
  },

  bos: {
    label: "BOS Adaptive Structure Average",
    script: `//@version=5
// BOS Adaptive Structure Average — Zeiierman
// Detects Break-of-Structure events and plots an adaptive EMA of structural levels.
// Entries fire on confirmed BoS with trend-filtered momentum.
// Source: tradingview.com/script/phNDYIN6
indicator("BOS Adaptive Structure Average", overlay=true)

// ── Inputs ────────────────────────────────────────────────────────────
swingLen   = input.int(10,  "Swing Lookback",     minval=3,  maxval=50)
atrMult    = input.float(1.5,"ATR Filter Mult",   minval=0.5,maxval=4.0, step=0.1)
atrLen     = input.int(14,  "ATR Length",         minval=5)
emaFast    = input.int(21,  "Structure EMA Fast", minval=5)
emaSlow    = input.int(55,  "Structure EMA Slow", minval=10)

// ── Swing High / Low Detection ────────────────────────────────────────
swingHigh = ta.pivothigh(high, swingLen, swingLen)
swingLow  = ta.pivotlow(low,  swingLen, swingLen)

var float lastSwingHigh = na
var float lastSwingLow  = na
if not na(swingHigh)
    lastSwingHigh := swingHigh
if not na(swingLow)
    lastSwingLow := swingLow

// ── Break-of-Structure Detection ─────────────────────────────────────
bullBoS = not na(lastSwingHigh) and ta.crossover(close, lastSwingHigh)
bearBoS = not na(lastSwingLow)  and ta.crossunder(close, lastSwingLow)

// ── Adaptive Structure Average ────────────────────────────────────────
// Blends fast/slow EMA weighting toward price momentum
atr       = ta.atr(atrLen)
momentum  = math.abs(close - close[swingLen]) / (atr * swingLen + 1e-10)
alpha     = math.min(math.max(momentum * 0.3, 1.0 / emaFast), 1.0 / emaSlow * 2)
var float asa = na
asa := na(asa) ? close : asa + alpha * (close - asa)

// EMA stack for trend filter
emaF = ta.ema(close, emaFast)
emaS = ta.ema(close, emaSlow)
upTrend   = emaF > emaS and close > asa
downTrend = emaF < emaS and close < asa

// ── ATR noise filter ──────────────────────────────────────────────────
structureBreakValid = math.abs(close - asa) > atr * atrMult * 0.5

// ── Entry / Exit ──────────────────────────────────────────────────────
longEntry  = bullBoS and upTrend   and structureBreakValid
shortEntry = bearBoS and downTrend and structureBreakValid

strategy.entry("Long",  strategy.long,  when=longEntry)
strategy.entry("Short", strategy.short, when=shortEntry)
strategy.close("Long",  when=bearBoS or downTrend)
strategy.close("Short", when=bullBoS or upTrend)

// ── Plots ─────────────────────────────────────────────────────────────
plot(asa,         "Adaptive Structure Avg", color=upTrend ? color.new(#39ff14, 0) : color.new(#F21A1A, 0), linewidth=2)
plot(emaF,        "EMA Fast",               color=color.new(color.white, 70), linewidth=1)
plot(emaS,        "EMA Slow",               color=color.new(color.white, 85), linewidth=1)
plot(lastSwingHigh, "Last Swing High",      color=color.new(#F21A1A, 60),  linewidth=1, style=plot.style_circles)
plot(lastSwingLow,  "Last Swing Low",       color=color.new(#00c9a7, 60),  linewidth=1, style=plot.style_circles)`,
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "form" | "transpiling" | "deploying" | "done" | "error";

interface TranspileInfo {
  indicatorType: number;
  shortPeriod: number;
  longPeriod: number;
  thirdPeriod: number;
  patternLabel: string;
  detectedPattern: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  taFunctions: string[];
  buyCondition: string;
  sellCondition: string;
}

interface DeployResult {
  indicatorAddr: string;
  moveSource: string;
  transpile: TranspileInfo;
  indicator: { name: string; symbol: string };
}

interface DeployFormProps {
  onDeployed?: (addr: string) => void;
}

type PreviewState =
  | { status: "idle" }
  | { status: "ok"; result: TranspileResult }
  | { status: "error"; message: string };

const TYPE_LABELS = ["SMA Crossover", "EMA Crossover", "RSI", "MACD", "Bollinger Bands"];
const CONFIDENCE_COLOR = { high: "text-green-400", medium: "text-yellow-400", low: "text-red-400" };
const CONFIDENCE_BG    = { high: "bg-green-500/10 border-green-500/20", medium: "bg-yellow-500/10 border-yellow-500/20", low: "bg-red-500/10 border-red-500/20" };

// ─── Auto-extract meta from PineScript ───────────────────────────────────────

function extractMeta(script: string): { name: string; symbol: string; description: string } {
  if (!script || typeof script !== "string" || script.length < 5) {
    return { name: "Indicator", symbol: "IND", description: "" };
  }

  const lines = script.split("\n");

  // 1. Name — try strategy("Name", ...) or indicator("Name", ...) first
  let name = "";
  const strategyMatch = script.match(/(?:strategy|indicator)\(\s*["']([^"']+)["']/);
  if (strategyMatch) {
    name = strategyMatch[1];
  } else {
    // Try //@strategy_name comment
    const nameComment = script.match(/\/\/@strategy_name\s+(.+)/);
    if (nameComment) {
      name = nameComment[1].trim();
    } else {
      // First non-empty comment line
      for (const line of lines) {
        const cm = line.match(/^\s*\/\/\s*(.+)/);
        if (cm && !cm[1].startsWith("@")) {
          name = cm[1].replace(/^[-─\s]+/, "").replace(/[-─\s]+$/, "").trim();
          if (name.length > 2) break;
        }
      }
    }
  }

  // 2. Symbol — first letter of each word, uppercase, max 5 chars
  const words = name.split(/[\s\-_+/]+/).filter(Boolean);
  const symbol = words
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 5) || "IND";

  // 3. Description — first comment after //@version=5 that isn't the strategy line
  let description = "";
  let pastVersion = false;
  for (const line of lines) {
    if (line.includes("@version")) {
      pastVersion = true;
      continue;
    }
    if (!pastVersion) continue;
    // Skip the strategy() call line
    if (line.match(/^\s*strategy\s*\(/)) continue;
    const cm = line.match(/^\s*\/\/\s*(.+)/);
    if (cm && !cm[1].startsWith("@") && !cm[1].match(/^[-─═]+$/)) {
      description = cm[1].replace(/^[-─\s]+/, "").trim();
      if (description.length > 5) break;
    }
    // If we hit a non-comment, non-empty line after version, stop looking
    if (!line.match(/^\s*\/\//) && line.trim().length > 0 && pastVersion) break;
  }

  return { name: name || "Untitled Strategy", symbol, description };
}

// ─── Auto-detect asset from PineScript ────────────────────────────────────────

function detectAsset(script: string): string {
  const upper = script.toUpperCase();
  // Check for explicit ticker mentions
  if (upper.includes("BTCUSD") || upper.includes("BTC/USD") || upper.includes("XBTUSD")) return "BTC/USD";
  if (upper.includes("ETHUSD") || upper.includes("ETH/USD")) return "ETH/USD";
  if (upper.includes("SOLUSD") || upper.includes("SOL/USD")) return "SOL/USD";
  if (upper.includes("APTUSD") || upper.includes("APT/USD")) return "APT/USD";

  // Check for loose mentions — look for the symbol name in comments or variable names
  // Priority order: more specific first
  const aptCount = (upper.match(/\bAPT\b/g) || []).length;
  const solCount = (upper.match(/\bSOL\b/g) || []).length;
  const ethCount = (upper.match(/\bETH\b/g) || []).length;
  const btcCount = (upper.match(/\bBTC\b/g) || []).length;

  if (aptCount > 0 && aptCount >= Math.max(solCount, ethCount, btcCount)) return "APT/USD";
  if (solCount > 0 && solCount >= Math.max(ethCount, btcCount)) return "SOL/USD";
  if (ethCount > 0 && ethCount >= btcCount) return "ETH/USD";

  // Default
  return "BTC/USD";
}

// ─── Transpiler Preview Panel ─────────────────────────────────────────────────

function TranspilerPreview({
  preview,
  name,
  symbol,
  asset,
}: {
  preview: PreviewState;
  name: string;
  symbol: string;
  asset: string;
}) {
  if (preview.status === "idle") {
    return (
      <div className="text-center py-6 px-4">
        <div className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Analysis</div>
        <p className="text-[11px] text-zinc-700">Paste PineScript to see transpiler output</p>
      </div>
    );
  }

  if (preview.status === "error") {
    return (
      <div className="py-4 px-1">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
          <p className="text-[10px] text-red-400 font-mono truncate">{preview.message}</p>
        </div>
      </div>
    );
  }

  const r = preview.result;
  const typeName = TYPE_NAMES[r.indicatorType] ?? "Custom";
  const displayAsset = asset ? asset.replace("/USD", "") : "BTC";

  return (
    <div className="space-y-0">
      {/* Confidence badge */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-semibold font-mono uppercase tracking-wider",
          r.confidence === "high"
            ? "text-emerald-400 bg-emerald-500/8"
            : r.confidence === "medium"
              ? "text-amber-400 bg-amber-500/8"
              : "text-red-400 bg-red-500/8",
        )}>
          <span className={cn("w-1.5 h-1.5 rounded-full", r.confidence === "high" ? "bg-emerald-400" : r.confidence === "medium" ? "bg-amber-400" : "bg-red-400")} />
          {r.confidence === "high" ? "Ready" : r.confidence === "medium" ? "Review" : "Error"}
        </span>
        <span className="text-[9px] font-mono text-zinc-600">{displayAsset}/USD</span>
      </div>

      {/* Params — compact 2-col grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-2 border-t border-white/[0.04]">
        <div>
          <div className="text-[9px] text-zinc-600 font-mono">Pattern</div>
          <div className="text-[11px] text-zinc-300 font-mono truncate">{r.patternLabel}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 font-mono">Type</div>
          <div className="text-[11px] text-zinc-300 font-mono">{typeName}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 font-mono">Periods</div>
          <div className="text-[11px] text-zinc-300 font-mono tabular-nums">{r.shortPeriod} / {r.longPeriod}{r.thirdPeriod > 0 ? ` / ${r.thirdPeriod}` : ""}</div>
        </div>
        <div>
          <div className="text-[9px] text-zinc-600 font-mono">Functions</div>
          <div className="text-[11px] text-zinc-300 font-mono">{r.taFunctions?.length ?? 0} TA calls</div>
        </div>
      </div>

      {/* Warnings — compact */}
      {r.warnings.length > 0 && (
        <div className="pt-2 border-t border-white/[0.04] space-y-1">
          {r.warnings.slice(0, 2).map((w, i) => (
            <p key={i} className="text-[9px] text-amber-400/60 leading-tight">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeployForm({ onDeployed }: DeployFormProps) {
  const [step, setStep] = useState<Step>("form");
  const [pineScript, setPineScript] = useState(EXAMPLES.bos.script);
  // Once the user picks a preset or edits, the async TV import must not clobber it.
  const scriptTouchedRef = useRef(false);
  const [activeExample, setActiveExample] = useState("bos");

  // Auto-extracted meta (editable via override)
  const autoMeta = extractMeta(pineScript);
  const autoAsset = detectAsset(pineScript);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [symbolOverride, setSymbolOverride] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingSymbol, setEditingSymbol] = useState(false);

  const name = nameOverride ?? autoMeta.name ?? "Indicator";
  const symbol = symbolOverride ?? autoMeta.symbol ?? "IND";
  const description = autoMeta.description;
  const tabFileName = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").toLowerCase().slice(0, 16) || "indicator";
  const asset = autoAsset;

  // TradingView import input
  const [tvInput, setTvInput] = useState("");
  const [tvHelper, setTvHelper] = useState(false);
  const [tvLoading, setTvLoading] = useState(false);
  const [tvError, setTvError] = useState<string | null>(null);

  // IDE tabs
  const [activeTab, setActiveTab] = useState<"pine" | "move" | "vault">("pine");
  const [moveSource, setMoveSource] = useState<string>("");
  const [vaultSource, setVaultSource] = useState<string>("");
  const [vaultMarket, setVaultMarket] = useState<keyof typeof VAULT_MARKETS>("BTC/USD");
  const { connected, account, signAndSubmitTransaction } = useWallet();
  // Deploy-from-UI flow (transpile → compile → publish → vault → delegate → live).
  const [vaultDeploy, setVaultDeploy] = useState<{
    activeIndex: number;
    errored: boolean;
    message: string;
    busy: boolean;
    artifacts: { sourceHash?: string; moduleName?: string; packageAddress?: string; txHash?: string; indicatorAddr?: string };
  } | null>(null);
  const [compileServiceAvailable, setCompileServiceAvailable] = useState<boolean | null>(null);

  // Availability probe — Vercel prod has no aptos CLI; present deploy-from-UI
  // honestly as local/self-hosted-only there instead of a broken button.
  useEffect(() => {
    if (activeTab !== "vault" || compileServiceAvailable !== null) return;
    fetch("/api/launchpad/deploy-vault")
      .then((r) => r.json())
      .then((d) => setCompileServiceAvailable(Boolean(d.available)))
      .catch(() => setCompileServiceAvailable(false));
  }, [activeTab, compileServiceAvailable]);

  const handleDeployVault = useCallback(async () => {
    if (!pineScript.trim()) return;
    const creatorAddr = (connected && account) ? account.address.toString() : undefined;

    // Step 0: transpile client-side (instant) — hard errors stop here.
    setVaultDeploy({ activeIndex: 0, errored: false, busy: true, message: "Transpiling PineScript…", artifacts: {} });
    try {
      const market = VAULT_MARKETS[vaultMarket];
      const t = transpileV3(pineScript, creatorAddr ?? "0xcreator", {
        target: "vault", marketAddr: market.addr,
        lotSize: market.lotSize, minSize: market.minSize, szDecimalsPow: market.szDecimalsPow,
      });
      if ((t as { errors?: string[] }).errors?.length) {
        setVaultDeploy({ activeIndex: 0, errored: true, busy: false, message: (t as { errors: string[] }).errors.join("\n"), artifacts: {} });
        return;
      }
    } catch (err) {
      setVaultDeploy({ activeIndex: 0, errored: true, busy: false, message: err instanceof Error ? err.message : "Transpile failed", artifacts: {} });
      return;
    }

    // Step 1: compile on the server — serialized, ~2 min cold. Honest progress.
    setVaultDeploy({ activeIndex: 1, errored: false, busy: true, message: "Compiling Move on the server — a cold compile can take ~2 minutes…", artifacts: {} });
    let compileJson: { ok?: boolean; sourceHash?: string; moduleName?: string; moveSource?: string; compilerError?: string; transpileErrors?: string[]; error?: string };
    try {
      const res = await fetch("/api/launchpad/deploy-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "compile", pineScript, marketName: vaultMarket, creatorAddr }),
      });
      compileJson = await res.json();
      if (res.status === 501) {
        setVaultDeploy({ activeIndex: 1, errored: true, busy: false, message: compileJson.error ?? "Compile service unavailable on this deployment.", artifacts: {} });
        return;
      }
      if (!res.ok || !compileJson.ok) {
        const detail = compileJson.compilerError ?? compileJson.transpileErrors?.join("\n") ?? compileJson.error ?? "Compile failed";
        setVaultDeploy({ activeIndex: 1, errored: true, busy: false, message: detail, artifacts: { sourceHash: compileJson.sourceHash } });
        return;
      }
    } catch (err) {
      setVaultDeploy({ activeIndex: 1, errored: true, busy: false, message: err instanceof Error ? err.message : "Compile request failed", artifacts: {} });
      return;
    }

    // Step 2: publish to testnet (deployer-paid).
    setVaultDeploy({ activeIndex: 2, errored: false, busy: true, message: "Publishing the module to Aptos testnet…", artifacts: { sourceHash: compileJson.sourceHash, moduleName: compileJson.moduleName } });
    try {
      const res = await fetch("/api/launchpad/deploy-vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "publish", moveSource: compileJson.moveSource, moduleName: compileJson.moduleName }),
      });
      const pub = await res.json();
      if (!res.ok || !pub.ok) {
        setVaultDeploy({ activeIndex: 2, errored: true, busy: false, message: pub.error ?? "Publish failed", artifacts: { sourceHash: compileJson.sourceHash, moduleName: compileJson.moduleName } });
        return;
      }
      // The module's init_module creates a resource account seeded with the
      // module name, signed by the package object — so the indicator address
      // (where IndicatorState/PriceBuffer live, and what create_strategy_vault
      // takes as indicator_addr) is derivable without parsing the writeset.
      let indicatorAddr: string | undefined;
      try {
        indicatorAddr = createResourceAddress(
          AccountAddress.from(pub.packageAddress),
          compileJson.moduleName ?? "",
        ).toString();
      } catch {
        // Leave undefined — the artifacts panel simply omits the row.
      }
      // Steps 3-5 (vault / delegate / live) are wallet signatures + registry —
      // wired next; stop honestly at "published" with the live artifacts.
      setVaultDeploy({
        activeIndex: 3,
        errored: false,
        busy: false,
        message: "Module is LIVE on testnet. Next steps (create vault → bind strategy → delegate) sign with your wallet — coming next.",
        artifacts: { sourceHash: compileJson.sourceHash, moduleName: compileJson.moduleName, packageAddress: pub.packageAddress, txHash: pub.txHash, indicatorAddr },
      });
    } catch (err) {
      setVaultDeploy({ activeIndex: 2, errored: true, busy: false, message: err instanceof Error ? err.message : "Publish request failed", artifacts: { sourceHash: compileJson.sourceHash, moduleName: compileJson.moduleName } });
    }
  }, [pineScript, vaultMarket, connected, account]);

  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMove, setShowMove] = useState(false);
  const [onChainTxHash, setOnChainTxHash] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  // Mobile preview toggle
  const [showPreview, setShowPreview] = useState(false);

  // Monetization settings
  const [isProprietary, setIsProprietary] = useState(true);
  const [feeBps, setFeeBps] = useState(200);
  const [feeModel, setFeeModel] = useState<"none" | "flat" | "profit_share">("profit_share");
  const [algoHash, setAlgoHash] = useState<string>("");
  const [isHashing, setIsHashing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // On mount: fetch the real BOS script from TV import so overlays match the published indicator.
  // Falls back to the local stub if the fetch fails (no network / scrape blocked).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const BOS_URL = "https://www.tradingview.com/script/phNDYIN6-BOS-Adaptive-Structure-Average-Zeiierman/";
    runPreview(EXAMPLES.bos.script); // show something immediately

    fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(BOS_URL)}`)
      .then(r => r.json())
      .then((data: { source?: string; error?: string }) => {
        if (data.source && !scriptTouchedRef.current) {
          setPineScript(data.source);
          setNameOverride(null);
          setSymbolOverride(null);
          runPreview(data.source);
          // Update EXAMPLES stub so clicking the pill again re-loads the real script
          EXAMPLES.bos.script = data.source;
        }
      })
      .catch(() => { /* keep the stub */ });
  }, []);

  // Generate Move source from PineScript when .move tab is opened or script changes
  useEffect(() => {
    if (activeTab !== "move") return;
    try {
      const addr = (connected && account) ? account.address.toString() : "0xcreator";
      const result = transpileV3(pineScript, addr);
      setMoveSource(result.moveSource);
    } catch {
      setMoveSource("// Transpilation error — check PineScript syntax");
    }
  }, [activeTab, pineScript, connected, account]);

  // Vault target: the same indicator PLUS the trustless Decibel strategy-vault
  // pattern in one module — this module IS the bot.
  useEffect(() => {
    if (activeTab !== "vault") return;
    try {
      const addr = (connected && account) ? account.address.toString() : "0xcreator";
      const market = VAULT_MARKETS[vaultMarket];
      const result = transpileV3(pineScript, addr, {
        target: "vault",
        marketAddr: market.addr,
        lotSize: market.lotSize,
        minSize: market.minSize,
        szDecimalsPow: market.szDecimalsPow,
      });
      setVaultSource(result.moveSource);
    } catch {
      setVaultSource("// Transpilation error — check PineScript syntax");
    }
  }, [activeTab, pineScript, connected, account, vaultMarket]);

  const runPreview = useCallback((script: string) => {
    if (!script.trim()) {
      setPreview({ status: "idle" });
      return;
    }
    try {
      const result = transpile(script, "0xcreator");
      setPreview({ status: "ok", result });
    } catch (err) {
      setPreview({
        status: "error",
        message: err instanceof Error ? err.message : "Parse failed",
      });
    }
  }, []);

  const computeHash = useCallback(async (script: string) => {
    if (!script.trim()) {
      setAlgoHash("");
      return;
    }
    setIsHashing(true);
    try {
      const enc = new TextEncoder().encode(script);
      const buf = await crypto.subtle.digest("SHA-256", enc);
      const hash =
        "0x" +
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      setAlgoHash(hash);
    } finally {
      setIsHashing(false);
    }
  }, []);

  const hashDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScriptChange = useCallback(
    (val: string) => {
      scriptTouchedRef.current = true;
      setPineScript(val);
      // Clear overrides so auto-extract re-runs
      setNameOverride(null);
      setSymbolOverride(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runPreview(val), 300);
      if (isProprietary) {
        if (hashDebounceRef.current) clearTimeout(hashDebounceRef.current);
        hashDebounceRef.current = setTimeout(() => computeHash(val), 1000);
      }
    },
    [runPreview, isProprietary, computeHash]
  );

  const handleTvInput = useCallback(
    async (val: string) => {
      setTvInput(val);
      setTvError(null);

      const trimmed = val.trim();

      // Auto-fetch from TradingView URL
      if (trimmed.startsWith("https://www.tradingview.com/script/")) {
        setTvHelper(false);
        setTvLoading(true);
        setTvError(null);
        try {
          const res = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(trimmed)}`);
          const data = await res.json() as { source?: string; title?: string; error?: string };
          if (!res.ok || data.error) {
            setTvError(data.error ?? "Failed to extract PineScript");
          } else if (data.source) {
            setPineScript(data.source);
            setNameOverride(null);
            setSymbolOverride(null);
            runPreview(data.source);
            setActiveExample("");
            setActiveTab("pine");
          }
        } catch {
          setTvError("Network error fetching TradingView page");
        } finally {
          setTvLoading(false);
        }
        return;
      }

      if (trimmed.startsWith("http")) {
        setTvHelper(true);
      } else if (trimmed.length > 20 && (val.includes("//@version") || val.includes("strategy(") || val.includes("indicator("))) {
        // User pasted PineScript directly
        setTvHelper(false);
        scriptTouchedRef.current = true;
        setPineScript(val);
        setNameOverride(null);
        setSymbolOverride(null);
        runPreview(val);
        setTvInput("");
        setActiveExample("");
        setActiveTab("pine");
      } else {
        setTvHelper(false);
      }
    },
    [runPreview]
  );

  function loadExample(key: string) {
    const script = EXAMPLES[key].script;
    setActiveExample(key);
    scriptTouchedRef.current = true;
    setPineScript(script);
    setNameOverride(null);
    setSymbolOverride(null);
    setAlgoHash("");
    setActiveTab("pine");
    setTvInput("");
    setTvHelper(false);
    runPreview(script);
  }

  async function handleDeploy() {
    if (!name || !symbol || !pineScript) {
      setError("Name, symbol, and PineScript are required");
      return;
    }
    setError(null);
    setStep("transpiling");
    await new Promise((r) => setTimeout(r, 600));
    setStep("deploying");

    const creatorAddr = (connected && account) ? account.address.toString() : "0x" + "a".repeat(40);

    try {
      const res = await fetch("/api/launchpad/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pineScript,
          creatorAddr,
          name,
          symbol,
          description,
          assets: [asset],
          isProprietary,
          algoHash: isProprietary ? algoHash : undefined,
          creatorFeeBps: isProprietary ? feeBps : 0,
          creatorFeeModel: isProprietary ? feeModel : "none",
        }),
      });

      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error || "Deployment failed");
      }

      const data = (await res.json()) as DeployResult;
      setResult(data);

      // Submit on-chain create_indicator if wallet connected
      if (connected && account && data.transpile) {
        try {
          const { indicatorType, shortPeriod, longPeriod } = data.transpile;
          const response = await signAndSubmitTransaction({
            data: {
              function: `${LAUNCHPAD_CONTRACT}::indicator::create_indicator`,
              typeArguments: [],
              functionArguments: [
                name,
                symbol,
                asset,
                indicatorType,
                shortPeriod,
                longPeriod,
                account.address.toString(),
              ],
            },
          });
          setOnChainTxHash(response.hash);
        } catch {
          /* on-chain tx optional */
        }
      }

      setStep("done");
      onDeployed?.(data.indicatorAddr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }

  function reset() {
    setStep("form");
    setResult(null);
    setError(null);
    setNameOverride(null);
    setSymbolOverride(null);
    setIsProprietary(false);
    setAlgoHash("");
    setFeeBps(200);
    setFeeModel("profit_share");
  }

  // ── Done state ────────────────────────────────────────────────────────────
  if (step === "done" && result) {
    const t = result.transpile;
    return (
      <div className="border-t border-emerald-500/20 pt-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
            ✓
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{result.indicator.name} deployed</h3>
            <p className="text-[11px] text-green-400/80">
              ${result.indicator.symbol} · now visible in Explore
            </p>
          </div>
        </div>

        {/* Transpiler Analysis */}
        <div
          className={cn(
            "rounded-[10px] border px-3 py-2.5 space-y-2 bg-[#111] border-[#2a2a2a]",
            CONFIDENCE_BG[t.confidence]
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">
                {TYPE_LABELS[t.indicatorType] ?? "Custom"} (type {t.indicatorType})
              </span>
              <span className="text-[10px] font-mono text-zinc-400">{t.patternLabel}</span>
            </div>
            <span className={cn("text-[10px] font-medium uppercase", CONFIDENCE_COLOR[t.confidence])}>
              {t.confidence} confidence
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div>
              <span className="text-zinc-500">Short period </span>
              <span className="text-zinc-200 font-mono">{t.shortPeriod}</span>
            </div>
            <div>
              <span className="text-zinc-500">Long period </span>
              <span className="text-zinc-200 font-mono">{t.longPeriod}</span>
            </div>
            {t.thirdPeriod > 0 && (
              <div>
                <span className="text-zinc-500">Third </span>
                <span className="text-zinc-200 font-mono">
                  {t.indicatorType === 4 ? `${t.thirdPeriod / 10}×` : t.thirdPeriod}
                </span>
              </div>
            )}
          </div>
          {t.taFunctions.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {t.taFunctions.map((fn) => (
                <span
                  key={fn}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-black/30 text-zinc-400 font-mono"
                >
                  ta.{fn}()
                </span>
              ))}
            </div>
          )}
          <div className="text-[10px] text-zinc-500 space-y-0.5">
            <div>
              <span className="text-green-400/70">BUY: </span>
              {t.buyCondition}
            </div>
            <div>
              <span className="text-red-400/70">SELL: </span>
              {t.sellCondition}
            </div>
          </div>
          {t.warnings.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-yellow-500/10">
              {t.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-yellow-400/80">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Address */}
        <div className="bg-black/30 rounded-lg px-3 py-2">
          <p className="text-[10px] text-zinc-500 mb-0.5">Contract Address</p>
          <p className="text-xs text-zinc-300 font-mono break-all">{result.indicatorAddr}</p>
        </div>

        {onChainTxHash && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] text-green-400 font-medium">On-chain tx confirmed ✓</span>
            <a
              href={`https://explorer.aptoslabs.com/txn/${onChainTxHash}?network=testnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-green-500/70 hover:text-green-400 font-mono underline"
            >
              {onChainTxHash.slice(0, 12)}...
            </a>
          </div>
        )}

        <button
          onClick={() => setShowMove(!showMove)}
          className="w-full text-left text-xs text-zinc-400 hover:text-zinc-300"
        >
          {showMove ? "▼" : "▶"} Generated Move stub ({result.moveSource.length} chars)
        </button>
        {showMove && (
          <pre className="bg-zinc-950 rounded-lg p-3 text-green-400/80 font-mono text-[10px] overflow-x-auto max-h-48 overflow-y-auto">
            {result.moveSource}
          </pre>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={reset}
            className="flex-1 py-2 rounded-[10px] text-xs font-medium border border-[#2a2a2a] text-zinc-400 hover:text-white transition-colors"
          >
            Deploy Another
          </button>
          <button
            onClick={() => onDeployed?.(result.indicatorAddr)}
            className="flex-1 py-2 rounded-[10px] text-xs font-medium bg-purple-500 text-white hover:bg-purple-400 transition-colors"
          >
            View in Marketplace
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (step === "transpiling" || step === "deploying") {
    return (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] p-8 text-center">
        <div className="inline-flex items-center gap-2 mb-4">
          <svg
            className="animate-spin h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-white font-medium">
            {step === "transpiling" ? "Parsing PineScript..." : "Deploying to Aptos testnet..."}
          </span>
        </div>
        <div className="flex justify-center gap-3 text-xs text-zinc-500">
          <StepDot done label="Tokenize" />
          <StepDot done={step === "deploying"} active={step === "transpiling"} label="Parse AST" />
          <StepDot done={step === "deploying"} active={step === "transpiling"} label="Detect pattern" />
          <StepDot active={step === "deploying"} label="Publish" />
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="w-full">
      {/* 2-column grid: left=editor (full height), right=sidebar (preview + meta + monetization + deploy) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-2 sm:gap-4">
        {/* ── LEFT COLUMN: import + example pills + editor ── */}
        <div className="flex flex-col gap-2 min-w-0">
          {/* TradingView import input */}
          <div>
            <div className="relative">
              <input
                value={tvInput}
                onChange={(e) => handleTvInput(e.target.value)}
                placeholder="Paste TradingView indicator URL or PineScript code"
                disabled={tvLoading}
                className={cn(
                  "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/20",
                  tvLoading && "opacity-60"
                )}
              />
              {tvLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
            </div>
            {tvLoading && (
              <p className="text-[10px] text-purple-400/70 mt-1.5 pl-1">
                Fetching PineScript from TradingView...
              </p>
            )}
            {tvError && (
              <p className="text-[10px] text-red-400 mt-1.5 pl-1">
                {tvError}
              </p>
            )}
            {tvHelper && !tvLoading && !tvError && (
              <p className="text-[10px] text-zinc-500 mt-1.5 pl-1">
                Open the indicator page → click the source code icon → copy the PineScript → paste it here
              </p>
            )}
          </div>

          {/* Example pills — horizontal scroll on mobile */}
          <div className="overflow-x-auto pb-1">
            <div className="flex flex-nowrap gap-1.5">
              {Object.entries(EXAMPLES).map(([key, ex]) => (
                <button
                  key={key}
                  onClick={() => loadExample(key)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[10px] font-medium border transition-colors whitespace-nowrap shrink-0",
                    activeExample === key
                      ? "bg-white/[0.08] border-white/15 text-white"
                      : "border-[#2a2a2a] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                  )}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {/* IDE editor with tabs — takes full remaining height */}
          <div className="flex-1 min-h-[300px] flex flex-col rounded-lg overflow-hidden border border-[#2a2a2a]">
            {/* Tab bar */}
            <div className="flex items-stretch bg-[#1e1e1e] h-7 shrink-0 border-b border-[#2a2a2a] overflow-hidden">
              <button
                onClick={() => setActiveTab("pine")}
                className={cn(
                  "flex items-center gap-1 px-2 text-[9px] font-mono transition-colors border-b-2",
                  activeTab === "pine"
                    ? "bg-[#0d0d0d] text-white border-purple-500"
                    : "bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 border-transparent"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <span className="truncate">{tabFileName}.pine</span>
              </button>
              <button
                onClick={() => setActiveTab("move")}
                className={cn(
                  "flex items-center gap-1 px-2 text-[9px] font-mono transition-colors border-b-2",
                  activeTab === "move"
                    ? "bg-[#0d0d0d] text-white border-purple-500"
                    : "bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 border-transparent"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                <span className="truncate">{tabFileName}.move</span>
              </button>
              <button
                onClick={() => setActiveTab("vault")}
                className={cn(
                  "flex items-center gap-1 px-2 text-[9px] font-mono transition-colors border-b-2",
                  activeTab === "vault"
                    ? "bg-[#0d0d0d] text-emerald-300 border-emerald-500"
                    : "bg-[#1e1e1e] text-zinc-500 hover:text-zinc-300 border-transparent"
                )}
                title="The trustless vault module — this module IS the bot"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span className="truncate">{tabFileName}.vault.move</span>
              </button>
            </div>

            {activeTab === "vault" && (
              <div className="flex shrink-0 items-center gap-3 border-b border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1.5">
                <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-emerald-300/90">
                  This module <span className="font-bold">is</span> the bot: deployed on-chain and delegated by a
                  Decibel vault, it can only trade this exact strategy — prices come from Decibel&apos;s oracle,
                  sizing from vault NAV. Nobody (including the creator) can make it trade anything else.
                </p>
                <select
                  value={vaultMarket}
                  onChange={(e) => setVaultMarket(e.target.value as keyof typeof VAULT_MARKETS)}
                  className="shrink-0 rounded border border-emerald-500/30 bg-[#0d0d0d] px-1.5 py-1 font-mono text-[10px] text-emerald-300 outline-none"
                  aria-label="Vault market"
                >
                  {Object.keys(VAULT_MARKETS).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {compileServiceAvailable === true && (
                  <button
                    type="button"
                    onClick={() => void handleDeployVault()}
                    disabled={vaultDeploy?.busy}
                    className="shrink-0 rounded bg-emerald-400 px-2.5 py-1 font-mono text-[10px] font-bold text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {vaultDeploy?.busy ? "Working…" : "Deploy to Testnet"}
                  </button>
                )}
              </div>
            )}

            {activeTab === "vault" && compileServiceAvailable === false && (
              <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-[10px] text-amber-300/90">
                One-click deploy needs the Move compiler, which isn&apos;t available on this hosted deployment yet —
                run cash.trading locally (or self-hosted) to deploy this module from the UI. The generated source
                below is complete and compiles as-is.
              </div>
            )}

            {activeTab === "vault" && vaultDeploy && (
              <div className="shrink-0 space-y-1.5 border-b border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2">
                <DeployVaultRail status={{ activeIndex: vaultDeploy.activeIndex, errored: vaultDeploy.errored }} />
                <p className={`whitespace-pre-wrap font-mono text-[10px] leading-relaxed ${vaultDeploy.errored ? "text-red-300" : "text-zinc-400"}`}>
                  {vaultDeploy.message}
                </p>
                {(vaultDeploy.artifacts.packageAddress || vaultDeploy.artifacts.sourceHash) && (
                  <div className="space-y-0.5 font-mono text-[9px] text-zinc-500">
                    {vaultDeploy.artifacts.packageAddress && (
                      <div>package: <span className="text-emerald-400">{vaultDeploy.artifacts.packageAddress}</span></div>
                    )}
                    {vaultDeploy.artifacts.txHash && (
                      <div>
                        tx:{" "}
                        <a
                          className="text-emerald-400 underline"
                          href={`https://explorer.aptoslabs.com/txn/${vaultDeploy.artifacts.txHash}?network=testnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {vaultDeploy.artifacts.txHash.slice(0, 18)}…
                        </a>
                      </div>
                    )}
                    {vaultDeploy.artifacts.indicatorAddr && (
                      <div>
                        indicator (resource acct):{" "}
                        <a
                          className="text-emerald-400 underline"
                          href={`https://explorer.aptoslabs.com/account/${vaultDeploy.artifacts.indicatorAddr}?network=testnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {vaultDeploy.artifacts.indicatorAddr.slice(0, 18)}…
                        </a>
                      </div>
                    )}
                    {vaultDeploy.artifacts.sourceHash && (
                      <div>source hash (commitment): {vaultDeploy.artifacts.sourceHash.slice(0, 22)}…</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Editor content area */}
            <div className="h-[350px] lg:flex-1 lg:min-h-[250px]">
              {activeTab === "pine" ? (
                <MonacoEditor
                  key="pine-editor"
                  height="100%"
                  defaultLanguage="python"
                  theme="vs-dark"
                  value={pineScript}
                  onChange={(val) => { if (val && val.length > 5) handleScriptChange(val); }}
                  options={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    minimap: { enabled: false },
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    padding: { top: 12, bottom: 12 },
                    renderLineHighlight: "gutter",
                    smoothScrolling: true,
                  }}
                />
              ) : (
                <MonacoEditor
                  key={activeTab === "vault" ? "vault-editor" : "move-editor"}
                  height="100%"
                  defaultLanguage="move"
                  theme="vs-dark"
                  value={
                    activeTab === "vault"
                      ? (vaultSource || "// Generating trustless vault module...")
                      : (moveSource || "// Generating Move module...")
                  }
                  beforeMount={(monaco) => {
                    if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "move")) {
                      monaco.languages.register({ id: "move" });
                      monaco.languages.setMonarchTokensProvider("move", {
                        keywords: [
                          "module", "struct", "fun", "public", "entry", "use", "let", "if", "else",
                          "while", "loop", "return", "abort", "acquires", "has", "const", "friend",
                          "native", "spec", "move_to", "move_from", "borrow_global", "borrow_global_mut",
                          "exists", "assert", "true", "false", "copy", "drop", "store", "key",
                        ],
                        typeKeywords: [
                          "u8", "u16", "u32", "u64", "u128", "u256", "bool", "address", "signer",
                          "vector", "string", "String", "Table", "Object",
                        ],
                        operators: ["+", "-", "*", "/", "%", "=", "==", "!=", "<", ">", "<=", ">=", "&&", "||", "!", "&", "&mut"],
                        tokenizer: {
                          root: [
                            [/#\[[\w]+\]/, "annotation"],
                            [/\/\/.*$/, "comment"],
                            [/\/\*/, "comment", "@comment"],
                            [/"[^"]*"/, "string"],
                            [/b"[^"]*"/, "string"],
                            [/0x[0-9a-fA-F_]+/, "number.hex"],
                            [/[0-9][0-9_]*/, "number"],
                            [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@typeKeywords": "type", "@default": "identifier" } }],
                            [/[{}()\[\]]/, "@brackets"],
                            [/[;,.]/, "delimiter"],
                            [/::\w+/, "namespace"],
                          ],
                          comment: [
                            [/[^/*]+/, "comment"],
                            [/\*\//, "comment", "@pop"],
                            [/[/*]/, "comment"],
                          ],
                        },
                      });
                    }
                  }}
                  options={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    minimap: { enabled: false },
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "off",
                    padding: { top: 12, bottom: 12 },
                    renderLineHighlight: "gutter",
                    smoothScrolling: true,
                    readOnly: true,
                  }}
                />
              )}
            </div>
          </div>

        </div>

        {/* ── RIGHT COLUMN: sidebar ── */}
        <div className="flex flex-col min-w-0 bg-[#0f0f0f] rounded-2xl border border-white/[0.06] overflow-hidden min-h-[560px]">
          {/* Analysis */}
          <div className="p-3 lg:block hidden">
            <TranspilerPreview preview={preview} name={name} symbol={symbol} asset={asset} />
          </div>

          {/* Indicator Info */}
          <div className="px-3 pb-3 pt-2 border-t border-white/[0.04]">
            {/* Name + Symbol row */}
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                {editingName ? (
                  <input
                    autoFocus
                    value={nameOverride ?? autoMeta.name}
                    onChange={(e) => setNameOverride(e.target.value)}
                    onBlur={() => setEditingName(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-[13px] text-white focus:outline-none focus:border-purple-500/40"
                  />
                ) : (
                  <button onClick={() => setEditingName(true)} className="text-left group">
                    <div className="text-[13px] font-semibold text-white truncate group-hover:text-purple-300 transition-colors">{name}</div>
                    <div className="text-[9px] text-zinc-600 font-mono">{symbol} · {asset}</div>
                  </button>
                )}
              </div>
              {!(connected && account) && (
                <span className="text-[8px] text-zinc-600 shrink-0 mt-1">no wallet</span>
              )}
            </div>
          </div>

          {/* 3. Monetization */}
          <div className="px-3 py-3 border-t border-white/[0.04] space-y-3">
            {/* Proprietary toggle — inline row */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-[11px] font-medium text-zinc-300">Proprietary</p>
                <p className="text-[9px] text-zinc-600 leading-tight mt-0.5">SHA-256 hash committed on-chain, script hidden</p>
              </div>
              <div className="relative shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={isProprietary}
                  onChange={(e) => {
                    setIsProprietary(e.target.checked);
                    if (e.target.checked && pineScript.trim()) {
                      computeHash(pineScript);
                    } else if (!e.target.checked) {
                      setAlgoHash("");
                    }
                  }}
                  className="sr-only"
                />
                <div className={cn("w-8 h-4 rounded-full transition-colors duration-200", isProprietary ? "bg-amber-500" : "bg-zinc-700 group-hover:bg-zinc-600")} />
                <div className={cn("absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200", isProprietary ? "translate-x-4" : "translate-x-0")} />
              </div>
            </label>

            {isProprietary && (
              <div className="space-y-2 pt-2 border-t border-white/[0.04]">
                {/* Fee model row */}
                <div className="flex items-center gap-2">
                  <select
                    value={feeModel}
                    onChange={(e) => setFeeModel(e.target.value as "none" | "flat" | "profit_share")}
                    className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-white/15 appearance-none"
                  >
                    <option value="profit_share">Profit Share</option>
                    <option value="flat">Flat (bps/trade)</option>
                    <option value="none">No fee</option>
                  </select>
                  {feeModel !== "none" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number"
                        value={feeModel === "profit_share" ? feeBps / 100 : feeBps}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (isNaN(v)) return;
                          setFeeBps(feeModel === "profit_share" ? Math.round(v * 100) : Math.round(v));
                        }}
                        min={0}
                        max={feeModel === "profit_share" ? 50 : 1000}
                        step={feeModel === "profit_share" ? 0.5 : 1}
                        className="w-16 bg-white/[0.04] border border-white/[0.06] rounded-lg px-2 py-1.5 text-[11px] text-white font-mono focus:outline-none focus:border-white/15 text-right"
                      />
                      <span className="text-[9px] text-zinc-600">{feeModel === "profit_share" ? "%" : "bps"}</span>
                    </div>
                  )}
                </div>

                {/* Algorithm hash */}
                {algoHash ? (
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/6 border border-amber-500/12">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <p className="text-[9px] font-mono text-amber-400/80 truncate flex-1">{algoHash.slice(0, 8)}…{algoHash.slice(-6)}</p>
                    <button
                      type="button"
                      onClick={() => computeHash(pineScript)}
                      disabled={isHashing}
                      className="text-[8px] text-zinc-600 hover:text-zinc-400 shrink-0"
                    >
                      {isHashing ? "…" : "rehash"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => computeHash(pineScript)}
                    disabled={isHashing || !pineScript.trim()}
                    className="w-full text-[10px] text-amber-400/70 hover:text-amber-300 disabled:text-zinc-700 transition-colors font-mono py-1 text-left"
                  >
                    {isHashing ? "Computing hash…" : "+ Compute SHA-256 hash"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {(error || step === "error") && (
            <div className="px-3 pb-2">
              <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-400 leading-tight">{error}</p>
              </div>
            </div>
          )}

          {/* Deploy button */}
          <div className="mt-auto p-3 border-t border-white/[0.04] sticky bottom-0 bg-[#0f0f0f]">
            <button
              onClick={handleDeploy}
              disabled={step === "done"}
              className={cn(
                "w-full py-2.5 rounded-xl text-[13px] font-semibold tracking-wide transition-all duration-200",
                step === "done"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 cursor-default"
                  : "text-white hover:opacity-90 active:scale-[0.98]"
              )}
              style={step !== "done" ? { background: "#39ff14", color: "#050505" } : undefined}
            >
              {step === "done" ? "Deployed ✓" : "Transpile & Deploy"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Indicator visual preview (below the grid) ── */}
      <div className="mt-3">
        <PineVisualPreview pineScript={pineScript} />
      </div>
    </div>
  );
}

function StepDot({ done, active, label }: { done?: boolean; active?: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-1", done ? "text-green-400" : active ? "text-white" : "text-zinc-600")}>
      <span>{done ? "✓" : active ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}
