"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { CurvedLineChart, DataPoint } from "@/components/charts/curved-line-chart"

interface PnLChartProps {
  orders: Array<{
    timestamp: number
    pnl?: number
    direction: 'long' | 'short'
    txHash: string
  }>
}

export function PnLChart({ orders }: PnLChartProps) {
  if (!orders || orders.length === 0) {
    return null
  }

  // Filter orders that have PNL data
  const ordersWithPnL = orders.filter(order => order.pnl !== undefined && order.pnl !== 0)

  // Prepare chart data with cumulative PNL
  const chartData = useMemo((): DataPoint[] => {
    let cumulativePnL = 0
    return ordersWithPnL.map((order) => {
      cumulativePnL += order.pnl || 0
      return {
        date: new Date(order.timestamp),
        value: cumulativePnL,
      }
    })
  }, [ordersWithPnL])

  if (ordersWithPnL.length === 0) {
    return (
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white font-mono">PNL Chart</CardTitle>
          <CardDescription className="font-mono text-zinc-500">
            No PNL data yet. Use High Risk strategy to see real-time PNL!
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const totalPnL = chartData.length > 0 ? chartData[chartData.length - 1].value : 0
  const isProfitable = totalPnL >= 0
  const profitableTrades = ordersWithPnL.filter(o => (o.pnl || 0) > 0).length
  const losingTrades = ordersWithPnL.filter(o => (o.pnl || 0) < 0).length

  return (
    <Card className="bg-black/40 border-white/10 overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white font-mono">PNL Chart</CardTitle>
            <CardDescription className="font-mono text-zinc-500">
              Cumulative profit/loss across all trades
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs font-mono uppercase tracking-wider text-zinc-500">Total PNL</p>
            <p className={`text-2xl font-mono font-bold tabular-nums ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}${totalPnL.toFixed(2)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <CurvedLineChart
          data={chartData}
          height={280}
          showGrid={true}
          showAxis={true}
          showArea={true}
          showTooltip={true}
          animationDuration={1200}
          lineColor={isProfitable ? "var(--success)" : "var(--destructive)"}
          areaColor={isProfitable ? "var(--success)" : "var(--destructive)"}
        />

        {/* Trade breakdown */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Profitable Trades</p>
            <p className="text-xl font-mono font-bold text-green-400 tabular-nums">
              {profitableTrades}
            </p>
          </div>
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Losing Trades</p>
            <p className="text-xl font-mono font-bold text-red-400 tabular-nums">
              {losingTrades}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
