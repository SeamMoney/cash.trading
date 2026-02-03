"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { WalletButton } from "@/components/wallet/wallet-button"
import { Trophy, Zap } from "lucide-react"

export function DashboardHeader() {
  const pathname = usePathname()

  return (
    <header className="relative z-10 w-full border-b border-white/10 px-2 py-2 sm:px-4 sm:py-3 md:px-6 md:py-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-1">
            <span className="text-2xl sm:text-3xl md:text-4xl" role="img" aria-label="Decibel logo">🔊💵</span>
            <span className="text-xl sm:text-2xl md:text-3xl font-black italic tracking-tighter bg-gradient-to-r from-primary via-yellow-300 to-primary bg-clip-text text-transparent pr-1" style={{ fontFamily: 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif', textShadow: '0 0 10px rgba(255,246,0,0.5)' }}>DECIBRRR</span>
          </Link>

          {/* Navigation */}
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            <Link
              href="/"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                pathname === '/'
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-zinc-400 hover:text-white border border-transparent hover:border-white/10'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Bot
            </Link>
            <Link
              href="/points"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors ${
                pathname === '/points'
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-zinc-400 hover:text-white border border-transparent hover:border-white/10'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              Points
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile Navigation */}
          <nav className="flex sm:hidden items-center gap-1">
            <Link
              href="/"
              className={`flex items-center justify-center p-2 transition-colors ${
                pathname === '/'
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-zinc-400 hover:text-white border border-transparent hover:border-white/10'
              }`}
            >
              <Zap className="w-4 h-4" />
            </Link>
            <Link
              href="/points"
              className={`flex items-center justify-center p-2 transition-colors ${
                pathname === '/points'
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'text-zinc-400 hover:text-white border border-transparent hover:border-white/10'
              }`}
            >
              <Trophy className="w-4 h-4" />
            </Link>
          </nav>
          <WalletButton />
        </div>
      </div>
    </header>
  )
}
