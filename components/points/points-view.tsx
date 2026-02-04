"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, Users, Wallet, RefreshCw, ChevronDown, ChevronUp, Sparkles, Zap, TrendingUp, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { Leaderboard } from "./leaderboard"
import { useMockData } from "@/contexts/mock-data-context"
import { MOCK_POINTS_DATA, MOCK_GLOBAL_STATS } from "@/lib/mock-data"

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
  const { isMockMode } = useMockData()
  const [pointsData, setPointsData] = useState<PointsData | null>(null)
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState<{ days: number; hours: number; mins: number; secs: number } | null>(null)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  const fetchData = useCallback(async () => {
    if (isMockMode) {
      setGlobalStats(MOCK_GLOBAL_STATS)
      setPointsData(MOCK_POINTS_DATA)
      return
    }

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
  }, [account?.address, isMockMode])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Refresh when mock mode changes
  useEffect(() => {
    fetchData()
  }, [isMockMode])

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
    <div className="space-y-3">
      {/* Season 0 Countdown */}
      {isPreLaunch && countdown && (
        <div className="bg-black/40 border border-primary/30 p-5">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Sparkles className="size-4 text-primary" />
            <span className="text-xs text-primary uppercase tracking-wider font-bold">Season 0 Launches In</span>
            <Sparkles className="size-4 text-primary" />
          </div>

          {/* Countdown */}
          <div className="flex justify-center items-center gap-2 mb-4">
            {[
              { value: countdown.days, label: 'D' },
              { value: countdown.hours, label: 'H' },
              { value: countdown.mins, label: 'M' },
              { value: countdown.secs, label: 'S' },
            ].map((item, i) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="w-14 h-16 bg-black/60 border border-white/10 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-white tabular-nums leading-none">
                    {String(item.value).padStart(2, '0')}
                  </span>
                  <span className="text-[10px] text-zinc-500 mt-1">{item.label}</span>
                </div>
                {i < 3 && <span className="text-lg text-primary font-bold">:</span>}
              </div>
            ))}
          </div>

          <p className="text-center text-[10px] text-zinc-500">
            February 7, 2026 • Pre-deposits open
          </p>

          {/* Global stats inline */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-zinc-500" />
              <span className="text-xs text-zinc-500 uppercase">Locked</span>
              <span className="text-base font-bold text-white tabular-nums">
                {formatNumber(globalStats?.total_deposited || 0)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-green-400 tabular-nums">
                {(globalStats?.depositor_count || 0).toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 uppercase">Depositors</span>
              <Users className="size-4 text-zinc-500" />
            </div>
          </div>
        </div>
      )}

      {/* Your Stats - Connected or Mock Mode */}
      {(connected || isMockMode) && (
        <div className="bg-black/40 border border-white/10">
          {/* Points Hero */}
          <div className="p-5 pb-4 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Trophy className="size-4 text-primary" />
                <span className="text-xs text-zinc-500 uppercase">Your Points</span>
              </div>
              <div className="text-5xl font-bold text-primary tabular-nums leading-none">
                {(pointsData?.points || 0).toLocaleString()}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchData}
              disabled={loading}
              className="h-8 w-8 border border-white/10 bg-black/40 hover:bg-white/5 disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`size-3.5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {/* 3-column stats */}
          <div className="grid grid-cols-3 border-t border-white/10">
            <div className="p-4 border-r border-white/10">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">DLP</div>
              <div className="flex items-center gap-1.5">
                <Zap className="size-3.5 text-blue-400" />
                <span className="text-lg font-bold text-blue-400 tabular-nums">
                  {formatNumber(pointsData?.dlp_balance || '0')}
                </span>
              </div>
            </div>
            <div className="p-4 border-r border-white/10">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Deposited</div>
              <span className="text-lg font-bold text-white tabular-nums">
                {formatNumber(pointsData?.total_deposited || '0')}
              </span>
            </div>
            <div className="p-4">
              <div className="text-[10px] text-zinc-500 uppercase mb-1">Rank</div>
              <span className="text-lg font-bold text-zinc-400 tabular-nums">
                {pointsData?.rank ? `#${pointsData.rank}` : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Connect Wallet */}
      {!connected && !isMockMode && (
        <div className="border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
          <Wallet className="size-8 text-primary/50 mx-auto mb-2" />
          <p className="text-sm text-primary font-bold">Connect wallet to track your points</p>
        </div>
      )}

      {/* Accordions */}
      <div className="space-y-2">
        <button
          onClick={() => setShowLeaderboard(!showLeaderboard)}
          className="w-full flex items-center justify-between p-3.5 bg-black/40 border border-white/10 hover:bg-white/5 transition-colors"
          aria-expanded={showLeaderboard}
        >
          <div className="flex items-center gap-2.5">
            <TrendingUp className="size-4 text-zinc-400" />
            <span className="text-sm text-white">Leaderboard</span>
          </div>
          {showLeaderboard ? (
            <ChevronUp className="size-5 text-zinc-500" />
          ) : (
            <ChevronDown className="size-5 text-zinc-500" />
          )}
        </button>
        {showLeaderboard && (
          <div className="bg-black/60 border border-white/10 border-t-0 p-4 -mt-2">
            <Leaderboard />
          </div>
        )}

      </div>

      {/* How Points Work */}
      <div className="bg-black/40 border border-white/10 p-4">
        <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">How Points Work</div>
        <div className="space-y-2.5">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">1</span>
            </div>
            <p className="text-sm text-zinc-300">Deposit USDC to earn DLP tokens</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">2</span>
            </div>
            <p className="text-sm text-zinc-300">Hold DLP to accumulate points over time</p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">3</span>
            </div>
            <p className="text-sm text-zinc-300">Points unlock rewards when Season 0 launches</p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <Button
        size="lg"
        asChild
        className="w-full h-12 bg-primary text-primary-foreground font-bold text-sm uppercase tracking-wider hover:bg-primary/90"
      >
        <a
          href="https://app.decibel.trade/predeposit"
          target="_blank"
          rel="noopener noreferrer"
        >
          Make Predeposit on Decibel
          <ArrowUpRight className="ml-2 h-4 w-4" />
        </a>
      </Button>
    </div>
  )
}
