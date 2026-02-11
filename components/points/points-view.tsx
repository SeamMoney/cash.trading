"use client"

import { useState } from "react"
import { PointsDataProvider } from "@/contexts/points-data-context"
import { PointsStats } from "@/components/points/points-stats"
import { Leaderboard } from "@/components/points/leaderboard"
import { PointsCalculator } from "@/components/points/points-calculator"
import { FarmingTips } from "@/components/points/farming-tips"
import { ChevronDown, ChevronUp, TrendingUp, Calculator } from "lucide-react"

export function PointsView() {
  const [showLeaderboard, setShowLeaderboard] = useState(true)
  const [showCalculator, setShowCalculator] = useState(false)

  return (
    <PointsDataProvider>
      <div className="space-y-3">
        {/* Main Stats */}
        <PointsStats />

        {/* Collapsible Leaderboard */}
        <div>
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-black/40 border border-white/10 hover:bg-white/5 transition-colors"
            aria-expanded={showLeaderboard}
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="size-3.5 text-zinc-500" />
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Leaderboard</span>
            </div>
            {showLeaderboard ? (
              <ChevronUp className="size-4 text-zinc-500" />
            ) : (
              <ChevronDown className="size-4 text-zinc-500" />
            )}
          </button>
          {showLeaderboard && (
            <div className="border border-white/10 border-t-0 p-2 sm:p-3">
              <Leaderboard />
            </div>
          )}
        </div>

        {/* Collapsible Points Calculator */}
        <div>
          <button
            onClick={() => setShowCalculator(!showCalculator)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-black/40 border border-white/10 hover:bg-white/5 transition-colors"
            aria-expanded={showCalculator}
          >
            <div className="flex items-center gap-2">
              <Calculator className="size-3.5 text-zinc-500" />
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">Airdrop Estimator</span>
            </div>
            {showCalculator ? (
              <ChevronUp className="size-4 text-zinc-500" />
            ) : (
              <ChevronDown className="size-4 text-zinc-500" />
            )}
          </button>
          {showCalculator && (
            <div className="border border-white/10 border-t-0 p-2 sm:p-3">
              <PointsCalculator />
            </div>
          )}
        </div>

        {/* Farming Tips */}
        <FarmingTips />
      </div>
    </PointsDataProvider>
  )
}
