"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Eye, ChevronDown, ChevronUp, Sparkles, Zap } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { Leaderboard } from "./leaderboard"
import { WalletWatcher } from "./wallet-watcher"

interface PointsData {
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
  rank?: number
}

interface GlobalStats {
  total_points: number
  total_deposited: number
  total_dlp: number
  total_ua: number
  depositor_count: number
  status: 'pre-launch' | 'live' | 'error'
}

export function PointsView() {
  const { account, connected } = useWallet()
  const [pointsData, setPointsData] = useState<PointsData | null>(null)
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState<{ days: number; hours: number; mins: number; secs: number } | null>(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showWatcher, setShowWatcher] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const totalRes = await fetch('/api/predeposit/total')
      const totalData = await totalRes.json()
      setGlobalStats(totalData)

      if (account?.address) {
        const [pointsRes, balancesRes] = await Promise.all([
          fetch(`/api/predeposit/points?account=${account.address}`),
          fetch(`/api/predeposit/balances?account=${account.address}`),
        ])

        const points = await pointsRes.json()
        const balances = await balancesRes.json()

        setPointsData({
          points: points.points || 0,
          dlp_balance: balances.dlp_balance || '0',
          ua_balance: balances.ua_balance || '0',
          total_deposited: balances.total_deposited || '0',
        })
      }
    } catch (error) {
      console.error('Error fetching points data:', error)
    } finally {
      setLoading(false)
    }
  }, [account?.address])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Countdown to Feb 7, 2026
  useEffect(() => {
    const launchDate = new Date('2026-02-07T00:00:00Z')

    const updateCountdown = () => {
      const now = new Date()
      const diff = launchDate.getTime() - now.getTime()

      if (diff <= 0) {
        setCountdown(null)
        return
      }

      setCountdown({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        mins: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        secs: Math.floor((diff % (1000 * 60)) / 1000),
      })
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    return `$${n.toFixed(0)}`
  }

  const isPreLaunch = globalStats?.status === 'pre-launch'

  return (
    <div className="space-y-4">
      {/* Season 0 Ticket */}
      {isPreLaunch && countdown && (
        <div className="relative flex flex-col overflow-hidden rounded-xl bg-black border border-primary/30">
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-purple-500/10" />
          <div className="absolute inset-0 opacity-5 bg-[radial-gradient(circle_at_50%_50%,_white_1px,_transparent_1px)] bg-[length:20px_20px]" />

          {/* Main content */}
          <div className="relative p-6">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Sparkles className="size-4 text-primary" />
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-primary font-bold">Season 0 Launches In</span>
              <Sparkles className="size-4 text-primary" />
            </div>

            {/* Countdown */}
            <div className="flex justify-center gap-3">
              {[
                { value: countdown.days, label: 'DAYS' },
                { value: countdown.hours, label: 'HRS' },
                { value: countdown.mins, label: 'MIN' },
                { value: countdown.secs, label: 'SEC' },
              ].map((item, i) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-14 h-16 bg-zinc-900 border border-white/10 rounded flex flex-col items-center justify-center">
                      <span className="text-2xl font-mono font-bold text-white tabular-nums">
                        {String(item.value).padStart(2, '0')}
                      </span>
                      <span className="text-[8px] font-mono text-zinc-500">{item.label}</span>
                    </div>
                  </div>
                  {i < 3 && <span className="text-xl text-primary font-bold">:</span>}
                </div>
              ))}
            </div>

            <p className="text-center text-[10px] font-mono text-zinc-500 mt-4">
              February 7, 2026 • Pre-deposits open
            </p>
          </div>

          {/* Rip line */}
          <div className="relative flex h-6 w-full items-center justify-center">
            <div className="absolute -left-3 h-6 w-6 rounded-full bg-zinc-950 z-10" />
            <div className="w-full border-t-2 border-dashed border-white/20" />
            <div className="absolute -right-3 h-6 w-6 rounded-full bg-zinc-950 z-10" />
          </div>

          {/* Stub section */}
          <div className="relative p-4 bg-zinc-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="size-4 text-zinc-500" />
              <div>
                <div className="text-[10px] font-mono text-zinc-500 uppercase">Total Locked</div>
                <div className="text-lg font-mono font-bold text-white tabular-nums">
                  {formatNumber(globalStats?.total_deposited || 0)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[10px] font-mono text-zinc-500 uppercase">Depositors</div>
                <div className="text-lg font-mono font-bold text-green-400 tabular-nums">
                  {(globalStats?.depositor_count || 0).toLocaleString()}
                </div>
              </div>
              <Users className="size-4 text-zinc-500" />
            </div>
          </div>
        </div>
      )}

      {/* Stats Row - Ticket style */}
      <div className="flex gap-3">
        {/* Points Ticket */}
        <div className="flex-1 relative overflow-hidden rounded-lg bg-purple-950/30 border border-purple-500/30">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent" />
          <div className="relative p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Trophy className="size-3.5 text-purple-400" />
              <span className="text-[10px] font-mono uppercase text-purple-400/70">Points</span>
            </div>
            <div className="text-2xl font-mono font-bold text-purple-400 tabular-nums">
              {(globalStats?.total_points || 0).toLocaleString()}
            </div>
          </div>
          {/* Mini barcode */}
          <div className="flex justify-end gap-0.5 px-4 pb-3 opacity-30">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={`bg-purple-400 ${i % 2 === 0 ? 'w-0.5 h-3' : 'w-1 h-3'}`} />
            ))}
          </div>
        </div>

        {/* DLP Ticket */}
        <div className="flex-1 relative overflow-hidden rounded-lg bg-blue-950/30 border border-blue-500/30">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent" />
          <div className="relative p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="size-3.5 text-blue-400" />
              <span className="text-[10px] font-mono uppercase text-blue-400/70">DLP</span>
            </div>
            <div className="text-2xl font-mono font-bold text-blue-400 tabular-nums">
              {formatNumber(globalStats?.total_dlp || 0)}
            </div>
          </div>
          {/* Mini barcode */}
          <div className="flex justify-end gap-0.5 px-4 pb-3 opacity-30">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={`bg-blue-400 ${i % 2 === 0 ? 'w-0.5 h-3' : 'w-1 h-3'}`} />
            ))}
          </div>
        </div>
      </div>

      {/* Your Stats Ticket */}
      {connected && (
        <div className="relative overflow-hidden rounded-xl bg-black border border-primary/30">
          {/* Gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />

          {/* Header */}
          <div className="relative flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Trophy className="size-4 text-primary" />
              </div>
              <span className="text-sm font-mono font-bold text-white">Your Stats</span>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
              aria-label="Refresh stats"
            >
              <RefreshCw className={`size-4 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Points Hero */}
          <div className="relative p-6 text-center border-b border-dashed border-white/10">
            <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Your Points</div>
            <div className="text-5xl font-mono font-bold text-primary tabular-nums">
              {(pointsData?.points || 0).toLocaleString()}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 divide-x divide-white/10">
            <div className="p-4 text-center">
              <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Deposited</div>
              <div className="text-lg font-mono font-bold text-white tabular-nums">
                {formatNumber(pointsData?.total_deposited || '0')}
              </div>
            </div>
            <div className="p-4 text-center">
              <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">DLP</div>
              <div className="text-lg font-mono font-bold text-blue-400 tabular-nums">
                {formatNumber(pointsData?.dlp_balance || '0')}
              </div>
            </div>
            <div className="p-4 text-center">
              <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Unallocated</div>
              <div className="text-lg font-mono font-bold text-orange-400 tabular-nums">
                {formatNumber(pointsData?.ua_balance || '0')}
              </div>
            </div>
          </div>

          {/* Barcode footer */}
          <div className="p-3 bg-zinc-900/50 flex justify-center gap-0.5">
            {[...Array(24)].map((_, i) => (
              <div key={i} className={`bg-white/30 ${i % 3 === 0 ? 'w-0.5 h-6' : i % 2 === 0 ? 'w-1 h-6' : 'w-0.5 h-4'}`} />
            ))}
          </div>
        </div>
      )}

      {/* Connect Wallet CTA */}
      {!connected && (
        <div className="relative overflow-hidden rounded-xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center">
          <Wallet className="size-8 text-primary/50 mx-auto mb-2" />
          <p className="text-sm font-mono text-primary">Connect wallet to track your points</p>
        </div>
      )}

      {/* Expandable Sections */}
      <div className="space-y-2">
        {/* Leaderboard */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="w-full flex items-center justify-between p-4 bg-zinc-900/50 hover:bg-zinc-900/70 transition-colors"
            aria-expanded={showLeaderboard}
          >
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="size-4 text-purple-400" />
              </div>
              <span className="text-sm font-mono text-white">Leaderboard</span>
            </div>
            {showLeaderboard ? (
              <ChevronUp className="size-5 text-zinc-500" />
            ) : (
              <ChevronDown className="size-5 text-zinc-500" />
            )}
          </button>
          {showLeaderboard && (
            <div className="border-t border-white/10 p-4 bg-black/50">
              <Leaderboard />
            </div>
          )}
        </div>

        {/* Wallet Watcher */}
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowWatcher(!showWatcher)}
            className="w-full flex items-center justify-between p-4 bg-zinc-900/50 hover:bg-zinc-900/70 transition-colors"
            aria-expanded={showWatcher}
          >
            <div className="flex items-center gap-3">
              <div className="size-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Eye className="size-4 text-blue-400" />
              </div>
              <span className="text-sm font-mono text-white">Watch Wallets</span>
            </div>
            {showWatcher ? (
              <ChevronUp className="size-5 text-zinc-500" />
            ) : (
              <ChevronDown className="size-5 text-zinc-500" />
            )}
          </button>
          {showWatcher && (
            <div className="border-t border-white/10 p-4 bg-black/50">
              <WalletWatcher />
            </div>
          )}
        </div>
      </div>

      {/* Deposit CTA */}
      <a
        href="https://app.decibel.trade/predeposit"
        target="_blank"
        rel="noopener noreferrer"
        className="relative block w-full overflow-hidden rounded-xl bg-primary p-4 text-center group"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-primary via-yellow-400 to-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="relative font-mono font-bold text-black text-sm uppercase tracking-wider">
          Make Predeposit on Decibel →
        </span>
      </a>
    </div>
  )
}
