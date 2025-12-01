"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import { Activity, TrendingUp, TrendingDown, Target, Clock, Zap, ExternalLink, CheckCircle, XCircle, Timer } from "lucide-react"
import { cn } from "@/lib/utils"

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
        toast.warning(`Rate limited · wait ${waitTime}s`, {
          description: 'Trades are limited to once per 30 seconds',
        })
      } else if (data.status === 'completed' || data.isRunning === false) {
        toast.success('Volume Target Reached!', {
          description: `Completed ${data.ordersPlaced} trades · Total volume: $${data.cumulativeVolume?.toFixed(0)} USDC`,
          duration: 5000,
        })
        if (onStatusChange) {
          onStatusChange(false)
        }
      } else if (data.success) {
        const dir = data.direction === 'long' ? 'LONG' : 'SHORT'
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
        toast.error('Trade Failed', {
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

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [userWalletAddress, isRunning])

  useEffect(() => {
    if (!isRunning) {
      setNextTickIn(60)
      return
    }

    const countdownInterval = setInterval(() => {
      setNextTickIn(prev => {
        if (prev <= 1) {
          triggerTick()
          return 60
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(countdownInterval)
  }, [isRunning, triggerTick])

  if (!status || !config) {
    return null
  }

  const volumeProgress = (status.cumulativeVolume / config.volumeTargetUSDC) * 100

  return (
    <div className="space-y-4 font-mono">
      {/* Status Panel - ALWAYS SHOW FIRST when running */}
      {isRunning && (
        <div className="bg-black/40 backdrop-blur-sm border border-primary/30 relative">
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-primary" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-primary" />

          {/* Header */}
          <div className="px-4 py-3 bg-primary/5 border-b border-primary/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary animate-pulse" />
              <h3 className="text-primary text-sm uppercase tracking-widest font-bold">Bot Running</h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 animate-pulse" />
              <span className="text-[10px] text-green-400 uppercase tracking-wider">Active</span>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Volume Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Target className="w-3 h-3 text-primary" />
                  <span className="text-zinc-400 uppercase tracking-wider">Volume Progress</span>
                </div>
                <span className="text-white font-bold">
                  ${status.cumulativeVolume.toFixed(0)} / ${config.volumeTargetUSDC.toFixed(0)}
                </span>
              </div>
              <div className="h-2 w-full bg-black/40 border border-white/10 overflow-hidden">
                <div
                  className="h-full bg-primary shadow-[0_0_10px_rgba(255,246,0,0.5)] transition-all duration-500"
                  style={{ width: `${Math.min(volumeProgress, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-zinc-500 text-right uppercase tracking-wider">
                {volumeProgress.toFixed(1)}% complete
              </p>
            </div>

            {/* Trading Stats */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-black/40 border border-white/10 relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20" />
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3 h-3 text-primary" />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Orders</span>
                </div>
                <p className="text-xl font-bold text-white">{status.ordersPlaced}</p>
              </div>

              <div className="p-3 bg-black/40 border border-white/10 relative">
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/20" />
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-3 h-3 text-zinc-400" />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Last Order</span>
                </div>
                <p className="text-sm font-medium text-white">
                  {status.lastOrderTime
                    ? new Date(status.lastOrderTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : 'Waiting...'}
                </p>
              </div>
            </div>

            {/* Next Trade Countdown */}
            <div className="p-3 bg-primary/5 border border-primary/20 relative">
              <div className="absolute -left-[1px] top-1/2 -translate-y-1/2 h-6 w-[3px] bg-primary/50" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className={cn(
                    "w-4 h-4",
                    isExecuting ? "text-yellow-400 animate-pulse" : "text-primary"
                  )} />
                  <span className="text-xs text-zinc-300 uppercase tracking-wider">
                    {isExecuting ? 'Executing...' : 'Next trade'}
                  </span>
                </div>
                <span className="text-lg font-bold text-primary flex items-center gap-1">
                  {isExecuting ? <Timer className="w-4 h-4 animate-spin" /> : `${nextTickIn}s`}
                </span>
              </div>
            </div>

            {/* Error Display */}
            {status.error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500" />
                <p className="text-xs text-red-400">
                  <strong>Error:</strong> {status.error}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Trades */}
      {status.orderHistory && status.orderHistory.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs text-zinc-400 uppercase tracking-widest">Recent Trades</h3>
            <span className="text-[10px] text-zinc-500">{status.orderHistory.length} total</span>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-1 pr-1 scrollbar-thin">
            {status.orderHistory.map((order: any, index: number) => {
              // Determine if this is an OPEN or CLOSE based on exitPrice
              const isClose = order.exitPrice && order.exitPrice > 0
              const hasPnl = order.pnl && order.pnl !== 0
              const orderType = isClose ? 'CLOSE' : 'OPEN'

              return (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-black/30 border border-white/5 hover:border-white/10 transition-colors"
                >
                  {/* Left: Direction, Time, Asset */}
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-5 h-5 flex items-center justify-center",
                      order.direction === 'long'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    )}>
                      {order.direction === 'long' ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-white font-medium uppercase tracking-wider">
                        {config?.marketName || 'BTC/USD'}
                      </span>
                      <span className="text-[9px] text-zinc-500">
                        {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Middle: Action (OPEN/CLOSE), PnL if closed */}
                  <div className="flex items-center gap-1">
                    <span className={cn(
                      "text-[9px] px-1 py-0.5 font-medium",
                      isClose ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"
                    )}>
                      {orderType}
                    </span>
                    {hasPnl && (
                      <span className={cn(
                        "text-[9px] px-1 py-0.5 font-bold",
                        order.pnl > 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      )}>
                        {order.pnl > 0 ? '+' : ''}${order.pnl.toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Right: Volume, TX Link */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-bold">
                      ${order.volumeGenerated?.toFixed(0) || '0'}
                    </span>
                    {order.txHash && order.txHash !== 'waiting' && (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${order.txHash}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-5 h-5 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                      >
                        <ExternalLink className="w-2.5 h-2.5 text-zinc-400" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Session Complete Summary */}
      {!isRunning && status.orderHistory && status.orderHistory.length > 0 && (
        <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-3 relative">
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 uppercase tracking-wider">Session Complete</span>
            <span className="text-xs text-white font-bold">
              {status.orderHistory.length} trades · ${status.cumulativeVolume?.toFixed(0) || '0'} volume
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
