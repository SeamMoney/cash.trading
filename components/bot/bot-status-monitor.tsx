"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import { Activity, TrendingUp, TrendingDown, Target, Clock, Zap, ExternalLink, CheckCircle, XCircle, Timer, Square } from "lucide-react"
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
  const [nextTickIn, setNextTickIn] = useState(15) // Start with faster interval, will adjust
  const [monitoringInfo, setMonitoringInfo] = useState<{
    pnl: number,
    direction: string,
    size?: number,
    entry?: number,
    currentPrice?: number
  } | null>(null)
  const [rateLimitBackoff, setRateLimitBackoff] = useState(0) // Extra seconds to wait after rate limit
  const [isStopping, setIsStopping] = useState(false)
  const lastTickTimeRef = useRef<number>(0)

  // Stop bot handler
  const handleStop = useCallback(async () => {
    setIsStopping(true)
    try {
      const response = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userWalletAddress }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop bot')
      }

      // Show appropriate message based on whether we closed a position
      if (data.closedPosition) {
        toast.success('Bot Stopped - Closing Position', {
          description: `Closing ${data.closeResult?.direction} position. TWAP will fill in 1-2 minutes.`,
          duration: 5000,
        })
      } else {
        toast.info('Bot Stopped', {
          description: 'Trading has been paused',
        })
      }
      if (onStatusChange) {
        onStatusChange(false)
      }
    } catch (err: any) {
      toast.error('Failed to stop bot', {
        description: err.message,
      })
    } finally {
      setIsStopping(false)
    }
  }, [userWalletAddress, onStatusChange])

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
      if (response.status === 429 || data.isRateLimit) {
        // Rate limit - add backoff and don't show alarming error
        const backoffTime = data.retryAfter || 10
        setRateLimitBackoff(backoffTime)
        // Only show toast occasionally to avoid spam
        if (Math.random() < 0.3) {
          toast.info(`Slowing down...`, {
            description: `API rate limit hit, backing off ${backoffTime}s`,
            duration: 2000,
          })
        }
        console.log(`Rate limited, backing off ${backoffTime}s`)
      } else if (data.status === 'completed' || data.isRunning === false) {
        toast.success('Volume Target Reached!', {
          description: `Completed ${data.ordersPlaced} trades · Total volume: $${data.cumulativeVolume?.toFixed(0)} USDC`,
          duration: 5000,
        })
        if (onStatusChange) {
          onStatusChange(false)
        }
      } else if (data.status === 'monitoring') {
        // Bot is monitoring position - update state for persistent UI display
        if (data.currentPnl !== undefined && data.positionDirection) {
          setMonitoringInfo({
            pnl: data.currentPnl,
            direction: data.positionDirection,
            size: data.positionSize,
            entry: data.positionEntry,
            currentPrice: data.currentPrice
          })
        }
      } else if (data.success && data.volumeGenerated) {
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

  // Get tick interval based on strategy
  // TX Spammer: 5 seconds (rapid fire)
  // High risk: 15 seconds (frequent monitoring)
  // Other strategies: 60 seconds
  const tickInterval = config?.strategy === 'tx_spammer' ? 5
    : config?.strategy === 'high_risk' ? 15
    : 60

  // Reset countdown when strategy/config changes
  useEffect(() => {
    setNextTickIn(tickInterval)
  }, [tickInterval])

  useEffect(() => {
    if (!isRunning) {
      setNextTickIn(tickInterval)
      setRateLimitBackoff(0)
      return
    }

    const countdownInterval = setInterval(() => {
      // Handle rate limit backoff first
      if (rateLimitBackoff > 0) {
        setRateLimitBackoff(prev => prev - 1)
        return
      }

      setNextTickIn(prev => {
        if (prev <= 1) {
          triggerTick()
          return tickInterval
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(countdownInterval)
  }, [isRunning, triggerTick, tickInterval, rateLimitBackoff])

  if (!status || !config) {
    return null
  }

  const volumeProgress = (status.cumulativeVolume / config.volumeTargetUSDC) * 100

  return (
    <div className="space-y-4 font-mono">
      {/* Status Panel - ALWAYS SHOW FIRST when running */}
      {isRunning && (
        <div className="border border-primary/30 relative" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
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
            <div className={cn(
              "p-3 border relative",
              rateLimitBackoff > 0
                ? "bg-orange-500/5 border-orange-500/20"
                : "bg-primary/5 border-primary/20"
            )}>
              <div className={cn(
                "absolute -left-[1px] top-1/2 -translate-y-1/2 h-6 w-[3px]",
                rateLimitBackoff > 0 ? "bg-orange-500/50" : "bg-primary/50"
              )} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className={cn(
                    "w-4 h-4",
                    isExecuting ? "text-yellow-400 animate-pulse" :
                    rateLimitBackoff > 0 ? "text-orange-400" : "text-primary"
                  )} />
                  <span className="text-xs text-zinc-300 uppercase tracking-wider">
                    {isExecuting ? 'Checking...' :
                     rateLimitBackoff > 0 ? 'Cooling down' :
                     (monitoringInfo ? 'Next check' : 'Next trade')}
                  </span>
                </div>
                <span className={cn(
                  "text-lg font-bold flex items-center gap-1",
                  rateLimitBackoff > 0 ? "text-orange-400" : "text-primary"
                )}>
                  {isExecuting ? <Timer className="w-4 h-4 animate-spin" /> :
                   rateLimitBackoff > 0 ? `${rateLimitBackoff}s` : `${nextTickIn}s`}
                </span>
              </div>
            </div>

            {/* Stop Bot Button */}
            <button
              onClick={handleStop}
              disabled={isStopping}
              className="w-full h-14 text-lg font-bold font-mono tracking-[0.2em] border relative overflow-hidden group transition-all duration-300 disabled:opacity-50 bg-red-500/90 hover:bg-red-500 text-white border-red-500 shadow-[0_0_30px_-5px_rgba(239,68,68,0.6)] hover:shadow-[0_0_50px_-10px_rgba(239,68,68,0.8)]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <Square className="w-5 h-5" />
                {isStopping ? 'STOPPING...' : 'STOP BOT'}
              </span>
              <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <div className="absolute bottom-0 left-0 w-full h-1 bg-white/50" />
            </button>

            {/* Monitoring Info - shows when watching an open position */}
            {monitoringInfo && config?.strategy === 'high_risk' && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-blue-500" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-blue-300 uppercase tracking-wider">
                    Monitoring {monitoringInfo.direction.toUpperCase()} Position
                  </span>
                  <span className={cn(
                    "text-sm font-bold",
                    monitoringInfo.pnl >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {monitoringInfo.pnl >= 0 ? '+' : ''}{monitoringInfo.pnl.toFixed(3)}%
                  </span>
                </div>
                {/* Position Details */}
                {monitoringInfo.size && monitoringInfo.entry && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-zinc-500">Size</span>
                      <p className="text-white font-medium">
                        {(monitoringInfo.size / 1e8).toFixed(4)} BTC
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Entry</span>
                      <p className="text-white font-medium">
                        ${monitoringInfo.entry.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-500">Current</span>
                      <p className="text-white font-medium">
                        ${monitoringInfo.currentPrice?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '-'}
                      </p>
                    </div>
                  </div>
                )}
                <div className="mt-2 text-[10px] text-zinc-500">
                  Target: +0.03% · Stop: -0.08%
                </div>
              </div>
            )}

            {/* Error Display - don't show rate limit errors as they auto-recover */}
            {status.error && !status.error.includes('429') && !status.error.includes('rate limit') && (
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
            <h3 className="text-xs text-zinc-400 uppercase tracking-widest">Trade History</h3>
            <span className="text-[10px] text-zinc-500">{status.orderHistory.length} trades</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {status.orderHistory.map((order: any, index: number) => {
              // Calculate margin used (volume / leverage)
              const leverage = order.leverage || 40
              const marginUsed = order.volumeGenerated / leverage
              const hasPnl = order.pnl && order.pnl !== 0
              const isClose = order.exitPrice && order.exitPrice > 0
              const strategyLabel = order.strategy === 'high_risk' ? 'HIGH RISK' :
                                   order.strategy === 'twap' ? 'TWAP' :
                                   order.strategy === 'market_maker' ? 'MM' :
                                   order.strategy?.toUpperCase() || 'TWAP'

              return (
                <div
                  key={index}
                  className="p-3 bg-black/30 border border-white/5 hover:border-white/10 transition-colors space-y-2"
                >
                  {/* Top Row: Direction, Market, Time, Strategy */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "px-2 py-0.5 text-[10px] font-bold uppercase",
                        order.direction === 'long'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      )}>
                        {order.direction === 'long' ? '↑ LONG' : '↓ SHORT'}
                      </div>
                      <span className="text-[10px] text-white font-medium">
                        {order.market || config?.marketName || 'BTC/USD'}
                      </span>
                      <span className="text-[9px] px-1 py-0.5 bg-zinc-800 text-zinc-400">
                        {leverage}x
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] px-1 py-0.5 bg-purple-500/20 text-purple-400">
                        {strategyLabel}
                      </span>
                      <span className="text-[9px] text-zinc-500">
                        {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Middle Row: Prices and Size */}
                  <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div>
                      <span className="text-zinc-500 block">Margin</span>
                      <span className="text-white font-medium">${marginUsed.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Volume</span>
                      <span className="text-white font-medium">${order.volumeGenerated?.toFixed(0) || '0'}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">{isClose ? 'Entry' : 'Price'}</span>
                      <span className="text-white font-medium">
                        ${order.entryPrice?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '-'}
                      </span>
                    </div>
                    {isClose ? (
                      <div>
                        <span className="text-zinc-500 block">Exit</span>
                        <span className="text-white font-medium">
                          ${order.exitPrice?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '-'}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-zinc-500 block">Size</span>
                        <span className="text-white font-medium">
                          {order.size ? (Number(order.size) / 1e8).toFixed(4) : '-'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Row: PnL and TX Link */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      {hasPnl ? (
                        <span className={cn(
                          "text-xs font-bold px-2 py-0.5",
                          order.pnl > 0
                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                            : "bg-red-500/20 text-red-400 border border-red-500/30"
                        )}>
                          {order.pnl > 0 ? '+' : ''}${order.pnl.toFixed(2)} PnL
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-500">
                          {isClose ? 'No PnL data' : 'Position opened'}
                        </span>
                      )}
                    </div>
                    {order.txHash && order.txHash !== 'waiting' && (
                      <a
                        href={`https://explorer.aptoslabs.com/txn/${order.txHash}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
                      >
                        <span>{order.txHash.slice(0, 8)}...</span>
                        <ExternalLink className="w-2.5 h-2.5" />
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
      {!isRunning && status.orderHistory && status.orderHistory.length > 0 && (() => {
        // Calculate total PnL from all orders
        const totalPnl = status.orderHistory.reduce((sum: number, order: any) => sum + (order.pnl || 0), 0)
        const wins = status.orderHistory.filter((o: any) => o.pnl > 0).length
        const losses = status.orderHistory.filter((o: any) => o.pnl < 0).length

        return (
          <div className="border border-white/10 p-4 relative space-y-3" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400 uppercase tracking-wider">Session Complete</span>
              <span className="text-xs text-white font-bold">
                {status.orderHistory.length} trades · ${status.cumulativeVolume?.toFixed(0) || '0'} volume
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
              <div className="text-center">
                <span className="text-[10px] text-zinc-500 block uppercase">Total PnL</span>
                <span className={cn(
                  "text-lg font-bold",
                  totalPnl >= 0 ? "text-green-400" : "text-red-400"
                )}>
                  {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                </span>
              </div>
              <div className="text-center">
                <span className="text-[10px] text-zinc-500 block uppercase">Wins</span>
                <span className="text-lg font-bold text-green-400">{wins}</span>
              </div>
              <div className="text-center">
                <span className="text-[10px] text-zinc-500 block uppercase">Losses</span>
                <span className="text-lg font-bold text-red-400">{losses}</span>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
