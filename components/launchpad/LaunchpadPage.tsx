"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { cn } from "@/lib/utils";
import { BacktestViewer } from "./BacktestViewer";
import { DeployForm } from "./DeployForm";
import { OnChainChart } from "./OnChainChart";
import { CreatorDashboard } from "./CreatorDashboard";
import { SealedLaunch } from "@/components/sealed/SealedLaunch";
import { SealedSwap } from "@/components/sealed/SealedSwap";
import { SealedVaultFeed } from "@/components/sealed/SealedVaultFeed";
import { Header } from "@/components/layout/Header";
import { AmbientBlobs } from "@/components/layout/AmbientBlobs";
import { PRODUCT_PRESSABLE_CLASS } from "@/components/ui/product-surface";
import { getClientNetwork } from "@/lib/decibel-client";

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

// Restore the original Whop marketplace map. Each destination has one job and the labels
// match the product model users already learned there.
type Tab    = "explore" | "deploy" | "bots" | "creator";
/** The Deploy tab hosts two stages: author a module, or take one live. */
type DeployStage = "build" | "launch";
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

function useLiveSignal(addr: string, pkg?: string, opts?: { once?: boolean }): LiveSignalState {
  const [state, setState] = useState<LiveSignalState>({
    signal: 0, price: 0, fastLine: 0, slowLine: 0, isLive: false, lastUpdate: 0, dataTime: 0,
  });
  const once = opts?.once ?? false;
  useEffect(() => {
    if (!addr) return;
    let cancelled = false;
    async function poll() {
      try {
        const q = pkg ? `&pkg=${encodeURIComponent(pkg)}` : "";
        const res = await fetch(`/api/launchpad/on-chain?addr=${addr}&type=state${q}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        const price = typeof d.lastPrice === "number" && Number.isFinite(d.lastPrice) && d.lastPrice > 0
          ? d.lastPrice
          : 0;
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
    if (once) return () => { cancelled = true; };
    const t = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [addr, pkg, once]);
  return state;
}

// ─── Flash hook ───────────────────────────────────────────────────────────────

function useFlash(value: number): boolean {
  const [flashing, setFlashing] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    const previous = prev.current;
    prev.current = value;
    if (previous !== value && previous !== 0) {
      setFlashing(true);
      const t = setTimeout(() => setFlashing(false), 800);
      return () => clearTimeout(t);
    }
    setFlashing(false);
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
const SIG_DOT   = ["bg-zinc-600", "bg-emerald-400 animate-pulse motion-reduce:animate-none", "bg-red-400 animate-pulse motion-reduce:animate-none"];
const SIG_TEXT  = ["text-[#a1a1a1]", "text-emerald-400", "text-red-400"];
const SIG_CHIP  = [
  "border-[#2a2a2a] text-[#888]",
  "border-emerald-500/14 bg-emerald-500/12 text-emerald-400",
  "border-red-500/14 bg-red-500/12 text-red-400",
];

// ─── Left panel: indicator list item ─────────────────────────────────────────

/**
 * Market strings arrive inconsistently from the registry — some rows carry
 * "ETH/USD" and others just "ETH" — which made one list show two conventions
 * side by side and read like unmigrated data. Every perp here is USD-quoted.
 */
function marketLabel(asset: string | undefined): string {
  const a = (asset ?? "").trim();
  if (!a) return "";
  return a.includes("/") ? a : `${a}/USD`;
}

/**
 * The literal word "Strategy" is what `TYPE_LABEL` falls back to when an
 * indicator's type isn't one of the known kinds. It adds nothing next to a
 * name like "SuperTrend ETH" and reads as unfilled placeholder, so an unknown
 * type renders nothing at all rather than filler.
 */
function typeLabel(indicatorType: number): string | null {
  return TYPE_LABEL[indicatorType] ?? null;
}

/** The row shows whatever the list is ordered by — see `metricFor`. */
function metricFor(ind: Indicator, sort: Sort): { value: string; label: string } {
  if (sort === "sharpe") return { value: (ind.meanSharpe / 1000).toFixed(2), label: "Sharpe" };
  if (sort === "raised") return { value: `${(ind.totalRaised / 1e8).toFixed(2)}`, label: "APT" };
  return { value: String(ind.robustnessScore), label: "Score" };
}

function IndicatorItem({ ind, selected, rank, sort, onClick }: { ind: Indicator; selected: boolean; rank: number; sort: Sort; onClick: () => void }) {
  // Live strategies read the SAME on-chain state the detail header shows —
  // the seed lastSignal drifted ("SELL 42d ago" row vs "LAST BUY · 94d ago"
  // detail) and contradicted it in both direction and age.
  const live = useLiveSignal(ind.address, ind.pkg, { once: true });
  const hasLive = live.isLive && live.dataTime > 0;
  const sig = hasLive ? live.signal : (ind.lastSignal ?? 0);
  const sigTimeMs = hasLive ? live.dataTime * 1000 : ind.lastSignalTime;
  const sigStale =
    hasLive && live.dataTime > 0 && Date.now() - live.dataTime * 1000 > SIGNAL_STALE_AFTER_MS;
  // Show the number the list is actually ordered by. Rendering Sharpe while
  // sorting on Score made the column non-monotonic, so a correctly sorted list
  // read as unsorted — the worst signal a ranked marketplace can send.
  const metric = metricFor(ind, sort);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Concentric with the panel it sits in: the list is inset by the panel
        // border (1px) + its p-1.5 padding (6px), so the item's corner must be
        // 7px tighter than the panel's --radius to keep the curves parallel.
        // Its px-2.5 (10px) + that 6px puts row text on the same 16px axis as
        // the panel header and filter block.
        "group w-full rounded-[calc(var(--radius)-7px)] px-2.5 py-2.5 text-left",
        PRODUCT_PRESSABLE_CLASS,
        // Same selection language as the tabs and filters: accent, not grey.
        selected
          ? "border border-accent/13 bg-accent/[0.07]"
          // Hover was a 3/255 lift on #0f0f0f — effectively invisible.
          : "border border-transparent hover:border-white/[0.10] hover:bg-white/[0.06]",
      )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* No wrapping: a long name used to push itself onto a second line and
              strand the status dot alone above it, so that row alone broke the
              list's alignment. The name truncates instead — every row is one line. */}
          <div className="flex items-center gap-1.5">
            {/* Rank, not a dot. The dot had gone fully decorative — identical
                grey on every row, encoding nothing — while still pushing every
                title 14px off the panel's text axis. An ordinal keeps the
                ordering legible even when the sort is a composite score. */}
            <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-[#6f6f6f]">
              {String(rank).padStart(2, "0")}
            </span>
            {/* min-w-0 (not flex-1) so the name shrinks and truncates when long
                but still sizes to content when short — otherwise it grows and
                shoves the PROP badge to the far edge, away from its label. */}
            <span className="min-w-0 truncate text-sm font-medium text-white">{ind.name}</span>
            {ind.isProprietary && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-[var(--radius-xs)] text-[9px] font-bold font-mono border border-white/[0.10] bg-white/[0.06] text-[#c4c4c4] shrink-0">
                <svg className="w-2 h-2" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                </svg>
                PROP
              </span>
            )}
          </div>
          {/* One tone for the whole subtitle: three greys on an 11px line read as
              fuzz, not hierarchy. #8a8a8a clears AA on this surface. */}
          {/* Last signal rides on the subtitle rather than a third line. As its
              own row it appeared on some strategies and not others, so the list
              pitch swung 70/100/100px and had no rhythm to scan against. */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate pl-[22px] text-[11px] text-[#8a8a8a]">
            <span className="shrink-0">{marketLabel(ind.assets[0])}</span>
            {/* The type mostly restates the name ("SMA Crossover Pro" → "SMA
                Crossover"), so when a signal exists it yields the slot rather
                than truncating both to "SM…". Recency beats a redundant label.
                When neither exists the separator goes too — a trailing "·"
                with nothing after it is the tell of a missing field. */}
            {sig !== 0 && sigTimeMs > 0 ? (
              <>
                <span className="shrink-0 opacity-50">·</span>
                <span className={cn("truncate font-medium", sigStale ? "text-[#8a8a8a]" : SIG_TEXT[sig])}>
                  {SIG_LABEL[sig]} {timeAgo(sigTimeMs)}
                </span>
              </>
            ) : typeLabel(ind.indicatorType) ? (
              <>
                <span className="shrink-0 opacity-50">·</span>
                <span className="truncate">{typeLabel(ind.indicatorType)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {/* Only LIVE earns a badge. "TESTING" was identical on every row and
              the header already reports how many are live, so it was the
              loudest thing in the row while carrying no information — and it
              crowded out the one number that distinguishes strategies. */}
          {ind.isGraduated && (
            <span className="rounded-full border border-emerald-500/14 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
              LIVE
            </span>
          )}
          {ind.totalSims > 0 && (
            // The row's only differentiating number, so it outranks everything
            // else here — it used to be smaller than the subtitle above it.
            <p className={cn("text-[15px] font-semibold tabular-nums text-[#e5e5e5]", ind.isGraduated && "mt-1")}>
              {metric.value}
              <span className="ml-1 text-[10px] font-normal text-[#8a8a8a]">{metric.label}</span>
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Right panel: empty state ─────────────────────────────────────────────────

function EmptyState({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16">
      <div className="w-12 h-12 rounded-full bg-[#181818] border border-[#2a2a2a] flex items-center justify-center mb-5">
        <svg className="w-5 h-5 text-[#8a8a8a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
      </div>
      <h3 className="text-base font-display font-semibold text-white mb-2">Select a strategy</h3>
      <p className="text-sm text-[#a1a1a1] max-w-sm leading-relaxed mb-8">
        Inspect strategies discovered on Aptos, review their on-chain state, or deploy your own.
      </p>
      <div className="w-full max-w-xs space-y-3 text-left">
        {[
          { n: "01", title: "Browse strategies", desc: "Read verified contract state and signal history" },
          { n: "02", title: "Run a backtest", desc: "Stress-test supported parameters with market candles" },
          { n: "03", title: "Deploy on-chain", desc: "Confirm creation from your connected Aptos wallet" },
        ].map((s) => (
          <div key={s.n} className="flex items-start gap-3">
            <span className="text-accent font-display text-[14px] font-bold shrink-0 mt-0.5 tabular-nums">
              {s.n}
            </span>
            <div>
              <p className="font-semibold text-white text-sm mb-0.5">{s.title}</p>
              <p className="text-[#a1a1a1] text-[12px] leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onDeploy}
        className={cn(
          "mt-8 rounded-[var(--radius-sm)] bg-accent px-4 py-2.5 font-display text-[13px] font-bold tracking-wide text-accent-foreground hover:brightness-95",
          PRODUCT_PRESSABLE_CLASS,
        )}
      >
        Deploy your own strategy →
      </button>
    </div>
  );
}

// ─── Stat cell (borderless floating) ─────────────────────────────────────────

function StatCard({ label, value, sub, good, warn }: { label: string; value: string; sub: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="min-w-0 border-b border-card-border px-4 py-4 odd:border-r odd:border-r-card-border sm:border-0 sm:px-5 sm:first:pl-6 sm:last:pr-6">
      <p className="mb-1.5 truncate text-[10px] font-mono uppercase tracking-[0.15em] text-[#8a8a8a]">{label}</p>
      <p className={cn(
        "truncate text-[20px] font-display font-bold tabular-nums leading-none sm:text-[24px]",
        warn ? "text-red-400" : good ? "text-emerald-400" : "text-zinc-200",
      )}>
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] leading-tight text-[#8a8a8a]">{sub}</p>
    </div>
  );
}

// ─── Compact action bar: backtest toggle + deploy button ─────────────────────

function BacktestBar({ ind, showBacktest, setShowBacktest }: {
  ind: Indicator;
  showBacktest: boolean;
  setShowBacktest: (fn: (v: boolean) => boolean) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-t border-card-border">
        <button
          type="button"
          onClick={() => setShowBacktest((v) => !v)}
          aria-expanded={showBacktest}
          className={cn("flex items-center gap-1.5 rounded-[var(--radius-xs)] font-mono text-[11px] text-[#a1a1a1] hover:text-zinc-300", PRODUCT_PRESSABLE_CLASS)}
        >
          <span style={{
            display: "inline-block",
            transform: showBacktest ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}>▶</span>
          Backtest
        </button>
        <button
          type="button"
          disabled
          title="Persistent, wallet-authorized launchpad automation is not deployed"
          className="px-4 py-2 rounded-[var(--radius-sm)] text-[12px] font-display font-bold flex items-center gap-1.5 border border-card-border bg-[#181818] text-[#8a8a8a] cursor-not-allowed"
        >
          Automation unavailable
        </button>
      </div>
      {showBacktest && (
        <div className="px-5 pb-5">
          <BacktestViewer
            indicatorAddr={ind.address}
            indicatorName={ind.name}
            indicatorType={ind.indicatorType}
            params={ind.params}
            asset={ind.assets[0] ?? "BTC/USD"}
          />
        </div>
      )}
    </>
  );
}

// ─── Right panel: detail view ─────────────────────────────────────────────────

function IndicatorDetail({ ind, onDeployOwn }: { ind: Indicator; onDeployOwn: () => void }) {
  // Lifted out of BacktestBar so the header can offer it as this strategy's
  // primary action — the only accent control in the pane used to point at
  // authoring a NEW strategy, not at doing anything with the selected one.
  const [showBacktest, setShowBacktest] = useState(false);
  const live     = useLiveSignal(ind.address, ind.pkg);
  const flashing = useFlash(live.signal);
  const sig      = live.isLive ? live.signal : (ind.lastSignal ?? 0);
  const sharpe   = (ind.meanSharpe / 1000).toFixed(2);
  const sharpeN  = ind.meanSharpe / 1000;

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
                ? "border-emerald-500/14 bg-emerald-500/10 text-emerald-400"
                : "border-[#2a2a2a] bg-[#202020] text-[#888]",
            )}>
              {ind.isGraduated ? "LIVE" : "TESTING"}
            </span>
            {ind.isProprietary && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-bold font-mono border border-white/[0.10] bg-white/[0.06] text-[#c4c4c4]">
                <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                </svg>
                PROPRIETARY
              </span>
            )}
          </div>
          <p className="text-[13px] text-[#a1a1a1] mt-1">
            {[typeLabel(ind.indicatorType), ind.assets.map(marketLabel).filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/* Body copy, not a caption — it gets the brighter neutral step. */}
          {ind.description && (
            <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-[#a1a1a1]">{ind.description}</p>
          )}
          {/* Primary action acts on THIS strategy. Backtesting is the real one
              available today — the bonding curve and vault graduation are not
              deployed (see the notice below), so an "invest" button here would
              promise something the contract cannot do. Authoring a new strategy
              is a different job and no longer wears the accent. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBacktest((v) => !v)}
              aria-expanded={showBacktest}
              className={cn(
                "rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 text-[12px] font-display font-semibold text-black shadow-[0_2px_14px_-2px_rgba(57,255,20,0.35)] transition-all duration-200 hover:shadow-[0_4px_20px_-2px_rgba(57,255,20,0.5)] hover:brightness-[1.03]",
                PRODUCT_PRESSABLE_CLASS,
              )}
            >
              {showBacktest ? "Hide backtest" : "Backtest this strategy"}
            </button>
            <button
              type="button"
              onClick={onDeployOwn}
              className={cn("rounded-[var(--radius-xs)] px-1 font-mono text-[11px] text-[#a1a1a1] hover:text-white", PRODUCT_PRESSABLE_CLASS)}
            >
              Deploy your own from Pine Script →
            </button>
          </div>
          {/* On-chain provenance — trustless means you can inspect it. Shown
              only for real on-chain vaults (testnet); links are explicit
              testnet so they resolve regardless of the app's network. */}
          {(ind.pkg || ind.vaultAddr) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-[#8a8a8a]">
              <span className="text-[#8a8a8a]">On-chain:</span>
              {ind.pkg && (
                <a className="text-[#a1a1a1] hover:text-emerald-400 transition-colors"
                   href={`https://explorer.aptoslabs.com/account/${ind.pkg}?network=${getClientNetwork()}`}
                   target="_blank" rel="noreferrer">strategy module ↗</a>
              )}
              <a className="text-[#a1a1a1] hover:text-emerald-400 transition-colors"
                 href={`https://explorer.aptoslabs.com/account/${ind.address}?network=${getClientNetwork()}`}
                 target="_blank" rel="noreferrer">indicator ↗</a>
              {ind.vaultAddr && (
                <a className="text-[#a1a1a1] hover:text-emerald-400 transition-colors"
                   href={`https://explorer.aptoslabs.com/account/${ind.vaultAddr}?network=${getClientNetwork()}`}
                   target="_blank" rel="noreferrer">Decibel vault ↗</a>
              )}
            </div>
          )}
        </div>

        {/* Inline signal — no border box */}
        {sig !== 0 && (
          <div className={cn(
            "flex shrink-0 flex-col items-end gap-0.5 transition-opacity duration-150",
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
                    <span className={cn("text-base font-bold font-mono tracking-wide", stale ? "text-[#a1a1a1]" : SIG_TEXT[sig])}>
                      {stale ? `LAST ${SIG_LABEL[sig]}` : SIG_LABEL[sig]}
                    </span>
                  </div>
                  {live.isLive && live.price > 0 && (
                    <span className={cn("text-[11px] font-mono tabular-nums", stale ? "text-amber-500/80" : "text-[#8a8a8a]")}>
                      ${live.price > 1000
                        ? live.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : live.price.toFixed(4)}
                      {stale && ` · ${timeAgo(live.dataTime * 1000)}`}
                    </span>
                  )}
                  {!live.isLive && ind.lastSignalTime > 0 && (
                    <span className="text-[11px] text-[#8a8a8a]">{timeAgo(ind.lastSignalTime)}</span>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Key stats — floating, no cards ── */}
      {/* 2x2 below sm — four columns at 390px collapse into each other
          (labels crossing dividers, values overflowing cells). */}
      {ind.totalSims > 0 && (
        <div className="grid grid-cols-2 border-y border-card-border sm:grid-cols-4 sm:divide-x sm:divide-card-border">
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

      {/* Chart sits BELOW the stats. Above them it filled the visible pane on
          load, so the numbers a depositor actually judges a strategy by — win
          rate, Sharpe, drawdown — were pushed off-screen on every viewport. */}
      <div className="w-full">
        <OnChainChart
          indicatorAddr={ind.address}
          packageAddress={ind.pkg}
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

      {/* The production bonding curve is intentionally unavailable until its
          package and vault handoff are deployed and verifiable. */}
      {!ind.isGraduated && (
        <div className="px-6 py-5 border-b border-card-border">
          <div className="flex items-center gap-1.5 mb-2 text-[11px] font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-amber-400">TESTNET INDICATOR</span>
          </div>
          <p className="text-[12px] text-[#a1a1a1] leading-relaxed">
            Bonding-curve funding and automatic vault graduation are not deployed. This page will not request APT for either action.
          </p>
        </div>
      )}

      <BacktestBar ind={ind} showBacktest={showBacktest} setShowBacktest={setShowBacktest} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LaunchpadPage() {
  const [tab,        setTab]        = useState<Tab>("explore");
  const [deployStage, setDeployStage] = useState<DeployStage>("build");
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [selected,   setSelected]   = useState<Indicator | null>(null);
  const detailPanelRef = useRef<HTMLDivElement>(null);

  // Below lg the detail panel stacks under the full 16-row list (~1700px
  // down) — without this scroll, tapping a strategy appears to do nothing.
  // Only for a deliberate PICK though: the first strategy is auto-selected on
  // load, and scrolling for that would drop phone users past the list they
  // came to browse.
  const userPickedRef = useRef(false);
  const selectedAddress = selected?.address ?? null;
  useEffect(() => {
    if (!selectedAddress || !detailPanelRef.current) return;
    if (!userPickedRef.current) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    detailPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedAddress]);
  const [loading,    setLoading]    = useState(true);
  const [loadKey,    setLoadKey]    = useState(0);
  const [sort,       setSort]       = useState<Sort>("robustness");
  const [filter,     setFilter]     = useState<Filter>("all");
  const [showSignals, setShowSignals] = useState(false);
  const [showGraduated, setShowGraduated] = useState(false);
  const [meta,       setMeta]       = useState({ total: 0, graduated: 0, totalRaisedApt: 0 });
  const { account } = useWallet();

  const fetchIndicators = useCallback(async (force = false): Promise<Indicator[]> => {
    try {
      const params = new URLSearchParams({ sort });
      if (filter === "live")    params.set("graduated", "true");
      if (filter === "testing") params.set("graduated", "false");
      if (showGraduated)        params.set("graduated", "true");
      if (force)                params.set("refresh", "true");
      const res  = await fetch(`/api/launchpad/indicators?${params}`);
      if (!res.ok) return [];
      const data = await res.json();
      const all: Indicator[] = data.indicators || [];
      const visible = showSignals ? all.filter((i) => i.lastSignal !== 0) : all;
      setIndicators(visible);
      setMeta({ total: data.total, graduated: data.graduated, totalRaisedApt: data.totalRaisedApt });
      return visible;
    } catch {
      return [];
    }
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

  // Keep selected indicator fresh when registry updates, and open on the first
  // strategy rather than a tutorial: the detail panel is the widest region on
  // the page, so leaving it on an explainer spends the best real estate on
  // something a returning user has already read. On mobile the detail panel
  // stacks BELOW the list, so auto-selecting costs nothing there.
  useEffect(() => {
    if (!indicators.length) return;
    if (!selected) { setSelected(indicators[0]); return; }
    const fresh = indicators.find((i) => i.address === selected.address);
    if (fresh) setSelected(fresh);
  }, [indicators]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a deploy completes, jump to Explore and select the new strategy.
  function handleDeployed(addr: string) {
    setTab("explore");
    fetchIndicators();
    setTimeout(() => {
      setIndicators((prev) => {
        const found = prev.find((i) => i.address === addr);
        // Deploying IS a deliberate pick — scrolling to the new strategy is
        // exactly what the creator wants to see next.
        if (found) { userPickedRef.current = true; setSelected(found); }
        return prev;
      });
    }, 500);
  }

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <Header constrained />
      <div className="relative" style={{ overflow: "clip" }}>
        <AmbientBlobs variant="launchpad" />
        <main className="relative z-10 mx-auto w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-7 lg:px-8">

          {/* ── Hero — title + subtitle stack keeps the counter from crowding
               the CTA on narrow screens and reads more editorial on wide ── */}
          <div className="mb-5 animate-enter flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display font-bold text-[22px] sm:text-[26px] leading-none tracking-tight text-white">
                Strategy Marketplace
              </h1>
              {!loading && (
                <span className="mt-2 block text-[11px] font-mono tabular-nums text-[#8a8a8a]">
                  {/* Accent means "good" — painting a zero with it dresses a
                      failure state as a win, so only a non-zero count earns it.
                      And "· 0 live" next to a number is read as a dead product;
                      state the true position instead ("18 in testing") until
                      something has actually graduated. */}
                  {meta.graduated > 0 ? (
                    <>
                      {meta.total} strategies · <span className="text-accent">{meta.graduated} live</span>
                    </>
                  ) : (
                    <>{meta.total} strategies in testing</>
                  )}
                </span>
              )}
            </div>
            {tab !== "deploy" && (
              <button
                onClick={() => setTab("deploy")}
                className="group shrink-0 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 text-[13px] font-display font-semibold text-black shadow-[0_2px_14px_-2px_rgba(57,255,20,0.35)] transition-all duration-200 hover:shadow-[0_4px_20px_-2px_rgba(57,255,20,0.5)] hover:brightness-[1.03] active:scale-[0.97] sm:px-4"
              >
                <span className="text-[15px] leading-none opacity-80 transition-opacity group-hover:opacity-100">+</span>
                <span className="hidden sm:inline">Deploy Strategy</span>
                <span className="sm:hidden">Deploy</span>
              </button>
            )}
          </div>

          {/* ── Tab bar — refined underline: rounded-[var(--radius-xs)], inset, brand-tinted glow on
               active, a fade-in hint on hover, and comfortable touch targets ── */}
          <div className="relative flex items-center gap-0.5 sm:gap-1 border-b border-card-border mb-6 animate-enter-delay-1">
            {(["explore", "bots", "creator"] as Tab[]).map((t) => {
              // Deploy lives under Explore now, so the workbench keeps Explore lit.
              const active = tab === t || (t === "explore" && tab === "deploy");
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // first:-ml-3.5 pulls "Explore" back onto the page gutter so the
                    // tab, its underline and the H1 all share one left axis.
                    "group relative -mb-px px-3.5 py-3 text-[13px] font-display font-semibold transition-colors duration-200 first:-ml-3.5 sm:px-4 sm:first:-ml-4",
                    active ? "text-white" : "text-[#8a8a8a] hover:text-zinc-200",
                  )}
                >
                  {t === "explore" ? "Explore" : t === "bots" ? "My Bots" : "Creator"}
                  <span
                    className={cn(
                      // Selected == accent, everywhere. A white bar emitting green
                      // light read as haze rather than intent.
                      "pointer-events-none absolute inset-x-2.5 -bottom-px h-[2px] rounded-full transition-all duration-300 ease-out sm:inset-x-3",
                      active
                        ? "bg-accent opacity-100"
                        : "bg-white/50 opacity-0 group-hover:opacity-40",
                    )}
                  />
                </button>
              );
            })}
          </div>

          {/* ── Deploy — Whop's original workbench: paste Pine → transpile → deploy ── */}
          {tab === "deploy" && (
            <div className="animate-enter-delay-1">
              <div className="w-full overflow-hidden rounded-[var(--radius)] border border-card-border shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)]">
                <header className="flex items-center justify-between border-b border-card-border bg-gradient-to-b from-[#232323] to-[#1c1c1c] px-5 py-4 font-mono text-sm font-semibold tabular-nums text-zinc-300 sm:px-8 sm:py-5">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(57,255,20,0.6)]" />
                    Deploy a Strategy
                  </span>
                  <button
                    onClick={() => setTab("explore")}
                    className="group flex items-center gap-1 text-[11px] font-mono font-medium text-[#a1a1a1] transition-colors hover:text-white"
                  >
                    <span className="transition-transform group-hover:-translate-x-0.5">←</span>
                    Back to marketplace
                  </button>
                </header>
                {/* Two genuinely different stages, both of which are "deploy a
                    strategy": author/transpile Pine into a Move module, or take
                    a strategy live as a sealed Decibel vault (where the source
                    visibility, who-runs-it and launch-fee choices live). The
                    launch flow was reachable from this tab before the workbench
                    replaced it, and both need to be. */}
                <div className="border-b border-card-border bg-[#161616] px-4 py-3">
                  <div className="flex w-full max-w-md gap-0.5 rounded-[var(--radius-sm)] border border-white/[0.06] bg-[#0f0f0f] p-0.5">
                    {([
                      ["build", "Build from Pine"],
                      ["launch", "Launch a vault"],
                    ] as Array<[DeployStage, string]>).map(([s, label]) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDeployStage(s)}
                        aria-pressed={deployStage === s}
                        className={cn(
                          "flex-1 rounded-[calc(var(--radius-sm)-2px)] min-h-[36px] lg:min-h-[28px] font-display text-[12px] font-medium",
                          PRODUCT_PRESSABLE_CLASS,
                          deployStage === s ? "bg-accent/12 text-accent" : "text-[#9a9a9a] hover:text-zinc-200",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-[#111] px-2 py-3 sm:px-4">
                  {deployStage === "build" ? (
                    <DeployForm onDeployed={handleDeployed} />
                  ) : (
                    <SealedLaunch onLaunched={() => { setTab("explore"); fetchIndicators(); }} />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Explore: restore Whop's strategy list/detail split as the primary view. ── */}
          {tab === "explore" && (
            <div>
              <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">

                {/* Left: list panel — relative wrapper so the panel doesn't inflate the grid row height */}
                <div className="relative min-h-[480px]">
                  <div className="lg:absolute lg:inset-0 w-full overflow-hidden rounded-[var(--radius)] border border-card-border shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)] flex flex-col">
                    {/* Filters header — hidden on phones, where it only repeats the
                        H1 ("Strategy Marketplace") and costs a whole band of the
                        first screen. On desktop it labels the column. */}
                    <header className="hidden shrink-0 border-b border-white/[0.06] bg-[#161616] lg:flex items-center px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.15em] text-[#9a9a9a]">
                      Strategies
                    </header>

                    {/* Filter controls */}
                    <div className="shrink-0 px-4 py-3 border-b border-white/[0.06] bg-[#161616] space-y-2">
                      <div className="flex gap-0.5 bg-[#0f0f0f] border border-white/[0.06] rounded-[var(--radius-sm)] p-0.5">
                        {(["all", "live", "testing"] as Array<"all" | "live" | "testing">).map((f) => (
                          <button type="button" key={f} onClick={() => setFilter(f)}
                            aria-pressed={filter === f}
                            className={cn(
                              // Concentric with its track: 10px outer − 2px p-0.5 = 8px.
                              // 36px tall on touch, compact on desktop.
                              "flex-1 rounded-[calc(var(--radius-sm)-2px)] min-h-[36px] lg:min-h-[26px] font-display text-[11px] font-medium",
                              PRODUCT_PRESSABLE_CLASS,
                              filter === f ? "bg-accent/12 text-accent" : "text-[#9a9a9a] hover:text-zinc-200",
                            )}>
                            {f === "all" ? "All" : f === "live" ? "Live" : "Testing"}
                          </button>
                        ))}
                      </div>
                      {/* Toggles + sort share one row on phones (they are all
                          "narrow the list" controls) and stack on desktop where
                          the column is only 300px wide. */}
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShowSignals((v) => !v)}
                          aria-pressed={showSignals}
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 min-h-[36px] lg:min-h-[24px] font-display text-[11px] font-medium",
                            PRODUCT_PRESSABLE_CLASS,
                            showSignals
                              ? "border-accent/16 bg-accent/12 text-accent"
                              : "border-[#2a2a2a] text-[#9a9a9a] hover:text-zinc-200",
                          )}>
                          Live signals
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowGraduated((v) => !v)}
                          aria-pressed={showGraduated}
                          className={cn(
                            "inline-flex items-center rounded-full border px-3 min-h-[36px] lg:min-h-[24px] font-display text-[11px] font-medium",
                            PRODUCT_PRESSABLE_CLASS,
                            showGraduated
                              ? "border-accent/16 bg-accent/12 text-accent"
                              : "border-[#2a2a2a] text-[#9a9a9a] hover:text-zinc-200",
                          )}>
                          Graduated
                        </button>

                        {/* Sort joins the same rail on phones — it is the same
                            "narrow the list" job, and a dedicated row cost a
                            whole band of the first screen. It breaks onto its
                            own line again on desktop, where the column is 300px. */}
                        {/* Label + its options are ONE flex item, so the rail can
                            only wrap between groups. Loose in the rail, "Sort:"
                            could end a line with its own options on the next,
                            reading as a heading for the toggles above it. The
                            label also has to stay visible: without it these are
                            pixel-identical to the toggles beside them, and three
                            radios look like two more independent switches. */}
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="shrink-0 pl-1 text-[11px] text-[#9a9a9a]">Sort:</span>
                          {(["robustness", "sharpe", "raised"] as Sort[]).map((s) => (
                            <button type="button" key={s} onClick={() => setSort(s)}
                              aria-pressed={sort === s}
                              className={cn(
                                "rounded-full border px-3 min-h-[36px] lg:min-h-[24px] lg:rounded-[var(--radius-xs)] text-center font-display text-[11px] font-medium",
                                PRODUCT_PRESSABLE_CLASS,
                                sort === s
                                  ? "border-accent/16 bg-accent/12 text-accent"
                                  : "border-card-border text-[#9a9a9a] hover:text-zinc-200",
                              )}>
                              {s === "robustness" ? "Score" : s === "sharpe" ? "Sharpe" : "Raised"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Indicator list */}
                    <div key={loadKey} className="bg-[#0f0f0f] scroll-slim overflow-y-auto flex-1 min-h-0 p-1.5 space-y-0.5">
                      {loading ? (
                        <>
                          {[...Array(5)].map((_, i) => (
                            // Skeletons must occupy the same box as the rows they stand in for,
                            // or the list visibly reflows when data lands.
                            <div key={i} className="h-14 animate-pulse rounded-[calc(var(--radius)-7px)] bg-[#181818] motion-reduce:animate-none" />
                          ))}
                        </>
                      ) : indicators.length === 0 ? (
                        <div className="text-center py-8 px-4">
                          <p className="text-xs text-[#888]">No strategies found</p>
                          <button type="button" onClick={() => setTab("deploy")}
                            className={cn("mt-3 rounded-[var(--radius-xs)] text-xs text-[#a1a1a1] underline hover:text-white", PRODUCT_PRESSABLE_CLASS)}>
                            Deploy the first one →
                          </button>
                        </div>
                      ) : (
                        indicators.map((ind, i) => (
                          <IndicatorItem
                            key={ind.address}
                            ind={ind}
                            rank={i + 1}
                            sort={sort}
                            selected={selected?.address === ind.address}
                            onClick={() => { userPickedRef.current = true; setSelected(ind); }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: detail panel */}
                <div ref={detailPanelRef} className="w-full scroll-mt-16 overflow-hidden rounded-[var(--radius)] border border-card-border shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)]">
                  <div className="bg-[#111] min-h-[480px]">
                    {selected ? (
                      <IndicatorDetail
                        key={selected.address}
                        ind={selected}
                        onDeployOwn={() => setTab("deploy")}
                      />
                    ) : (
                      <EmptyState onDeploy={() => setTab("deploy")} />
                    )}
                  </div>
                </div>

              </div>

              {/* Sealed vaults did not exist in the original Whop build. Keep them as a
                  secondary marketplace section instead of letting them replace the proven
                  strategy-list/detail flow above. */}
              <section className="mt-8 border-t border-card-border pt-6">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-1">
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                      On-chain vaults
                    </p>
                    <h2 className="mt-1 font-display text-[18px] font-semibold text-foreground">
                      Invest in live strategies
                    </h2>
                  </div>
                  <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                    Review the rules enforced by each sealed strategy, inspect its recorded
                    trades, and deposit directly into its Decibel vault.
                  </p>
                </div>
                <SealedVaultFeed />
              </section>
            </div>
          )}

          {/* ── My Bots: operational controls for vaults this wallet launched ── */}
          {tab === "bots" && (
            <div className="animate-enter-delay-1">
              <SealedSwap creatorAddr={account?.address?.toString()} />
            </div>
          )}

          {/* ── Creator: publishing history and earnings stay separate from bot controls. ── */}
          {tab === "creator" && (
            <div className="animate-enter-delay-1">
              <CreatorDashboard creatorAddr={account?.address?.toString()} />
            </div>
          )}

        </main>
      </div>

    </div>
  );
}
