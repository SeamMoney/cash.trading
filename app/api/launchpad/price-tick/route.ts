/**
 * GET /api/launchpad/price-tick?asset=BTC/USD
 * Returns the latest price from Pyth Hermes for a given asset.
 * No on-chain interaction — pure HTTP fetch from Hermes.
 */
import { NextResponse } from "next/server";
import { PYTH_HERMES_URL, PYTH_FEED_IDS } from "@/lib/launchpad/constants";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") || "BTC/USD";

  const feedId = PYTH_FEED_IDS[asset];
  if (!feedId) {
    return NextResponse.json(
      { error: `unsupported asset: ${asset}. supported: ${Object.keys(PYTH_FEED_IDS).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}`,
      { cache: "no-store" },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Pyth Hermes returned ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const parsed = data.parsed?.[0]?.price;
    if (!parsed) {
      return NextResponse.json(
        { error: "no price data returned from Pyth" },
        { status: 502 },
      );
    }

    const price = Number(parsed.price) * Math.pow(10, Number(parsed.expo));
    const timestamp = Number(parsed.publish_time);

    return NextResponse.json(
      { price, asset, timestamp },
      { headers: { "Cache-Control": "s-maxage=1, stale-while-revalidate=1" } },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
