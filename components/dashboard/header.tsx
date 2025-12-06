"use client"
import { WalletButton } from "@/components/wallet/wallet-button"

export function DashboardHeader() {
  return (
    <header className="relative z-10 w-full border-b border-white/10 bg-black/80 backdrop-blur-md px-2 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <span className="text-xl sm:text-2xl md:text-3xl" role="img" aria-label="Decibel logo">🔊💵</span>
          <span className="text-lg sm:text-xl md:text-2xl font-black italic tracking-tighter bg-gradient-to-r from-primary via-yellow-300 to-primary bg-clip-text text-transparent pr-1" style={{ fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif', textShadow: '0 0 10px rgba(255,246,0,0.5)' }}>DECIBRRR</span>
        </div>
        <WalletButton />
      </div>
    </header>
  )
}
