export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

const MAX_RANGE_SECONDS = 300 * 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const granularity = Math.max(60, Number(searchParams.get("granularity")) || 60);
  const end = Number(searchParams.get("end")) || Math.floor(Date.now() / 1000);
  const requestedStart = Number(searchParams.get("start")) || end - 120 * 60;
  const start = Math.max(requestedStart, end - MAX_RANGE_SECONDS);

  if (!productId || !/^[A-Z0-9-]{1,32}$/.test(productId)) {
    return Response.json(
      { candles: [], unavailable: true, reason: "A valid productId is required" },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/candles`);
    url.searchParams.set("granularity", String(granularity));
    url.searchParams.set("start", new Date(start * 1000).toISOString());
    url.searchParams.set("end", new Date(end * 1000).toISOString());

    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Coinbase candles request failed (${response.status})`);
    }

    const raw = (await response.json()) as unknown;
    const candles = Array.isArray(raw) ? raw : [];
    return Response.json({ candles }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to fetch Coinbase candles";
    return Response.json(
      { candles: [], unavailable: true, reason },
      { headers: NO_STORE_HEADERS },
    );
  }
}
