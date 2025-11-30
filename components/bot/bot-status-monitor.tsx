"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Activity, TrendingUp, Target, Clock, Zap } from "lucide-react"
import { OrderHistoryTable } from "./order-history-table"
import { PnLChart } from "./pnl-chart"

interface BotStatusMonitorProps {
  userWalletAddress: string
  isRunning: boolean
  onStatusChange?: (isRunning: boolean) => void
}

export function BotStatusMonitor({ userWalletAddress, isRunning, onStatusChange }: BotStatusMonitorProps) {
  const [status, setStatus] = useState<any>(null)
  const [config, setConfig] = useState<any>(null)
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

      if (data.success) {
        lastTickTimeRef.current = Date.now()
        // Immediately fetch updated status
        const statusResponse = await fetch(
          `/api/bot/status?userWalletAddress=${encodeURIComponent(userWalletAddress)}`
        )
        const statusData = await statusResponse.json()
        if (statusData.status) {
          setStatus(statusData.status)
        }
      }
    } catch (error) {
      console.error('Error triggering bot tick:', error)
    } finally {
      setIsExecuting(false)
    }
  }, [userWalletAddress, isRunning, isExecuting])

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

        if (data.isRunning) {
          setStatus(data.status)
          setConfig(data.config)
          // Notify parent if status changed
          if (!isRunning && onStatusChange) {
            onStatusChange(true)
          }
        } else {
          // Bot not running
          setStatus(data.status) // Keep status for history display
          setConfig(data.config) // Keep config for history display
          // Notify parent if status changed
          if (isRunning && onStatusChange) {
            onStatusChange(false)
          }
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
    <div className="space-y-6">
      {/* PNL Chart - Show first if there's PNL data */}
      {status.orderHistory && status.orderHistory.length > 0 && (
        <PnLChart orders={status.orderHistory} />
      )}

      {/* Order History Table - Always show if there are orders */}
      {status.orderHistory && status.orderHistory.length > 0 && (
        <OrderHistoryTable orders={status.orderHistory} />
      )}

      {/* Only show status card if bot is running */}
      {!isRunning && (
        <Card className="bg-black/40 border-white/10">
          <CardHeader>
            <CardTitle className="text-white">Trade History</CardTitle>
            <CardDescription>Your past bot trades are shown above</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Status Card - Only show when running */}
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

        {/* Configuration Summary */}
        <div className="p-4 bg-black/40 border border-white/10 rounded-lg space-y-2">
          <h4 className="font-medium text-white text-sm">Configuration</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-zinc-500">Market:</span>
              <span className="text-white ml-2 font-medium">{config.marketName}</span>
            </div>
            <div>
              <span className="text-zinc-500">Bias:</span>
              <Badge
                variant="outline"
                className={
                  config.bias === 'long'
                    ? 'ml-2 bg-green-500/10 text-green-400 border-green-500/30'
                    : config.bias === 'short'
                    ? 'ml-2 bg-red-500/10 text-red-400 border-red-500/30'
                    : 'ml-2 bg-primary/10 text-primary border-primary/30'
                }
              >
                {config.bias.toUpperCase()}
              </Badge>
            </div>
            <div>
              <span className="text-zinc-500">Capital:</span>
              <span className="text-white ml-2 font-medium">${config.capitalUSDC.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-zinc-500">Next Order:</span>
              <span className="text-white ml-2 font-medium">~10 min</span>
            </div>
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

        {/* Info */}
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-2">
          <p className="text-xs text-blue-400 font-medium">
            ℹ️ How it works:
          </p>
          <ul className="text-xs text-blue-300 space-y-1 ml-4">
            <li>• Bot executes TWAP orders every 60 seconds while this page is open</li>
            <li>• Orders are placed on Aptos testnet and tracked in our database</li>
            <li>• You can close this tab - trades will continue via our cron job</li>
            <li>• Each order generates ~$876 in volume toward your target</li>
          </ul>
        </div>
      </CardContent>
    </Card>
      )}
    </div>
  )
}
