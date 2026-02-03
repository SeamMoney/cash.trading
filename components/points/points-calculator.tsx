"use client"

import { useState, useMemo } from "react"
import { Calculator, Clock, DollarSign, Trophy, TrendingUp, Info } from "lucide-react"

// Points formula based on Decibel predeposit docs:
// Points = deposit_amount * time_weighted_factor * boost_multiplier
// Time-weighted means earlier deposits earn more

export function PointsCalculator() {
  const [depositAmount, setDepositAmount] = useState<number>(1000)
  const [depositDate, setDepositDate] = useState<Date>(new Date('2026-02-07'))
  const [allocationType, setAllocationType] = useState<'dlp' | 'ua'>('dlp')

  // Season 0 dates
  const seasonStart = new Date('2026-02-07')
  const seasonEnd = new Date('2026-04-07') // Assuming 2 month season
  const today = new Date()

  const calculations = useMemo(() => {
    const daysFromStart = Math.max(0, Math.floor((depositDate.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24)))
    const totalSeasonDays = Math.floor((seasonEnd.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24))
    const daysRemaining = Math.max(0, totalSeasonDays - daysFromStart)

    // Early depositor bonus: deposits in first week get 2x, first month 1.5x, after 1x
    let earlyBonus = 1
    if (daysFromStart <= 7) {
      earlyBonus = 2
    } else if (daysFromStart <= 30) {
      earlyBonus = 1.5
    }

    // DLP gets higher points rate than UA (DLP is committed capital)
    const allocationMultiplier = allocationType === 'dlp' ? 1.5 : 1

    // Base points per day per $1 = 10 (estimated based on typical DeFi points programs)
    const basePointsPerDay = 10
    const dailyPoints = depositAmount * basePointsPerDay * earlyBonus * allocationMultiplier
    const totalPoints = dailyPoints * daysRemaining

    // Estimate rank based on deposit amount (rough estimate)
    let estimatedRank = 'Top 50%'
    if (depositAmount >= 100000) {
      estimatedRank = 'Top 1%'
    } else if (depositAmount >= 50000) {
      estimatedRank = 'Top 5%'
    } else if (depositAmount >= 10000) {
      estimatedRank = 'Top 10%'
    } else if (depositAmount >= 5000) {
      estimatedRank = 'Top 25%'
    }

    return {
      daysFromStart,
      daysRemaining,
      earlyBonus,
      dailyPoints,
      totalPoints,
      estimatedRank,
      allocationMultiplier,
    }
  }, [depositAmount, depositDate, allocationType])

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
    if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`
    return num.toFixed(0)
  }

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative animate-in fade-in duration-500">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-primary/10 border border-primary/30">
          <Calculator className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">Points Calculator</h3>
          <p className="text-[10px] font-mono text-zinc-500">Estimate your Season 0 points earnings</p>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Deposit Amount */}
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
            Deposit Amount
          </label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(Math.max(50, Number(e.target.value)))}
              min={50}
              max={1000000}
              className="w-full pl-10 pr-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-2 mt-2">
            {[1000, 5000, 10000, 50000].map((amount) => (
              <button
                key={amount}
                onClick={() => setDepositAmount(amount)}
                className={`flex-1 px-2 py-1 text-[10px] font-mono border transition-colors ${
                  depositAmount === amount
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : 'text-zinc-500 border-white/10 hover:border-white/20'
                }`}
              >
                ${formatNumber(amount)}
              </button>
            ))}
          </div>
        </div>

        {/* Deposit Date */}
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
            Deposit Date
          </label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="date"
              value={depositDate.toISOString().split('T')[0]}
              onChange={(e) => setDepositDate(new Date(e.target.value))}
              min="2026-02-07"
              max="2026-04-07"
              className="w-full pl-10 pr-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-primary/50 focus:outline-none"
            />
          </div>
          <p className="text-[10px] font-mono text-zinc-600 mt-2">
            Day {calculations.daysFromStart + 1} of season
          </p>
        </div>

        {/* Allocation Type */}
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-2 block">
            Allocation
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setAllocationType('dlp')}
              className={`flex-1 px-4 py-2 text-xs font-mono uppercase tracking-wider border transition-colors ${
                allocationType === 'dlp'
                  ? 'bg-blue-500/20 text-blue-500 border-blue-500/30'
                  : 'text-zinc-500 border-white/10 hover:border-white/20'
              }`}
            >
              DLP (1.5x)
            </button>
            <button
              onClick={() => setAllocationType('ua')}
              className={`flex-1 px-4 py-2 text-xs font-mono uppercase tracking-wider border transition-colors ${
                allocationType === 'ua'
                  ? 'bg-orange-500/20 text-orange-500 border-orange-500/30'
                  : 'text-zinc-500 border-white/10 hover:border-white/20'
              }`}
            >
              UA (1x)
            </button>
          </div>
          <p className="text-[10px] font-mono text-zinc-600 mt-2">
            DLP earns more points
          </p>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-black/40 border border-white/10 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
            Daily Points
          </div>
          <div className="text-2xl font-mono font-bold text-purple-500">
            {formatNumber(calculations.dailyPoints)}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
            Total (Est.)
          </div>
          <div className="text-2xl font-mono font-bold text-primary">
            {formatNumber(calculations.totalPoints)}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
            Early Bonus
          </div>
          <div className={`text-2xl font-mono font-bold ${calculations.earlyBonus > 1 ? 'text-green-500' : 'text-zinc-400'}`}>
            {calculations.earlyBonus}x
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 p-4">
          <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">
            Est. Rank
          </div>
          <div className="text-2xl font-mono font-bold text-blue-500">
            {calculations.estimatedRank}
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="mt-4 p-3 bg-zinc-900/50 border border-white/5 flex items-start gap-2">
        <Info className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
        <p className="text-[10px] font-mono text-zinc-500 leading-relaxed">
          These are estimates based on typical DeFi points programs. Actual points formula may vary.
          Earlier deposits and DLP allocation earn more points. Min deposit: $50, Max: $1M per wallet.
        </p>
      </div>
    </div>
  )
}
