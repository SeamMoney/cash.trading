import { TradePageClient } from "@/components/trade/TradePageClient";
import { fetchRecentBtcCandles } from "@/lib/btc-history";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "cash.trading",
  description: "Aptos perp trading, analytics, launchpad strategies, and direct CASH rewards.",
};

export default async function Home() {
  const initialBtcCandles = await fetchRecentBtcCandles(8).catch(() => []);

  return (
    <div className="cash-trade-theme">
      <TradePageClient initialBtcCandles={initialBtcCandles} />
    </div>
  );
}
