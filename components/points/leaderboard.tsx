"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, Medal, Award, Search, RefreshCw, Loader2, ExternalLink } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useMockData } from "@/contexts/mock-data-context"
import { MOCK_LEADERBOARD, MOCK_POINTS_DATA } from "@/lib/mock-data"

interface LeaderboardEntry {
  rank: number
  account: string
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
}

export function Leaderboard() {
  const { account } = useWallet()
  const { isMockMode } = useMockData()
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    if (isMockMode) {
      setEntries(MOCK_LEADERBOARD)
      // Set user as rank 12 in mock mode
      setUserRank(MOCK_LEADERBOARD.find(e => e.rank === 12) || null)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/predeposit/leaderboard?limit=100')
      const data = await res.json()
      setEntries(data.entries || [])

      if (account?.address) {
        const userEntry = data.entries?.find(
          (e: LeaderboardEntry) => e.account?.toLowerCase() === account.address.toString().toLowerCase()
        )
        setUserRank(userEntry || null)
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }, [account?.address, isMockMode])

  useEffect(() => {
    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60000)
    return () => clearInterval(interval)
  }, [fetchLeaderboard])

  // Refresh when mock mode changes
  useEffect(() => {
    fetchLeaderboard()
  }, [isMockMode])

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
        return <Trophy className="size-5 text-yellow-400" />
      case 2:
        return <Medal className="size-5 text-gray-300" />
      case 3:
        return <Award className="size-5 text-amber-600" />
      default:
        return <span className="size-5 flex items-center justify-center font-mono text-zinc-500 tabular-nums">#{rank}</span>
    }
  }

  const filteredEntries = searchQuery
    ? entries.filter((e) =>
        e.account?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-mono text-zinc-500 uppercase">
          Season 0 Leaderboard
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-black/40 border border-white/10 text-white text-xs font-mono focus:border-primary/50 focus:outline-none w-32 sm:w-40"
            />
          </div>
          <button
            onClick={fetchLeaderboard}
            disabled={loading}
            className="p-1.5 bg-black/40 border border-white/10 hover:border-primary/50 text-zinc-400 hover:text-primary disabled:opacity-50"
            aria-label="Refresh leaderboard"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Your Rank Card */}
      {userRank && (
        <div className="bg-primary/10 border border-primary/30 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-mono font-bold text-primary tabular-nums">
                #{userRank.rank}
              </div>
              <div>
                <div className="text-[10px] font-mono text-zinc-500 uppercase">Your Rank</div>
                <div className="text-sm font-mono font-bold text-white tabular-nums">
                  {(userRank.points ?? 0).toLocaleString()} pts
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono text-zinc-500 uppercase">Deposited</div>
              <div className="text-sm font-mono font-bold text-blue-500 tabular-nums">
                {formatNumber(userRank.total_deposited)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="bg-black/40 border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left p-2.5 text-[10px] font-mono uppercase text-zinc-500">
                  Rank
                </th>
                <th className="text-left p-2.5 text-[10px] font-mono uppercase text-zinc-500">
                  Address
                </th>
                <th className="text-right p-2.5 text-[10px] font-mono uppercase text-zinc-500">
                  Points
                </th>
                <th className="text-right p-2.5 text-[10px] font-mono uppercase text-zinc-500">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8">
                    <Loader2 className="size-5 animate-spin mx-auto text-primary" />
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-zinc-500 font-mono text-sm text-pretty">
                    {searchQuery ? 'No results found' : 'Leaderboard data not available yet'}
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
                      className={`border-b border-white/5 ${
                        isCurrentUser ? 'bg-primary/10' : ''
                      }`}
                    >
                      <td className="p-2.5">
                        {getRankIcon(entry.rank)}
                      </td>
                      <td className="p-2.5">
                        <a
                          href={`https://explorer.aptoslabs.com/account/${entry.account}?network=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-mono text-zinc-300 hover:text-primary"
                        >
                          <span className="truncate max-w-[80px] sm:max-w-none">
                            {shortenAddress(entry.account)}
                          </span>
                          <ExternalLink className="size-3 shrink-0" />
                          {isCurrentUser && (
                            <span className="text-[9px] font-mono uppercase bg-primary/20 text-primary px-1 py-0.5 shrink-0">
                              You
                            </span>
                          )}
                        </a>
                      </td>
                      <td className="p-2.5 text-right">
                        <span className="font-mono font-bold text-purple-500 tabular-nums text-sm">
                          {((entry.points ?? 0)).toLocaleString()}
                        </span>
                      </td>
                      <td className="p-2.5 text-right">
                        <span className="font-mono font-bold text-white tabular-nums text-sm">
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
