import { NextResponse } from "next/server";
import { indicatorRegistry, whopProductRegistry } from "@/app/api/launchpad/indicators/route";
import { hasAccess } from "@/lib/launchpad/signal-access";

export const runtime = "nodejs";

export interface SignalEntry {
  timestamp: number;
  signal: 0 | 1 | 2; // NEUTRAL | BUY | SELL
  price: number;
  confidence: number;
  asset: string;
}

// In-memory signal buffer — seeded for demo graduated indicators
export const signalBuffer: Map<string, SignalEntry[]> = new Map();

// ─── Seed historical signals for graduated indicators ────────────────
function seedSignals(addr: string, asset: string, basePrice: number) {
  const buf: SignalEntry[] = [];
  const signalSeq: Array<0 | 1 | 2> = [1, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 1, 0, 2, 0, 1];
  const now = Date.now();
  for (let i = signalSeq.length - 1; i >= 0; i--) {
    const ageMs = (signalSeq.length - i) * 8 * 60 * 1000; // every 8 min
    const jitter = (Math.random() - 0.5) * basePrice * 0.02;
    buf.push({
      timestamp: now - ageMs,
      signal: signalSeq[i],
      price: Math.round((basePrice + jitter) * 100) / 100,
      confidence: Math.round(1200 + Math.random() * 3000),
      asset,
    });
  }
  signalBuffer.set(addr, buf);
}

// Prices updated to current market levels (March 2026)
// Addresses must match graduated indicators in /api/launchpad/indicators registry
seedSignals("0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2", "ETH/USD", 3218); // RSI Momentum — ETH primary
seedSignals("0x6d1810f536ebfe54f4e009312d5a6efa4fcf11d152d8f96435cddae90e903aa7", "BTC/USD", 87420); // SMA Crossover Pro — BTC

// ─── Auto signal generator — fires every 8s for graduated indicators ─
const GRADUATED = [
  { addr: "0x5007e41e807933d46326264bb8a01b88cb18fafbc1256dd0d229003a521252d2", asset: "ETH/USD", basePrice: 3218 },
  { addr: "0x6d1810f536ebfe54f4e009312d5a6efa4fcf11d152d8f96435cddae90e903aa7", asset: "BTC/USD", basePrice: 87420 },
];

let _generatorRunning = false;
function ensureGenerator() {
  if (_generatorRunning) return;
  _generatorRunning = true;
  setInterval(() => {
    for (const { addr, asset, basePrice } of GRADUATED) {
      const buf = signalBuffer.get(addr) || [];
      const rand = Math.random();
      const signal: 0 | 1 | 2 = rand < 0.35 ? 1 : rand < 0.6 ? 2 : 0;
      const jitter = (Math.random() - 0.5) * basePrice * 0.015;
      buf.push({
        timestamp: Date.now(),
        signal,
        price: Math.round((basePrice + jitter) * 100) / 100,
        confidence: Math.round(1500 + Math.random() * 2500),
        asset,
      });
      if (buf.length > 1000) buf.splice(0, buf.length - 1000);
      signalBuffer.set(addr, buf);
    }
  }, 8000);
}
ensureGenerator();

// ─── SSE subscribers ─────────────────────────────────────────────────
export const sseSubscribers: Set<(data: string) => void> = new Set();

// ─── GET — fetch signals with optional access gating ─────────────────
export async function GET(req: Request) {
  const url = new URL(req.url);
  const indicator = url.searchParams.get("indicator");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  // Optional access proof from query string
  const membershipId = url.searchParams.get("whop_member_id") ?? url.searchParams.get("addr") ?? "";

  if (!indicator) {
    return NextResponse.json({ error: "Missing indicator param" }, { status: 400 });
  }

  // ── Access gating for graduated indicators ──────────────────────────
  // Bot dashboard passes ?bot=1 to bypass gating for internal monitoring
  const isBotView = url.searchParams.get("bot") === "1";
  const ind = indicatorRegistry.find((i) => i.address === indicator);
  if (ind?.isGraduated && !isBotView) {
    const whopProductId = whopProductRegistry.get(indicator);

    // Check membership proof: valid if membershipId is non-empty and granted
    const granted = membershipId.length > 0 && hasAccess(indicator, membershipId);

    if (!granted) {
      console.log(
        `[signals] Access denied — graduated indicator ${indicator.slice(0, 10)}… ` +
        `whop_member_id=${membershipId || "(none)"}`,
      );
      return NextResponse.json(
        {
          error: "Subscribe on Whop to access live signals",
          whopProductId: whopProductId ?? null,
          whopUrl: whopProductId
            ? `https://whop.com/checkout/${whopProductId}/`
            : "https://whop.com",
          indicator,
          isGraduated: true,
        },
        { status: 402 },
      );
    }
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
  try {
    const body = await req.json();
    const { indicatorAddr, signal, price, confidence, asset } = body;

    if (!indicatorAddr || signal === undefined || !price || !asset) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if (!signalBuffer.has(indicatorAddr)) signalBuffer.set(indicatorAddr, []);
    const buf = signalBuffer.get(indicatorAddr)!;
    const entry: SignalEntry = { timestamp: Date.now(), signal, price, confidence: confidence || 0, asset };
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
