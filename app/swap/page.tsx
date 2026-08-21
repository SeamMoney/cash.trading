import type { Metadata } from "next";

import { Header } from "@/components/layout/Header";
import { SwapPageClient } from "@/components/trade/SwapPageClient";

export const metadata: Metadata = {
  title: "Swap spot assets | cash.trading",
  description: "Swap CASH, APT, BTC, and USDC directly from your Aptos wallet.",
};

export default function SwapPage() {
  return (
    <div className="cash-trade-theme min-h-screen bg-background pb-10">
      <Header />
      <main className="relative z-10 mx-auto w-full max-w-[1800px] px-4 py-3 sm:px-6 sm:py-4 lg:px-6 lg:py-5 2xl:px-8">
        <h1 className="sr-only">Swap spot assets</h1>
        <SwapPageClient />
      </main>
    </div>
  );
}
