import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PortfolioView } from "@/components/dashboard/portfolio-view"
import { HistoryTable } from "@/components/dashboard/history-table"
import { ServerBotConfig } from "@/components/bot/server-bot-config"
import { PointsView } from "@/components/points/points-view"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { botOwnerAllowlistConfigured } from "@/lib/bot-owner-guard"

export const metadata: Metadata = {
  title: "cash.trading - Farm Decibel Points",
  description: "Automated volume generation bot for Decibel DEX on Aptos.",
}

export default function Home() {
  // The page used to be hidden in production because the API behind it had no
  // authorization at all. It is now authorized per request (owner allowlist +
  // on-chain subaccount ownership), so the page is available wherever an owner
  // is configured — and still hidden when nobody is, so an unconfigured
  // deployment does not advertise a control surface that will only 503.
  if (!botOwnerAllowlistConfigured()) {
    redirect("/portfolio")
  }

  return (
    <DashboardLayout>
      <Tabs defaultValue="volume" className="space-y-6">
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
              value="points"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-primary font-medium"
            >
              Points
            </TabsTrigger>
          </TabsList>
        </div>

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
