"use client"

import { useState, useEffect } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus, Play, Square } from "lucide-react"
import { BotStatusMonitor } from "./bot-status-monitor"

type Bias = "long" | "short" | "neutral"
type Strategy = "twap" | "market_maker" | "delta_neutral" | "high_risk"

export function ServerBotConfig() {
  const { account, connected, signAndSubmitTransaction } = useWallet()
  const { balance, subaccount } = useWalletBalance()

  const [capital, setCapital] = useState<string>("")
  const [volumeTarget, setVolumeTarget] = useState<number>(500)
  const [bias, setBias] = useState<Bias>("neutral")
  const [strategy, setStrategy] = useState<Strategy>("high_risk")
  const [market, setMarket] = useState<string>("BTC/USD")
  const [aggressiveness, setAggressiveness] = useState<number>(5) // 1-10 scale
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [delegating, setDelegating] = useState(false)
  const [hasDelegation, setHasDelegation] = useState(false)

  // Market addresses on Decibel (only BTC and ETH available on testnet)
  const MARKETS = {
    "BTC/USD": "0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e",
    "ETH/USD": "0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2",
  }

  // Check for active TWAPs on mount
  useEffect(() => {
    const checkActiveTWAPs = async () => {
      if (!account) return

      try {
        const response = await fetch(`/api/bot/status?userWalletAddress=${account.address.toString()}`)
        const data = await response.json()

        if (data.isRunning) {
          setIsRunning(true)
          setError(null) // Clear any stale errors when bot is running
        } else {
          setIsRunning(false)
          setError(null) // Clear any stale errors
        }
      } catch (err) {
        console.error('Failed to check bot status:', err)
      }
    }

    checkActiveTWAPs()
  }, [account])

  const BOT_OPERATOR = "0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da"
  const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75"

  const handleSetMax = () => {
    if (balance !== null) {
      setCapital(balance.toString())
    }
  }

  const handleDelegate = async () => {
    if (!account || !subaccount) {
      setError("Please connect wallet first")
      return
    }

    setDelegating(true)
    setError(null)

    try {
      // Get the delegation payload from our API
      const response = await fetch("/api/bot/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userSubaccount: subaccount }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to get delegation payload")
      }

      console.log("🔐 Delegating to bot operator:", data.botOperator)

      // Sign the transaction with the user's wallet
      if (!signAndSubmitTransaction) {
        throw new Error("Wallet does not support signing transactions")
      }

      const txResponse = await signAndSubmitTransaction({
        data: data.payload
      })

      console.log("✅ Delegation transaction:", txResponse.hash)
      setHasDelegation(true)
    } catch (err: any) {
      setError(err.message || "Failed to delegate permissions")
      console.error("❌ Delegation error:", err)
    } finally {
      setDelegating(false)
    }
  }

  const handleStart = async () => {
    if (!account || !subaccount || !capital) {
      setError("Please connect wallet and enter capital amount")
      return
    }

    const capitalNum = parseFloat(capital)
    if (isNaN(capitalNum) || capitalNum <= 0) {
      setError("Please enter a valid capital amount")
      return
    }

    if (capitalNum > (balance || 0)) {
      setError(`Insufficient balance. You have $${balance?.toFixed(2)} USDC`)
      return
    }

    setError(null)
    setLoading(true)

    try {
      const response = await fetch("/api/bot/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userWalletAddress: account.address.toString(),
          userSubaccount: subaccount,
          capitalUSDC: capitalNum,
          volumeTargetUSDC: volumeTarget,
          bias,
          strategy,
          market: MARKETS[market as keyof typeof MARKETS],
          marketName: market,
          aggressiveness, // Pass aggressiveness to backend
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to start bot")
      }

      setIsRunning(true)
      console.log("✅ Bot started successfully:", data)
    } catch (err: any) {
      setError(err.message || "Failed to start bot")
      console.error("❌ Bot start error:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    if (!account) return

    setLoading(true)
    setError(null) // Clear any previous errors
    try {
      const response = await fetch("/api/bot/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userWalletAddress: account.address.toString(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to stop bot")
      }

      setIsRunning(false)
      console.log("✅ Bot stopped successfully")
    } catch (err: any) {
      setError(err.message || "Failed to stop bot")
      console.error("❌ Bot stop error:", err)
    } finally {
      setLoading(false)
    }
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

  return (
    <div className="space-y-6">
      {/* Bot Status Monitor */}
      {account && (
        <BotStatusMonitor
          userWalletAddress={account.address.toString()}
          isRunning={isRunning}
          onStatusChange={setIsRunning}
        />
      )}

      {/* Configuration Card */}
      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-white">Volume Market Maker Bot (Server-Side)</CardTitle>
          <CardDescription>
            Autonomous bot running on the server with your delegated permissions
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
                disabled={isRunning || loading}
                className="bg-black/40 border-white/10 text-white"
              />
              <Button
                onClick={handleSetMax}
                disabled={isRunning || loading}
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
              disabled={isRunning || loading}
              className="py-4"
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>$100</span>
              <span>$10,000</span>
            </div>
          </div>

          {/* Market Selector */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Trading Pair</Label>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(MARKETS).map((marketName) => (
                <Button
                  key={marketName}
                  onClick={() => setMarket(marketName)}
                  disabled={isRunning || loading}
                  variant={market === marketName ? "default" : "outline"}
                  className={
                    market === marketName
                      ? "bg-primary hover:bg-primary/90 text-black font-bold"
                      : "border-white/10 text-zinc-400 hover:bg-white/5"
                  }
                >
                  {marketName.split("/")[0]}
                </Button>
              ))}
            </div>
            <p className="text-xs text-zinc-500">
              Selected: {market}
            </p>
          </div>

          {/* Aggressiveness Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300">Bot Aggressiveness</Label>
              <span className="text-lg font-bold text-primary">
                {aggressiveness}/10
              </span>
            </div>
            <Slider
              value={[aggressiveness]}
              onValueChange={([value]) => setAggressiveness(value)}
              min={1}
              max={10}
              step={1}
              disabled={isRunning || loading}
              className="py-4"
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Slow (2 min)</span>
              <span>Ultra Fast (10 sec)</span>
            </div>
            <p className="text-xs text-zinc-400">
              {aggressiveness <= 3 && "📊 Conservative - Orders every 1-2 minutes"}
              {aggressiveness > 3 && aggressiveness <= 7 && "⚡ Moderate - Orders every 30-60 seconds"}
              {aggressiveness > 7 && "🔥 Aggressive HFT - Orders every 10-20 seconds!"}
            </p>
          </div>

          {/* Bias Selector */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Directional Bias</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                onClick={() => setBias("long")}
                disabled={isRunning || loading}
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
                disabled={isRunning || loading}
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
                disabled={isRunning || loading}
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

          {/* Strategy Selector */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Trading Strategy</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => setStrategy("twap")}
                disabled={isRunning || loading}
                variant={strategy === "twap" ? "default" : "outline"}
                className={
                  strategy === "twap"
                    ? "bg-blue-500 hover:bg-blue-600 text-white h-auto py-3"
                    : "border-white/10 text-zinc-400 hover:bg-white/5 h-auto py-3"
                }
              >
                <div className="flex flex-col items-start w-full">
                  <span className="font-medium">TWAP</span>
                  <span className="text-[10px] opacity-70">Passive volume</span>
                </div>
              </Button>
              <Button
                onClick={() => setStrategy("market_maker")}
                disabled={isRunning || loading}
                variant={strategy === "market_maker" ? "default" : "outline"}
                className={
                  strategy === "market_maker"
                    ? "bg-purple-500 hover:bg-purple-600 text-white h-auto py-3"
                    : "border-white/10 text-zinc-400 hover:bg-white/5 h-auto py-3"
                }
              >
                <div className="flex flex-col items-start w-full">
                  <span className="font-medium">Market Maker</span>
                  <span className="text-[10px] opacity-70">Active PNL</span>
                </div>
              </Button>
              <Button
                onClick={() => setStrategy("delta_neutral")}
                disabled={isRunning || loading}
                variant={strategy === "delta_neutral" ? "default" : "outline"}
                className={
                  strategy === "delta_neutral"
                    ? "bg-cyan-500 hover:bg-cyan-600 text-white h-auto py-3"
                    : "border-white/10 text-zinc-400 hover:bg-white/5 h-auto py-3"
                }
              >
                <div className="flex flex-col items-start w-full">
                  <span className="font-medium">Delta Neutral</span>
                  <span className="text-[10px] opacity-70">Hedged positions</span>
                </div>
              </Button>
              <Button
                onClick={() => setStrategy("high_risk")}
                disabled={isRunning || loading}
                variant={strategy === "high_risk" ? "default" : "outline"}
                className={
                  strategy === "high_risk"
                    ? "bg-orange-500 hover:bg-orange-600 text-white h-auto py-3"
                    : "border-white/10 text-zinc-400 hover:bg-white/5 h-auto py-3"
                }
              >
                <div className="flex flex-col items-start w-full">
                  <span className="font-medium">High Risk</span>
                  <span className="text-[10px] opacity-70">Max PNL swings</span>
                </div>
              </Button>
            </div>
            <div className="p-2 bg-black/40 border border-white/10 rounded">
              <p className="text-xs text-zinc-400">
                {strategy === "twap" && "📊 Passive limit orders for volume generation. Low PNL impact."}
                {strategy === "market_maker" && "⚡ Market orders with tight spreads. Active PNL movement!"}
                {strategy === "delta_neutral" && "🔒 Opens positions and immediately hedges them. Minimal risk."}
                {strategy === "high_risk" && "🔥 Large positions with leverage. Maximum PNL volatility!"}
              </p>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Delegation section */}
          {!isRunning && !hasDelegation && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs text-blue-400 mb-2">
                  ℹ️ First-time users must delegate trading permissions to the bot operator.
                </p>
                <p className="text-xs text-zinc-400">
                  This is a one-time transaction that allows the bot to place orders on your behalf.
                  Your funds stay in YOUR wallet - the bot can only trade, not withdraw.
                </p>
              </div>
              <Button
                onClick={handleDelegate}
                disabled={delegating}
                variant="outline"
                className="w-full border-primary/30 text-primary hover:bg-primary/10"
              >
                {delegating ? "Delegating..." : "Delegate Permissions"}
              </Button>
            </div>
          )}

          {!isRunning && hasDelegation && (
            <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <p className="text-xs text-green-400">
                ✅ Permissions delegated! You can now start the bot.
              </p>
            </div>
          )}

          {/* Start/Stop Button */}
          <Button
            onClick={isRunning ? handleStop : handleStart}
            disabled={loading}
            className={
              isRunning
                ? "w-full bg-red-500 hover:bg-red-600 text-white"
                : "w-full bg-primary hover:bg-primary/90 text-black font-bold"
            }
            size="lg"
          >
            {loading ? (
              "Loading..."
            ) : isRunning ? (
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
          {!isRunning && (
            <div className="p-4 bg-black/40 border border-white/10 rounded-lg space-y-2">
              <h4 className="font-medium text-white text-sm">How it works:</h4>
              <ul className="text-xs text-zinc-400 space-y-1">
                <li>• Bot runs on the server (keeps running even if you close the tab)</li>
                <li>• Places TWAP orders every 10 minutes</li>
                <li>• Uses delegated permissions (you approved this once)</li>
                <li>• Alternates long/short for neutral bias</li>
                <li>• Real-time status tracking via Decibel API</li>
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
