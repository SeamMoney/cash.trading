export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId || !/^[A-Z0-9-]{1,32}$/.test(productId)) {
    return Response.json(
      { price: null, unavailable: true, reason: "A valid productId is required" },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const response = await fetch(
      `https://api.exchange.coinbase.com/products/${productId}/ticker`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      throw new Error(`Coinbase ticker request failed (${response.status})`);
    }

    const data = (await response.json()) as { price?: string };
    const price = Number(data.price);
    return Response.json(
      { price: Number.isFinite(price) && price > 0 ? price : null },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to fetch Coinbase ticker";
    return Response.json(
      { price: null, unavailable: true, reason },
      { headers: NO_STORE_HEADERS },
    );
  }
}
