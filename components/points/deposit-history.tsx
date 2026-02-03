"use client"

import { useEffect, useState, useCallback } from "react"
import { History, ArrowUpRight, ArrowDownRight, RefreshCw, Loader2, ExternalLink, ChevronDown, ChevronUp } from "lucide-react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

interface BalanceEvent {
  timestamp: string
  event_kind: 'deposit' | 'withdraw' | 'promote' | 'transition'
  fund_type: 'ua' | 'dlp'
  amount: string
  tx_hash?: string
}

export function DepositHistory() {
  const { account, connected } = useWallet()
  const [events, setEvents] = useState<BalanceEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [filter, setFilter] = useState<'all' | 'deposit' | 'withdraw' | 'promote'>('all')

  const fetchEvents = useCallback(async () => {
    if (!account?.address) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        account: account.address.toString(),
        limit: '50',
      })
      if (filter !== 'all') {
        params.set('event_kind', filter)
      }

      const res = await fetch(`/api/predeposit/events?${params}`)
      const data = await res.json()
      setEvents(data.events || [])
    } catch (error) {
      console.error('Error fetching deposit history:', error)
    } finally {
      setLoading(false)
    }
  }, [account?.address, filter])

  useEffect(() => {
    if (connected && account?.address) {
      fetchEvents()
    }
  }, [connected, account?.address, fetchEvents])

  const formatAmount = (amount: string) => {
    const n = parseFloat(amount)
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(2)}`
  }

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getEventIcon = (kind: string) => {
    switch (kind) {
      case 'deposit':
        return <ArrowDownRight className="w-4 h-4 text-green-500" />
      case 'withdraw':
        return <ArrowUpRight className="w-4 h-4 text-red-500" />
      case 'promote':
        return <ArrowUpRight className="w-4 h-4 text-blue-500" />
      default:
        return <ArrowDownRight className="w-4 h-4 text-zinc-500" />
    }
  }

  const getEventColor = (kind: string) => {
    switch (kind) {
      case 'deposit':
        return 'text-green-500'
      case 'withdraw':
        return 'text-red-500'
      case 'promote':
        return 'text-blue-500'
      default:
        return 'text-zinc-400'
    }
  }

  const getEventLabel = (kind: string, fundType: string) => {
    switch (kind) {
      case 'deposit':
        return `Deposit to ${fundType.toUpperCase()}`
      case 'withdraw':
        return `Withdraw from ${fundType.toUpperCase()}`
      case 'promote':
        return 'Promoted to DLP'
      case 'transition':
        return 'Transition'
      default:
        return kind
    }
  }

  if (!connected) {
    return null
  }

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 relative animate-in fade-in duration-500">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-mono text-zinc-500 uppercase tracking-widest">
          <History className="w-4 h-4" />
          Your Deposit History
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-zinc-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10">
          {/* Filter Buttons */}
          <div className="flex items-center gap-2 p-4 border-b border-white/5">
            {(['all', 'deposit', 'withdraw', 'promote'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  filter === f
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-zinc-500 hover:text-white border border-white/10 hover:border-white/20'
                }`}
              >
                {f}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="p-1.5 text-zinc-500 hover:text-primary transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Events List */}
          <div className="max-h-80 overflow-y-auto">
            {events.length === 0 ? (
              <div className="p-8 text-center">
                <History className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                <p className="text-zinc-500 font-mono text-sm">
                  {loading ? 'Loading...' : 'No deposit history yet'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {events.map((event, idx) => (
                  <div
                    key={`${event.timestamp}-${idx}`}
                    className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-black/40 border border-white/10">
                        {getEventIcon(event.event_kind)}
                      </div>
                      <div>
                        <div className={`text-sm font-mono ${getEventColor(event.event_kind)}`}>
                          {getEventLabel(event.event_kind, event.fund_type)}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-600">
                          {formatDate(event.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className={`text-lg font-mono font-bold ${getEventColor(event.event_kind)}`}>
                          {event.event_kind === 'deposit' ? '+' : ''}{formatAmount(event.amount)}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-600 uppercase">
                          {event.fund_type}
                        </div>
                      </div>
                      {event.tx_hash && (
                        <a
                          href={`https://explorer.aptoslabs.com/txn/${event.tx_hash}?network=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 hover:text-primary transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
