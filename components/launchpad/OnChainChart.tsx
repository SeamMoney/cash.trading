"use client";

/**
 * IndicatorChart (replaces OnChainChart) — local bklit candlestick chart
 * with real indicator overlays, sub-panes for RSI/MACD, and BUY/SELL markers.
 *
 * Data layers:
 *  1. Pyth Benchmarks OHLCV candles (historical, via /api/launchpad/candles)
 *  2. Indicator lines computed client-side from those candles
 *  3. On-chain state (current live signal + push button)
 *
 * Indicator types:
 *  0 = SMA crossover  — two SMA lines overlaid on price
 *  1 = EMA crossover  — two EMA lines overlaid on price
 *  2 = RSI            — sub-pane with RSI line + 30/70 bands
 *  3 = MACD           — sub-pane with MACD line, signal, histogram
 *  4 = Bollinger Bands — upper/mid/lower bands overlaid on price
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { explorerAccountUrl } from "@/lib/constants";
import {
  BklitCandlePlot,
  type BklitPlotLine,
  type BklitPlotMarker,
} from "@/components/trade/BklitCandlePlot";
import {
  LaunchpadIndicatorPane,
  type LaunchpadIndicatorLine,
  type LaunchpadIndicatorPoint,
} from "@/components/launchpad/LaunchpadIndicatorPane";
import { appendLivePriceCandle } from "@/lib/trade/candleSeries";

// ─── TA computation (mirrors Move contract math) ─────────────────────────────

function sma(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += prices[j];
    return s / period;
  });
}

function ema(prices: number[], period: number): (number | null)[] {
  if (prices.length < period) return new Array(prices.length).fill(null);
  const out: (number | null)[] = new Array(period - 1).fill(null);
  const k = 2 / (period + 1);
  let val = prices.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out.push(val);
  for (let i = period; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
    out.push(val);
  }
  return out;
}

function rsi(prices: number[], period: number): (number | null)[] {
  if (prices.length <= period) return new Array(prices.length).fill(null);
  const out: (number | null)[] = new Array(period).fill(null);
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) avgG += d; else avgL += -d;
  }
  avgG /= period; avgL /= period;
  const rsiVal = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out.push(rsiVal(avgG, avgL));
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out.push(rsiVal(avgG, avgL));
  }
  return out;
}

interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
}

function macd(prices: number[], fast: number, slow: number, sig: number): MACDResult {
  const fastLine = ema(prices, fast);
  const slowLine = ema(prices, slow);
  const macdLine: (number | null)[] = prices.map((_, i) => {
    const f = fastLine[i], s = slowLine[i];
    return f !== null && s !== null ? f - s : null;
  });
  // EMA of the MACD line (signal)
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const sigEma = ema(validMacd, sig);
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal: (number | null)[] = [
    ...new Array(firstValid + Math.max(0, sig - 1)).fill(null),
    ...sigEma.filter((v) => v !== null),
  ];
  const hist: (number | null)[] = macdLine.map((m, i) => {
    const s = signal[i];
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal, hist };
}

interface BBResult { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[]; }

function bollinger(prices: number[], period: number, mult: number): BBResult {
  const upper: (number | null)[] = [], mid: (number | null)[] = [], lower: (number | null)[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper.push(mean + mult * std);
    mid.push(mean);
    lower.push(mean - mult * std);
  }
  return { upper, mid, lower };
}

interface Marker { time: number; signal: 1 | 2; }

function computeMarkers(
  prices: number[], times: number[],
  type: number, short: number, long: number, third: number,
): Marker[] {
  const out: Marker[] = [];
  let fast: (number | null)[] = [], slow: (number | null)[] = [];

  if (type === 0) { fast = sma(prices, short); slow = sma(prices, long); }
  else if (type === 1) { fast = ema(prices, short); slow = ema(prices, long); }
  else if (type === 2) {
    const r = rsi(prices, short);
    let prev = 0;
    r.forEach((v, i) => {
      if (v === null) return;
      const sig = v < 30 ? 1 : v > 70 ? 2 : 0;
      if (sig && sig !== prev) out.push({ time: times[i], signal: sig as 1 | 2 });
      if (sig) prev = sig;
    });
    return out;
  } else if (type === 3) {
    const res = macd(prices, short, long, third || 9);
    fast = res.macd; slow = res.signal;
  } else if (type === 4) {
    const bb = bollinger(prices, short, (third || 20) / 10);
    let prev = 0;
    prices.forEach((p, i) => {
      const l = bb.lower[i], u = bb.upper[i];
      if (l === null || u === null) return;
      const sig = p < l ? 1 : p > u ? 2 : 0;
      if (sig && sig !== prev) out.push({ time: times[i], signal: sig as 1 | 2 });
      if (sig) prev = sig;
    });
    return out;
  }

  let prev = 0;
  for (let i = 1; i < fast.length; i++) {
    const f = fast[i], s = slow[i];
    if (f === null || s === null) continue;
    const sig = f > s ? 1 : f < s ? 2 : 0;
    if (sig && sig !== prev) out.push({ time: times[i], signal: sig as 1 | 2 });
    if (sig) prev = sig;
  }
  return out;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number; }

interface OnChainState {
  signal: number; fastLine: number; slowLine: number; lastPrice: number;
  lastSignalTime: number; totalPushed: number; totalSignals: number;
  inPosition: boolean; entryPrice: number; realizedGainBps: number;
  /** Unix-seconds timestamps of the on-chain price buffer (last = freshest). */
  timestamps?: number[];
  error?: string; onChain?: boolean; unavailable?: boolean; reason?: string;
}

const ENGINE_STALE_AFTER_MS = 30 * 60_000;

function engineDataAgo(sec: number): string {
  const mins = Math.floor((Date.now() / 1000 - sec) / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface DecibelExecution {
  success?: boolean; decibelTxHash?: string; side?: string; size?: number;
  marketName?: string; entryPrice?: number; subaccount?: string;
  explorerUrl?: string; error?: string;
}

// ─── Timeframes ───────────────────────────────────────────────────────────────

const TFS = [
  { label: "5m",  resolution: "5",   days: 2   },
  { label: "15m", resolution: "15",  days: 7   },
  { label: "1H",  resolution: "60",  days: 21  },
  { label: "4H",  resolution: "240", days: 60  },
  { label: "1D",  resolution: "D",   days: 180 },
] as const;
type TF = typeof TFS[number];

function timeframeSeconds(tf: TF) {
  return tf.resolution === "D" ? 86_400 : Number(tf.resolution) * 60;
}

function displayPriceDecimals(price: number) {
  if (price >= 100) return 2;
  if (price >= 1) return 4;
  return 6;
}

const INDICATOR_LABEL: Record<number, string> = {
  0: "SMA", 1: "EMA", 2: "RSI", 3: "MACD", 4: "BB",
};
const SIG_LABEL = ["NEUTRAL", "BUY", "SELL"];
const SIG_COLOR = ["text-zinc-400", "text-emerald-400", "text-red-400"];
const SIG_BG    = [
  "bg-[#1a1a1a] border-[#2a2a2a]",          // neutral
  "bg-emerald-500/15 border-emerald-500/25",   // buy
  "bg-red-500/15 border-red-500/25",           // sell
];

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  indicatorAddr: string;
  asset: string;
  indicatorType?: number;
  shortPeriod?: number;
  longPeriod?: number;
  thirdPeriod?: number;
  refreshMs?: number;
  decibelMarket?: string;
  decibelSize?: number;
}

export function OnChainChart({
  indicatorAddr, asset,
  indicatorType = 0, shortPeriod = 10, longPeriod = 30, thirdPeriod = 0,
  refreshMs = 15_000, decibelMarket, decibelSize = 0.001,
}: Props) {
  const candleAbortRef = useRef<AbortController | null>(null);
  const onChainAbortRef = useRef<AbortController | null>(null);

  const [candles,     setCandles]     = useState<Candle[]>([]);
  const [tf,          setTf]          = useState<TF>(TFS[0]);
  const [loadingC,    setLoadingC]    = useState(true);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [onChain,     setOnChain]     = useState<OnChainState | null>(null);
  const [pushing,     setPushing]     = useState(false);
  const [lastPush,    setLastPush]    = useState<string | null>(null);
  const [decibelTx,   setDecibelTx]   = useState<DecibelExecution | null>(null);
  const [connectDec,  setConnectDec]  = useState(!!decibelMarket);
  const manualKeeperEnabled = process.env.NODE_ENV !== "production";

  // ── Signal flash on change ───────────────────────────────────────────────────
  const prevSigRef = useRef<number>(0);
  const [sigFlashing, setSigFlashing] = useState(false);
  const currentSig = onChain?.signal ?? 0;

  useEffect(() => {
    if (prevSigRef.current !== currentSig && currentSig !== 0) {
      setSigFlashing(true);
      const t = setTimeout(() => setSigFlashing(false), 700);
      prevSigRef.current = currentSig;
      return () => clearTimeout(t);
    }
    prevSigRef.current = currentSig;
  }, [currentSig]);

  // ── Fetch Pyth OHLCV candles ────────────────────────────────────────────────
  const fetchCandles = useCallback(async () => {
    candleAbortRef.current?.abort();
    const controller = new AbortController();
    candleAbortRef.current = controller;
    setLoadingC(true);
    setCandleError(null);
    setCandles([]);
    try {
      const res  = await fetch(
        `/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=${tf.resolution}&days=${tf.days}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`Candle history returned ${res.status}`);
      const data = await res.json() as { candles?: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }[] };
      if (!Array.isArray(data.candles)) throw new Error("Candle history returned an invalid payload");
      const byTimestamp = new Map<number, Candle>();
      for (const candle of data.candles) {
        const { timestamp, open, high, low, close, volume } = candle;
        if (
          !Number.isSafeInteger(timestamp) || timestamp <= 0 ||
          ![open, high, low, close].every(Number.isFinite) ||
          open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
          high < Math.max(open, close) || low > Math.min(open, close) ||
          (volume !== undefined && (!Number.isFinite(volume) || volume < 0))
        ) {
          continue;
        }
        byTimestamp.set(timestamp, {
          time: timestamp,
          open,
          high,
          low,
          close,
          volume,
        });
      }
      if (!controller.signal.aborted) {
        setCandles([...byTimestamp.values()].sort((a, b) => a.time - b.time));
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setCandleError("Price history is temporarily unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setLoadingC(false);
    }
  }, [asset, tf]);

  // ── Fetch on-chain state ────────────────────────────────────────────────────
  const fetchOnChain = useCallback(async () => {
    onChainAbortRef.current?.abort();
    const controller = new AbortController();
    onChainAbortRef.current = controller;
    try {
      const res = await fetch(
        `/api/launchpad/on-chain?addr=${indicatorAddr}`,
        { signal: controller.signal },
      );
      const data = await res.json().catch(() => null) as OnChainState | null;
      if (!res.ok || !data) {
        throw new Error(data?.reason ?? `On-chain state returned ${res.status}`);
      }
      if (!controller.signal.aborted) setOnChain(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setOnChain({
          signal: 0,
          fastLine: 0,
          slowLine: 0,
          lastPrice: 0,
          lastSignalTime: 0,
          totalPushed: 0,
          totalSignals: 0,
          inPosition: false,
          entryPrice: 0,
          realizedGainBps: 0,
          onChain: false,
          unavailable: true,
          error: error instanceof Error ? error.message : "On-chain state is unavailable",
        });
      }
    }
  }, [indicatorAddr]);

  useEffect(() => {
    void fetchCandles();
    return () => candleAbortRef.current?.abort();
  }, [fetchCandles]);
  useEffect(() => {
    void fetchOnChain();
    const t = setInterval(() => { void fetchOnChain(); }, refreshMs);
    return () => {
      clearInterval(t);
      onChainAbortRef.current?.abort();
    };
  }, [fetchOnChain, refreshMs]);

  // ── Fast Pyth price polling — updates chart every 5s ─────────────────────
  const intervalSeconds = timeframeSeconds(tf);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/launchpad/price-tick?asset=${encodeURIComponent(asset)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const price = d.price as number;
        if (!price || price <= 0 || cancelled) return;
        const timestamp = Number(d.timestamp);
        const liveTime = Number.isFinite(timestamp) && timestamp > 0
          ? timestamp
          : Date.now() / 1_000;
        setCandles((current) => appendLivePriceCandle(
          current,
          price,
          liveTime,
          intervalSeconds,
        ));
      } catch { /* ignore */ }
    }

    tick();
    const t = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [asset, intervalSeconds]);

  // ── Push price (keeper) ─────────────────────────────────────────────────────
  async function pushPrice() {
    setPushing(true); setDecibelTx(null);
    try {
      const body: Record<string, unknown> = { indicatorAddr, asset };
      if (connectDec && decibelMarket) {
        body.executeOnDecibel = true;
        body.decibelMarket    = decibelMarket;
        body.decibelSize      = decibelSize;
      }
      const res  = await fetch("/api/launchpad/keeper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { txHash?: string; price?: number; decibel?: DecibelExecution; error?: string };
      if (data.txHash) {
        setLastPush(`$${data.price?.toFixed(2)} · tx: ${data.txHash.slice(0, 10)}…`);
        if (data.decibel) setDecibelTx(data.decibel);
        await fetchOnChain();
      } else {
        setLastPush(data.error ? `Error: ${data.error}` : "Push failed");
      }
    } catch (e) { setLastPush(`Error: ${e}`); }
    finally { setPushing(false); }
  }

  // ── Build bklit series ─────────────────────────────────────────────────────
  const chartLayers = useMemo(() => {
    const prices = candles.map((candle) => candle.close);
    const times = candles.map((candle) => candle.time);
    const mainLines: BklitPlotLine[] = [];
    const subLines: LaunchpadIndicatorLine[] = [];
    let histogram: LaunchpadIndicatorPoint[] = [];
    let guides: Array<{ id: string; value: number; color: string }> = [];
    let subDomain: [number, number] | undefined;
    let subLabel = "";

    const toPoints = (values: (number | null)[]) => values.flatMap((value, index) => (
      value !== null && Number.isFinite(value)
        ? [{ time: times[index], value }]
        : []
    ));

    if (indicatorType === 0 || indicatorType === 1) {
      const label = indicatorType === 0 ? "SMA" : "EMA";
      const calculate = indicatorType === 0 ? sma : ema;
      mainLines.push(
        {
          id: `${label}-${shortPeriod}`,
          color: "#22c55e",
          dash: "4 4",
          width: 1,
          data: toPoints(calculate(prices, shortPeriod)),
        },
        {
          id: `${label}-${longPeriod}`,
          color: "#f97316",
          dash: "4 4",
          width: 1,
          data: toPoints(calculate(prices, longPeriod)),
        },
      );
    } else if (indicatorType === 2) {
      subLabel = `RSI(${shortPeriod})`;
      subDomain = [0, 100];
      guides = [
        { id: "overbought", value: 70, color: "#ef444460" },
        { id: "oversold", value: 30, color: "#22c55e60" },
      ];
      subLines.push({
        id: "rsi",
        color: "#a78bfa",
        data: toPoints(rsi(prices, shortPeriod)),
      });
    } else if (indicatorType === 3) {
      const fast = shortPeriod || 12;
      const slow = longPeriod || 26;
      const signalPeriod = thirdPeriod || 9;
      const result = macd(prices, fast, slow, signalPeriod);
      subLabel = `MACD(${fast},${slow},${signalPeriod})`;
      guides = [{ id: "zero", value: 0, color: "#52525b80" }];
      subLines.push(
        { id: "macd", color: "#22c55e", data: toPoints(result.macd) },
        { id: "signal", color: "#f97316", data: toPoints(result.signal) },
      );
      histogram = toPoints(result.hist);
    } else if (indicatorType === 4) {
      const bands = bollinger(prices, shortPeriod, (thirdPeriod || 20) / 10);
      mainLines.push(
        { id: "bb-upper", color: "#60a5fa", width: 1, data: toPoints(bands.upper) },
        { id: "bb-mid", color: "#60a5fa80", dash: "4 4", width: 1, data: toPoints(bands.mid) },
        { id: "bb-lower", color: "#60a5fa", width: 1, data: toPoints(bands.lower) },
      );
    }

    const candlesByTime = new Map(candles.map((candle) => [candle.time, candle]));
    const markers: BklitPlotMarker[] = computeMarkers(
      prices,
      times,
      indicatorType,
      shortPeriod,
      longPeriod,
      thirdPeriod,
    ).flatMap((marker, index) => {
      const candle = candlesByTime.get(marker.time);
      if (!candle) return [];
      const buy = marker.signal === 1;
      return [{
        id: `${marker.time}:${marker.signal}:${index}`,
        time: marker.time,
        price: buy ? candle.low : candle.high,
        side: buy ? "buy" as const : "sell" as const,
        label: buy ? "B" : "S",
      }];
    });

    return { guides, histogram, mainLines, markers, subDomain, subLabel, subLines };
  }, [candles, indicatorType, longPeriod, shortPeriod, thirdPeriod]);

  // ── Derived display values ───────────────────────────────────────────────────
  const hasOnChain  = !!onChain && onChain.onChain !== false && !onChain.error;
  const sig         = onChain?.signal ?? 0;
  const iLabel      = INDICATOR_LABEL[indicatorType] ?? "Indicator";
  const hasSubPane  = indicatorType === 2 || indicatorType === 3;
  const latestPrice = candles.at(-1)?.close ?? onChain?.lastPrice ?? 0;

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2a] gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold text-white">{asset}</span>
          <span className="text-[10px] text-zinc-600">·</span>
          <span className="text-[10px] text-zinc-500">{iLabel}({shortPeriod}{longPeriod !== shortPeriod ? `,${longPeriod}` : ""})</span>
          {hasOnChain && (
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded border transition-all",
              SIG_BG[sig], SIG_COLOR[sig],
              sigFlashing && sig === 1 && "signal-bloom-buy",
              sigFlashing && sig === 2 && "signal-bloom-sell",
            )}>
              {SIG_LABEL[sig]}
            </span>
          )}
          {loadingC && (
            <span className="text-[10px] text-zinc-600 animate-pulse">loading…</span>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Timeframe picker */}
          <div className="flex gap-0.5">
            {TFS.map((t) => (
              <button
                key={t.label}
                onClick={() => setTf(t)}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded transition-colors",
                  t.label === tf.label
                    ? "bg-zinc-700 text-white"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Decibel toggle */}
          {manualKeeperEnabled && decibelMarket && (
            <button
              onClick={() => setConnectDec((v) => !v)}
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors",
                connectDec
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                  : "border-zinc-800 text-zinc-600 hover:text-zinc-400",
              )}
            >
              <span className={cn("w-1 h-1 rounded-full", connectDec ? "bg-violet-400" : "bg-zinc-600")} />
              Decibel
            </button>
          )}

          {/* Push price */}
          {manualKeeperEnabled && (
            <button
              onClick={pushPrice}
              disabled={pushing}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded border transition-colors",
                pushing
                  ? "border-zinc-800 text-zinc-600 cursor-wait"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white",
              )}
            >
              {pushing ? "Pushing…" : connectDec ? "Push + Execute" : "Push Price"}
            </button>
          )}
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────────── */}
      <div className="relative h-[420px] w-full">
        {candles.length > 0 && (
          <BklitCandlePlot
            candles={candles}
            currentPrice={latestPrice}
            intervalSeconds={intervalSeconds}
            lines={chartLayers.mainLines}
            markers={chartLayers.markers}
            priceDecimals={displayPriceDecimals(latestPrice)}
          />
        )}
      </div>
      {hasSubPane && (
        <LaunchpadIndicatorPane
          domain={chartLayers.subDomain}
          guides={chartLayers.guides}
          histogram={chartLayers.histogram}
          label={chartLayers.subLabel}
          lines={chartLayers.subLines}
        />
      )}

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-t border-[#1e1e1e] text-[10px] text-zinc-600 flex-wrap">
        {hasOnChain ? (
          <>
            {(() => {
              // The engine values freeze at the last crank — presenting a
              // weeks-old price as current next to the live chart is worse
              // than saying nothing. Dim the values and date them when old.
              const lastDataSec =
                onChain!.timestamps?.[onChain!.timestamps.length - 1] ??
                onChain!.lastSignalTime ?? 0;
              const stale =
                lastDataSec > 0 &&
                Date.now() - lastDataSec * 1000 > ENGINE_STALE_AFTER_MS;
              const valueColor = stale ? "zinc-600" : "zinc-300";
              const fastColor = stale ? "zinc-600" : "emerald-400";
              const slowColor = stale ? "zinc-600" : "orange-400";
              return (
                <>
                  {stale && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono font-semibold uppercase text-amber-400">
                      engine data {engineDataAgo(lastDataSec)}
                    </span>
                  )}
                  <Stat label="price"  value={`$${onChain!.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color={valueColor} />
                  {indicatorType !== 2 && indicatorType !== 3 && (
                    <>
                      <Stat label="fast"   value={`$${onChain!.fastLine.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} color={fastColor} />
                      <Stat label="slow"   value={`$${onChain!.slowLine.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} color={slowColor}  />
                    </>
                  )}
                </>
              );
            })()}
            <a
              href={explorerAccountUrl(indicatorAddr, "testnet")}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-purple-400 transition-colors underline decoration-zinc-700 underline-offset-2"
            >
              {onChain!.totalPushed} on-chain · {onChain!.totalSignals} signals
            </a>
            {onChain!.inPosition && (
              <span className="text-emerald-400">IN @ ${onChain!.entryPrice.toFixed(2)}</span>
            )}
            {onChain!.realizedGainBps > 0 && (
              <span className="text-emerald-400">+{(onChain!.realizedGainBps / 100).toFixed(2)}% realized</span>
            )}
          </>
        ) : (
          <span className="text-zinc-700">
            {loadingC
              ? "Fetching Pyth candles…"
              : candleError
                ? candleError
                : onChain?.unavailable
                  ? `${candles.length} candles · on-chain state temporarily unavailable`
                  : `${candles.length} candles · computed locally`}
          </span>
        )}
        {!loadingC && candles.length > 0 && (
          <span className="ml-auto text-zinc-700">{candles.length} {tf.label} candles</span>
        )}
      </div>

      {/* ── Last push line ───────────────────────────────────────────────────── */}
      {manualKeeperEnabled && lastPush && (
        <div className="px-3 pb-1.5">
          <p className="text-[10px] text-zinc-700 font-mono truncate">{lastPush}</p>
        </div>
      )}

      {/* ── Decibel execution badge ──────────────────────────────────────────── */}
      {manualKeeperEnabled && decibelTx && (
        <div className={cn(
          "mx-3 mb-3 rounded-lg border px-3 py-2 text-[11px]",
          decibelTx.error
            ? "border-red-500/20 bg-red-500/5 text-red-400"
            : "border-violet-500/25 bg-violet-500/8 text-violet-300",
        )}>
          {decibelTx.error ? (
            <span>Decibel error: {decibelTx.error}</span>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={cn("font-bold uppercase text-[10px] px-1 py-0.5 rounded",
                  decibelTx.side === "long" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400")}>
                  {decibelTx.side?.toUpperCase()}
                </span>
                <span className="font-mono text-zinc-300">{decibelTx.size} {decibelTx.marketName?.split("/")[0]}</span>
                <span className="text-zinc-500">on Decibel</span>
              </div>
              {decibelTx.explorerUrl && (
                <a href={decibelTx.explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-violet-400/70 hover:text-violet-400">tx →</a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span>
      <span className={`font-mono text-${color}`}>{value}</span>
      {" "}{label}
    </span>
  );
}
