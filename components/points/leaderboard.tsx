"use client"

import { useState } from "react"
import { Trophy, Medal, Award, Search, RefreshCw, Loader2, ExternalLink } from "lucide-react"
import { usePointsData } from "@/contexts/points-data-context"
import { useDecibelWalletIdentity } from "@/hooks/useDecibelWalletIdentity"

export function Leaderboard({ onSelectAccount }: { onSelectAccount?: (account: string) => void }) {
  const { ownerAddress } = useDecibelWalletIdentity()
  const { leaderboardEntries, userRank, leaderboardLoading, refresh } = usePointsData()
  const [searchQuery, setSearchQuery] = useState('')

  const formatPoints = (num: number | undefined) =>
    (num || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })

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
            <div className="text-[9px] font-mono text-zinc-500 uppercase">Vault AMPs</div>
            <div className="text-xs font-mono font-bold text-white tabular-nums">
              {formatPoints(userRank.vault_points)}
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
                <th className="text-right px-2 py-2 text-[9px] sm:text-[10px] font-mono uppercase text-zinc-500">Vault</th>
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
                    ownerAddress &&
                    entry.account?.toLowerCase() === ownerAddress.toLowerCase()

                  return (
                    <tr
                      key={entry.account}
                      className={`border-b border-white/5 ${isCurrentUser ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-2 py-1.5">
                        {getRankIcon(entry.rank)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onSelectAccount?.(entry.account)}
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-primary"
                            aria-label={`Analyze ${entry.account}`}
                          >
                          <span className="truncate max-w-[72px] sm:max-w-none">
                            {shortenAddress(entry.account)}
                          </span>
                          {isCurrentUser && (
                            <span className="text-[8px] font-mono uppercase bg-primary/10 text-primary px-1 py-px shrink-0">
                              You
                            </span>
                          )}
                          </button>
                          <a
                            href={`https://explorer.aptoslabs.com/account/${entry.account}?network=mainnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${entry.account} in Aptos Explorer`}
                            className="text-zinc-600 hover:text-primary"
                          >
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        </div>
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
                          {formatPoints(entry.vault_points)}
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
