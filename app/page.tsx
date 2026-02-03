import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioView } from "@/components/dashboard/portfolio-view"
import { HistoryTable } from "@/components/dashboard/history-table"
import { ServerBotConfig } from "@/components/bot/server-bot-config"
import { PointsView } from "@/components/points/points-view"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Decibrrr - Farm Decibel Points",
  description: "Automated volume generation bot for Decibel DEX on Aptos.",
}

export default function Home() {
  return (
    <DashboardLayout>
      <Tabs defaultValue="volume" className="space-y-4">
        <TabsList className="w-full bg-zinc-900/50 border border-white/10 p-1 grid grid-cols-3">
          <TabsTrigger
            value="portfolio"
            className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium text-xs sm:text-sm"
          >
            Portfolio
          </TabsTrigger>
          <TabsTrigger
            value="volume"
            className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium text-xs sm:text-sm"
          >
            Bot
          </TabsTrigger>
          <TabsTrigger
            value="points"
            className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium text-xs sm:text-sm"
          >
            Points
          </TabsTrigger>
        </TabsList>

        <TabsContent value="portfolio" className="space-y-4 outline-none">
          <PortfolioView />
          <HistoryTable />
        </TabsContent>

        <TabsContent value="volume" className="space-y-4 outline-none">
          <ServerBotConfig />
        </TabsContent>

        <TabsContent value="points" className="outline-none">
          <PointsView />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
