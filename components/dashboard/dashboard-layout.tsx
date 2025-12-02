import type React from "react"
import { DashboardBackground } from "./background"
import { DashboardHeader } from "./header"

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-primary selection:text-black overflow-x-hidden">
      <DashboardBackground />
      <div className="relative z-10 flex flex-col min-h-screen">
        <DashboardHeader />
        <main className="flex-1 container max-w-[1920px] mx-auto px-2 py-4 md:p-6 lg:p-8 space-y-6">{children}</main>
      </div>
    </div>
  )
}
