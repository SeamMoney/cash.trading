"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { BacktestViewer } from "./BacktestViewer";
import { DeployForm } from "./DeployForm";
import { OnChainChart } from "./OnChainChart";
import { BotDashboard } from "./BotDashboard";
import { ScheduleTradeModal } from "./ScheduleTradeModal";
import { CreatorDashboard } from "./CreatorDashboard";
import { ScheduledJobsPanel } from "./ScheduledJobsPanel";
import type { ScheduledJob } from "@/lib/launchpad/types";
import { useSubscription } from "@/lib/launchpad/use-subscription";
import { Header } from "@/components/layout/Header";
import { AmbientBlobs } from "@/components/layout/AmbientBlobs";

const CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";

const TYPE_LABEL: Record<number, string> = {
  0: "SMA Crossover", 1: "EMA Crossover", 2: "RSI Oscillator",
  3: "MACD Divergence", 4: "Bollinger Bands",
};

interface Indicator {
  address: string; creator: string; name: string; symbol: string;
  description: string; assets: string[]; createdAt: number;
  curveAddr: string; aptReserves: number; totalRaised: number;
  simsFunded: number; isGraduated: boolean; totalSims: number;
  meanSharpe: number; profitablePct: number; robustnessScore: number;
  maxDrawdownBps: number; vaultAddr: string | null;
  lastSignal: number; lastSignalTime: number; params: number[];
  indicatorType: number;
  whopProductId?: string | null;
  isProprietary?: boolean;
  /** Published package defining this object's Move types — required for the
   *  live on-chain read on rail-deployed (single "indicator" module) packages. */
  pkg?: string;
  algoHash?: string;
  commitTs?: number;
  creatorFeeBps?: number;
  creatorFeeModel?: 'none' | 'flat' | 'profit_share';
  creatorEarningsUsdt?: number;
}

type Tab    = "explore" | "deploy" | "bots" | "creator";
type Sort   = "robustness" | "sharpe" | "raised";
type Filter = "all" | "live" | "testing";

// ─── Live signal hook (SSE) ────────────────────────────────────────────────────

interface LiveSignalState {
  signal: number;
  price: number;
  fastLine: number;
  slowLine: number;
  isLive: boolean;
  lastUpdate: number;
  /** Unix seconds of the freshest ON-CHAIN datum (price buffer / signal) —
   *  NOT the poll time. The engine freezes at its last crank, so poll time
   *  masks weeks-old data as live. */
  dataTime: number;
}

const SIGNAL_STALE_AFTER_MS = 30 * 60_000;

function useLiveSignal(addr: string, pkg?: string): LiveSignalState {
  const [state, setState] = useState<LiveSignalState>({
    signal: 0, price: 0, fastLine: 0, slowLine: 0, isLive: false, lastUpdate: 0, dataTime: 0,
  });
  useEffect(() => {
    if (!addr) return;
    let cancelled = false;
    async function poll() {
      try {
        const q = pkg ? `&pkg=${pkg}` : "";
        const res = await fetch(`/api/launchpad/on-chain?addr=${addr}&type=state${q}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        const price = typeof d.lastPrice === "number" ? (d.lastPrice > 1000 ? d.lastPrice : d.lastPrice / 1e8) : 0;
        const timestamps: number[] = Array.isArray(d.timestamps) ? d.timestamps : [];
        setState({
          signal: d.signal ?? 0,
          price,
          fastLine: d.fastLine ?? 0,
          slowLine: d.slowLine ?? 0,
          isLive: true,
          lastUpdate: Date.now(),
          dataTime: timestamps[timestamps.length - 1] ?? d.lastSignalTime ?? 0,
        });
      } catch { /* ignore */ }
    }
    poll();
    const t = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [addr, pkg]);
  return state;
}

// ─── Flash hook ───────────────────────────────────────────────────────────────

function useFlash(value: number): boolean {
  const [flashing, setFlashing] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value && prev.current !== 0) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 800);
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return flashing;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SIG_LABEL = ["Neutral", "BUY", "SELL"];
const SIG_DOT   = ["bg-zinc-600", "bg-emerald-400 animate-pulse", "bg-red-400 animate-pulse"];
const SIG_TEXT  = ["text-zinc-500", "text-emerald-400", "text-red-400"];
const SIG_CHIP  = [
  "border-[#2a2a2a] text-[#888]",
  "border-emerald-500/30 bg-emerald-500/12 text-emerald-400",
  "border-red-500/30 bg-red-500/12 text-red-400",
];

// ─── Left panel: indicator list item ─────────────────────────────────────────

function IndicatorItem({ ind, selected, onClick, index }: { ind: Indicator; selected: boolean; onClick: () => void; index: number }) {
  const sig   = ind.lastSignal ?? 0;
  const sharpe = (ind.meanSharpe / 1000).toFixed(2);

  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
      className={cn(
        "animate-enter w-full text-left px-3 py-2.5 rounded-lg transition-all group",
        selected
          ? "bg-[#202020] border border-[#2a2a2a]"
          : "border border-transparent hover:bg-[#181818] hover:border-[#2a2a2a]",
      )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 mt-px", SIG_DOT[sig])} />
            <span className="text-sm font-medium text-white truncate">{ind.name}</span>
            {ind.isProprietary && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono border border-amber-500/30 bg-amber-500/10 text-amber-400 shrink-0">
                <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                </svg>
                PROP
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 pl-3">
            <span className="text-[11px] text-zinc-500">{ind.assets[0]}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[11px] text-zinc-600">{TYPE_LABEL[ind.indicatorType] ?? "Strategy"}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={cn(
            "text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
            ind.isGraduated
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-[#2a2a2a] bg-[#202020] text-[#888]",
          )}>
            {ind.isGraduated ? "LIVE" : "TESTING"}
          </span>
          {ind.totalSims > 0 && (
            <p className="text-[10px] text-zinc-600 mt-0.5 tabular-nums">{sharpe} Sharpe</p>
          )}
        </div>
      </div>

      {sig !== 0 && (
        <div className="pl-3 mt-1.5">
          <span className={cn("text-[10px] font-semibold", SIG_TEXT[sig])}>
            {SIG_LABEL[sig]}
            {ind.lastSignalTime > 0 && <span className="text-zinc-600 font-normal ml-1">{timeAgo(ind.lastSignalTime)}</span>}
          </span>
        </div>
      )}
    </button>
  );
}

// ─── Right panel: empty state ─────────────────────────────────────────────────

function EmptyState({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-[#181818] border border-[#2a2a2a] flex items-center justify-center mb-5">
        <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      </div>
      <h3 className="text-base font-display font-semibold text-white mb-2">Select a strategy</h3>
      <p className="text-sm text-zinc-500 max-w-sm leading-relaxed mb-8">
        Each strategy runs automatically on-chain. Fund ones you believe in — at 600 APT they graduate to a live trading vault.
      </p>
      <div className="w-full max-w-xs space-y-3 text-left">
        {[
          { n: "01", title: "Browse strategies", desc: "See historical performance and live signals" },
          { n: "02", title: "Fund with APT",    desc: "Each APT funds more backtests to verify the edge" },
          { n: "03", title: "Graduate to live", desc: "At 600 APT, it executes real trades on Decibel" },
        ].map((s) => (
          <div key={s.n} className="flex items-start gap-3">
            <span className="text-accent font-display text-[14px] font-bold shrink-0 mt-0.5 tabular-nums">
              {s.n}
            </span>
            <div>
              <p className="font-semibold text-white text-sm mb-0.5">{s.title}</p>
              <p className="text-zinc-500 text-[12px] leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onDeploy}
        className="mt-8 px-4 py-2.5 rounded-[12px] bg-purple-500 text-white font-display font-bold text-[13px] hover:bg-purple-400 transition-colors tracking-wide">
        Deploy your own strategy →
      </button>
    </div>
  );
}

// ─── Stat cell (borderless floating) ─────────────────────────────────────────

function StatCard({ label, value, sub, good, warn }: { label: string; value: string; sub: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="px-5 py-4 first:pl-6 last:pr-6">
      <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-600 mb-1.5">{label}</p>
      <p className={cn(
        "text-[24px] font-display font-bold tabular-nums leading-none",
        warn ? "text-red-400" : good ? "text-emerald-400" : "text-zinc-200",
      )}>
        {value}
      </p>
      <p className="text-[11px] text-zinc-600 mt-1 leading-tight">{sub}</p>
    </div>
  );
}

// ─── Fund input (amount + button) ────────────────────────────────────────────

function FundInput({ fund, funding, connected }: { fund: (amt: number) => void; funding: boolean; connected: boolean }) {
  const [val, setVal] = useState("10");
  const n = parseFloat(val);
  const valid = !isNaN(n) && n > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-[140px]">
        <input
          type="number"
          min="0.1"
          step="1"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-full bg-[#202020] border border-[#2a2a2a] rounded-[10px] px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-white/20 placeholder:text-zinc-700 pr-12"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-600 font-mono">APT</span>
      </div>
      <button
        onClick={() => valid && fund(n)}
        disabled={funding || !valid}
        className={cn(
          "px-4 py-2 rounded-[10px] text-[13px] font-display font-bold transition-all",
          funding ? "bg-[#202020] text-zinc-600 cursor-wait" :
          connected ? "bg-emerald-500/20 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/30" :
                      "bg-amber-500/15 border border-amber-500/20 text-amber-400 hover:bg-amber-500/25",
        )}
      >
        {funding ? "…" : "Fund Strategy"}
      </button>
      {!connected && <span className="text-[11px] text-zinc-700">no wallet needed</span>}
    </div>
  );
}

// ─── Compact action bar: backtest toggle + deploy button ─────────────────────

function BacktestBar({ ind, showUnlock, onUnlock, onDeployBot }: {
  ind: Indicator;
  showUnlock: boolean;
  onUnlock: () => void;
  onDeployBot: () => void;
}) {
  const [showBacktest, setShowBacktest] = useState(false);
  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-t border-[#1e1e1e]">
        <button
          onClick={() => setShowBacktest((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 font-mono transition-colors"
        >
          <span style={{
            display: "inline-block",
            transform: showBacktest ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}>▶</span>
          Backtest
        </button>
        <button
          onClick={showUnlock ? onUnlock : onDeployBot}
          className={cn(
            "px-4 py-2 rounded-[10px] text-[12px] font-display font-bold transition-colors flex items-center gap-1.5",
            showUnlock
              ? "bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30"
              : "bg-purple-500 text-white hover:bg-purple-400",
          )}
        >
          {showUnlock ? "Unlock · $29/mo" : "Deploy Bot"}
        </button>
      </div>
      {showBacktest && (
        <div className="px-5 pb-5">
          <BacktestViewer
            indicatorAddr={ind.address}
            indicatorName={ind.name}
            params={ind.params}
            asset={ind.assets[0] ?? "BTC/USD"}
          />
        </div>
      )}
    </>
  );
}

// ─── Right panel: detail view ─────────────────────────────────────────────────

function IndicatorDetail({
  ind, onFunded, isSubscribed, onDeployBot, onUnlock, onDeployOwn,
}: {
  ind: Indicator;
  onFunded: (u: Record<string, unknown>) => void;
  isSubscribed: boolean;
  onDeployBot: () => void;
  onUnlock: () => void;
  onDeployOwn: () => void;
}) {
  const live     = useLiveSignal(ind.address, ind.pkg);
  const flashing = useFlash(live.signal);
  const sig      = live.isLive ? live.signal : (ind.lastSignal ?? 0);
  const sharpe   = (ind.meanSharpe / 1000).toFixed(2);
  const sharpeN  = ind.meanSharpe / 1000;

  const { signAndSubmitTransaction, connected } = useWallet();
  const [funding, setFunding] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const raisedApt  = ind.totalRaised / 1e8;
  const progressPct = Math.min(100, (raisedApt / 600) * 100);
  const remaining   = Math.max(0, 600 - raisedApt);

  // ── Particle effect refs ──────────────────────────────────────────────────
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number }[]>([]);
  const animRef = useRef<number>(0);

  function drawParticles() {
    const canvas = particleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = 40;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);
    particlesRef.current.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      const alpha = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 158, 11, ${alpha * 0.8})`;
      ctx.shadowBlur = 6;
      ctx.shadowColor = `rgba(245, 158, 11, ${alpha * 0.5})`;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    if (particlesRef.current.length > 0) {
      animRef.current = requestAnimationFrame(drawParticles);
    }
  }

  useEffect(() => {
    return () => { cancelAnimationFrame(animRef.current); };
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  async function updateRegistry(amt: number) {
    const res  = await fetch("/api/launchpad/indicators", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: ind.address, aptAmount: amt }),
    });
    const data = await res.json();
    if (data.indicator) onFunded(data.indicator);
  }

  async function fund(amt: number) {
    setFunding(true); setTxError(null);
    try {
      if (connected) {
        const aptOctas = (BigInt(amt) * BigInt(100_000_000)).toString();
        await signAndSubmitTransaction({
          data: {
            function: `${CONTRACT}::bonding_curve::buy`,
            typeArguments: [],
            functionArguments: [ind.address, aptOctas, "0"],
          },
        });
      }
      // Spawn particles at the current progress position before updating
      const canvasEl = particleCanvasRef.current;
      if (canvasEl) {
        const oldPct = Math.min(100, (ind.totalRaised / 1e8 / 600) * 100);
        const spawnX = (oldPct / 100) * canvasEl.offsetWidth;
        const newParticles = Array.from({ length: 12 }, () => ({
          x: spawnX,
          y: 20,
          vx: Math.random() * 2 + 1,
          vy: (Math.random() - 0.5) * 1.5,
          life: 0,
          maxLife: 40 + Math.random() * 20,
          size: Math.random() * 2.5 + 1,
        }));
        particlesRef.current = [...particlesRef.current, ...newParticles];
        cancelAnimationFrame(animRef.current);
        drawParticles();
      }
      await updateRegistry(amt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        setTxError("Transaction failed");
      }
    } finally { setFunding(false); }
  }

  const showUnlock = !!(ind.isProprietary && !isSubscribed);

  return (
    <div className="w-full">
      {/* ── Name + status ── */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="font-display font-bold text-[22px] tracking-tight text-white">{ind.name}</h2>
            <span className={cn(
              "text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border",
              ind.isGraduated
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-[#2a2a2a] bg-[#202020] text-[#888]",
            )}>
              {ind.isGraduated ? "LIVE" : "TESTING"}
            </span>
            {ind.isProprietary && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                </svg>
                PROPRIETARY
              </span>
            )}
          </div>
          <p className="text-[13px] text-zinc-500 mt-1">
            {TYPE_LABEL[ind.indicatorType] ?? "Strategy"} · {ind.assets.join(", ")}
          </p>
          {ind.description && (
            <p className="text-[12px] text-zinc-600 mt-1 max-w-lg leading-relaxed">{ind.description}</p>
          )}
          <button
            onClick={onDeployOwn}
            className="mt-2 text-[11px] font-mono text-emerald-400/80 hover:text-emerald-400 transition-colors"
          >
            Deploy your own strategy from PineScript →
          </button>
          {/* On-chain provenance — trustless means you can inspect it. Shown
              only for real on-chain vaults (testnet); links are explicit
              testnet so they resolve regardless of the app's network. */}
          {(ind.pkg || ind.vaultAddr) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-600">
              <span className="text-zinc-700">On-chain:</span>
              {ind.pkg && (
                <a className="text-zinc-500 hover:text-emerald-400 transition-colors"
                   href={`https://explorer.aptoslabs.com/account/${ind.pkg}?network=testnet`}
                   target="_blank" rel="noreferrer">strategy module ↗</a>
              )}
              <a className="text-zinc-500 hover:text-emerald-400 transition-colors"
                 href={`https://explorer.aptoslabs.com/account/${ind.address}?network=testnet`}
                 target="_blank" rel="noreferrer">indicator ↗</a>
              {ind.vaultAddr && (
                <a className="text-zinc-500 hover:text-emerald-400 transition-colors"
                   href={`https://explorer.aptoslabs.com/account/${ind.vaultAddr}?network=testnet`}
                   target="_blank" rel="noreferrer">Decibel vault ↗</a>
              )}
            </div>
          )}
        </div>

        {/* Inline signal — no border box */}
        {sig !== 0 && (
          <div className={cn(
            "shrink-0 flex flex-col items-end gap-0.5 transition-all duration-200",
            flashing && "opacity-80",
          )}>
            {(() => {
              // A frozen engine (last crank weeks ago) must not read as a
              // live BUY/SELL call — date it and drop the current-price look.
              const stale =
                live.isLive &&
                live.dataTime > 0 &&
                Date.now() - live.dataTime * 1000 > SIGNAL_STALE_AFTER_MS;
              return (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stale ? "bg-zinc-600" : SIG_DOT[sig])} />
                    <span className={cn("text-base font-bold font-mono tracking-wide", stale ? "text-zinc-500" : SIG_TEXT[sig])}>
                      {stale ? `LAST ${SIG_LABEL[sig]}` : SIG_LABEL[sig]}
                    </span>
                  </div>
                  {live.isLive && live.price > 0 && (
                    <span className={cn("text-[11px] font-mono tabular-nums", stale ? "text-amber-500/80" : "text-zinc-600")}>
                      ${live.price > 1000
                        ? live.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : live.price.toFixed(4)}
                      {stale && ` · ${timeAgo(live.dataTime * 1000)}`}
                    </span>
                  )}
                  {!live.isLive && ind.lastSignalTime > 0 && (
                    <span className="text-[11px] text-zinc-600">{timeAgo(ind.lastSignalTime)}</span>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Chart — edge-to-edge, no side padding ── */}
      <div className="w-full">
        <OnChainChart
          indicatorAddr={ind.address}
          asset={ind.assets[0] ?? "BTC/USD"}
          indicatorType={ind.indicatorType ?? 0}
          shortPeriod={ind.params?.[0] ?? 10}
          longPeriod={ind.params?.[1] ?? 30}
          thirdPeriod={ind.params?.[2] ?? 0}
          refreshMs={15_000}
          decibelMarket={
            ind.address === CONTRACT ? ind.assets[0] ?? "BTC/USD" : undefined
          }
          decibelSize={0.001}
        />
      </div>

      {/* ── Key stats — floating, no cards ── */}
      {ind.totalSims > 0 && (
        <div className="grid grid-cols-4 divide-x divide-[#1e1e1e] border-y border-[#1e1e1e]">
          <StatCard
            label="Win Rate"
            value={`${ind.profitablePct}%`}
            sub="of variations profitable"
            good={ind.profitablePct >= 80}
          />
          <StatCard
            label="Return/Risk"
            value={sharpe}
            sub={`Sharpe · ${sharpeN >= 2 ? "excellent" : sharpeN >= 1.5 ? "good" : "fair"}`}
            good={sharpeN >= 1.5}
          />
          <StatCard
            label="Max Drawdown"
            value={`-${(ind.maxDrawdownBps / 100).toFixed(1)}%`}
            sub="peak-to-trough"
            warn
          />
          <StatCard
            label="Sims"
            value={ind.totalSims >= 1000 ? `${(ind.totalSims / 1000).toFixed(1)}k` : String(ind.totalSims)}
            sub={`${ind.totalSims >= 1000 ? "high" : "low"} confidence`}
            good={ind.totalSims >= 1000}
          />
        </div>
      )}

      {/* ── Fund section — bonding curve journey ── */}
      {!ind.isGraduated && (
        <div className="px-6 py-5 border-b border-[#1e1e1e]">
          {/* Journey explanation */}
          <div className="flex items-center gap-0 mb-4 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-amber-400">SIMULATION</span>
            </div>
            <div className="flex-1 mx-3 h-10 flex items-center relative">
              <canvas
                ref={particleCanvasRef}
                className="absolute pointer-events-none"
                style={{ top: "-18px", left: 0, right: 0, width: "100%", height: "40px", zIndex: 10 }}
              />
              <div className="w-full h-px bg-[#2a2a2a] relative">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700"
                  style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/40" />
              <span className="text-zinc-600">600 APT → LIVE VAULT</span>
            </div>
          </div>

          <p className="text-[12px] text-zinc-500 leading-relaxed mb-4">
            Funding runs Monte Carlo stress tests — thousands of parameter variations to prove the edge is real, not overfit.
            At <span className="text-white font-mono">600 APT</span> this strategy graduates to a live vault on Decibel and begins executing real trades.
            {remaining > 0 && <span className="text-zinc-400"> {remaining.toFixed(0)} APT remaining.</span>}
          </p>

          {/* Amount input + fund button */}
          <FundInput fund={fund} funding={funding} connected={connected} />
          {txError && <p className="mt-2 text-[11px] text-red-400">{txError}</p>}
        </div>
      )}

      {/* ── Action bar: Deploy Bot + Backtest toggle in one compact row ── */}
      <BacktestBar
        ind={ind}
        showUnlock={showUnlock}
        onUnlock={onUnlock}
        onDeployBot={onDeployBot}
      />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LaunchpadPage() {
  const [tab,        setTab]        = useState<Tab>("explore");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [selected,   setSelected]   = useState<Indicator | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadKey,    setLoadKey]    = useState(0);
  const [sort,       setSort]       = useState<Sort>("robustness");
  const [filter,     setFilter]     = useState<Filter>("all");
  const [showSignals, setShowSignals] = useState(false);
  const [showGraduated, setShowGraduated] = useState(false);
  const [meta,       setMeta]       = useState({ total: 0, graduated: 0, totalRaisedApt: 0 });
  const [scheduleTarget, setScheduleTarget] = useState<Indicator | null>(null);
  const { connected, account, disconnect } = useWallet();
  const { isSubscribed, subscribe } = useSubscription();

  const fetchIndicators = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sort });
      if (filter === "live")    params.set("graduated", "true");
      if (filter === "testing") params.set("graduated", "false");
      if (showGraduated)        params.set("graduated", "true");
      const res  = await fetch(`/api/launchpad/indicators?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const all: Indicator[] = data.indicators || [];
      const visible = showSignals ? all.filter((i) => i.lastSignal !== 0) : all;
      setIndicators(visible);
      setMeta({ total: data.total, graduated: data.graduated, totalRaisedApt: data.totalRaisedApt });
    } catch { /* silently fail */ }
    finally {
      setLoading((wasLoading) => {
        if (wasLoading) setLoadKey((k) => k + 1);
        return false;
      });
    }
  }, [sort, filter, showSignals, showGraduated]);

  useEffect(() => {
    fetchIndicators();
    const t = setInterval(fetchIndicators, 15_000);
    return () => clearInterval(t);
  }, [fetchIndicators]);

  // Keep selected indicator fresh when registry updates
  useEffect(() => {
    if (!selected) return;
    const fresh = indicators.find((i) => i.address === selected.address);
    if (fresh) setSelected(fresh);
  }, [indicators]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFunded(updated: Record<string, unknown>) {
    setIndicators((prev) => prev.map((i) =>
      i.address === selected?.address ? { ...i, ...updated } : i,
    ));
    if (selected) setSelected((prev) => prev ? { ...prev, ...updated as Partial<Indicator> } : prev);
  }

  function handleDeployed(addr: string) {
    setTab("explore");
    fetchIndicators();
    setTimeout(() => {
      setIndicators((prev) => {
        const found = prev.find((i) => i.address === addr);
        if (found) setSelected(found);
        return prev;
      });
    }, 500);
  }

  // Convert Indicator to IndicatorEntry shape for ScheduleTradeModal
  function toIndicatorEntry(ind: Indicator) {
    return {
      address: ind.address,
      creator: ind.creator,
      name: ind.name,
      symbol: ind.symbol,
      description: ind.description,
      assets: ind.assets,
      createdAt: ind.createdAt,
      curveAddr: ind.curveAddr,
      aptReserves: ind.aptReserves,
      totalRaised: ind.totalRaised,
      simsFunded: ind.simsFunded,
      isGraduated: ind.isGraduated,
      totalSims: ind.totalSims,
      meanSharpe: ind.meanSharpe,
      profitablePct: ind.profitablePct,
      robustnessScore: ind.robustnessScore,
      maxDrawdownBps: ind.maxDrawdownBps,
      vaultAddr: ind.vaultAddr,
      lastSignal: ind.lastSignal,
      lastSignalTime: ind.lastSignalTime,
      params: ind.params,
      indicatorType: ind.indicatorType,
      isProprietary: ind.isProprietary,
      algoHash: ind.algoHash,
      commitTs: ind.commitTs,
      creatorFeeBps: ind.creatorFeeBps,
      creatorFeeModel: ind.creatorFeeModel,
      creatorEarningsUsdt: ind.creatorEarningsUsdt,
    };
  }

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <Header />
      <div className="relative" style={{ overflow: "clip" }}>
        <AmbientBlobs variant="launchpad" />
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 w-full">

          {/* ── Hero ── */}
          <div className="mb-4 animate-enter flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="font-display font-bold text-[20px] sm:text-[24px] tracking-tight text-white">
                Strategy Marketplace
              </h1>
              {!loading && (
                <span className="text-[10px] font-mono text-[#555]">
                  {meta.total} strategies · {meta.graduated} live
                </span>
              )}
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex items-center gap-1 border-b border-[#2a2a2a] mb-6 animate-enter-delay-1">
            {(["explore", "deploy", "bots", "creator"] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn(
                  "px-4 py-2.5 text-[13px] font-display font-semibold transition-all border-b-2 -mb-px",
                  tab === t
                    ? "border-white text-white"
                    : "border-transparent text-[#888] hover:text-zinc-300",
                )}>
                {t === "explore" ? "Explore" : t === "deploy" ? "Deploy" : t === "bots" ? "My Bots" : "Creator"}
              </button>
            ))}
          </div>

          {/* ── Explore ── */}
          {tab === "explore" && (
            <div className="animate-enter-delay-2">
              <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">

                {/* Left: list panel — relative wrapper so the panel doesn't inflate the grid row height */}
                <div className="relative min-h-[480px]">
                  <div className="lg:absolute lg:inset-0 w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)] flex flex-col">
                    {/* Filters header */}
                    <header className="shrink-0 border-b border-[#2a2a2a] bg-[#202020] flex items-center px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-[#888]">
                      Strategies
                    </header>

                    {/* Filter controls */}
                    <div className="shrink-0 px-3 py-2.5 border-b border-[#2a2a2a] bg-[#181818] space-y-2">
                      <div className="flex gap-0.5 bg-[#111] border border-[#2a2a2a] rounded-lg p-0.5">
                        {(["all", "live", "testing"] as Array<"all" | "live" | "testing">).map((f) => (
                          <button key={f} onClick={() => setFilter(f)}
                            className={cn(
                              "flex-1 py-1 rounded text-[11px] font-display font-medium transition-colors",
                              filter === f ? "bg-[#202020] text-white" : "text-[#888] hover:text-zinc-300",
                            )}>
                            {f === "all" ? "All" : f === "live" ? "Live" : "Testing"}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <button
                          onClick={() => setShowSignals((v) => !v)}
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors",
                            showSignals
                              ? "bg-white text-black border-white"
                              : "border-[#2a2a2a] text-[#888] hover:text-zinc-300",
                          )}>
                          LIVE SIGNALS
                        </button>
                        <button
                          onClick={() => setShowGraduated((v) => !v)}
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors",
                            showGraduated
                              ? "bg-white text-black border-white"
                              : "border-[#2a2a2a] text-[#888] hover:text-zinc-300",
                          )}>
                          GRADUATED
                        </button>
                      </div>
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-[#888] shrink-0 font-mono">Sort:</span>
                        {(["robustness", "sharpe", "raised"] as Sort[]).map((s) => (
                          <button key={s} onClick={() => setSort(s)}
                            className={cn(
                              "flex-1 py-1 rounded border text-center transition-colors font-mono text-[10px]",
                              sort === s
                                ? "border-[#2a2a2a] bg-[#202020] text-white"
                                : "border-[#1e1e1e] text-[#555] hover:text-[#888]",
                            )}>
                            {s === "robustness" ? "Score" : s === "sharpe" ? "Sharpe" : "Raised"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Indicator list */}
                    <div key={loadKey} className="bg-[#111] overflow-y-auto flex-1 min-h-0 p-2 space-y-0.5">
                      {loading ? (
                        <>
                          {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-14 rounded-lg bg-[#181818] animate-pulse mx-1" />
                          ))}
                        </>
                      ) : indicators.length === 0 ? (
                        <div className="text-center py-8 px-4">
                          <p className="text-xs text-[#888]">No strategies found</p>
                          <button onClick={() => setTab("deploy")}
                            className="mt-3 text-xs text-zinc-400 hover:text-white underline">
                            Deploy the first one →
                          </button>
                        </div>
                      ) : (
                        indicators.map((ind, i) => (
                          <IndicatorItem
                            key={ind.address}
                            ind={ind}
                            index={i}
                            selected={selected?.address === ind.address}
                            onClick={() => setSelected(ind)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: detail panel */}
                <div className="w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
                  <div className="bg-[#111] min-h-[480px]">
                    {selected ? (
                      <IndicatorDetail
                        key={selected.address}
                        ind={selected}
                        onFunded={handleFunded}
                        isSubscribed={isSubscribed(selected.address)}
                        onDeployBot={() => setScheduleTarget(selected)}
                        onUnlock={() => { subscribe(selected.address, 29); }}
                        onDeployOwn={() => setTab("deploy")}
                      />
                    ) : (
                      <EmptyState onDeploy={() => setTab("deploy")} />
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ── Deploy tab ── */}
          {tab === "deploy" && (
            <div className="animate-enter-delay-1">
              <div className="w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
                <header className="border-b border-[#2a2a2a] bg-[#202020] flex items-center px-5 py-4 sm:px-8 sm:py-5 font-mono text-sm font-semibold tabular-nums text-[#888]">
                  Deploy a Strategy
                </header>
                <div className="bg-[#111] px-2 sm:px-4 py-3">
                  <DeployForm onDeployed={handleDeployed} />
                </div>
              </div>
            </div>
          )}

          {/* ── Bots tab ── */}
          {tab === "bots" && (
            <div className="animate-enter-delay-1 space-y-4">
              <ScheduledJobsPanel />
              <BotDashboard />
            </div>
          )}

          {/* ── Creator tab ── */}
          {tab === "creator" && (
            <div className="animate-enter-delay-1">
              <CreatorDashboard creatorAddr={account?.address?.toString()} />
            </div>
          )}

        </main>
      </div>

      {/* ── Schedule modal ── */}
      {scheduleTarget && (
        <ScheduleTradeModal
          indicator={toIndicatorEntry(scheduleTarget)}
          isOpen={true}
          onClose={() => setScheduleTarget(null)}
          onScheduled={(_job: ScheduledJob) => { setScheduleTarget(null); setTab("bots"); }}
        />
      )}

    </div>
  );
}
