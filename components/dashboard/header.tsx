"use client"
import { WalletButton } from "@/components/wallet/wallet-button"

export function DashboardHeader() {
  return (
    <header className="relative z-10 w-full border-b border-white/10 bg-black/40 backdrop-blur-md px-2 py-3 md:p-4 lg:px-8">
      <div className="flex items-center justify-end">
        <WalletButton />
      </div>
    </header>
  )
}
