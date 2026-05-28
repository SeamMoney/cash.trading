import { TradePageClient } from "@/components/trade/TradePageClient";
import { fetchRecentBtcCandles } from "@/lib/btc-history";

export const dynamic = "force-dynamic";

export default async function TradePage() {
  const initialBtcCandles = await fetchRecentBtcCandles(8).catch(() => []);

  return (
    <div className="cash-trade-theme">
      <TradePageClient initialBtcCandles={initialBtcCandles} />
    </div>
  );
}
