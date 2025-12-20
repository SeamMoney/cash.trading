"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"
import { Activity, TrendingUp, TrendingDown, Target, Clock, Zap, ExternalLink, CheckCircle, XCircle, Timer, Square, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

// Size decimals for each market (for proper display)
const SIZE_DECIMALS: Record<string, number> = {
  'BTC/USD': 8,
  'ETH/USD': 7,
  'SOL/USD': 6,
  'APT/USD': 4,
  'WLFI/USD': 3,
  'XRP/USD': 4,
  'LINK/USD': 4,
}

// Get symbol from market name
const getMarketSymbol = (market: string): string => {
  return market?.split('/')[0] || 'BTC'
}

interface BotStatusMonitorProps {
  userWalletAddress: string
  userSubaccount: string
  isRunning: boolean
  onStatusChange?: (isRunning: boolean) => void
}

export function BotStatusMonitor({ userWalletAddress, userSubaccount, isRunning, onStatusChange }: BotStatusMonitorProps) {
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
    currentPrice?: number,
    isManual?: boolean,
    market?: string,
    leverage?: number
  } | null>(null)
  const [allPositions, setAllPositions] = useState<Array<{
    market: string,
    direction: 'long' | 'short',
    size: number,
    entryPrice: number,
    currentPrice?: number,
    pnlPercent?: number,
    leverage?: number,
    isManual?: boolean
  }>>([])  // Track ALL positions including manual ones
  const [rateLimitBackoff, setRateLimitBackoff] = useState(0) // Extra seconds to wait after rate limit
  const [isStopping, setIsStopping] = useState(false)
  const lastTickTimeRef = useRef<number>(0)

  // Live positions state (for when bot is not running)
  const [livePositions, setLivePositions] = useState<Array<{
    market: string,
    marketAddress: string,
    direction: 'long' | 'short',
    size: number,
    sizeRaw: number,
    entryPrice: number,
    currentPrice?: number,
    pnlPercent?: number,           // Raw price change %
    pnlPercentLeveraged?: number,  // With leverage (what Decibel shows)
    pnlUsd?: number,               // Actual USD profit/loss
    leverage?: number,
    notionalValue?: number,
    marginUsed?: number,
  }>>([])
  const [closingPositions, setClosingPositions] = useState<Set<string>>(new Set()) // Track which positions are being closed

  // Stop bot handler
  const handleStop = useCallback(async () => {
    setIsStopping(true)
    try {
      const response = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userWalletAddress, userSubaccount }),
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
  }, [userWalletAddress, userSubaccount, onStatusChange])

  // Fetch live positions from chain (works even when bot is not running)
  const fetchLivePositions = useCallback(async () => {
    if (!userSubaccount) {
      console.log('[Positions] No subaccount, skipping fetch')
      return
    }
    try {
      const response = await fetch(`/api/positions?userSubaccount=${encodeURIComponent(userSubaccount)}`)
      if (response.ok) {
        const data = await response.json()
        console.log('[Positions] Fetched:', data.positions?.length || 0, 'positions', data.positions?.map((p: any) => p.market))
        setLivePositions(data.positions || [])
      } else {
        console.error('[Positions] API error:', response.status)
      }
    } catch (e) {
      console.error('[Positions] Fetch error:', e)
    }
  }, [userSubaccount])

  // Close a position
  // Track closing progress: { posKey: { initialSize, currentSize, startTime } }
  const [closingProgress, setClosingProgress] = useState<Record<string, {
    initialSize: number,
    market: string,
    direction: string,
    startTime: number
  }>>({})

  const handleClosePosition = useCallback(async (position: {
    market: string,
    marketAddress: string,
    direction: 'long' | 'short',
    sizeRaw: number
  }) => {
    const posKey = `${position.marketAddress}-${position.direction}`
    setClosingPositions(prev => new Set(prev).add(posKey))

    // Track initial size for progress
    setClosingProgress(prev => ({
      ...prev,
      [posKey]: {
        initialSize: position.sizeRaw,
        market: position.market,
        direction: position.direction,
        startTime: Date.now()
      }
    }))

    try {
      const response = await fetch('/api/bot/close-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userWalletAddress,
          userSubaccount,
          marketAddress: position.marketAddress,
          marketName: position.market,
          sizeRaw: position.sizeRaw,
          isLong: position.direction === 'long',
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Check for delegation error
        if (data.needsDelegation) {
          toast.error('Delegation Required', {
            description: 'Please click "Delegate Permissions" below to allow the bot to close positions.',
            duration: 8000,
          })
          setClosingPositions(prev => {
            const next = new Set(prev)
            next.delete(posKey)
            return next
          })
          setClosingProgress(prev => {
            const next = { ...prev }
            delete next[posKey]
            return next
          })
          return
        }
        throw new Error(data.details || data.error || 'Failed to close position')
      }

      toast.success('Closing Position', {
        description: `TWAP close for ${position.direction.toUpperCase()} ${position.market} submitted. Monitoring progress...`,
        duration: 5000,
      })

      // Poll for close completion (every 5 seconds for up to 2 minutes)
      let pollCount = 0
      const maxPolls = 24 // 2 minutes
      const pollInterval = setInterval(async () => {
        pollCount++
        await fetchLivePositions()

        // Check if position is gone or size reduced
        const currentPos = livePositions.find(p =>
          p.marketAddress === position.marketAddress && p.direction === position.direction
        )

        if (!currentPos || currentPos.sizeRaw === 0) {
          // Position fully closed
          clearInterval(pollInterval)
          setClosingPositions(prev => {
            const next = new Set(prev)
            next.delete(posKey)
            return next
          })
          setClosingProgress(prev => {
            const next = { ...prev }
            delete next[posKey]
            return next
          })
          toast.success('Position Closed', {
            description: `${position.direction.toUpperCase()} ${position.market} fully closed!`,
            duration: 5000,
          })
        } else if (pollCount >= maxPolls) {
          // Timeout
          clearInterval(pollInterval)
          setClosingPositions(prev => {
            const next = new Set(prev)
            next.delete(posKey)
            return next
          })
          setClosingProgress(prev => {
            const next = { ...prev }
            delete next[posKey]
            return next
          })
          toast.info('Close in progress', {
            description: 'Position may still be closing. Refresh to check status.',
          })
        }
      }, 5000)

    } catch (err: any) {
      toast.error('Failed to close position', {
        description: err.message,
      })
      setClosingPositions(prev => {
        const next = new Set(prev)
        next.delete(posKey)
        return next
      })
      setClosingProgress(prev => {
        const next = { ...prev }
        delete next[posKey]
        return next
      })
    }
  }, [userSubaccount, fetchLivePositions, livePositions])

  // Trigger a trade tick
  const triggerTick = useCallback(async () => {
    if (isExecuting || !isRunning) return

    setIsExecuting(true)
    try {
      const response = await fetch('/api/bot/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userWalletAddress, userSubaccount }),
      })

      const data = await response.json()
      console.log('Bot tick result:', response.status, data)

      // Handle HTTP errors first
      if (!response.ok && response.status !== 429) {
        console.error('Bot tick failed:', response.status, data)
        toast.error('Bot Error', {
          description: data.error || `HTTP ${response.status}`,
          duration: 5000,
        })
        // If bot not found, stop showing as running
        if (response.status === 404 && onStatusChange) {
          onStatusChange(false)
        }
        return
      }

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
      } else if (data.status === 'monitoring' || data.isManualPosition) {
        // Bot is monitoring position OR detected manual position - update state for persistent UI display
        if (data.currentPnl !== undefined && data.positionDirection) {
          // Get the correct market from position or bot config
          const posMarket = data.manualPositionMarket || data.market
          // Get leverage from allPositions if available
          const posLeverage = data.allPositions?.[0]?.leverage || 40
          setMonitoringInfo({
            pnl: data.currentPnl,
            direction: data.positionDirection,
            size: data.positionSize,
            entry: data.positionEntry,
            currentPrice: data.currentPrice,
            isManual: data.isManualPosition,
            market: posMarket,
            leverage: posLeverage
          })
        }
        // Store ALL positions for display
        if (data.allPositions && data.allPositions.length > 0) {
          setAllPositions(data.allPositions)
        }
      } else if (data.status === 'executed' && !data.positionSize) {
        // Position was closed (TP/SL triggered or manually closed) - clear monitoring info
        setMonitoringInfo(null)
        // Update allPositions from response (may still have manual positions)
        if (data.allPositions) {
          setAllPositions(data.allPositions)
        } else {
          setAllPositions([])
        }
      } else if (!data.positionSize && !data.isManualPosition && monitoringInfo) {
        // No position exists - clear monitoring info
        setMonitoringInfo(null)
        // But check if there are still other positions
        if (data.allPositions) {
          setAllPositions(data.allPositions)
        } else {
          setAllPositions([])
        }
      } else if (data.success && data.volumeGenerated) {
        // Trade executed - also update allPositions
        if (data.allPositions) {
          setAllPositions(data.allPositions)
        }
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
        `/api/bot/status?userWalletAddress=${encodeURIComponent(userWalletAddress)}&userSubaccount=${encodeURIComponent(userSubaccount)}`
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
  }, [userWalletAddress, userSubaccount, isRunning, isExecuting, onStatusChange])

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(
          `/api/bot/status?userWalletAddress=${encodeURIComponent(userWalletAddress)}&userSubaccount=${encodeURIComponent(userSubaccount)}`
        )

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const data = await response.json()

        // Only show status if the bot is running for the currently selected subaccount
        const botSubaccount = data.config?.userSubaccount
        const isForThisSubaccount = botSubaccount === userSubaccount

        if (isForThisSubaccount) {
          setStatus(data.status)
          setConfig(data.config)
          setSessionId(data.sessionId || null)
        } else {
          // Bot is running on a different subaccount, clear status
          setStatus(null)
          setConfig(null)
          setSessionId(null)
        }

        const isRunningForThisSubaccount = data.isRunning && isForThisSubaccount
        if (isRunningForThisSubaccount && !isRunning && onStatusChange) {
          onStatusChange(true)
        } else if (!isRunningForThisSubaccount && isRunning && onStatusChange) {
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
  }, [userWalletAddress, userSubaccount, isRunning])

  // Poll for live positions (especially important when bot is NOT running)
  useEffect(() => {
    // Fetch immediately
    fetchLivePositions()

    // Poll every 10 seconds
    const interval = setInterval(fetchLivePositions, 10000)
    return () => clearInterval(interval)
  }, [fetchLivePositions])

  // Get tick interval based on strategy
  // TX Spammer: 5 seconds (rapid fire)
  // High risk: 8 seconds (very fast for quick TP/SL monitoring)
  // Other strategies: 60 seconds
  const tickInterval = config?.strategy === 'tx_spammer' ? 5
    : config?.strategy === 'high_risk' ? 8
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

  // Calculate volume progress if we have status
  const volumeProgress = status && config
    ? (status.cumulativeVolume / config.volumeTargetUSDC) * 100
    : 0

  // Show component if we have positions OR if bot is running
  const hasContent = (status && config) || livePositions.length > 0

  if (!hasContent) {
    return null
  }

  return (
    <div className="space-y-4 font-mono">
      {/* Live Positions Panel - Show when NOT running but have positions */}
      {!isRunning && livePositions.length > 0 && (
        <div className="border border-purple-500/30 relative" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-purple-500" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-purple-500" />

          {/* Header */}
          <div className="px-4 py-3 bg-purple-500/5 border-b border-purple-500/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <h3 className="text-purple-400 text-sm uppercase tracking-widest font-bold">Live Positions</h3>
            </div>
            <span className="text-[10px] text-purple-400 uppercase tracking-wider">
              {livePositions.length} open
            </span>
          </div>

          <div className="p-4 space-y-3">
            {livePositions.map((pos, idx) => {
              const posKey = `${pos.marketAddress}-${pos.direction}`
              const isClosing = closingPositions.has(posKey)
              const closeInfo = closingProgress[posKey]
              const symbol = pos.market.split('/')[0]

              // Calculate close progress
              let closePercent = 0
              let elapsedSeconds = 0
              if (isClosing && closeInfo) {
                closePercent = Math.round((1 - (pos.sizeRaw / closeInfo.initialSize)) * 100)
                if (closePercent < 0) closePercent = 0
                if (closePercent > 100) closePercent = 100
                elapsedSeconds = Math.floor((Date.now() - closeInfo.startTime) / 1000)
              }

              return (
                <div
                  key={`${pos.market}-${idx}`}
                  className={cn(
                    "p-3 relative border",
                    pos.direction === 'long'
                      ? "bg-green-500/5 border-green-500/30"
                      : "bg-red-500/5 border-red-500/30"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "px-2 py-0.5 text-[10px] font-bold uppercase",
                        pos.direction === 'long'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      )}>
                        {pos.direction === 'long' ? '↑ LONG' : '↓ SHORT'}
                      </span>
                      <span className="text-sm text-white font-medium">{pos.market}</span>
                      <span className="text-[9px] px-1 py-0.5 bg-zinc-800 text-zinc-400">
                        {pos.leverage || 1}x
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-bold tabular-nums min-w-[60px] text-right transition-colors duration-200",
                        (pos.pnlPercentLeveraged ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {(pos.pnlPercentLeveraged ?? 0) >= 0 ? '+' : ''}{(pos.pnlPercentLeveraged ?? 0).toFixed(2)}%
                      </span>
                      <span className={cn(
                        "text-xs tabular-nums min-w-[70px] transition-colors duration-200",
                        pos.pnlUsd !== undefined && pos.pnlUsd >= 0 ? "text-green-400/70" : "text-red-400/70",
                        pos.pnlUsd === undefined && "opacity-0"
                      )}>
                        ({(pos.pnlUsd ?? 0) >= 0 ? '+' : ''}${(pos.pnlUsd ?? 0).toFixed(2)})
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-[10px] mb-3">
                    <div>
                      <span className="text-zinc-500 block">Size</span>
                      <span className="text-white font-medium">
                        {pos.size.toFixed(4)} {symbol}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Entry</span>
                      <span className="text-white font-medium">${pos.entryPrice.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Current</span>
                      <span className="text-white font-medium">${pos.currentPrice?.toFixed(2) || '-'}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Margin</span>
                      <span className="text-white font-medium">${pos.marginUsed?.toFixed(0) || '-'}</span>
                    </div>
                  </div>

                  {/* Close Position Button */}
                  <button
                    onClick={() => handleClosePosition({
                      market: pos.market,
                      marketAddress: pos.marketAddress,
                      direction: pos.direction,
                      sizeRaw: pos.sizeRaw,
                    })}
                    disabled={isClosing}
                    className={cn(
                      "w-full h-8 text-xs font-bold font-mono tracking-wider border relative overflow-hidden group transition-all duration-300",
                      isClosing
                        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                        : "bg-red-500/20 hover:bg-red-500/40 text-red-400 border-red-500/50",
                      "disabled:cursor-not-allowed"
                    )}
                  >
                    {/* Progress bar background */}
                    {isClosing && closePercent > 0 && (
                      <div
                        className="absolute inset-0 bg-yellow-500/30 transition-all duration-500"
                        style={{ width: `${closePercent}%` }}
                      />
                    )}
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {isClosing ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          CLOSING {closePercent > 0 ? `${closePercent}%` : '...'} {elapsedSeconds > 0 && `(${elapsedSeconds}s)`}
                        </>
                      ) : (
                        <>
                          <X className="w-3 h-3" />
                          CLOSE POSITION
                        </>
                      )}
                    </span>
                  </button>
                </div>
              )
            })}

            <p className="text-[10px] text-zinc-500 text-center pt-2">
              Positions opened via Decibel UI · Close uses 1-minute TWAP
            </p>
          </div>
        </div>
      )}

      {/* Status Panel - ALWAYS SHOW FIRST when running */}
      {isRunning && status && config && (
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
                  ${status?.cumulativeVolume?.toFixed(0) || '0'} / ${config?.volumeTargetUSDC?.toFixed(0) || '0'}
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
              "p-3 border relative transition-colors duration-200",
              rateLimitBackoff > 0
                ? "bg-orange-500/5 border-orange-500/20"
                : "bg-primary/5 border-primary/20"
            )}>
              <div className={cn(
                "absolute -left-[1px] top-1/2 -translate-y-1/2 h-6 w-[3px] transition-colors duration-200",
                rateLimitBackoff > 0 ? "bg-orange-500/50" : "bg-primary/50"
              )} />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className={cn(
                    "w-4 h-4 transition-colors duration-200",
                    isExecuting ? "text-yellow-400 animate-pulse" :
                    rateLimitBackoff > 0 ? "text-orange-400" : "text-primary"
                  )} />
                  <span className="text-xs text-zinc-300 uppercase tracking-wider w-24">
                    {isExecuting ? 'Checking...' :
                     rateLimitBackoff > 0 ? 'Cooling down' :
                     (monitoringInfo ? 'Next check' : 'Next trade')}
                  </span>
                </div>
                <span className={cn(
                  "text-lg font-bold flex items-center justify-end gap-1 w-12 transition-colors duration-200",
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

            {/* Monitoring Info - shows when watching an open position (bot or manual) */}
            {(config?.strategy === 'high_risk' || monitoringInfo?.isManual) && (
              <div className={cn(
                "p-3 relative transition-all duration-200",
                monitoringInfo?.isManual
                  ? "bg-purple-500/10 border border-purple-500/30"
                  : "bg-blue-500/10 border border-blue-500/30",
                monitoringInfo ? "opacity-100" : "opacity-0 h-0 p-0 overflow-hidden border-0"
              )}>
                <div className={cn(
                  "absolute top-0 left-0 w-2 h-2 border-t border-l",
                  monitoringInfo?.isManual ? "border-purple-500" : "border-blue-500"
                )} />
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-xs uppercase tracking-wider",
                    monitoringInfo?.isManual ? "text-purple-300" : "text-blue-300"
                  )}>
                    {monitoringInfo?.isManual ? '📊 Manual ' : 'Monitoring '}
                    {monitoringInfo?.direction?.toUpperCase() || ''} Position
                    {monitoringInfo?.isManual && monitoringInfo?.market && (
                      <span className="ml-1 text-[9px] opacity-70">({monitoringInfo.market})</span>
                    )}
                  </span>
                  <div className="text-right">
                    <span className={cn(
                      "text-sm font-bold tabular-nums transition-colors duration-200",
                      (monitoringInfo?.pnl ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {(monitoringInfo?.pnl ?? 0) >= 0 ? '+' : ''}{(monitoringInfo?.pnl ?? 0).toFixed(3)}%
                    </span>
                    <span className={cn(
                      "text-[10px] ml-1 tabular-nums transition-colors duration-200",
                      (monitoringInfo?.pnl ?? 0) >= 0 ? "text-green-400/70" : "text-red-400/70"
                    )}>
                      ({(monitoringInfo?.pnl ?? 0) >= 0 ? '+' : ''}{((monitoringInfo?.pnl ?? 0) * (monitoringInfo?.leverage || 40)).toFixed(1)}% w/ {monitoringInfo?.leverage || 40}x)
                    </span>
                  </div>
                </div>
                {/* Position Details */}
                {monitoringInfo?.size && monitoringInfo?.entry && (
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-zinc-500">Size</span>
                      <p className="text-white font-medium">
                        {(() => {
                          const market = monitoringInfo.market || 'BTC/USD'
                          const symbol = getMarketSymbol(market)
                          // Size is already converted to human-readable by the API
                          return `${monitoringInfo.size.toFixed(4)} ${symbol}`
                        })()}
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
                {!monitoringInfo?.isManual && (
                  <div className="mt-2 text-[10px] text-zinc-500">
                    Target: +0.5% (+20% w/ 40x) · Stop: -0.3% (-12% w/ 40x)
                  </div>
                )}
                {monitoringInfo?.isManual && (
                  <div className="mt-2 text-[10px] text-purple-400/70">
                    Opened via Decibel UI · Bot will not manage this position
                  </div>
                )}
              </div>
            )}

            {/* All Open Positions - Show when multiple positions OR any manual positions exist */}
            {(() => {
              // Check if there are any positions in markets different from bot's market (manual positions)
              const hasManualPositions = livePositions.some(p => p.market !== config?.marketName)
              const shouldShow = livePositions.length > 1 || hasManualPositions

              if (!shouldShow) return null

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
                      {hasManualPositions ? 'All Open Positions' : 'Open Positions'}
                    </span>
                    <span className="text-[10px] text-zinc-500">{livePositions.length} position{livePositions.length !== 1 ? 's' : ''}</span>
                  </div>
                  {livePositions.map((pos, idx) => {
                    const posKey = `${pos.marketAddress}-${pos.direction}`
                    const isClosing = closingPositions.has(posKey)
                    const symbol = pos.market.split('/')[0]
                    // Check if this is the bot's configured market (not manual)
                    const isBotPosition = pos.market === config?.marketName

                    return (
                      <div
                        key={`${pos.market}-${idx}`}
                        className={cn(
                          "p-2 relative border",
                          !isBotPosition
                            ? "bg-purple-500/10 border-purple-500/30"
                          : "bg-blue-500/10 border-blue-500/30"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-1.5 py-0.5 text-[9px] font-bold uppercase",
                            pos.direction === 'long'
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          )}>
                            {pos.direction === 'long' ? '↑' : '↓'} {pos.direction.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-white font-medium">{pos.market}</span>
                          <span className="text-[9px] px-1 py-0.5 bg-zinc-800 text-zinc-400">
                            {pos.leverage || 10}x
                          </span>
                          {!isBotPosition && (
                            <span className="text-[8px] px-1 py-0.5 bg-purple-500/20 text-purple-400">
                              MANUAL
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-bold tabular-nums min-w-[50px] text-right transition-colors duration-200",
                            (pos.pnlPercentLeveraged ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                          )}>
                            {(pos.pnlPercentLeveraged ?? 0) >= 0 ? '+' : ''}{(pos.pnlPercentLeveraged ?? 0).toFixed(2)}%
                          </span>
                          <span className={cn(
                            "text-[9px] tabular-nums min-w-[50px] transition-colors duration-200",
                            pos.pnlUsd !== undefined && pos.pnlUsd >= 0 ? "text-green-400/70" : "text-red-400/70",
                            pos.pnlUsd === undefined && "opacity-0"
                          )}>
                            (${(pos.pnlUsd ?? 0) >= 0 ? '+' : ''}{(pos.pnlUsd ?? 0).toFixed(0)})
                          </span>
                          {/* Close button for manual positions */}
                          {!isBotPosition && (
                            <button
                              onClick={() => handleClosePosition({
                                market: pos.market,
                                marketAddress: pos.marketAddress,
                                direction: pos.direction,
                                sizeRaw: pos.sizeRaw,
                              })}
                              disabled={isClosing}
                              className="px-2 py-0.5 text-[8px] font-bold bg-red-500/20 hover:bg-red-500/40 text-red-400 border border-red-500/30 disabled:opacity-50"
                            >
                              {isClosing ? <Loader2 className="w-2 h-2 animate-spin" /> : <X className="w-2 h-2" />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 grid grid-cols-4 gap-2 text-[9px]">
                        <div>
                          <span className="text-zinc-500">Size</span>
                          <p className="text-white">
                            {pos.size.toFixed(4)} {symbol}
                          </p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Entry</span>
                          <p className="text-white">${pos.entryPrice.toFixed(2)}</p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Current</span>
                          <p className="text-white">${pos.currentPrice?.toFixed(2) || '-'}</p>
                        </div>
                        <div>
                          <span className="text-zinc-500">Margin</span>
                          <p className="text-white">${pos.marginUsed?.toFixed(0) || '-'}</p>
                        </div>
                      </div>
                    </div>
                    )
                  })}
                </div>
              )
            })()}

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
      {status && status.orderHistory && status.orderHistory.length > 0 && (
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
                          {order.size ? (() => {
                            const market = order.market || config?.marketName || 'BTC/USD'
                            const decimals = SIZE_DECIMALS[market] || 8
                            return (Number(order.size) / Math.pow(10, decimals)).toFixed(4)
                          })() : '-'}
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
      {!isRunning && status && status.orderHistory && status.orderHistory.length > 0 && (() => {
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
