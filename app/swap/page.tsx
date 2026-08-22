import type { Metadata } from "next";

import { SwapPageClient } from "@/components/trade/SwapPageClient";

export const metadata: Metadata = {
  title: "Swap spot assets | cash.trading",
  description: "Swap CASH, APT, BTC, and USDC directly from your Aptos wallet.",
};

// The shell (theme wrapper, Header, main) lives in SwapPageClient because the
// asset selector is driven by client state that has to be read before the
// first paint.
export default function SwapPage() {
  return <SwapPageClient />;
}
