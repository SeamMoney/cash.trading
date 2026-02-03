"use client"
import Link from "next/link"
import { WalletButton } from "@/components/wallet/wallet-button"

export function DashboardHeader() {
  return (
    <header className="relative z-10 w-full border-b border-white/10 px-2 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center gap-1 shrink-0">
          <span className="text-2xl sm:text-3xl md:text-4xl" role="img" aria-label="Decibel logo">🔊💵</span>
          <span className="text-xl sm:text-2xl md:text-3xl font-black italic tracking-tighter bg-gradient-to-r from-primary via-yellow-300 to-primary bg-clip-text text-transparent pr-1" style={{ fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif', textShadow: '0 0 10px rgba(255,246,0,0.5)' }}>DECIBRRR</span>
        </Link>
        <WalletButton />
      </div>
    </header>
  )
}
