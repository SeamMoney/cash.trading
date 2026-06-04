"use client";

import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Liveline, type CandlePoint, type LivelinePoint } from "liveline";
import { TetherLoader } from "@/components/layout/TetherLoader";
import type { PerpMarketData } from "@/components/trade/perpMarketConfig";
import { useIsMobile } from "@/components/ui/use-mobile";
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
import { dedupeAndSort, withLiveTail } from "@/lib/trade/lineData";

type TradeSample = {
  price: number;
  size?: number;
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

const CHART_PADDING = { top: 8, right: 80, bottom: 36, left: 8 } as const;
const TRADE_POLL_MS = 4000;
const PRICE_POLL_MS = 1000;
const ONE_SECOND_WINDOW_SECS = 12 * 60;
const MINUTE_HISTORY_MS = 12 * 60 * 60 * 1000;
const DECIBEL_VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DECIBEL_MINUTE_CANDLES = Math.ceil(DECIBEL_VOLUME_WINDOW_MS / 60_000) + 5;
const SECOND_TRADE_LIMIT = 1800;
const INITIAL_TRADE_LIMIT = 900;
const BTC_FALLBACK_ACTIVATE_MS = 3500;
const DEFAULT_LINE_WINDOW_SECS = 5 * 60;
const MOBILE_BTC_LINE_WINDOW_SECS = 3 * 60;
const MOBILE_SPARSE_MARKET_LINE_WINDOW_SECS = 2 * 60 * 60;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function buildSecondCandlesFromTrades(
  trades: TradeSample[],
  fallbackPrice: number,
  nowMs: number,
) {
  const sorted = [...trades].sort((a, b) => a.transaction_unix_ms - b.transaction_unix_ms);
  const currentSec = Math.floor(nowMs / 1000);
  const oldestTradeSec = sorted.length > 0
    ? Math.floor(sorted[0].transaction_unix_ms / 1000)
    : currentSec - ONE_SECOND_WINDOW_SECS + 1;
  const startSec = Math.max(currentSec - ONE_SECOND_WINDOW_SECS + 1, oldestTradeSec);
  const tradesBySecond = new Map<number, TradeSample[]>();

  for (const trade of sorted) {
    const sec = Math.floor(trade.transaction_unix_ms / 1000);
    if (sec < startSec) continue;
    const bucket = tradesBySecond.get(sec);
    if (bucket) {
      bucket.push(trade);
    } else {
      tradesBySecond.set(sec, [trade]);
    }
  }

  const firstTradePrice = sorted.length > 0 ? sorted[0].price : fallbackPrice;
  let lastClose = Number.isFinite(firstTradePrice) && firstTradePrice > 0 ? firstTradePrice : fallbackPrice;
  const candles: ChartCandlePoint[] = [];

  for (let sec = startSec; sec <= currentSec; sec += 1) {
    const bucket = tradesBySecond.get(sec) ?? [];

    if (bucket.length === 0) {
      candles.push({
        time: sec,
        open: lastClose,
        high: lastClose,
        low: lastClose,
        close: lastClose,
        volume: 0,
      });
      continue;
    }

    const open = bucket[0].price;
    const close = bucket[bucket.length - 1].price;
    let high = open;
    let low = open;
    let volume = 0;

    for (const trade of bucket) {
      if (trade.price > high) high = trade.price;
      if (trade.price < low) low = trade.price;
      if (Number.isFinite(trade.size ?? NaN)) volume += Math.abs(trade.size ?? 0);
    }

    candles.push({
      time: sec,
      open,
      high,
      low,
      close,
      volume,
    });
    lastClose = close;
  }

  return candles;
}

function mergeTradesIntoSecondCandles(
  candles: CandlePoint[],
  trades: TradeSample[],
  fallbackPrice: number,
  nowMs: number,
) {
  if (trades.length === 0) return candles;

  const next = candles.slice().sort((a, b) => a.time - b.time) as ChartCandlePoint[];
  const sorted = [...trades].sort((a, b) => a.transaction_unix_ms - b.transaction_unix_ms);
  let latestTime = next[next.length - 1]?.time ?? 0;
  let latestClose = next[next.length - 1]?.close ?? fallbackPrice;

  for (const trade of sorted) {
    const price = trade.price;
    const tradeSize = Number.isFinite(trade.size ?? NaN) ? Math.abs(trade.size ?? 0) : 0;
    const sec = Math.floor(trade.transaction_unix_ms / 1000);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(sec)) continue;

    const previous = next[next.length - 1];
    if (previous && sec < previous.time) {
      // Late websocket frames after tab restore must not rewrite committed
      // history or append out-of-order candles.
      continue;
    }

    const index = next.findIndex((candle) => candle.time === sec);
    if (index >= 0) {
      const candle = next[index];
      next[index] = {
        ...candle,
        high: Math.max(candle.high, price),
        low: Math.min(candle.low, price),
        close: price,
        volume: ((candle as ChartCandlePoint).volume ?? 0) + tradeSize,
      };
      if (sec >= latestTime) {
        latestTime = sec;
        latestClose = price;
      }
      continue;
    }

    if (!previous) {
      next.push({
        time: sec,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: tradeSize,
      });
      latestTime = sec;
      latestClose = price;
      continue;
    }

    for (let fillSec = previous.time + 1; fillSec < sec; fillSec += 1) {
      next.push({
        time: fillSec,
        open: latestClose,
        high: latestClose,
        low: latestClose,
        close: latestClose,
        volume: 0,
      });
    }

    next.push({
      time: sec,
      open: latestClose,
      high: Math.max(latestClose, price),
      low: Math.min(latestClose, price),
      close: price,
      volume: tradeSize,
    });
    latestTime = sec;
    latestClose = price;
  }

  return updateSecondCandlesWithPrice(
    next.slice(-ONE_SECOND_WINDOW_SECS),
    latestClose,
    nowMs
  );
}

function updateSecondCandlesWithPrice(candles: CandlePoint[], nextPrice: number, nowMs: number) {
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) return candles;

  const currentSec = Math.floor(nowMs / 1000);
  const next = candles.slice() as ChartCandlePoint[];
  const last = next[next.length - 1];

  if (!last) {
    return [{
      time: currentSec,
      open: nextPrice,
      high: nextPrice,
      low: nextPrice,
      close: nextPrice,
      volume: 0,
    }];
  }

  if (last.time === currentSec) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, nextPrice),
      low: Math.min(last.low, nextPrice),
      close: nextPrice,
    };
    return next;
  }

  if (last.time > currentSec) {
    return next.sort((a, b) => a.time - b.time).slice(-ONE_SECOND_WINDOW_SECS);
  }

  let prevClose = last.close;
  for (let sec = last.time + 1; sec < currentSec; sec += 1) {
    next.push({
      time: sec,
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
    });
  }

  next.push({
    time: currentSec,
    open: prevClose,
    high: Math.max(prevClose, nextPrice),
    low: Math.min(prevClose, nextPrice),
    close: nextPrice,
    volume: 0,
  });

  return next.slice(-ONE_SECOND_WINDOW_SECS);
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

function densifyCandles(
  candles: CandlePoint[],
  stepSecs: number,
  fallbackSpanSecs: number,
) {
  if (candles.length === 0 || stepSecs <= 0) return candles;

  const expanded: CandlePoint[] = [];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const nextTime = candles[index + 1]?.time ?? (candle.time + fallbackSpanSecs);
    const spanSecs = Math.max(stepSecs, nextTime - candle.time);
    const steps = Math.max(1, Math.round(spanSecs / stepSecs));
    const firstPivot = candle.close >= candle.open ? candle.low : candle.high;
    const secondPivot = candle.close >= candle.open ? candle.high : candle.low;

    const sample = (progress: number) => {
      if (progress <= 0.28) {
        return candle.open + (firstPivot - candle.open) * (progress / 0.28);
      }
      if (progress <= 0.72) {
        return firstPivot + (secondPivot - firstPivot) * ((progress - 0.28) / 0.44);
      }
      return secondPivot + (candle.close - secondPivot) * ((progress - 0.72) / 0.28);
    };

    for (let step = 0; step < steps; step += 1) {
      const startProgress = step / steps;
      const endProgress = (step + 1) / steps;
      const open = sample(startProgress);
      const close = sample(endProgress);
      let high = Math.max(open, close);
      let low = Math.min(open, close);

      if (startProgress <= 0.28 && endProgress >= 0.28) {
        high = Math.max(high, firstPivot);
        low = Math.min(low, firstPivot);
      }
      if (startProgress <= 0.72 && endProgress >= 0.72) {
        high = Math.max(high, secondPivot);
        low = Math.min(low, secondPivot);
      }

      expanded.push({
        time: candle.time + step * stepSecs,
        open,
        high,
        low,
        close,
      });
    }
  }

  return expanded;
}

function buildLineHistory(
  minuteCandles: CandlePoint[],
  secondCandles: CandlePoint[],
  interval: ChartInterval,
) {
  if (interval === "1m") {
    return mergeMinuteCandlesWithLive(minuteCandles, secondCandles);
  }

  if (interval === "1s") {
    if (secondCandles.length === 0) return densifyCandles(minuteCandles, 5, 60);

    return [
      ...densifyCandles(
        minuteCandles.filter((candle) => candle.time < secondCandles[0].time),
        5,
        60,
      ),
      ...secondCandles,
    ];
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
  if (windowSecs <= 15 * 60) return "1s";
  if (windowSecs <= 75 * 60) return "5s";
  if (windowSecs <= 4 * 60 * 60) return "15s";
  return "1m";
}

function getMaxLineGapSecs(interval: ChartInterval) {
  return Math.max(4, INTERVAL_SECONDS[interval] * 4);
}

function fillShortLineGaps(points: LivelinePoint[], interval: ChartInterval) {
  if (points.length < 2) return points;

  const stepSecs = INTERVAL_SECONDS[interval];
  const maxGapSecs = getMaxLineGapSecs(interval);
  const filled: LivelinePoint[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = filled[filled.length - 1];
    const point = points[index];
    const gapSecs = point.time - previous.time;

    if (gapSecs > stepSecs * 1.5 && gapSecs <= maxGapSecs) {
      for (let time = previous.time + stepSecs; time < point.time - stepSecs * 0.25; time += stepSecs) {
        filled.push({ time, value: previous.value });
      }
    }

    filled.push(point);
  }

  return filled;
}

function trimAfterLargeLineGap(points: LivelinePoint[], interval: ChartInterval) {
  if (points.length < 2) return points;

  const maxGapSecs = getMaxLineGapSecs(interval);
  let segmentStart = 0;

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].time - points[index - 1].time > maxGapSecs) {
      segmentStart = index;
    }
  }

  return segmentStart === 0 ? points : points.slice(segmentStart);
}

function buildLinePoints(candles: CandlePoint[], interval: ChartInterval) {
  if (candles.length === 0) return [];

  const points: LivelinePoint[] = [
    {
      time: candles[0].time,
      value: candles[0].open,
    },
  ];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const nextTime = candles[index + 1]?.time ?? (candle.time + INTERVAL_SECONDS[interval]);
    const span = Math.max(1, nextTime - candle.time);
    const firstTurnTime = candle.time + span * 0.24;
    const secondTurnTime = candle.time + span * 0.58;
    const closeTime = candle.time + span * 0.98;
    const isBull = candle.close >= candle.open;
    const firstTurnValue = isBull ? candle.low : candle.high;
    const secondTurnValue = isBull ? candle.high : candle.low;

    points.push(
      {
        time: firstTurnTime,
        value: firstTurnValue,
      },
      {
        time: secondTurnTime,
        value: secondTurnValue,
      },
      {
        time: closeTime,
        value: candle.close,
      },
    );
  }

  return points;
}

function buildCloseLinePoints(candles: CandlePoint[], interval: ChartInterval) {
  if (candles.length === 0) return [];

  const spanSecs = INTERVAL_SECONDS[interval];
  const points: LivelinePoint[] = [
    {
      time: candles[0].time,
      value: candles[0].open,
    },
  ];

  for (const candle of candles) {
    points.push({
      time: candle.time + spanSecs * 0.96,
      value: candle.close,
    });
  }

  return points;
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
  secondCandles: CandlePoint[],
  startTime: number,
  endTime: number,
) {
  const visibleSecondCandles = secondCandles.filter(
    (candle) => candle.time >= startTime && candle.time <= endTime,
  );
  const recentStart = visibleSecondCandles[0]?.time ?? endTime;
  const historicalPoints = buildCloseLinePoints(
    densifyCandles(
      minuteCandles.filter((candle) => candle.time >= startTime - 60 && candle.time < recentStart),
      5,
      60,
    ).filter((candle) => candle.time >= startTime && candle.time < recentStart),
    "5s",
  );
  const recentPoints = buildCloseLinePoints(
    visibleSecondCandles,
    "1s",
  );

  return mergeLivelinePoints(historicalPoints, recentPoints);
}

function buildHybridSecondLinePoints(
  minuteCandles: CandlePoint[],
  secondCandles: CandlePoint[],
  startTime: number,
  endTime: number,
) {
  const recentStart = secondCandles[0]?.time ?? endTime;
  const backfillCandles = densifyCandles(
    minuteCandles.filter((candle) => candle.time >= startTime - 60 && candle.time < recentStart),
    5,
    60,
  );
  const backfillPoints = buildLinePoints(backfillCandles, "5s")
    .filter((point) => point.time >= startTime && point.time <= endTime);
  const recentPoints = buildLinePoints(
    secondCandles.filter((candle) => candle.time >= startTime && candle.time <= endTime),
    "1s",
  );
  const byTime = new Map<number, LivelinePoint>();

  for (const point of backfillPoints) {
    byTime.set(Math.round(point.time * 1000), point);
  }
  for (const point of recentPoints) {
    byTime.set(Math.round(point.time * 1000), point);
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

function fillLineWindowStart(points: LivelinePoint[], startTime: number) {
  if (points.length === 0) return points;

  const first = points[0];
  if (first.time <= startTime + 2) return points;

  return [{ time: startTime, value: first.value }, ...points];
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
};

function BtcPerpsChartComponent({
  active,
  liquidationLines = [],
  market,
  mode,
  onSnapshotChange,
}: BtcPerpsChartProps) {
  const marketRef = useRef(market);
  marketRef.current = market;
  const marketKey = `${market.marketName}:${market.marketAddr ?? ""}`;
  const marketAddress = market.marketAddr;
  const isMobile = useIsMobile();
  const [secondCandles, setSecondCandles] = useState<CandlePoint[]>([]);
  const [minuteCandles, setMinuteCandles] = useState<CandlePoint[]>([]);
  const [coinbaseMinuteCandles, setCoinbaseMinuteCandles] = useState<CandlePoint[]>([]);
  const [coinbaseHistorySecondCandles, setCoinbaseHistorySecondCandles] = useState<CandlePoint[]>([]);
  const [coinbaseHistoryTicks, setCoinbaseHistoryTicks] = useState<LivelinePoint[]>([]);
  const [coinbaseBootstrapReady, setCoinbaseBootstrapReady] = useState(false);
  const [coinbaseHistoryRefreshNonce, setCoinbaseHistoryRefreshNonce] = useState(0);
  const [hasInitialHistory, setHasInitialHistory] = useState(false);
  const [useBtcFallback, setUseBtcFallback] = useState(false);
  const [lineWindowSecs, setLineWindowSecs] = useState(DEFAULT_LINE_WINDOW_SECS);
  const [lineEndTime, setLineEndTime] = useState<number | null>(null);
  const [manualLineVerticalPad, setManualLineVerticalPad] = useState(0);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<PerpMarketSnapshot>({
    connected: false,
    fundingRateBps: null,
    openInterest: null,
    oraclePrice: market.seedPrice * 1.0004,
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
    seedBackfillTicks: false,
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

  const activeSecondCandles = useMemo(
    () => (useCoinbaseLineFeed ? coinbaseSecondCandles : secondCandles),
    [coinbaseSecondCandles, secondCandles, useCoinbaseLineFeed],
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

  const defaultLineWindowSecs = useMemo(() => {
    if (!isMobile) return DEFAULT_LINE_WINDOW_SECS;
    return market.marketName === "BTC/USD"
      ? MOBILE_BTC_LINE_WINDOW_SECS
      : MOBILE_SPARSE_MARKET_LINE_WINDOW_SECS;
  }, [isMobile, market.marketName]);

  const lineBounds = useMemo(() => {
    const earliest = activeMinuteCandles[0]?.time ?? activeSecondCandles[0]?.time ?? null;
    const latest = activeSecondCandles[activeSecondCandles.length - 1]?.time
      ?? activeMinuteCandles[activeMinuteCandles.length - 1]?.time
      ?? null;

    return { earliest, latest };
  }, [activeMinuteCandles, activeSecondCandles]);

  const lineResolvedEndTime = useMemo(() => {
    if (lineBounds.latest == null) return null;
    return lineEndTime ?? (lineBounds.latest + LIVE_EDGE_HEADROOM_SECS);
  }, [lineBounds.latest, lineEndTime]);

  const lineInterval = useMemo(
    () => (activeSecondCandles.length === 0 ? "1m" : getLineIntervalForWindow(lineWindowSecs)),
    [activeSecondCandles.length, lineWindowSecs],
  );

  const lineHistoryCandles = useMemo(
    () => buildLineHistory(activeMinuteCandles, activeSecondCandles, lineInterval),
    [activeMinuteCandles, activeSecondCandles, lineInterval],
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
      const latestCoinbaseTick = useCoinbaseLineFeed
        ? coinbaseTicks[coinbaseTicks.length - 1] ?? coinbaseHistoryTicks[coinbaseHistoryTicks.length - 1]
        : null;
      const liveTime = latestCoinbaseTick?.time ?? Math.max(Date.now() / 1000, lineBounds.latest ?? 0);
      const liveValue = latestCoinbaseTick?.value ?? snapshot.price;

      if (useCoinbaseLineFeed && lineInterval === "1s") {
        // Reconstruct committed history from canonical sources every render
        // (acceptance #4: resume must rebuild from sorted arrays, not from
        // animated path state). Then attach the live tick via withLiveTail,
        // which never mutates a committed point.
        const pointsWithTail = withLiveTail(
          dedupeAndSort([
            ...buildHybridVisibleLinePoints(
              activeMinuteCandles,
              activeSecondCandles,
              startTime,
              lineResolvedEndTime,
            ),
            ...coinbaseHistoryTicks.filter((point) => point.time >= startTime - 2 && point.time <= lineResolvedEndTime),
            ...coinbaseTicks.filter((point) => point.time >= startTime - 2 && point.time <= lineResolvedEndTime),
          ]),
          liveValue,
          liveTime,
        );
        return fillLineWindowStart(
          trimAfterLargeLineGap(fillShortLineGaps(pointsWithTail, lineInterval), lineInterval),
          startTime,
        );
      }

      const pointsWithTail = withLiveTail(
        dedupeAndSort(buildCloseLinePoints(lineVisibleCandles, lineInterval)),
        liveValue,
        liveTime,
      );
      return fillLineWindowStart(
        trimAfterLargeLineGap(fillShortLineGaps(pointsWithTail, lineInterval), lineInterval),
        startTime,
      );
    },
    [
      activeMinuteCandles,
      activeSecondCandles,
      coinbaseHistoryTicks,
      coinbaseTicks,
      lineInterval,
      lineBounds.latest,
      lineResolvedEndTime,
      lineVisibleCandles,
      lineWindowSecs,
      snapshot.price,
      useCoinbaseLineFeed,
    ],
  );
  const displayedLineValue = lineData[lineData.length - 1]?.value ?? snapshot.price;
  const displayedCandleValue = activeSecondCandles[activeSecondCandles.length - 1]?.close ?? snapshot.price;

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
          setCoinbaseHistoryTicks(
            rawTrades.map((trade) => ({
              time: trade.transaction_unix_ms / 1000,
              value: trade.price,
            })),
          );
          setCoinbaseHistorySecondCandles(
            buildSecondCandlesFromTrades(
              rawTrades,
              bootstrapPrice,
              Date.now(),
            ),
          );
          setSnapshot((prev) => ({
            connected: prev.connected,
            fundingRateBps: prev.fundingRateBps,
            openInterest: prev.openInterest,
            oraclePrice: bootstrapPrice * 1.0004,
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
              oraclePrice: latestMinuteClose * 1.0004,
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
        oraclePrice: bootstrapPrice * 1.0004,
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
          setSecondCandles(history.slice(-ONE_SECOND_WINDOW_SECS));
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
          oraclePrice: nextPrice * 1.0004,
          price: nextPrice,
        }));
        setSecondCandles((prev) => updateSecondCandlesWithPrice(prev, nextPrice, Date.now()));
        setHasInitialHistory(true);
      } catch {
        // Keep the existing fallback state if the ticker misses a beat.
      } finally {
        if (!cancelled) {
          tickerTimer = setTimeout(pollFallbackTicker, PRICE_POLL_MS);
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
      setLineWindowSecs(defaultLineWindowSecs);
      setLineEndTime(null);
      setManualLineVerticalPad(0);
      setSecondCandles([]);
      setMinuteCandles([]);
      setCoinbaseMinuteCandles([]);
      setCoinbaseHistorySecondCandles([]);
      setCoinbaseHistoryTicks([]);
      setHasInitialHistory(false);
      setSnapshot({
        connected: false,
        fundingRateBps: null,
        openInterest: null,
        oraclePrice: currentMarket.seedPrice * 1.0004,
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
      setLineWindowSecs(defaultLineWindowSecs);
      setLineEndTime(null);
      setManualLineVerticalPad(0);
      setSecondCandles([]);
      setMinuteCandles([]);
      setHasInitialHistory(false);
      setSnapshot({
        connected: false,
        fundingRateBps: null,
        openInterest: null,
        oraclePrice: currentMarket.seedPrice * 1.0004,
        price: currentMarket.seedPrice,
      });

      try {
        const now = Date.now();
        const [pricesResult, candlesResult, tradesResult] = await Promise.allSettled([
          fetchDecibelMainnetPrices(INITIAL_REQUEST_TIMEOUT_MS),
          fetchDecibelMainnetCandles(
            currentMarket.marketAddr,
            "1m",
            now - Math.max(MINUTE_HISTORY_MS, DECIBEL_VOLUME_WINDOW_MS),
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
          oraclePrice: priceEntry?.oracle_px ?? nextPrice * 1.0004,
          price: nextPrice,
        });
        if (priceEntry) {
          decibelLiveAtRef.current = Date.now();
          setUseBtcFallback(false);
        }

        if (candlesResult.status === "fulfilled" && candlesResult.value.length > 0) {
          setMinuteCandles(toCandlePoints(candlesResult.value));
        }

        if (tradesResult.status === "fulfilled" && tradesResult.value.length > 0) {
          setSecondCandles(buildSecondCandlesFromTrades(tradesResult.value, nextPrice, now));
        }

        setHasInitialHistory(
          (candlesResult.status === "fulfilled" && candlesResult.value.length > 0)
            || (tradesResult.status === "fulfilled" && tradesResult.value.length > 0)
        );
      } catch {
        if (cancelled) return;
        setSecondCandles([]);
        setHasInitialHistory(false);
        setSnapshot({
          connected: false,
          fundingRateBps: null,
          openInterest: null,
          oraclePrice: currentMarket.seedPrice * 1.0004,
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
  }, [defaultLineWindowSecs, marketKey, useCoinbaseLineFeed]);

  useEffect(() => {
    if (!marketAddress || useCoinbaseLineFeed) {
      return () => {};
    }

    if (btcFallbackEnabled && useBtcFallback) {
      return () => {};
    }

    let cancelled = false;
    let priceTimer: ReturnType<typeof setTimeout> | null = null;
    let tradeTimer: ReturnType<typeof setTimeout> | null = null;

    const pollPrice = async () => {
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

        setSecondCandles((prev) =>
          updateSecondCandlesWithPrice(
            prev,
            price.mark_px ?? price.mid_px ?? price.oracle_px,
            Date.now(),
          )
        );
        setHasInitialHistory(true);
      } catch {
        if (!cancelled) {
          if (!useBtcFallback) {
            setSnapshot((prev) => ({ ...prev, connected: false }));
          }
        }
      } finally {
        if (!cancelled) priceTimer = setTimeout(pollPrice, PRICE_POLL_MS);
      }
    };

    const refreshTrades = async () => {
      try {
        const trades = await fetchDecibelMainnetTrades(marketAddress, SECOND_TRADE_LIMIT);
        if (cancelled) return;

        setSecondCandles(buildSecondCandlesFromTrades(trades, snapshotRef.current.price, Date.now()));
        if (trades.length > 0) {
          setHasInitialHistory(true);
        }
      } catch {
        // Keep existing candles if the trade refresh misses a beat.
      } finally {
        if (!cancelled) tradeTimer = setTimeout(refreshTrades, TRADE_POLL_MS);
      }
    };

    void pollPrice();
    void refreshTrades();

    return () => {
      cancelled = true;
      if (priceTimer) clearTimeout(priceTimer);
      if (tradeTimer) clearTimeout(tradeTimer);
    };
  }, [btcFallbackEnabled, marketAddress, useBtcFallback, useCoinbaseLineFeed]);

  useEffect(() => {
    if (typeof window === "undefined" || !marketAddress || useCoinbaseLineFeed || (btcFallbackEnabled && useBtcFallback)) return () => {};

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
              oraclePrice: message.price.oracle_px ?? livePrice * 1.0004,
              price: livePrice,
            });
            decibelLiveAtRef.current = Date.now();
            setUseBtcFallback(false);
            setSecondCandles((prev) => updateSecondCandlesWithPrice(prev, livePrice, Date.now()));
            setHasInitialHistory(true);
          }

          if (message.topic === `trades:${marketAddress}` && Array.isArray(message.trades) && message.trades.length > 0) {
            decibelLiveAtRef.current = Date.now();
            setUseBtcFallback(false);
            setSecondCandles((prev) =>
              mergeTradesIntoSecondCandles(prev, message.trades ?? [], snapshotRef.current.price, Date.now())
            );
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
  }, [btcFallbackEnabled, marketAddress, useBtcFallback, useCoinbaseLineFeed]);

  // Derive a live candle from the latest second candle for Liveline
  const liveCandle = useMemo(() => {
    if (activeSecondCandles.length === 0) return undefined;
    return activeSecondCandles[activeSecondCandles.length - 1];
  }, [activeSecondCandles]);

  return (
    <>
      {/* Loading overlay */}
      {loading && !hasInitialHistory && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ paddingRight: CHART_PADDING.right, paddingLeft: CHART_PADDING.left }}>
          <TetherLoader size={52} label="Loading" />
        </div>
      )}
      {/* Single Liveline instance — handles both line and candle modes */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        onPointerDown={handleLinePointerDown}
        onPointerMove={handleLinePointerMove}
        onPointerUp={handleLinePointerUp}
        onPointerCancel={handleLinePointerUp}
        onWheel={handleLineWheel}
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <Liveline
          mode="candle"
          data={lineData}
          value={displayedCandleValue}
          candles={activeSecondCandles}
          candleWidth={1}
          liveCandle={liveCandle}
          lineMode={mode === "line"}
          lineData={lineData}
          lineValue={displayedLineValue}
          theme="dark"
          color={market.color}
          window={Math.max(MIN_LINE_WINDOW_SECS, lineWindowSecs)}
          grid
          scrub
          badge
          momentum={false}
          badgeTail
          badgeVariant="default"
          formatValue={(value: number) => formatPerpPrice(value, market.priceDecimals)}
          loading={loading && lineData.length === 0 && activeSecondCandles.length === 0}
          emptyText=""
          padding={linePadding}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 z-10 w-[84px] cursor-ns-resize"
          onWheel={handleLineAxisWheel}
          onDoubleClick={() => setManualLineVerticalPad(0)}
        />
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
));
