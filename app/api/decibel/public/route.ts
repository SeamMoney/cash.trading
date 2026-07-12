import { NextRequest, NextResponse } from "next/server";
import {
  getAptosFullnodeApiKey,
  resolveDecibelNetwork,
  type DecibelNetwork,
} from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DECIBEL_BASES: Record<DecibelNetwork, string> = {
  mainnet: "https://api.mainnet.aptoslabs.com/decibel/api/v1",
  testnet: "https://api.testnet.aptoslabs.com/decibel/api/v1",
};
const DEFAULT_TIMEOUT_MS = 4500;
const DEFAULT_CANDLE_WINDOW_MS = 12 * 60 * 60 * 1000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type DecibelRestMarket = {
  lot_size: number;
  market_addr: string;
  market_name: string;
  max_leverage: number;
  max_open_interest: number;
  min_size: number;
  mode: string;
  px_decimals: number;
  sz_decimals: number;
  tick_size: number;
  unrealized_pnl_haircut_bps: number;
};

type DecibelRestPrice = {
  funding_rate_bps: number;
  is_funding_positive: boolean;
  mark_px: number;
  market: string;
  mid_px: number;
  open_interest: number;
  oracle_px: number;
  transaction_unix_ms: number;
};

type DecibelRestTrade = {
  action: string;
  account: string;
  fee_amount: number;
  is_funding_positive: boolean;
  is_profit: boolean;
  market: string;
  price: number;
  realized_funding_amount: number;
  realized_pnl_amount: number;
  size: number;
  source?: string;
  trade_id?: string;
  transaction_unix_ms: number;
  transaction_version: number;
};

type DecibelRestCandle = {
  T: number;
  c: number;
  h: number;
  i: string;
  l: number;
  o: number;
  t: number;
  v: number;
};

async function fetchUpstream<T>(
  path: string,
  network: DecibelNetwork,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const apiKey = getAptosFullnodeApiKey(network);
    const res = await fetch(`${DECIBEL_BASES[network]}${path}`, {
      cache: "no-store",
      headers: apiKey
        ? {
            Authorization: `Bearer ${apiKey}`,
          }
        : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Decibel upstream failed (${res.status}) for ${path}`);
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

function getTimeout(searchParams: URLSearchParams) {
  const value = Number(searchParams.get("timeoutMs"));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10000) : DEFAULT_TIMEOUT_MS;
}

function getNetwork(searchParams: URLSearchParams): DecibelNetwork {
  return resolveDecibelNetwork(searchParams.get("network"));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const resource = searchParams.get("resource");
  const timeoutMs = getTimeout(searchParams);
  const network = getNetwork(searchParams);

  try {
    if (resource === "markets") {
      const markets = await fetchUpstream<DecibelRestMarket[]>("/markets", network, timeoutMs);
      return NextResponse.json(markets, { headers: NO_STORE_HEADERS });
    }

    if (resource === "prices") {
      const prices = await fetchUpstream<DecibelRestPrice[]>("/prices", network, timeoutMs);
      return NextResponse.json(prices, { headers: NO_STORE_HEADERS });
    }

    if (resource === "bundle" || resource === "bootstrap") {
      const marketName = searchParams.get("marketName");
      if (!marketName) {
        return NextResponse.json(
          { error: "marketName is required" },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }

      const [markets, prices] = await Promise.all([
        fetchUpstream<DecibelRestMarket[]>("/markets", network, timeoutMs),
        fetchUpstream<DecibelRestPrice[]>("/prices", network, timeoutMs),
      ]);

      const market = markets.find((entry) => entry.market_name === marketName);
      if (!market) {
        return NextResponse.json(
          { error: `Decibel market not found: ${marketName}` },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      const price = prices.find((entry) => entry.market === market.market_addr) ?? null;

      if (resource === "bundle") {
        return NextResponse.json({ market, price }, { headers: NO_STORE_HEADERS });
      }

      const now = Date.now();
      const tradeLimit = Math.min(
        Math.max(Number(searchParams.get("tradeLimit")) || 900, 1),
        5000,
      );
      const candleWindowMs = Math.min(
        Math.max(Number(searchParams.get("candleWindowMs")) || DEFAULT_CANDLE_WINDOW_MS, 60_000),
        24 * 60 * 60 * 1000,
      );
      const [candlesResult, tradesResult] = await Promise.allSettled([
        fetchUpstream<DecibelRestCandle[]>(
          `/candlesticks?market=${market.market_addr}&interval=1m&startTime=${now - candleWindowMs}&endTime=${now}`,
          network,
          timeoutMs,
        ),
        fetchUpstream<{ items: DecibelRestTrade[] }>(
          `/trades?market=${market.market_addr}&limit=${tradeLimit}`,
          network,
          timeoutMs,
        ),
      ]);

      return NextResponse.json({
        market,
        price,
        candles: candlesResult.status === "fulfilled" ? candlesResult.value : [],
        trades: tradesResult.status === "fulfilled" ? tradesResult.value.items : [],
      }, { headers: NO_STORE_HEADERS });
    }

    if (resource === "trades") {
      const marketAddr = searchParams.get("marketAddr");
      if (!marketAddr) {
        return NextResponse.json(
          { error: "marketAddr is required" },
          { status: 400, headers: NO_STORE_HEADERS }
        );
      }
      const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 1200, 1), 5000);
      const trades = await fetchUpstream<{ items: DecibelRestTrade[] }>(
        `/trades?market=${marketAddr}&limit=${limit}`,
        network,
        timeoutMs,
      );
      return NextResponse.json(trades, { headers: NO_STORE_HEADERS });
    }

    if (resource === "candles") {
      const marketAddr = searchParams.get("marketAddr");
      const interval = searchParams.get("interval") ?? "1m";
      const startTime = searchParams.get("startTime");
      const endTime = searchParams.get("endTime");

      if (!marketAddr || !startTime || !endTime) {
        return NextResponse.json(
          { error: "marketAddr, startTime, and endTime are required" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      const candles = await fetchUpstream<DecibelRestCandle[]>(
        `/candlesticks?market=${marketAddr}&interval=${interval}&startTime=${startTime}&endTime=${endTime}`,
        network,
        timeoutMs,
      );
      return NextResponse.json(candles, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      { error: "Unsupported decibel public resource" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decibel proxy request failed";
    const status = message.includes("aborted") ? 504 : 500;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
  }
}
