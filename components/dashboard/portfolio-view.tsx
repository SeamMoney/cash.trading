"use client"

import { useEffect, useState, useCallback } from "react"
import { TrendingDown, TrendingUp, RefreshCw, Loader2 } from "lucide-react"
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, BarChart, Bar } from "recharts"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"

interface PortfolioData {
  balance: {
    usdc: number
    accountAddress: string
  }
  stats: {
    totalVolume: number
    totalPnl: number
    totalTrades: number
    winRate: number
    avgTradeSize: number
    bestTrade: number
    worstTrade: number
  }
  dailyStats: Array<{
    date: string
    volume: number
    pnl: number
    trades: number
  }>
  botStatus: {
    isRunning: boolean
    currentSession: string | null
    market: string
    strategy: string
    bias: string
  } | null
}

export function PortfolioView() {
  const { account, connected } = useWallet()
  const { subaccount, balance: walletBalance, loading: walletLoading } = useWalletBalance()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch portfolio data - use useCallback to ensure stable reference
  const fetchPortfolio = useCallback(async () => {
    if (!account?.address) return

    console.log('📊 Fetching portfolio for subaccount:', subaccount?.slice(0, 20) + '...')
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        userWalletAddress: account.address.toString(),
      })
      if (subaccount) {
        params.set('userSubaccount', subaccount)
      }

      const res = await fetch(`/api/portfolio?${params}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch portfolio')
      }

      console.log('📊 Portfolio data received for:', data.balance?.accountAddress?.slice(0, 20) + '...')
      setPortfolio(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch portfolio')
    } finally {
      setLoading(false)
    }
  }, [account?.address, subaccount])

  useEffect(() => {
    fetchPortfolio()
  }, [fetchPortfolio])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchPortfolio, 30000)
    return () => clearInterval(interval)
  }, [fetchPortfolio])

  const stats = portfolio?.stats
  // Use wallet hook's balance for consistency with the balance button
  const balance = walletBalance ?? portfolio?.balance?.usdc ?? 0
  const dailyStats = portfolio?.dailyStats || []
  const pnlIsPositive = (stats?.totalPnl || 0) >= 0

  // Prepare chart data - show cumulative PNL over time
  const chartData = dailyStats.map((day, index) => {
    const cumulativePnl = dailyStats.slice(0, index + 1).reduce((sum, d) => sum + d.pnl, 0)
    return {
      time: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: balance + cumulativePnl,
      pnl: day.pnl,
      volume: day.volume,
    }
  })

  // If no daily stats, show current balance as single point
  const balanceData = chartData.length > 0 ? chartData : [
    { time: 'Today', value: balance, pnl: 0, volume: 0 }
  ]

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
          Portfolio Overview
        </div>
        <button
          onClick={fetchPortfolio}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border border-white/10 hover:border-primary/50 transition-colors text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-primary disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 text-red-400 text-sm font-mono">
          {error}
        </div>
      )}

      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Balance */}
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-primary/50 transition-colors">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20 group-hover:border-primary transition-colors" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/20 group-hover:border-primary transition-colors" />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2 flex items-center justify-between">
            <span>USDC Balance</span>
            <div className="w-1 h-1 bg-primary rounded-full animate-pulse" />
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-mono font-bold text-white tracking-tighter">
              {(loading || walletLoading) ? '...' : balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-zinc-600 text-sm font-mono">USDC</span>
          </div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Available Balance
          </div>
        </div>

        {/* Total PNL */}
        <div className={`bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-${pnlIsPositive ? 'green' : 'red'}-500/50 transition-colors`}>
          <div className={`absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/20 group-hover:border-${pnlIsPositive ? 'green' : 'red'}-500 transition-colors`} />
          <div className={`absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/20 group-hover:border-${pnlIsPositive ? 'green' : 'red'}-500 transition-colors`} />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2">Total PnL</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={`text-4xl font-mono font-bold tracking-tighter ${pnlIsPositive ? 'text-green-500' : 'text-red-500'}`}>
              {pnlIsPositive ? '+' : ''}{(stats?.totalPnl || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-zinc-600 text-sm font-mono">USDC</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider">
            <span className={`flex items-center gap-1 ${pnlIsPositive ? 'text-green-500' : 'text-red-500'}`}>
              {pnlIsPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              Win Rate: {(stats?.winRate || 0).toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Total Volume */}
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative group hover:border-blue-500/50 transition-colors">
          <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-white/10 group-hover:border-blue-500/50 transition-colors" />

          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-2">Total Volume</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-4xl font-mono font-bold text-blue-500 tracking-tighter">
              {(stats?.totalVolume || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            <span className="text-zinc-600 text-sm font-mono">USDC</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            <span className="text-blue-500 font-bold">{stats?.totalTrades || 0} Trades</span>
            <span className="text-zinc-500">Avg: ${(stats?.avgTradeSize || 0).toFixed(0)}</span>
          </div>
        </div>
      </div>

      {/* Main Chart - Balance History */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative shadow-[0_0_30px_-10px_rgba(0,0,0,0.5)]">
        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-white/10 to-transparent" />
        <div className="absolute top-6 left-6 z-10">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-1">
            Balance History
          </div>
          <div className="text-white text-xl font-mono font-bold tracking-tight">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="h-[300px] w-full mt-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={balanceData}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffff00" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ffff00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#000000cc",
                  borderColor: "#333",
                  backdropFilter: "blur(4px)",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  textTransform: "uppercase",
                }}
                itemStyle={{ color: "#ffff00" }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Balance']}
              />
              <XAxis
                dataKey="time"
                stroke="#52525b"
                tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <Area
                type="stepAfter"
                dataKey="value"
                stroke="#ffff00"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorBalance)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Secondary Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily Volume */}
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-6">
            Daily Volume
          </div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyStats.slice(-14)}>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#000000cc",
                    borderColor: "#333",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(0)}`, 'Volume']}
                />
                <XAxis
                  dataKey="date"
                  stroke="#52525b"
                  tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { day: 'numeric' })}
                />
                <Bar dataKey="volume" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily PNL */}
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
          <div className="text-muted-foreground text-xs font-mono uppercase tracking-widest mb-6">Daily PnL</div>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats.slice(-14)}>
                <defs>
                  <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#000000cc",
                    borderColor: "#333",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'PnL']}
                />
                <XAxis
                  dataKey="date"
                  stroke="#52525b"
                  tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { day: 'numeric' })}
                />
                <Area type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2} fill="url(#colorPnl)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Best/Worst Trade Stats */}
      {stats && (stats.bestTrade !== 0 || stats.worstTrade !== 0) && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Best Trade</div>
            <div className={`text-2xl font-mono font-bold ${stats.bestTrade >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {stats.bestTrade >= 0 ? '+$' : '-$'}{Math.abs(stats.bestTrade).toFixed(2)}
            </div>
          </div>
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4">
            <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 mb-1">Worst Trade</div>
            <div className="text-2xl font-mono font-bold text-red-500">
              -${Math.abs(stats.worstTrade).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Connect Wallet prompt when not connected */}
      {!connected && (
        <div className="p-4 bg-primary/10 border border-primary/30 relative text-center">
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary" />
          <p className="text-primary font-mono font-bold">Connect wallet to see your stats</p>
        </div>
      )}
    </div>
  )
}
