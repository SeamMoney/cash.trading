import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioView } from "@/components/dashboard/portfolio-view"
import { TradingView } from "@/components/dashboard/trading-view"
import { HistoryTable } from "@/components/dashboard/history-table"
import { ServerBotConfig } from "@/components/bot/server-bot-config"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Trading Dashboard",
  description: "Advanced crypto trading dashboard with portfolio analytics and execution tools.",
}

export default function Home() {
  return (
    <DashboardLayout>
      <Tabs defaultValue="trading" className="space-y-6">
        <div className="flex items-center gap-4">
          <TabsList className="bg-zinc-900/50 border border-white/10 p-1">
            <TabsTrigger
              value="portfolio"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium"
            >
              Portfolio
            </TabsTrigger>
            <TabsTrigger
              value="volume"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium"
            >
              Volume
            </TabsTrigger>
            <TabsTrigger
              value="trading"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium"
            >
              Trading
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="portfolio" className="space-y-8 outline-none">
          <PortfolioView />
          <HistoryTable />
        </TabsContent>

        <TabsContent value="volume" className="space-y-8 outline-none">
          <ServerBotConfig />
        </TabsContent>

        <TabsContent value="trading" className="space-y-8 outline-none">
          <TradingView />
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
