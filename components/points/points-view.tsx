"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Loader2, Clock, Eye, ChevronDown, ChevronUp, Sparkles, Zap } from "lucide-react"
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
      {/* Hero Countdown Section */}
      {isPreLaunch && countdown && (
        <div className="relative overflow-hidden rounded-lg border border-primary/30 bg-black">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-purple-500/10 via-transparent to-transparent" />

          {/* Glow effect */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

          <div className="relative p-4 sm:p-6">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Sparkles className="size-4 text-primary animate-pulse" />
              <span className="text-xs font-mono uppercase tracking-widest text-primary">Season 0 Launches In</span>
              <Sparkles className="size-4 text-primary animate-pulse" />
            </div>

            {/* Countdown boxes */}
            <div className="flex justify-center gap-2 sm:gap-3">
              {[
                { value: countdown.days, label: 'Days' },
                { value: countdown.hours, label: 'Hrs' },
                { value: countdown.mins, label: 'Min' },
                { value: countdown.secs, label: 'Sec' },
              ].map((item, i) => (
                <div key={item.label} className="relative">
                  <div className="w-14 sm:w-16 h-16 sm:h-20 bg-zinc-900/80 border border-white/10 flex flex-col items-center justify-center">
                    <span className="text-2xl sm:text-3xl font-mono font-bold text-white tabular-nums">
                      {String(item.value).padStart(2, '0')}
                    </span>
                    <span className="text-[9px] font-mono uppercase text-zinc-500">{item.label}</span>
                  </div>
                  {i < 3 && (
                    <span className="absolute -right-1.5 sm:-right-2 top-1/2 -translate-y-1/2 text-primary font-bold">:</span>
                  )}
                </div>
              ))}
            </div>

            <p className="text-center text-[10px] font-mono text-zinc-500 mt-3">
              February 7, 2026 • Pre-deposits open
            </p>
          </div>
        </div>
      )}

      {/* Stats Cards - Bento Grid Style */}
      <div className="grid grid-cols-2 gap-2">
        {/* Total Deposited - Featured */}
        <div className="col-span-2 relative overflow-hidden rounded-lg border border-white/10 bg-zinc-900/50 p-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Wallet className="size-4 text-zinc-500" />
                <span className="text-[10px] font-mono uppercase text-zinc-500">Total Value Locked</span>
              </div>
              <div className="text-3xl sm:text-4xl font-mono font-bold text-white tabular-nums">
                {formatNumber(globalStats?.total_deposited || 0)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Depositors</div>
              <div className="text-xl font-mono font-bold text-green-400 tabular-nums flex items-center gap-1">
                <Users className="size-4" />
                {(globalStats?.depositor_count || 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Points */}
        <div className="relative overflow-hidden rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
          <div className="absolute -top-4 -right-4 w-16 h-16 bg-purple-500/20 rounded-full blur-xl" />
          <div className="relative">
            <div className="flex items-center gap-1.5 mb-1">
              <Trophy className="size-3.5 text-purple-400" />
              <span className="text-[10px] font-mono uppercase text-purple-400/70">Total Points</span>
            </div>
            <div className="text-xl font-mono font-bold text-purple-400 tabular-nums">
              {(globalStats?.total_points || 0).toLocaleString()}
            </div>
          </div>
        </div>

        {/* DLP */}
        <div className="relative overflow-hidden rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <div className="absolute -top-4 -right-4 w-16 h-16 bg-blue-500/20 rounded-full blur-xl" />
          <div className="relative">
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="size-3.5 text-blue-400" />
              <span className="text-[10px] font-mono uppercase text-blue-400/70">DLP Allocated</span>
            </div>
            <div className="text-xl font-mono font-bold text-blue-400 tabular-nums">
              {formatNumber(globalStats?.total_dlp || 0)}
            </div>
          </div>
        </div>
      </div>

      {/* Your Stats Card */}
      {connected && (
        <div className="relative overflow-hidden rounded-lg border border-primary/30 bg-black">
          {/* Subtle glow */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

          <div className="relative p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <Trophy className="size-4 text-primary" />
                </div>
                <span className="text-sm font-mono font-bold text-white">Your Stats</span>
              </div>
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
                aria-label="Refresh stats"
              >
                <RefreshCw className={`size-3.5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Points - Large */}
              <div className="col-span-2 sm:col-span-1 bg-zinc-900/50 rounded-lg p-3 border border-white/5">
                <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Your Points</div>
                <div className="text-3xl font-mono font-bold text-primary tabular-nums">
                  {(pointsData?.points || 0).toLocaleString()}
                </div>
              </div>

              {/* Deposited */}
              <div className="bg-zinc-900/50 rounded-lg p-3 border border-white/5">
                <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Deposited</div>
                <div className="text-xl font-mono font-bold text-white tabular-nums">
                  {formatNumber(pointsData?.total_deposited || '0')}
                </div>
              </div>

              {/* DLP */}
              <div className="bg-zinc-900/50 rounded-lg p-3 border border-white/5">
                <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">DLP Balance</div>
                <div className="text-lg font-mono font-bold text-blue-400 tabular-nums">
                  {formatNumber(pointsData?.dlp_balance || '0')}
                </div>
              </div>

              {/* UA */}
              <div className="bg-zinc-900/50 rounded-lg p-3 border border-white/5">
                <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Unallocated</div>
                <div className="text-lg font-mono font-bold text-orange-400 tabular-nums">
                  {formatNumber(pointsData?.ua_balance || '0')}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connect Wallet CTA */}
      {!connected && (
        <div className="relative overflow-hidden rounded-lg border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
          <Wallet className="size-8 text-primary/50 mx-auto mb-2" />
          <p className="text-sm font-mono text-primary">Connect wallet to track your points</p>
        </div>
      )}

      {/* Expandable Sections */}
      <div className="space-y-2">
        {/* Leaderboard */}
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className="w-full flex items-center justify-between p-3 bg-zinc-900/50 hover:bg-zinc-900/70"
            aria-expanded={showLeaderboard}
          >
            <div className="flex items-center gap-2">
              <div className="size-6 rounded bg-purple-500/20 flex items-center justify-center">
                <TrendingUp className="size-3.5 text-purple-400" />
              </div>
              <span className="text-sm font-mono text-white">Leaderboard</span>
            </div>
            {showLeaderboard ? (
              <ChevronUp className="size-4 text-zinc-500" />
            ) : (
              <ChevronDown className="size-4 text-zinc-500" />
            )}
          </button>
          {showLeaderboard && (
            <div className="border-t border-white/10 p-3 bg-black/50">
              <Leaderboard />
            </div>
          )}
        </div>

        {/* Wallet Watcher */}
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <button
            onClick={() => setShowWatcher(!showWatcher)}
            className="w-full flex items-center justify-between p-3 bg-zinc-900/50 hover:bg-zinc-900/70"
            aria-expanded={showWatcher}
          >
            <div className="flex items-center gap-2">
              <div className="size-6 rounded bg-blue-500/20 flex items-center justify-center">
                <Eye className="size-3.5 text-blue-400" />
              </div>
              <span className="text-sm font-mono text-white">Watch Wallets</span>
            </div>
            {showWatcher ? (
              <ChevronUp className="size-4 text-zinc-500" />
            ) : (
              <ChevronDown className="size-4 text-zinc-500" />
            )}
          </button>
          {showWatcher && (
            <div className="border-t border-white/10 p-3 bg-black/50">
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
        className="relative block w-full overflow-hidden rounded-lg bg-primary p-3 text-center group"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-primary via-yellow-400 to-primary opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="relative font-mono font-bold text-black text-sm uppercase tracking-wider">
          Make Predeposit on Decibel →
        </span>
      </a>
    </div>
  )
}
