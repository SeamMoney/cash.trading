"use client"

import { useEffect, useState } from "react"
import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Loader2 } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { usePointsData } from "@/contexts/points-data-context"
import { ShareCard } from "./share-card"

export function PointsStats() {
  const { account, connected } = useWallet()
  const { globalStats, userData, loading, refresh } = usePointsData()
  const [countdown, setCountdown] = useState<string>('')

  useEffect(() => {
    const launchDate = new Date('2026-02-11T00:30:00Z')

    const updateCountdown = () => {
      const now = new Date()
      const diff = now.getTime() - launchDate.getTime()

      if (diff < 0) {
        const absDiff = Math.abs(diff)
        const d = Math.floor(absDiff / (1000 * 60 * 60 * 24))
        const h = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const m = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60))
        const s = Math.floor((absDiff % (1000 * 60)) / 1000)
        setCountdown(`${d}d ${h}h ${m}m ${s}s`)
        return
      }

      const d = Math.floor(diff / (1000 * 60 * 60 * 24))
      const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setCountdown(`${d}d ${h}h ${m}m elapsed`)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (isNaN(n)) return '$0'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    return `$${n.toFixed(2)}`
  }

  const isLive = globalStats?.status === 'live'
  const dlpFillPct = globalStats?.dlp_cap
    ? Math.min(100, ((globalStats.total_dlp || 0) / globalStats.dlp_cap) * 100)
    : 0

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] sm:text-xs font-mono text-zinc-500 uppercase tracking-widest whitespace-nowrap">
            Season 0
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-primary whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              Live
            </span>
          )}
          {countdown && (
            <span className="text-[10px] font-mono text-zinc-600 hidden sm:inline">{countdown}</span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="p-1.5 bg-black/40 border border-white/10 hover:border-primary/50 text-zinc-400 hover:text-primary disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </div>

      {/* DLP Fill Bar */}
      {isLive && globalStats?.dlp_cap && (
        <div>
          <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1">
            <span>DLP Fill</span>
            <span>{dlpFillPct.toFixed(1)}%</span>
          </div>
          <div className="h-1 bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-1000"
              style={{ width: `${dlpFillPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Global Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <Wallet className="w-3 h-3 shrink-0 hidden sm:block" />
            Deposited
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {formatNumber(globalStats?.total_deposited || 0)}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 shrink-0 hidden sm:block" />
            DLP
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {formatNumber(globalStats?.total_dlp || 0)}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <Trophy className="w-3 h-3 shrink-0 hidden sm:block" />
            Points
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">
            {(globalStats?.total_points || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <Users className="w-3 h-3 shrink-0 hidden sm:block" />
            Depositors
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {(globalStats?.depositor_count || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Your Stats */}
      {connected ? (
        <div className="bg-black/40 border border-white/10 px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Your Stats</span>
            <ShareCard
              points={userData?.points || 0}
              totalDeposited={userData?.total_deposited || '0'}
              dlpBalance={userData?.dlp_balance || '0'}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Points (est.)</div>
              <div className="text-xl sm:text-2xl font-mono font-bold text-primary tabular-nums leading-tight">
                {(userData?.points || 0) < 1
                  ? (userData?.points || 0).toFixed(4)
                  : (userData?.points || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">DLP Share</div>
              <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
                {globalStats?.total_points && userData?.points
                  ? ((userData.points / globalStats.total_points) * 100).toFixed(4) + '%'
                  : '0%'}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Deposited</div>
              <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
                {formatNumber(userData?.total_deposited || '0')}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Unallocated</div>
              <div className="text-base sm:text-lg font-mono font-bold text-zinc-400 tabular-nums leading-tight">
                {formatNumber(userData?.ua_balance || '0')}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3 py-3 bg-primary/5 border border-primary/20 text-center">
          <p className="text-primary font-mono text-xs sm:text-sm">Connect wallet to see your stats</p>
        </div>
      )}
    </div>
  )
}
