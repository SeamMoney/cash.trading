/**
 * Closed candles for the Personal Strategy Runner. Server-only (needs the
 * Decibel API key); do not import from client components.
 *
 * The same upstream as `/api/decibel/candlesticks` (Bearer-authenticated
 * Decibel indexer), lifted out of the route so the cron can read bars without
 * going through HTTP. Two rules the route does not need but a trader does:
 *
 *  - The in-progress candle is dropped. A strategy evaluated on a bar that is
 *    still forming can flip between "buy" and "neutral" several times inside
 *    one minute; the vault evaluator only ever sees closed prices, and so must
 *    this runner. A bar is closed once its close time (`T`, or `t + interval`)
 *    is at or before now.
 *  - `n` is capped at 990. Upstream rejects spans over 1000 candles.
 *
 * `t` is the bar OPEN time in unix milliseconds — the same field the upstream
 * uses — and is what `BotInstance.lastBarTs` stores.
 */
import { getAptosFullnodeApiKey, type DecibelNetwork } from "@/lib/decibel";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import { PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import type { CandleResolution } from "@/lib/launchpad/types";

export type ClosedBarInterval = "1m" | "5m" | "15m";

export interface ClosedBar {
  /** Bar open time, unix ms. */
  t: number;
  /** Close price, human units (e.g. 65000.5 for BTC/USD). */
  c: number;
}

export const CLOSED_BAR_INTERVAL_MS: Record<ClosedBarInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
};

/** Upstream rejects spans over 1000 candles ("Maximum number of candles is 1000"). */
export const MAX_CLOSED_BARS = 990;

const DECIBEL_BASES: Record<DecibelNetwork, string> = {
  mainnet: "https://api.mainnet.aptoslabs.com/decibel/api/v1",
  testnet: "https://api.testnet.aptoslabs.com/decibel/api/v1",
};

const PYTH_RESOLUTION: Record<ClosedBarInterval, CandleResolution> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
};

/** Upstream candle: {t, T, o, h, l, c, v, i} (TradingView-style, unix ms). */
interface UpstreamCandle {
  t: number;
  T?: number;
  c: number;
}

export function isClosedBarInterval(value: unknown): value is ClosedBarInterval {
  return value === "1m" || value === "5m" || value === "15m";
}

/** Open time of the most recent bar that has already closed, unix ms. */
export function latestClosedBarOpenMs(interval: ClosedBarInterval, nowMs = Date.now()): number {
  const ms = CLOSED_BAR_INTERVAL_MS[interval];
  return Math.floor(nowMs / ms) * ms - ms;
}

/**
 * Normalize raw candles into closed bars: finite positive closes only, sorted
 * by open time, deduplicated, and with any bar whose close time is still in
 * the future removed. Pure; exported for tests.
 */
export function toClosedBars(
  candles: ReadonlyArray<{ t: number; T?: number; c: number }>,
  intervalMs: number,
  nowMs: number,
): ClosedBar[] {
  const byOpen = new Map<number, number>();
  for (const k of candles) {
    const t = Number(k.t);
    const c = Number(k.c);
    if (!Number.isFinite(t) || !Number.isFinite(c) || c <= 0) continue;
    const closeAt = Number.isFinite(Number(k.T)) && Number(k.T) > t ? Number(k.T) : t + intervalMs;
    if (closeAt > nowMs) continue; // still forming
    byOpen.set(t, c); // later rows win for a duplicate open time
  }
  return [...byOpen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => ({ t, c }));
}

export interface FetchClosedBarsOptions {
  /**
   * Market display name ("BTC/USD"). When it is one of the four Pyth
   * benchmark assets, Pyth is used as a fallback if the Decibel indexer is
   * unavailable. Other markets have no fallback and the error propagates.
   */
  marketName?: string;
  /** Injectable clock, unix ms. */
  nowMs?: number;
  /** Per-request timeout for the Decibel fetch. */
  timeoutMs?: number;
}

/**
 * The last `n` CLOSED bars for a market, oldest first. Throws when neither
 * source can serve them — a runner must never evaluate on an empty or partial
 * series and call the result "neutral".
 */
export async function fetchClosedBars(
  marketAddr: string,
  interval: ClosedBarInterval,
  n: number,
  network: DecibelNetwork,
  opts: FetchClosedBarsOptions = {},
): Promise<ClosedBar[]> {
  if (!isClosedBarInterval(interval)) {
    throw new Error(`unsupported bar interval: ${String(interval)}`);
  }
  const bars = Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), MAX_CLOSED_BARS) : MAX_CLOSED_BARS;
  const intervalMs = CLOSED_BAR_INTERVAL_MS[interval];
  const nowMs = opts.nowMs ?? Date.now();
  // Two spare bars: one for the in-progress candle we drop, one for clock skew
  // between us and the indexer. Still under the upstream 1000-candle ceiling.
  const span = Math.min(bars + 2, 1000);
  const startTime = nowMs - span * intervalMs;

  let decibelError: unknown = null;
  try {
    const raw = await fetchDecibelCandles(marketAddr, interval, startTime, nowMs, network, opts.timeoutMs ?? 8000);
    const closed = toClosedBars(raw, intervalMs, nowMs);
    if (closed.length > 0) return closed.slice(-bars);
    decibelError = new Error("decibel candlesticks returned no closed bars");
  } catch (err) {
    decibelError = err;
  }

  const pythAsset = opts.marketName && Object.hasOwn(PYTH_FEED_IDS, opts.marketName) ? opts.marketName : null;
  if (!pythAsset) {
    throw decibelError instanceof Error ? decibelError : new Error("decibel candlesticks unavailable");
  }

  const fromTs = Math.floor(startTime / 1000);
  const toTs = Math.floor(nowMs / 1000);
  const pyth = await fetchPythCandles(pythAsset, PYTH_RESOLUTION[interval], fromTs, toTs);
  const closed = toClosedBars(
    pyth.map((k) => ({ t: k.timestamp * 1000, c: k.close })),
    intervalMs,
    nowMs,
  );
  if (closed.length === 0) {
    const reason = decibelError instanceof Error ? decibelError.message : "decibel unavailable";
    throw new Error(`no closed bars from decibel (${reason}) or pyth for ${pythAsset}`);
  }
  console.warn(
    `📉 [candles] decibel unavailable for ${opts.marketName} (${
      decibelError instanceof Error ? decibelError.message : "unknown"
    }); using pyth fallback`,
  );
  return closed.slice(-bars);
}

async function fetchDecibelCandles(
  marketAddr: string,
  interval: ClosedBarInterval,
  startTime: number,
  endTime: number,
  network: DecibelNetwork,
  timeoutMs: number,
): Promise<UpstreamCandle[]> {
  const apiKey = getAptosFullnodeApiKey(network);
  if (!apiKey) throw new Error("missing_api_key");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = new URLSearchParams({
      market: marketAddr,
      interval,
      startTime: String(Math.floor(startTime)),
      endTime: String(Math.floor(endTime)),
    });
    const res = await fetch(`${DECIBEL_BASES[network]}/candlesticks?${upstream}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`candlesticks returned ${res.status}`);
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as UpstreamCandle[]) : [];
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("candlesticks timeout");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
