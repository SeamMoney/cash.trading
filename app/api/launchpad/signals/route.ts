import { NextResponse } from "next/server";
import { indicatorRegistry } from "@/app/api/launchpad/indicators/route";

export const runtime = "nodejs";

export interface SignalEntry {
  timestamp: number;
  signal: 0 | 1 | 2; // NEUTRAL | BUY | SELL
  price: number;
  confidence: number;
  asset: string;
}

// In-memory delivery buffer populated only by authenticated keeper decisions.
export const signalBuffer: Map<string, SignalEntry[]> = new Map();

// ─── SSE subscribers ─────────────────────────────────────────────────
export const sseSubscribers: Set<(data: string) => void> = new Set();

// ─── GET — fetch signals with optional access gating ─────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const indicator = url.searchParams.get("indicator");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  if (!indicator) {
    return NextResponse.json({ error: "Missing indicator param" }, { status: 400 });
  }

  // Paid signal delivery is not configured. Never accept a query-string
  // membership claim or a public bypass for proprietary feeds.
  const ind = indicatorRegistry.find((i) => i.address === indicator);
  if (ind?.isProprietary) {
    return NextResponse.json(
      {
        unavailable: true,
        reason: "paid_signal_delivery_not_configured",
        error: "Authenticated paid signal delivery is not configured.",
        indicator,
      },
      { status: 501 },
    );
  }

  const signals = signalBuffer.get(indicator) || [];
  const recent = signals.slice(-limit).reverse(); // newest first

  return NextResponse.json({
    indicator,
    signals: recent,
    total: signals.length,
    returned: recent.length,
  });
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.LAUNCHPAD_KEEPER_API_SECRET ?? process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Signal ingestion is not configured" }, { status: 503 });
    }
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json();
    const { indicatorAddr, signal, price, confidence, asset } = body;

    if (!indicatorAddr || ![0, 1, 2].includes(signal) || !Number.isFinite(price) || price <= 0 || !asset) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (!signalBuffer.has(indicatorAddr)) signalBuffer.set(indicatorAddr, []);
    const buf = signalBuffer.get(indicatorAddr)!;
    const entry: SignalEntry = {
      timestamp: Date.now(),
      signal,
      price,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      asset,
    };
    buf.push(entry);
    if (buf.length > 1000) buf.splice(0, buf.length - 1000);

    // Notify SSE subscribers
    const payload = JSON.stringify({ indicatorAddr, ...entry });
    for (const send of sseSubscribers) send(payload);

    return NextResponse.json({ success: true, totalSignals: buf.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
