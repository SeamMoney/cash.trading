"use client"

import { useState, useMemo } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { usePointsData } from "@/contexts/points-data-context"

export function PointsCalculator() {
  const { connected } = useWallet()
  const { globalStats, userData } = usePointsData()
  const [poolSize, setPoolSize] = useState<number>(10) // in millions USD

  const totalPoints = globalStats?.total_points || 0
  const userPoints = userData?.points || 0

  const calc = useMemo(() => {
    const userSharePct = totalPoints > 0 ? (userPoints / totalPoints) * 100 : 0
    const poolRaw = poolSize * 1_000_000
    const perPoint = totalPoints > 0 ? poolRaw / totalPoints : 0
    const yourValue = poolRaw * (userSharePct / 100)

    return { userSharePct, perPoint, yourValue }
  }, [poolSize, totalPoints, userPoints])

  const fmtUsd = (n: number) => {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    if (n >= 1) return `$${n.toFixed(2)}`
    if (n > 0) return `$${n.toFixed(4)}`
    return '$0'
  }

  return (
    <div className="space-y-3">
      {/* Airdrop Pool Slider */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Hypothetical Pool</span>
          <span className="text-xs sm:text-sm font-mono font-bold text-white">${poolSize >= 1000 ? `${(poolSize / 1000).toFixed(1)}B` : `${poolSize}M`}</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={poolSize}
          onChange={(e) => setPoolSize(Number(e.target.value))}
          className="w-full h-1.5 bg-zinc-800 appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-[8px] font-mono text-zinc-600 mt-0.5">
          <span>$1M</span>
          <span>$100M</span>
        </div>
      </div>

      {/* Results */}
      <div className={`grid ${connected && userPoints > 0 ? 'grid-cols-3' : 'grid-cols-1'} gap-2`}>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">$/Point</div>
          <div className="text-sm sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">
            {calc.perPoint > 0 ? fmtUsd(calc.perPoint) : '—'}
          </div>
        </div>
        {connected && userPoints > 0 && (
          <>
            <div className="bg-black/40 border border-white/10 px-2 py-2">
              <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Your Share</div>
              <div className="text-sm sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
                {calc.userSharePct >= 0.01
                  ? `${calc.userSharePct.toFixed(2)}%`
                  : calc.userSharePct > 0
                    ? `${calc.userSharePct.toFixed(4)}%`
                    : '—'}
              </div>
            </div>
            <div className="bg-black/40 border border-primary/20 px-2 py-2">
              <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Scenario Value</div>
              <div className="text-sm sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">
                {fmtUsd(calc.yourValue)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Context */}
      <div className="text-[9px] sm:text-[10px] font-mono text-zinc-600 leading-relaxed">
        Uses your current share of Decibel's official Season 1 AMPs. This is a scenario tool,
        not a token allocation, price prediction, or promise of value.
      </div>
    </div>
  )
}
