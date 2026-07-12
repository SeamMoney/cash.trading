"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { OnChainChart } from "./OnChainChart";
import { SignalFeed } from "./SignalFeed";
import { PnlTracker } from "./PnlTracker";
import { DecibelPosition } from "./DecibelPosition";
import TradeHistory from "./TradeHistory";
import type { ScheduledJob } from "@/lib/launchpad/types";
import { explorerAccountUrl } from "@/lib/constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type BotJob = ScheduledJob & { indicatorName?: string };

function parseActionData(job: BotJob): { market: string; allocationPct: number } {
  try {
    if (job.actionData) return JSON.parse(job.actionData);
  } catch { /* ignore */ }
  return { market: "BTC/USD", allocationPct: Math.round((job.actionAmount ?? 0) * 100) };
}

interface CandleData {
  time: number; open: number; high: number; low: number; close: number;
}

// ─── BotDashboard ────────────────────────────────────────────────────────────

export function BotDashboard() {
  const [jobs, setJobs] = useState<BotJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [indicatorNames, setIndicatorNames] = useState<Record<string, string>>({});

  // Live data
  const [livePrice, setLivePrice] = useState(0);
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [onChainState, setOnChainState] = useState<{ signal: number; lastPrice: number; entryPrice: number } | null>(null);
  const prevAssetRef = useRef("");
  const prevSignalRef = useRef<number>(-1);
  const [toast, setToast] = useState<{ message: string; type: "buy" | "sell" | "info"; visible: boolean }>({ message: "", type: "info", visible: false });

  // ── Fetch jobs ──────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/launchpad/scheduled");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchJobs();
    const t = setInterval(fetchJobs, 8_000);
    return () => clearInterval(t);
  }, [fetchJobs]);

  // ── Look up indicator names from the registry ───────────────────────────
  useEffect(() => {
    async function loadNames() {
      try {
        const res = await fetch("/api/launchpad/indicators");
        if (!res.ok) return;
        const data = await res.json();
        const map: Record<string, string> = {};
        for (const ind of data.indicators ?? []) {
          map[ind.address] = ind.name;
        }
        setIndicatorNames(map);
      } catch { /* ignore */ }
    }
    loadNames();
  }, []);

  const activeJobs = jobs.filter(j => j.status === "pending" || j.status === "executed");
  const bot = activeJobs[selectedIdx] ?? activeJobs[0];
  const { market, allocationPct } = bot ? parseActionData(bot) : { market: "BTC/USD", allocationPct: 0 };
  const asset = market;
  const botName = bot
    ? (bot.indicatorName || indicatorNames[bot.indicatorAddr] || bot.indicatorAddr?.slice(0, 10))
    : "Bot";

  // ── Fast Pyth price polling (every 5s) ──────────────────────────────────
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/launchpad/price-tick?asset=${encodeURIComponent(asset)}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (d.price > 0 && !cancelled) setLivePrice(d.price);
      } catch { /* ignore */ }
    }
    tick();
    const t = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [asset]);

  // ── Fetch 5-min candles for the signal feed ─────────────────────────────
  useEffect(() => {
    if (!asset || asset === prevAssetRef.current) return;
    prevAssetRef.current = asset;
    async function load() {
      try {
        const res = await fetch(`/api/launchpad/candles?asset=${encodeURIComponent(asset)}&resolution=5&days=2`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.candles?.length) setCandles(data.candles.map((c: Record<string, number>) => ({
          time: c.timestamp ?? c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })));
      } catch { /* ignore */ }
    }
    load();
  }, [asset]);

  // ── On-chain state (signal, entry price) ────────────────────────────────
  useEffect(() => {
    if (!bot?.indicatorAddr) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/launchpad/on-chain?addr=${bot.indicatorAddr}&type=state`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (!cancelled) {
          const newSig = d.signal ?? 0;
          const price = typeof d.lastPrice === "number" ? (d.lastPrice > 1000 ? d.lastPrice : d.lastPrice / 1e8) : 0;

          // Detect signal change and show toast
          if (prevSignalRef.current >= 0 && newSig !== prevSignalRef.current && newSig !== 0) {
            const fmtP = price > 0 ? ` at $${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "";
            if (newSig === 1) {
              setToast({ message: `Opened long${fmtP}`, type: "buy", visible: true });
            } else {
              setToast({ message: `Closed position${fmtP}`, type: "sell", visible: true });
            }
            setTimeout(() => setToast(t => ({ ...t, visible: false })), 4000);
          }
          prevSignalRef.current = newSig;

          setOnChainState({
            signal: newSig,
            lastPrice: price,
            entryPrice: typeof d.entryPrice === "number" ? (d.entryPrice > 1000 ? d.entryPrice : d.entryPrice / 1e8) : 0,
          });
        }
      } catch { /* ignore */ }
    }
    poll();
    const t = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [bot?.indicatorAddr]);

  async function cancelJob(jobId: number) {
    setCancellingId(jobId);
    try {
      const res = await fetch(`/api/launchpad/scheduled?jobId=${jobId}`, { method: "DELETE" });
      if (res.ok) fetchJobs();
    } catch { /* ignore */ }
    finally { setCancellingId(null); }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-14 bg-[#181818] rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (activeJobs.length === 0) {
    return (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#111]">
        <div className="flex flex-col items-center justify-center py-16 text-center px-8">
          <h3 className="text-sm font-display font-semibold text-white mb-1.5">No active bots</h3>
          <p className="text-[12px] text-zinc-500 max-w-xs leading-relaxed">
            Select a strategy in Explore and deploy a bot to start auto-trading.
          </p>
        </div>
      </div>
    );
  }

  const currentSignal = (onChainState?.signal ?? 0) as 0 | 1 | 2;
  const entryPrice = onChainState?.entryPrice ?? 0;
  const displayPrice = livePrice > 0 ? livePrice : (onChainState?.lastPrice ?? 0);

  return (
    <div className="space-y-3">
      {/* ── Toast ── */}
      <div className={cn(
        "fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl border text-sm font-medium font-mono transition-all duration-300",
        toast.type === "buy" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : toast.type === "sell" ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-[#2a2a2a] bg-[#181818] text-white",
        toast.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none",
      )}>
        {toast.message}
      </div>

      {/* ── Bot header: name, position, live price ── */}
      <div className="bg-[#181818] border border-[#2a2a2a] rounded-xl px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={cn(
              "w-2 h-2 rounded-full shrink-0",
              currentSignal === 1 ? "bg-emerald-400 animate-pulse"
                : currentSignal === 2 ? "bg-red-400 animate-pulse"
                : "bg-zinc-600",
            )} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-display font-semibold text-white">{botName}</span>
                {bot?.indicatorAddr && (
                  <a
                    href={explorerAccountUrl(bot.indicatorAddr, "testnet")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] font-mono text-purple-400/70 hover:text-purple-300 underline underline-offset-2 decoration-purple-400/30 transition-colors"
                  >
                    {bot.indicatorAddr.slice(0, 6)}...{bot.indicatorAddr.slice(-4)}
                  </a>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                SMA(10,30) · {asset} · {allocationPct}% allocation · {bot?.recurring ? "auto-repeat" : "one-shot"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Live price */}
            <div className="text-right">
              <div className="text-[16px] font-mono font-bold text-white tabular-nums">
                ${displayPrice > 0 ? displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
              </div>
              <div className={cn(
                "text-[10px] font-mono",
                currentSignal === 1 ? "text-emerald-400" : currentSignal === 2 ? "text-red-400" : "text-zinc-500",
              )}>
                {currentSignal === 1 ? "BUY" : currentSignal === 2 ? "SELL" : "NEUTRAL"}
              </div>
            </div>
            <button
              onClick={() => cancelJob(bot.jobId)}
              disabled={cancellingId === bot.jobId}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono border border-[#2a2a2a] text-zinc-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
            >
              {cancellingId === bot.jobId ? "..." : "Stop"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Multiple bot tabs (only if >1) ── */}
      {activeJobs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {activeJobs.map((j, i) => {
            const name = j.indicatorName || indicatorNames[j.indicatorAddr] || j.indicatorAddr?.slice(0, 8);
            return (
              <button
                key={j.jobId}
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-all shrink-0",
                  i === selectedIdx
                    ? "border-[#2a2a2a] bg-[#202020] text-white"
                    : "border-transparent text-zinc-600 hover:text-zinc-400",
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── P&L tracker ── */}
      <PnlTracker
        entryPrice={entryPrice}
        currentPrice={displayPrice}
        allocation={allocationPct}
        signal={currentSignal}
        indicatorName={botName}
        asset={asset}
      />

      {/* ── Decibel perp positions ── */}
      {bot?.indicatorAddr && (
        <DecibelPosition
          subaccountAddr={bot.indicatorAddr}
          marketName={asset}
        />
      )}

      {/* ── Live chart ── */}
      {bot && (
        <div className="rounded-2xl border border-[#2a2a2a] overflow-hidden">
          <OnChainChart
            indicatorAddr={bot.indicatorAddr}
            asset={asset}
            indicatorType={0}
            shortPeriod={10}
            longPeriod={30}
            thirdPeriod={0}
            refreshMs={10_000}
          />
        </div>
      )}

      {/* ── Signal feed with indicator calculations ── */}
      <SignalFeed
        candles={candles}
        shortPeriod={10}
        longPeriod={30}
        livePrice={livePrice}
        asset={asset}
        allocationPct={allocationPct}
      />

      {/* ── Trade history with P&L ── */}
      {bot?.indicatorAddr && (
        <TradeHistory indicatorAddr={bot.indicatorAddr} />
      )}
    </div>
  );
}
