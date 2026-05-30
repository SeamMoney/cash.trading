import type { Metadata } from "next";
import { PortfolioPageClient } from "@/components/portfolio/PortfolioPageClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio | cash.trading",
  description: "Decibel portfolio, balances, positions, orders, and USDC withdrawals on cash.trading.",
};

export default function PortfolioPage() {
  return <PortfolioPageClient />;
}
