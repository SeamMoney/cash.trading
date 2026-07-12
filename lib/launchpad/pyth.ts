// Launchpad — Pyth data fetcher (inlined from packages/indicator-launchpad)

import type { Candle, CandleResolution } from "./types";
import { PYTH_BENCHMARKS_URL, PYTH_FEED_IDS } from "./constants";

interface TVHistoryResponse {
  s: "ok" | "error" | "no_data";
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

/**
 * Fetch OHLCV candles from Pyth Benchmarks TradingView shim.
 * Automatically chunks into 1-year windows.
 */
export async function fetchPythCandles(
  asset: string,
  resolution: CandleResolution,
  fromTs: number,
  toTs: number,
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<Candle[]> {
  if (!Object.hasOwn(PYTH_FEED_IDS, asset)) throw new Error("Unsupported Pyth asset");
  if (
    !Number.isInteger(fromTs) ||
    !Number.isInteger(toTs) ||
    fromTs <= 0 ||
    toTs <= fromTs ||
    toTs - fromTs > 3 * 365 * 24 * 3_600
  ) {
    throw new Error("Invalid Pyth candle range");
  }

  const symbol = `Crypto.${asset}`;
  const oneYear = 365 * 24 * 3600;
  const allCandles: Candle[] = [];

  let cursor = fromTs;
  while (cursor < toTs) {
    const chunkEnd = Math.min(cursor + oneYear, toTs);
    const url =
      `${PYTH_BENCHMARKS_URL}/v1/shims/tradingview/history` +
      `?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}` +
      `&from=${cursor}&to=${chunkEnd}`;

    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) throw new Error(`Pyth TV API error: ${res.status} for ${asset}`);

    const data = (await res.json()) as TVHistoryResponse;
    if (data.s === "ok" && data.t?.length > 0) {
      for (let i = 0; i < data.t.length; i++) {
        allCandles.push({
          timestamp: data.t[i],
          open: data.o[i],
          high: data.h[i],
          low: data.l[i],
          close: data.c[i],
          volume: data.v?.[i] ?? 0,
        });
      }
    }

    cursor = chunkEnd;
    if (cursor < toTs) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  return allCandles;
}

interface PythPriceUpdate {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

export async function fetchPythLatestPrice(asset: string) {
  const feedId = PYTH_FEED_IDS[asset];
  if (!feedId) throw new Error(`Unknown asset: ${asset}`);
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${feedId}&encoding=hex&parsed=true`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Pyth Hermes error: ${res.status}`);
  const data = await res.json() as { binary: { data: string[] }; parsed: PythPriceUpdate[] };
  const parsed = data.parsed[0];
  const price = Number(parsed.price.price) * Math.pow(10, parsed.price.expo);
  const confidence = Number(parsed.price.conf) * Math.pow(10, parsed.price.expo);
  return { price, confidence, publishTime: parsed.price.publish_time, binary: data.binary.data };
}
