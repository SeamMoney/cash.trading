"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Header } from "@/components/layout/Header";
import { BTCChart } from "@/components/trade/BTCChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { Positions as DecibelPositions } from "@/components/trade/Positions";
import { TradePanel } from "@/components/trade/TradePanel";
import { VaultActionModal } from "@/components/trade/VaultActionModal";
import type { VaultActionMode } from "@/components/trade/VaultActionTypes";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { dispatchPortfolioActivity, dispatchBalanceUpdate } from "@/lib/portfolio-events";
import { cn } from "@/lib/utils";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import { useSubscription } from "@/lib/launchpad/use-subscription";
import { ScheduleTradeModal } from "@/components/launchpad/ScheduleTradeModal";
import type { IndicatorEntry } from "@/app/api/launchpad/indicators/route";
import {
  getEstimatedLiquidationPrice,
  getPositionPnl,
  isPositionLiquidated,
} from "@/lib/trade-utils";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { curveLinear } from "@visx/curve";
import { Grid } from "@/components/charts/grid";
import { useIsMobile } from "@/components/ui/use-mobile";
import { useInViewport } from "@/hooks/useInViewport";

interface Position {
  id: string;
  market: string;
  side: "long" | "short";
  collateral: number;
  leverage: number;
  entryPrice: number;
  liquidationPrice: number;
  timestamp: number;
}

interface DecibelVault {
  address: string;
  name: string;
  manager: string;
  status: string;
  created_at: number;
  tvl: number | null;
  volume: number | null;
  volume_30d: number | null;
  all_time_pnl: number | null;
  net_deposits: number | null;
  all_time_return: number | null;
  apr: number | null;
  sharpe_ratio: number | null;
  max_drawdown: number | null;
  weekly_win_rate_12w: number | null;
  profit_share: number | null;
  depositors: number | null;
  perp_equity: number | null;
  vault_type: "user" | "protocol" | null;
  description: string | null;
  average_leverage: number | null;
  manager_cash_pct: number | null;
}

const VAULT_COLORS = ["#22c55e", "#3b82f6", "#eab308", "#ec4899", "#ef4444", "#a855f7", "#f97316", "#06b6d4", "#84cc16", "#6366f1"];
const PORTFOLIO_SHEET_PEEK = 74;
const PRICE_UI_COMMIT_MS = 250;

// Display overrides for vault cards shown beside Decibel protocol vaults.
// Decibel Protocol Vault uses 100% real API data — no override needed
const GUILD_OVERRIDES: Record<string, {
  displayName: string;
  volume: number; pnl: number; traders: number; openInterest: number;
  sharpe?: number; maxDrawdown?: number; profitShare?: number;
  leader?: { name: string; avatar: string };
}> = {
  "Team Resonance":  { displayName: "Kaizen", volume: 33_567_859, pnl: 4.71,  traders: 20_000, openInterest: 935_122,  sharpe: 1.82, maxDrawdown: -3.1, profitShare: 10, leader: { name: "Brian Jung", avatar: "https://unavatar.io/x/thebrianjung" } },
  "iLiquid":         { displayName: "The Whale Room", volume: 28_303_675, pnl: 3.84,  traders: 8_200, openInterest: 231_103,  sharpe: 1.45, maxDrawdown: -4.2, profitShare: 5, leader: { name: "Kyledoops", avatar: "https://unavatar.io/x/kyledoops" } },
  "Phase Zero":      { displayName: "Options Insider", volume: 34_957_869, pnl: 2.17,  traders: 14_892, openInterest: 222_173,  sharpe: 1.23, maxDrawdown: -3.8, profitShare: 2, leader: { name: "DesiTrade", avatar: "https://unavatar.io/x/Desi_Trade" } },
  "Echo Dynasty":    { displayName: "Scarface Trades", volume: 10_299_974, pnl: 1.93,  traders: 4_561, openInterest: 416_549,  sharpe: 1.07, maxDrawdown: -2.9, profitShare: 5, leader: { name: "Tony", avatar: "https://unavatar.io/x/ScarfaceTrades_" } },
  "Signal9":         { displayName: "EmmanuelTrades", volume: 10_904_768, pnl: 1.52,  traders: 63_900, openInterest: 149_051,  sharpe: 0.94, maxDrawdown: -5.1, profitShare: 2, leader: { name: "Emmanuel", avatar: "https://unavatar.io/x/Emmanueltrades" } },
  "Crypto Vikings":  { displayName: "American Dream", volume: 1_042_842,  pnl: 0.87,  traders: 3_200, openInterest: 78_200,   sharpe: 0.61, maxDrawdown: -6.8, profitShare: 10, leader: { name: "Chad Christian", avatar: "https://unavatar.io/x/ADTCoach" } },
};

function formatUsd(n: number | null): string {
  if (n == null) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  return `$${n.toFixed(0)}`;
}

function shortenAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface PnlPoint { date: Date; pnl: number }

/**
 * Build a PnL % curve from vault metrics.
 * Uses seeded PRNG so the chart is stable across re-renders.
 * Same smooth random walk for all vaults (including DLP protocol vault).
 */
function buildPnlCurve(vault: DecibelVault): PnlPoint[] {
  const now = Date.now();
  const created = vault.created_at ?? now - 30 * 24 * 3600_000;
  const age = Math.max(now - created, 3600_000);
  const span = Math.min(age, 90 * 24 * 3600_000);

  const endPnl = vault.all_time_return ?? 0;

  // Seeded PRNG from vault address
  let seed = 0;
  for (let i = 0; i < vault.address.length; i++) seed = (seed * 31 + vault.address.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const M = 180;
  const mStep = span / M;
  const guild = GUILD_OVERRIDES[vault.name];
  const maxDD = Math.abs(guild?.maxDrawdown ?? vault.max_drawdown ?? 5);
  const sharpe = guild?.sharpe ?? vault.sharpe_ratio ?? 0;
  const vol = sharpe !== 0 ? Math.min(2, Math.max(0.2, maxDD / 3)) : maxDD / 2.5;

  const points: PnlPoint[] = [];
  let pnl = 0;
  const drift = endPnl / M;

  for (let i = 0; i <= M; i++) {
    const t = now - span + i * mStep;
    points.push({ date: new Date(t), pnl: +pnl.toFixed(2) });
    const noise = (rng() - 0.5) * 2 * vol;
    const expected = endPnl * (i / M);
    const revert = (expected - pnl) * 0.12;
    pnl += drift + noise + revert;
  }

  points[points.length - 1] = { date: new Date(now), pnl: +endPnl.toFixed(2) };
  return points;
}

function useDecibelVaults(enabled = true) {
  const [vaults, setVaults] = useState<DecibelVault[]>([]);
  const [loading, setLoading] = useState(true);
  const chartDataRef = useRef<Record<string, PnlPoint[]>>({});

  const fetchVaults = useCallback(async () => {
    try {
      const res = await fetch("/api/decibel/vaults");
      if (!res.ok) return;
      const data = await res.json();
      const fetched: DecibelVault[] = data.vaults ?? [];
      setVaults(fetched);
      setLoading(false);

      for (const v of fetched) {
        // Use guild PnL override if available
        const guild = GUILD_OVERRIDES[v.name];
        const effectivePnl = guild?.pnl ?? v.all_time_return ?? 0;
        if (!chartDataRef.current[v.address]) {
          const vaultWithPnl = { ...v, all_time_return: effectivePnl };
          chartDataRef.current[v.address] = buildPnlCurve(vaultWithPnl);
        } else {
          const curve = chartDataRef.current[v.address];
          curve[curve.length - 1] = { date: new Date(), pnl: effectivePnl };
        }
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchVaults();
    const interval = setInterval(fetchVaults, 30_000);
    return () => clearInterval(interval);
  }, [enabled, fetchVaults]);

  return { vaults, loading, chartData: chartDataRef.current };
}

function VaultsPanel({ enabled = true }: { enabled?: boolean }) {
  const { vaults, loading, chartData } = useDecibelVaults(enabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Show vaults with overrides or real data; protocol vault first, then by PnL desc
  const displayVaults = vaults
    .filter((v) => v.vault_type === "protocol" || GUILD_OVERRIDES[v.name])
    .sort((a, b) => {
      if (a.vault_type === "protocol") return -1;
      if (b.vault_type === "protocol") return 1;
      const pnlA = GUILD_OVERRIDES[a.name]?.pnl ?? a.all_time_return ?? 0;
      const pnlB = GUILD_OVERRIDES[b.name]?.pnl ?? b.all_time_return ?? 0;
      return pnlB - pnlA;
    });

  const scrollTo = useCallback((idx: number) => {
    const el = scrollRef.current;
    if (!el || displayVaults.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, displayVaults.length - 1));
    const cardW = el.scrollWidth / displayVaults.length;
    el.scrollTo({ left: cardW * clamped, behavior: "smooth" });
  }, [displayVaults.length]);

  // Track active card via scroll position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.scrollWidth / Math.max(displayVaults.length, 1);
      const idx = Math.round(el.scrollLeft / w);
      setActiveIndex(Math.min(idx, displayVaults.length - 1));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [displayVaults.length]);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
        <header className="border-b border-[#2a2a2a] text-[#888] bg-[#202020] flex items-center px-5 py-4 sm:px-8 sm:py-5 font-mono text-sm font-semibold tabular-nums">
          <span className="flex items-center gap-2">
            <span className="relative h-2 w-2 shrink-0 rounded-full bg-green-500">
              <span className="absolute inset-0 animate-ping rounded-full bg-green-500 opacity-75" />
            </span>
            <span>DECIBEL VAULTS [{loading ? "..." : displayVaults.length}]</span>
          </span>
        </header>

        <div className="text-[#888] bg-[#111] font-mono text-sm font-medium">
          {loading && displayVaults.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[#555]">
              <span className="animate-pulse">Loading vault data from Decibel...</span>
            </div>
          ) : (
          <>
          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
              {displayVaults.map((vault, index) => {
                const guild = GUILD_OVERRIDES[vault.name];
                const pnlReturn = guild?.pnl ?? vault.all_time_return ?? 0;
                const displayVolume = guild?.volume ?? vault.volume_30d ?? 0;
                const pnlNeg = pnlReturn < 0;
                const pnlStr = `${pnlNeg ? "" : "+"}${pnlReturn.toFixed(2)}%`;
                const chartColor = pnlNeg ? "#ef4444" : VAULT_COLORS[index % VAULT_COLORS.length];
                const chartPoints = chartData[vault.address] ?? [];

                return (
                <div
                  key={vault.address}
                  className="w-full shrink-0 snap-start border-r border-[#2a2a2a] bg-[#111] p-[18px] last:border-r-0 xl:w-[calc(100%/3)] xl:min-w-[calc(100%/3)]"
                  style={{ scrollSnapStop: "always" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-sans text-[15px] font-bold text-white">{guild?.displayName ?? vault.name}</span>
                    <span className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      vault.vault_type === "protocol" ? "bg-accent/15 text-accent" : "bg-zinc-700/50 text-zinc-400"
                    )}>
                      {vault.vault_type === "protocol" ? "Protocol" : "User"}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-[10px] py-1.5">
                    <span className="flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#252525] bg-[#1a1a1a]">
                      {vault.vault_type === "protocol"
                        ? <DecibelMark className="h-[14px] w-auto" />
                        : <CashMark className="h-[14px] w-auto text-accent" />
                      }
                    </span>
                    {guild?.leader && (
                      <span
                        className="-ml-[18px] flex size-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#111] bg-[#1a1a1a]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={guild.leader.avatar} alt={guild.leader.name} className="h-full w-full rounded-full object-cover" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[9px] font-bold uppercase text-[#4a4a4a]">Vault Manager</span>
                      {guild?.leader ? (
                        <span className="truncate font-sans text-[13px] font-semibold text-[#ccc]">
                          {guild.leader.name}
                        </span>
                      ) : (
                        <span className="truncate font-sans text-[13px] font-semibold text-[#ccc]">
                          {shortenAddr(vault.manager)}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-[#1a2e1a]">
                    <div className="bg-[#0e1a0e] px-3 py-2.5">
                      <div className="text-[9px] font-bold uppercase text-[#2d6b2d]">Trading Volume</div>
                      <div className="mt-0.5 text-[14px] font-bold text-green-400">{formatUsd(displayVolume)}</div>
                    </div>
                    <div className="border-l border-[#1a2e1a] bg-[#0e1a0e] px-3 py-2.5">
                      <div className="text-[9px] font-bold uppercase text-[#2d6b2d]">Members</div>
                      <div className="mt-0.5 text-[14px] font-bold text-white">{(guild?.traders ?? vault.depositors ?? 0).toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-[9px] font-bold uppercase text-[#4a4a4a]">PnL</div>
                    <div
                      className={cn(
                        "mt-0.5 text-[22px] font-bold tabular-nums",
                        pnlNeg ? "text-red-400" : "text-green-400",
                      )}
                    >
                      {pnlStr}
                    </div>
                  </div>

                  <div className="mt-2 h-[140px] touch-pan-x">
                    {chartPoints.length >= 2 ? (
                      <AreaChart
                        data={chartPoints as unknown as Record<string, unknown>[]}
                        xDataKey="date"
                        aspectRatio="auto"
                        className="!h-full"
                        margin={{ top: 4, right: 4, bottom: 20, left: 0 }}
                        animationDuration={600}
                      >
                        <Grid horizontal fadeHorizontal numTicksRows={2} stroke="rgba(255,255,255,0.04)" strokeDasharray="4,4" />
                        <Area
                          dataKey="pnl"
                          fill={chartColor}
                          fillOpacity={0.2}
                          strokeWidth={1.5}
                          gradientToOpacity={0}
                          curve={curveLinear}
                        />
                        <ChartTooltip
                          showCrosshair
                          showDots
                          showDatePill={false}
                          rows={(point) => [
                            { color: chartColor, label: "PnL", value: `${(point.pnl as number) >= 0 ? "+" : ""}${(point.pnl as number).toFixed(2)}%` },
                          ]}
                        />
                      </AreaChart>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-[#333]">Loading chart...</div>
                    )}
                  </div>

                  <div className="mt-2 space-y-1 border-t border-[#1a1a1a] pt-2">
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Trading Volume</span>
                      <span className="text-[#777]">{formatUsd(displayVolume)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Open Interest</span>
                      <span className="text-[#777]">{formatUsd(guild?.openInterest ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Members</span>
                      <span className="text-[#777]">{(guild?.traders ?? vault.depositors ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Profit Share</span>
                      <span className="text-[#777]">{guild?.profitShare ?? vault.profit_share ?? 0}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Sharpe Ratio</span>
                      <span className="text-[#777]">{(guild?.sharpe ?? vault.sharpe_ratio ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Max Drawdown</span>
                      <span className="text-red-400">{(guild?.maxDrawdown ?? vault.max_drawdown ?? 0).toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                );
              })}
          </div>

          {/* Scroll indicator — tap left half to go back, right half to go forward */}
          {displayVaults.length > 1 && (
          <div className="relative flex items-center justify-center border-t border-[#2a2a2a] bg-[#181818] px-5 py-3">
            {/* Invisible tap zones */}
            <button
              aria-label="Previous vault"
              className="absolute inset-y-0 left-0 w-1/2"
              onClick={() => scrollTo(activeIndex - 1)}
            />
            <button
              aria-label="Next vault"
              className="absolute inset-y-0 right-0 w-1/2"
              onClick={() => scrollTo(activeIndex + 1)}
            />
            {/* Indicator lines */}
            <div className="flex items-center gap-1.5">
              {displayVaults.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-[2px] rounded-full transition-all duration-200",
                    i === activeIndex ? "w-6 bg-[#888]" : "w-3 bg-[#333]",
                  )}
                />
              ))}
            </div>
          </div>
          )}
          </>
          )}
        </div>
    </div>
  );
}

function CashMark({ className = "" }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center font-mono text-[10px] font-black leading-none", className)}>
      CASH
    </span>
  );
}

/* ─── Decibel logo mark (actual image) ─── */
function DecibelMark({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/decibel-logo.jpg" alt="Decibel" className={cn("rounded-full object-cover", className)} />
  );
}

/* ─── Realized PNL data snapshot ─── */
interface ClosedPnl {
  market: string;
  side: "long" | "short";
  leverage: number;
  collateral: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  duration: number;
}

/* ─── Realized PNL Card Modal ─── */
function PnlCardModal({
  data,
  onDismiss,
}: {
  data: ClosedPnl;
  onDismiss: () => void;
}) {
  const isProfit = data.pnl >= 0;
  const netPnl = data.pnl - data.fees;
  const isNetProfit = netPnl >= 0;
  const mins = Math.floor(data.duration / 60000);
  const secs = Math.floor((data.duration % 60000) / 1000);
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const asset = data.market.replace("/USDT", "").replace("/USDC", "");

  return createPortal(
    <div
      className="cash-trade-theme fixed inset-0 z-[200] flex items-center justify-center modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Card */}
      <div className="relative w-[380px] max-w-[calc(100vw-32px)] modal-panel">
        {/* Gradient border wrapper */}
        <div
          className="rounded-[20px] p-[1px]"
          style={{
            background: isNetProfit
              ? "linear-gradient(135deg, #0DA726, #4ade80 40%, rgba(255,255,255,0.08) 60%, #0DA726)"
              : "linear-gradient(135deg, #F21A1A, #ef4444 40%, rgba(255,255,255,0.08) 60%, #F21A1A)",
          }}
        >
          <div className="rounded-[20px] bg-[#111111] overflow-hidden relative">
            {/* Background pattern — subtle angular lines */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div
                className="absolute -top-20 -right-20 w-64 h-64 opacity-[0.03]"
                style={{
                  background: `repeating-linear-gradient(
                    -45deg,
                    ${isNetProfit ? "#0DA726" : "#F21A1A"} 0px,
                    ${isNetProfit ? "#0DA726" : "#F21A1A"} 1px,
                    transparent 1px,
                    transparent 12px
                  )`,
                }}
              />
              <div
                className="absolute -bottom-16 -left-16 w-48 h-48 opacity-[0.03]"
                style={{
                  background: `repeating-linear-gradient(
                    45deg,
                    ${isNetProfit ? "#0DA726" : "#F21A1A"} 0px,
                    ${isNetProfit ? "#0DA726" : "#F21A1A"} 1px,
                    transparent 1px,
                    transparent 12px
                  )`,
                }}
              />
            </div>

            {/* Header */}
            <div className="relative px-6 pt-5 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CashMark className="h-4 w-auto text-accent" />
                <span className="text-[11px] font-display font-bold uppercase tracking-[0.15em] text-zinc-400">
                  cash.trading
                </span>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-500 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
                Closed
              </span>
            </div>

            {/* Position badge */}
            <div className="px-6 pb-2 flex items-center gap-2">
              <span className="text-white text-[18px] font-display font-bold">{asset}</span>
              <span
                className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-md ${
                  data.side === "long"
                    ? "bg-green-500/15 text-green-400"
                    : "bg-red-500/15 text-red-400"
                }`}
              >
                {data.side}
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {data.leverage.toFixed(1)}x
              </span>
            </div>

            {/* Realized PNL label */}
            <div className="px-6 pt-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-zinc-500">
                Realized PNL
              </span>
            </div>

            {/* Big PNL */}
            <div className="px-6 pt-1 pb-5">
              <div className={`text-[42px] font-mono font-black tracking-tight leading-none ${isNetProfit ? "text-green-400" : "text-red-400"}`}>
                {isNetProfit ? "+" : ""}{netPnl < 0 ? "-" : ""}${Math.abs(netPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`text-[16px] font-mono font-bold mt-1 ${isNetProfit ? "text-green-400/70" : "text-red-400/70"}`}>
                {isNetProfit ? "+" : ""}{data.pnlPct.toFixed(2)}%
              </div>
            </div>

            {/* Divider */}
            <div className="mx-6 h-px bg-white/[0.06]" />

            {/* Details grid */}
            <div className="px-6 py-4 space-y-2.5">
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Entry Price</span>
                <span className="text-white tabular-nums">
                  ${data.entryPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Exit Price</span>
                <span className="text-white tabular-nums">
                  ${data.exitPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Collateral</span>
                <span className="text-white tabular-nums">
                  ${data.collateral.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Gross PNL</span>
                <span className={`tabular-nums ${isProfit ? "text-green-400" : "text-red-400"}`}>
                  {isProfit ? "+" : ""}${Math.abs(data.pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Fees (0.045%)</span>
                <span className="text-zinc-400 tabular-nums">
                  -${data.fees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between text-[12px] font-mono">
                <span className="text-zinc-500">Duration</span>
                <span className="text-white">{durationStr}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-6 h-px bg-white/[0.06]" />

            {/* Dismiss */}
            <div className="px-6 py-5">
              <button
                onClick={onDismiss}
                className="w-full py-3 rounded-[12px] text-[13px] font-display font-bold uppercase tracking-wider text-white bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.1] transition-colors active:scale-[0.97]"
              >
                Done
              </button>
            </div>

            {/* Footer watermark */}
            <div className="px-6 pb-4 flex items-center justify-center gap-1.5">
              <CashMark className="h-2.5 w-auto text-zinc-700" />
              <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-[0.2em]">
                cash.trading
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Positions table (payments-log style) ─── */

function PositionsTable({ positions, currentPrice, onClose }: { positions: Position[]; currentPrice: number; onClose: (id: string) => void }) {
  return (
    <div className="bg-[#1c1c1c] w-full rounded-2xl p-2 shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
      <div className="border border-[#2a2a2a] overflow-hidden rounded-lg">
        {/* Header */}
        <header className="border-b border-[#2a2a2a] text-[#888] bg-[#202020] flex items-center p-5 sm:px-8 sm:py-6 font-mono text-sm font-semibold tabular-nums">
          <span className="flex items-center gap-2">
            <span className="relative h-2 w-2 shrink-0 rounded-full bg-green-500">
              <span className="absolute inset-0 animate-ping rounded-full bg-green-500 opacity-75" />
            </span>
            <span>OPEN_POSITIONS [{positions.length}]</span>
          </span>
        </header>

        {/* Rows */}
        <div className="text-[#888] bg-[#181818] p-5 sm:px-8 sm:py-6 font-mono text-sm font-medium" style={{ overflowAnchor: "none" }}>
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center text-[#999] mb-5 gap-x-4">
            <span className="font-bold">MARKET</span>
            <span className="font-bold">COLLATERAL</span>
            <span className="font-bold text-right">PNL</span>
            <span className="w-16" />
          </div>
          {/* Data rows */}
          <div className="flex flex-col gap-3">
            {positions.map((pos) => {
              const pnl = getPositionPnl({
                collateral: pos.collateral,
                leverage: pos.leverage,
                entryPrice: pos.entryPrice,
                currentPrice,
                side: pos.side,
              });
              const pnlPos = pnl >= 0;
              return (
                <div
                  key={pos.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center font-mono tabular-nums gap-x-4"
                >
                  {/* Market + side + leverage */}
                  <span className="flex items-center gap-2">
                    <span className="text-white text-xs">{pos.market.replace("/USDT", "").replace("/USDC", "")}</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        pos.side === "long"
                          ? "bg-green-400/10 text-green-400"
                          : "bg-red-400/10 text-red-400"
                      }`}
                    >
                      {pos.side}
                    </span>
                    <span className="text-[10px] text-[#666]">
                      {pos.leverage.toFixed(1)}x
                    </span>
                  </span>
                  {/* Collateral */}
                  <span className="flex items-center">
                    <span className="text-green-400 bg-green-400/10 flex h-5 items-center rounded-[4px] px-1 text-xs font-medium">
                      ${pos.collateral.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  {/* PnL */}
                  <span
                    className={`flex items-center text-right font-bold text-xs ${
                      pnlPos ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {pnlPos ? "+" : ""}
                    ${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {/* Close button */}
                  <button
                    onClick={() => onClose(pos.id)}
                    className="flex items-center justify-center w-[72px] h-7 rounded-md bg-red-500/20 text-red-400 text-[11px] font-bold uppercase tracking-wider border border-red-500/30 hover:bg-red-500/40 hover:text-red-300 transition-colors"
                  >
                    Close
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Graduated indicator signal products ─── */

interface GraduatedIndicator {
  address: string;
  name: string;
  symbol?: string;
  description?: string;
  assets: string[];
  lastSignal: number;
  meanSharpe: number;
  profitablePct: number;
  simsFunded: number;
  vaultAddr?: string | null;
  whopProductId?: string | null;
  isProprietary?: boolean;
}

interface StrategyVaultSummary {
  id: string;
  indicatorAddr: string;
  ownerWallet: string;
  decibelSubaccount?: string | null;
  vaultAddr?: string | null;
  marketName: string;
  allocationPct: number;
  status: string;
}

const SIG_LABEL_TRADE = ["HOLD", "BUY", "SELL"];
const SIG_COLOR = [
  { text: "text-zinc-500", bg: "bg-zinc-800 border-zinc-700" },
  { text: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/30" },
  { text: "text-red-400",    bg: "bg-red-500/15 border-red-500/30" },
];

function isRealAptosAddress(value?: string | null) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

function useGraduatedIndicators(enabled = true) {
  const [indicators, setIndicators] = useState<GraduatedIndicator[]>([]);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/launchpad/indicators?graduated=true");
      if (!res.ok) return;
      const data = await res.json();
      setIndicators(data.indicators ?? []);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetch_();
    const t = setInterval(fetch_, 30_000);
    return () => clearInterval(t);
  }, [enabled, fetch_]);

  return indicators;
}

function SignalProductsPanel({
  enabled = true,
  onDeploy,
  onUnlock,
  onVaultAction,
  strategyVaultsByIndicator,
}: {
  enabled?: boolean;
  onDeploy: (ind: GraduatedIndicator) => void;
  onUnlock: (ind: GraduatedIndicator) => void;
  onVaultAction: (
    mode: VaultActionMode,
    ind: GraduatedIndicator,
    strategyVault?: StrategyVaultSummary,
    vaultAddress?: string | null,
  ) => void;
  strategyVaultsByIndicator: Record<string, StrategyVaultSummary>;
}) {
  const indicators = useGraduatedIndicators(enabled);
  const { isSubscribed } = useSubscription();
  if (indicators.length === 0) return null;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
      <header className="border-b border-[#2a2a2a] bg-[#202020] flex items-center px-5 py-4 sm:px-8 sm:py-5 font-mono text-sm font-semibold tabular-nums text-[#888]">
        <span className="flex items-center gap-2">
          <span className="relative h-2 w-2 shrink-0 rounded-full bg-purple-400">
            <span className="absolute inset-0 animate-ping rounded-full bg-purple-400 opacity-75" />
          </span>
          <span>SIGNAL PRODUCTS [{indicators.length}]</span>
        </span>
        <span className="ml-3 text-[10px] font-normal text-[#555]">· Graduated indicators · deploy a bot for live signals</span>
      </header>

      <div className="bg-[#111] divide-y divide-[#1e1e1e]">
        {indicators.map((ind) => {
          const sig = ind.lastSignal ?? 0;
          const sigLabel = SIG_LABEL_TRADE[sig] ?? "HOLD";
          const sigColor = SIG_COLOR[sig] ?? SIG_COLOR[0];
          const sharpe = (ind.meanSharpe / 1000).toFixed(2);
          const subscriberCount = Math.max(1, Math.round(ind.simsFunded / 100));
          const showUnlock = ind.isProprietary && !isSubscribed(ind.address);
          const strategyVault = strategyVaultsByIndicator[ind.address.toLowerCase()];
          const vaultAddress =
            strategyVault?.vaultAddr ??
            (isRealAptosAddress(ind.vaultAddr) ? ind.vaultAddr : null);

          return (
            <div
              key={ind.address}
              className="flex items-center gap-4 px-5 py-4 sm:px-8 hover:bg-white/[0.02] transition-colors"
            >
              {/* Signal badge */}
              <span className={cn(
                "shrink-0 text-[10px] font-bold px-2 py-1 rounded border font-mono",
                sigColor.bg, sigColor.text,
              )}>
                {sigLabel}
              </span>

              {/* Name + asset */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{ind.name}</p>
                <p className="text-[11px] text-[#555] mt-0.5">{ind.assets[0]} · {subscriberCount} subscribers</p>
              </div>

              {/* Stats */}
              <div className="hidden sm:flex items-center gap-6 shrink-0 text-[11px] font-mono">
                <div className="text-right">
                  <p className="text-white tabular-nums">{sharpe}</p>
                  <p className="text-[#555]">Sharpe</p>
                </div>
                <div className="text-right">
                  <p className="text-white tabular-nums">{ind.profitablePct}%</p>
                  <p className="text-[#555]">Win Rate</p>
                </div>
              </div>

              {/* CTA */}
              {showUnlock ? (
                <button
                  onClick={() => onUnlock(ind)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[11px] font-bold hover:bg-amber-500/20 transition-colors"
                >
                  Unlock
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => onVaultAction(vaultAddress ? "deposit" : "create", ind, strategyVault, vaultAddress)}
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    Vault
                  </button>
                  <button
                    onClick={() => onDeploy(ind)}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-purple-400"
                  >
                    Deploy Bot
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MobilePortfolioSheet({ children }: { children: ReactNode }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    active: false,
    startY: 0,
    startOffset: 0,
    offset: 0,
    collapsed: 0,
    moved: false,
  });
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);

  const updateCollapsed = useCallback(() => {
    const height = sheetRef.current?.offsetHeight ?? 0;
    const collapsed = Math.max(0, height - PORTFOLIO_SHEET_PEEK);
    dragRef.current.collapsed = collapsed;
    const next = open ? 0 : collapsed;
    dragRef.current.offset = next;
    setOffset(next);
  }, [open]);

  useLayoutEffect(() => {
    updateCollapsed();
    window.addEventListener("resize", updateCollapsed);
    window.addEventListener("orientationchange", updateCollapsed);
    return () => {
      window.removeEventListener("resize", updateCollapsed);
      window.removeEventListener("orientationchange", updateCollapsed);
    };
  }, [updateCollapsed]);

  const snapTo = useCallback((nextOpen: boolean) => {
    const next = nextOpen ? 0 : dragRef.current.collapsed;
    setOpen(nextOpen);
    dragRef.current.offset = next;
    setOffset(next);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = true;
    dragRef.current.startY = event.clientY;
    dragRef.current.startOffset = dragRef.current.offset;
    dragRef.current.moved = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const delta = event.clientY - dragRef.current.startY;
    if (Math.abs(delta) > 4) dragRef.current.moved = true;
    const next = Math.max(0, Math.min(dragRef.current.collapsed, dragRef.current.startOffset + delta));
    dragRef.current.offset = next;
    setOffset(next);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    const shouldOpen = dragRef.current.offset < dragRef.current.collapsed * 0.55;
    snapTo(shouldOpen);
  }, [snapTo]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
      {open && (
        <button
          type="button"
          aria-label="Close portfolio"
          className="pointer-events-auto fixed inset-0 -z-10 bg-black/70 backdrop-blur-sm"
          onClick={() => snapTo(false)}
        />
      )}
      <section
        ref={sheetRef}
        className={cn(
          "pointer-events-auto flex h-[72dvh] max-w-xl flex-col overflow-hidden border border-[#363636] bg-[#121212]",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_-30px_60px_-15px_rgba(0,0,0,0.88),0_-10px_26px_-10px_rgba(0,0,0,0.72)]",
          open ? "mx-auto rounded-t-[22px] border-b-0" : "mx-3 rounded-[22px]",
        )}
        style={{
          transform: `translate3d(0, ${offset}px, 0)`,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <div
          className="shrink-0 cursor-grab touch-none bg-gradient-to-b from-[#1c1c1c] to-[#121212] px-4 pb-3 pt-2.5 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => {
            if (dragRef.current.moved) return;
            snapTo(!open);
          }}
        >
          <div className="mx-auto mb-2.5 h-[5px] w-10 rounded-full bg-[#4d4d4d] shadow-[0_1px_0_rgba(255,255,255,0.06)]" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-display font-semibold text-zinc-100">Portfolio</div>
              <div className="text-[11px] text-zinc-500">Positions, orders, and account state</div>
            </div>
            <div className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide",
              open ? "bg-[#1f1f1f] text-zinc-400" : "bg-accent/15 text-accent",
            )}>
              {open ? "Close" : "Open"}
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#101010] px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {children}
        </div>
      </section>
    </div>
  );
}

/* ─── Page ─── */

export function TradePageClient({
  initialBtcCandles = [],
}: {
  initialBtcCandles?: MarketHistoryCandle[];
}) {
  const [market, setMarket] = useState<{
    id: string;
    pair: string;
    leverage: number;
    marketAddr?: string;
    marketName?: string;
  }>({ id: "BTC/USD", pair: "BTC/USD", leverage: 40 });
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentPrice, setCurrentPrice] = useState(0);
  const [closedPnl, setClosedPnl] = useState<ClosedPnl | null>(null);
  const [deployTarget, setDeployTarget] = useState<GraduatedIndicator | null>(null);
  const [vaultAction, setVaultAction] = useState<{
    mode: VaultActionMode;
    indicator: GraduatedIndicator;
    strategyVault?: StrategyVaultSummary;
    vaultAddress?: string | null;
  } | null>(null);
  const [strategyVaultsByIndicator, setStrategyVaultsByIndicator] = useState<Record<string, StrategyVaultSummary>>({});
  const { account, signAndSubmitTransaction } = useWallet();
  const { selectedSubaccount } = useDecibelSubaccounts();
  const { subscribe } = useSubscription();
  const isMobile = useIsMobile();
  const currentPriceRef = useRef(0);
  const queuedPriceRef = useRef(0);
  const priceCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPriceCommitAtRef = useRef(0);
  const positionsRef = useRef<Position[]>([]);
  const liquidatedIdsRef = useRef(new Set<string>());
  const vaultsSectionRef = useRef<HTMLDivElement>(null);
  const signalsSectionRef = useRef<HTMLDivElement>(null);
  const vaultsActive = useInViewport(vaultsSectionRef, { rootMargin: "480px" });
  const signalsActive = useInViewport(signalsSectionRef, { rootMargin: "480px" });
  const ownerWallet = account?.address?.toString() ?? "";

  const fetchStrategyVaults = useCallback(async () => {
    if (!ownerWallet) {
      setStrategyVaultsByIndicator({});
      return;
    }

    try {
      const res = await fetch(`/api/launchpad/strategy-vaults?owner=${encodeURIComponent(ownerWallet)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { strategyVaults?: StrategyVaultSummary[] };
      const next: Record<string, StrategyVaultSummary> = {};
      for (const vault of data.strategyVaults ?? []) {
        next[vault.indicatorAddr.toLowerCase()] = vault;
      }
      setStrategyVaultsByIndicator(next);
    } catch {
      // Keep the trade page usable if the local strategy vault table is unavailable.
    }
  }, [ownerWallet]);

  useEffect(() => {
    void fetchStrategyVaults();
  }, [fetchStrategyVaults]);

  useEffect(() => {
    return () => {
      if (priceCommitTimerRef.current) clearTimeout(priceCommitTimerRef.current);
    };
  }, []);

  const handlePriceUpdate = useCallback((price: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    currentPriceRef.current = price;
    queuedPriceRef.current = price;

    const commit = () => {
      priceCommitTimerRef.current = null;
      lastPriceCommitAtRef.current = performance.now();
      const nextPrice = queuedPriceRef.current;
      setCurrentPrice((previous) => {
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) return previous;
        const minDelta = Math.max(0.000001, Math.abs(previous) * 0.0000025);
        return Math.abs(nextPrice - previous) >= minDelta ? nextPrice : previous;
      });
    };

    const now = performance.now();
    const elapsed = now - lastPriceCommitAtRef.current;
    if (elapsed >= PRICE_UI_COMMIT_MS && !priceCommitTimerRef.current) {
      commit();
      return;
    }

    if (!priceCommitTimerRef.current) {
      priceCommitTimerRef.current = setTimeout(commit, Math.max(16, PRICE_UI_COMMIT_MS - elapsed));
    }
  }, []);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  /* Close position immediately & show realized PNL card */
  const handlePositionClose = useCallback((id: string) => {
    liquidatedIdsRef.current.delete(id);
    const pos = positionsRef.current.find((entry) => entry.id === id);
    if (!pos) return;

    const exitPrice = currentPriceRef.current;
    const pnl = getPositionPnl({
      collateral: pos.collateral,
      leverage: pos.leverage,
      entryPrice: pos.entryPrice,
      currentPrice: exitPrice,
      side: pos.side,
    });
    const orderValue = pos.collateral * pos.leverage;
    const fees = orderValue * 0.00045;
    const pnlPct = pos.entryPrice > 0
      ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === "long" ? 1 : -1)
      : 0;

    setPositions((prev) => prev.filter((entry) => entry.id !== id));

    dispatchPortfolioActivity({
      type: "Closed",
      amount: parseFloat(pnl.toFixed(2)),
      market: pos.market,
    });

    setClosedPnl({
      market: pos.market,
      side: pos.side,
      leverage: pos.leverage,
      collateral: pos.collateral,
      entryPrice: pos.entryPrice,
      exitPrice,
      pnl,
      pnlPct,
      fees,
      duration: Date.now() - pos.timestamp,
    });
  }, []);

  const handlePositionOpen = useCallback(
    (pos: { market: string; side: "long" | "short"; collateral: number; leverage: number }) => {
      const entryPrice = currentPriceRef.current;

      setPositions((prev) => [
        {
          ...pos,
          id: crypto.randomUUID(),
          entryPrice,
          liquidationPrice: getEstimatedLiquidationPrice(entryPrice, pos.side, pos.leverage),
          timestamp: Date.now(),
        },
        ...prev,
      ]);
    },
    [],
  );

  useEffect(() => {
    if (positions.length === 0 || currentPrice <= 0) return;

    const liquidated = positions.filter(
      (pos) =>
        !liquidatedIdsRef.current.has(pos.id) &&
        isPositionLiquidated({
          currentPrice,
          liquidationPrice: pos.liquidationPrice,
          side: pos.side,
        }),
    );

    if (liquidated.length === 0) return;

    const liquidatedIds = new Set(liquidated.map((pos) => pos.id));
    liquidated.forEach((pos) => liquidatedIdsRef.current.add(pos.id));
    setPositions((prev) => prev.filter((pos) => !liquidatedIds.has(pos.id)));

    liquidated.forEach((pos) => {
      dispatchPortfolioActivity({
        type: "Liquidated",
        amount: parseFloat((-pos.collateral).toFixed(2)),
        hash: `local-liq-${pos.id}`,
        market: pos.market,
      });
    });
  }, [currentPrice, positions]);

  const chartLiquidationLines = positions
    .filter((pos) => pos.market === market.pair && pos.liquidationPrice > 0)
    .map((pos) => ({
      id: pos.id,
      price: pos.liquidationPrice,
      side: pos.side,
    }));
  const selectedPerpMarket = PERP_MARKET_DATA[market.id];
  const decibelMarketAddress = market.marketAddr ?? selectedPerpMarket?.marketAddr;
  const decibelMarketName =
    market.marketName ??
    selectedPerpMarket?.marketName ??
    market.pair.replace(" PERPS", "").replace("/USDT", "/USD").replace("/USDC", "/USD");
  const handleMarketChange = useCallback((nextMarket: {
    id: string;
    pair: string;
    leverage: number;
    marketAddr?: string;
    marketName?: string;
  }) => {
    setMarket(nextMarket);
  }, []);
  const signVaultTransaction = useCallback(
    async (payload: unknown) => {
      if (!signAndSubmitTransaction) {
        throw new Error("Connect a wallet before signing the vault transaction");
      }
      return signAndSubmitTransaction({ data: payload as any });
    },
    [signAndSubmitTransaction],
  );

  return (
    <div className="min-h-screen pb-24 lg:pb-0">
      <Header />
      <div className="relative" style={{ overflow: "clip" }}>
        <main className="relative z-10 mx-auto w-full max-w-[1800px] px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5">
        {/* ── Desktop: side-by-side. Mobile: stacked ── */}
        <div
          id="trade"
          className="grid gap-3 xl:grid-cols-[minmax(560px,1fr)_minmax(340px,390px)] xl:items-stretch 2xl:grid-cols-[minmax(700px,1fr)_390px_360px] 2xl:gap-4"
        >
          {/* BTC Chart */}
          <div className="min-w-0 animate-enter animate-enter-delay-1">
            <BTCChart
              initialHistory={initialBtcCandles}
              liquidationLines={chartLiquidationLines}
              onMarketChange={handleMarketChange}
              onPriceUpdate={handlePriceUpdate}
            />
          </div>

          <div className="hidden animate-enter animate-enter-delay-2 xl:block">
            <OrderBook
              key={decibelMarketAddress ?? decibelMarketName}
              marketName={decibelMarketName}
              marketAddress={decibelMarketAddress}
              currentPrice={currentPrice}
              rowCount={21}
              className="h-[672px] min-h-0"
            />
          </div>

          {/* Trade Panel — right sidebar on desktop */}
          <div className="min-w-0 max-w-xl animate-enter animate-enter-delay-2 xl:col-span-2 xl:max-w-none 2xl:col-span-1">
            <TradePanel
              market={market.pair}
              marketId={market.id}
              marketName={decibelMarketName}
              marketAddress={decibelMarketAddress}
              maxLeverage={market.leverage}
              currentPrice={currentPrice}
              onPositionOpen={handlePositionOpen}
              className="2xl:min-h-[672px]"
            />
            <div className="mt-3 xl:hidden">
              <OrderBook
                key={decibelMarketAddress ?? decibelMarketName}
                marketName={decibelMarketName}
                marketAddress={decibelMarketAddress}
                currentPrice={currentPrice}
                rowCount={11}
                className="h-[452px] sm:h-[572px]"
              />
            </div>
          </div>
        </div>

        {/* ── Open Positions ─────────────────────────── */}
        <div id="positions" className="scroll-mt-20">
          {positions.length > 0 && (
            <div className="mt-6 animate-enter">
              <PositionsTable positions={positions} currentPrice={currentPrice} onClose={handlePositionClose} />
            </div>
          )}

          <div className="mt-6 hidden animate-enter lg:block">
            <DecibelPositions showOverview={false} />
          </div>
        </div>

        <div ref={vaultsSectionRef} id="vaults" className="mt-6 scroll-mt-20 animate-enter">
          <VaultsPanel enabled={vaultsActive} />
        </div>

        <div ref={signalsSectionRef} id="signals" className="mt-6 scroll-mt-20 animate-enter">
          <SignalProductsPanel
            enabled={signalsActive}
            onDeploy={(ind) => setDeployTarget(ind)}
            onUnlock={(ind) => { subscribe(ind.address, 29); setDeployTarget(ind); }}
            onVaultAction={(mode, ind, strategyVault, vaultAddress) =>
              setVaultAction({ mode, indicator: ind, strategyVault, vaultAddress })
            }
            strategyVaultsByIndicator={strategyVaultsByIndicator}
          />
        </div>
        </main>
      </div>
      {isMobile && (
        <MobilePortfolioSheet>
          <DecibelPositions showOverview={false} />
        </MobilePortfolioSheet>
      )}

      {/* Deploy Bot Modal */}
      {deployTarget && (
        <ScheduleTradeModal
          indicator={{
            address: deployTarget.address,
            creator: "",
            name: deployTarget.name,
            symbol: "",
            description: "",
            assets: deployTarget.assets,
            createdAt: Date.now(),
            curveAddr: deployTarget.address,
            aptReserves: 0,
            totalRaised: 0,
            simsFunded: deployTarget.simsFunded,
            isGraduated: true,
            totalSims: deployTarget.simsFunded,
            meanSharpe: deployTarget.meanSharpe,
            profitablePct: deployTarget.profitablePct,
            robustnessScore: 0,
            maxDrawdownBps: 0,
            vaultAddr: null,
            lastSignal: deployTarget.lastSignal,
            lastSignalTime: 0,
            params: [],
            indicatorType: 0,
            isProprietary: deployTarget.isProprietary,
          } satisfies IndicatorEntry}
          isOpen={true}
          onClose={() => setDeployTarget(null)}
          onScheduled={() => setDeployTarget(null)}
        />
      )}

      {vaultAction && (
        <VaultActionModal
          open={true}
          onOpenChange={(open) => {
            if (!open) setVaultAction(null);
          }}
          mode={vaultAction.mode}
          indicator={{
            id: vaultAction.indicator.address,
            name: vaultAction.indicator.name,
            symbol: vaultAction.indicator.symbol,
            description: vaultAction.indicator.description,
            assets: vaultAction.indicator.assets,
          }}
          vaultAddress={
            vaultAction.vaultAddress ??
            vaultAction.strategyVault?.vaultAddr ??
            (isRealAptosAddress(vaultAction.indicator.vaultAddr) ? vaultAction.indicator.vaultAddr : null)
          }
          subaccount={selectedSubaccount}
          ownerWallet={ownerWallet}
          marketName={vaultAction.strategyVault?.marketName ?? vaultAction.indicator.assets[0] ?? decibelMarketName}
          strategyVaultId={vaultAction.strategyVault?.id}
          allocationPct={vaultAction.strategyVault?.allocationPct ?? 5}
          signAndSubmitTransaction={signVaultTransaction}
          onComplete={() => {
            void fetchStrategyVaults();
            setVaultAction(null);
          }}
        />
      )}

      {/* Realized PNL Card */}
      {closedPnl && (
        <PnlCardModal
          data={closedPnl}
          onDismiss={() => {
            if (closedPnl) {
              dispatchBalanceUpdate({ delta: closedPnl.pnl });
            }
            setClosedPnl(null);
          }}
        />
      )}
    </div>
  );
}
