import { NextRequest, NextResponse } from "next/server";
import { getReadDex } from "@/lib/decibel";

export const runtime = "nodejs";

// Spread and size profiles per market for realistic synthetic depth
const MARKET_PROFILES: Record<string, { spreadBps: number; baseSize: number; tickSize: number }> = {
  "BTC/USD":  { spreadBps: 1,   baseSize: 0.05,   tickSize: 1 },
  "ETH/USD":  { spreadBps: 2,   baseSize: 0.5,    tickSize: 0.1 },
  "SOL/USD":  { spreadBps: 3,   baseSize: 10,     tickSize: 0.01 },
  "APT/USD":  { spreadBps: 5,   baseSize: 50,     tickSize: 0.001 },
  "XRP/USD":  { spreadBps: 5,   baseSize: 500,    tickSize: 0.0001 },
  "DOGE/USD": { spreadBps: 8,   baseSize: 5000,   tickSize: 0.00001 },
  "HYPE/USD": { spreadBps: 10,  baseSize: 20,     tickSize: 0.001 },
  "SUI/USD":  { spreadBps: 6,   baseSize: 100,    tickSize: 0.001 },
  "BNB/USD":  { spreadBps: 3,   baseSize: 1,      tickSize: 0.01 },
};

// Simple seeded PRNG for deterministic-ish but varying depth
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateSyntheticDepth(markPrice: number, marketName: string, limit: number) {
  const profile = MARKET_PROFILES[marketName] || { spreadBps: 5, baseSize: 1, tickSize: 0.01 };
  const halfSpread = markPrice * (profile.spreadBps / 10000 / 2);
  const tick = profile.tickSize;

  // Seed from market name + minute (shifts every ~60s for subtle movement)
  const minute = Math.floor(Date.now() / 60000);
  let seedVal = minute;
  for (let i = 0; i < marketName.length; i++) seedVal += marketName.charCodeAt(i) * 31;
  const rand = mulberry32(seedVal);

  const bids: { price: number; size: number }[] = [];
  const asks: { price: number; size: number }[] = [];

  const pricePrecision = Math.max(0, -Math.floor(Math.log10(tick)));
  const roundPrice = (p: number) => parseFloat((Math.round(p / tick) * tick).toFixed(pricePrecision));

  let bidPrice = roundPrice(markPrice - halfSpread);
  let askPrice = roundPrice(markPrice + halfSpread);

  for (let i = 0; i < limit; i++) {
    const depthMultiplier = 1 + i * 0.3 + rand() * 0.8;
    const bidSize = profile.baseSize * depthMultiplier * (0.6 + rand() * 0.8);
    const askSize = profile.baseSize * depthMultiplier * (0.6 + rand() * 0.8);

    bids.push({ price: bidPrice, size: Math.round(bidSize * 10000) / 10000 });
    asks.push({ price: askPrice, size: Math.round(askSize * 10000) / 10000 });

    // Step down for next bid, step up for next ask — ensure at least 1 tick
    const stepMultiplier = (1 + i * 0.1) * (0.8 + rand() * 0.5);
    const bidStep = Math.max(tick, tick * stepMultiplier);
    const askStep = Math.max(tick, tick * stepMultiplier);
    bidPrice = roundPrice(bidPrice - bidStep);
    askPrice = roundPrice(askPrice + askStep);
  }

  return { bids, asks };
}

/**
 * GET /api/decibel/depth?market=BTC-USD&limit=15
 * Returns orderbook depth when the installed Decibel SDK exposes a real depth
 * read endpoint. Current SDK builds expose websocket subscriptions but no HTTP
 * depth reader, so this route reports unavailable instead of inventing levels.
 */
export async function GET(req: NextRequest) {
  const marketParam = req.nextUrl.searchParams.get("market");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "15");

  if (!marketParam) {
    return NextResponse.json(
      { error: "Missing market parameter (e.g. BTC-USD or BTC/USD)" },
      { status: 400 }
    );
  }

  const marketName = marketParam.replace("-", "/");

  try {
    const dex = getReadDex();
    const depthReader = dex.marketDepth as unknown as {
      getByName?: (args: { marketName: string; limit: number }) => Promise<{
        market: string;
        bids: { price: number; size: number }[];
        asks: { price: number; size: number }[];
        unix_ms: number;
      }>;
    };

    if (typeof depthReader.getByName !== "function") {
      return NextResponse.json(
        { error: "Decibel depth data is unavailable in the installed SDK" },
        { status: 503 }
      );
    }

    const depth = await depthReader.getByName({ marketName, limit });
    return NextResponse.json({
      market: depth.market,
      bids: depth.bids,
      asks: depth.asks,
      timestamp: depth.unix_ms,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch orderbook depth";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
