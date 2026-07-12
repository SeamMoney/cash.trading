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

const INTERPOLATION_PHASE_STEP = 2.399963229728653;

function bridgeAmplitude(
  previous: ChartCandle,
  next: ChartCandle,
  totalSteps: number,
) {
  const referencePrice = Math.max(
    Math.abs(previous.close),
    Math.abs(next.open),
    Number.EPSILON,
  );
  const localRange = Math.max(
    Math.abs(previous.high - previous.low),
    Math.abs(next.high - next.low),
  );
  const gapMove = Math.abs(next.open - previous.close);
  const movePerStep = gapMove / Math.max(totalSteps, 1);
  const desired = Math.max(
    referencePrice * 0.00000125,
    localRange * 0.08,
    movePerStep * 2.1,
  );
  const cap = Math.max(referencePrice * 0.00002, gapMove * 0.28);

  return Math.min(desired, cap);
}

function bridgeNoise(time: number) {
  const phase = (time % 3_600) * INTERPOLATION_PHASE_STEP;
  return (
    Math.sin(phase) * 0.68
    + Math.sin(phase * 0.47 + 1.61803398875) * 0.32
  );
}

function unitNoise(time: number, salt: number) {
  const value = Math.sin((time + salt) * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}

function bridgedPrice(
  previous: ChartCandle,
  next: ChartCandle,
  step: number,
  totalSteps: number,
  amplitude: number,
) {
  if (totalSteps <= 0) return next.open;
  const progress = step / totalSteps;
  const base = lerp(previous.close, next.open, progress);
  const edgeBlend = Math.min(1, step, totalSteps - step);
  if (edgeBlend <= 0) return base;

  return base + bridgeNoise(previous.time + step) * amplitude * edgeBlend;
}

function interpolatedWicks(
  time: number,
  open: number,
  close: number,
  amplitude: number,
) {
  const referencePrice = Math.max(Math.abs(open), Math.abs(close), Number.EPSILON);
  const wickScale = Math.max(
    referencePrice * 0.00000035,
    Math.abs(close - open) * 0.22,
    amplitude * 0.12,
  );
  const upper = wickScale * (0.35 + unitNoise(time, 17) * 0.85);
  const lower = wickScale * (0.35 + unitNoise(time, 53) * 0.85);

  return {
    high: Math.max(open, close) + upper,
    low: Math.min(open, close) - lower,
  };
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
 * Their values follow a deterministic bridge between the surrounding real
 * trade bars. The bridge lands exactly on the next real open while adding
 * restrained reversals and wicks, avoiding both flat doji rails and monotonic
 * box staircases. Real trade OHLC is preserved and generated candles remain
 * continuous with their neighbors.
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
    const amplitude = bridgeAmplitude(previous, nextAnchor, missingSeconds);

    for (let step = 1; step <= missingSeconds; step += 1) {
      const open = bridgedPrice(previous, nextAnchor, step - 1, missingSeconds, amplitude);
      const close = bridgedPrice(previous, nextAnchor, step, missingSeconds, amplitude);
      const { high, low } = interpolatedWicks(
        previous.time + step,
        open,
        close,
        amplitude,
      );
      interpolated.push({
        time: previous.time + step,
        open,
        high,
        low,
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
