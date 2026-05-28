export const dynamic = "force-dynamic";

import { fetchCurrentBtcPrice } from "@/lib/btc-history";

export async function GET() {
  try {
    const price = await fetchCurrentBtcPrice();
    return Response.json({ price });
  } catch {
    return Response.json({ error: "Failed to fetch ticker" }, { status: 502 });
  }
}
