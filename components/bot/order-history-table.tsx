"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, TrendingUp, TrendingDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface OrderHistoryProps {
  orders: Array<{
    timestamp: number
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
  }>
}

export function OrderHistoryTable({ orders }: OrderHistoryProps) {
  if (!orders || orders.length === 0) {
    return null
  }

  return (
    <Card className="bg-black/40 border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Order History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-white/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-white/5">
                <TableHead className="text-zinc-400">Time</TableHead>
                <TableHead className="text-zinc-400">Strategy</TableHead>
                <TableHead className="text-zinc-400">Direction</TableHead>
                <TableHead className="text-zinc-400">Size (contracts)</TableHead>
                <TableHead className="text-zinc-400">Volume</TableHead>
                <TableHead className="text-zinc-400">PNL</TableHead>
                <TableHead className="text-zinc-400">Status</TableHead>
                <TableHead className="text-zinc-400">Transaction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.slice().reverse().map((order, index) => (
                <TableRow key={index} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-zinc-300 text-sm">
                    {new Date(order.timestamp).toLocaleTimeString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        order.strategy === 'twap'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs'
                          : order.strategy === 'market_maker'
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs'
                          : order.strategy === 'delta_neutral'
                          ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 text-xs'
                          : 'bg-orange-500/10 text-orange-400 border-orange-500/30 text-xs'
                      }
                    >
                      {order.strategy === 'twap' && 'TWAP'}
                      {order.strategy === 'market_maker' && 'MM'}
                      {order.strategy === 'delta_neutral' && 'DN'}
                      {order.strategy === 'high_risk' && 'HIGH RISK'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        order.direction === 'long'
                          ? 'bg-green-500/10 text-green-400 border-green-500/30'
                          : 'bg-red-500/10 text-red-400 border-red-500/30'
                      }
                    >
                      {order.direction === 'long' ? (
                        <TrendingUp className="w-3 h-3 mr-1" />
                      ) : (
                        <TrendingDown className="w-3 h-3 mr-1" />
                      )}
                      {order.direction.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-white font-medium">
                    {order.size.toLocaleString()}
                    {order.strategy === 'high_risk' && (
                      <span className="ml-1 text-xs text-orange-400">
                        ({(order.size / 10000).toFixed(0)}x)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-white font-medium">
                    ${order.volumeGenerated.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {order.pnl !== undefined && order.pnl !== 0 ? (
                      <span
                        className={
                          order.pnl > 0
                            ? 'text-green-400 font-bold'
                            : order.pnl < 0
                            ? 'text-red-400 font-bold'
                            : 'text-zinc-400'
                        }
                      >
                        {order.pnl > 0 ? '+' : ''}${order.pnl.toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-zinc-500 text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        order.success
                          ? 'bg-green-500/10 text-green-400 border-green-500/30'
                          : 'bg-red-500/10 text-red-400 border-red-500/30'
                      }
                    >
                      {order.success ? 'Success' : 'Failed'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {order.txHash ? (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${order.txHash}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors text-sm"
                      >
                        <span className="font-mono">{order.txHash.slice(0, 8)}...</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-zinc-500 text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
