"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TrendingUp, TrendingDown, Minus, Play, Square, Settings2, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
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
  const [aggressiveness, setAggressiveness] = useState<number>(5)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [delegating, setDelegating] = useState(false)
  const [hasDelegation, setHasDelegation] = useState(false)

  const MARKETS = {
    "BTC/USD": "0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e",
    "ETH/USD": "0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2",
  }

  useEffect(() => {
    const checkActiveTWAPs = async () => {
      if (!account) return
      try {
        const response = await fetch(`/api/bot/status?userWalletAddress=${account.address.toString()}`)
        const data = await response.json()
        if (data.isRunning) {
          setIsRunning(true)
          setError(null)
        } else {
          setIsRunning(false)
          setError(null)
        }
      } catch (err) {
        console.error('Failed to check bot status:', err)
      }
    }
    checkActiveTWAPs()
  }, [account])

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
      const response = await fetch("/api/bot/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userSubaccount: subaccount }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to get delegation payload")
      }

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
          aggressiveness,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to start bot")
      }

      setIsRunning(true)
      toast.success('Bot Started', {
        description: `Trading ${market} with $${capitalNum.toFixed(0)} toward $${volumeTarget} volume`,
      })
    } catch (err: any) {
      setError(err.message || "Failed to start bot")
      toast.error('Failed to start bot', {
        description: err.message,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    if (!account) return

    setLoading(true)
    setError(null)
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
      toast.info('Bot Stopped', {
        description: 'Trading has been paused',
      })
    } catch (err: any) {
      setError(err.message || "Failed to stop bot")
      toast.error('Failed to stop bot', {
        description: err.message,
      })
    } finally {
      setLoading(false)
    }
  }

  if (!connected) {
    return (
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-6 relative">
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white/20" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
        <h3 className="text-white font-mono font-bold tracking-wide">Volume Market Maker Bot</h3>
        <p className="text-zinc-500 font-mono text-sm mt-1">Connect your wallet to get started</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Bot Status Monitor */}
      {account && (
        <BotStatusMonitor
          userWalletAddress={account.address.toString()}
          isRunning={isRunning}
          onStatusChange={setIsRunning}
        />
      )}

      {/* Main Configuration Panel */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 relative">
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-primary/50" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-primary/50" />

        {/* Header */}
        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-primary" />
            <h3 className="text-primary font-mono text-sm uppercase tracking-widest font-bold">Volume Bot Config</h3>
          </div>
          <div className="flex gap-1">
            <div className={cn("w-2 h-2", isRunning ? "bg-green-500 animate-pulse" : "bg-zinc-600")} />
          </div>
        </div>

        <div className="p-6 space-y-6 font-mono">
          {/* Capital Input */}
          <div className="space-y-2">
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Capital Amount</h3>
            <div className="bg-black/40 backdrop-blur-sm border border-primary/30 p-4 relative group hover:border-primary/60 transition-colors">
              <div className="absolute -left-[1px] top-1/2 -translate-y-1/2 h-8 w-[3px] bg-primary/50 group-hover:bg-primary transition-colors" />
              <div className="flex items-center gap-4">
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                  disabled={isRunning || loading}
                  className="flex-1 bg-transparent border-none text-3xl md:text-4xl font-mono text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50"
                  placeholder="0.00"
                />
                <Button
                  onClick={handleSetMax}
                  disabled={isRunning || loading}
                  variant="outline"
                  className="border-primary/50 text-primary hover:bg-primary/10 rounded-none font-mono text-xs tracking-widest"
                >
                  MAX
                </Button>
              </div>
              {balance !== null && (
                <p className="text-xs text-zinc-500 mt-2">
                  Available: <span className="text-primary">${balance.toFixed(2)} USDC</span>
                </p>
              )}
            </div>
          </div>

          {/* Volume Target */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Volume Target</h3>
              <span className="text-2xl font-bold text-primary font-mono">${volumeTarget.toFixed(0)}</span>
            </div>
            <div className="relative h-8 flex items-center px-2 border border-white/10 bg-black/20">
              <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-zinc-800 via-primary/30 to-primary" />
              <Slider
                value={[volumeTarget]}
                onValueChange={([value]) => setVolumeTarget(value)}
                min={100}
                max={10000}
                step={100}
                disabled={isRunning || loading}
                className="cursor-pointer relative z-10"
              />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
              <span>$100</span>
              <span>$10,000</span>
            </div>
          </div>

          {/* Market Selector */}
          <div className="space-y-3">
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Trading Pair</h3>
            <div className="grid grid-cols-2 gap-1 bg-black/40 border border-white/10 p-1">
              {Object.keys(MARKETS).map((marketName) => (
                <button
                  key={marketName}
                  onClick={() => setMarket(marketName)}
                  disabled={isRunning || loading}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 transition-all relative overflow-hidden font-mono disabled:opacity-50",
                    market === marketName
                      ? "bg-primary/10 text-primary border border-primary/50"
                      : "text-zinc-500 hover:bg-white/5 border border-transparent"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 flex items-center justify-center text-[10px] font-bold text-white",
                    marketName === "BTC/USD" ? "bg-[#F7931A]" : "bg-[#627EEA]"
                  )}>
                    {marketName === "BTC/USD" ? "₿" : "♦"}
                  </div>
                  <span className="font-bold tracking-wider">{marketName.split("/")[0]}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Selected: <span className="text-white">{market}</span>
            </p>
          </div>

          {/* Aggressiveness */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Bot Speed</h3>
              <span className="text-lg font-bold text-primary font-mono">{aggressiveness}/10</span>
            </div>
            <div className="relative h-8 flex items-center px-2 border border-white/10 bg-black/20">
              <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-green-500/30 via-yellow-500/30 to-red-500/30" />
              <Slider
                value={[aggressiveness]}
                onValueChange={([value]) => setAggressiveness(value)}
                min={1}
                max={10}
                step={1}
                disabled={isRunning || loading}
                className="cursor-pointer relative z-10"
              />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
              <span>Slow (2 min)</span>
              <span>Ultra Fast (10 sec)</span>
            </div>
            <div className="p-2 bg-black/40 border border-white/10">
              <p className="text-xs text-zinc-400">
                {aggressiveness <= 3 && "📊 Conservative - Orders every 1-2 minutes"}
                {aggressiveness > 3 && aggressiveness <= 7 && "⚡ Moderate - Orders every 30-60 seconds"}
                {aggressiveness > 7 && "🔥 Aggressive HFT - Orders every 10-20 seconds!"}
              </p>
            </div>
          </div>

          {/* Bias Selector */}
          <div className="space-y-3">
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Directional Bias</h3>
            <div className="grid grid-cols-3 gap-1 bg-black/40 border border-white/10 p-1">
              <button
                onClick={() => setBias("long")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group disabled:opacity-50",
                  bias === "long"
                    ? "bg-green-500/10 text-green-500 border border-green-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                {bias === "long" && <div className="absolute inset-0 bg-green-500/5 animate-pulse" />}
                <TrendingUp className="w-4 h-4 mb-1 relative z-10" />
                <span className="font-bold text-sm tracking-wider relative z-10">Long</span>
              </button>
              <button
                onClick={() => setBias("neutral")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group disabled:opacity-50",
                  bias === "neutral"
                    ? "bg-primary/10 text-primary border border-primary/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                <Minus className="w-4 h-4 mb-1 relative z-10" />
                <span className="font-bold text-sm tracking-wider relative z-10">Neutral</span>
              </button>
              <button
                onClick={() => setBias("short")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group disabled:opacity-50",
                  bias === "short"
                    ? "bg-red-500/10 text-red-500 border border-red-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                {bias === "short" && <div className="absolute inset-0 bg-red-500/5 animate-pulse" />}
                <TrendingDown className="w-4 h-4 mb-1 relative z-10" />
                <span className="font-bold text-sm tracking-wider relative z-10">Short</span>
              </button>
            </div>
            <p className="text-[10px] text-zinc-500">
              {bias === "long" && "Bot will only place long orders"}
              {bias === "short" && "Bot will only place short orders"}
              {bias === "neutral" && "Bot will alternate between long and short"}
            </p>
          </div>

          {/* Strategy Selector */}
          <div className="space-y-3">
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Trading Strategy</h3>
            <div className="grid grid-cols-2 gap-1 bg-black/40 border border-white/10 p-1">
              <button
                onClick={() => setStrategy("twap")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-start p-3 transition-all relative overflow-hidden disabled:opacity-50",
                  strategy === "twap"
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                <span className="font-bold text-sm tracking-wider">TWAP</span>
                <span className="text-[10px] opacity-70">Passive volume</span>
              </button>
              <button
                onClick={() => setStrategy("market_maker")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-start p-3 transition-all relative overflow-hidden disabled:opacity-50",
                  strategy === "market_maker"
                    ? "bg-purple-500/10 text-purple-400 border border-purple-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                <span className="font-bold text-sm tracking-wider">Market Maker</span>
                <span className="text-[10px] opacity-70">Active PNL</span>
              </button>
              <button
                onClick={() => setStrategy("delta_neutral")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-start p-3 transition-all relative overflow-hidden disabled:opacity-50",
                  strategy === "delta_neutral"
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                <span className="font-bold text-sm tracking-wider">Delta Neutral</span>
                <span className="text-[10px] opacity-70">Hedged positions</span>
              </button>
              <button
                onClick={() => setStrategy("high_risk")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-start p-3 transition-all relative overflow-hidden disabled:opacity-50",
                  strategy === "high_risk"
                    ? "bg-orange-500/10 text-orange-400 border border-orange-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                {strategy === "high_risk" && <div className="absolute inset-0 bg-orange-500/5 animate-pulse" />}
                <span className="font-bold text-sm tracking-wider relative z-10">High Risk</span>
                <span className="text-[10px] opacity-70 relative z-10">Max PNL swings</span>
              </button>
            </div>
            <div className="p-2 bg-black/40 border border-white/10">
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
            <div className="p-3 bg-red-500/10 border border-red-500/30 relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500" />
              <p className="text-sm text-red-400 font-mono">{error}</p>
            </div>
          )}

          {/* Delegation Section */}
          {!isRunning && !hasDelegation && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-blue-500" />
                <p className="text-xs text-blue-400 mb-2 font-mono">
                  ℹ️ First-time users must delegate trading permissions to the bot operator.
                </p>
                <p className="text-xs text-zinc-500">
                  This is a one-time transaction that allows the bot to place orders on your behalf.
                  Your funds stay in YOUR wallet - the bot can only trade, not withdraw.
                </p>
              </div>
              <Button
                onClick={handleDelegate}
                disabled={delegating}
                variant="outline"
                className="w-full border-primary/50 text-primary hover:bg-primary/10 rounded-none font-mono uppercase tracking-widest"
              >
                {delegating ? "Delegating..." : "Delegate Permissions"}
              </Button>
            </div>
          )}

          {!isRunning && hasDelegation && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 relative">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-green-500" />
              <p className="text-xs text-green-400 font-mono">
                ✅ Permissions delegated! You can now start the bot.
              </p>
            </div>
          )}

          {/* Start/Stop Button */}
          <Button
            onClick={isRunning ? handleStop : handleStart}
            disabled={loading}
            className={cn(
              "w-full h-14 text-lg font-bold font-mono tracking-[0.2em] rounded-none border relative overflow-hidden group transition-all duration-300 disabled:opacity-50",
              isRunning
                ? "bg-red-500/90 hover:bg-red-500 text-white border-red-500 shadow-[0_0_30px_-5px_rgba(239,68,68,0.6)] hover:shadow-[0_0_50px_-10px_rgba(239,68,68,0.8)]"
                : "bg-primary/90 hover:bg-primary text-black border-primary shadow-[0_0_30px_-5px_rgba(255,246,0,0.6)] hover:shadow-[0_0_50px_-10px_rgba(255,246,0,0.8)]"
            )}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {loading ? (
                "PROCESSING..."
              ) : isRunning ? (
                <>
                  <Square className="w-5 h-5" />
                  STOP BOT
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  START BOT
                </>
              )}
            </span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <div className="absolute bottom-0 left-0 w-full h-1 bg-white/50" />
          </Button>

          {/* Bot Info */}
          {!isRunning && (
            <div className="p-4 bg-black/40 border border-white/10 relative">
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
              <h4 className="font-mono text-xs uppercase tracking-widest text-primary mb-3">How it works:</h4>
              <ul className="text-xs text-zinc-500 space-y-1 font-mono">
                <li>• Bot runs on the server (keeps running even if you close the tab)</li>
                <li>• Places TWAP orders every 10 minutes</li>
                <li>• Uses delegated permissions (you approved this once)</li>
                <li>• Alternates long/short for neutral bias</li>
                <li>• Real-time status tracking via Decibel API</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
