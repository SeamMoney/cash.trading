"use client";

/**
 * ProCandleChart keeps the existing CASH canvas shell and controls, but the
 * plotted marks are rendered by bklit's composable candlestick primitives.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  BklitCandlePlot,
  type BklitPlotCandle,
  type BklitPlotLine,
} from "@/components/trade/BklitCandlePlot";
import { TetherLoader } from "@/components/layout/TetherLoader";
import type { PerpMarketData } from "@/components/trade/perpMarketConfig";
import { getDecibelPublicNetwork } from "@/lib/decibel-public";
import {
  aggregateChartCandles,
  appendLivePriceCandle,
  interpolateOneSecondCandles,
  mergeCanonicalCandles,
} from "@/lib/trade/candleSeries";

type OverlayMode = "off" | "sma" | "ema" | "strategy";

type LiquidationLine = {
  id: string;
  price: number;
  side: "long" | "short";
};

interface ProCandleChartProps {
  market: PerpMarketData;
  active: boolean;
  liquidationLines: LiquidationLine[];
  overlayMode: OverlayMode;
  latestPrice: number;
  minuteCandles: BklitPlotCandle[];
  nowSeconds: number;
  secondCandles: BklitPlotCandle[];
}

type RestCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
};

export const CHART_INTERVALS = [
  "1s",
  "5s",
  "15s",
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
] as const;
export type ProChartInterval = (typeof CHART_INTERVALS)[number];

const INTERVAL_SECS: Record<ProChartInterval, number> = {
  "1s": 1,
  "5s": 5,
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

const DEFAULT_VISIBLE_BARS: Record<ProChartInterval, number> = {
  "1s": 90,
  "5s": 100,
  "15s": 100,
  "1m": 120,
  "5m": 120,
  "15m": 120,
  "1h": 120,
  "4h": 120,
  "1d": 120,
};

const INTERVAL_STORAGE_KEY = "cash:pro-chart-interval:v1";
const BOOTSTRAP_BARS = 500;
const MIN_VISIBLE_BARS = 30;
const MAX_VISIBLE_BARS = 220;

function loadStoredInterval(): ProChartInterval {
  if (typeof window === "undefined") return "1m";
  const stored = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
  return (CHART_INTERVALS as readonly string[]).includes(stored ?? "")
    ? stored as ProChartInterval
    : "1m";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sma(candles: BklitPlotCandle[], period: number) {
  const result: Array<{ time: number; value: number }> = [];
  let sum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    sum += candles[index].close;
    if (index >= period) sum -= candles[index - period].close;
    if (index >= period - 1) result.push({ time: candles[index].time, value: sum / period });
  }
  return result;
}

function ema(candles: BklitPlotCandle[], period: number) {
  const result: Array<{ time: number; value: number }> = [];
  const multiplier = 2 / (period + 1);
  let value = candles[0]?.close ?? 0;
  for (let index = 0; index < candles.length; index += 1) {
    value = index === 0 ? candles[0].close : candles[index].close * multiplier + value * (1 - multiplier);
    if (index >= period - 1) result.push({ time: candles[index].time, value });
  }
  return result;
}

function formatLegend(candle: BklitPlotCandle | undefined, decimals: number) {
  if (!candle) return "";
  const format = (value: number) => value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const change = candle.open > 0 ? (candle.close - candle.open) / candle.open * 100 : 0;
  return `O ${format(candle.open)}  H ${format(candle.high)}  L ${format(candle.low)}  C ${format(candle.close)}  ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function ProCandleChartComponent({
  market,
  active,
  liquidationLines,
  overlayMode,
  latestPrice,
  minuteCandles,
  nowSeconds,
  secondCandles,
}: ProCandleChartProps) {
  const [interval, setChartInterval] = useState<ProChartInterval>(loadStoredInterval);
  const [remoteResult, setRemoteResult] = useState<{ key: string; candles: BklitPlotCandle[] }>({ key: "", candles: [] });
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [offsetFromEnd, setOffsetFromEnd] = useState(0);
  const [visibleBars, setVisibleBars] = useState(() => DEFAULT_VISIBLE_BARS[loadStoredInterval()]);
  const [inspected, setInspected] = useState<BklitPlotCandle | null>(null);
  const interactionRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startOffset: number; width: number } | null>(null);

  const intervalSeconds = INTERVAL_SECS[interval];
  const remoteInterval = intervalSeconds >= 60;
  const remoteKey = `${getDecibelPublicNetwork()}:${market.marketAddr || market.marketName}:${interval}`;

  useEffect(() => {
    setVisibleBars(DEFAULT_VISIBLE_BARS[interval]);
    setOffsetFromEnd(0);
    setInspected(null);
  }, [interval, market.marketAddr, market.marketName]);

  useEffect(() => {
    const interactionNode = interactionRef.current;
    if (!interactionNode) return;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    interactionNode.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => interactionNode.removeEventListener("wheel", preventPageScroll);
  }, []);

  useEffect(() => {
    if (!active || !remoteInterval) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const load = async () => {
      controller = new AbortController();
      if (remoteResult.key !== remoteKey) setLoading(true);
      try {
        const params = new URLSearchParams({
          market: market.marketAddr || market.marketName,
          interval,
          bars: String(BOOTSTRAP_BARS),
          network: getDecibelPublicNetwork(),
        });
        const response = await fetch(`/api/decibel/candlesticks?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { candles?: RestCandle[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error || `candles ${response.status}`);
        if (cancelled) return;
        const candles = (payload.candles ?? []).map((candle) => ({
          time: Math.floor(candle.t / 1000),
          open: candle.o,
          high: candle.h,
          low: candle.l,
          close: candle.c,
          volume: candle.v ?? 0,
        })).sort((a, b) => a.time - b.time);
        setRemoteResult({ key: remoteKey, candles });
        setErrorText(null);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          setErrorText(error instanceof Error ? error.message : "Failed to load candles");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(load, Math.min(60_000, Math.max(10_000, intervalSeconds * 250)));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [active, interval, intervalSeconds, market.marketAddr, market.marketName, remoteInterval, remoteKey]);

  const sourceCandles = useMemo(() => {
    const liveTime = Math.max(secondCandles.at(-1)?.time ?? 0, nowSeconds);
    const continuousSeconds = interpolateOneSecondCandles(
      appendLivePriceCandle(secondCandles, latestPrice, liveTime, 1),
    );
    if (!remoteInterval) return aggregateChartCandles(continuousSeconds, intervalSeconds);
    const canonical = remoteResult.key === remoteKey ? remoteResult.candles : [];
    const withMinutes = interval === "1m"
      ? mergeCanonicalCandles(canonical, minuteCandles, intervalSeconds)
      : canonical;
    const merged = mergeCanonicalCandles(withMinutes, continuousSeconds, intervalSeconds);
    return appendLivePriceCandle(merged, latestPrice, liveTime, intervalSeconds);
  }, [interval, intervalSeconds, latestPrice, minuteCandles, nowSeconds, remoteInterval, remoteKey, remoteResult, secondCandles]);

  const maxOffset = Math.max(0, sourceCandles.length - MIN_VISIBLE_BARS);
  const safeOffset = clamp(offsetFromEnd, 0, maxOffset);
  const endIndex = Math.max(0, sourceCandles.length - safeOffset);
  const startIndex = Math.max(0, endIndex - visibleBars);
  const visibleCandles = sourceCandles.slice(startIndex, endIndex);
  const latestVisible = visibleCandles.at(-1);

  useEffect(() => {
    if (offsetFromEnd > maxOffset) setOffsetFromEnd(maxOffset);
  }, [maxOffset, offsetFromEnd]);

  const overlayLines = useMemo<BklitPlotLine[]>(() => {
    if (overlayMode === "off" || sourceCandles.length < 6) return [];
    const strategy = overlayMode === "strategy";
    const calculate = overlayMode === "ema" ? ema : sma;
    const fastPeriod = strategy ? 3 : 20;
    const slowPeriod = strategy ? 5 : 50;
    const startTime = visibleCandles[0]?.time ?? 0;
    const endTime = latestVisible?.time ?? Number.POSITIVE_INFINITY;
    return [
      {
        id: "fast",
        color: strategy ? "var(--success)" : "var(--chart-line-primary)",
        data: calculate(sourceCandles, fastPeriod).filter((point) => point.time >= startTime && point.time <= endTime),
      },
      {
        id: "slow",
        color: "var(--warning)",
        data: calculate(sourceCandles, slowPeriod).filter((point) => point.time >= startTime && point.time <= endTime),
      },
    ].filter((line) => line.data.length >= 2);
  }, [latestVisible?.time, overlayMode, sourceCandles, visibleCandles]);

  const handleIntervalChange = useCallback((next: ProChartInterval) => {
    setChartInterval(next);
    try {
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, next);
    } catch {
      // Storage is optional; interval switching remains functional in memory.
    }
  }, []);

  const snapToLive = useCallback(() => setOffsetFromEnd(0), []);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      const delta = event.deltaX || event.deltaY;
      setOffsetFromEnd((current) => clamp(
        current + Math.sign(delta) * Math.max(1, Math.round(visibleBars * 0.08)),
        0,
        maxOffset,
      ));
      return;
    }
    setVisibleBars((current) => clamp(
      Math.round(current * (event.deltaY > 0 ? 1.12 : 0.88)),
      MIN_VISIBLE_BARS,
      Math.min(MAX_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, sourceCandles.length)),
    ));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startOffset: safeOffset,
      width: rect.width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.width <= 0) return;
    const movedBars = Math.round((event.clientX - drag.startX) / drag.width * visibleBars);
    setOffsetFromEnd(clamp(drag.startOffset + movedBars, 0, maxOffset));
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const intervalButtons = useMemo(() => CHART_INTERVALS.map((option) => (
    <button
      key={option}
      type="button"
      onClick={() => handleIntervalChange(option)}
      className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors ${
        option === interval
          ? "bg-white/[0.12] text-white"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {option}
    </button>
  )), [handleIntervalChange, interval]);

  const legendCandle = inspected ?? latestVisible;

  return (
    <div
      ref={interactionRef}
      className="absolute inset-0"
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) snapToLive();
      }}
      onPointerCancel={finishPointer}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onWheel={handleWheel}
    >
      <BklitCandlePlot
        candles={visibleCandles}
        currentPrice={safeOffset === 0 ? latestPrice : latestVisible?.close}
        intervalSeconds={intervalSeconds}
        levels={liquidationLines.map((line) => ({
          id: line.id,
          price: line.price,
          color: line.side === "long" ? "var(--warning)" : "var(--danger)",
        }))}
        lines={overlayLines}
        onInspect={setInspected}
        priceDecimals={market.priceDecimals}
      />

      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
        <div className="pointer-events-auto flex items-center gap-0.5 self-start rounded-[7px] border border-white/[0.07] bg-[#141414]/85 p-0.5 backdrop-blur-sm">
          {intervalButtons}
        </div>
        <div className="self-start font-mono text-[10px] leading-4 text-zinc-400">
          {formatLegend(legendCandle, market.priceDecimals)}
        </div>
      </div>

      {safeOffset > 0 && (
        <button
          type="button"
          onClick={snapToLive}
          className="absolute bottom-10 right-20 z-10 flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-[#141414]/90 px-2 py-1 font-mono text-[10px] font-semibold text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
        >
          LIVE
          <span aria-hidden="true">→</span>
        </button>
      )}

      {loading && visibleCandles.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <TetherLoader size={52} label="Loading" />
        </div>
      )}

      {errorText && !loading && visibleCandles.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <span className="font-mono text-[11px] text-zinc-500">
            {errorText}
          </span>
        </div>
      )}
    </div>
  );
}

export const ProCandleChart = memo(
  ProCandleChartComponent,
  (previous, next) => (
    previous.active === next.active
    && previous.latestPrice === next.latestPrice
    && previous.liquidationLines === next.liquidationLines
    && previous.minuteCandles === next.minuteCandles
    && previous.nowSeconds === next.nowSeconds
    && previous.overlayMode === next.overlayMode
    && previous.secondCandles === next.secondCandles
    && previous.market.marketAddr === next.market.marketAddr
    && previous.market.marketName === next.market.marketName
    && previous.market.priceDecimals === next.market.priceDecimals
  ),
);
