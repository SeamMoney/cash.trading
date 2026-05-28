"use client";

import { useMemo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SignalFeedProps {
  candles: Candle[];
  shortPeriod?: number;
  longPeriod?: number;
  livePrice?: number;
  asset?: string;
  allocationPct?: number;  // % of balance per trade
}

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  let s = 0;
  for (let i = closes.length - period; i < closes.length; i++) s += closes[i];
  return s / period;
}

function toMs(t: number): number {
  return t < 1e12 ? t * 1000 : t;
}

function relTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 0 || s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function absTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtPrice(v: number): string {
  if (v >= 1000) return "$" + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return "$" + v.toFixed(2);
}

interface Trade {
  entryTime: number;
  entryPrice: number;
  exitTime: number | null;
  exitPrice: number | null;
  pnl: number | null;         // dollar P&L on the position
  pnlPct: number | null;      // percentage P&L on entry price
  status: "open" | "win" | "loss";
  positionSize: number;       // $ amount allocated to this trade
  balanceBefore: number;      // portfolio balance before this trade
  balanceAfter: number;       // portfolio balance after this trade
}

export function SignalFeed({
  candles,
  shortPeriod = 10,
  longPeriod = 30,
  livePrice,
  allocationPct = 0,
}: SignalFeedProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const { fastVal, slowVal, spread, trend, trades, totalPnl, totalPnlDollars, winRate, finalBalance } = useMemo(() => {
    if (!candles || candles.length < longPeriod + 1) {
      return { fastVal: 0, slowVal: 0, spread: 0, trend: "neutral" as const, trades: [] as Trade[], totalPnl: 0, totalPnlDollars: 0, winRate: 0, finalBalance: 10000 };
    }

    const closes = livePrice && livePrice > 0 ? [...candles.map(c => c.close), livePrice] : candles.map(c => c.close);
    const f = computeSMA(closes, shortPeriod) ?? 0;
    const sl = computeSMA(closes, longPeriod) ?? 0;
    const sp = f - sl;
    const tr = sp > 0 ? "bullish" as const : sp < 0 ? "bearish" as const : "neutral" as const;

    // Find crossover events and pair them into trades
    const rawCloses = candles.map(c => c.close);
    const buys: { time: number; price: number }[] = [];
    const sells: { time: number; price: number }[] = [];

    for (let i = longPeriod + 1; i < candles.length; i++) {
      const sc = rawCloses.slice(0, i + 1);
      const sp2 = rawCloses.slice(0, i);
      const cs = computeSMA(sc, shortPeriod);
      const cl = computeSMA(sc, longPeriod);
      const ps = computeSMA(sp2, shortPeriod);
      const pl = computeSMA(sp2, longPeriod);
      if (cs === null || cl === null || ps === null || pl === null) continue;

      if (ps <= pl && cs > cl) buys.push({ time: toMs(candles[i].time), price: candles[i].close });
      else if (ps >= pl && cs < cl) sells.push({ time: toMs(candles[i].time), price: candles[i].close });
    }

    // Pair BUY→SELL into trades with running balance simulation
    const pairedTrades: Trade[] = [];
    let buyIdx = 0;
    let sellIdx = 0;
    const startingBalance = 10_000; // $10k starting portfolio
    let balance = startingBalance;

    while (buyIdx < buys.length) {
      const entry = buys[buyIdx];
      while (sellIdx < sells.length && sells[sellIdx].time <= entry.time) sellIdx++;

      const positionSize = balance * (allocationPct > 0 ? allocationPct : 100) / 100;
      const balanceBefore = balance;

      if (sellIdx < sells.length) {
        const exit = sells[sellIdx];
        const pnlPct = ((exit.price - entry.price) / entry.price) * 100;
        const pnl = positionSize * pnlPct / 100; // dollar P&L on the position size
        balance = balance + pnl;
        pairedTrades.push({
          entryTime: entry.time, entryPrice: entry.price,
          exitTime: exit.time, exitPrice: exit.price,
          pnl, pnlPct,
          status: pnl >= 0 ? "win" : "loss",
          positionSize, balanceBefore, balanceAfter: balance,
        });
        sellIdx++;
      } else {
        const currentP = livePrice && livePrice > 0 ? livePrice : candles[candles.length - 1].close;
        const pnlPct = ((currentP - entry.price) / entry.price) * 100;
        const pnl = positionSize * pnlPct / 100;
        pairedTrades.push({
          entryTime: entry.time, entryPrice: entry.price,
          exitTime: null, exitPrice: null,
          pnl, pnlPct, status: "open",
          positionSize, balanceBefore, balanceAfter: balance + pnl,
        });
      }
      buyIdx++;
    }

    const closed = pairedTrades.filter(t => t.status !== "open");
    const wins = closed.filter(t => t.status === "win").length;
    const lastClosed = closed[closed.length - 1];
    const finalBalance = lastClosed?.balanceAfter ?? startingBalance;
    const portfolioReturn = ((finalBalance - startingBalance) / startingBalance) * 100;
    const totalPnlDollars = finalBalance - startingBalance;
    const wr = closed.length > 0 ? (wins / closed.length) * 100 : 0;

    return { fastVal: f, slowVal: sl, spread: sp, trend: tr, trades: pairedTrades.reverse(), totalPnl: portfolioReturn, totalPnlDollars, winRate: wr, finalBalance };
  }, [candles, shortPeriod, longPeriod, livePrice]);

  if (!candles || candles.length < longPeriod + 1) {
    return (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] px-4 py-6 text-center text-[11px] text-zinc-600">
        Waiting for candle data...
      </div>
    );
  }

  const spreadPct = slowVal > 0 ? (spread / slowVal) * 100 : 0;
  const closedTrades = trades.filter(t => t.status !== "open");

  return (
    <div className="space-y-3">
      {/* ── Indicator state bar ── */}
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#181818] overflow-hidden">
        <div className="flex items-stretch divide-x divide-[#2a2a2a]">
          <div className="flex-1 px-4 py-3">
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Trend</div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "w-2 h-2 rounded-full",
                trend === "bullish" ? "bg-emerald-400" : trend === "bearish" ? "bg-red-400" : "bg-zinc-600",
              )} />
              <span className={cn(
                "text-[13px] font-display font-semibold capitalize",
                trend === "bullish" ? "text-emerald-400" : trend === "bearish" ? "text-red-400" : "text-zinc-500",
              )}>
                {trend}
              </span>
            </div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Fast / Slow</div>
            <div className="text-[13px] font-mono tabular-nums">
              <span className="text-emerald-400">{fmtPrice(fastVal)}</span>
              <span className="text-zinc-700 mx-1">/</span>
              <span className="text-orange-400">{fmtPrice(slowVal)}</span>
            </div>
          </div>
          <div className="flex-1 px-4 py-3">
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Spread</div>
            <div className={cn(
              "text-[13px] font-mono tabular-nums font-semibold",
              spread >= 0 ? "text-emerald-400" : "text-red-400",
            )}>
              {spread >= 0 ? "+" : ""}{spread.toFixed(1)}
              <span className="text-zinc-600 font-normal ml-1 text-[10px]">({spreadPct >= 0 ? "+" : ""}{spreadPct.toFixed(3)}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Trade log with P&L ── */}
      {trades.length > 0 && (
        <div className="rounded-2xl border border-[#2a2a2a] overflow-hidden">
          <div className="px-4 py-2 bg-[#181818] border-b border-[#2a2a2a] flex items-center justify-between">
            <span className="text-[10px] font-mono font-semibold text-[#888] uppercase tracking-[0.15em]">
              Trades
            </span>
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-zinc-500">{closedTrades.length} trades</span>
              <span className={cn(winRate >= 50 ? "text-emerald-400" : "text-red-400")}>
                {winRate.toFixed(0)}% win
              </span>
              <span className={cn(totalPnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}% return
              </span>
            </div>
          </div>
          <div className="bg-[#111] divide-y divide-[#1a1a1a] max-h-[320px] overflow-y-auto">
            {trades.map((trade, i) => {
              const pnlColor = trade.status === "open" ? "text-purple-400"
                : (trade.pnlPct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

              return (
              <div
                key={i}
                className={cn(
                  "px-4 py-1.5 border-l-2 flex items-center gap-3 text-[11px] font-mono",
                  trade.status === "open" ? "border-l-purple-400 bg-purple-500/[0.03]"
                    : trade.status === "win" ? "border-l-emerald-400"
                    : "border-l-red-400",
                )}
              >
                {/* Time */}
                <span className="text-[9px] text-zinc-600 w-12 shrink-0 tabular-nums">{relTime(trade.entryTime)}</span>

                {/* Entry → Exit */}
                <span className="text-zinc-500 tabular-nums">{fmtPrice(trade.entryPrice)}</span>
                <span className="text-zinc-700">→</span>
                <span className={cn("tabular-nums", trade.exitPrice ? "text-zinc-500" : "text-purple-400/70")}>
                  {trade.exitPrice ? fmtPrice(trade.exitPrice) : "open"}
                </span>

                {/* Price delta */}
                {trade.exitPrice && (
                  <span className={cn("text-[9px] tabular-nums", pnlColor + "/50")}>
                    {(trade.exitPrice - trade.entryPrice) >= 0 ? "+" : ""}{fmtPrice(Math.abs(trade.exitPrice - trade.entryPrice))}
                  </span>
                )}

                {/* P&L % — the number that matters */}
                <span className={cn("font-bold tabular-nums ml-auto", pnlColor)}>
                  {(trade.pnlPct ?? 0) >= 0 ? "+" : ""}{(trade.pnlPct ?? 0).toFixed(2)}%
                </span>
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
