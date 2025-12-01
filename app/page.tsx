import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioView } from "@/components/dashboard/portfolio-view"
import { HistoryTable } from "@/components/dashboard/history-table"
import { ServerBotConfig } from "@/components/bot/server-bot-config"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Decibel Volume Bot",
  description: "Automated volume generation bot for Decibel DEX on Aptos.",
}

export default function Home() {
  return (
    <DashboardLayout>
      <Tabs defaultValue="volume" className="space-y-3 sm:space-y-4 md:space-y-6 h-full flex flex-col">
        <div className="flex items-center gap-2 sm:gap-4">
          <TabsList className="bg-zinc-900/50 border border-white/10 p-1">
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
              Volume
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="portfolio" className="space-y-4 sm:space-y-6 md:space-y-8 outline-none flex-1 overflow-y-auto md:overflow-hidden">
          <PortfolioView />
          <HistoryTable />
        </TabsContent>

        <TabsContent value="volume" className="space-y-4 sm:space-y-6 md:space-y-8 outline-none flex-1 overflow-y-auto md:overflow-hidden">
          <ServerBotConfig />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
