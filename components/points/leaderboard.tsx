"use client"

import { useState } from "react"
import { Trophy, Medal, Award, Search, RefreshCw, Loader2, ExternalLink } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { usePointsData } from "@/contexts/points-data-context"

export function Leaderboard() {
  const { account } = useWallet()
  const { leaderboardEntries, userRank, leaderboardLoading, refresh } = usePointsData()
  const [searchQuery, setSearchQuery] = useState('')

  const formatNumber = (num: number | string | undefined) => {
    if (num === undefined || num === null) return '$0'
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (isNaN(n)) return '$0'
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
    return `$${n.toFixed(0)}`
  }

  const shortenAddress = (addr: string) => {
    if (!addr) return '...'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="size-4 text-primary" />
      case 2:
        return <Medal className="size-4 text-zinc-400" />
      case 3:
        return <Award className="size-4 text-zinc-500" />
      default:
        return <span className="text-xs font-mono text-zinc-500 tabular-nums">#{rank}</span>
    }
  }

  const filteredEntries = searchQuery
    ? leaderboardEntries.filter((e) =>
        e.account?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : leaderboardEntries

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-zinc-500" />
          <input
            type="text"
            placeholder="Search address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 bg-black/40 border border-white/10 text-white text-[11px] font-mono focus:border-primary/50 focus:outline-none"
          />
        </div>
        <button
          onClick={refresh}
          disabled={leaderboardLoading}
          className="p-1.5 bg-black/40 border border-white/10 hover:border-primary/50 text-zinc-400 hover:text-primary disabled:opacity-50 shrink-0"
          aria-label="Refresh"
        >
          {leaderboardLoading ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        </button>
      </div>

      {/* Your Rank */}
      {userRank && (
        <div className="bg-primary/5 border border-primary/20 px-2.5 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg sm:text-xl font-mono font-bold text-primary tabular-nums shrink-0">
              #{userRank.rank}
            </span>
            <div className="min-w-0">
              <div className="text-[9px] font-mono text-zinc-500 uppercase">You</div>
              <div className="text-xs font-mono font-bold text-white tabular-nums">
                {(userRank.points ?? 0) < 1
                  ? (userRank.points ?? 0).toFixed(4)
                  : (userRank.points ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} pts
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] font-mono text-zinc-500 uppercase">Deposited</div>
            <div className="text-xs font-mono font-bold text-white tabular-nums">
              {formatNumber(userRank.total_deposited)}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-black/40 border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-2 py-2 text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500 w-10">#</th>
                <th className="text-left px-2 py-2 text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Address</th>
                <th className="text-right px-2 py-2 text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Pts</th>
                <th className="text-right px-2 py-2 text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardLoading && leaderboardEntries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-6">
                    <Loader2 className="size-4 animate-spin mx-auto text-primary" />
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-zinc-500 font-mono text-xs">
                    {searchQuery ? 'No results' : 'No data yet'}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isCurrentUser =
                    account?.address &&
                    entry.account?.toLowerCase() === account.address.toString().toLowerCase()

                  return (
                    <tr
                      key={entry.account}
                      className={`border-b border-white/5 ${isCurrentUser ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-2 py-1.5">
                        {getRankIcon(entry.rank)}
                      </td>
                      <td className="px-2 py-1.5">
                        <a
                          href={`https://explorer.aptoslabs.com/account/${entry.account}?network=mainnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-primary"
                        >
                          <span className="truncate max-w-[72px] sm:max-w-none">
                            {shortenAddress(entry.account)}
                          </span>
                          <ExternalLink className="size-3 shrink-0 text-zinc-500" />
                          {isCurrentUser && (
                            <span className="text-[8px] font-mono uppercase bg-primary/10 text-primary px-1 py-px shrink-0">
                              You
                            </span>
                          )}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="font-mono font-bold text-primary tabular-nums text-[11px] sm:text-xs">
                          {(entry.points ?? 0) < 1
                            ? (entry.points ?? 0).toFixed(4)
                            : (entry.points ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="font-mono font-bold text-white tabular-nums text-[11px] sm:text-xs">
                          {formatNumber(entry.total_deposited)}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
