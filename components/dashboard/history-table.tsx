"use client"

import { useEffect, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowUp, ArrowDown, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

interface Trade {
  id: string
  timestamp: string
  txHash: string
  direction: string
  strategy: string
  size: number
  volumeGenerated: number
  success: boolean
  entryPrice: number | null
  exitPrice: number | null
  pnl: number
  positionHeldMs: number
  market?: string
  leverage?: number
  source?: 'bot' | 'manual'
}

export function HistoryTable() {
  const { account, connected } = useWallet()
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'history' | 'positions'>('history')

  const fetchTrades = async () => {
    if (!account?.address) return

    setLoading(true)
    try {
      const res = await fetch(`/api/portfolio?userWalletAddress=${account.address}`)
      const data = await res.json()

      if (data.recentTrades) {
        setTrades(data.recentTrades)
      }
    } catch (err) {
      console.error('Error fetching trades:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTrades()
  }, [account?.address])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchTrades, 30000)
    return () => clearInterval(interval)
  }, [account?.address])

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (ms: number) => {
    if (ms === 0) return '-'
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }

  const truncateTxHash = (hash: string) => {
    if (!hash || hash === 'waiting') return '-'
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="text-zinc-500 font-mono text-sm uppercase tracking-widest">
          Connect wallet to view trades
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-8">
          <div
            className="relative group cursor-pointer"
            onClick={() => setActiveTab('history')}
          >
            <h2 className={cn(
              "text-lg font-bold font-mono uppercase tracking-widest pb-2 transition-colors",
              activeTab === 'history' ? "text-primary" : "text-zinc-600 hover:text-white"
            )}>
              Trade History
            </h2>
            {activeTab === 'history' && (
              <div className="absolute bottom-[-9px] left-0 w-full h-0.5 bg-primary shadow-[0_0_10px_rgba(255,246,0,0.8)]" />
            )}
          </div>
        </div>

        <button
          onClick={fetchTrades}
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

      {/* Table - Desktop */}
      <div className="hidden md:block border-y border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-white/5 border-none">
            <TableRow className="border-none hover:bg-transparent">
              {["Time", "Market", "Direction", "Leverage", "Volume", "Entry", "Exit", "PnL", "Tx"].map(
                (head, i) => (
                  <TableHead
                    key={head}
                    className={cn(
                      "text-zinc-500 font-mono font-bold text-[10px] uppercase tracking-widest h-10",
                      i === 0 && "pl-6",
                      i === 8 && "text-right pr-6",
                    )}
                  >
                    {head}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && trades.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-zinc-500" />
                </TableCell>
              </TableRow>
            ) : trades.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-zinc-500 font-mono text-sm">
                  No trades yet. Start the bot to generate volume!
                </TableCell>
              </TableRow>
            ) : (
              trades.map((trade) => (
                <TableRow
                  key={trade.id}
                  className="border-b border-white/5 hover:bg-white/5 transition-colors group"
                >
                  <TableCell className="pl-6 font-mono text-xs text-zinc-400">
                    {formatTime(trade.timestamp)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white">
                    {trade.market || 'Unknown'}
                  </TableCell>
                  <TableCell className="font-mono">
                    <div className="flex items-center gap-2">
                      {trade.direction === 'long' ? (
                        <ArrowUp className="w-4 h-4 text-green-500" />
                      ) : (
                        <ArrowDown className="w-4 h-4 text-red-500" />
                      )}
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        trade.direction === 'long' ? 'text-green-500' : 'text-red-500'
                      )}>
                        {trade.direction}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-primary font-bold">
                    {trade.leverage ? `${trade.leverage}x` : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white">
                    ${trade.volumeGenerated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-400">
                    {trade.entryPrice ? `$${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-400">
                    {trade.exitPrice ? `$${trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                  </TableCell>
                  <TableCell className={cn(
                    "font-mono text-xs font-bold",
                    trade.pnl > 0 ? 'text-green-500' : trade.pnl < 0 ? 'text-red-500' : 'text-zinc-500'
                  )}>
                    {trade.pnl !== 0 ? (
                      <>
                        {trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                      </>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    {trade.txHash && trade.txHash !== 'waiting' ? (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${trade.txHash}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-mono text-zinc-500 hover:text-primary transition-colors"
                      >
                        {truncateTxHash(trade.txHash)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs font-mono text-zinc-600">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-4">
        {loading && trades.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : trades.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 font-mono text-sm">
            No trades yet
          </div>
        ) : (
          trades.slice(0, 10).map((trade) => (
            <div
              key={trade.id}
              className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 space-y-3 relative"
            >
              <div className={cn(
                "absolute top-0 left-0 w-1 h-full",
                trade.direction === 'long' ? 'bg-green-500/50' : 'bg-red-500/50'
              )} />

              {/* Header Row */}
              <div className="flex items-center justify-between pl-3">
                <div className="flex items-center gap-2">
                  {trade.direction === 'long' ? (
                    <ArrowUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={cn(
                    "text-sm font-bold uppercase font-mono",
                    trade.direction === 'long' ? 'text-green-500' : 'text-red-500'
                  )}>
                    {trade.direction}
                  </span>
                  <span className="text-white text-xs font-mono">
                    {trade.market || 'Unknown'}
                  </span>
                  {trade.leverage && (
                    <span className="text-primary text-xs font-mono font-bold">
                      {trade.leverage}x
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-zinc-500">
                  {formatTime(trade.timestamp)}
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 pl-3">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Volume</div>
                  <div className="font-mono text-white text-sm">
                    ${trade.volumeGenerated.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">PnL</div>
                  <div className={cn(
                    "font-mono text-sm font-bold",
                    trade.pnl > 0 ? 'text-green-500' : trade.pnl < 0 ? 'text-red-500' : 'text-zinc-500'
                  )}>
                    {trade.pnl !== 0 ? (
                      <>
                        {trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                      </>
                    ) : '-'}
                  </div>
                </div>
                {trade.entryPrice && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Entry</div>
                    <div className="font-mono text-zinc-400 text-sm">
                      ${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
                {trade.exitPrice && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase text-zinc-600 font-mono tracking-wider">Exit</div>
                    <div className="font-mono text-zinc-400 text-sm">
                      ${trade.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                )}
              </div>

              {/* Tx Link */}
              {trade.txHash && trade.txHash !== 'waiting' && (
                <div className="pl-3 pt-2 border-t border-white/5">
                  <a
                    href={`https://explorer.aptoslabs.com/txn/${trade.txHash}?network=testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-zinc-500 hover:text-primary transition-colors"
                  >
                    View Transaction
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
