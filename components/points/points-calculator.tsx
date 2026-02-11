"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

const LAUNCH_DATE = new Date('2026-02-11T00:30:00Z')
const SEASON_END = new Date('2026-02-24T00:00:00Z')
const SEASON_DAYS = (SEASON_END.getTime() - LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24) // ~13 days

export function PointsCalculator() {
  const { account, connected } = useWallet()
  const [fdv, setFdv] = useState<number>(500)       // in millions
  const [allocPct, setAllocPct] = useState<number>(5)
  const [totalPoints, setTotalPoints] = useState<number>(0)
  const [userPoints, setUserPoints] = useState<number>(0)

  const fetchData = useCallback(async () => {
    try {
      const totalRes = await fetch('/api/predeposit/total')
      const totalData = await totalRes.json()
      setTotalPoints(totalData.total_points || 0)

      if (account?.address) {
        const pointsRes = await fetch(`/api/predeposit/points?account=${account.address}`)
        const pointsData = await pointsRes.json()
        setUserPoints(pointsData.points || 0)
      }
    } catch (error) {
      console.error('Error fetching calculator data:', error)
    }
  }, [account?.address])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const calc = useMemo(() => {
    // Project total points to end of season based on current accumulation rate
    const now = Date.now()
    const daysElapsed = Math.max(0.01, (now - LAUNCH_DATE.getTime()) / (1000 * 60 * 60 * 24))
    const projectedTotal = totalPoints * (SEASON_DAYS / daysElapsed)

    // Project user points similarly
    const projectedUserPoints = userPoints * (SEASON_DAYS / daysElapsed)

    const fdvRaw = fdv * 1_000_000
    const poolValue = fdvRaw * (allocPct / 100)
    const perPoint = projectedTotal > 0 ? poolValue / projectedTotal : 0
    const yourValue = projectedUserPoints * perPoint

    return { poolValue, perPoint, yourValue, projectedTotal, projectedUserPoints }
  }, [fdv, allocPct, totalPoints, userPoints])

  const formatUsd = (n: number) => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    if (n >= 1) return `$${n.toFixed(2)}`
    if (n > 0) return `$${n.toFixed(4)}`
    return '$0'
  }

  const formatPts = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    if (n >= 1) return n.toFixed(0)
    return n.toFixed(4)
  }

  return (
    <div className="space-y-4">
      {/* FDV Slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">$DBL FDV</span>
          <span className="text-xs sm:text-sm font-mono font-bold text-white">${fdv >= 1000 ? `${(fdv / 1000).toFixed(1)}B` : `${fdv}M`}</span>
        </div>
        <input
          type="range"
          min={100}
          max={1000}
          step={10}
          value={fdv}
          onChange={(e) => setFdv(Number(e.target.value))}
          className="w-full h-1.5 bg-zinc-800 appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-[8px] font-mono text-zinc-600 mt-0.5">
          <span>$100M</span>
          <span>$1B</span>
        </div>
      </div>

      {/* Allocation Slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Season 0 Token Allocation</span>
          <span className="text-xs sm:text-sm font-mono font-bold text-white">{allocPct}%</span>
        </div>
        <input
          type="range"
          min={1}
          max={15}
          step={0.5}
          value={allocPct}
          onChange={(e) => setAllocPct(Number(e.target.value))}
          className="w-full h-1.5 bg-zinc-800 appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-[8px] font-mono text-zinc-600 mt-0.5">
          <span>1%</span>
          <span>15%</span>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Airdrop Pool</div>
          <div className="text-sm sm:text-base font-mono font-bold text-white tabular-nums leading-tight">
            {formatUsd(calc.poolValue)}
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Est. $/Point</div>
          <div className="text-sm sm:text-base font-mono font-bold text-primary tabular-nums leading-tight">
            {calc.perPoint > 0 ? formatUsd(calc.perPoint) : '—'}
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">
            {connected && userPoints > 0 ? 'Your Airdrop' : 'Per 1 Pt'}
          </div>
          <div className="text-sm sm:text-base font-mono font-bold text-primary tabular-nums leading-tight">
            {connected && userPoints > 0
              ? formatUsd(calc.yourValue)
              : calc.perPoint > 0 ? formatUsd(calc.perPoint) : '—'}
          </div>
        </div>
      </div>

      {/* Context line */}
      <div className="text-[9px] sm:text-[10px] font-mono text-zinc-600">
        Projected ~{formatPts(calc.projectedTotal)} total pts by season end (Feb 24)
        {connected && userPoints > 0 && (
          <> · You: ~{formatPts(calc.projectedUserPoints)} pts ({((userPoints / totalPoints) * 100).toFixed(2)}%)</>
        )}
      </div>
    </div>
  )
}
