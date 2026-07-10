"use client";

/**
 * IndicatorChart (replaces OnChainChart) — TradingView-style candlestick chart
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

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { explorerAccountUrl } from "@/lib/constants";

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
  error?: string; onChain?: boolean;
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
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef  = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartsRef = useRef<{ main: any; sub: any } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);

  const [candles,     setCandles]     = useState<Candle[]>([]);
  const [tf,          setTf]          = useState<TF>(TFS[0]);
  const [loadingC,    setLoadingC]    = useState(true);
  const [onChain,     setOnChain]     = useState<OnChainState | null>(null);
  const [pushing,     setPushing]     = useState(false);
  const [lastPush,    setLastPush]    = useState<string | null>(null);
  const [decibelTx,   setDecibelTx]   = useState<DecibelExecution | null>(null);
  const [connectDec,  setConnectDec]  = useState(!!decibelMarket);

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
    setLoadingC(true);
    try {
      const res  = await fetch(`/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=${tf.resolution}&days=${tf.days}`);
      const data = await res.json() as { candles?: { timestamp: number; open: number; high: number; low: number; close: number; volume?: number }[] };
      if (data.candles?.length) {
        setCandles(data.candles.map((c) => ({
          time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        })));
      }
    } catch { /* network error — chart stays empty */ }
    finally { setLoadingC(false); }
  }, [asset, tf]);

  // ── Fetch on-chain state ────────────────────────────────────────────────────
  const fetchOnChain = useCallback(async () => {
    try {
      const res  = await fetch(`/api/launchpad/on-chain?addr=${indicatorAddr}`);
      setOnChain(await res.json());
    } catch { /* ignore */ }
  }, [indicatorAddr]);

  useEffect(() => { fetchCandles(); }, [fetchCandles]);
  useEffect(() => {
    fetchOnChain();
    const t = setInterval(fetchOnChain, refreshMs);
    return () => clearInterval(t);
  }, [fetchOnChain, refreshMs]);

  // ── Fast Pyth price polling — updates chart every 5s ─────────────────────
  const livePriceRef = useRef(0);

  useEffect(() => {
    if (candles.length === 0) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/launchpad/price-tick?asset=${encodeURIComponent(asset)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const price = d.price as number;
        if (!price || price <= 0 || cancelled) return;

        livePriceRef.current = price;

        // Update the last candle with the live price
        if (candleSeriesRef.current) {
          const last = candles[candles.length - 1];
          candleSeriesRef.current.update({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            time: last.time as any,
            open: last.open,
            high: Math.max(last.high, price),
            low: Math.min(last.low, price),
            close: price,
          });
        }
      } catch { /* ignore */ }
    }

    tick();
    const t = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [asset, candles]);

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

  // ── Build charts ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainRef.current || candles.length === 0) return;
    let disposed = false;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (disposed || !mainRef.current) return;

      // Destroy previous instances
      chartsRef.current?.main?.remove();
      chartsRef.current?.sub?.remove();
      chartsRef.current = null;

      const prices = candles.map((c) => c.close);
      const times  = candles.map((c) => c.time);
      const hasSubPane = indicatorType === 2 || indicatorType === 3;

      const baseOpts = {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#52525b",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "#18181b" },
          horzLines: { color: "#18181b" },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: "#27272a" },
        timeScale: { borderColor: "#27272a", timeVisible: true },
      };

      // ── Main chart (candlesticks) ─────────────────────────────────────────
      const mainH = 420;

      const main = createChart(mainRef.current!, {
        ...baseOpts,
        width: mainRef.current!.clientWidth,
        height: mainH,
      });

      // Candlestick series
      const candleSeries = main.addCandlestickSeries({
        upColor:         "#22c55e",
        downColor:       "#ef4444",
        borderUpColor:   "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor:     "#22c55e",
        wickDownColor:   "#ef4444",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candleData = candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }));
      candleSeries.setData(candleData);
      candleSeriesRef.current = candleSeries;

      // Volume histogram (subtle, bottom 20% of chart)
      if (candles.some((c) => c.volume)) {
        const volSeries = main.addHistogramSeries({
          priceFormat:  { type: "volume" },
          priceScaleId: "vol",
        });
        main.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        volSeries.setData(candles.map((c) => ({
          time:  c.time as any,
          value: c.volume || 0,
          color: c.close >= c.open ? "#22c55e18" : "#ef444418",
        })));
      }

      // ── Indicator overlay on price chart ────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toSeries = (vals: (number | null)[]): any[] =>
        vals.map((v, i) => v !== null ? { time: times[i] as any, value: v } : null).filter(Boolean);

      if (indicatorType === 0 || indicatorType === 1) {
        const label  = indicatorType === 0 ? "SMA" : "EMA";
        const fn     = indicatorType === 0 ? sma : ema;
        const fSer   = main.addLineSeries({ color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed,
          title: `${label}${shortPeriod}`, priceLineVisible: false, lastValueVisible: false });
        const sSer   = main.addLineSeries({ color: "#f97316", lineWidth: 1, lineStyle: LineStyle.Dashed,
          title: `${label}${longPeriod}`,  priceLineVisible: false, lastValueVisible: false });
        fSer.setData(toSeries(fn(prices, shortPeriod)));
        sSer.setData(toSeries(fn(prices, longPeriod)));

      } else if (indicatorType === 4) {
        const mult = (thirdPeriod || 20) / 10;
        const bb   = bollinger(prices, shortPeriod, mult);
        const uSer = main.addLineSeries({ color: "#60a5fa", lineWidth: 1,
          title: "BB Upper", priceLineVisible: false, lastValueVisible: false });
        const mSer = main.addLineSeries({ color: "#60a5fa80", lineWidth: 1, lineStyle: LineStyle.Dashed,
          title: "BB Mid",   priceLineVisible: false, lastValueVisible: false });
        const lSer = main.addLineSeries({ color: "#60a5fa", lineWidth: 1,
          title: "BB Lower", priceLineVisible: false, lastValueVisible: false });
        uSer.setData(toSeries(bb.upper));
        mSer.setData(toSeries(bb.mid));
        lSer.setData(toSeries(bb.lower));
      }

      // ── BUY/SELL markers on candlestick series ───────────────────────────
      const markers = computeMarkers(prices, times, indicatorType, shortPeriod, longPeriod, thirdPeriod);
      if (markers.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        candleSeries.setMarkers(markers.map((m) => ({
          time:     m.time as any,
          position: m.signal === 1 ? "belowBar" : "aboveBar",
          color:    m.signal === 1 ? "#22c55e" : "#ef4444",
          shape:    m.signal === 1 ? "arrowUp" : "arrowDown",
          text:     m.signal === 1 ? "B" : "S",
          size:     1,
        })));
      }

      main.timeScale().fitContent();

      // ── Sub-pane chart (RSI or MACD) ─────────────────────────────────────
      let sub: ReturnType<typeof createChart> | null = null;

      if (hasSubPane && subRef.current) {
        sub = createChart(subRef.current, {
          ...baseOpts,
          width:  subRef.current.clientWidth,
          height: 120,
          timeScale: { ...baseOpts.timeScale, visible: false },
          rightPriceScale: { borderColor: "#27272a", scaleMargins: { top: 0.1, bottom: 0.1 } },
        });

        if (indicatorType === 2) {
          // RSI
          const rsiVals  = rsi(prices, shortPeriod);
          const firstIdx = rsiVals.findIndex((v) => v !== null);
          const lastIdx  = prices.length - 1;

          const rsiSer = sub.addLineSeries({ color: "#a78bfa", lineWidth: 2,
            title: `RSI(${shortPeriod})`, priceLineVisible: false, lastValueVisible: true });
          rsiSer.setData(toSeries(rsiVals));

          const mkRef = (v: number) => [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { time: times[firstIdx] as any, value: v },
            { time: times[lastIdx]  as any, value: v },
          ];
          const ob = sub.addLineSeries({ color: "#ef444460", lineWidth: 1, lineStyle: LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false });
          const os = sub.addLineSeries({ color: "#22c55e60", lineWidth: 1, lineStyle: LineStyle.Dashed,
            priceLineVisible: false, lastValueVisible: false });
          ob.setData(mkRef(70));
          os.setData(mkRef(30));

        } else if (indicatorType === 3) {
          // MACD
          const fast2 = shortPeriod || 12;
          const slow2 = longPeriod  || 26;
          const sig2  = thirdPeriod || 9;
          const res   = macd(prices, fast2, slow2, sig2);

          const histSer  = sub.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
          const macdSer  = sub.addLineSeries({ color: "#22c55e", lineWidth: 2,
            title: `MACD(${fast2},${slow2})`, priceLineVisible: false, lastValueVisible: false });
          const sigSer   = sub.addLineSeries({ color: "#f97316",  lineWidth: 2,
            title: `Sig(${sig2})`,            priceLineVisible: false, lastValueVisible: false });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          histSer.setData(res.hist.map((v, i) => v !== null
            ? { time: times[i] as any, value: v, color: v >= 0 ? "#22c55e40" : "#ef444440" }
            : null).filter(Boolean) as any[]);
          macdSer.setData(toSeries(res.macd));
          sigSer.setData(toSeries(res.signal));
        }

        // Sync scrolling / zooming between charts (prevent infinite loop with flag)
        let syncing = false;
        main.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range || !sub) return;
          syncing = true;
          sub.timeScale().setVisibleLogicalRange(range);
          syncing = false;
        });
        sub.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (syncing || !range) return;
          syncing = true;
          main.timeScale().setVisibleLogicalRange(range);
          syncing = false;
        });
      }

      chartsRef.current = { main, sub };

      // Resize observer
      const ro = new ResizeObserver(() => {
        if (mainRef.current) main.applyOptions({ width: mainRef.current.clientWidth });
        if (subRef.current && sub) sub.applyOptions({ width: subRef.current.clientWidth });
      });
      ro.observe(mainRef.current!);
      if (subRef.current && sub) ro.observe(subRef.current);

      // Cleanup
      return () => {
        ro.disconnect();
        if (!disposed) {
          main.remove();
          sub?.remove();
          chartsRef.current = null;
        }
      };
    });

    return () => { disposed = true; };
  // Rebuilds when candles or indicator config changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, indicatorType, shortPeriod, longPeriod, thirdPeriod]);

  // ── Derived display values ───────────────────────────────────────────────────
  const hasOnChain  = !!onChain && onChain.onChain !== false && !onChain.error;
  const sig         = onChain?.signal ?? 0;
  const iLabel      = INDICATOR_LABEL[indicatorType] ?? "Indicator";
  const hasSubPane  = indicatorType === 2 || indicatorType === 3;

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
          {decibelMarket && (
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
        </div>
      </div>

      {/* ── Chart area ──────────────────────────────────────────────────────── */}
      <div ref={mainRef} className="w-full" />
      {hasSubPane && <div ref={subRef} className="w-full border-t border-[#1e1e1e]" />}

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
              href={explorerAccountUrl(indicatorAddr)}
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
          <span className="text-zinc-700">{loadingC ? "Fetching Pyth candles…" : `${candles.length} candles · computed locally`}</span>
        )}
        {!loadingC && candles.length > 0 && (
          <span className="ml-auto text-zinc-700">{candles.length} {tf.label} candles</span>
        )}
      </div>

      {/* ── Last push line ───────────────────────────────────────────────────── */}
      {lastPush && (
        <div className="px-3 pb-1.5">
          <p className="text-[10px] text-zinc-700 font-mono truncate">{lastPush}</p>
        </div>
      )}

      {/* ── Decibel execution badge ──────────────────────────────────────────── */}
      {decibelTx && (
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
