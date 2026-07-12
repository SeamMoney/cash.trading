/**
 * Pure liveline-data helpers extracted from BtcPerpsChart.
 *
 * Invariant: a live tick MUST NOT mutate a committed historical point.
 *
 * Background: the chart's "live line" is a `LivelinePoint[]` series rendered
 * by the Liveline component. The trailing point follows the most recent
 * market tick or websocket snapshot. When the page is hidden and later
 * restored, an in-flight live tick can arrive with a timestamp that is at or
 * before the last *committed* historical point (e.g. a candle close just
 * captured before tab-hide). The previous `syncLineTail` implementation
 * silently rewrote that historical point's value with the live tick, which
 * surfaces as discrete backwards stair-step reversals on the chart.
 *
 * The helpers below replace that behaviour with strict isolation:
 *   - `dedupeAndSort` reconstructs canonical history from arbitrary input
 *     arrays (deterministic, idempotent, monotonic by time).
 *   - `withLiveTail` only ever appends a live tick when it is strictly
 *     after the last committed time. Equal- or older-time live ticks are
 *     ignored — they NEVER overwrite an existing point's value.
 *
 * If same-timestamp preview updates are needed in the future they should be
 * represented as a separate preview point/state, not by rewriting `last`.
 */

import type { CandlePoint, LivelinePoint } from "liveline";

/** Convert real OHLC buckets to opening/closing line points without invented intrabar pivots. */
export function candlesToCloseLinePoints(
  candles: CandlePoint[],
  nominalIntervalSeconds: number,
) {
  if (candles.length === 0) return [];

  const points: LivelinePoint[] = [{
    time: candles[0].time,
    value: candles[0].open,
  }];

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const nextTime = candles[index + 1]?.time;
    const observedSpan = nextTime == null
      ? nominalIntervalSeconds
      : nextTime - candle.time;
    const closeSpan = Math.min(
      Math.max(1, observedSpan),
      Math.max(60, nominalIntervalSeconds),
    );
    points.push({
      time: candle.time + closeSpan * 0.96,
      value: candle.close,
    });
  }

  return points;
}

/** Clip to observed points only; never synthesize flat boundary or gap-fill points. */
export function clipLineWindow(
  points: LivelinePoint[],
  startTime: number,
  endTime: number,
) {
  return dedupeAndSort(points).filter(
    (point) => point.time >= startTime && point.time <= endTime,
  );
}

/**
 * Deduplicate and sort line points by time.
 *
 * - Time keys are quantized to milliseconds (`Math.round(time * 1000)`) so
 *   floating-point seconds collapse cleanly.
 * - On collision, the LAST entry wins (later array order overrides earlier).
 *   Callers should pass canonical sources first and live/refresh sources
 *   last when they want fresher values to dominate.
 * - The returned array is sorted ascending by `time`.
 *
 * Pure, idempotent: `dedupeAndSort(dedupeAndSort(xs)) === dedupeAndSort(xs)`
 * by content.
 */
export function dedupeAndSort(points: LivelinePoint[]): LivelinePoint[] {
  if (points.length === 0) return [];
  const byTime = new Map<number, LivelinePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    const key = Math.round(point.time * 1000);
    byTime.set(key, point);
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/**
 * Append a live tick to a committed history series, with strict isolation.
 *
 * Invariant: this function NEVER mutates an existing point's value. It only
 * appends a new point at `liveTime` when `liveTime` is strictly greater than
 * the last committed point's time (within `epsilonSecs` tolerance).
 *
 * Cases:
 *   - liveValue not finite or ≤ 0          → return `history` unchanged.
 *   - history empty                        → return `[{liveTime, liveValue}]`.
 *   - liveTime > last.time + epsilonSecs   → append new point.
 *   - liveTime ≤ last.time + epsilonSecs   → return `history` unchanged.
 *
 * The same-or-older-time case is the critical one: do NOT rewrite the last
 * committed point. Doing so caused the resume/restore stair-step bug.
 */
export function withLiveTail(
  history: LivelinePoint[],
  liveValue: number,
  liveTime: number,
  options: { epsilonSecs?: number } = {},
): LivelinePoint[] {
  if (!Number.isFinite(liveValue) || liveValue <= 0) return history;
  if (!Number.isFinite(liveTime) || liveTime <= 0) return history;
  if (history.length === 0) {
    return [{ time: liveTime, value: liveValue }];
  }

  const epsilon = options.epsilonSecs ?? 0;
  const last = history[history.length - 1];

  if (liveTime > last.time + epsilon) {
    return [...history, { time: liveTime, value: liveValue }];
  }

  // Same-or-older live time: leave history untouched. Never rewrite `last`.
  return history;
}
