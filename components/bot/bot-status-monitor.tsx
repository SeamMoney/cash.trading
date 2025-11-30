"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Activity, TrendingUp, TrendingDown, Target, Clock, Zap, ExternalLink } from "lucide-react"

interface BotStatusMonitorProps {
  userWalletAddress: string
  isRunning: boolean
  onStatusChange?: (isRunning: boolean) => void
}

export function BotStatusMonitor({ userWalletAddress, isRunning, onStatusChange }: BotStatusMonitorProps) {
  const [status, setStatus] = useState<any>(null)
  const [config, setConfig] = useState<any>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isExecuting, setIsExecuting] = useState(false)
  const [nextTickIn, setNextTickIn] = useState(60)
  const lastTickTimeRef = useRef<number>(0)

  // Trigger a trade tick
  const triggerTick = useCallback(async () => {
    if (isExecuting || !isRunning) return

    setIsExecuting(true)
    try {
      const response = await fetch('/api/bot/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userWalletAddress }),
      })

      const data = await response.json()
      console.log('Bot tick result:', data)

      // Handle different responses
      if (response.status === 429) {
        const waitTime = data.message?.match(/(\d+) seconds/)?.[1] || '30'
        toast.warning(`⏳ Rate limited · wait ${waitTime}s`, {
          description: 'Trades are limited to once per 30 seconds',
        })
      } else if (data.status === 'completed' || data.isRunning === false) {
        toast.success('🎯 Volume Target Reached!', {
          description: `Completed ${data.ordersPlaced} trades · Total volume: $${data.cumulativeVolume?.toFixed(0)} USDC`,
          duration: 5000,
        })
        if (onStatusChange) {
          onStatusChange(false)
        }
      } else if (data.success) {
        const dir = data.direction === 'long' ? '📈 LONG' : '📉 SHORT'
        const vol = data.volumeGenerated?.toFixed(0) || '0'
        const cumVol = data.cumulativeVolume?.toFixed(0) || '0'
        const progress = data.progress || '0'
        const market = data.market || 'BTC/USD'
        const txShort = data.txHash ? `${data.txHash.slice(0, 8)}...` : ''
        toast.success(`${dir} · ${market}`, {
          description: `+$${vol} volume (${progress}% of target) · Total: $${cumVol}${txShort ? ` · tx: ${txShort}` : ''}`,
          duration: 3000,
        })
      } else if (data.error) {
        toast.error('❌ Trade Failed', {
          description: data.error,
          duration: 4000,
        })
      }

      // Immediately fetch updated status
      const statusResponse = await fetch(
        `/api/bot/status?userWalletAddress=${encodeURIComponent(userWalletAddress)}`
      )
      const statusData = await statusResponse.json()
      if (statusData.status) {
        setStatus(statusData.status)
      }
      if (statusData.config) {
        setConfig(statusData.config)
      }

      lastTickTimeRef.current = Date.now()
    } catch (error) {
      console.error('Error triggering bot tick:', error)
    } finally {
      setIsExecuting(false)
    }
  }, [userWalletAddress, isRunning, isExecuting, onStatusChange])

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        // Fetch from our own API (avoids CORS issues)
        const response = await fetch(
          `/api/bot/status?userWalletAddress=${encodeURIComponent(userWalletAddress)}`
        )

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const data = await response.json()

        setStatus(data.status)
        setConfig(data.config)
        setSessionId(data.sessionId || null)

        // Notify parent if status changed
        if (data.isRunning && !isRunning && onStatusChange) {
          onStatusChange(true)
        } else if (!data.isRunning && isRunning && onStatusChange) {
          onStatusChange(false)
        }

        setLoading(false)
      } catch (error) {
        console.error('Error fetching bot status:', error)
        setLoading(false)
      }
    }

    // Fetch immediately
    fetchStatus()

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000)

    return () => clearInterval(interval)
  }, [userWalletAddress, isRunning])

  // Auto-trigger trades every 60 seconds when bot is running
  useEffect(() => {
    if (!isRunning) {
      setNextTickIn(60)
      return
    }

    // Countdown timer
    const countdownInterval = setInterval(() => {
      setNextTickIn(prev => {
        if (prev <= 1) {
          // Time to trigger a tick
          triggerTick()
          return 60 // Reset countdown
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(countdownInterval)
  }, [isRunning, triggerTick])

  // Show trade history even when bot is stopped
  if (!status || !config) {
    return null
  }

  const volumeProgress = (status.cumulativeVolume / config.volumeTargetUSDC) * 100
  const capitalUsedPercent = (status.currentCapitalUsed / config.capitalUSDC) * 100

  return (
    <div className="space-y-4">
      {/* Status Card - ALWAYS SHOW FIRST when running */}
      {isRunning && (
      <Card className="bg-black/40 border-primary/30">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary animate-pulse" />
              Bot Running
            </CardTitle>
            <CardDescription>Real-time trading activity</CardDescription>
          </div>
          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
            Active
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Volume Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-zinc-300">Volume Target Progress</span>
            </div>
            <span className="text-white font-bold">
              ${status.cumulativeVolume.toFixed(2)} / ${config.volumeTargetUSDC.toFixed(0)}
            </span>
          </div>
          <Progress value={volumeProgress} className="h-3" />
          <p className="text-xs text-zinc-500 text-right">{volumeProgress.toFixed(1)}% complete</p>
        </div>

        {/* Trading Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-black/40 border border-white/10 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-xs text-zinc-500">Orders Placed</span>
            </div>
            <p className="text-2xl font-bold text-white">{status.ordersPlaced}</p>
          </div>

          <div className="p-4 bg-black/40 border border-white/10 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              <span className="text-xs text-zinc-500">Last Order</span>
            </div>
            <p className="text-sm font-medium text-white">
              {status.lastOrderTime
                ? new Date(status.lastOrderTime).toLocaleTimeString()
                : 'Waiting...'}
            </p>
          </div>
        </div>

        {/* Next Trade Countdown */}
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className={`w-4 h-4 ${isExecuting ? 'text-yellow-400 animate-pulse' : 'text-primary'}`} />
              <span className="text-sm text-zinc-300">
                {isExecuting ? 'Executing trade...' : 'Next trade in'}
              </span>
            </div>
            <span className="text-lg font-bold text-primary">
              {isExecuting ? '⏳' : `${nextTickIn}s`}
            </span>
          </div>
        </div>

        {/* Error Display */}
        {status.error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">
              <strong>Error:</strong> {status.error}
            </p>
          </div>
        )}

      </CardContent>
    </Card>
      )}

      {/* Scrollable Recent Trades */}
      {status.orderHistory && status.orderHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-medium text-zinc-400">Recent Trades</h3>
            <span className="text-xs text-zinc-500">{status.orderHistory.length} total</span>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {status.orderHistory.map((order: any, index: number) => {
              const leverage = order.size ? Math.round(order.size / 10000) : 10
              const orderType = order.strategy === 'high_risk' ? 'TWAP' : order.strategy?.toUpperCase() || 'TWAP'

              return (
                <div
                  key={index}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-black/30 border border-white/5 hover:border-white/10 transition-colors"
                >
                  {/* Left: Direction, Time, Asset */}
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded flex items-center justify-center ${
                      order.direction === 'long'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {order.direction === 'long' ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-white font-medium">
                        {config?.marketName || 'BTC/USD'}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Middle: Leverage, Type */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">
                      {leverage}x
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                      {orderType}
                    </span>
                  </div>

                  {/* Right: Volume, TX Link */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-medium">
                      ${order.volumeGenerated?.toFixed(0) || '0'}
                    </span>
                    {order.txHash && (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${order.txHash}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                      >
                        <ExternalLink className="w-3 h-3 text-zinc-400" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* When stopped, show summary */}
      {!isRunning && status.orderHistory && status.orderHistory.length > 0 && (
        <Card className="bg-black/40 border-white/10">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-400">Session Complete</span>
              <span className="text-sm text-white">
                {status.orderHistory.length} trades · ${status.cumulativeVolume?.toFixed(0) || '0'} volume
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
