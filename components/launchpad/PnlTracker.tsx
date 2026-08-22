"use client";

import { cn } from "@/lib/utils";

interface PnlTrackerProps {
  entryPrice: number;
  currentPrice: number;
  allocation: number;
  signal: 0 | 1 | 2;
  indicatorName: string;
  asset: string;
}

export function PnlTracker({
  entryPrice,
  currentPrice,
  allocation,
  signal,
  indicatorName,
  asset,
}: PnlTrackerProps) {
  // signal=1 → BUY → in a long position
  // signal=2 → SELL → in a short position (or just closed a long)
  const inLong = signal === 1 && entryPrice > 0;
  const inShort = signal === 2 && entryPrice > 0 && currentPrice > 0;
  const inPosition = inLong || inShort;

  // P&L: long = current - entry, short = entry - current
  const rawPnl = inLong
    ? currentPrice - entryPrice
    : inShort
      ? entryPrice - currentPrice
      : 0;
  const pnlPct = entryPrice > 0 ? (rawPnl / entryPrice) * 100 : 0;
  const pnlWeighted = pnlPct * (allocation / 100);
  const isProfit = rawPnl >= 0;

  if (!inPosition) {
    return (
      <div className="bg-[#161616] border border-[#222] rounded-xl px-4 py-2.5 flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
        <span className="text-[11px] text-zinc-500 font-mono">Waiting for signal</span>
        <span className="ml-auto text-[10px] text-zinc-600 font-mono">{asset}</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "border rounded-xl px-4 py-2.5 flex items-center gap-4",
      "bg-[#181818] border-[#2a2a2a]",
    )}>
      {/* Status */}
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn(
          "w-2 h-2 rounded-full animate-pulse",
          inLong ? "bg-emerald-400" : "bg-red-400",
        )} />
        <span className={cn(
          "text-[11px] font-semibold",
          inLong ? "text-emerald-400" : "text-red-400",
        )}>
          {inLong ? "LONG" : "SHORT"}
        </span>
      </div>

      {/* Entry → Current */}
      <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-400 min-w-0">
        <span className="tabular-nums">${entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <svg className="w-3 h-3 text-zinc-600 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6h7M7 3.5L9.5 6 7 8.5" />
        </svg>
        <span className={cn("tabular-nums font-semibold", isProfit ? "text-emerald-400" : "text-red-400")}>
          ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* P&L */}
      <div className="flex items-center gap-3 ml-auto shrink-0">
        <span className={cn("text-[11px] font-mono font-semibold tabular-nums", isProfit ? "text-emerald-400" : "text-red-400")}>
          {isProfit ? "+" : ""}{pnlWeighted.toFixed(2)}%
        </span>
        <span className={cn("text-[11px] font-mono tabular-nums", isProfit ? "text-emerald-400/70" : "text-red-400/70")}>
          {rawPnl >= 0 ? "+" : ""}{rawPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className="text-[10px] text-zinc-600 font-mono">{asset}</span>
      </div>
    </div>
  );
}
