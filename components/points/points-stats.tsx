"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Loader2, Clock } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

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
  launch_date?: string
}

export function PointsStats() {
  const { account, connected } = useWallet()
  const [pointsData, setPointsData] = useState<PointsData | null>(null)
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState<string>('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch global stats
      const totalRes = await fetch('/api/predeposit/total')
      const totalData = await totalRes.json()
      setGlobalStats(totalData)

      // Fetch user data if connected
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
        setCountdown('LIVE NOW')
        return
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setCountdown(`${days}d ${hours}h ${minutes}m ${seconds}s`)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [])

  const formatNumber = (num: number | string, decimals = 2) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(decimals)}`
  }

  const isPreLaunch = globalStats?.status === 'pre-launch'

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
          Season 0 Points Dashboard
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border border-white/10 hover:border-primary/50 transition-colors text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-primary disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Refresh
        </button>
      </div>

      {/* Launch Countdown Banner */}
      {isPreLaunch && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/30 p-6 relative">
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-primary" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-primary" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-primary" />

          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-primary mb-2">
              <Clock className="w-5 h-5" />
              <span className="text-xs font-mono uppercase tracking-widest">Pre-Deposits Launch In</span>
            </div>
            <div className="text-4xl md:text-5xl font-mono font-bold text-primary tracking-tight">
              {countdown}
            </div>
            <div className="text-xs font-mono text-zinc-400 mt-2">
              February 7, 2026 - Season 0 Opens
            </div>
          </div>
        </div>
      )}

      {/* Global Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative group hover:border-primary/50 transition-colors">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20 group-hover:border-primary transition-colors" />
          <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1 flex items-center gap-1">
            <Wallet className="w-3 h-3" />
            Total Deposited
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {formatNumber(globalStats?.total_deposited || 0)}
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative group hover:border-blue-500/50 transition-colors">
          <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            DLP Allocated
          </div>
          <div className="text-2xl font-mono font-bold text-blue-500">
            {formatNumber(globalStats?.total_dlp || 0)}
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative group hover:border-purple-500/50 transition-colors">
          <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1 flex items-center gap-1">
            <Trophy className="w-3 h-3" />
            Total Points
          </div>
          <div className="text-2xl font-mono font-bold text-purple-500">
            {(globalStats?.total_points || 0).toLocaleString()}
          </div>
        </div>

        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative group hover:border-green-500/50 transition-colors">
          <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1 flex items-center gap-1">
            <Users className="w-3 h-3" />
            Depositors
          </div>
          <div className="text-2xl font-mono font-bold text-green-500">
            {(globalStats?.depositor_count || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Your Stats */}
      {connected ? (
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

          <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-4">
            Your Season 0 Stats
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Your Points */}
            <div className="text-center md:text-left">
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1">
                Your Points
              </div>
              <div className="text-4xl font-mono font-bold text-primary">
                {(pointsData?.points || 0).toLocaleString()}
              </div>
            </div>

            {/* Your DLP */}
            <div className="text-center md:text-left">
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1">
                DLP Balance
              </div>
              <div className="text-2xl font-mono font-bold text-blue-500">
                {formatNumber(pointsData?.dlp_balance || '0')}
              </div>
            </div>

            {/* Your UA */}
            <div className="text-center md:text-left">
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1">
                Unallocated
              </div>
              <div className="text-2xl font-mono font-bold text-orange-500">
                {formatNumber(pointsData?.ua_balance || '0')}
              </div>
            </div>

            {/* Total Deposited */}
            <div className="text-center md:text-left">
              <div className="text-zinc-500 text-[10px] font-mono uppercase tracking-widest mb-1">
                Total Deposited
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {formatNumber(pointsData?.total_deposited || '0')}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 bg-primary/10 border border-primary/30 relative text-center">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary" />
          <p className="text-primary font-mono font-bold">Connect wallet to see your Season 0 stats</p>
        </div>
      )}
    </div>
  )
}
