"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { ChevronDown, Calculator, Settings2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function TradingView() {
  const [tradingMode, setTradingMode] = useState<"aggressive" | "normal" | "passive">("normal")
  const [directionalBias, setDirectionalBias] = useState(50)

  return (
    <div className="space-y-6 animate-in fade-in zoom-in duration-500">
      {/* Account Selection */}
      <div className="space-y-2">
        <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest pl-1">Accounts & Pairs</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Long Side */}
          <div className="bg-black/40 backdrop-blur-sm border border-green-500/30 p-4 space-y-4 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)] relative group hover:border-green-500/60 transition-colors">
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-green-500 opacity-50" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-green-500 opacity-50" />

            <div className="text-green-500 font-bold tracking-widest font-mono text-sm">[ LONG ]</div>
            <Button
              variant="outline"
              className="w-full justify-between bg-black/50 border-white/10 h-12 text-zinc-300 hover:text-green-500 hover:bg-green-500/10 hover:border-green-500/50 rounded-none font-mono transition-all"
            >
              Select Account
            </Button>
            <div className="bg-black/50 border border-white/10 p-3 flex items-center justify-between hover:border-green-500/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-[#F7931A] flex items-center justify-center text-[10px] font-bold text-white">
                  ₿
                </div>
                <span className="font-bold text-white font-mono">BTC/USD</span>
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              </div>
              <Badge
                variant="secondary"
                className="bg-zinc-900 text-zinc-400 rounded-none border border-zinc-800 font-mono"
              >
                1x
              </Badge>
            </div>
          </div>

          {/* Short Side */}
          <div className="bg-black/40 backdrop-blur-sm border border-red-500/30 p-4 space-y-4 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)] relative group hover:border-red-500/60 transition-colors">
            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-red-500 opacity-50" />
            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-red-500 opacity-50" />

            <div className="text-red-500 font-bold tracking-widest font-mono text-sm">[ SHORT ]</div>
            <Button
              variant="outline"
              className="w-full justify-between bg-black/50 border-white/10 h-12 text-zinc-300 hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/50 rounded-none font-mono transition-all"
            >
              Select Account
            </Button>
            <div className="bg-black/50 border border-white/10 p-3 flex items-center justify-between hover:border-red-500/30 transition-colors">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-[#627EEA] flex items-center justify-center text-[10px] font-bold text-white">
                  ♦
                </div>
                <span className="font-bold text-white font-mono">ETH/USD</span>
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              </div>
              <Badge
                variant="secondary"
                className="bg-zinc-900 text-zinc-400 rounded-none border border-zinc-800 font-mono"
              >
                1x
              </Badge>
            </div>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 hidden lg:block">
              <div className="bg-black/90 border border-white/10 px-2 py-1 text-[10px] text-zinc-500 font-mono tracking-tight backdrop-blur-md">
                QUOTE FUNDS AVAILABLE FOR SHORT LEG
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notional Input */}
      <div className="space-y-2">
        <h3 className="text-muted-foreground font-mono text-xs uppercase tracking-widest pl-1">Notional Size</h3>
        <div className="bg-black/40 backdrop-blur-sm border border-primary/30 p-6 shadow-lg relative group hover:border-primary/60 transition-colors">
          <div className="absolute -left-[1px] top-1/2 -translate-y-1/2 h-8 w-[3px] bg-primary/50 group-hover:bg-primary transition-colors" />
          <div className="flex items-center gap-4 text-4xl md:text-5xl font-mono text-primary/50">
            <span>$</span>
            <input
              type="text"
              defaultValue="0"
              className="bg-black/30 border-white/10 focus-visible:ring-primary/50 focus-visible:border-primary/50 h-10 pr-8 font-mono rounded-none text-white transition-all group-hover:border-white/20"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* Trading Mode */}
          <div className="grid grid-cols-3 gap-1 bg-black/40 border border-white/10 p-1 backdrop-blur-sm">
            <button
              onClick={() => setTradingMode("aggressive")}
              className={cn(
                "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group",
                tradingMode === "aggressive"
                  ? "bg-red-500/10 text-red-500 border border-red-500/50"
                  : "text-zinc-500 hover:bg-white/5 border border-transparent",
              )}
            >
              {tradingMode === "aggressive" && <div className="absolute inset-0 bg-red-500/5 animate-pulse" />}
              <span className="font-bold text-sm font-mono tracking-wider relative z-10">AGGRESSIVE</span>
              <span className="text-[10px] opacity-80 font-mono relative z-10">~5 MIN</span>
            </button>
            <button
              onClick={() => setTradingMode("normal")}
              className={cn(
                "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group",
                tradingMode === "normal"
                  ? "bg-white/5 text-white border border-white/30"
                  : "text-zinc-500 hover:bg-white/5 border border-transparent",
              )}
            >
              <span className="font-bold text-sm font-mono tracking-wider relative z-10">NORMAL</span>
              <span className="text-[10px] opacity-80 font-mono relative z-10">~15 MIN</span>
            </button>
            <button
              onClick={() => setTradingMode("passive")}
              className={cn(
                "flex flex-col items-center justify-center py-3 transition-all relative overflow-hidden group",
                tradingMode === "passive"
                  ? "bg-green-500/10 text-green-500 border border-green-500/50"
                  : "text-zinc-500 hover:bg-white/5 border border-transparent",
              )}
            >
              {tradingMode === "passive" && <div className="absolute inset-0 bg-green-500/5 animate-pulse" />}
              <span className="font-bold text-sm font-mono tracking-wider relative z-10">PASSIVE</span>
              <span className="text-[10px] opacity-80 font-mono relative z-10">~30 MIN</span>
            </button>
          </div>

          {/* Directional Bias Slider */}
          <div className="space-y-4 pt-2 px-1">
            <div className="flex items-center justify-between text-xs font-mono uppercase tracking-widest">
              <span className="text-muted-foreground border-b border-dashed border-zinc-700 pb-1">
                Directional Bias
              </span>
              <span className="text-primary">{directionalBias}%</span>
            </div>
            <div className="relative h-8 flex items-center px-2 border border-white/10 bg-black/20">
              <div className="absolute inset-x-2 h-1 bg-gradient-to-r from-red-500/30 via-zinc-800 to-green-500/30" />
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
              <Slider
                defaultValue={[50]}
                max={100}
                step={1}
                value={[directionalBias]}
                onValueChange={(v) => setDirectionalBias(v[0])}
                className="cursor-pointer relative z-10"
              />
            </div>
          </div>

          <Button className="w-full h-16 text-xl bg-primary/90 hover:bg-primary text-black font-bold font-mono tracking-[0.2em] rounded-none border border-primary relative overflow-hidden group shadow-[0_0_30px_-5px_rgba(255,246,0,0.6)] hover:shadow-[0_0_50px_-10px_rgba(255,246,0,0.8)] transition-all duration-300">
            <span className="relative z-10">INITIALIZE TRADING</span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            <div className="absolute bottom-0 left-0 w-full h-1 bg-white/50" />
          </Button>
        </div>

        {/* Right Panel - Analytics & Config */}
        <div className="space-y-4">
          {/* Pre-Trade Analytics */}
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-0 relative">
            <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white/20" />
            <div className="p-3 border-b border-white/10 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono uppercase tracking-widest">
                <Calculator className="w-3 h-3" />
                Pre-Trade Analytics
              </div>
            </div>

            <div className="p-4 space-y-4 font-mono">
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-green-500 uppercase tracking-wider">[ Long Leg ]</div>
                <div className="flex justify-between text-xs text-zinc-400 border-b border-dashed border-white/10 pb-1">
                  <span>Available Margin</span>
                  <span className="text-zinc-500">-</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400 border-b border-dashed border-white/10 pb-1">
                  <span>Target Amount</span>
                  <span className="text-zinc-500">-</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400 pb-1">
                  <span>Estimated Fees</span>
                  <span className="text-zinc-500">-</span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider">[ Short Leg ]</div>
                <div className="flex justify-between text-xs text-zinc-400 border-b border-dashed border-white/10 pb-1">
                  <span>Available Margin</span>
                  <span className="text-zinc-500">-</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400 border-b border-dashed border-white/10 pb-1">
                  <span>Target Amount</span>
                  <span className="text-zinc-500">-</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400 pb-1">
                  <span>Estimated Fees</span>
                  <span className="text-zinc-500">-</span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-[10px] font-bold text-primary uppercase tracking-wider">[ Net Position ]</div>
                <div className="flex justify-between text-xs text-zinc-400 pt-1">
                  <span>Net Funding Rate</span>
                  <span className="text-zinc-500">-</span>
                </div>
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-0 relative">
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white/20" />
            <div className="p-3 border-b border-white/10 bg-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-muted-foreground text-xs font-mono uppercase tracking-widest">
                <Settings2 className="w-3 h-3" />
                Configuration
              </div>
            </div>
            <div className="p-4 space-y-4 font-mono">
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">DURATION</span>
                  <span className="text-white">15 MIN</span>
                </div>
                <div className="h-1 w-full bg-white/10 overflow-hidden">
                  <div className="h-full w-1/3 bg-primary shadow-[0_0_5px_rgba(255,246,0,0.5)]" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">PASSIVENESS</span>
                  <span className="text-white">3.0%</span>
                </div>
                <div className="h-1 w-full bg-white/10 overflow-hidden">
                  <div className="h-full w-2/3 bg-primary shadow-[0_0_5px_rgba(255,246,0,0.5)]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Exit Conditions */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-none overflow-hidden relative">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/5" />
        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-primary font-mono text-sm uppercase tracking-widest font-bold">Exit Conditions</h3>
          <div className="flex gap-1">
            <div className="w-1 h-1 bg-zinc-500" />
            <div className="w-1 h-1 bg-zinc-500" />
            <div className="w-1 h-1 bg-zinc-500" />
          </div>
        </div>
        <div className="p-6 space-y-8 font-mono">
          {/* Take Profit */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="text-xs font-bold text-white bg-white/10 px-2 py-1 uppercase tracking-wider">
                Take Profit
              </div>
              <div className="h-px flex-1 bg-dashed border-t border-dashed border-zinc-700" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative group">
                <Input
                  className="bg-black/30 border-white/10 focus-visible:ring-primary/50 focus-visible:border-primary/50 h-10 pr-8 font-mono rounded-none text-white transition-all group-hover:border-white/20"
                  placeholder="0.00"
                />
                <span className="absolute right-3 top-2.5 text-zinc-500 text-xs">% PROFIT</span>
              </div>
              <div className="relative group">
                <span className="absolute left-3 top-2.5 text-zinc-500 text-xs">$</span>
                <Input
                  className="bg-black/30 border-white/10 focus-visible:ring-primary/50 focus-visible:border-primary/50 h-10 pl-6 font-mono rounded-none text-white transition-all group-hover:border-white/20"
                  placeholder="0.00"
                />
                <span className="absolute right-3 top-2.5 text-zinc-600 text-[10px] uppercase">Price Target</span>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-px bg-zinc-800 border border-zinc-800">
              {["VERY LOW", "LOW", "MEDIUM", "HIGH", "VERY HIGH"].map((level, i) => (
                <button
                  key={level}
                  className={cn(
                    "py-2 text-[10px] font-medium transition-colors bg-black/60 hover:bg-white/10",
                    i === 3 ? "text-primary bg-primary/10" : "text-zinc-500",
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Stop Loss */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="text-xs font-bold text-white bg-white/10 px-2 py-1 uppercase tracking-wider">
                Stop Loss
              </div>
              <div className="h-px flex-1 bg-dashed border-t border-dashed border-zinc-700" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative group">
                <Input
                  className="bg-black/30 border-white/10 focus-visible:ring-red-500/50 focus-visible:border-red-500/50 h-10 pr-8 font-mono rounded-none text-white transition-all group-hover:border-white/20"
                  placeholder="0.00"
                />
                <span className="absolute right-3 top-2.5 text-zinc-500 text-xs">% LOSS</span>
              </div>
              <div className="relative group">
                <span className="absolute left-3 top-2.5 text-zinc-500 text-xs">$</span>
                <Input
                  className="bg-black/30 border-white/10 focus-visible:ring-red-500/50 focus-visible:border-red-500/50 h-10 pl-6 font-mono rounded-none text-white transition-all group-hover:border-white/20"
                  placeholder="0.00"
                />
                <span className="absolute right-3 top-2.5 text-zinc-600 text-[10px] uppercase">Stop Price</span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-px bg-zinc-800 border border-zinc-800">
              {["VERY LOW", "LOW", "MEDIUM", "HIGH", "VERY HIGH"].map((level, i) => (
                <button
                  key={level}
                  className={cn(
                    "py-2 text-[10px] font-medium transition-colors bg-black/60 hover:bg-white/10",
                    i === 0 ? "text-primary bg-primary/10" : "text-zinc-500",
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
