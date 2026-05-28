export const dynamic = "force-dynamic";

import { fetchRecentBtcCandles } from "@/lib/btc-history";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "300"), 1000);

  try {
    const candles = await fetchRecentBtcCandles(limit);
    return Response.json({ candles });
  } catch {
    return Response.json({ error: "Failed to fetch candles" }, { status: 502 });
  }
}
