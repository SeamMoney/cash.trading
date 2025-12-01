import type React from "react"
import { DashboardBackground } from "./background"
import { DashboardHeader } from "./header"

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen bg-black text-white font-sans selection:bg-primary selection:text-black overflow-hidden">
      <DashboardBackground />
      <div className="relative z-10 flex flex-col h-full">
        <DashboardHeader />
        <main className="flex-1 container max-w-[1920px] mx-auto p-2 sm:p-4 md:p-6 lg:p-8 overflow-y-auto md:overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
