import { NextRequest, NextResponse } from "next/server";
import { indicatorRegistry } from "@/app/api/launchpad/indicators/route";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import { PYTH_FEED_IDS } from "@/lib/launchpad/constants";
import {
  appendLaunchpadSignal,
  getRecentLaunchpadSignals,
} from "@/lib/launchpad/signals-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};
const MAX_SIGNAL_BODY_BYTES = 16_000;

export function isProprietarySignalIndicator(indicator: string): boolean {
  return indicatorRegistry.some(
    (entry) =>
      entry.address.toLowerCase() === indicator.toLowerCase() &&
      entry.isProprietary,
  );
}

// ─── GET — fetch signals with optional access gating ─────────────────
export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-signals", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  const url = new URL(req.url);
  const rawIndicator = url.searchParams.get("indicator");
  const rawLimit = url.searchParams.get("limit") || "50";
  if (!isValidAptosAddress(rawIndicator) || !/^\d{1,3}$/.test(rawLimit)) {
    return NextResponse.json(
      { error: "a valid indicator and limit are required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const indicator = normalizeAptosAddress(rawIndicator, "indicator");
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return NextResponse.json(
      { error: "limit must be an integer from 1 to 500" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Paid signal delivery is not configured. Never accept a query-string
  // membership claim or a public bypass for proprietary feeds.
  if (isProprietarySignalIndicator(indicator)) {
    return NextResponse.json(
      {
        unavailable: true,
        reason: "paid_signal_delivery_not_configured",
        error: "Authenticated paid signal delivery is not configured.",
        indicator,
      },
      { status: 501, headers: NO_STORE_HEADERS },
    );
  }

  if (url.searchParams.get("stream") === "true") {
    const streamUrl = new URL("/api/launchpad/signals/stream", req.url);
    streamUrl.searchParams.set("indicators", indicator);
    return NextResponse.redirect(streamUrl, 307);
  }

  try {
    const { signals, total } = await getRecentLaunchpadSignals(indicator, limit);
    const recent = signals.map(({ id: _id, indicatorAddr: _indicatorAddr, ...entry }) => entry);

    return NextResponse.json({
      indicator,
      signals: recent,
      total,
      returned: recent.length,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[launchpad-signals] history read failed:", error);
    return NextResponse.json(
      { error: "Signal history is temporarily unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.LAUNCHPAD_KEEPER_API_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "Signal ingestion is not configured" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_SIGNAL_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body is too large" },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Signal payload is invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { indicatorAddr, signal, price, confidence, asset } = body;
  if (
    !isValidAptosAddress(indicatorAddr) ||
    typeof signal !== "number" ||
    ![0, 1, 2].includes(signal) ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0 ||
    (confidence !== undefined &&
      (typeof confidence !== "number" ||
        !Number.isInteger(confidence) ||
        confidence < 0 ||
        confidence > 10_000)) ||
    typeof asset !== "string" ||
    !Object.hasOwn(PYTH_FEED_IDS, asset)
  ) {
    return NextResponse.json(
      { error: "Signal fields are invalid" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const normalizedIndicator = normalizeAptosAddress(indicatorAddr, "indicatorAddr");
  try {
    const { total } = await appendLaunchpadSignal({
      indicatorAddr: normalizedIndicator,
      signal: signal as 0 | 1 | 2,
      price,
      confidence: typeof confidence === "number" ? confidence : 0,
      asset,
    });

    return NextResponse.json(
      { success: true, totalSignals: total },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[launchpad-signals] storage write failed:", error);
    return NextResponse.json(
      { error: "Signal storage is temporarily unavailable" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
