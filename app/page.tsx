import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioView } from "@/components/dashboard/portfolio-view"
import { TradingView } from "@/components/dashboard/trading-view"
import { HistoryTable } from "@/components/dashboard/history-table"
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
          <div className="h-[400px] flex items-center justify-center border border-dashed border-white/10 rounded-xl bg-zinc-900/20 text-zinc-500">
            Volume Analysis View (Placeholder)
          </div>
        </TabsContent>

        <TabsContent value="trading" className="space-y-8 outline-none">
          <TradingView />
          <HistoryTable />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
