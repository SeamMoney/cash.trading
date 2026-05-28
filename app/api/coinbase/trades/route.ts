export const dynamic = "force-dynamic";

type CoinbaseTrade = {
  price: string;
  time: string;
  trade_id: number;
};

const PAGE_SIZE = 300;
const MAX_PAGES = 30;
const DEFAULT_TARGET_SPAN_SECS = 8 * 60;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");
  const targetSpanSecs = Math.min(
    Math.max(Number(searchParams.get("targetSpanSecs")) || DEFAULT_TARGET_SPAN_SECS, 60),
    30 * 60,
  );

  if (!productId) {
    return Response.json({ error: "productId is required" }, { status: 400 });
  }

  try {
    const trades: Array<{ price: number; transaction_unix_ms: number }> = [];
    const cutoffMs = Date.now() - targetSpanSecs * 1000;
    let afterCursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/trades`);
      url.searchParams.set("limit", String(PAGE_SIZE));
      if (afterCursor) {
        url.searchParams.set("after", afterCursor);
      }

      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Coinbase trades request failed (${response.status})`);
      }

      const pageTrades = (await response.json()) as CoinbaseTrade[];
      if (!Array.isArray(pageTrades) || pageTrades.length === 0) break;

      for (const trade of pageTrades) {
        const price = Number(trade.price);
        const transaction_unix_ms = Date.parse(trade.time);
        if (!Number.isFinite(price) || !Number.isFinite(transaction_unix_ms)) continue;
        trades.push({ price, transaction_unix_ms });
      }

      const oldestTime = trades[trades.length - 1]?.transaction_unix_ms ?? Date.now();
      if (oldestTime <= cutoffMs) break;

      afterCursor = response.headers.get("cb-after");
      if (!afterCursor) break;
    }

    trades.sort((a, b) => a.transaction_unix_ms - b.transaction_unix_ms);
    return Response.json({ trades });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch Coinbase trades";
    return Response.json({ error: message }, { status: 502 });
  }
}
