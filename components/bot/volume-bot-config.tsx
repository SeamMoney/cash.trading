"use client"

import { useState } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { useVolumeBot } from "@/hooks/use-volume-bot"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Minus, Play, Square, Activity, Target, Clock, ExternalLink } from "lucide-react"
import { OrderHistoryTable } from "./order-history-table"

type Bias = "long" | "short" | "neutral"

export function VolumeBotConfig() {
  const { account, connected } = useWallet()
  const { balance, subaccount } = useWalletBalance()
  const bot = useVolumeBot()

  const [capital, setCapital] = useState<string>("")
  const [volumeTarget, setVolumeTarget] = useState<number>(500)
  const [bias, setBias] = useState<Bias>("neutral")
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSetMax = () => {
    if (balance !== null) {
      setCapital(balance.toString())
    }
  }

  const handleStart = () => {
    if (!subaccount || !capital) {
      setLocalError("Please connect wallet and enter capital amount")
      return
    }

    const capitalNum = parseFloat(capital)
    if (isNaN(capitalNum) || capitalNum <= 0) {
      setLocalError("Please enter a valid capital amount")
      return
    }

    if (capitalNum > (balance || 0)) {
      setLocalError(`Insufficient balance. You have $${balance?.toFixed(2)} USDC`)
      return
    }

    setLocalError(null)

    bot.start({
      capitalUSDC: capitalNum,
      volumeTargetUSDC: volumeTarget,
      bias,
      subaccount,
    })
  }

  const handleStop = () => {
    bot.stop()
  }

  if (!connected) {
    return (
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Volume Market Maker Bot</CardTitle>
          <CardDescription>Connect your wallet to get started</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const volumeProgress = bot.config ? (bot.cumulativeVolume / bot.config.volumeTargetUSDC) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Order History Table */}
      {bot.isRunning && bot.orderHistory && bot.orderHistory.length > 0 && (
        <OrderHistoryTable orders={bot.orderHistory} />
      )}

      {/* Live Status - Shows when running */}
      {bot.isRunning && bot.config && (
        <Card className="bg-black/40 border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary animate-pulse" />
                Bot Running
              </CardTitle>
              <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                Active
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Volume Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-300">Volume Progress</span>
                <span className="text-white font-bold">
                  ${bot.cumulativeVolume.toFixed(2)} / ${bot.config.volumeTargetUSDC}
                </span>
              </div>
              <Progress value={volumeProgress} className="h-3" />
              <p className="text-xs text-zinc-500 text-right">{volumeProgress.toFixed(1)}% complete</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <div className="text-xs text-zinc-500 mb-1">Orders</div>
                <div className="text-2xl font-bold text-white">{bot.ordersPlaced}</div>
              </div>
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <div className="text-xs text-zinc-500 mb-1">Last Order</div>
                <div className="text-sm font-medium text-white">
                  {bot.lastOrderTime ? new Date(bot.lastOrderTime).toLocaleTimeString() : 'Waiting...'}
                </div>
              </div>
            </div>

            {bot.error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400">{bot.error}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configuration Card */}
      <Card className="bg-black/40 border-white/10">
      <CardHeader>
        <CardTitle className="text-white">Volume Market Maker Bot</CardTitle>
        <CardDescription>
          Autonomous TWAP bot that generates trading volume efficiently
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Capital Input */}
        <div className="space-y-2">
          <Label htmlFor="capital" className="text-zinc-300">
            Capital Amount (USDC)
          </Label>
          <div className="flex gap-2">
            <Input
              id="capital"
              type="number"
              placeholder="100"
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              disabled={bot.isRunning}
              className="bg-black/40 border-white/10 text-white"
            />
            <Button
              onClick={handleSetMax}
              disabled={bot.isRunning}
              variant="outline"
              className="border-primary/30 text-primary hover:bg-primary/10"
            >
              MAX
            </Button>
          </div>
          {balance !== null && (
            <p className="text-xs text-zinc-500">
              Available: ${balance.toFixed(2)} USDC
            </p>
          )}
        </div>

        {/* Volume Target Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-zinc-300">Volume Target</Label>
            <span className="text-lg font-bold text-primary">
              ${volumeTarget.toFixed(0)}
            </span>
          </div>
          <Slider
            value={[volumeTarget]}
            onValueChange={([value]) => setVolumeTarget(value)}
            min={100}
            max={10000}
            step={100}
            disabled={bot.isRunning}
            className="py-4"
          />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>$100</span>
            <span>$10,000</span>
          </div>
        </div>

        {/* Bias Selector */}
        <div className="space-y-2">
          <Label className="text-zinc-300">Directional Bias</Label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => setBias("long")}
              disabled={bot.isRunning}
              variant={bias === "long" ? "default" : "outline"}
              className={
                bias === "long"
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "border-white/10 text-zinc-400 hover:bg-white/5"
              }
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Long
            </Button>
            <Button
              onClick={() => setBias("neutral")}
              disabled={bot.isRunning}
              variant={bias === "neutral" ? "default" : "outline"}
              className={
                bias === "neutral"
                  ? "bg-primary hover:bg-primary/90 text-black"
                  : "border-white/10 text-zinc-400 hover:bg-white/5"
              }
            >
              <Minus className="w-4 h-4 mr-2" />
              Neutral
            </Button>
            <Button
              onClick={() => setBias("short")}
              disabled={bot.isRunning}
              variant={bias === "short" ? "default" : "outline"}
              className={
                bias === "short"
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "border-white/10 text-zinc-400 hover:bg-white/5"
              }
            >
              <TrendingDown className="w-4 h-4 mr-2" />
              Short
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            {bias === "long" && "Bot will only place long orders"}
            {bias === "short" && "Bot will only place short orders"}
            {bias === "neutral" && "Bot will alternate between long and short"}
          </p>
        </div>

        {/* Error Display */}
        {localError && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{localError}</p>
          </div>
        )}

        {/* Start/Stop Button */}
        <Button
          onClick={bot.isRunning ? handleStop : handleStart}
          className={
            bot.isRunning
              ? "w-full bg-red-500 hover:bg-red-600 text-white"
              : "w-full bg-primary hover:bg-primary/90 text-black font-bold"
          }
          size="lg"
        >
          {bot.isRunning ? (
            <>
              <Square className="w-4 h-4 mr-2" />
              Stop Bot
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2" />
              Start Bot
            </>
          )}
        </Button>

        {/* Bot Info */}
        {!bot.isRunning && (
          <div className="p-4 bg-black/40 border border-white/10 rounded-lg space-y-2">
            <h4 className="font-medium text-white text-sm">How it works:</h4>
            <ul className="text-xs text-zinc-400 space-y-1">
              <li>• Places TWAP orders every 30 seconds (FAST!)</li>
              <li>• Uses 3% of capital per order</li>
              <li>• Each order duration: 1-2 minutes</li>
              <li>• Alternates long/short for neutral bias</li>
              <li>• Runs in your browser tab (keep it open)</li>
              <li>• You sign each transaction with your wallet</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
    </div>
  )
}
