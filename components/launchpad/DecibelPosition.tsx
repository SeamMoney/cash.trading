"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Position {
  market: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  leverage: number;
  liquidationPrice: number | null;
}

interface Props {
  subaccountAddr: string;
  marketName?: string;   // filter to one market, e.g. "BTC/USD"
}

export function DecibelPosition({ subaccountAddr, marketName }: Props) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/decibel/positions?address=${subaccountAddr}`);
        const data = await res.json() as { positions?: Position[] };
        let pos = data.positions ?? [];
        if (marketName) pos = pos.filter((p) => p.market === marketName);
        setPositions(pos);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [subaccountAddr, marketName]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-zinc-600">
        <span className="w-2 h-2 rounded-full bg-zinc-700 animate-pulse" />
        Checking Decibel positions…
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-zinc-600">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
        No open positions
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {positions.map((pos, i) => (
        <div key={i} className={cn(
          "rounded-lg border px-3 py-2.5",
          pos.side === "long"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : "border-red-500/20 bg-red-500/5"
        )}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase",
                pos.side === "long"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400"
              )}>
                {pos.side}
              </span>
              <span className="text-xs font-medium text-zinc-200">{pos.market}</span>
              <span className="text-[10px] text-zinc-500">{pos.leverage}x</span>
            </div>
            <span className={cn(
              "text-xs font-semibold",
              pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
            )}>
              {pos.unrealizedPnl >= 0 ? "+" : ""}{pos.unrealizedPnl.toFixed(2)} USDC
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
            <span>Size: <span className="text-zinc-300">{pos.size}</span></span>
            <span>Entry: <span className="text-zinc-300">${pos.entryPrice.toLocaleString()}</span></span>
            <span>Mark: <span className="text-zinc-300">${pos.markPrice.toLocaleString()}</span></span>
          </div>
        </div>
      ))}
    </div>
  );
}
