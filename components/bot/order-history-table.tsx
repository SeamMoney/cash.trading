"use client"

import { Badge } from "@/components/ui/badge"
import { ExternalLink, TrendingUp, TrendingDown, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface OrderHistoryProps {
  orders: Array<{
    timestamp: number | string
    txHash: string
    direction: 'long' | 'short'
    strategy: string
    size: number
    volumeGenerated: number
    success: boolean
    entryPrice?: number
    exitPrice?: number
    pnl?: number
    positionHeldMs?: number
    sessionId?: string
  }>
  currentSessionId?: string
}

export function OrderHistoryTable({ orders, currentSessionId }: OrderHistoryProps) {
  if (!orders || orders.length === 0) {
    return null
  }

  // Group orders by session or date
  const sortedOrders = orders.slice().sort((a, b) => {
    const timeA = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp
    const timeB = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp
    return timeB - timeA // Newest first
  })

  const formatTime = (timestamp: number | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (timestamp: number | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp)
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <Card className="bg-black/40 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-lg">Trade History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {sortedOrders.map((order, index) => {
          const isCurrentSession = currentSessionId && order.sessionId === currentSessionId

          return (
            <div
              key={index}
              className={`p-3 rounded-lg border ${
                isCurrentSession
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-black/20 border-white/5'
              }`}
            >
              {/* Top row: Direction + Time + Status */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`${
                      order.direction === 'long'
                        ? 'bg-green-500/10 text-green-400 border-green-500/30'
                        : 'bg-red-500/10 text-red-400 border-red-500/30'
                    } px-2 py-0.5`}
                  >
                    {order.direction === 'long' ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {order.direction.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-zinc-500">
                    {formatTime(order.timestamp)}
                  </span>
                </div>

                {order.success ? (
                  <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
                    ✓
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-xs">
                    ✗
                  </Badge>
                )}
              </div>

              {/* Bottom row: Volume + PNL + TX link */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-white font-medium">
                    ${order.volumeGenerated.toFixed(0)}
                  </span>
                  {order.pnl !== undefined && order.pnl !== 0 && (
                    <span
                      className={`font-medium ${
                        order.pnl > 0 ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {order.pnl > 0 ? '+' : ''}${order.pnl.toFixed(2)}
                    </span>
                  )}
                </div>

                {order.txHash && (
                  <a
                    href={`https://explorer.aptoslabs.com/txn/${order.txHash}?network=testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:text-primary/80 text-xs"
                  >
                    <span className="font-mono">{order.txHash.slice(0, 6)}...</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          )
        })}

        {sortedOrders.length > 10 && (
          <p className="text-center text-xs text-zinc-500 pt-2">
            Showing {sortedOrders.length} trades
          </p>
        )}
      </CardContent>
    </Card>
  )
}
