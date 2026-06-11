import { NextRequest, NextResponse } from "next/server";
import {
  DECIBEL_BASE,
  getDecibelApiKey,
  resolveMarketAddress,
} from "@/lib/decibel-market-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1mo": 2_592_000_000,
};

const DEFAULT_BARS = 300;
const MAX_BARS = 1500;

/** Upstream candle: {t, T, o, h, l, c, v, i} (TradingView-style, unix ms). */
interface Candle {
  t: number;
  T: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  i: string;
}

function unavailable(reason: string) {
  return NextResponse.json(
    { candles: [], unavailable: true, reason, fetchedAt: Date.now() },
    { headers: NO_STORE_HEADERS },
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const market = params.get("market") ?? "";
  const interval = params.get("interval") ?? "1m";

  if (!market) {
    return NextResponse.json(
      { error: "market is required (name like BTC/USD or a 0x market address)" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  if (!(interval in INTERVAL_MS)) {
    return NextResponse.json(
      { error: `interval must be one of: ${Object.keys(INTERVAL_MS).join(", ")}` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const barsParam = Number(params.get("bars") ?? DEFAULT_BARS);
  const bars = Number.isFinite(barsParam)
    ? Math.min(Math.max(Math.floor(barsParam), 1), MAX_BARS)
    : DEFAULT_BARS;
  const endTime = Number(params.get("endTime") ?? Date.now());
  const startTime = Number(params.get("startTime") ?? endTime - bars * INTERVAL_MS[interval]);
  if (!Number.isFinite(endTime) || !Number.isFinite(startTime) || startTime >= endTime) {
    return NextResponse.json(
      { error: "startTime/endTime must be unix ms with startTime < endTime" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const apiKey = getDecibelApiKey();
  if (!apiKey) {
    return unavailable("missing_api_key");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const marketAddr = await resolveMarketAddress(market, apiKey, controller.signal);
    if (!marketAddr) {
      return NextResponse.json(
        { error: `unknown market: ${market}` },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const upstream = new URLSearchParams({
      market: marketAddr,
      interval,
      startTime: String(Math.floor(startTime)),
      endTime: String(Math.floor(endTime)),
    });
    const res = await fetch(`${DECIBEL_BASE}/candlesticks?${upstream}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`candlesticks returned ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    const candles: Candle[] = Array.isArray(data) ? data : [];

    return NextResponse.json(
      { market: marketAddr, interval, candles, fetchedAt: Date.now() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream_unavailable";
    return unavailable(reason);
  } finally {
    clearTimeout(timer);
  }
}
