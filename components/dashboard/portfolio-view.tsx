"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { RefreshCw, Loader2, ArrowDownLeft, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { CurvedLineChart, DataPoint } from "@/components/charts/curved-line-chart"
import { GlassWalletCard } from "@/components/cards/glass-wallet-card"
import { useMockData } from "@/contexts/mock-data-context"
import { MOCK_PORTFOLIO_DATA } from "@/lib/mock-data"

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
  const { isMockMode } = useMockData()
  const { subaccount, balance: walletBalance, loading: walletLoading } = useWalletBalance()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPortfolio = useCallback(async () => {
    if (isMockMode) {
      setPortfolio(MOCK_PORTFOLIO_DATA)
      setError(null)
      return
    }

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
  }, [account?.address, subaccount, isMockMode])

  useEffect(() => {
    fetchPortfolio()
  }, [fetchPortfolio])

  useEffect(() => {
    const interval = setInterval(fetchPortfolio, 30000)
    return () => clearInterval(interval)
  }, [fetchPortfolio])

  // Refresh when mock mode changes
  useEffect(() => {
    fetchPortfolio()
  }, [isMockMode])

  const stats = portfolio?.stats
  const balance = isMockMode ? MOCK_PORTFOLIO_DATA.balance.usdc : (walletBalance ?? portfolio?.balance?.usdc ?? 0)
  const dailyStats = portfolio?.dailyStats || []

  // Prepare balance history chart data
  const balanceChartData = useMemo((): DataPoint[] => {
    // Use mock balance history in mock mode
    if (isMockMode && MOCK_PORTFOLIO_DATA.balanceHistory) {
      return MOCK_PORTFOLIO_DATA.balanceHistory
    }

    if (dailyStats.length === 0) {
      return [{ date: new Date(), value: balance }]
    }
    return dailyStats.map((day, index) => {
      const cumulativePnl = dailyStats.slice(0, index + 1).reduce((sum, d) => sum + d.pnl, 0)
      return {
        date: new Date(day.date),
        value: balance + cumulativePnl,
      }
    })
  }, [dailyStats, balance, isMockMode])

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Portfolio Overview
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPortfolio}
          disabled={loading}
          className="h-8 border-white/10 bg-black/40 text-xs text-zinc-400 hover:text-white hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-3 w-3" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Glass Wallet Card - Keep rounded styling */}
      <GlassWalletCard
        balance={balance}
        currency="USDC"
        address={subaccount || account?.address?.toString()}
        totalPnl={stats?.totalPnl || 0}
        winRate={stats?.winRate || 0}
        totalVolume={stats?.totalVolume || 0}
        totalTrades={stats?.totalTrades || 0}
        loading={loading || walletLoading}
      />

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          size="lg"
          onClick={() => window.open('https://app.decibel.trade/predeposit', '_blank')}
          className="flex-1 h-12 bg-primary text-primary-foreground font-bold text-sm uppercase tracking-wider hover:bg-primary/90"
        >
          <ArrowDownLeft className="mr-2 h-4 w-4" />
          Deposit
        </Button>
        <Button
          size="lg"
          variant="outline"
          onClick={() => window.open('https://app.decibel.trade/withdraw', '_blank')}
          className="flex-1 h-12 border-white/10 bg-black/40 text-white font-bold text-sm uppercase tracking-wider hover:bg-white/5"
        >
          <ArrowUpRight className="mr-2 h-4 w-4" />
          Withdraw
        </Button>
      </div>

      {/* Balance History Chart */}
      <div className="bg-black/40 border border-white/10 overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">
            Balance History
          </span>
          <div className="text-2xl font-bold text-white tabular-nums">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <CurvedLineChart
          data={balanceChartData}
          height={280}
          showGrid={true}
          showAxis={true}
          showArea={true}
          showTooltip={true}
          animationDuration={1500}
        />
      </div>

      {/* Best/Worst Trade Stats */}
      {stats && (stats.bestTrade !== 0 || stats.worstTrade !== 0) && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/40 border border-white/10 p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Best Trade</div>
            <div className={`text-2xl font-bold tabular-nums ${stats.bestTrade >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.bestTrade >= 0 ? '+$' : '-$'}{Math.abs(stats.bestTrade).toFixed(2)}
            </div>
          </div>
          <div className="bg-black/40 border border-white/10 p-4">
            <div className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Worst Trade</div>
            <div className="text-2xl font-bold text-red-400 tabular-nums">
              -${Math.abs(stats.worstTrade).toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Connect Wallet prompt */}
      {!connected && !isMockMode && (
        <div className="border border-dashed border-primary/30 bg-primary/5 p-6 text-center">
          <p className="text-sm text-primary font-bold">Connect wallet to see your stats</p>
        </div>
      )}
    </div>
  )
}
