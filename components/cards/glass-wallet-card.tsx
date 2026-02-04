"use client"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  BarChart3,
} from "lucide-react"

interface GlassWalletCardProps {
  balance?: number
  currency?: string
  address?: string
  totalPnl?: number
  winRate?: number
  totalVolume?: number
  totalTrades?: number
  className?: string
  loading?: boolean
}

export function GlassWalletCard({
  balance = 0,
  currency = "USDC",
  address = "0x000...0000",
  totalPnl = 0,
  winRate = 0,
  totalVolume = 0,
  totalTrades = 0,
  className,
  loading = false,
}: GlassWalletCardProps) {
  const pnlIsPositive = totalPnl >= 0

  const formatBalance = (num: number) => {
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  const formatPnl = (num: number) => {
    const formatted = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return num >= 0 ? `+$${formatted}` : `-$${formatted}`
  }

  const formatVolume = (num: number) => {
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`
    return `$${num.toFixed(0)}`
  }

  const truncateAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn("w-full", className)}
    >
      <Card className="group relative h-60 w-full overflow-hidden rounded-2xl border-border/50 bg-gradient-to-br from-card/80 via-card/40 to-card/20 backdrop-blur-md transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10">
        {/* Abstract Background Shapes */}
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl transition-all duration-500 group-hover:bg-primary/20" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-secondary/10 blur-3xl transition-all duration-500 group-hover:bg-secondary/20" />

        <div className="relative h-full p-6" style={{ width: '100%' }}>
          <div className="flex flex-col justify-between h-full" style={{ width: '100%' }}>
            {/* Header */}
            <div className="flex items-start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary backdrop-blur-sm">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Total Balance
                  </p>
                  {loading ? (
                    <div className="h-7 w-28 bg-white/5 rounded animate-pulse" />
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <h3 className="text-2xl font-bold tracking-tight text-foreground font-mono tabular-nums">
                        ${formatBalance(balance)}
                      </h3>
                      <span className="text-xs font-medium text-muted-foreground">
                        {currency}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full bg-white/10 px-3 py-1.5 font-mono text-xs flex items-center ml-auto",
                  pnlIsPositive ? "text-green-500" : "text-red-500"
                )}
              >
                {pnlIsPositive ? (
                  <TrendingUp className="mr-1 h-3 w-3" />
                ) : (
                  <TrendingDown className="mr-1 h-3 w-3" />
                )}
                {formatPnl(totalPnl)}
              </span>
            </div>

            {/* Card Details */}
            <div style={{ width: '100%' }}>
              {/* Row 1: Volume + Win Rate */}
              <div className="flex items-center mb-4" style={{ width: '100%', justifyContent: 'space-between' }}>
                <div className="flex items-center gap-3">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    <span className="font-mono uppercase tracking-wider">Vol</span>{" "}
                    <span className="font-mono font-semibold text-blue-400">{formatVolume(totalVolume)}</span>
                  </span>
                </div>
                <span className="font-mono text-sm text-muted-foreground">
                  <span className="uppercase tracking-wider">Win</span>{" "}
                  <span className="font-semibold text-foreground">{winRate.toFixed(1)}%</span>
                </span>
              </div>

              {/* Row 2: Trades + Address */}
              <div className="flex items-center" style={{ width: '100%', justifyContent: 'space-between' }}>
                <span className="text-sm font-mono font-medium text-foreground">
                  {totalTrades} Trades
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {truncateAddress(address)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
