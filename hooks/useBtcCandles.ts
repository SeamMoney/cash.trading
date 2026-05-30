"use client";

import { useEffect, useRef, useState } from "react";
import type { MarketHistoryCandle } from "@/lib/btc-history";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Tick {
  time: number;
  value: number;
}

type UsePriceCandlesOptions = {
  seedBackfillTicks?: boolean;
  preserveStateOnResume?: boolean;
};

const MAX_CANDLES = 1000;
const MAX_TICKS = 2000;
const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const DEFAULT_CANDLE_SECS = 2;
const CACHE_MAX_SEED_AGE_MS = 2_000;
const HISTORY_LIMIT = 8;
const TICKER_POLL_MS = 1000;
const LIVE_STALE_MS = 4000;

const PRODUCT_MAP: Record<string, string> = {
  "BTC/USD": "BTC-USD",
  "ETH/USD": "ETH-USD",
  "SOL/USD": "SOL-USD",
  "APT/USD": "APT-USD",
  "BNB/USD": "BNB-USD",
  "XRP/USD": "XRP-USD",
  "DOGE/USD": "DOGE-USD",
  "SUI/USD": "SUI-USD",
  "ZEC/USD": "ZEC-USD",
  "HYPE/USD": "HYPE-USD",
};

export function supportsPriceCandleMarket(market: string) {
  return market in PRODUCT_MAP;
}

export function getPriceCandleProductId(market: string) {
  return PRODUCT_MAP[market] ?? null;
}

/** Nudge truly flat candles so they aren't invisible zero-height lines */
function ensureBody(c: Candle, candleSecs = DEFAULT_CANDLE_SECS): Candle {
  if (c.open === c.close) {
    const nudge = c.close * 0.00004; // tiny — just enough to not be a line
    const dir = Math.floor(c.time / candleSecs) % 2 === 0 ? 1 : -1;
    const close = c.open + nudge * dir;
    return {
      ...c,
      close,
      high: Math.max(c.high, c.open, close) + nudge * 0.5,
      low: Math.min(c.low, c.open, close) - nudge * 0.5,
    };
  }
  return c;
}

function readCachedPrice(market: string): { price: number; ts: number } | null {
  try {
    const raw = localStorage.getItem(`cash-price-${market}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { price?: unknown; ts?: unknown } | number;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
      return { price: parsed, ts: 0 };
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.price === "number" &&
      Number.isFinite(parsed.price) &&
      parsed.price > 0
    ) {
      return {
        price: parsed.price,
        ts: typeof parsed.ts === "number" ? parsed.ts : 0,
      };
    }
  } catch {
    try {
      const raw = localStorage.getItem(`cash-price-${market}`);
      const price = parseFloat(raw || "0");
      if (price > 0) return { price, ts: 0 };
    } catch {}
  }

  return null;
}

function getCachedPrice(market: string): number {
  return readCachedPrice(market)?.price ?? 0;
}

function getFreshSeedPrice(market: string): number {
  const cached = readCachedPrice(market);
  if (!cached) return 0;
  if (cached.ts > 0 && Date.now() - cached.ts > CACHE_MAX_SEED_AGE_MS) return 0;
  return cached.price;
}

function cachePrice(market: string, p: number) {
  try {
    localStorage.setItem(`cash-price-${market}`, JSON.stringify({ price: p, ts: Date.now() }));
  } catch {}
}

function makeSeed(p: number, candleSecs = DEFAULT_CANDLE_SECS): { candle: Candle; tick: Tick } {
  const now = Date.now() / 1000;
  const ct = Math.floor(now / candleSecs) * candleSecs;
  return {
    candle: ensureBody({ time: ct, open: p, high: p, low: p, close: p }, candleSecs),
    tick: { time: now, value: p },
  };
}

/** Generate synthetic backfill ticks so the line chart appears pre-filled */
function generateBackfillTicks(price: number, durationSecs = 60, count = 30): Tick[] {
  const now = Date.now() / 1000;
  const ticks: Tick[] = [];
  const step = durationSecs / count;
  // Tiny random walk backwards from the current price
  let p = price;
  const points: { time: number; value: number }[] = [];
  for (let i = count; i >= 0; i--) {
    points.unshift({ time: now - i * step, value: p });
    // Walk backwards with tiny drift (~0.002% per step)
    const drift = p * 0.00002 * (Math.sin(i * 1.7) + Math.cos(i * 0.3) * 0.5);
    p += drift;
  }
  // Reverse the walk so it converges to current price at the right edge
  for (const pt of points) {
    ticks.push({ time: pt.time, value: pt.value });
  }
  return ticks;
}

function mergeCandles(existing: Candle[], incoming: Candle[]) {
  const byTime = new Map<number, Candle>();

  for (const candle of existing) byTime.set(candle.time, candle);
  for (const candle of incoming) byTime.set(candle.time, candle);

  return Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_CANDLES);
}

function mergeTicks(existing: Tick[], incoming: Tick[]) {
  const byTime = new Map<number, Tick>();

  for (const tick of existing) byTime.set(Math.round(tick.time * 1000), tick);
  for (const tick of incoming) byTime.set(Math.round(tick.time * 1000), tick);

  return Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_TICKS);
}

function buildHistoryBootstrap(rawCandles: MarketHistoryCandle[], candleSecs = DEFAULT_CANDLE_SECS) {
  const valid = rawCandles
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .sort((a, b) => a.time - b.time);

  if (valid.length === 0) return null;

  const grouped = new Map<number, Candle>();

  for (const candle of valid) {
    const bucket = Math.floor(candle.time / candleSecs) * candleSecs;
    const existing = grouped.get(bucket);

    if (!existing) {
      grouped.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      continue;
    }

    grouped.set(bucket, {
      ...existing,
      high: Math.max(existing.high, candle.high),
      low: Math.min(existing.low, candle.low),
      close: candle.close,
    });
  }

  const aggregated = Array.from(grouped.values())
    .sort((a, b) => a.time - b.time)
    .map((candle) => ensureBody(candle, candleSecs));

  if (aggregated.length === 0) return null;

  const currentBucket = Math.floor((Date.now() / 1000) / candleSecs) * candleSecs;
  const historical = aggregated.filter((candle) => candle.time < currentBucket);
  const live = aggregated.find((candle) => candle.time === currentBucket) ?? null;
  const ticks = valid
    .map((candle) => ({ time: candle.time + 0.999, value: candle.close }))
    .slice(-MAX_TICKS);
  const latest = live ?? aggregated[aggregated.length - 1];

  return {
    candles: historical.slice(-MAX_CANDLES),
    liveCandle: live,
    ticks,
    price: latest?.close ?? 0,
  };
}

export function usePriceCandles(
  market: string = "BTC/USD",
  enabled = true,
  initialHistory: MarketHistoryCandle[] = [],
  historyLimit = HISTORY_LIMIT,
  candleSecs = DEFAULT_CANDLE_SECS,
  options: UsePriceCandlesOptions = {},
) {
  const { seedBackfillTicks = true, preserveStateOnResume = false } = options;
  const initialBootstrapKey = `${market}:${candleSecs}:${initialHistory.length}:${initialHistory[0]?.time ?? "none"}:${initialHistory[initialHistory.length - 1]?.time ?? "none"}`;
  const initialBootstrapKeyRef = useRef("");
  const initialBootstrapRef = useRef<ReturnType<typeof buildHistoryBootstrap>>(null);

  if (initialBootstrapKeyRef.current !== initialBootstrapKey) {
    initialBootstrapKeyRef.current = initialBootstrapKey;
    initialBootstrapRef.current = buildHistoryBootstrap(initialHistory, candleSecs);
  }

  const initialBootstrap = initialBootstrapRef.current;

  const [ticks, setTicks] = useState<Tick[]>(initialBootstrap?.ticks ?? []);
  const [candles, setCandles] = useState<Candle[]>(initialBootstrap?.candles ?? []);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(initialBootstrap?.liveCandle ?? null);
  const [price, setPrice] = useState(initialBootstrap?.price ?? 0);
  const [connected, setConnected] = useState(false);
  const liveCandleRef = useRef<Candle | null>(initialBootstrap?.liveCandle ?? null);
  const ticksRef = useRef<Tick[]>(initialBootstrap?.ticks ?? []);
  const candlesRef = useRef<Candle[]>(initialBootstrap?.candles ?? []);
  const priceRef = useRef(initialBootstrap?.price ?? 0);
  const lastMarketRef = useRef(market);

  ticksRef.current = ticks;
  candlesRef.current = candles;
  priceRef.current = price;

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    const historyController = new AbortController();
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let pollTimeout: ReturnType<typeof setTimeout>;
    let staleTimeout: ReturnType<typeof setTimeout>;
    let lastLiveAt = 0;

    if (!enabled) {
      setConnected(false);
      return () => {};
    }

    const markLive = () => {
      lastLiveAt = Date.now();
      setConnected(true);
      clearTimeout(staleTimeout);
      staleTimeout = setTimeout(() => {
        if (!active) return;
        if (Date.now() - lastLiveAt >= LIVE_STALE_MS) {
          setConnected(false);
        }
      }, LIVE_STALE_MS);
    };

    const ingestPrice = (nextPrice: number, tickTime = Date.now() / 1000) => {
      const candleTime = Math.floor(tickTime / candleSecs) * candleSecs;
      const live = liveCandleRef.current;

      if (live && live.time === candleTime) {
        const updated = ensureBody({
          ...live,
          high: Math.max(live.high, nextPrice),
          low: Math.min(live.low, nextPrice),
          close: nextPrice,
        }, candleSecs);
        liveCandleRef.current = updated;
        setLiveCandle(updated);
      } else if (live) {
        const range = live.high - live.low;
        const isOutlier = live.close > 0 && range / live.close > 0.005;
        const committed = isOutlier ? null : ensureBody({ ...live });
        const baseClose = committed ? committed.close : nextPrice;
        const baseTime = committed ? committed.time : live.time;
        const fills: Candle[] = [];

        for (let t = baseTime + candleSecs; t < candleTime && fills.length < 20; t += candleSecs) {
          fills.push(
            ensureBody({
              time: t,
              open: baseClose,
              high: baseClose,
              low: baseClose,
              close: baseClose,
            }, candleSecs)
          );
        }

        const toAdd = committed ? [committed, ...fills] : fills;
        if (toAdd.length > 0) {
          setCandles((prev) => mergeCandles(prev, toAdd));
        }

        const newCandle: Candle = {
          time: candleTime,
          open: nextPrice,
          high: nextPrice,
          low: nextPrice,
          close: nextPrice,
        };
        liveCandleRef.current = newCandle;
        setLiveCandle(ensureBody(newCandle, candleSecs));
      } else {
        const seed = makeSeed(nextPrice, candleSecs);
        liveCandleRef.current = seed.candle;
        setLiveCandle(seed.candle);
      }

      setTicks((prev) => mergeTicks(prev, [{ time: tickTime, value: nextPrice }]));
      setPrice(nextPrice);
      cachePrice(market, nextPrice);
      markLive();
    };

    // Reset — but keep cached seed if same market
    const cachedP = getFreshSeedPrice(market);
    const sameMarket = lastMarketRef.current === market;
    lastMarketRef.current = market;
    const hasLocalState =
      sameMarket && (
        ticksRef.current.length > 0
        || candlesRef.current.length > 0
        || liveCandleRef.current != null
        || priceRef.current > 0
      );

    if (preserveStateOnResume && hasLocalState) {
      setLiveCandle(liveCandleRef.current);
      setPrice(priceRef.current);
      setTicks(ticksRef.current);
      setCandles(candlesRef.current);
    } else if (initialBootstrap) {
      liveCandleRef.current = initialBootstrap.liveCandle;
      setLiveCandle(initialBootstrap.liveCandle);
      setPrice(initialBootstrap.price);
      setTicks(initialBootstrap.ticks);
      setCandles(initialBootstrap.candles);
    } else if (cachedP > 0) {
      const s = makeSeed(cachedP, candleSecs);
      liveCandleRef.current = s.candle;
      setLiveCandle(s.candle);
      setPrice(cachedP);
      setTicks(seedBackfillTicks ? generateBackfillTicks(cachedP) : []);
    } else {
      liveCandleRef.current = null;
      setLiveCandle(null);
      setPrice(0);
      setTicks([]);
      setCandles([]);
    }

    const productId = getPriceCandleProductId(market);
    if (!productId) {
      setConnected(false);
      return () => {};
    }

    if (historyLimit > 0) {
      const historyEnd = Math.floor(Date.now() / 1000);
      const historyStart = historyEnd - Math.max(historyLimit, 30) * 60;

      fetch(
        `https://api.exchange.coinbase.com/products/${productId}/candles?granularity=60&start=${new Date(historyStart * 1000).toISOString()}&end=${new Date(historyEnd * 1000).toISOString()}`,
        {
          cache: "no-store",
          signal: historyController.signal,
        },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !Array.isArray(data)) return;

          const rawCandles = (data as Array<[number, number, number, number, number, number]>)
            .map((candle) => ({
              time: candle[0],
              low: candle[1],
              high: candle[2],
              open: candle[3],
              close: candle[4],
              volume: candle[5],
            }))
            .sort((a, b) => a.time - b.time);

          const bootstrap = buildHistoryBootstrap(rawCandles, candleSecs);
          if (!bootstrap) return;

          setCandles((prev) => mergeCandles(prev, bootstrap.candles));
          setTicks((prev) => mergeTicks(prev, bootstrap.ticks));

          if (bootstrap.liveCandle) {
            const currentLive = liveCandleRef.current;

            if (currentLive && currentLive.time === bootstrap.liveCandle.time) {
              const mergedLive = ensureBody({
                time: currentLive.time,
                open: bootstrap.liveCandle.open,
                high: Math.max(currentLive.high, bootstrap.liveCandle.high),
                low: Math.min(currentLive.low, bootstrap.liveCandle.low),
                close: currentLive.close,
              }, candleSecs);
              liveCandleRef.current = mergedLive;
              setLiveCandle(mergedLive);
            } else if (!currentLive || currentLive.time <= bootstrap.liveCandle.time) {
              liveCandleRef.current = bootstrap.liveCandle;
              setLiveCandle(bootstrap.liveCandle);
            }
          }

          if (bootstrap.price > 0) {
            setPrice((prev) => (prev <= 0 || prev === cachedP ? bootstrap.price : prev));
            cachePrice(market, bootstrap.price);
          }
        })
        .catch(() => {});
    }

    const pollTicker = async () => {
      try {
        const response = await fetch(`https://api.exchange.coinbase.com/products/${productId}/ticker`, {
          cache: "no-store",
        });
        if (!response.ok || !active) return;

        const data = (await response.json()) as { price?: string };
        const nextPrice = parseFloat(data.price || "0");
        if (Number.isFinite(nextPrice) && nextPrice > 0) {
          if (liveCandleRef.current == null) {
            const seed = makeSeed(nextPrice, candleSecs);
            liveCandleRef.current = seed.candle;
            setLiveCandle(seed.candle);
            setTicks((prev) =>
              prev.length < 5 && seedBackfillTicks
                ? mergeTicks(generateBackfillTicks(nextPrice), [seed.tick])
                : mergeTicks(prev, [seed.tick])
            );
          }
          ingestPrice(nextPrice);
        }
      } catch {
        // Keep the last live state until the stale timer expires.
      } finally {
        if (active) {
          pollTimeout = setTimeout(() => {
            void pollTicker();
          }, TICKER_POLL_MS);
        }
      }
    };

    void pollTicker();

    const connect = () => {
      if (!active) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (!active) {
          ws?.close();
          return;
        }
        ws!.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: [productId],
            channels: ["ticker"],
          })
        );
      };

      ws.onmessage = (e) => {
        if (!active) return;
        const msg = JSON.parse(e.data);
        if (msg.type !== "ticker" || msg.product_id !== productId) return;

        const close = parseFloat(msg.price);
        if (isNaN(close) || close === 0) return;

        const now = Date.now() / 1000;
        ingestPrice(close, now);
      };

      ws.onclose = () => {
        if (!active) return;
        reconnectTimeout = setTimeout(connect, 2000);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      active = false;
      clearTimeout(reconnectTimeout);
      clearTimeout(pollTimeout);
      clearTimeout(staleTimeout);
      historyController.abort();
      ws?.close();
    };
  }, [candleSecs, enabled, historyLimit, initialBootstrap, market, preserveStateOnResume, seedBackfillTicks]);

  return { ticks, candles, liveCandle, price, connected };
}

export function useBtcCandles(enabled = true) {
  return usePriceCandles("BTC/USD", enabled);
}
