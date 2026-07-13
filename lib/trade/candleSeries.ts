/** Pure OHLC helpers shared by the realtime candle renderer and its tests. */

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type ChartPriceTick = {
  time: number;
  value: number;
  volume?: number;
  sequence?: number;
  identity?: string;
};

function validCandle(candle: ChartCandle) {
  return (
    Number.isFinite(candle.time)
    && Number.isFinite(candle.open)
    && Number.isFinite(candle.high)
    && Number.isFinite(candle.low)
    && Number.isFinite(candle.close)
  );
}

function validPriceTick(tick: ChartPriceTick) {
  return (
    Number.isFinite(tick.time)
    && Number.isFinite(tick.value)
    && tick.time > 0
    && tick.value > 0
  );
}

/** Merge observed exchange ticks by millisecond. No missing timestamps are invented. */
export function mergeChartPriceTicks(
  existing: ChartPriceTick[],
  incoming: ChartPriceTick[],
  maxPoints = 5_000,
) {
  const byTime = new Map<string, ChartPriceTick>();
  for (const tick of [...existing, ...incoming]) {
    if (!validPriceTick(tick)) continue;
    const timeKey = Math.round(tick.time * 1_000);
    const sequence = Number.isFinite(tick.sequence ?? NaN)
      ? Math.max(0, Math.floor(tick.sequence ?? 0))
      : 0;
    const identity = tick.identity
      ? `trade:${tick.identity}`
      : `${timeKey}:${sequence}`;
    const prior = byTime.get(identity);
    byTime.set(identity, {
      ...tick,
      time: timeKey / 1_000,
      volume: Math.max(prior?.volume ?? 0, tick.volume ?? 0),
    });
  }
  const ordered = Array.from(byTime.values()).sort((a, b) => (
    a.time - b.time || (a.sequence ?? 0) - (b.sequence ?? 0)
  ));
  const safeLimit = Number.isFinite(maxPoints)
    ? Math.max(1, Math.floor(maxPoints))
    : ordered.length;
  return ordered.slice(-safeLimit);
}

/** Build honest OHLC buckets from observed ticks; empty buckets stay empty. */
export function chartPriceTicksToCandles(
  ticks: ChartPriceTick[],
  intervalSeconds: number,
) {
  const safeInterval = Math.max(1, Math.floor(intervalSeconds));
  const ordered = mergeChartPriceTicks(ticks, [], Number.POSITIVE_INFINITY);
  const buckets = new Map<number, ChartCandle>();

  for (const tick of ordered) {
    const time = Math.floor(tick.time / safeInterval) * safeInterval;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, {
        time,
        open: tick.value,
        high: tick.value,
        low: tick.value,
        close: tick.value,
        volume: tick.volume ?? 0,
      });
      continue;
    }
    buckets.set(time, {
      ...existing,
      high: Math.max(existing.high, tick.value),
      low: Math.min(existing.low, tick.value),
      close: tick.value,
      volume: (existing.volume ?? 0) + (tick.volume ?? 0),
    });
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export function aggregateChartCandles(
  candles: ChartCandle[],
  intervalSeconds: number,
) {
  const safeInterval = Math.max(1, Math.floor(intervalSeconds));
  const buckets = new Map<number, ChartCandle>();
  const ordered = candles.filter(validCandle).sort((a, b) => a.time - b.time);

  for (const candle of ordered) {
    const time = Math.floor(candle.time / safeInterval) * safeInterval;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, { ...candle, time, volume: candle.volume ?? 0 });
      continue;
    }
    buckets.set(time, {
      ...existing,
      high: Math.max(existing.high, candle.high),
      low: Math.min(existing.low, candle.low),
      close: candle.close,
      volume: (existing.volume ?? 0) + (candle.volume ?? 0),
    });
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

/** Merge a canonical REST series with fresher trade candles without double-counting volume. */
export function mergeCanonicalCandles(
  canonical: ChartCandle[],
  liveCandles: ChartCandle[],
  intervalSeconds: number,
) {
  const merged = new Map<number, ChartCandle>();
  for (const candle of aggregateChartCandles(canonical, intervalSeconds)) {
    merged.set(candle.time, candle);
  }
  for (const live of aggregateChartCandles(liveCandles, intervalSeconds)) {
    const existing = merged.get(live.time);
    merged.set(live.time, existing ? {
      ...existing,
      high: Math.max(existing.high, live.high),
      low: Math.min(existing.low, live.low),
      close: live.close,
      volume: Math.max(existing.volume ?? 0, live.volume ?? 0),
    } : live);
  }
  return Array.from(merged.values()).sort((a, b) => a.time - b.time);
}

/** Add the current quote as an honest new bar; never carry an old close across an outage. */
export function appendLivePriceCandle(
  candles: ChartCandle[],
  price: number,
  liveTime: number,
  intervalSeconds: number,
) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(liveTime)) return candles;
  const safeInterval = Math.max(1, Math.floor(intervalSeconds));
  const time = Math.floor(liveTime / safeInterval) * safeInterval;
  const next = candles.slice();
  const last = next.at(-1);
  if (last?.time === time) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    };
  } else if (!last || last.time < time) {
    next.push({ time, open: price, high: price, low: price, close: price, volume: 0 });
  }
  return next;
}
