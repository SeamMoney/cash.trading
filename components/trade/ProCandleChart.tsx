"use client";

/**
 * ProCandleChart — TradingView-engine (lightweight-charts) candlestick chart
 * for Decibel perp markets.
 *
 * Owns the "serious chart" experience: interval switching (1m–1D), native
 * pan/zoom (drag, wheel, pinch), a volume histogram, moving-average overlays,
 * liquidation price lines, and a live SSE tail where price ticks are merged
 * into the open candle so low timeframes move with every trade instead of
 * stepping once per bar.
 *
 * All streaming updates go through series.update() on refs — the React tree
 * re-renders only for interval changes and the snap-to-live button.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CandlestickData,
  HistogramData,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineData,
  LogicalRange,
  MouseEventParams,
  UTCTimestamp,
} from "lightweight-charts";
import { TetherLoader } from "@/components/layout/TetherLoader";
import type { PerpMarketData } from "@/components/trade/perpMarketConfig";
import { getDecibelPublicNetwork } from "@/lib/decibel-public";

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
}

type RestCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

export const CHART_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type ProChartInterval = (typeof CHART_INTERVALS)[number];

const INTERVAL_SECS: Record<ProChartInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
};

const INTERVAL_STORAGE_KEY = "cash:pro-chart-interval:v1";
const BOOTSTRAP_BARS = 500;
const UP_COLOR = "#22c55e";
const DOWN_COLOR = "#ef4444";
const UP_VOLUME = "rgba(34, 197, 94, 0.32)";
const DOWN_VOLUME = "rgba(239, 68, 68, 0.32)";

function loadStoredInterval(): ProChartInterval {
  if (typeof window === "undefined") return "1m";
  const stored = window.localStorage.getItem(INTERVAL_STORAGE_KEY);
  return (CHART_INTERVALS as readonly string[]).includes(stored ?? "")
    ? (stored as ProChartInterval)
    : "1m";
}

/** Price precision from magnitude — px_decimals is 6 across every Decibel
 * market, which reads as noise on BTC; match what the tape actually moves. */
function precisionForPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 5;
  return 6;
}

function sma(closes: LineData[], period: number): LineData[] {
  const out: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i].value;
    if (i >= period) sum -= closes[i - period].value;
    if (i >= period - 1) out.push({ time: closes[i].time, value: sum / period });
  }
  return out;
}

function ema(closes: LineData[], period: number): LineData[] {
  const out: LineData[] = [];
  const k = 2 / (period + 1);
  let prev = closes[0]?.value ?? 0;
  for (let i = 0; i < closes.length; i++) {
    prev = i === 0 ? closes[0].value : closes[i].value * k + prev * (1 - k);
    if (i >= period - 1) out.push({ time: closes[i].time, value: prev });
  }
  return out;
}

function ProCandleChartComponent({
  market,
  active,
  liquidationLines,
  overlayMode,
}: ProCandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fastOverlayRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowOverlayRef = useRef<ISeriesApi<"Line"> | null>(null);
  const liqLinesRef = useRef<IPriceLine[]>([]);
  const barsRef = useRef<CandlestickData[]>([]);
  const volumesRef = useRef<HistogramData[]>([]);
  const precisionRef = useRef(2);
  const overlayModeRef = useRef<OverlayMode>(overlayMode);
  const atLiveEdgeRef = useRef(true);

  const [interval, setChartInterval] = useState<ProChartInterval>(loadStoredInterval);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showLiveButton, setShowLiveButton] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  const { marketAddr, marketName } = market;
  const intervalSecs = INTERVAL_SECS[interval];

  const applyOverlays = useCallback(() => {
    const fast = fastOverlayRef.current;
    const slow = slowOverlayRef.current;
    if (!fast || !slow) return;
    const mode = overlayModeRef.current;
    if (mode === "off" || barsRef.current.length < 6) {
      fast.setData([]);
      slow.setData([]);
      return;
    }
    const closes: LineData[] = barsRef.current.map((bar) => ({
      time: bar.time,
      value: bar.close,
    }));
    const isStrategy = mode === "strategy";
    const calc = mode === "ema" ? ema : sma;
    const fastPeriod = isStrategy ? 3 : 20;
    const slowPeriod = isStrategy ? 5 : 50;
    fast.applyOptions({ color: isStrategy ? "#34d399" : "#a855f7" });
    fast.setData(closes.length >= fastPeriod ? calc(closes, fastPeriod) : []);
    slow.setData(closes.length >= slowPeriod ? calc(closes, slowPeriod) : []);
  }, []);

  // ── Chart lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let chart: IChartApi | null = null;

    import("lightweight-charts").then(
      ({ createChart, ColorType, CrosshairMode, LineStyle }) => {
        if (disposed || !containerRef.current) return;

        chart = createChart(containerRef.current, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: "transparent" },
            textColor: "#71717a",
            fontSize: 10,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.04)" },
            horzLines: { color: "rgba(255,255,255,0.04)" },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
              color: "rgba(255,255,255,0.2)",
              width: 1,
              style: LineStyle.Dashed,
              labelBackgroundColor: "#27272a",
            },
            horzLine: {
              color: "rgba(255,255,255,0.2)",
              width: 1,
              style: LineStyle.Dashed,
              labelBackgroundColor: "#27272a",
            },
          },
          rightPriceScale: {
            borderVisible: false,
            scaleMargins: { top: 0.08, bottom: 0.22 },
          },
          timeScale: {
            borderVisible: false,
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 4,
            barSpacing: 7,
          },
          handleScroll: true,
          handleScale: true,
        });

        const candleSeries = chart.addCandlestickSeries({
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
          borderVisible: false,
          wickUpColor: UP_COLOR,
          wickDownColor: DOWN_COLOR,
          priceLineVisible: true,
          priceLineColor: "rgba(255,255,255,0.25)",
          priceLineStyle: LineStyle.Dashed,
          lastValueVisible: true,
        });

        const volumeSeries = chart.addHistogramSeries({
          priceScaleId: "volume",
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.84, bottom: 0 },
          borderVisible: false,
        });

        const overlayOptions = {
          lineWidth: 1 as const,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        };
        const fastOverlay = chart.addLineSeries({
          ...overlayOptions,
          color: "#a855f7",
        });
        const slowOverlay = chart.addLineSeries({
          ...overlayOptions,
          color: "#f59e0b",
        });

        chart
          .timeScale()
          .subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
            if (!range) return;
            const atEdge = range.to >= barsRef.current.length - 1.5;
            if (atEdge !== atLiveEdgeRef.current) {
              atLiveEdgeRef.current = atEdge;
              setShowLiveButton(!atEdge);
            }
          });

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
          const legend = legendRef.current;
          if (!legend) return;
          const bar = param.seriesData.get(candleSeries) as
            | CandlestickData
            | undefined;
          if (!bar) {
            legend.textContent = "";
            return;
          }
          const fmt = (v: number) =>
            v.toLocaleString("en-US", {
              minimumFractionDigits: precisionRef.current,
              maximumFractionDigits: precisionRef.current,
            });
          const changePct = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
          legend.textContent = `O ${fmt(bar.open)}  H ${fmt(bar.high)}  L ${fmt(bar.low)}  C ${fmt(bar.close)}  ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
          legend.style.color = bar.close >= bar.open ? UP_COLOR : DOWN_COLOR;
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        fastOverlayRef.current = fastOverlay;
        slowOverlayRef.current = slowOverlay;
        setChartReady(true);
      }
    );

    return () => {
      disposed = true;
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      fastOverlayRef.current = null;
      slowOverlayRef.current = null;
      liqLinesRef.current = [];
      chart?.remove();
      setChartReady(false);
    };
  }, []);

  // ── Bootstrap history whenever market/interval changes ────────────────
  useEffect(() => {
    if (!chartReady) return;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !volumeSeries || !chart) return;

    let cancelled = false;
    setLoading(true);
    setErrorText(null);

    const load = async () => {
      try {
        const params = new URLSearchParams({
          market: marketAddr || marketName,
          interval,
          bars: String(BOOTSTRAP_BARS),
        });
        const res = await fetch(`/api/decibel/candlesticks?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { candles?: RestCandle[]; error?: string };
        if (!res.ok || json.error) {
          throw new Error(json.error || `candles ${res.status}`);
        }
        if (cancelled) return;

        const bars: CandlestickData[] = (json.candles ?? [])
          .map((candle) => ({
            time: Math.floor(candle.t / 1000) as UTCTimestamp,
            open: candle.o,
            high: candle.h,
            low: candle.l,
            close: candle.c,
          }))
          .sort((a, b) => (a.time as number) - (b.time as number));
        const volumes: HistogramData[] = (json.candles ?? [])
          .map((candle) => ({
            time: Math.floor(candle.t / 1000) as UTCTimestamp,
            value: candle.v ?? 0,
            color: candle.c >= candle.o ? UP_VOLUME : DOWN_VOLUME,
          }))
          .sort((a, b) => (a.time as number) - (b.time as number));

        barsRef.current = bars;
        volumesRef.current = volumes;

        const lastClose = bars[bars.length - 1]?.close ?? market.seedPrice;
        precisionRef.current = precisionForPrice(lastClose);
        candleSeries.applyOptions({
          priceFormat: {
            type: "price",
            precision: precisionRef.current,
            minMove: 10 ** -precisionRef.current,
          },
        });

        candleSeries.setData(bars);
        volumeSeries.setData(volumes);
        applyOverlays();
        chart.timeScale().scrollToRealTime();
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        setErrorText(
          error instanceof Error ? error.message : "Failed to load candles"
        );
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [chartReady, marketAddr, marketName, interval, market.seedPrice, applyOverlays]);

  // ── Live tail: candle closes + tick-merged open candle ─────────────────
  useEffect(() => {
    if (!chartReady || !active) return;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    let cancelled = false;
    let stream: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    const candleTopic = `market_candlestick:${marketAddr}:${interval}`;
    const priceTopic = `market_price:${marketAddr}`;

    const upsertBar = (bar: CandlestickData, volume?: number) => {
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      if (last && (bar.time as number) < (last.time as number)) return;
      if (last && last.time === bar.time) {
        bars[bars.length - 1] = bar;
      } else {
        bars.push(bar);
      }
      candleSeries.update(bar);
      if (volume !== undefined) {
        const volumeBar: HistogramData = {
          time: bar.time,
          value: volume,
          color: bar.close >= bar.open ? UP_VOLUME : DOWN_VOLUME,
        };
        const volumes = volumesRef.current;
        if (
          volumes.length > 0 &&
          volumes[volumes.length - 1].time === bar.time
        ) {
          volumes[volumes.length - 1] = volumeBar;
        } else {
          volumes.push(volumeBar);
        }
        volumeSeries.update(volumeBar);
      }
    };

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        network: getDecibelPublicNetwork(),
        topics: `${candleTopic},${priceTopic}`,
      });
      stream = new EventSource(`/api/decibel/stream?${params.toString()}`);

      stream.addEventListener("open", () => {
        reconnectAttempt = 0;
      });

      stream.addEventListener("message", (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(event.data) as {
            success?: boolean;
            topic?: string;
            candle?: RestCandle;
            price?: { mark_px?: number; mid_px?: number; oracle_px?: number };
          };
          if (!message.topic || message.success) return;

          if (message.topic === candleTopic && message.candle) {
            const candle = message.candle;
            upsertBar(
              {
                time: Math.floor(candle.t / 1000) as UTCTimestamp,
                open: candle.o,
                high: candle.h,
                low: candle.l,
                close: candle.c,
              },
              candle.v ?? 0
            );
            applyOverlays();
            return;
          }

          if (message.topic === priceTopic && message.price) {
            const price =
              message.price.mark_px ??
              message.price.mid_px ??
              message.price.oracle_px;
            if (!Number.isFinite(price) || !price) return;
            const bucket = (Math.floor(Date.now() / 1000 / intervalSecs) *
              intervalSecs) as UTCTimestamp;
            const last = barsRef.current[barsRef.current.length - 1];
            if (last && last.time === bucket) {
              upsertBar({
                time: bucket,
                open: last.open,
                high: Math.max(last.high, price),
                low: Math.min(last.low, price),
                close: price,
              });
            } else if (last && (bucket as number) > (last.time as number)) {
              upsertBar({
                time: bucket,
                open: last.close,
                high: Math.max(last.close, price),
                low: Math.min(last.close, price),
                close: price,
              });
            }
          }
        } catch {
          // Ignore malformed frames; the stream self-heals on reconnect.
        }
      });

      stream.addEventListener("error", () => {
        if (cancelled) return;
        stream?.close();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(
          connect,
          Math.min(1000 * 1.5 ** reconnectAttempt, 8000)
        );
      });
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream?.close();
    };
  }, [chartReady, active, marketAddr, interval, intervalSecs, applyOverlays]);

  // ── Overlays react to mode changes ─────────────────────────────────────
  useEffect(() => {
    overlayModeRef.current = overlayMode;
    if (chartReady) applyOverlays();
  }, [overlayMode, chartReady, applyOverlays]);

  // ── Liquidation price lines ────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady) return;
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    for (const line of liqLinesRef.current) {
      candleSeries.removePriceLine(line);
    }
    liqLinesRef.current = liquidationLines.map((line) =>
      candleSeries.createPriceLine({
        price: line.price,
        color: line.side === "long" ? "#f97316" : "#f43f5e",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: line.side === "long" ? "LIQ LONG" : "LIQ SHORT",
      })
    );
  }, [chartReady, liquidationLines]);

  const handleIntervalChange = useCallback((next: ProChartInterval) => {
    setChartInterval(next);
    try {
      window.localStorage.setItem(INTERVAL_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures shouldn't break the chart.
    }
  }, []);

  const snapToLive = useCallback(() => {
    chartRef.current?.timeScale().scrollToRealTime();
  }, []);

  const intervalButtons = useMemo(
    () =>
      CHART_INTERVALS.map((option) => (
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
      )),
    [interval, handleIntervalChange]
  );

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Timeframe pills + OHLC legend */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
        <div className="pointer-events-auto flex items-center gap-0.5 self-start rounded-[7px] border border-white/[0.07] bg-[#141414]/85 p-0.5 backdrop-blur-sm">
          {intervalButtons}
        </div>
        <div
          ref={legendRef}
          className="self-start font-mono text-[10px] leading-4 text-zinc-400"
        />
      </div>

      {/* Snap back to the live edge after panning into history */}
      {showLiveButton && (
        <button
          type="button"
          onClick={snapToLive}
          className="absolute bottom-10 right-20 z-10 flex items-center gap-1 rounded-[7px] border border-white/[0.08] bg-[#141414]/90 px-2 py-1 font-mono text-[10px] font-semibold text-zinc-300 backdrop-blur-sm transition-colors hover:text-white"
        >
          LIVE
          <span aria-hidden="true">→</span>
        </button>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <TetherLoader size={52} label="Loading" />
        </div>
      )}

      {errorText && !loading && barsRef.current.length === 0 && (
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
  (prev, next) =>
    prev.active === next.active &&
    prev.liquidationLines === next.liquidationLines &&
    prev.overlayMode === next.overlayMode &&
    prev.market.marketAddr === next.market.marketAddr &&
    prev.market.marketName === next.market.marketName &&
    prev.market.priceDecimals === next.market.priceDecimals
);
