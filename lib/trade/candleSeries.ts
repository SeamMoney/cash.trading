/** Pure OHLC helpers shared by the realtime candle renderer and its tests. */

export type ChartCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
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

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
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

function isTradeAnchor(candle: ChartCandle) {
  return (
    (candle.volume ?? 0) > 0
    || candle.open !== candle.close
    || candle.high !== candle.low
  );
}

/**
 * Rebuild sparse one-second data as a continuous OHLC series.
 *
 * Empty carry-forward seconds are treated as placeholders, not price anchors.
 * Their values are linearly bridged between the surrounding real trade bars,
 * producing one candle per second without the long dotted plateaus and abrupt
 * vertical jumps caused by repeating the previous close until the next trade.
 */
export function interpolateOneSecondCandles(candles: ChartCandle[]) {
  const seconds = aggregateChartCandles(candles, 1);
  if (seconds.length < 2) return seconds;

  const anchors = seconds.filter((candle, index) => (
    index === 0
    || index === seconds.length - 1
    || isTradeAnchor(candle)
  ));
  const interpolated: ChartCandle[] = [{ ...anchors[0] }];

  for (let index = 1; index < anchors.length; index += 1) {
    const previous = interpolated[interpolated.length - 1];
    const nextAnchor = anchors[index];
    const spanSeconds = Math.max(1, Math.round(nextAnchor.time - previous.time));
    const missingSeconds = Math.max(0, spanSeconds - 1);
    const targetOpen = nextAnchor.open;

    for (let step = 1; step <= missingSeconds; step += 1) {
      const open = lerp(previous.close, targetOpen, (step - 1) / missingSeconds);
      const close = lerp(previous.close, targetOpen, step / missingSeconds);
      interpolated.push({
        time: previous.time + step,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume: 0,
      });
    }

    const continuousOpen = missingSeconds > 0
      ? targetOpen
      : previous.close;
    interpolated.push({
      ...nextAnchor,
      open: continuousOpen,
      high: Math.max(nextAnchor.high, continuousOpen, nextAnchor.close),
      low: Math.min(nextAnchor.low, continuousOpen, nextAnchor.close),
    });
  }

  return interpolated;
}
