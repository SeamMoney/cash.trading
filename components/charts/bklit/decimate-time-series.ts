/**
 * Largest-Triangle-Three-Buckets downsampling for time-series SVG paths.
 * Keeps first/last points and picks visually significant points per bucket.
 */
export function decimateTimeSeries<T extends Record<string, unknown>>(
  data: T[],
  maxPoints: number,
  valueKeys: string[] = []
): T[] {
  const len = data.length;
  if (maxPoints >= len || maxPoints < 3) {
    return data;
  }

  const getY = (point: T, index: number): number => {
    if (valueKeys.length === 0) {
      for (const val of Object.values(point)) {
        if (typeof val === "number") {
          return val;
        }
      }
      return index;
    }

    let sum = 0;
    let count = 0;
    for (const key of valueKeys) {
      const val = point[key];
      if (typeof val === "number") {
        sum += val;
        count++;
      }
    }
    return count > 0 ? sum / count : index;
  };

  const sampled: T[] = [data[0] as T];
  const bucketSize = (len - 2) / (maxPoints - 2);
  let previousIndex = 0;

  for (let i = 0; i < maxPoints - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);

    const nextRangeStart = Math.floor((i + 2) * bucketSize) + 1;
    const nextRangeEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len);
    const nextCount = Math.max(0, nextRangeEnd - nextRangeStart);

    let avgX = len - 1;
    let avgY = getY(data[len - 1] as T, len - 1);
    if (nextCount > 0) {
      avgX = 0;
      avgY = 0;
      for (let j = nextRangeStart; j < nextRangeEnd; j++) {
        avgX += j;
        avgY += getY(data[j] as T, j);
      }
      avgX /= nextCount;
      avgY /= nextCount;
    }

    const pointA = data[previousIndex] as T;
    const ax = previousIndex;
    const ay = getY(pointA, previousIndex);

    let maxArea = -1;
    let maxIndex = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area =
        Math.abs(
          (ax - avgX) * (getY(data[j] as T, j) - ay) - (ax - j) * (avgY - ay)
        ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push(data[maxIndex] as T);
    previousIndex = maxIndex;
  }

  sampled.push(data[len - 1] as T);
  return sampled;
}

/** ~1.5 points per pixel — enough for crisp curves without over-drawing. */
export function maxRenderPointsForWidth(innerWidth: number): number {
  return Math.max(64, Math.ceil(innerWidth * 1.5));
}

/** Bucket OHLC rows into fewer candles while preserving high/low extremes. */
function ohlcTimestamp(point: Record<string, unknown>): number | null {
  if (point.date instanceof Date) {
    const value = point.date.getTime();
    return Number.isFinite(value) ? value : null;
  }
  if (typeof point.time === "number" && Number.isFinite(point.time)) {
    // CASH candle adapters use unix seconds for `time` and Date for `date`.
    return point.time < 10_000_000_000 ? point.time * 1_000 : point.time;
  }
  return null;
}

function splitOhlcAtGaps<T extends Record<string, unknown>>(
  data: T[],
  maxGapMs: number,
): T[][] {
  if (!Number.isFinite(maxGapMs) || maxGapMs <= 0 || data.length < 2) {
    return [data];
  }
  const segments: T[][] = [[data[0]]];
  for (let index = 1; index < data.length; index += 1) {
    const previousTime = ohlcTimestamp(data[index - 1]);
    const time = ohlcTimestamp(data[index]);
    if (
      previousTime !== null
      && time !== null
      && time - previousTime > maxGapMs
    ) {
      segments.push([data[index]]);
    } else {
      segments[segments.length - 1].push(data[index]);
    }
  }
  return segments;
}

function allocateSegmentBudgets<T>(segments: T[][], maxPoints: number) {
  const minimums = segments.map((segment) =>
    Math.min(segment.length, segment.length > 1 ? 2 : 1),
  );
  const minimumTotal = minimums.reduce((sum, value) => sum + value, 0);
  // If there are more honest segment endpoints than the render budget, keep
  // them all. Rendering extra points is preferable to bridging an outage.
  if (minimumTotal >= maxPoints) return minimums;

  const remainingCapacity = segments.map(
    (segment, index) => segment.length - minimums[index],
  );
  const totalCapacity = remainingCapacity.reduce((sum, value) => sum + value, 0);
  if (totalCapacity <= 0) return segments.map((segment) => segment.length);

  const remainingBudget = maxPoints - minimumTotal;
  const budgets = minimums.slice();
  const remainders = remainingCapacity.map((capacity, index) => {
    const exact = remainingBudget * capacity / totalCapacity;
    const whole = Math.min(capacity, Math.floor(exact));
    budgets[index] += whole;
    return { index, remainder: exact - whole };
  });
  let unassigned = maxPoints - budgets.reduce((sum, value) => sum + value, 0);
  remainders.sort((a, b) => b.remainder - a.remainder);
  for (const item of remainders) {
    if (unassigned <= 0) break;
    if (budgets[item.index] >= segments[item.index].length) continue;
    budgets[item.index] += 1;
    unassigned -= 1;
  }
  return budgets;
}

export function decimateOhlcData<T extends Record<string, unknown>>(
  data: T[],
  maxPoints: number,
  maxGapMs?: number,
): T[] {
  const len = data.length;
  if (maxPoints >= len || maxPoints < 2) {
    return data;
  }

  const segments = splitOhlcAtGaps(
    data,
    maxGapMs ?? Number.POSITIVE_INFINITY,
  );
  if (segments.length > 1) {
    const budgets = allocateSegmentBudgets(segments, maxPoints);
    return segments.flatMap((segment, index) => {
      const budget = budgets[index];
      return budget >= segment.length
        ? segment
        : decimateOhlcData(segment, budget);
    });
  }

  const bucketSize = len / maxPoints;
  const sampled: T[] = [];

  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(len, Math.floor((i + 1) * bucketSize));
    if (start >= end) {
      continue;
    }

    const bucket = data.slice(start, end);
    const first = bucket[0] as T;
    const last = bucket.at(-1) as T;

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let volume = 0;
    let hasVolume = false;
    for (const row of bucket) {
      const rowHigh = row.high;
      const rowLow = row.low;
      if (typeof rowHigh === "number" && rowHigh > high) {
        high = rowHigh;
      }
      if (typeof rowLow === "number" && rowLow < low) {
        low = rowLow;
      }
      if (typeof row.volume === "number" && Number.isFinite(row.volume)) {
        volume += row.volume;
        hasVolume = true;
      }
    }

    sampled.push({
      ...last,
      open: first.open,
      high: Number.isFinite(high) ? high : last.high,
      low: Number.isFinite(low) ? low : last.low,
      close: last.close,
      ...(hasVolume ? { volume } : {}),
    } as T);
  }

  return sampled;
}

