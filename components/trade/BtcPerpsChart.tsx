"use client";

import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Liveline, type CandlePoint, type LivelinePoint, type LivelineSeries, type WindowOption } from "liveline";
import { TetherLoader } from "@/components/layout/TetherLoader";
import { ProCandleChart } from "@/components/trade/ProCandleChart";
import type { PerpMarketData } from "@/components/trade/perpMarketConfig";
import { getPriceCandleProductId, supportsPriceCandleMarket, usePriceCandles } from "@/hooks/useBtcCandles";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import {
  fetchDecibelMainnetCandles,
  fetchDecibelMainnetPrices,
  fetchDecibelMainnetTrades,
  getDecibelPublicNetwork,
  type DecibelRestCandle,
  type DecibelRestTrade,
} from "@/lib/decibel-public";
import {
  candlesToCloseLinePoints,
  clipLineWindow,
  dedupeAndSort,
  withLiveTail,
} from "@/lib/trade/lineData";
import {
  chartPriceTicksToCandles,
  mergeChartPriceTicks,
  type ChartPriceTick,
} from "@/lib/trade/candleSeries";

type TradeSample = {
  price: number;
  size?: number;
  trade_id?: string;
  transaction_unix_ms: number;
};

type ChartCandlePoint = CandlePoint & {
  volume?: number;
};

type LiquidationLine = {
  id: string;
  price: number;
  side: "long" | "short";
};

export interface PerpMarketSnapshot {
  connected: boolean;
  fundingRateBps: number | null;
  openInterest: number | null;
  oraclePrice: number;
  price: number;
  volume24h?: number | null;
  volumeWindowMs?: number | null;
}

type ChartInterval = "1s" | "5s" | "15s" | "1m";

const CHART_PADDING = { top: 8, right: 8, bottom: 36, left: 8 } as const;
const STREAM_FRESH_MS = 15_000;
const TRADE_FALLBACK_POLL_MS = 20_000;
const PRICE_FALLBACK_POLL_MS = 10_000;
const ONE_SECOND_WINDOW_SECS = 12 * 60;
const MINUTE_HISTORY_MS = 12 * 60 * 60 * 1000;
const DECIBEL_VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DECIBEL_MINUTE_CANDLES = Math.ceil(DECIBEL_VOLUME_WINDOW_MS / 60_000) + 5;
const INITIAL_TRADE_LIMIT = 900;
const LIVE_TRADE_REFRESH_LIMIT = 240;
const BTC_FALLBACK_ACTIVATE_MS = 3500;
const DEFAULT_LINE_WINDOW_SECS = 60;
const MIN_LINE_WINDOW_SECS = 60;
const MAX_LINE_WINDOW_SECS = MINUTE_HISTORY_MS / 1000;
const LIVE_EDGE_HEADROOM_SECS = 2;
const LIVE_EDGE_SNAP_SECS = 6;
const BASE_LINE_VERTICAL_PAD = 14;
const MAX_LINE_VERTICAL_PAD = 72;
const INITIAL_REQUEST_TIMEOUT_MS = 9000;
const COINBASE_BOOTSTRAP_TARGET_SECS = 12 * 60;
const COINBASE_RESUME_REFRESH_COOLDOWN_MS = 1500;
const ENABLE_EXTERNAL_PRICE_FALLBACKS =
  process.env.NEXT_PUBLIC_ENABLE_EXTERNAL_PRICE_FALLBACKS === "true";

const INTERVAL_SECONDS: Record<ChartInterval, number> = {
  "1s": 1,
  "5s": 5,
  "15s": 15,
  "1m": 60,
};

// Two intent-based views: every observed live move, or the full loaded history.
const LINE_WINDOW_OPTIONS: WindowOption[] = [
  { label: "LIVE", secs: 60 },
  { label: "HISTORY", secs: 12 * 60 * 60 },
];

function ChartDotBackground({
  padding,
}: {
  padding: { top: number; right: number; bottom: number; left: number };
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        backgroundImage: "radial-gradient(circle, var(--chart-grid) 1.5px, transparent 1.5px)",
        backgroundSize: "10px 10px",
        bottom: padding.bottom,
        left: padding.left,
        opacity: 0.85,
        right: padding.right,
        top: padding.top,
      }}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function tradesToPriceTicks(trades: TradeSample[]): ChartPriceTick[] {
  const ordered = trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => (
      a.trade.transaction_unix_ms - b.trade.transaction_unix_ms
      || a.index - b.index
    ));
  let previousTimestamp = Number.NaN;
  let sequence = -1;

  return ordered.map(({ trade }) => {
    if (trade.transaction_unix_ms === previousTimestamp) {
      sequence += 1;
    } else {
      previousTimestamp = trade.transaction_unix_ms;
      sequence = 0;
    }
    return {
      time: trade.transaction_unix_ms / 1_000,
      value: trade.price,
      volume: Number.isFinite(trade.size ?? NaN) ? Math.abs(trade.size ?? 0) : 0,
      sequence,
      identity: trade.trade_id,
    };
  });
}

function toCandlePoint(candle: DecibelRestCandle): ChartCandlePoint {
  return {
    time: Math.floor(candle.t / 1000),
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
  };
}

function toCandlePoints(candles: DecibelRestCandle[]): ChartCandlePoint[] {
  return candles
    .map(toCandlePoint)
    .sort((a, b) => a.time - b.time);
}

function toHistoryCandlePoints(candles: MarketHistoryCandle[]) {
  return candles
    .map((candle) => ({
      time: Math.floor(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
    .sort((a, b) => a.time - b.time);
}

function aggregateCandles(candles: CandlePoint[], bucketSecs: number) {
  if (candles.length === 0 || bucketSecs <= 1) return candles;

  const grouped = new Map<number, ChartCandlePoint>();

  for (const candle of candles) {
    const candleVolume = (candle as ChartCandlePoint).volume ?? 0;
    const bucket = Math.floor(candle.time / bucketSecs) * bucketSecs;
    const existing = grouped.get(bucket);

    if (!existing) {
      grouped.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candleVolume,
      });
      continue;
    }

    grouped.set(bucket, {
      ...existing,
      high: Math.max(existing.high, candle.high),
      low: Math.min(existing.low, candle.low),
      close: candle.close,
      volume: (existing.volume ?? 0) + candleVolume,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => a.time - b.time);
}

function upsertMinuteCandle(candles: CandlePoint[], candle: DecibelRestCandle) {
  const point = toCandlePoint(candle);
  const next = candles.slice() as ChartCandlePoint[];
  const index = next.findIndex((existing) => existing.time === point.time);

  if (index >= 0) {
    next[index] = point;
  } else {
    next.push(point);
  }

  return next
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_DECIBEL_MINUTE_CANDLES);
}

function estimateQuoteVolume(candles: CandlePoint[], windowMs = DECIBEL_VOLUME_WINDOW_MS) {
  if (candles.length === 0) return null;

  const latestTime = candles[candles.length - 1].time;
  const cutoff = latestTime - windowMs / 1000;
  let volume = 0;

  for (const candle of candles) {
    if (candle.time < cutoff) continue;
    const baseVolume = (candle as ChartCandlePoint).volume;
    if (!Number.isFinite(baseVolume ?? NaN) || !Number.isFinite(candle.close)) continue;
    volume += Math.abs(baseVolume ?? 0) * candle.close;
  }

  return volume > 0 ? volume : null;
}

function mergeMinuteCandlesWithLive(minuteCandles: CandlePoint[], secondCandles: CandlePoint[]) {
  if (minuteCandles.length === 0) return aggregateCandles(secondCandles, 60);
  if (secondCandles.length === 0) return minuteCandles;

  const liveMinute = aggregateCandles(secondCandles, 60);
  if (liveMinute.length === 0) return minuteCandles;

  const latestLive = liveMinute[liveMinute.length - 1];
  return [
    ...minuteCandles.filter((candle) => candle.time < latestLive.time),
    latestLive,
  ];
}

function buildLineHistory(
  minuteCandles: CandlePoint[],
  secondCandles: CandlePoint[],
  interval: ChartInterval,
) {
  if (interval === "1m") {
    return mergeMinuteCandlesWithLive(minuteCandles, secondCandles);
  }

  const recentCandles = interval === "15s"
    ? aggregateCandles(secondCandles, 15)
    : interval === "5s"
      ? aggregateCandles(secondCandles, 5)
      : secondCandles;

  if (recentCandles.length === 0) return minuteCandles;

  return [
    ...minuteCandles.filter((candle) => candle.time < recentCandles[0].time),
    ...recentCandles,
  ];
}

function getLineIntervalForWindow(windowSecs: number): ChartInterval {
  // Decibel's recent-trades endpoint currently returns at most 200 fills,
  // which covers roughly 60-100 seconds on BTC. Mixing that dense tail into
  // sparse minute history made 5m+ lines visibly change character halfway
  // across the plot. Keep raw ticks only where they cover the whole preset;
  // longer windows use real minute closes plus the latest live mark below.
  if (windowSecs <= MIN_LINE_WINDOW_SECS) return "1s";
  return "1m";
}

function mergeLivelinePoints(...groups: LivelinePoint[][]) {
  const byTime = new Map<number, LivelinePoint>();

  for (const group of groups) {
    for (const point of group) {
      if (!Number.isFinite(point.time) || !Number.isFinite(point.value) || point.value <= 0) continue;
      byTime.set(Math.round(point.time * 1000), point);
    }
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

function buildHybridVisibleLinePoints(
  minuteCandles: CandlePoint[],
  priceTicks: LivelinePoint[],
  startTime: number,
  endTime: number,
) {
  // Keep every observed Decibel fill. Collapsing this stream to one sample per
  // second erased legitimate intrasecond moves and made the live line look
  // stepped even when the exchange supplied a denser sequence.
  const visibleTicks = dedupeAndSort(
    priceTicks.filter((tick) => tick.time >= startTime && tick.time <= endTime),
  );
  const recentStart = visibleTicks[0]?.time ?? endTime;
  const historicalPoints = candlesToCloseLinePoints(
    minuteCandles.filter(
      (candle) => candle.time >= startTime - 60 && candle.time < recentStart,
    ),
    INTERVAL_SECONDS["1m"],
  );

  return mergeLivelinePoints(historicalPoints, visibleTicks);
}

function shiftLinePoints(points: LivelinePoint[], offsetSecs: number) {
  if (!Number.isFinite(offsetSecs) || Math.abs(offsetSecs) < 0.001) return points;
  return points.map((point) => ({ ...point, time: point.time + offsetSecs }));
}

function shiftCandles(candles: CandlePoint[], offsetSecs: number) {
  if (!Number.isFinite(offsetSecs) || Math.abs(offsetSecs) < 0.001) return candles;
  return candles.map((candle) => ({ ...candle, time: candle.time + offsetSecs }));
}

function sliceCandlesForWindow(candles: CandlePoint[], startTime: number, endTime: number) {
  if (candles.length === 0) return [];

  const visible = candles.filter((candle) => candle.time >= startTime && candle.time <= endTime);
  if (visible.length > 0) return visible;

  const nearest = nearestIndexByTime(candles, endTime);
  return candles.slice(Math.max(0, nearest - 1), nearest + 1);
}

function nearestIndexByTime(candles: CandlePoint[], targetTime: number) {
  if (candles.length === 0) return 0;

  let low = 0;
  let high = candles.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (candles[mid].time < targetTime) low = mid + 1;
    else high = mid;
  }

  if (low === 0) return 0;
  if (low >= candles.length) return candles.length - 1;

  return Math.abs(candles[low].time - targetTime) < Math.abs(candles[low - 1].time - targetTime)
    ? low
    : low - 1;
}

function formatPerpPrice(value: number, decimals: number) {
  return "$" + value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type BtcPerpsChartProps = {
  active: boolean;
  liquidationLines?: LiquidationLine[];
  market: PerpMarketData;
  mode: "line" | "candle";
  onSnapshotChange?: (snapshot: PerpMarketSnapshot) => void;
  /** Overlay moving-average lines on the chart (presentational only).
   *  "strategy" mirrors the live trustless vault's SMA 3/5 on its market. */
  overlayMode?: "off" | "sma" | "ema" | "strategy";
};

function BtcPerpsChartComponent({
  active,
  liquidationLines = [],
  market,
  mode,
  onSnapshotChange,
  overlayMode = "off",
}: BtcPerpsChartProps) {
  const marketRef = useRef(market);
  marketRef.current = market;
  const marketKey = `${market.marketName}:${market.marketAddr ?? ""}`;
  const marketAddress = market.marketAddr;
  const [decibelTradeTicks, setDecibelTradeTicks] = useState<ChartPriceTick[]>([]);
  const [decibelMarkTicks, setDecibelMarkTicks] = useState<ChartPriceTick[]>([]);
  const [minuteCandles, setMinuteCandles] = useState<CandlePoint[]>([]);
  const [coinbaseMinuteCandles, setCoinbaseMinuteCandles] = useState<CandlePoint[]>([]);
  const [coinbaseHistorySecondCandles, setCoinbaseHistorySecondCandles] = useState<CandlePoint[]>([]);
  const [coinbaseHistoryTicks, setCoinbaseHistoryTicks] = useState<LivelinePoint[]>([]);
  const [coinbaseBootstrapReady, setCoinbaseBootstrapReady] = useState(false);
  const [coinbaseHistoryRefreshNonce, setCoinbaseHistoryRefreshNonce] = useState(0);
  const [hasInitialHistory, setHasInitialHistory] = useState(false);
  const [useBtcFallback, setUseBtcFallback] = useState(false);
  const [lineWindowSecs, setLineWindowSecs] = useState(MAX_LINE_WINDOW_SECS);
  const [lineEndTime, setLineEndTime] = useState<number | null>(null);
  const [manualLineVerticalPad, setManualLineVerticalPad] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chartNowSec, setChartNowSec] = useState(() => Date.now() / 1000);
  const [snapshot, setSnapshot] = useState<PerpMarketSnapshot>({
    connected: false,
    fundingRateBps: null,
    openInterest: null,
    oraclePrice: market.oraclePrice ?? 0,
    price: market.seedPrice,
  });
  const snapshotRef = useRef(snapshot);
  const decibelLiveAtRef = useRef(0);
  const coinbaseHistoryLoadedKeyRef = useRef<string | null>(null);
  const lastCoinbaseResumeRefreshAtRef = useRef(0);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const touchGestureRef = useRef<{
    startAnchorRatio: number;
    startDistance: number;
    startEndTime: number;
    startWindowSecs: number;
  } | null>(null);

  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!active) return () => {};

    const updateClock = () => setChartNowSec(Date.now() / 1000);
    updateClock();
    const timer = setInterval(updateClock, 1000);

    return () => clearInterval(timer);
  }, [active]);

  // Decibel is the product source of truth. External feeds are only an
  // explicit degraded-mode fallback, never the default chart source.
  const btcFallbackEnabled = ENABLE_EXTERNAL_PRICE_FALLBACKS && market.marketName === "BTC/USD";
  const useCoinbaseLineFeed =
    ENABLE_EXTERNAL_PRICE_FALLBACKS && supportsPriceCandleMarket(market.marketName);

  const {
    candles: coinbaseCandles,
    ticks: coinbaseTicks,
    liveCandle: coinbaseLiveCandle,
    price: coinbasePrice,
    connected: coinbaseConnected,
  } = usePriceCandles(market.marketName, active && useCoinbaseLineFeed, [], 0, 1, {
    preserveStateOnResume: true,
  });

  const coinbaseSecondCandles = useMemo(() => {
    if (!useCoinbaseLineFeed) return [];
    const merged = [
      ...coinbaseHistorySecondCandles.map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
      ...coinbaseCandles.map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
      ...(coinbaseLiveCandle
        ? [{
            time: coinbaseLiveCandle.time,
            open: coinbaseLiveCandle.open,
            high: coinbaseLiveCandle.high,
            low: coinbaseLiveCandle.low,
            close: coinbaseLiveCandle.close,
          }]
        : []),
    ];
    const byTime = new Map<number, CandlePoint>();
    for (const candle of merged) byTime.set(candle.time, candle);
    return Array.from(byTime.values()).sort((a, b) => a.time - b.time).slice(-ONE_SECOND_WINDOW_SECS);
  }, [coinbaseCandles, coinbaseHistorySecondCandles, coinbaseLiveCandle, useCoinbaseLineFeed]);

  const coinbasePriceTicks = useMemo(
    () => (useCoinbaseLineFeed
      ? mergeLivelinePoints(coinbaseHistoryTicks, coinbaseTicks)
      : []),
    [coinbaseHistoryTicks, coinbaseTicks, useCoinbaseLineFeed],
  );
  const decibelChartTicks = useMemo(() => {
    const latestTradeTime = decibelTradeTicks.at(-1)?.time;
    // Trades are the granular, executable price history. A mark update is used
    // only when it is newer than the most recent fill so the endpoint stays
    // current without replacing or backtracking through the real trade path.
    const markTail = latestTradeTime == null
      ? decibelMarkTicks
      : decibelMarkTicks.filter((tick) => tick.time > latestTradeTime);
    return mergeChartPriceTicks(decibelTradeTicks, markTail);
  }, [decibelMarkTicks, decibelTradeTicks]);
  const decibelLineSecondCandles = useMemo(
    () => chartPriceTicksToCandles(decibelChartTicks, 1).slice(-ONE_SECOND_WINDOW_SECS),
    [decibelChartTicks],
  );
  const decibelTradeSecondCandles = useMemo(
    () => chartPriceTicksToCandles(decibelTradeTicks, 1).slice(-ONE_SECOND_WINDOW_SECS),
    [decibelTradeTicks],
  );
  const observedLineSecondCandles = useMemo(
    () => (useCoinbaseLineFeed ? coinbaseSecondCandles : decibelLineSecondCandles),
    [coinbaseSecondCandles, decibelLineSecondCandles, useCoinbaseLineFeed],
  );
  const observedTradeSecondCandles = useMemo(
    () => (useCoinbaseLineFeed ? coinbaseSecondCandles : decibelTradeSecondCandles),
    [coinbaseSecondCandles, decibelTradeSecondCandles, useCoinbaseLineFeed],
  );
  const activePriceTicks = useMemo<LivelinePoint[]>(
    () => (useCoinbaseLineFeed ? coinbasePriceTicks : decibelChartTicks),
    [coinbasePriceTicks, decibelChartTicks, useCoinbaseLineFeed],
  );
  const activeMinuteCandles = useMemo(
    () => (useCoinbaseLineFeed ? coinbaseMinuteCandles : minuteCandles),
    [coinbaseMinuteCandles, minuteCandles, useCoinbaseLineFeed],
  );

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startEndTime: number;
    spanSecs: number;
  } | null>(null);
  const lineInteractionRef = useRef<HTMLDivElement | null>(null);
  const [lineColor, setLineColor] = useState("#39ff14");
  // Which market the window/pan state was last reset for — bootstrap re-runs
  // (feed fallback flips) must not clobber the user's chosen window.
  const lineViewResetKeyRef = useRef<string | null>(null);
  const previousModeRef = useRef(mode);

  useEffect(() => {
    if (mode === "line" && previousModeRef.current !== "line") {
      setLineWindowSecs(MAX_LINE_WINDOW_SECS);
      setLineEndTime(null);
      setManualLineVerticalPad(0);
    }
    previousModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const interactionNode = lineInteractionRef.current;
    if (!interactionNode) return;
    const preventPageScroll = (event: WheelEvent) => event.preventDefault();
    interactionNode.addEventListener("wheel", preventPageScroll, { passive: false });
    return () => interactionNode.removeEventListener("wheel", preventPageScroll);
  }, []);

  useEffect(() => {
    const interactionNode = lineInteractionRef.current;
    if (!interactionNode) return;
    const tokenColor = getComputedStyle(interactionNode)
      .getPropertyValue("--chart-line-primary")
      .trim();
    setLineColor(tokenColor || market.color);
  }, [market.color]);

  const lineBounds = useMemo(() => {
    const earliest = activeMinuteCandles[0]?.time ?? activePriceTicks[0]?.time ?? null;
    const latest = activePriceTicks[activePriceTicks.length - 1]?.time
      ?? observedLineSecondCandles[observedLineSecondCandles.length - 1]?.time
      ?? activeMinuteCandles[activeMinuteCandles.length - 1]?.time
      ?? null;

    return { earliest, latest };
  }, [activeMinuteCandles, activePriceTicks, observedLineSecondCandles]);

  const lineResolvedEndTime = useMemo(() => {
    if (lineBounds.latest == null) return null;
    if (lineEndTime != null) return lineEndTime;

    return lineBounds.latest + LIVE_EDGE_HEADROOM_SECS;
  }, [lineBounds.latest, lineEndTime]);

  const lineInterval = useMemo(
    () => (observedLineSecondCandles.length === 0 ? "1m" : getLineIntervalForWindow(lineWindowSecs)),
    [lineWindowSecs, observedLineSecondCandles.length],
  );

  const lineHistoryCandles = useMemo(
    () => buildLineHistory(activeMinuteCandles, observedLineSecondCandles, lineInterval),
    [activeMinuteCandles, lineInterval, observedLineSecondCandles],
  );

  const lineVisibleCandles = useMemo(() => {
    if (lineResolvedEndTime == null) return [];
    return sliceCandlesForWindow(
      lineHistoryCandles,
      lineResolvedEndTime - lineWindowSecs,
      lineResolvedEndTime,
    );
  }, [lineHistoryCandles, lineResolvedEndTime, lineWindowSecs]);

  const lineData = useMemo(
    () => {
      if (lineResolvedEndTime == null) return [];
      const startTime = lineResolvedEndTime - lineWindowSecs;
      const isLiveWindow = lineEndTime == null;
      const latestObservedTick = activePriceTicks[activePriceTicks.length - 1];

      if (lineInterval === "1s" && activePriceTicks.length > 0) {
        return clipLineWindow(
          buildHybridVisibleLinePoints(
            activeMinuteCandles,
            activePriceTicks,
            startTime,
            lineResolvedEndTime,
          ),
          startTime,
          lineResolvedEndTime,
        );
      }

      const canonicalPoints = dedupeAndSort(
        candlesToCloseLinePoints(lineVisibleCandles, INTERVAL_SECONDS[lineInterval]),
      );
      const pointsWithTail = isLiveWindow && latestObservedTick
        ? withLiveTail(
            canonicalPoints,
            latestObservedTick.value,
            latestObservedTick.time,
          )
        : canonicalPoints;
      return clipLineWindow(
        pointsWithTail,
        startTime,
        lineResolvedEndTime,
      );
    },
    [
      activeMinuteCandles,
      activePriceTicks,
      lineInterval,
      lineEndTime,
      lineResolvedEndTime,
      lineVisibleCandles,
      lineWindowSecs,
    ],
  );
  // Liveline already anchors live exchange timestamps to wall-clock time.
  // Re-anchoring them on every clock/tick update made the path creep forward,
  // then jump backward whenever the latest exchange timestamp advanced.
  // Only translated, deliberately panned history needs a wall-clock offset.
  const renderTimeOffset = lineEndTime == null || lineResolvedEndTime == null
    ? 0
    : chartNowSec - lineResolvedEndTime;
  const renderLineData = useMemo(
    () => shiftLinePoints(lineData, renderTimeOffset),
    [lineData, renderTimeOffset],
  );
  const renderSecondCandles = useMemo(
    () => shiftCandles(observedTradeSecondCandles, renderTimeOffset),
    [observedTradeSecondCandles, renderTimeOffset],
  );
  const displayedLineValue = lineData[lineData.length - 1]?.value ?? snapshot.price;

  const lineBootstrapReady = useMemo(() => {
    if (!useCoinbaseLineFeed) return false;
    const requiredHistorySecs = clamp(Math.floor(lineWindowSecs * 0.65), MIN_LINE_WINDOW_SECS, DEFAULT_LINE_WINDOW_SECS);
    return (
      coinbaseHistorySecondCandles.length >= requiredHistorySecs
      || coinbaseHistoryTicks.length >= Math.max(40, Math.floor(requiredHistorySecs / 2))
      || coinbaseMinuteCandles.length >= 2
      || coinbaseTicks.length >= 8
    );
  }, [
    coinbaseHistorySecondCandles.length,
    coinbaseHistoryTicks.length,
    coinbaseMinuteCandles.length,
    coinbaseTicks.length,
    lineWindowSecs,
    useCoinbaseLineFeed,
  ]);

  const lineAutoVerticalPad = useMemo(() => {
    const zoomRatio = Math.max(1, lineWindowSecs / DEFAULT_LINE_WINDOW_SECS);
    return clamp(Math.log(zoomRatio) / Math.log(2) * 18, 0, MAX_LINE_VERTICAL_PAD);
  }, [lineWindowSecs]);

  const lineVerticalPad = clamp(
    BASE_LINE_VERTICAL_PAD + lineAutoVerticalPad + manualLineVerticalPad,
    0,
    MAX_LINE_VERTICAL_PAD,
  );

  const volume24h = useMemo(
    () => (useCoinbaseLineFeed ? null : estimateQuoteVolume(activeMinuteCandles)),
    [activeMinuteCandles, useCoinbaseLineFeed],
  );

  const snapshotWithVolume = useMemo(
    () => ({
      ...snapshot,
      volume24h,
      volumeWindowMs: volume24h === null ? null : DECIBEL_VOLUME_WINDOW_MS,
    }),
    [snapshot, volume24h],
  );

  const linePadding = useMemo(
    () => ({
      top: CHART_PADDING.top + lineVerticalPad,
      right: CHART_PADDING.right,
      bottom: CHART_PADDING.bottom,
      left: CHART_PADDING.left,
    }),
    [lineVerticalPad],
  );

  function normalizeLineEndTime(nextEndTime: number, nextWindowSecs: number) {
    if (lineBounds.earliest == null || lineBounds.latest == null) return null;

    const liveEdge = lineBounds.latest + LIVE_EDGE_HEADROOM_SECS;
    const fullSpan = liveEdge - lineBounds.earliest;

    if (fullSpan <= nextWindowSecs + LIVE_EDGE_SNAP_SECS) {
      return null;
    }

    const minEnd = lineBounds.earliest + nextWindowSecs;
    const clampedEnd = clamp(nextEndTime, minEnd, liveEdge);

    return liveEdge - clampedEnd <= LIVE_EDGE_SNAP_SECS ? null : clampedEnd;
  }

  const handleLineWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (lineBounds.latest == null || lineResolvedEndTime == null) return;

    const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;

    if (horizontalIntent) {
      const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
      const panSecs = delta * Math.max(lineWindowSecs / 280, 1.5);
      setLineEndTime(normalizeLineEndTime(lineResolvedEndTime + panSecs, lineWindowSecs));
      return;
    }

    if (Math.abs(event.deltaY) < 0.5) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const anchorRatio = rect.width > 0
      ? clamp((event.clientX - rect.left) / rect.width, 0.12, 0.88)
      : 1;
    const zoomScale = clamp(Math.exp(event.deltaY * 0.00085), 0.94, 1.08);
    const nextWindowSecs = clamp(
      lineWindowSecs * zoomScale,
      MIN_LINE_WINDOW_SECS,
      MAX_LINE_WINDOW_SECS,
    );
    const currentStart = lineResolvedEndTime - lineWindowSecs;
    const anchorTime = currentStart + lineWindowSecs * anchorRatio;
    const nextStart = anchorTime - nextWindowSecs * anchorRatio;
    const nextEnd = nextStart + nextWindowSecs;

    setLineWindowSecs(nextWindowSecs);
    setLineEndTime(normalizeLineEndTime(nextEnd, nextWindowSecs));
  };

  const handleLinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lineResolvedEndTime == null) return;

    if (event.pointerType === "touch") {
      event.preventDefault();
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (touchPointersRef.current.size === 1) {
        dragStateRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startEndTime: lineResolvedEndTime,
          spanSecs: lineWindowSecs,
        };
        touchGestureRef.current = null;
      } else if (touchPointersRef.current.size === 2) {
        const rect = event.currentTarget.getBoundingClientRect();
        const [first, second] = Array.from(touchPointersRef.current.values());
        const centerX = (first.x + second.x) / 2;
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        touchGestureRef.current = {
          startAnchorRatio: rect.width > 0
            ? clamp((centerX - rect.left) / rect.width, 0.08, 0.92)
            : 0.5,
          startDistance: Math.max(distance, 1),
          startEndTime: lineResolvedEndTime,
          startWindowSecs: lineWindowSecs,
        };
        dragStateRef.current = null;
      }
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startEndTime: lineResolvedEndTime,
      spanSecs: lineWindowSecs,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleLinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      event.preventDefault();
      if (!touchPointersRef.current.has(event.pointerId)) return;
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;

      if (touchPointersRef.current.size >= 2 && touchGestureRef.current) {
        const [first, second] = Array.from(touchPointersRef.current.values());
        const centerX = (first.x + second.x) / 2;
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        const gesture = touchGestureRef.current;
        const nextWindowSecs = clamp(
          gesture.startWindowSecs * (gesture.startDistance / Math.max(distance, 1)),
          MIN_LINE_WINDOW_SECS,
          MAX_LINE_WINDOW_SECS,
        );
        const currentAnchorRatio = clamp((centerX - rect.left) / rect.width, 0.08, 0.92);
        const gestureStartTime = gesture.startEndTime - gesture.startWindowSecs;
        const anchorTime = gestureStartTime + gesture.startWindowSecs * gesture.startAnchorRatio;
        const nextStart = anchorTime - nextWindowSecs * currentAnchorRatio;
        const nextEnd = nextStart + nextWindowSecs;

        setLineWindowSecs(nextWindowSecs);
        setLineEndTime(normalizeLineEndTime(nextEnd, nextWindowSecs));
        return;
      }
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;

    const panSecs = -(event.clientX - dragState.startX) / rect.width * dragState.spanSecs;
    setLineEndTime(normalizeLineEndTime(dragState.startEndTime + panSecs, dragState.spanSecs));
  };

  const handleLinePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      event.preventDefault();
      touchPointersRef.current.delete(event.pointerId);
      touchGestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (touchPointersRef.current.size === 1 && lineResolvedEndTime != null) {
        const [remainingId, remainingPoint] = Array.from(touchPointersRef.current.entries())[0];
        dragStateRef.current = {
          pointerId: remainingId,
          startX: remainingPoint.x,
          startEndTime: lineResolvedEndTime,
          spanSecs: lineWindowSecs,
        };
        return;
      }

      dragStateRef.current = null;
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleLineAxisWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (Math.abs(event.deltaY) < 0.5) return;

    setManualLineVerticalPad((prev) =>
      clamp(prev + (event.deltaY > 0 ? 8 : -8), 0, MAX_LINE_VERTICAL_PAD - BASE_LINE_VERTICAL_PAD)
    );
  };

  useEffect(() => {
    onSnapshotChange?.(snapshotWithVolume);
  }, [onSnapshotChange, snapshotWithVolume]);

  useEffect(() => {
    if (!active || !useCoinbaseLineFeed || typeof document === "undefined") return;

    const refreshOnResume = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastCoinbaseResumeRefreshAtRef.current < COINBASE_RESUME_REFRESH_COOLDOWN_MS) {
        return;
      }

      lastCoinbaseResumeRefreshAtRef.current = now;
      setLineEndTime(null);
      setCoinbaseHistoryRefreshNonce((value) => value + 1);
    };

    document.addEventListener("visibilitychange", refreshOnResume);
    window.addEventListener("focus", refreshOnResume);

    return () => {
      document.removeEventListener("visibilitychange", refreshOnResume);
      window.removeEventListener("focus", refreshOnResume);
    };
  }, [active, useCoinbaseLineFeed]);

  useEffect(() => {
    if (!useCoinbaseLineFeed) {
      setCoinbaseBootstrapReady(false);
      return () => {};
    }

    if (!active) {
      return () => {};
    }

    const productId = getPriceCandleProductId(market.marketName);
    if (!productId) {
      setCoinbaseBootstrapReady(false);
      return () => {};
    }

    let cancelled = false;
    const historyLoadKey = `${marketKey}:${coinbaseHistoryRefreshNonce}`;
    if (coinbaseHistoryLoadedKeyRef.current === historyLoadKey) {
      setCoinbaseBootstrapReady(true);
      return () => {
        cancelled = true;
      };
    }

    setCoinbaseBootstrapReady(false);

    const loadHistory = async () => {
      let historyLoaded = false;
      try {
        const end = Math.floor(Date.now() / 1000);
        const start = end - Math.max(Math.floor(MINUTE_HISTORY_MS / 1000), 120 * 60);
        const [candlesResponse, tradesResponse] = await Promise.all([
          fetch(
            `/api/coinbase/candles?productId=${encodeURIComponent(productId)}&granularity=60&start=${start}&end=${end}`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/coinbase/trades?productId=${encodeURIComponent(productId)}&targetSpanSecs=${COINBASE_BOOTSTRAP_TARGET_SECS}`,
            { cache: "no-store" },
          ),
        ]);
        const candlesPayload = candlesResponse.ok
          ? (await candlesResponse.json()) as { candles?: Array<[number, number, number, number, number, number]> }
          : { candles: [] };
        const rawCandles = Array.isArray(candlesPayload.candles) ? candlesPayload.candles : [];
        const tradesPayload = tradesResponse.ok
          ? (await tradesResponse.json()) as { trades?: TradeSample[] }
          : { trades: [] };
        if (cancelled) return;

        const minuteCandles = Array.isArray(rawCandles)
          ? rawCandles
            .map((candle) => ({
              time: candle[0],
              low: candle[1],
              high: candle[2],
              open: candle[3],
              close: candle[4],
            }))
            .sort((a, b) => a.time - b.time)
          : [];

        setCoinbaseMinuteCandles(minuteCandles);

        const latestMinuteClose = minuteCandles[minuteCandles.length - 1]?.close;

        const rawTrades = Array.isArray(tradesPayload.trades) ? tradesPayload.trades : [];
        if (rawTrades.length > 0) {
          const bootstrapPrice = rawTrades[rawTrades.length - 1]?.price
            || snapshotRef.current.price
            || latestMinuteClose
            || market.seedPrice;
          const historyTicks = mergeChartPriceTicks([], tradesToPriceTicks(rawTrades));
          setCoinbaseHistoryTicks(historyTicks);
          setCoinbaseHistorySecondCandles(chartPriceTicksToCandles(historyTicks, 1));
          setSnapshot((prev) => ({
            connected: prev.connected,
            fundingRateBps: prev.fundingRateBps,
            openInterest: prev.openInterest,
            oraclePrice: prev.oraclePrice,
            price: bootstrapPrice,
          }));
        } else {
          setCoinbaseHistorySecondCandles([]);
          setCoinbaseHistoryTicks([]);
          if (typeof latestMinuteClose === "number" && latestMinuteClose > 0) {
            setSnapshot((prev) => ({
              connected: prev.connected,
              fundingRateBps: prev.fundingRateBps,
              openInterest: prev.openInterest,
              oraclePrice: prev.oraclePrice,
              price: latestMinuteClose,
            }));
          }
        }
        historyLoaded = true;
      } catch {
        // Keep the last Coinbase history if refresh fails.
      } finally {
        if (!cancelled) {
          if (historyLoaded) {
            coinbaseHistoryLoadedKeyRef.current = historyLoadKey;
          }
          setCoinbaseBootstrapReady(true);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [active, coinbaseHistoryRefreshNonce, market.marketName, marketKey, useCoinbaseLineFeed]);

  useEffect(() => {
    setUseBtcFallback(false);
    decibelLiveAtRef.current = 0;
  }, [marketKey]);

  useEffect(() => {
    if (!btcFallbackEnabled) {
      setUseBtcFallback(false);
      return;
    }

    if (useCoinbaseLineFeed) {
      setUseBtcFallback(false);
      return;
    }

    if (decibelLiveAtRef.current > 0) {
      setUseBtcFallback(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (decibelLiveAtRef.current === 0) {
        setUseBtcFallback(true);
      }
    }, BTC_FALLBACK_ACTIVATE_MS);

    return () => window.clearTimeout(timer);
  }, [btcFallbackEnabled, useCoinbaseLineFeed]);

  useEffect(() => {
    if (!useCoinbaseLineFeed) return;

    const bootstrapPrice =
      coinbasePrice
      || coinbaseHistoryTicks[coinbaseHistoryTicks.length - 1]?.value
      || coinbaseHistorySecondCandles[coinbaseHistorySecondCandles.length - 1]?.close
      || coinbaseMinuteCandles[coinbaseMinuteCandles.length - 1]?.close
      || 0;

    if (bootstrapPrice > 0) {
      setSnapshot((prev) => ({
        connected: coinbaseConnected || prev.connected,
        fundingRateBps: prev.fundingRateBps,
        openInterest: prev.openInterest,
        oraclePrice: prev.oraclePrice,
        price: bootstrapPrice,
      }));
    }

    if (coinbaseBootstrapReady && lineBootstrapReady) {
      setHasInitialHistory(true);
      setLoading(false);
    }
  }, [
    coinbaseBootstrapReady,
    coinbaseConnected,
    coinbaseHistorySecondCandles,
    coinbaseHistoryTicks,
    coinbaseMinuteCandles,
    coinbasePrice,
    lineBootstrapReady,
    useCoinbaseLineFeed,
  ]);

  useEffect(() => {
    if (!useBtcFallback || !btcFallbackEnabled || useCoinbaseLineFeed) return () => {};

    let cancelled = false;
    let tickerTimer: ReturnType<typeof setTimeout> | null = null;

    const loadFallbackHistory = async () => {
      try {
        const response = await fetch("/api/btc/candles?limit=180", { cache: "no-store" });
        if (!response.ok || cancelled) return;

        const data = await response.json() as { candles?: MarketHistoryCandle[] };
        if (cancelled || !data.candles || data.candles.length === 0) return;

        const history = toHistoryCandlePoints(data.candles);
        if (history.length > 0) {
          setMinuteCandles(aggregateCandles(history, 60));
          const historyTicks = history.map((candle) => ({
            time: candle.time,
            value: candle.close,
          }));
          setDecibelTradeTicks((liveTicks) => mergeChartPriceTicks(historyTicks, liveTicks));
          setHasInitialHistory(true);
        }
      } catch {
        // Ignore fallback history misses; ticker polling below can still recover the chart.
      }
    };

    const pollFallbackTicker = async () => {
      try {
        const response = await fetch("/api/btc/ticker", { cache: "no-store" });
        if (!response.ok || cancelled) return;

        const data = await response.json() as { price?: number };
        const nextPrice = typeof data.price === "number" ? data.price : 0;
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) return;

        setSnapshot((prev) => ({
          connected: true,
          fundingRateBps: prev.fundingRateBps,
          openInterest: prev.openInterest,
          oraclePrice: prev.oraclePrice,
          price: nextPrice,
        }));
        setDecibelMarkTicks((prev) => mergeChartPriceTicks(prev, [{
          time: Date.now() / 1_000,
          value: nextPrice,
        }]));
        setHasInitialHistory(true);
      } catch {
        // Keep the existing fallback state if the ticker misses a beat.
      } finally {
        if (!cancelled) {
          tickerTimer = setTimeout(pollFallbackTicker, PRICE_FALLBACK_POLL_MS);
        }
      }
    };

    void loadFallbackHistory();
    void pollFallbackTicker();

    return () => {
      cancelled = true;
      if (tickerTimer) clearTimeout(tickerTimer);
    };
  }, [btcFallbackEnabled, useBtcFallback, useCoinbaseLineFeed]);

  useEffect(() => {
    let cancelled = false;
    const currentMarket = marketRef.current;

    if (useCoinbaseLineFeed) {
      coinbaseHistoryLoadedKeyRef.current = null;
      setLoading(true);
      if (lineViewResetKeyRef.current !== marketKey) {
        lineViewResetKeyRef.current = marketKey;
        setLineWindowSecs(MAX_LINE_WINDOW_SECS);
        setLineEndTime(null);
        setManualLineVerticalPad(0);
      }
      setDecibelTradeTicks([]);
      setDecibelMarkTicks([]);
      setMinuteCandles([]);
      setCoinbaseMinuteCandles([]);
      setCoinbaseHistorySecondCandles([]);
      setCoinbaseHistoryTicks([]);
      setHasInitialHistory(false);
      setSnapshot({
        connected: false,
        fundingRateBps: null,
        openInterest: null,
        oraclePrice: currentMarket.oraclePrice ?? 0,
        price: currentMarket.seedPrice,
      });
      return () => {
        cancelled = true;
      };
    }

    async function loadInitial() {
      const currentMarket = marketRef.current;
      coinbaseHistoryLoadedKeyRef.current = null;
      setLoading(true);
      // Reset view state only when the MARKET changed — this effect also
      // re-runs on feed-fallback flips, and those must not stomp the user's
      // chosen window/pan.
      if (lineViewResetKeyRef.current !== marketKey) {
        lineViewResetKeyRef.current = marketKey;
        setLineWindowSecs(MAX_LINE_WINDOW_SECS);
        setLineEndTime(null);
        setManualLineVerticalPad(0);
      }
      setDecibelTradeTicks([]);
      setDecibelMarkTicks([]);
      setMinuteCandles([]);
      setHasInitialHistory(false);
      setSnapshot({
        connected: false,
        fundingRateBps: null,
        openInterest: null,
        oraclePrice: currentMarket.oraclePrice ?? 0,
        price: currentMarket.seedPrice,
      });

      try {
        const now = Date.now();
        const [pricesResult, candlesResult, tradesResult] = await Promise.allSettled([
          fetchDecibelMainnetPrices(INITIAL_REQUEST_TIMEOUT_MS),
          // 12h of minute candles — the upstream caps requests at 1000 bars,
          // so the old 24h ask (1440 bars) got a 400 and left history empty.
          // 12h covers the largest line window; 24h volume comes from the
          // indexer's asset_contexts, not from candles.
          fetchDecibelMainnetCandles(
            currentMarket.marketAddr,
            "1m",
            now - MINUTE_HISTORY_MS,
            now,
            INITIAL_REQUEST_TIMEOUT_MS,
          ),
          fetchDecibelMainnetTrades(
            currentMarket.marketAddr,
            INITIAL_TRADE_LIMIT,
            INITIAL_REQUEST_TIMEOUT_MS,
          ),
        ]);

        if (cancelled) return;

        const priceEntry = pricesResult.status === "fulfilled"
          ? pricesResult.value.find((entry) => entry.market === currentMarket.marketAddr) ?? null
          : null;
        const nextPrice =
          priceEntry?.mark_px ?? priceEntry?.mid_px ?? priceEntry?.oracle_px ?? currentMarket.seedPrice;

        setSnapshot({
          connected: priceEntry !== null,
          fundingRateBps: priceEntry?.funding_rate_bps ?? null,
          openInterest: priceEntry?.open_interest ?? null,
          oraclePrice: priceEntry?.oracle_px ?? currentMarket.oraclePrice ?? 0,
          price: nextPrice,
        });
        if (priceEntry) {
          decibelLiveAtRef.current = Date.now();
          setUseBtcFallback(false);
        }

        if (candlesResult.status === "fulfilled" && candlesResult.value.length > 0) {
          setMinuteCandles(toCandlePoints(candlesResult.value));
        }

        const initialTradeTicks = tradesResult.status === "fulfilled"
          ? tradesToPriceTicks(tradesResult.value)
          : [];
        const initialMarkTicks = priceEntry
          ? [{
            time: priceEntry.transaction_unix_ms / 1_000,
            value: nextPrice,
          }]
          : [];
        setDecibelTradeTicks((liveTicks) => mergeChartPriceTicks(initialTradeTicks, liveTicks));
        setDecibelMarkTicks((liveTicks) => mergeChartPriceTicks(initialMarkTicks, liveTicks));

        setHasInitialHistory(
          (candlesResult.status === "fulfilled" && candlesResult.value.length > 0)
            || (tradesResult.status === "fulfilled" && tradesResult.value.length > 0)
        );
      } catch {
        if (cancelled) return;
        setDecibelTradeTicks([]);
        setDecibelMarkTicks([]);
        setHasInitialHistory(false);
        setSnapshot({
          connected: false,
          fundingRateBps: null,
          openInterest: null,
          oraclePrice: currentMarket.oraclePrice ?? 0,
          price: currentMarket.seedPrice,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();

    return () => {
      cancelled = true;
    };
  }, [marketKey, useCoinbaseLineFeed]);

  useEffect(() => {
    if (!active || !marketAddress || useCoinbaseLineFeed) {
      return () => {};
    }

    if (btcFallbackEnabled && useBtcFallback) {
      return () => {};
    }

    let cancelled = false;
    let priceTimer: ReturnType<typeof setTimeout> | null = null;
    let tradeTimer: ReturnType<typeof setTimeout> | null = null;
    const streamIsFresh = () => Date.now() - decibelLiveAtRef.current < STREAM_FRESH_MS;

    const pollPrice = async () => {
      if (streamIsFresh()) {
        if (!cancelled) priceTimer = setTimeout(pollPrice, PRICE_FALLBACK_POLL_MS);
        return;
      }

      try {
        const prices = await fetchDecibelMainnetPrices();
        const price = prices.find((entry) => entry.market === marketAddress);
        if (!price || cancelled) return;

        setSnapshot({
          connected: true,
          fundingRateBps: price.funding_rate_bps,
          openInterest: price.open_interest,
          oraclePrice: price.oracle_px,
          price: price.mark_px ?? price.mid_px ?? price.oracle_px,
        });
        decibelLiveAtRef.current = Date.now();
        setUseBtcFallback(false);

        setDecibelMarkTicks((prev) => mergeChartPriceTicks(prev, [{
          time: price.transaction_unix_ms / 1_000,
          value: price.mark_px ?? price.mid_px ?? price.oracle_px,
        }]));
        setHasInitialHistory(true);
      } catch {
        if (!cancelled) {
          if (!useBtcFallback) {
            setSnapshot((prev) => ({ ...prev, connected: false }));
          }
        }
      } finally {
        if (!cancelled) priceTimer = setTimeout(pollPrice, PRICE_FALLBACK_POLL_MS);
      }
    };

    const refreshTrades = async () => {
      if (streamIsFresh()) {
        if (!cancelled) tradeTimer = setTimeout(refreshTrades, TRADE_FALLBACK_POLL_MS);
        return;
      }

      try {
        const trades = await fetchDecibelMainnetTrades(marketAddress, LIVE_TRADE_REFRESH_LIMIT);
        if (cancelled) return;

        setDecibelTradeTicks((prev) => mergeChartPriceTicks(prev, tradesToPriceTicks(trades)));
        if (trades.length > 0) {
          setHasInitialHistory(true);
        }
      } catch {
        // Keep existing candles if the trade refresh misses a beat.
      } finally {
        if (!cancelled) tradeTimer = setTimeout(refreshTrades, TRADE_FALLBACK_POLL_MS);
      }
    };

    priceTimer = setTimeout(pollPrice, 2500);
    tradeTimer = setTimeout(refreshTrades, 5000);

    return () => {
      cancelled = true;
      if (priceTimer) clearTimeout(priceTimer);
      if (tradeTimer) clearTimeout(tradeTimer);
    };
  }, [active, btcFallbackEnabled, marketAddress, useBtcFallback, useCoinbaseLineFeed]);

  useEffect(() => {
    if (
      !active
      || typeof window === "undefined"
      || !marketAddress
      || useCoinbaseLineFeed
      || (btcFallbackEnabled && useBtcFallback)
    ) return () => {};

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stream: EventSource | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        network: getDecibelPublicNetwork(),
        topics: [
          `market_price:${marketAddress}`,
          `trades:${marketAddress}`,
          `market_candlestick:${marketAddress}:1m`,
        ].join(","),
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
            price?: {
              funding_rate_bps: number;
              mark_px: number;
              mid_px: number;
              open_interest: number;
              oracle_px: number;
              transaction_unix_ms: number;
            };
            trades?: DecibelRestTrade[];
            candle?: DecibelRestCandle;
          };

          if (!message.topic || message.success) return;

          if (message.topic === `market_price:${marketAddress}` && message.price) {
            const livePrice = message.price.mark_px ?? message.price.mid_px ?? message.price.oracle_px;
            setSnapshot({
              connected: true,
              fundingRateBps: message.price.funding_rate_bps ?? null,
              openInterest: message.price.open_interest ?? null,
              oraclePrice: message.price.oracle_px ?? marketRef.current.oraclePrice ?? 0,
              price: livePrice,
            });
            decibelLiveAtRef.current = Date.now();
            setUseBtcFallback(false);
            setDecibelMarkTicks((prev) => mergeChartPriceTicks(prev, [{
              time: message.price!.transaction_unix_ms / 1_000,
              value: livePrice,
            }]));
            // A bare price tick is NOT history — flipping hasInitialHistory
            // here hid the loader ~1s in and rendered the whole window as a
            // flat backfill from one point (the mobile "broken L" first
            // paint). Trades/candles/bootstrap flip it instead.
          }

          if (message.topic === `trades:${marketAddress}` && Array.isArray(message.trades) && message.trades.length > 0) {
            decibelLiveAtRef.current = Date.now();
            setUseBtcFallback(false);
            setDecibelTradeTicks((prev) => mergeChartPriceTicks(
              prev,
              tradesToPriceTicks(message.trades ?? []),
            ));
            setHasInitialHistory(true);
          }

          if (message.topic === `market_candlestick:${marketAddress}:1m` && message.candle) {
            setMinuteCandles((prev) => upsertMinuteCandle(prev, message.candle!));
            setHasInitialHistory(true);
          }
        } catch {
          // Ignore malformed ws frames and keep the existing connection alive.
        }
      });

      stream.addEventListener("error", () => {
        if (cancelled) return;
        stream?.close();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(1000 * 1.5 ** reconnectAttempt, 8000));
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream?.close();
    };
  }, [active, btcFallbackEnabled, marketAddress, useBtcFallback, useCoinbaseLineFeed]);

  // Moving-average overlay — derived purely from the data already rendered, so the
  // overlay always shows exactly what the chart shows (no extra fetches/feeds).
  const indicatorSeries = useMemo<LivelineSeries[]>(() => {
    if (overlayMode === "off") return [];
    const src: LivelinePoint[] = mode === "line"
      ? renderLineData
      : renderSecondCandles.map((c) => ({ time: c.time, value: c.close }));
    if (src.length < 25) return [];
    const sma = (period: number): LivelinePoint[] => {
      const out: LivelinePoint[] = [];
      let sum = 0;
      for (let i = 0; i < src.length; i++) {
        sum += src[i].value;
        if (i >= period) sum -= src[i - period].value;
        if (i >= period - 1) out.push({ time: src[i].time, value: sum / period });
      }
      return out;
    };
    const ema = (period: number): LivelinePoint[] => {
      const out: LivelinePoint[] = [];
      const k = 2 / (period + 1);
      let prev = src[0].value;
      for (let i = 0; i < src.length; i++) {
        prev = i === 0 ? src[0].value : src[i].value * k + prev * (1 - k);
        if (i >= period - 1) out.push({ time: src[i].time, value: prev });
      }
      return out;
    };
    const isStrategy = overlayMode === "strategy";
    const calc = overlayMode === "ema" ? ema : sma;
    const tag = overlayMode === "ema" ? "EMA" : "SMA";
    const fastPeriod = isStrategy ? 3 : 20;
    const slowPeriod = isStrategy ? 5 : 50;
    const fast = calc(fastPeriod);
    const slow = calc(slowPeriod);
    const series: LivelineSeries[] = [];
    const fastColor = isStrategy ? "#34d399" : "#a855f7";
    if (fast.length >= 2) series.push({ id: `${tag}${fastPeriod}`, data: fast, value: fast[fast.length - 1].value, color: fastColor, label: isStrategy ? "Vault SMA 3" : `${tag} ${fastPeriod}` });
    if (slow.length >= 2) series.push({ id: `${tag}${slowPeriod}`, data: slow, value: slow[slow.length - 1].value, color: "#f59e0b", label: isStrategy ? "Vault SMA 5" : `${tag} ${slowPeriod}` });
    return series;
  }, [overlayMode, mode, renderLineData, renderSecondCandles]);

  // Fast/slow crossovers from the rendered overlay — surfaced as BUY/SELL signal
  // chips (Liveline draws line series only, so events render as chips, not dots).
  const overlayCrossings = useMemo(() => {
    if (overlayMode === "off" || indicatorSeries.length < 2) return [];
    const fast = indicatorSeries[0].data;
    const slowByTime = new Map(indicatorSeries[1].data.map((p) => [p.time, p.value]));
    const crossings: { time: number; side: "buy" | "sell"; price: number }[] = [];
    let prevDiff: number | null = null;
    for (const p of fast) {
      const s = slowByTime.get(p.time);
      if (s === undefined) continue;
      const diff = p.value - s;
      if (prevDiff !== null && diff !== 0 && Math.sign(diff) !== Math.sign(prevDiff)) {
        crossings.push({ time: p.time, side: diff > 0 ? "buy" : "sell", price: p.value });
      }
      if (diff !== 0) prevDiff = diff;
    }
    return crossings.slice(-3);
  }, [overlayMode, indicatorSeries]);

  // Candle mode keeps the existing canvas shell while bklit renders the
  // plotted OHLC marks. The line path below remains the low-latency live view.
  if (mode === "candle") {
    return (
      <ProCandleChart
        market={market}
        active={active}
        latestPrice={snapshot.price}
        latestPriceTime={activePriceTicks[activePriceTicks.length - 1]?.time ?? chartNowSec}
        liquidationLines={liquidationLines}
        minuteCandles={activeMinuteCandles}
        overlayMode={overlayMode}
        secondCandles={observedTradeSecondCandles}
      />
    );
  }

  return (
    <>
      {/* Loading overlay */}
      {loading && !hasInitialHistory && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ paddingRight: CHART_PADDING.right, paddingLeft: CHART_PADDING.left }}>
          <TetherLoader size={52} label="Loading" />
        </div>
      )}
      {/* Liveline receives only real line ticks. Candle rendering is isolated above. */}
      <div
        ref={lineInteractionRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={handleLinePointerDown}
        onPointerMove={handleLinePointerMove}
        onPointerUp={handleLinePointerUp}
        onPointerCancel={handleLinePointerUp}
        onWheel={handleLineWheel}
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <ChartDotBackground padding={linePadding} />
        <Liveline
          data={renderLineData}
          series={indicatorSeries.length > 0 ? indicatorSeries : undefined}
          value={displayedLineValue}
          theme="dark"
          color={lineColor}
          window={Math.max(MIN_LINE_WINDOW_SECS, lineWindowSecs)}
          grid={false}
          scrub
          badge
          badgeInside
          badgeOffsetY={-14}
          momentum={false}
          badgeTail={false}
          badgeVariant="minimal"
          fill={false}
          lerpSpeed={0.35}
          lineInterpolation="linear"
          animateInitial={false}
          animated={false}
          formatValue={(value: number) => formatPerpPrice(value, market.priceDecimals)}
          loading={false}
          emptyText=""
          padding={linePadding}
          paused={!active}
        />
        {/* Window presets — our own pills, not Liveline's `windows` prop: that
            prop flips Liveline to self-managed window state seeded from
            windows[0], which ignores the `window` prop and breaks wheel zoom. */}
        <div
          className="absolute left-2 top-2 z-10 flex items-center gap-0.5 rounded-[7px] border border-white/[0.07] bg-[#141414]/85 p-0.5 backdrop-blur-sm"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {LINE_WINDOW_OPTIONS.map((option) => (
            <button
              key={option.secs}
              type="button"
              onClick={() =>
                setLineWindowSecs(
                  clamp(option.secs, MIN_LINE_WINDOW_SECS, MAX_LINE_WINDOW_SECS)
                )
              }
              className={`rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase transition-colors ${
                Math.abs(lineWindowSecs - option.secs) < option.secs * 0.25
                  ? "bg-white/[0.12] text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 z-10 w-6 cursor-ns-resize"
          onWheel={handleLineAxisWheel}
          onDoubleClick={() => setManualLineVerticalPad(0)}
        />
        {/* Overlay crossover signals — most recent first */}
        {overlayCrossings.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-9 z-10 flex flex-col gap-1">
            {[...overlayCrossings].reverse().map((c) => (
              <span
                key={`${c.side}-${c.time}`}
                className={`flex items-center gap-1.5 self-start rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                  c.side === "buy"
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {c.side === "buy" ? "▲ Buy" : "▼ Sell"}
                <span className="font-medium normal-case text-zinc-500">
                  {new Date(c.time * 1000).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export const BtcPerpsChart = memo(BtcPerpsChartComponent, (prev, next) => (
  prev.active === next.active
  && prev.mode === next.mode
  && prev.liquidationLines === next.liquidationLines
  && prev.onSnapshotChange === next.onSnapshotChange
  && prev.market.marketName === next.market.marketName
  && prev.market.marketAddr === next.market.marketAddr
  && prev.market.color === next.market.color
  && prev.market.priceDecimals === next.market.priceDecimals
  && prev.market.leverage === next.market.leverage
  && prev.overlayMode === next.overlayMode
));
