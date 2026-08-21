import type { Metadata } from "next"
import { PointsPageClient } from "@/components/points/points-page-client"

export const metadata: Metadata = {
  title: "Points · cash.trading",
  description: "Your Decibel AMPs, tier and streak, and the Season 1 leaderboard.",
}

export default function PointsPage() {
  return <PointsPageClient />
}
