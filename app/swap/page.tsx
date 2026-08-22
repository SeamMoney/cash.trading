import type { Metadata } from "next";

import { SwapPageClient } from "@/components/trade/SwapPageClient";

export const metadata: Metadata = {
  title: "Swap spot assets | cash.trading",
  description: "Swap CASH, APT, BTC, and USDC directly from your Aptos wallet.",
};

// The shell (theme wrapper, Header, main) moved into SwapPageClient: the
// header's PageConnectCta context has to be decided from wallet state on the
// first paint, so its provider must sit above <Header />, and only a client
// component can read `connected`. The rendered DOM is unchanged.
export default function SwapPage() {
  return <SwapPageClient />;
}
