"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TrendingUp, TrendingDown, Minus, Play, Square, Settings2, Zap, ChevronDown, Gauge, Timer, Flame, BarChart3, Bolt, Shield, AlertTriangle, Info, Trophy, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { BotStatusMonitor } from "./bot-status-monitor"
import { CloudStatusIndicator } from "./cloud-status-indicator"

type Bias = "long" | "short" | "neutral"
type Strategy = "twap" | "market_maker" | "delta_neutral" | "high_risk" | "tx_spammer"

export function ServerBotConfig() {
  const { account, connected, signAndSubmitTransaction } = useWallet()
  const { balance, subaccount, allSubaccounts, selectedSubaccountType, setSelectedSubaccountType } = useWalletBalance()

  const [capital, setCapital] = useState<string>("")
  const [volumeTarget, setVolumeTarget] = useState<number>(10000)
  const [bias, setBias] = useState<Bias>("neutral")
  const [strategy, setStrategy] = useState<Strategy>("high_risk")
  const [market, setMarket] = useState<string>("BTC/USD")
  const [aggressiveness, setAggressiveness] = useState<number>(5)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [delegating, setDelegating] = useState(false)
  const [hasDelegation, setHasDelegation] = useState(false)
  const [checkingDelegation, setCheckingDelegation] = useState(false)
  const [marketDropdownOpen, setMarketDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Check delegation status when subaccount is available
  useEffect(() => {
    const checkDelegation = async () => {
      if (!subaccount) return

      setCheckingDelegation(true)
      try {
        const response = await fetch(`/api/bot/check-delegation?userSubaccount=${encodeURIComponent(subaccount)}`)
        const data = await response.json()

        if (data.hasDelegation) {
          setHasDelegation(true)
          console.log('✅ Bot operator already has delegation permissions')
        } else {
          setHasDelegation(false)
          console.log('⚠️ Bot operator needs delegation:', data.reason || 'Not delegated')
        }
      } catch (err) {
        console.error('Failed to check delegation:', err)
        setHasDelegation(false)
      } finally {
        setCheckingDelegation(false)
      }
    }

    checkDelegation()
  }, [subaccount])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setMarketDropdownOpen(false)
      }
    }

    if (marketDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [marketDropdownOpen])

  // All Decibel TESTNET markets (updated Dec 16, 2025 after reset)
  const MARKETS: Record<string, { address: string; logo: string; leverage: number }> = {
    "BTC/USD": {
      address: "0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380",
      logo: "/tokens/btc.svg",
      leverage: 40,
    },
    "ETH/USD": {
      address: "0xd17355e1ac776bc91aa454c18c5dde81054a6ba6a4278d5296ec11f1cba4a274",
      logo: "/tokens/eth.svg",
      leverage: 20,
    },
    "SOL/USD": {
      address: "0xc0a85e3b28244046399e74b934cc41f1eea8b315f412e985b1b26e3d6f617e97",
      logo: "/tokens/sol.png",
      leverage: 20,
    },
    "APT/USD": {
      address: "0x51657ded71c9b4edc74b2877f0fc3aa0c99f28ed12f6a18ecf9e1aeadb0f0463",
      logo: "/tokens/apt.png",
      leverage: 10,
    },
    "XRP/USD": {
      address: "0xd9973a5e626f529a4dde41ba20e76843ac508446195603184278df69702dfa28",
      logo: "/tokens/xrp.svg",
      leverage: 3,
    },
    "LINK/USD": {
      address: "0xbe7bace32193a55b357ed6a778813cb97879443aab7eee74f7a8924e42c15f01",
      logo: "/tokens/link.svg",
      leverage: 3,
    },
    "AAVE/USD": {
      address: "0x499a1b99be437b42a3e65838075dc0c3319b4bf4146fd8bbc5f1b441623c1a8d",
      logo: "/tokens/aave.svg",
      leverage: 3,
    },
    "ENA/USD": {
      address: "0x65d5a08b4682197dd445681feb74b1c4b920d9623729089a7592ccc918b72c86",
      logo: "/tokens/ena.svg",
      leverage: 3,
    },
    "HYPE/USD": {
      address: "0x7257fa2a4046358792b2cd07c386c62598806f2975ec4e02af9c0818fc66164c",
      logo: "/tokens/hype.png",
      leverage: 3,
    },
    "WLFI/USD": {
      address: "0xd7746e5f976b3e585ff382e42c9fa1dc1822b9c2b16e41e768fb30f3b1f542e4",
      logo: "/tokens/wlfi.png",
      leverage: 3,
    },
  }

  const selectedMarket = MARKETS[market]

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

      console.log("📤 Submitting delegation transaction with payload:", data.payload)

      const txResponse = await signAndSubmitTransaction({
        data: data.payload
      })

      console.log("✅ Delegation transaction:", txResponse.hash)
      setHasDelegation(true)
    } catch (err: any) {
      // Extract more detailed error message
      const errorMessage = err.message || err.toString() || "Failed to delegate permissions"
      // Check for common error patterns
      if (errorMessage.includes("rejected") || errorMessage.includes("User rejected")) {
        setError("Transaction rejected by user")
      } else if (errorMessage.includes("EOBJECT_DOES_NOT_EXIST")) {
        setError("Subaccount not found. Please make a deposit on Decibel first.")
      } else {
        setError(errorMessage)
      }
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
          market: MARKETS[market].address,
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

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Cloud Status Indicator */}
      <CloudStatusIndicator />

      {/* Bot Status Monitor */}
      {connected && account && (
        <BotStatusMonitor
          userWalletAddress={account.address.toString()}
          isRunning={isRunning}
          onStatusChange={setIsRunning}
        />
      )}

      {/* Subaccount Selector - shows when user has multiple subaccounts */}
      {connected && allSubaccounts.length > 1 && (
        <div className="border border-white/10 relative" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <h3 className="text-yellow-500 font-mono text-sm uppercase tracking-widest font-bold">Select Account</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-2">
              {allSubaccounts.map((sub) => (
                <button
                  key={sub.address}
                  onClick={() => setSelectedSubaccountType(sub.type as 'primary' | 'competition')}
                  disabled={isRunning}
                  className={cn(
                    "p-3 border transition-all disabled:opacity-50 flex flex-col items-center gap-2",
                    selectedSubaccountType === sub.type
                      ? sub.type === 'competition'
                        ? "bg-yellow-500/10 border-yellow-500/50 text-yellow-500"
                        : "bg-primary/10 border-primary/50 text-primary"
                      : "border-white/10 text-zinc-400 hover:border-white/20 hover:bg-white/5"
                  )}
                >
                  {sub.type === 'competition' ? (
                    <Trophy className="w-5 h-5" />
                  ) : (
                    <User className="w-5 h-5" />
                  )}
                  <span className="font-bold text-sm uppercase tracking-wider">
                    {sub.type === 'competition' ? 'Competition' : 'Primary'}
                  </span>
                  <span className="text-xs opacity-70">
                    ${sub.balance?.toFixed(2) || '0.00'} USDC
                  </span>
                </button>
              ))}
            </div>
            {selectedSubaccountType === 'competition' && (
              <div className="mt-3 p-2 bg-yellow-500/5 border border-yellow-500/30 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <p className="text-xs text-yellow-400">
                  Trading Competition mode - $10K virtual balance
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Configuration Panel */}
      <div className="border border-white/10 relative" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
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
            <div className="bg-black/40 backdrop-blur-sm border border-primary/30 p-3 md:p-4 relative group hover:border-primary/60 transition-colors shadow-[0_0_15px_-5px_rgba(255,246,0,0.3)] overflow-hidden">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary opacity-70" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary opacity-70" />
              <div className="absolute -left-[1px] top-1/2 -translate-y-1/2 h-8 w-[3px] bg-primary/50 group-hover:bg-primary transition-colors" />
              <div className="flex items-center gap-2 md:gap-4">
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(e.target.value)}
                  disabled={!connected || isRunning || loading}
                  className="flex-1 min-w-0 bg-transparent border-none text-2xl md:text-4xl font-mono text-white placeholder-zinc-600 focus:outline-none disabled:opacity-50"
                  placeholder="0.00"
                />
                <Button
                  onClick={handleSetMax}
                  disabled={!connected || isRunning || loading}
                  variant="outline"
                  size="sm"
                  className="border-primary/50 text-primary hover:bg-primary/10 rounded-none font-mono text-xs tracking-widest flex-shrink-0 px-2 md:px-3"
                >
                  MAX
                </Button>
              </div>
              {connected && balance !== null && (
                <p className="text-xs text-zinc-500 mt-2">
                  Available: <span className="text-primary">${balance.toFixed(2)} USDC</span>
                </p>
              )}
              {!connected && (
                <p className="text-xs text-zinc-500 mt-2">
                  Connect wallet to see balance
                </p>
              )}
            </div>
          </div>

          {/* Volume Target */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Volume Target</h3>
              <span className="text-2xl font-bold text-primary font-mono">
                ${volumeTarget >= 1000000 ? `${(volumeTarget / 1000000).toFixed(1)}M` :
                  volumeTarget >= 1000 ? `${(volumeTarget / 1000).toFixed(0)}K` :
                  volumeTarget.toFixed(0)}
              </span>
            </div>
            <div className="relative h-8 flex items-center px-2 border border-white/10 bg-black/20">
              <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-zinc-800 via-primary/30 to-primary" />
              <Slider
                value={[volumeTarget]}
                onValueChange={([value]) => setVolumeTarget(value)}
                min={1000}
                max={1000000}
                step={1000}
                disabled={isRunning || loading}
                className="cursor-pointer relative z-10"
              />
            </div>
            <div className="flex justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
              <span>$1K</span>
              <span>$1M</span>
            </div>
          </div>

          {/* Market Selector Dropdown */}
          <div className="space-y-3 relative" ref={dropdownRef}>
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Trading Pair</h3>
            <button
              onClick={() => !isRunning && !loading && setMarketDropdownOpen(!marketDropdownOpen)}
              disabled={isRunning || loading}
              className={cn(
                "w-full bg-black/40 border border-white/10 p-3 flex items-center justify-between transition-all disabled:opacity-50",
                marketDropdownOpen && "border-primary/50"
              )}
            >
              <div className="flex items-center gap-3">
                <img
                  src={selectedMarket?.logo}
                  alt={market}
                  className="w-6 h-6 object-contain flex-shrink-0"
                />
                <div className="flex flex-col items-start">
                  <span className="text-white font-bold tracking-wider">{market}</span>
                  <span className="text-[10px] text-zinc-500">Max {selectedMarket?.leverage}x leverage</span>
                </div>
              </div>
              <ChevronDown className={cn(
                "w-4 h-4 text-zinc-400 transition-transform",
                marketDropdownOpen && "rotate-180"
              )} />
            </button>

            {/* Dropdown Menu */}
            {marketDropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-black/95 border border-white/10 backdrop-blur-sm max-h-[300px] overflow-y-auto scrollbar-thin">
                {Object.entries(MARKETS).map(([marketName, marketData]) => (
                  <button
                    key={marketName}
                    onClick={() => {
                      setMarket(marketName)
                      setMarketDropdownOpen(false)
                    }}
                    className={cn(
                      "w-full p-3 flex items-center gap-3 transition-all hover:bg-white/5 border-b border-white/5 last:border-b-0",
                      market === marketName && "bg-primary/10"
                    )}
                  >
                    <img
                      src={marketData.logo}
                      alt={marketName}
                      className="w-6 h-6 object-contain flex-shrink-0"
                    />
                    <div className="flex flex-col items-start flex-1">
                      <span className={cn(
                        "font-bold tracking-wider",
                        market === marketName ? "text-primary" : "text-white"
                      )}>
                        {marketName}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        Max {marketData.leverage}x leverage
                      </span>
                    </div>
                    {market === marketName && (
                      <div className="w-2 h-2 bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
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
            <div className={cn(
              "p-2 border relative flex items-center gap-2",
              aggressiveness <= 3 && "bg-green-500/5 border-green-500/30",
              aggressiveness > 3 && aggressiveness <= 7 && "bg-yellow-500/5 border-yellow-500/30",
              aggressiveness > 7 && "bg-red-500/5 border-red-500/30"
            )}>
              {aggressiveness <= 3 && <Gauge className="w-4 h-4 text-green-400 flex-shrink-0" />}
              {aggressiveness > 3 && aggressiveness <= 7 && <Bolt className="w-4 h-4 text-yellow-400 flex-shrink-0" />}
              {aggressiveness > 7 && <Flame className="w-4 h-4 text-red-400 flex-shrink-0" />}
              <p className={cn(
                "text-xs",
                aggressiveness <= 3 && "text-green-400",
                aggressiveness > 3 && aggressiveness <= 7 && "text-yellow-400",
                aggressiveness > 7 && "text-red-400"
              )}>
                {aggressiveness <= 3 && "Conservative - Orders every 1-2 minutes"}
                {aggressiveness > 3 && aggressiveness <= 7 && "Moderate - Orders every 30-60 seconds"}
                {aggressiveness > 7 && "Aggressive HFT - Orders every 10-20 seconds"}
              </p>
            </div>
          </div>

          {/* Bias Selector */}
          <div className="space-y-3">
            <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Directional Bias</h3>
            <div className="grid grid-cols-3 gap-1 bg-black/40 border border-white/10 p-1 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)]">
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
            <div className="grid grid-cols-2 gap-1 bg-black/40 border border-white/10 p-1 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)]">
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
              <button
                onClick={() => setStrategy("tx_spammer")}
                disabled={isRunning || loading}
                className={cn(
                  "flex flex-col items-start p-3 transition-all relative overflow-hidden disabled:opacity-50 col-span-2",
                  strategy === "tx_spammer"
                    ? "bg-pink-500/10 text-pink-400 border border-pink-500/50"
                    : "text-zinc-500 hover:bg-white/5 border border-transparent"
                )}
              >
                {strategy === "tx_spammer" && <div className="absolute inset-0 bg-pink-500/5 animate-pulse" />}
                <div className="flex items-center gap-2 relative z-10">
                  <Zap className="w-4 h-4" />
                  <span className="font-bold text-sm tracking-wider">TX Spammer</span>
                </div>
                <span className="text-[10px] opacity-70 relative z-10">Rapid-fire tiny TWAPs</span>
              </button>
            </div>
            <div className={cn(
              "p-2 border relative flex items-center gap-2",
              strategy === "twap" && "bg-blue-500/5 border-blue-500/30",
              strategy === "market_maker" && "bg-purple-500/5 border-purple-500/30",
              strategy === "delta_neutral" && "bg-cyan-500/5 border-cyan-500/30",
              strategy === "high_risk" && "bg-orange-500/5 border-orange-500/30",
              strategy === "tx_spammer" && "bg-pink-500/5 border-pink-500/30"
            )}>
              {strategy === "twap" && <BarChart3 className="w-4 h-4 text-blue-400 flex-shrink-0" />}
              {strategy === "market_maker" && <Bolt className="w-4 h-4 text-purple-400 flex-shrink-0" />}
              {strategy === "delta_neutral" && <Shield className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
              {strategy === "high_risk" && <Flame className="w-4 h-4 text-orange-400 flex-shrink-0" />}
              {strategy === "tx_spammer" && <Zap className="w-4 h-4 text-pink-400 flex-shrink-0" />}
              <p className={cn(
                "text-xs",
                strategy === "twap" && "text-blue-400",
                strategy === "market_maker" && "text-purple-400",
                strategy === "delta_neutral" && "text-cyan-400",
                strategy === "high_risk" && "text-orange-400",
                strategy === "tx_spammer" && "text-pink-400"
              )}>
                {strategy === "twap" && "Passive limit orders for volume generation. Low PNL impact."}
                {strategy === "market_maker" && "Market orders with tight spreads. Active PNL movement."}
                {strategy === "delta_neutral" && "Opens positions and immediately hedges them. Minimal risk."}
                {strategy === "high_risk" && "Max leverage, fast TWAPs. Targets +0.15% / -0.1% for quick trades. Real PNL."}
                {strategy === "tx_spammer" && "Spam tiny TWAP orders as fast as possible. Maximum transaction count. Each order is ~$10-50."}
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

          {/* Delegation Section - only show when connected */}
          {connected && !isRunning && !hasDelegation && !checkingDelegation && (
            <div className="space-y-3">
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 relative">
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-blue-500" />
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-blue-400 mb-2 font-mono">
                      First-time users must delegate trading permissions to the bot operator.
                    </p>
                    <p className="text-xs text-zinc-500">
                      This is a one-time transaction that allows the bot to place orders on your behalf.
                      Your funds stay in YOUR wallet - the bot can only trade, not withdraw.
                    </p>
                  </div>
                </div>
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

          {connected && checkingDelegation && (
            <div className="p-3 bg-zinc-500/10 border border-zinc-500/30 relative flex items-center gap-2">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-zinc-500" />
              <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-zinc-400 font-mono">
                Checking delegation status...
              </p>
            </div>
          )}

          {connected && !isRunning && hasDelegation && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 relative flex items-center gap-2">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-green-500" />
              <Shield className="w-4 h-4 text-green-400 flex-shrink-0" />
              <p className="text-xs text-green-400 font-mono">
                Permissions delegated. You can now start the bot.
              </p>
            </div>
          )}

          {/* Start Button - only show when not running (Stop button is in BotStatusMonitor) */}
          {!isRunning && connected && (
            <Button
              onClick={handleStart}
              disabled={loading}
              className="w-full h-14 text-lg font-bold font-mono tracking-[0.2em] rounded-none border relative overflow-hidden group transition-all duration-300 disabled:opacity-50 bg-primary/90 hover:bg-primary text-black border-primary shadow-[0_0_30px_-5px_rgba(255,246,0,0.6)] hover:shadow-[0_0_50px_-10px_rgba(255,246,0,0.8)]"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  "PROCESSING..."
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
          )}

          {/* Connect Wallet prompt when not connected */}
          {!connected && (
            <div className="p-4 bg-primary/10 border border-primary/30 relative text-center">
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-primary" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-primary" />
              <p className="text-primary font-mono font-bold">Connect wallet to start</p>
            </div>
          )}

          {/* Bot Info */}
          <div className="p-4 bg-black/40 border border-white/10 relative">
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
            <h4 className="font-mono text-xs uppercase tracking-widest text-primary mb-3">How it works:</h4>
            <ul className="text-xs text-zinc-500 space-y-1 font-mono">
              <li>• Cloud mode: Bot runs every minute via Vercel Cron (browser can be closed)</li>
              <li>• High Risk strategy: IOC orders with automatic TP/SL on-chain</li>
              <li>• Uses delegated permissions (you approved this once)</li>
              <li>• Alternates long/short for neutral bias</li>
              <li>• TP/SL triggers automatically on blockchain - no polling needed</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
