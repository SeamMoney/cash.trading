"use client"

import { Trophy, TrendingUp, Users, Wallet, RefreshCw, Loader2 } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { usePointsData } from "@/contexts/points-data-context"
import { ShareCard } from "./share-card"

export function PointsStats() {
  const { connected } = useWallet()
  const { globalStats, userData, vaultUserData, loading, refresh } = usePointsData()

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (isNaN(n)) return '—'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    return `$${n.toFixed(2)}`
  }
  const formatAmps = (num: number) =>
    num < 1
      ? num.toFixed(4)
      : num.toLocaleString(undefined, { maximumFractionDigits: 2 })

  const isLive = globalStats?.status === 'live'
  const dlpFillPct = globalStats?.dlp_cap
    ? Math.min(100, ((globalStats.total_dlp || 0) / globalStats.dlp_cap) * 100)
    : 0

  // While the first load is in flight, show a pulse instead of hard zeros —
  // "$0.00 deposited / 0 depositors" reads as a dead product to a first-time
  // visitor when the real figures just haven't arrived yet.
  const statSkeleton = (
    <span
      aria-hidden
      className="my-0.5 inline-block h-4 w-16 animate-pulse rounded-sm bg-zinc-800"
    />
  )
  const globalStat = (render: () => React.ReactNode) =>
    globalStats ? render() : statSkeleton

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] sm:text-xs font-mono text-zinc-500 uppercase tracking-widest whitespace-nowrap">
            AMPs
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-primary whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              Live
            </span>
          )}
          <span className="text-[10px] font-mono text-zinc-600 hidden sm:inline">Season 1</span>
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
            TVL
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {globalStat(() => formatNumber(globalStats!.total_deposited || 0))}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 shrink-0 hidden sm:block" />
            DLP
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {globalStat(() => formatNumber(globalStats!.total_dlp || 0))}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <Trophy className="w-3 h-3 shrink-0 hidden sm:block" />
            AMPs
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-primary tabular-nums leading-tight">
            {globalStat(() =>
              (globalStats!.total_points || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
            )}
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 px-2.5 py-2">
          <div className="text-zinc-500 text-[9px] sm:text-[10px] font-mono uppercase mb-0.5 flex items-center gap-1">
            <Users className="w-3 h-3 shrink-0 hidden sm:block" />
            Users
          </div>
          <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
            {globalStat(() => (globalStats!.depositor_count || 0).toLocaleString())}
          </div>
        </div>
      </div>

      {/* Your Stats */}
      {connected ? (
        <div className="bg-black/40 border border-white/10 px-3 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Your Stats</span>
            {userData && (
              <ShareCard
                points={userData.points}
                rank={userData.rank ?? undefined}
                totalDeposited={vaultUserData?.totalDeposited?.toString() ?? userData.total_deposited}
                dlpBalance={vaultUserData?.currentValue?.toString() ?? userData.dlp_balance}
              />
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Total AMPs</div>
              <div className="text-xl sm:text-2xl font-mono font-bold text-primary tabular-nums leading-tight">
                {userData ? formatAmps(userData.points) : '—'}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Rank</div>
              <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
                {userData?.rank ? `#${userData.rank.toLocaleString()}` : '—'}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">Realized P&amp;L</div>
              <div className={`text-base sm:text-lg font-mono font-bold tabular-nums leading-tight ${(userData?.realized_pnl ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                {userData ? formatNumber(userData.realized_pnl ?? 0) : '—'}
              </div>
            </div>

            <div>
              <div className="text-[9px] sm:text-[10px] font-mono text-zinc-500 uppercase">
                {vaultUserData ? 'Vault Value' : 'Vault Contributed'}
              </div>
              <div className="text-base sm:text-lg font-mono font-bold text-white tabular-nums leading-tight">
                {vaultUserData
                  ? formatNumber(vaultUserData.currentValue)
                  : userData
                    ? formatNumber(userData.dlp_balance)
                    : '—'}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-px border border-white/5 bg-white/5 sm:grid-cols-5">
            {userData
              ? [
                  ['Trading', userData.trading_points ?? 0],
                  ['Streak', userData.streak_points ?? 0],
                  ['Vault', userData.vault_points ?? 0],
                  ['Referral', userData.referral_points ?? 0],
                  ['Bonus', userData.bonus_points ?? 0],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-center justify-between bg-black/70 px-2.5 py-2 sm:block">
                    <div className="text-[9px] font-mono uppercase text-zinc-600">{label}</div>
                    <div className="font-mono text-[11px] tabular-nums text-zinc-300 sm:mt-1">
                      {formatAmps(value as number)}
                    </div>
                  </div>
                ))
              : null}
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
