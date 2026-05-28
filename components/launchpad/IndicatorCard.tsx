"use client";

import { useState, useEffect, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { cn } from "@/lib/utils";
import type { IndicatorEntry } from "@/app/api/launchpad/indicators/route";

// Deployed to Aptos testnet — tx: 0x2e32e1aaf849126cfe39483c8502e9ec9d023b4e3545cb5e2c6c7c10cd5f7d21
const LAUNCHPAD_CONTRACT = "0x33b2487e54af56e709eb65c5bdd597a64df509c0ec01f94cc79f4d9d6adea3ee";

interface IndicatorCardProps {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  assets: string[];
  totalRaised: number;
  isGraduated: boolean;
  totalSims: number;
  meanSharpe: number;    // scaled 1000x
  profitablePct: number;
  robustnessScore: number;
  maxDrawdownBps: number;
  indicatorType?: number;
  lastSignal?: "BUY" | "SELL" | "NEUTRAL";
  lastSignalTime?: number;
  selected?: boolean;
  onClick?: () => void;
  onFunded?: (updated: Record<string, unknown>) => void;
  isProprietary?: boolean;
  algoHash?: string;
  commitTs?: number;
  creatorFeeBps?: number;
  creatorFeeModel?: 'none' | 'flat' | 'profit_share';
  isSubscribed?: boolean;
  onDeployBot?: () => void;
  onUnlock?: () => void;
}

// ─── Live signal hook (SSE) ───────────────────────────────────────────────────

interface LiveSignalState {
  signal: number;
  price: number;
  fastLine: number;
  slowLine: number;
  isLive: boolean;
  lastUpdate: number;
}

function useLiveSignal(addr: string): LiveSignalState {
  const [state, setState] = useState<LiveSignalState>({
    signal: 0, price: 0, fastLine: 0, slowLine: 0, isLive: false, lastUpdate: 0,
  });

  useEffect(() => {
    if (!addr) return;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource(`/api/launchpad/signals?indicator=${addr}&stream=true`);
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setState({
            signal: d.signal ?? 0,
            price: d.price ?? 0,
            fastLine: d.fastLine ?? 0,
            slowLine: d.slowLine ?? 0,
            isLive: true,
            lastUpdate: Date.now(),
          });
        } catch {
          // ignore parse errors
        }
      };
      es.onerror = () => {
        es?.close();
        retryTimer = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [addr]);

  return state;
}

// ─── Flash hook — fires when signal value changes ─────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// ─── IndicatorCard ─────────────────────────────────────────────────────────────

export function IndicatorCard(props: IndicatorCardProps) {
  const {
    address, name, symbol, creator, assets, totalRaised, isGraduated,
    totalSims, meanSharpe, profitablePct,
    maxDrawdownBps, lastSignal, lastSignalTime,
    selected, onClick, onFunded,
    isProprietary,
    isSubscribed, onDeployBot, onUnlock,
  } = props;

  const { signAndSubmitTransaction, connected } = useWallet();
  const [funding, setFunding] = useState(false);
  const [justGraduated, setJustGraduated] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // ─── Holographic parallax state ───────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [shine, setShine] = useState<{ x: number; y: number } | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Live signal from SSE
  const live = useLiveSignal(address);
  const flashing = useFlash(live.signal);

  const sharpe = meanSharpe / 1000;
  const sharpeColor = sharpe >= 2 ? "text-green-400" : sharpe >= 1.5 ? "text-yellow-400" : sharpe >= 1 ? "text-zinc-300" : "text-zinc-500";

  // Prefer live signal from SSE; fall back to prop
  const sigNum = live.isLive ? live.signal : (lastSignal === "BUY" ? 1 : lastSignal === "SELL" ? 2 : 0);
  const sigLabel = sigNum === 1 ? "BUY" : sigNum === 2 ? "SELL" : "NEUTRAL";
  const signalColor = sigNum === 1 ? "text-green-400" : sigNum === 2 ? "text-red-400" : "text-zinc-500";
  const signalDot = sigNum === 1 ? "bg-green-400" : sigNum === 2 ? "bg-red-400" : "bg-zinc-600";

  // Curve progress toward 600 APT graduation
  const raisedApt = totalRaised / 1e8;
  const progressPct = Math.min(100, (raisedApt / 600) * 100);

  // ─── Parallax handlers ────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const { width, height } = rect;
    const tiltX = (mouseY / height - 0.5) * -12;
    const tiltY = (mouseX / width - 0.5) * 12;
    setTilt({ x: tiltX, y: tiltY });
    setShine({ x: (mouseX / width) * 100, y: (mouseY / height) * 100 });
  }

  function handleMouseEnter() {
    setIsHovered(true);
  }

  function handleMouseLeave() {
    setIsHovered(false);
    setTilt({ x: 0, y: 0 });
    setShine(null);
  }

  // ─── Dynamic card style ───────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    willChange: "transform",
    transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale3d(${isHovered ? "1.01,1.01,1.01" : "1,1,1"})`,
    transition: isHovered ? "filter 0.5s ease" : "transform 0.5s ease, filter 0.5s ease",
  };

  async function updateRegistry(aptAmount: number) {
    const res = await fetch("/api/launchpad/indicators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, aptAmount }),
    });
    const data = await res.json();
    if (data.graduated) setJustGraduated(true);
    if (data.indicator && onFunded) onFunded(data.indicator);
  }

  async function fund(aptAmount: number, e: React.MouseEvent) {
    e.stopPropagation();
    setFunding(true);
    setTxError(null);

    try {
      if (connected) {
        const aptOctas = (BigInt(aptAmount) * BigInt(100_000_000)).toString();
        const minFaOut = "0";
        await signAndSubmitTransaction({
          data: {
            function: `${LAUNCHPAD_CONTRACT}::bonding_curve::buy`,
            typeArguments: [],
            functionArguments: [address, aptOctas, minFaOut],
          },
        });
        await updateRegistry(aptAmount);
      } else {
        await updateRegistry(aptAmount);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("cancel") && !msg.toLowerCase().includes("reject")) {
        setTxError("Transaction failed");
      }
    } finally {
      setFunding(false);
    }
  }

  if (justGraduated) {
    return (
      <div className={cn(
        "relative rounded-xl border border-green-500/50 bg-green-500/10 p-4 cursor-pointer transition-all",
        selected && "ring-1 ring-green-400/30",
      )} onClick={onClick}>
        <div className="text-center py-4">
          <p className="text-sm font-semibold text-green-400">{name} Graduated!</p>
          <p className="text-[11px] text-green-500/70 mt-1">Now live in Decibel vault</p>
        </div>
      </div>
    );
  }

  // Determine CTA
  const showUnlock = isProprietary && !isSubscribed;
  const ctaLabel = showUnlock ? "Unlock · $29/mo" : "Deploy Bot";
  const ctaClass = showUnlock
    ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
    : "border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20";
  const ctaAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showUnlock) {
      onUnlock?.();
    } else {
      onDeployBot?.();
    }
  };

  // Signal bloom class — replaces old ring-based flash logic
  const bloomClass = flashing
    ? sigNum === 1
      ? "signal-bloom-buy"
      : sigNum === 2
        ? "signal-bloom-sell"
        : ""
    : "";

  // Signal dot glow style when flashing
  const dotGlowStyle: React.CSSProperties | undefined = flashing
    ? { filter: `drop-shadow(0 0 6px ${sigNum === 1 ? "#4ade80" : sigNum === 2 ? "#f87171" : "currentColor"})` }
    : undefined;

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={cardStyle}
      className={cn(
        "relative rounded-xl border bg-zinc-900/80 p-4 cursor-pointer overflow-hidden",
        bloomClass,
        selected
          ? "border-white/30 bg-zinc-800/80 ring-1 ring-white/10"
          : isGraduated
            ? "border-green-800/40 hover:border-green-700/60"
            : "border-zinc-800 hover:border-zinc-700",
      )}
    >
      {/* Holographic shine overlay */}
      {shine && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10,
            background: `radial-gradient(circle at ${shine.x}% ${shine.y}%, rgba(255,255,255,0.07) 0%, transparent 65%)`,
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{name}</h3>
            {isProprietary && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
                </svg>
                PROPRIETARY
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            <span className="font-mono">${symbol}</span>
            <span className="mx-1 text-zinc-700">·</span>
            {assets.join(", ")}
          </p>
        </div>
        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full ml-2 shrink-0",
          isGraduated
            ? "bg-green-500/15 text-green-400 border border-green-500/25"
            : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25")}>
          {isGraduated ? "LIVE" : "TESTING"}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-x-3 text-xs mb-3">
        <div>
          <p className="text-zinc-600 text-[10px]">Sharpe</p>
          <p className={cn("font-mono font-semibold tabular-nums", sharpeColor)}>
            {totalSims > 0 ? sharpe.toFixed(2) : "—"}
          </p>
        </div>
        <div>
          <p className="text-zinc-600 text-[10px]">Win Rate</p>
          <p className="font-mono font-semibold text-white tabular-nums">
            {totalSims > 0 ? `${profitablePct}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-zinc-600 text-[10px]">Max DD</p>
          <p className="font-mono font-semibold text-red-400 tabular-nums">
            {totalSims > 0 ? `-${(maxDrawdownBps / 100).toFixed(1)}%` : "—"}
          </p>
        </div>
      </div>

      {/* Bonding curve progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="text-zinc-600">
            {isGraduated ? "Graduated · " : ""}{raisedApt.toFixed(0)} APT raised
          </span>
          <span className="text-zinc-600 font-mono">{totalSims.toLocaleString()} sims</span>
        </div>
        <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-500",
              isGraduated ? "bg-green-500" : "bg-gradient-to-r from-yellow-500 to-yellow-400")}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {txError && (
        <p className="text-[10px] text-red-400 mb-2">{txError}</p>
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between border-t border-zinc-800 pt-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: creator addr + wallet dot, or fund buttons */}
        {!isGraduated ? (
          <div className="flex items-center gap-1">
            {connected && <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-0.5" title="Wallet connected" />}
            <span className="text-zinc-700 text-[10px] mr-0.5">Fund:</span>
            {[1, 5, 10].map((amt) => (
              <button key={amt} onClick={(e) => fund(amt, e)} disabled={funding}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors",
                  funding
                    ? "bg-zinc-800 text-zinc-600 cursor-wait"
                    : connected
                      ? "bg-zinc-800 text-green-400 hover:bg-green-500/20 hover:text-green-300"
                      : "bg-zinc-800 text-yellow-400 hover:bg-yellow-500/20 hover:text-yellow-300",
                )}>
                {funding ? "…" : `+${amt}`}
              </button>
            ))}
            <span className="text-zinc-700 text-[10px] ml-0.5">APT</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {sigNum !== 0 && (
              <>
                <span
                  className={cn("w-1.5 h-1.5 rounded-full animate-pulse", signalDot)}
                  style={dotGlowStyle}
                />
                <span className={cn("text-[10px] font-semibold", signalColor)}>{sigLabel}</span>
              </>
            )}
            <span className="text-[10px] text-zinc-600 font-mono">{shortAddr(creator)}</span>
          </div>
        )}

        {/* CTA button */}
        <button
          onClick={ctaAction}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-semibold rounded-lg border transition-colors shrink-0",
            ctaClass,
          )}
        >
          {!showUnlock && (
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          )}
          {showUnlock && (
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a4 4 0 0 0-4 4v1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 5V5a2 2 0 1 1 4 0v1H6z"/>
            </svg>
          )}
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
