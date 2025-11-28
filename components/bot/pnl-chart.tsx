"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

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

  if (ordersWithPnL.length === 0) {
    return (
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white">PNL Chart</CardTitle>
          <CardDescription>No PNL data yet. Use High Risk strategy to see real-time PNL!</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Calculate cumulative PNL
  let cumulativePnL = 0
  const chartData = ordersWithPnL.map((order, index) => {
    cumulativePnL += order.pnl || 0
    return {
      index: index + 1,
      pnl: order.pnl || 0,
      cumulativePnL: cumulativePnL,
      time: new Date(order.timestamp).toLocaleTimeString(),
      direction: order.direction,
    }
  })

  const totalPnL = cumulativePnL
  const isProfitable = totalPnL >= 0

  return (
    <Card className="bg-black/40 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white">PNL Chart</CardTitle>
            <CardDescription>Cumulative profit/loss across all trades</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-sm text-zinc-400">Total PNL</p>
            <p className={`text-2xl font-bold ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
              {isProfitable ? '+' : ''}${totalPnL.toFixed(2)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis
                dataKey="index"
                stroke="#888"
                tick={{ fill: '#888' }}
                label={{ value: 'Trade #', position: 'insideBottom', offset: -5, fill: '#888' }}
              />
              <YAxis
                stroke="#888"
                tick={{ fill: '#888' }}
                label={{ value: 'PNL ($)', angle: -90, position: 'insideLeft', fill: '#888' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#000',
                  border: '1px solid #333',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: '#888' }}
                formatter={(value: number, name: string) => {
                  if (name === 'cumulativePnL') {
                    return [`$${value.toFixed(2)}`, 'Cumulative PNL']
                  }
                  if (name === 'pnl') {
                    return [`$${value.toFixed(2)}`, 'Trade PNL']
                  }
                  return value
                }}
                labelFormatter={(label) => `Trade #${label}`}
              />
              <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="cumulativePnL"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={{
                  fill: '#3b82f6',
                  r: 4,
                }}
                activeDot={{
                  r: 6,
                  fill: '#3b82f6',
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Trade breakdown */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="p-3 bg-black/40 border border-green-500/20 rounded-lg">
            <p className="text-xs text-zinc-400 mb-1">Profitable Trades</p>
            <p className="text-xl font-bold text-green-400">
              {chartData.filter(d => d.pnl > 0).length}
            </p>
          </div>
          <div className="p-3 bg-black/40 border border-red-500/20 rounded-lg">
            <p className="text-xs text-zinc-400 mb-1">Losing Trades</p>
            <p className="text-xl font-bold text-red-400">
              {chartData.filter(d => d.pnl < 0).length}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
