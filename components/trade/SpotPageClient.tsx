"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { AmbientBlobs } from "@/components/layout/AmbientBlobs";
import { BTCChart } from "@/components/trade/BTCChart";
import { SpotTradePanel } from "@/components/trade/SpotTradePanel";
import { SPOT_MARKETS, SPOT_CATEGORIES } from "@/components/trade/spotMarketConfig";
import type { MarketHistoryCandle } from "@/lib/btc-history";

export function SpotPageClient({
  initialBtcCandles = [],
}: {
  initialBtcCandles?: MarketHistoryCandle[];
}) {
  const [market, setMarket] = useState({ id: "BTC/USD", pair: "BTC/USDT", leverage: 0 });
  const [currentPrice, setCurrentPrice] = useState(0);

  const handlePriceUpdate = useCallback((price: number) => {
    setCurrentPrice(price);
  }, []);

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <Header />
      <div className="relative" style={{ overflow: "clip" }}>
        <AmbientBlobs variant="trade" />
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 w-full">
          {/* Back button */}
          <Link
            href="/"
            className="absolute top-4 right-5 z-40 w-9 h-9 rounded-full bg-white/[0.06] backdrop-blur-sm flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.1] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>

          {/* Hero */}
          <div className="mb-4 sm:mb-6 lg:mb-4 animate-enter">
            <div className="flex items-center gap-4 mb-2">
              <span className="inline-block text-[11px] font-display font-medium px-2.5 py-1 rounded-[10px] bg-accent/10 text-accent uppercase tracking-wider">
                Whop Spot
              </span>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                </span>
                <span className="text-[13px] font-medium text-white">
                  Spot Trading on Aptos
                </span>
              </div>
            </div>
            <p className="text-[13px] font-sans text-zinc-400 max-w-3xl text-pretty leading-relaxed">
              Buy and sell crypto assets directly at spot prices. No leverage, no margin — simple spot execution with sub-second settlement on Aptos. Swap between tokens via DEX aggregation for best prices.
            </p>
          </div>

          {/* Desktop: side-by-side. Mobile: stacked */}
          <div className="lg:flex lg:gap-4">
            {/* Chart */}
            <div className="animate-enter animate-enter-delay-1 lg:flex-1 lg:min-w-0">
              <BTCChart
                initialHistory={initialBtcCandles}
                markets={SPOT_MARKETS}
                categories={SPOT_CATEGORIES}
                defaultMarket="BTC/USD"
                onMarketChange={(m) => setMarket(m)}
                onPriceUpdate={handlePriceUpdate}
              />
            </div>

            {/* Spot Trade Panel — right sidebar on desktop */}
            <div className="mt-6 max-w-xl mx-auto lg:mt-0 lg:mx-0 lg:w-[340px] lg:shrink-0 animate-enter animate-enter-delay-2">
              <SpotTradePanel
                market={market.pair}
                currentPrice={currentPrice}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
