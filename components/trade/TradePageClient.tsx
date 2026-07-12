"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Header } from "@/components/layout/Header";
import { BTCChart } from "@/components/trade/BTCChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { Positions as DecibelPositions } from "@/components/trade/Positions";
import { TradePanel } from "@/components/trade/TradePanel";
import { VaultActionModal } from "@/components/trade/VaultActionModal";
import { MobilePortfolioSheet } from "@/components/trade/MobilePortfolioSheet";
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
const PRICE_UI_COMMIT_MS = 250;

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

function useDecibelVaults(enabled = true) {
  const [vaults, setVaults] = useState<DecibelVault[]>([]);
  const [loading, setLoading] = useState(true);
  const chartDataRef = useRef<Record<string, PnlPoint[]>>({});
  // Chart provenance per address: "real" = series from /api/decibel/vault-history,
  // "unavailable" = history confirmed missing (no fake fallback), undefined = seeded demo.
  const [chartKind, setChartKind] = useState<Record<string, "real" | "unavailable">>({});
  const historyRequestedRef = useRef<Set<string>>(new Set());
  const unavailableRef = useRef<Set<string>>(new Set());

  const fetchVaults = useCallback(async () => {
    try {
      const res = await fetch("/api/decibel/vaults");
      if (!res.ok) return;
      const data = await res.json();
      const fetched: DecibelVault[] = data.vaults ?? [];
      // Never replace loaded vaults with an empty refresh — the upstream
      // flaps, and a transient empty payload was wiping the whole section
      // ([6] → [0]) on the 30s poll.
      setVaults((prev) => (fetched.length > 0 ? fetched : prev));
      if (fetched.length === 0) return;

      for (const v of fetched) {
        if (!historyRequestedRef.current.has(v.address)) {
          historyRequestedRef.current.add(v.address);
          void (async () => {
            try {
              const hr = await fetch(
                `/api/decibel/vault-history?vault=${v.address}&range=30d&type=pnl`,
                { cache: "no-store" },
              );
              if (!hr.ok) {
                historyRequestedRef.current.delete(v.address);
                return;
              }
              const hist = await hr.json();
              const points: { t: number; v: number }[] = hist.points ?? [];
              if (hist.unavailable || points.length < 2) {
                delete chartDataRef.current[v.address];
                unavailableRef.current.add(v.address);
                setChartKind((prev) => ({ ...prev, [v.address]: "unavailable" }));
                return;
              }
              chartDataRef.current[v.address] = points.map((p) => ({
                date: new Date(p.t),
                pnl: p.v,
              }));
              setChartKind((prev) => ({ ...prev, [v.address]: "real" }));
            } catch { /* transient failure — keep current curve, retry next poll */
              historyRequestedRef.current.delete(v.address);
            }
          })();
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchVaults();
    const interval = setInterval(fetchVaults, 30_000);
    return () => clearInterval(interval);
  }, [enabled, fetchVaults]);

  return { vaults, loading, chartData: chartDataRef.current, chartKind };
}

function VaultsPanel({ enabled = true }: { enabled?: boolean }) {
  const { vaults, loading, chartData, chartKind } = useDecibelVaults(enabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Show every active Decibel vault; keep the protocol vault first.
  const displayVaults = [...vaults]
    .sort((a, b) => {
      if (a.vault_type === "protocol") return -1;
      if (b.vault_type === "protocol") return 1;
      return (b.all_time_return ?? 0) - (a.all_time_return ?? 0);
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
      setActiveIndex(Math.max(0, Math.min(idx, displayVaults.length - 1)));
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
          ) : displayVaults.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[#555]">
              Vault data is temporarily unavailable.
            </div>
          ) : (
          <>
          <div
            ref={scrollRef}
            className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
              {displayVaults.map((vault, index) => {
                const pnlReturn = vault.all_time_return ?? 0;
                const displayVolume = vault.volume_30d ?? vault.volume ?? 0;
                const pnlNeg = pnlReturn < 0;
                const pnlStr = `${pnlNeg ? "" : "+"}${pnlReturn.toFixed(2)}%`;
                const chartColor = pnlNeg ? "#ef4444" : VAULT_COLORS[index % VAULT_COLORS.length];
                const chartPoints = chartData[vault.address] ?? [];
                const chartIsReal = chartKind[vault.address] === "real";
                const chartUnavailable = chartKind[vault.address] === "unavailable";

                return (
                <div
                  key={vault.address}
                  className="w-full shrink-0 snap-start border-r border-[#2a2a2a] bg-[#111] p-[18px] last:border-r-0 xl:w-[calc(100%/3)] xl:min-w-[calc(100%/3)]"
                  style={{ scrollSnapStop: "always" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-sans text-[15px] font-bold text-white">{vault.name}</span>
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
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[9px] font-bold uppercase text-[#4a4a4a]">Vault Manager</span>
                      <span className="truncate font-sans text-[13px] font-semibold text-[#ccc]">
                        {shortenAddr(vault.manager)}
                      </span>
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-[#1a2e1a]">
                    <div className="bg-[#0e1a0e] px-3 py-2.5">
                      <div className="text-[9px] font-bold uppercase text-[#2d6b2d]">Trading Volume</div>
                      <div className="mt-0.5 text-[14px] font-bold text-green-400">{formatUsd(displayVolume)}</div>
                    </div>
                    <div className="border-l border-[#1a2e1a] bg-[#0e1a0e] px-3 py-2.5">
                      <div className="text-[9px] font-bold uppercase text-[#2d6b2d]">Members</div>
                      <div className="mt-0.5 text-[14px] font-bold text-white">{(vault.depositors ?? 0).toLocaleString()}</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-baseline justify-between">
                      <div className="text-[9px] font-bold uppercase text-[#4a4a4a]">PnL</div>
                      <div className="text-[8px] font-bold uppercase tracking-wide text-[#333]">
                        {chartIsReal ? "30d on-chain history" : chartUnavailable ? "" : "Loading 30d history"}
                      </div>
                    </div>
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
                            {
                              color: chartColor,
                              label: "PnL",
                              value: formatUsd(point.pnl as number),
                            },
                          ]}
                        />
                      </AreaChart>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-[#333]">
                        {chartUnavailable ? "PnL history not available for this vault yet" : "Loading chart..."}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 space-y-1 border-t border-[#1a1a1a] pt-2">
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Trading Volume</span>
                      <span className="text-[#777]">{formatUsd(displayVolume)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>TVL</span>
                      <span className="text-[#777]">{formatUsd(vault.tvl)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>All-time PnL</span>
                      <span className={cn((vault.all_time_pnl ?? 0) < 0 ? "text-red-400" : "text-green-400")}>
                        {formatUsd(vault.all_time_pnl)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>APR</span>
                      <span className="text-[#777]">{(vault.apr ?? 0).toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Win Rate (12w)</span>
                      <span className="text-[#777]">{((vault.weekly_win_rate_12w ?? 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Members</span>
                      <span className="text-[#777]">{(vault.depositors ?? 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Profit Share</span>
                      <span className="text-[#777]">{vault.profit_share ?? 0}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Sharpe Ratio</span>
                      <span className="text-[#777]">{(vault.sharpe_ratio ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>Max Drawdown</span>
                      <span className="text-red-400">{(vault.max_drawdown ?? 0).toFixed(1)}%</span>
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
              type="button"
              className="absolute inset-y-0 left-0 w-1/2"
              onClick={() => scrollTo(activeIndex - 1)}
            />
            <button
              aria-label="Next vault"
              type="button"
              className="absolute inset-y-0 right-0 w-1/2"
              onClick={() => scrollTo(activeIndex + 1)}
            />
            {/* Indicator lines */}
            <div className="flex items-center gap-1.5">
              {displayVaults.map((vault, i) => (
                <div
                  key={vault.address}
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
    <Image
      src="/decibel-logo.jpg"
      alt="Decibel"
      width={32}
      height={32}
      className={cn("rounded-full object-cover", className)}
    />
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
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close realized PnL card"
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onDismiss}
      />

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
                type="button"
                onClick={onDismiss}
                className="w-full py-3 rounded-[12px] text-[13px] font-display font-bold uppercase tracking-wider text-white bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.1] transition-colors active:scale-[0.97]"
              >
                Close
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
                    type="button"
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
  /** Published package for REAL on-chain indicators — presence marks a LIVE strategy. */
  pkg?: string;
  maxDrawdownBps?: number;
  params?: number[];
  indicatorType?: number;
}

const INDICATOR_TYPE_LABEL = ["SMA", "EMA", "RSI", "MACD", "BB", "Stoch", "SuperTrend", "Donchian"];

/** Live on-chain state for indicators that exist as real objects (pkg set). */
interface LiveIndicatorState {
  signal: number;
  lastPrice: number;
  totalPushed: number;
  totalSignals: number;
  inPosition: boolean;
  entryPrice: number;
  prices: number[];
  timestamps: number[];
}

function useLiveIndicatorStates(indicators: GraduatedIndicator[]) {
  const [states, setStates] = useState<Record<string, LiveIndicatorState>>({});
  const liveKey = indicators.filter((i) => i.pkg).map((i) => i.address).join(",");

  useEffect(() => {
    if (!liveKey) return;
    let cancelled = false;
    const load = async () => {
      const live = indicators.filter((i) => i.pkg);
      const results = await Promise.all(
        live.map(async (ind) => {
          try {
            const res = await fetch(
              `/api/launchpad/on-chain?addr=${ind.address}&pkg=${ind.pkg}`,
              { cache: "no-store" },
            );
            const data = await res.json();
            if (!res.ok || data.onChain === false || typeof data.signal !== "number") return null;
            return [ind.address.toLowerCase(), data as LiveIndicatorState] as const;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, LiveIndicatorState> = {};
      for (const r of results) if (r) next[r[0]] = r[1];
      setStates((prev) => ({ ...prev, ...next }));
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  return states;
}

/** Seeded demo curve for strategies that aren't live yet — stable across renders. */
function buildDemoStrategyCurve(ind: GraduatedIndicator): PnlPoint[] {
  let seed = 0;
  for (let i = 0; i < ind.address.length; i++) seed = (seed * 31 + ind.address.charCodeAt(i)) | 0;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const endPnl = (ind.meanSharpe / 1000) * 2.4;
  const maxDD = Math.max(1, (ind.maxDrawdownBps ?? 500) / 100);
  const vol = Math.min(1.6, Math.max(0.25, maxDD / 4));
  const now = Date.now();
  const span = 60 * 24 * 3600_000;
  const M = 120;
  const points: PnlPoint[] = [];
  let pnl = 0;
  for (let i = 0; i <= M; i++) {
    points.push({ date: new Date(now - span + (i * span) / M), pnl: +pnl.toFixed(2) });
    const expected = endPnl * (i / M);
    pnl += endPnl / M + (rng() - 0.5) * 2 * vol + (expected - pnl) * 0.12;
  }
  points[points.length - 1] = { date: new Date(now), pnl: +endPnl.toFixed(2) };
  return points;
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
  const liveStates = useLiveIndicatorStates(indicators);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Live (real on-chain) strategies first, then demos by Sharpe desc.
  const sorted = [...indicators].sort((a, b) => {
    const liveA = a.pkg ? 1 : 0;
    const liveB = b.pkg ? 1 : 0;
    if (liveA !== liveB) return liveB - liveA;
    return b.meanSharpe - a.meanSharpe;
  });

  const scrollTo = useCallback((idx: number) => {
    const el = scrollRef.current;
    if (!el || sorted.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, sorted.length - 1));
    const cardW = el.scrollWidth / sorted.length;
    el.scrollTo({ left: cardW * clamped, behavior: "smooth" });
  }, [sorted.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.scrollWidth / Math.max(sorted.length, 1);
      setActiveIndex(Math.max(0, Math.min(Math.round(el.scrollLeft / w), sorted.length - 1)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [sorted.length]);

  if (indicators.length === 0) return null;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#2a2a2a] shadow-[0px_0px_1px_rgba(0,0,0,0.50)]">
      <header className="border-b border-[#2a2a2a] bg-[#202020] flex items-center px-5 py-4 sm:px-8 sm:py-5 font-mono text-sm font-semibold tabular-nums text-[#888]">
        <span className="flex items-center gap-2">
          <span className="relative h-2 w-2 shrink-0 rounded-full bg-purple-400">
            <span className="absolute inset-0 animate-ping rounded-full bg-purple-400 opacity-75" />
          </span>
          <span>STRATEGY VAULTS [{sorted.length}]</span>
        </span>
        <span className="ml-3 hidden text-[10px] font-normal text-[#555] sm:inline">· Indicators that trade Decibel vaults — on-chain enforced</span>
      </header>

      <div className="bg-[#111] font-mono text-sm font-medium text-[#888]">
        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {sorted.map((ind) => {
            const live = liveStates[ind.address.toLowerCase()];
            const isLive = Boolean(ind.pkg);
            const sig = live?.signal ?? ind.lastSignal ?? 0;
            // The on-chain engine freezes at its last crank; presenting a
            // months-old price/signal as live is worse than saying nothing.
            const lastDataSec = live?.timestamps?.[live.timestamps.length - 1] ?? 0;
            const engineAgeDays =
              lastDataSec > 0 ? Math.floor((Date.now() / 1000 - lastDataSec) / 86_400) : 0;
            const engineStale =
              lastDataSec > 0 && Date.now() - lastDataSec * 1000 > 30 * 60_000;
            const engineAgeLabel =
              engineAgeDays >= 1
                ? `${engineAgeDays}d ago`
                : `${Math.max(1, Math.floor((Date.now() / 1000 - lastDataSec) / 3600))}h ago`;
            const sigLabel = engineStale
              ? `LAST ${SIG_LABEL_TRADE[sig] ?? "HOLD"}`
              : SIG_LABEL_TRADE[sig] ?? "HOLD";
            const sigColor = engineStale
              ? { bg: "border-zinc-700/40 bg-zinc-800/40", text: "text-zinc-500" }
              : SIG_COLOR[sig] ?? SIG_COLOR[0];
            const sharpe = (ind.meanSharpe / 1000).toFixed(2);
            const subscriberCount = Math.max(1, Math.round(ind.simsFunded / 100));
            const showUnlock = ind.isProprietary && !isSubscribed(ind.address);
            const strategyVault = strategyVaultsByIndicator[ind.address.toLowerCase()];
            const vaultAddress =
              strategyVault?.vaultAddr ??
              (isRealAptosAddress(ind.vaultAddr) ? ind.vaultAddr : null);
            const typeLabel = INDICATOR_TYPE_LABEL[ind.indicatorType ?? -1];
            const paramsLabel = ind.params?.length ? `(${ind.params.join("/")})` : "";

            // Chart: live strategies plot the real on-chain price buffer;
            // demo strategies plot a seeded illustrative curve.
            const liveChart = live && live.prices.length >= 2
              ? live.prices.map((p, i) => ({
                  date: new Date((live.timestamps[i] ?? 0) * 1000 || Date.now()),
                  pnl: p,
                }))
              : null;
            const chartPoints = liveChart ?? buildDemoStrategyCurve(ind);
            const chartColor = sig === 2 ? "#ef4444" : "#a855f7";
            // A frozen buffer of near-identical prices plots as a featureless
            // block; flag it so the card shows a designed frozen state instead.
            const chartValues = chartPoints.map((p) => p.pnl);
            const chartLo = Math.min(...chartValues);
            const chartHi = Math.max(...chartValues);
            const chartMid = (chartHi + chartLo) / 2 || 1;
            const frozenFlatChart =
              engineStale &&
              Boolean(liveChart) &&
              chartValues.length >= 2 &&
              (chartHi - chartLo) / Math.abs(chartMid) < 0.0005;

            return (
              <div
                key={ind.address}
                className="w-full shrink-0 snap-start border-r border-[#2a2a2a] bg-[#111] p-[18px] last:border-r-0 xl:w-[calc(100%/3)] xl:min-w-[calc(100%/3)]"
                style={{ scrollSnapStop: "always" }}
              >
                {/* Title row */}
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-sans text-[15px] font-bold text-white">{ind.name}</span>
                  <span className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                    isLive ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-700/50 text-zinc-400",
                  )}>
                    {isLive && (
                      <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400">
                        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                      </span>
                    )}
                    {isLive ? "Live" : "Demo"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#555]">
                  {ind.assets[0]}
                  {typeLabel ? ` · ${typeLabel} ${paramsLabel}` : ""}
                  {` · ${subscriberCount} subscribers`}
                </p>

                {/* Signal + position */}
                <div className="mt-3 flex items-center gap-2">
                  <span className={cn(
                    "rounded border px-2 py-1 font-mono text-[10px] font-bold",
                    sigColor.bg, sigColor.text,
                  )}>
                    {sigLabel}
                  </span>
                  {live?.inPosition && (
                    <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] font-bold text-emerald-400">
                      IN POSITION
                    </span>
                  )}
                  {isLive && live && (
                    <span className="ml-auto text-[10px] text-[#555]">
                      {live.totalPushed} ticks · {live.totalSignals} signals
                    </span>
                  )}
                </div>

                {/* Stat grid */}
                <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-[#241a2e]">
                  <div className="bg-[#160e1a] px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase text-[#6b2d8a]">Sharpe</div>
                    <div className="mt-0.5 text-[14px] font-bold text-purple-300">{sharpe}</div>
                  </div>
                  <div className="border-l border-[#241a2e] bg-[#160e1a] px-3 py-2.5">
                    <div className="text-[9px] font-bold uppercase text-[#6b2d8a]">Backtest Win</div>
                    <div className="mt-0.5 text-[14px] font-bold text-white">
                      {ind.profitablePct}%
                      <span className="ml-1 text-[9px] font-medium normal-case text-[#555]">of sims</span>
                    </div>
                  </div>
                </div>

                {/* Chart */}
                {frozenFlatChart ? (
                  <div className="mt-3 flex h-[120px] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#4a3d5c] bg-[#160e1a]/40">
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-400">
                      frozen {engineAgeLabel}
                    </span>
                    <span className="text-[10px] text-[#555]">
                      No price movement recorded since the last crank
                    </span>
                  </div>
                ) : (
                <div className="relative mt-3 h-[120px] touch-pan-x">
                  {engineStale && liveChart && (
                    <span className="absolute right-1 top-0 z-10 rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-amber-400">
                      frozen {engineAgeLabel}
                    </span>
                  )}
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
                          {
                            color: chartColor,
                            label: liveChart ? "Price" : "PnL",
                            value: liveChart
                              ? `$${(point.pnl as number).toLocaleString()}`
                              : `${(point.pnl as number) >= 0 ? "+" : ""}${(point.pnl as number).toFixed(2)}%`,
                          },
                        ]}
                      />
                    </AreaChart>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-[#333]">Loading chart...</div>
                  )}
                </div>
                )}

                {/* Details */}
                <div className="mt-2 space-y-1 border-t border-[#1a1a1a] pt-2">
                  <div className="flex items-center justify-between text-[11px] text-[#444]">
                    <span>Strategy</span>
                    <span className="text-[#777]">{isLive ? "On-chain enforced" : "Backtest demo"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#444]">
                    <span>Vault</span>
                    <span className="text-[#777]">{vaultAddress ? shortenAddr(vaultAddress) : "Not created"}</span>
                  </div>
                  {isLive && live && (
                    <div className="flex items-center justify-between text-[11px] text-[#444]">
                      <span>{engineStale ? "Price at freeze" : "Last price"}</span>
                      <span className="text-[#777]">
                        <span className={engineStale ? "text-zinc-600" : undefined}>
                          ${live.lastPrice.toLocaleString()}
                        </span>
                        {engineStale && (
                          <span className="text-amber-500/80">{` · ${engineAgeLabel}`}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* CTAs */}
                <div className="mt-3 flex items-center gap-2">
                  {showUnlock ? (
                    <button
                      type="button"
                      onClick={() => onUnlock(ind)}
                      className="flex-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] font-bold text-amber-400 transition-colors hover:bg-amber-500/20"
                    >
                      Unlock
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onVaultAction(vaultAddress ? "deposit" : "create", ind, strategyVault, vaultAddress)}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-2 text-[12px] font-bold transition-colors",
                          vaultAddress
                            ? "bg-accent text-black hover:bg-[#5dff3f]"
                            : "border border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white",
                        )}
                      >
                        {vaultAddress ? "Invest" : "Create Vault"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeploy(ind)}
                        className="flex-1 rounded-lg bg-purple-500 px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-purple-400"
                      >
                        Deploy Bot
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scroll indicator — tap left half to go back, right half to go forward */}
        {sorted.length > 1 && (
          <div className="relative flex items-center justify-center border-t border-[#2a2a2a] bg-[#181818] px-5 py-3">
            <button
              aria-label="Previous strategy"
              type="button"
              className="absolute inset-y-0 left-0 w-1/2"
              onClick={() => scrollTo(activeIndex - 1)}
            />
            <button
              aria-label="Next strategy"
              type="button"
              className="absolute inset-y-0 right-0 w-1/2"
              onClick={() => scrollTo(activeIndex + 1)}
            />
            <div className="flex items-center gap-1.5">
              {sorted.map((indicator, i) => (
                <div
                  key={indicator.address}
                  className={cn(
                    "h-[2px] rounded-full transition-all duration-200",
                    i === activeIndex ? "w-6 bg-[#888]" : "w-3 bg-[#333]",
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>
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
          className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)_minmax(320px,380px)] xl:items-stretch xl:gap-4"
        >
          {/* BTC Chart */}
          <div className="min-w-0 animate-enter animate-enter-delay-1 xl:h-[672px]">
            <BTCChart
              initialHistory={initialBtcCandles}
              liquidationLines={chartLiquidationLines}
              onMarketChange={handleMarketChange}
              onPriceUpdate={handlePriceUpdate}
              className="xl:h-full"
            />
          </div>

          <div className="hidden min-w-0 animate-enter animate-enter-delay-2 xl:block xl:h-[672px]">
            <OrderBook
              key={decibelMarketAddress ?? decibelMarketName}
              marketName={decibelMarketName}
              marketAddress={decibelMarketAddress}
              currentPrice={currentPrice}
              rowCount={21}
              className="h-full min-h-0"
            />
          </div>

          {/* Trade Panel — right sidebar on desktop */}
          <div className="min-w-0 max-w-xl animate-enter animate-enter-delay-2 xl:h-[672px] xl:max-w-none">
            <TradePanel
              market={market.pair}
              marketId={market.id}
              marketName={decibelMarketName}
              marketAddress={decibelMarketAddress}
              maxLeverage={market.leverage}
              currentPrice={currentPrice}
              onPositionOpen={handlePositionOpen}
              className="xl:h-full"
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
            // Live on-chain strategies are deployed on testnet today — say so.
            network: vaultAction.indicator.pkg ? "testnet" : undefined,
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
