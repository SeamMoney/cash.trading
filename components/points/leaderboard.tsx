"use client"

import { useEffect, useState, useCallback } from "react"
import { Trophy, Medal, Award, Search, RefreshCw, Loader2, ExternalLink } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

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
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [userRank, setUserRank] = useState<LeaderboardEntry | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/predeposit/leaderboard?limit=100')
      const data = await res.json()
      setEntries(data.entries || [])

      // Find user's position
      if (account?.address) {
        const userEntry = data.entries?.find(
          (e: LeaderboardEntry) => e.account.toLowerCase() === account.address.toString().toLowerCase()
        )
        setUserRank(userEntry || null)
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }, [account?.address])

  useEffect(() => {
    fetchLeaderboard()
    const interval = setInterval(fetchLeaderboard, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [fetchLeaderboard])

  const formatNumber = (num: number | string, decimals = 2) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(decimals)}`
  }

  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-5 h-5 text-yellow-400" />
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />
      case 3:
        return <Award className="w-5 h-5 text-amber-600" />
      default:
        return <span className="w-5 h-5 text-center font-mono text-zinc-500">#{rank}</span>
    }
  }

  const filteredEntries = searchQuery
    ? entries.filter((e) =>
        e.account.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries

  return (
    <div className="space-y-4 animate-in fade-in zoom-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
          Season 0 Leaderboard
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-primary/50 focus:outline-none w-48"
            />
          </div>
          <button
            onClick={fetchLeaderboard}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-black/40 border border-white/10 hover:border-primary/50 transition-colors text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-primary disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Your Rank Card */}
      {userRank && (
        <div className="bg-primary/10 border border-primary/30 p-4 relative">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-3xl font-mono font-bold text-primary">
                #{userRank.rank}
              </div>
              <div>
                <div className="text-xs font-mono text-zinc-500 uppercase">Your Rank</div>
                <div className="text-lg font-mono font-bold text-white">
                  {userRank.points.toLocaleString()} pts
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-mono text-zinc-500 uppercase">Total Deposited</div>
              <div className="text-lg font-mono font-bold text-blue-500">
                {formatNumber(userRank.total_deposited)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                  Rank
                </th>
                <th className="text-left p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                  Address
                </th>
                <th className="text-right p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                  Points
                </th>
                <th className="text-right p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500 hidden md:table-cell">
                  DLP
                </th>
                <th className="text-right p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500 hidden md:table-cell">
                  UA
                </th>
                <th className="text-right p-4 text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-zinc-500 font-mono text-sm">
                    {searchQuery ? 'No results found' : 'Leaderboard data not available yet'}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isCurrentUser =
                    account?.address &&
                    entry.account.toLowerCase() === account.address.toString().toLowerCase()

                  return (
                    <tr
                      key={entry.account}
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                        isCurrentUser ? 'bg-primary/10' : ''
                      }`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getRankIcon(entry.rank)}
                        </div>
                      </td>
                      <td className="p-4">
                        <a
                          href={`https://explorer.aptoslabs.com/account/${entry.account}?network=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm font-mono text-zinc-300 hover:text-primary transition-colors"
                        >
                          {shortenAddress(entry.account)}
                          <ExternalLink className="w-3 h-3" />
                          {isCurrentUser && (
                            <span className="text-[10px] font-mono uppercase bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                              You
                            </span>
                          )}
                        </a>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono font-bold text-purple-500">
                          {entry.points.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-4 text-right hidden md:table-cell">
                        <span className="font-mono text-blue-500">
                          {formatNumber(entry.dlp_balance)}
                        </span>
                      </td>
                      <td className="p-4 text-right hidden md:table-cell">
                        <span className="font-mono text-orange-500">
                          {formatNumber(entry.ua_balance)}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono font-bold text-white">
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
