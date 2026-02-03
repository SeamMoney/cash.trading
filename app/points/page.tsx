"use client"

import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PointsStats } from "@/components/points/points-stats"
import { Leaderboard } from "@/components/points/leaderboard"
import { WalletWatcher } from "@/components/points/wallet-watcher"
import { DepositHistory } from "@/components/points/deposit-history"
import { PointsCalculator } from "@/components/points/points-calculator"
import { FarmingTips } from "@/components/points/farming-tips"
import { Trophy, Eye, TrendingUp } from "lucide-react"

export default function PointsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Title */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 border border-primary/30">
            <Trophy className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-mono font-bold text-white">Season 0 Points</h1>
            <p className="text-xs font-mono text-zinc-500">Track predeposits, points, and leaderboard rankings</p>
          </div>
        </div>

        {/* Main Stats */}
        <PointsStats />

        {/* Two Column Layout for Calculator and Tips */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Points Calculator */}
            <PointsCalculator />

            {/* Deposit History */}
            <DepositHistory />
          </div>

          {/* Farming Tips Sidebar */}
          <div className="lg:col-span-1">
            <FarmingTips />
          </div>
        </div>

        {/* Tabs for Leaderboard and Wallet Watcher */}
        <Tabs defaultValue="leaderboard" className="space-y-4">
          <TabsList className="bg-zinc-900/50 border border-white/10 p-1">
            <TabsTrigger
              value="leaderboard"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium flex items-center gap-2"
            >
              <TrendingUp className="w-4 h-4" />
              Leaderboard
            </TabsTrigger>
            <TabsTrigger
              value="watcher"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium flex items-center gap-2"
            >
              <Eye className="w-4 h-4" />
              Wallet Watcher
            </TabsTrigger>
          </TabsList>

          <TabsContent value="leaderboard" className="outline-none">
            <Leaderboard />
          </TabsContent>

          <TabsContent value="watcher" className="outline-none">
            <WalletWatcher />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
