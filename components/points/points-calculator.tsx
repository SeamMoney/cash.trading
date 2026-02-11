"use client"

import { useState, useMemo } from "react"
import { Calculator, Clock, DollarSign, Info } from "lucide-react"

// Points formula recalibrated from mainnet: ~0.00157 pts per $1 per day
const POINTS_PER_DOLLAR_PER_DAY = 0.00157

export function PointsCalculator() {
  const [depositAmount, setDepositAmount] = useState<number>(1000)
  const [holdDays, setHoldDays] = useState<number>(14)
  const [allocationType, setAllocationType] = useState<'dlp' | 'ua'>('dlp')

  const calculations = useMemo(() => {
    const allocationMultiplier = allocationType === 'dlp' ? 1.5 : 1
    const dailyPoints = depositAmount * POINTS_PER_DOLLAR_PER_DAY * allocationMultiplier
    const totalPoints = dailyPoints * holdDays

    let estimatedRank = 'Top 80%'
    if (depositAmount >= 1000000) estimatedRank = 'Top 1%'
    else if (depositAmount >= 500000) estimatedRank = 'Top 5%'
    else if (depositAmount >= 100000) estimatedRank = 'Top 10%'
    else if (depositAmount >= 10000) estimatedRank = 'Top 25%'
    else if (depositAmount >= 1000) estimatedRank = 'Top 50%'

    return { dailyPoints, totalPoints, estimatedRank, allocationMultiplier }
  }, [depositAmount, holdDays, allocationType])

  const formatPoints = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`
    if (num >= 1) return num.toFixed(2)
    if (num >= 0.01) return num.toFixed(4)
    return num.toFixed(6)
  }

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`
    return num.toFixed(0)
  }

  return (
    <div className="bg-black/40 border border-white/10 px-3 py-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[11px] sm:text-xs font-mono font-bold text-white uppercase tracking-wider">Points Calculator</span>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {/* Deposit Amount */}
        <div>
          <label className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">
            Deposit Amount
          </label>
          <div className="relative">
            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(Math.max(50, Number(e.target.value)))}
              min={50}
              max={1000000}
              className="w-full pl-7 pr-2 py-1.5 bg-black/40 border border-white/10 text-white text-xs font-mono focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-1 mt-1">
            {[1000, 5000, 10000, 50000].map((amount) => (
              <button
                key={amount}
                onClick={() => setDepositAmount(amount)}
                className={`flex-1 py-1 text-[9px] font-mono border transition-colors ${
                  depositAmount === amount
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'text-zinc-500 border-white/10 hover:border-white/20'
                }`}
              >
                ${formatNumber(amount)}
              </button>
            ))}
          </div>
        </div>

        {/* Hold Duration */}
        <div>
          <label className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">
            Hold Duration
          </label>
          <div className="relative">
            <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
            <input
              type="number"
              value={holdDays}
              onChange={(e) => setHoldDays(Math.max(1, Math.min(365, Number(e.target.value))))}
              min={1}
              max={365}
              className="w-full pl-7 pr-2 py-1.5 bg-black/40 border border-white/10 text-white text-xs font-mono focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-1 mt-1">
            {[7, 14, 30, 60].map((days) => (
              <button
                key={days}
                onClick={() => setHoldDays(days)}
                className={`flex-1 py-1 text-[9px] font-mono border transition-colors ${
                  holdDays === days
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'text-zinc-500 border-white/10 hover:border-white/20'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {/* Allocation Type */}
        <div>
          <label className="text-[9px] sm:text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1 block">
            Allocation
          </label>
          <div className="flex gap-1.5">
            <button
              onClick={() => setAllocationType('dlp')}
              className={`flex-1 py-1.5 text-[10px] sm:text-xs font-mono uppercase border transition-colors ${
                allocationType === 'dlp'
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-zinc-500 border-white/10 hover:border-white/20'
              }`}
            >
              DLP 1.5x
            </button>
            <button
              onClick={() => setAllocationType('ua')}
              className={`flex-1 py-1.5 text-[10px] sm:text-xs font-mono uppercase border transition-colors ${
                allocationType === 'ua'
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'text-zinc-500 border-white/10 hover:border-white/20'
              }`}
            >
              UA 1x
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Daily</div>
          <div className="text-base sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">{formatPoints(calculations.dailyPoints)}</div>
        </div>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">{holdDays}d Total</div>
          <div className="text-base sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">{formatPoints(calculations.totalPoints)}</div>
        </div>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Multiplier</div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">{calculations.allocationMultiplier}x</div>
        </div>
        <div className="bg-black/40 border border-white/10 px-2 py-2">
          <div className="text-[9px] font-mono uppercase text-zinc-500 mb-0.5">Est. Rank</div>
          <div className="text-base sm:text-lg font-mono font-bold text-zinc-400 tabular-nums leading-tight">{calculations.estimatedRank}</div>
        </div>
      </div>

      {/* Info */}
      <div className="mt-2 flex items-start gap-1.5">
        <Info className="w-3 h-3 text-zinc-600 mt-0.5 shrink-0" />
        <p className="text-[9px] sm:text-[10px] font-mono text-zinc-600 leading-relaxed">
          Rate from observed mainnet data. DLP earns 1.5x. Actual formula may vary.
        </p>
      </div>
    </div>
  )
}
