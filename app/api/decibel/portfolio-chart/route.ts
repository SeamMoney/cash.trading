import { NextRequest, NextResponse } from "next/server";
import {
  getReadDex,
  isValidAptosAddress,
  resolveDecibelNetwork,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const REQUEST_TIMEOUT_MS = 8_000;
const RANGES = new Set(["24h", "7d", "30d", "90d", "all"] as const);
const TYPES = new Set(["pnl", "account_value"] as const);

type PortfolioRange = "24h" | "7d" | "30d" | "90d" | "all";
type PortfolioType = "pnl" | "account_value";

function isPortfolioRange(value: string | null): value is PortfolioRange {
  return value != null && RANGES.has(value as PortfolioRange);
}

function isPortfolioType(value: string | null): value is PortfolioType {
  return value != null && TYPES.has(value as PortfolioType);
}

function timestampMs(value: number) {
  return value < 10_000_000_000 ? value * 1_000 : value;
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-portfolio-chart", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const address = req.nextUrl.searchParams.get("address");
  const range = req.nextUrl.searchParams.get("range");
  const type = req.nextUrl.searchParams.get("type");
  const network = resolveDecibelNetwork(req.nextUrl.searchParams.get("network"));

  if (!isValidAptosAddress(address) || !isPortfolioRange(range) || !isPortfolioType(type)) {
    return NextResponse.json(
      { error: "A valid account, range, and chart type are required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const rows = await getReadDex(network).portfolioChart.getByAddr({
      subAddr: address,
      range,
      type,
      fetchOptions: { signal: controller.signal },
    });
    const byTimestamp = new Map<number, { timestamp: number; value: number }>();

    for (const row of rows) {
      const timestamp = timestampMs(Number(row.timestamp));
      const value = Number(row.data_points);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value) || timestamp <= 0) continue;
      byTimestamp.set(timestamp, { timestamp, value });
    }

    return NextResponse.json(
      {
        network,
        range,
        type,
        points: Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp),
        source: "decibel",
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[decibel-portfolio-chart] history unavailable:", message);
    return NextResponse.json(
      { error: "Decibel portfolio history is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  } finally {
    clearTimeout(timer);
  }
}
