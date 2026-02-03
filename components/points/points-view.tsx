"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Loader2, Clock, Eye, ChevronDown, ChevronUp } from "lucide-react"
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
  const [countdown, setCountdown] = useState<string>('')
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
        setCountdown('LIVE')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

      setCountdown(`${days}d ${hours}h ${minutes}m`)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 60000)
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
      {/* Countdown Banner - Compact for mobile */}
      {isPreLaunch && (
        <div className="bg-primary/10 border border-primary/30 p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            <span className="text-xs font-mono text-zinc-400">Season 0 Opens</span>
          </div>
          <span className="text-lg font-mono font-bold text-primary tabular-nums">{countdown}</span>
        </div>
      )}

      {/* Stats Grid - 2x2 on mobile */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-black/40 border border-white/10 p-3">
          <div className="text-[10px] font-mono text-zinc-500 uppercase truncate">Total Deposited</div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {formatNumber(globalStats?.total_deposited || 0)}
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 p-3">
          <div className="text-[10px] font-mono text-zinc-500 uppercase truncate">Depositors</div>
          <div className="text-lg font-mono font-bold text-green-500 tabular-nums">
            {(globalStats?.depositor_count || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 p-3">
          <div className="text-[10px] font-mono text-zinc-500 uppercase truncate">Total Points</div>
          <div className="text-lg font-mono font-bold text-purple-500 tabular-nums">
            {(globalStats?.total_points || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 p-3">
          <div className="text-[10px] font-mono text-zinc-500 uppercase truncate">DLP Allocated</div>
          <div className="text-lg font-mono font-bold text-blue-500 tabular-nums">
            {formatNumber(globalStats?.total_dlp || 0)}
          </div>
        </div>
      </div>

      {/* Your Stats - Only if connected */}
      {connected && (
        <div className="bg-primary/5 border border-primary/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-500 uppercase">Your Stats</span>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1"
              aria-label="Refresh stats"
            >
              <RefreshCw className={`size-3.5 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-mono text-zinc-600 truncate">Points</div>
              <div className="text-2xl font-mono font-bold text-primary tabular-nums">
                {(pointsData?.points || 0).toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-zinc-600 truncate">Deposited</div>
              <div className="text-xl font-mono font-bold text-white tabular-nums">
                {formatNumber(pointsData?.total_deposited || '0')}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-zinc-600 truncate">DLP</div>
              <div className="text-lg font-mono text-blue-500 tabular-nums">
                {formatNumber(pointsData?.dlp_balance || '0')}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-zinc-600 truncate">Unallocated</div>
              <div className="text-lg font-mono text-orange-500 tabular-nums">
                {formatNumber(pointsData?.ua_balance || '0')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Sections */}
      <div className="space-y-2">
        {/* Leaderboard Toggle */}
        <button
          onClick={() => setShowLeaderboard(!showLeaderboard)}
          className="w-full flex items-center justify-between p-3 bg-black/40 border border-white/10 hover:border-white/20"
          aria-expanded={showLeaderboard}
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-zinc-500" />
            <span className="text-sm font-mono text-white">Leaderboard</span>
          </div>
          {showLeaderboard ? (
            <ChevronUp className="size-4 text-zinc-500" />
          ) : (
            <ChevronDown className="size-4 text-zinc-500" />
          )}
        </button>
        {showLeaderboard && <Leaderboard />}

        {/* Wallet Watcher Toggle */}
        <button
          onClick={() => setShowWatcher(!showWatcher)}
          className="w-full flex items-center justify-between p-3 bg-black/40 border border-white/10 hover:border-white/20"
          aria-expanded={showWatcher}
        >
          <div className="flex items-center gap-2">
            <Eye className="size-4 text-zinc-500" />
            <span className="text-sm font-mono text-white">Watch Wallets</span>
          </div>
          {showWatcher ? (
            <ChevronUp className="size-4 text-zinc-500" />
          ) : (
            <ChevronDown className="size-4 text-zinc-500" />
          )}
        </button>
        {showWatcher && <WalletWatcher />}
      </div>

      {/* Deposit CTA */}
      <a
        href="https://app.decibel.trade/predeposit"
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full p-3 bg-primary text-black text-center font-mono font-bold text-sm uppercase tracking-wider hover:bg-primary/90 transition-colors"
      >
        Make Predeposit on Decibel
      </a>
    </div>
  )
}
