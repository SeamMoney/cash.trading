"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { Header } from "@/components/layout/Header";
import { BTCChart } from "@/components/trade/BTCChart";
import { OrderBook } from "@/components/trade/OrderBook";
import { Positions as DecibelPositions } from "@/components/trade/Positions";
import { TradePanel } from "@/components/trade/TradePanel";
import { VaultActionModal } from "@/components/trade/VaultActionModal";
import { MobilePortfolioSheet } from "@/components/trade/MobilePortfolioSheet";
import { WalletAccountModal } from "@/components/wallet/wallet-account-modal";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { VaultPositionsTable } from "@/components/trade/VaultPositionsTable";
import type { VaultActionMode } from "@/components/trade/VaultActionTypes";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { cn } from "@/lib/utils";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import { AreaChart, Area } from "@/components/charts/area-chart";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { curveLinear } from "@visx/curve";
import { Grid } from "@/components/charts/grid";
import { useIsMobile } from "@/components/ui/use-mobile";
import { useInViewport } from "@/hooks/useInViewport";
import { formatVaultUsd, hasMeaningfulVaultActivity } from "@/lib/decibel-vault-display";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

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

const PRICE_UI_COMMIT_MS = 250;

/* Below-fold panels share the Open Positions panel grammar: one bordered
   panel, a px-4 py-3 header strip with a 13px display title, rows separated
   by hairlines — never a second design system. */
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const PANEL = "w-full overflow-hidden rounded-[var(--radius)] border border-card-border bg-background-secondary";
const PANEL_HEADER = "flex items-center justify-between gap-3 border-b border-card-border px-4 py-3";
const PANEL_TITLE = "font-display text-[13px] font-semibold text-foreground";
const PANEL_META = "text-[11px] text-zinc-500";
const PANEL_EMPTY = "p-6 text-center text-[13px] text-zinc-500";
const CARD = "w-full shrink-0 snap-start border-r border-card-border p-4 last:border-r-0 xl:w-[calc(100%/3)] xl:min-w-[calc(100%/3)]";
const CARD_TITLE = "truncate font-display text-sm font-semibold text-foreground";
/* Label/value pair shared with the Portfolio stat grid: a plain sentence-case
   label, a mono tabular value. No uppercase, no tracking. */
const CARD_LABEL = "text-[11px] font-medium text-zinc-400";
const CARD_CHIP = "shrink-0 rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] font-semibold";
const DETAIL_ROW = "flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-zinc-500";
const DETAIL_VALUE = "text-zinc-300";
const CARD_BTN = "flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-bold";
const CARD_BTN_PRIMARY = cn(CARD_BTN, "bg-accent text-black hover:brightness-95", PRESSABLE_CONTROL, FOCUS_RING);
const CARD_BTN_NEUTRAL = cn(
  CARD_BTN,
  "border border-card-border bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-foreground",
  PRESSABLE_CONTROL,
  FOCUS_RING,
);
const PAGER_ZONE = cn("absolute inset-y-0 w-1/2 rounded-none", FOCUS_RING, "focus-visible:ring-inset");

function shortenAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

interface PnlPoint { date: Date; pnl: number }

function useDecibelVaults(enabled = true) {
  const [vaults, setVaults] = useState<DecibelVault[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed fetch used to fall through to "No vault meets the verified
  // performance criteria yet" — an empty state that made a claim about the
  // chain when the page had simply never heard back. Same three words the
  // OrderBook and the swap registry use for this: unavailable.
  const [unavailable, setUnavailable] = useState(false);
  const chartDataRef = useRef<Record<string, PnlPoint[]>>({});
  // Chart provenance per address: "real" = series from /api/decibel/vault-history,
  // "unavailable" = history confirmed missing; undefined means still loading.
  const [chartKind, setChartKind] = useState<Record<string, "real" | "unavailable">>({});
  const historyRequestedRef = useRef<Set<string>>(new Set());
  const unavailableRef = useRef<Set<string>>(new Set());

  const fetchVaults = useCallback(async () => {
    try {
      const res = await fetch("/api/decibel/vaults");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = await res.json();
      const fetched: DecibelVault[] = data.vaults ?? [];
      setUnavailable(false);
      // Never replace loaded vaults with an empty refresh — the upstream
      // flaps, and a transient empty payload was wiping the whole section
      // ([6] → [0]) on the 30s poll.
      setVaults((prev) => (fetched.length > 0 ? fetched : prev));
      if (fetched.length === 0) return;

      for (const v of fetched) {
        // Do not spend history requests on empty/inactive vault cards. A vault
        // is listed only after both its headline metrics and real chart series
        // prove that it has capital, trading activity, and PnL.
        if (!hasMeaningfulVaultActivity(v)) continue;
        if (!historyRequestedRef.current.has(v.address)) {
          historyRequestedRef.current.add(v.address);
          void (async () => {
            try {
              const hr = await fetch(
                `/api/decibel/vault-history?vault=${v.address}&range=all&type=pnl`,
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
      setUnavailable(true);
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

  return {
    vaults,
    loading,
    unavailable,
    chartData: chartDataRef.current,
    chartKind,
    refreshVaults: fetchVaults,
  };
}

function VaultsPanel({
  enabled = true,
  holdingsRefreshNonce = 0,
  onAction,
  ownerAddress,
}: {
  enabled?: boolean;
  holdingsRefreshNonce?: number;
  onAction: (mode: "deposit" | "withdraw", vault: DecibelVault, maxAmount?: number) => void;
  ownerAddress?: string | null;
}) {
  const { vaults, loading, unavailable, chartData, chartKind, refreshVaults } = useDecibelVaults(enabled);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tradesVaultAddress, setTradesVaultAddress] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const [managedVaultHoldings, setManagedVaultHoldings] = useState<Map<string, { shares: number; currentValue: number }>>(
    () => new Map(),
  );

  const fetchVaultHoldings = useCallback(async () => {
    if (!enabled || !ownerAddress) {
      setManagedVaultHoldings(new Map());
      return;
    }

    try {
      const response = await fetch(
        `/api/vault/user?account=${encodeURIComponent(ownerAddress)}`,
        { cache: "no-store" },
      );
      const data = await response.json().catch(() => null) as {
        unavailable?: boolean;
        vaults?: Array<{
          address?: string;
          currentValue?: number;
          shares?: number;
        }>;
      } | null;
      if (!response.ok || !data || data.unavailable || !Array.isArray(data.vaults)) return;

      const next = new Map<string, { shares: number; currentValue: number }>();
      for (const holding of data.vaults) {
        if (!holding.address) continue;
        const shares = Number(holding.shares ?? 0);
        const currentValue = Number(holding.currentValue ?? 0);
        if (shares <= 0 && currentValue <= 0) continue;
        next.set(String(holding.address).toLowerCase(), { shares, currentValue });
      }
      setManagedVaultHoldings(next);
    } catch {
      // Preserve the last verified holding state through a transient indexer miss.
    }
  }, [enabled, ownerAddress]);

  useEffect(() => {
    void fetchVaultHoldings();
    const interval = enabled && ownerAddress
      ? setInterval(() => void fetchVaultHoldings(), 30_000)
      : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchVaultHoldings, holdingsRefreshNonce, enabled, ownerAddress]);

  const activityVaults = vaults.filter(hasMeaningfulVaultActivity);
  const historyPending = activityVaults.some((vault) => chartKind[vault.address] == null);

  // A card is eligible only when its non-zero metrics are backed by a real
  // on-chain PnL series. This intentionally excludes empty and dead vaults.
  const displayVaults = activityVaults
    .filter(
      (vault) =>
        chartKind[vault.address] === "real" &&
        (chartData[vault.address]?.length ?? 0) >= 2,
    )
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

  const pending = (loading || historyPending) && displayVaults.length === 0;

  return (
    <section aria-labelledby="vaults-heading" className={PANEL}>
        <div className={PANEL_HEADER}>
          <h3 id="vaults-heading" className={PANEL_TITLE}>
            Decibel Vaults{loading || historyPending ? "" : ` (${displayVaults.length})`}
          </h3>
          {(loading || historyPending) && !pending ? (
            <span className={PANEL_META}>updating...</span>
          ) : null}
        </div>

        <div>
          {pending ? (
            /* Loading is shaped like the rows it becomes, not a pulsing
               sentence: the sentence collapsed the panel to a fraction of its
               settled height, so every vault arriving pushed the page down.
               Same skeleton grammar as the sealed vault feed, drawn with
               surface tokens instead of that file's literal grey and corner. */
            <ul aria-busy aria-label="Loading vaults" className="divide-y divide-card-border">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center gap-4 px-4 py-4">
                  <div className="h-3.5 w-40 animate-pulse rounded-[var(--radius-xs)] bg-background-tertiary motion-reduce:animate-none" />
                  <div className="ml-auto h-3.5 w-16 animate-pulse rounded-[var(--radius-xs)] bg-background-tertiary motion-reduce:animate-none" />
                  <div className="hidden h-3.5 w-12 animate-pulse rounded-[var(--radius-xs)] bg-background-tertiary motion-reduce:animate-none sm:block" />
                </li>
              ))}
            </ul>
          ) : displayVaults.length === 0 ? (
            <div className={cn(PANEL_EMPTY, "flex flex-col items-center gap-3")}>
              <span>
                {unavailable
                  ? "Vaults are unavailable — the vault feed did not answer. Try again."
                  : "No vault meets the verified performance criteria yet."}
              </span>
              <button
                type="button"
                onClick={() => void refreshVaults()}
                className={cn(CARD_BTN_NEUTRAL, "flex-none")}
              >
                Retry
              </button>
            </div>
          ) : (
          <>
          <div
            ref={scrollRef}
            className="no-scrollbar flex items-start snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
              {displayVaults.map((vault) => {
                const pnlReturn = vault.all_time_return;
                const displayVolume = vault.volume ?? vault.volume_30d;
                const pnlNeg = pnlReturn != null && pnlReturn < 0;
                const pnlStr = pnlReturn == null
                  ? "—"
                  : `${pnlNeg ? "" : "+"}${pnlReturn.toFixed(2)}%`;
                const pnlUsdStr = vault.all_time_pnl == null
                  ? null
                  : `${vault.all_time_pnl > 0 ? "+" : ""}${formatVaultUsd(vault.all_time_pnl)}`;
                const chartColor = pnlNeg ? "var(--danger)" : "var(--accent)";
                const chartPoints = chartData[vault.address] ?? [];
                const chartIsReal = chartKind[vault.address] === "real";
                const chartUnavailable = chartKind[vault.address] === "unavailable";
                const holding = managedVaultHoldings.get(vault.address.toLowerCase());
                const hasHolding = Boolean(holding);

                return (
                <div
                  key={vault.address}
                  className={CARD}
                  style={{ scrollSnapStop: "always" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={CARD_TITLE}>{vault.name}</span>
                    <span className={cn(
                      CARD_CHIP,
                      vault.vault_type === "protocol" ? "bg-accent/15 text-accent" : "bg-white/[0.06] text-zinc-400"
                    )}>
                      {vault.vault_type === "protocol" ? "Protocol" : "User"}
                    </span>
                  </div>

                  <AnimatePresence initial={false} mode="wait">
                    {tradesVaultAddress === vault.address ? (
                      <motion.div
                        key="trades"
                        className="mt-3"
                        initial={{
                          opacity: 0,
                          transform: reduceMotion ? "none" : "translateY(4px)",
                        }}
                        animate={{ opacity: 1, transform: "translateY(0px)" }}
                        exit={{
                          opacity: 0,
                          transform: reduceMotion ? "none" : "translateY(-4px)",
                        }}
                        transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: "easeOut" }}
                      >
                        <VaultPositionsTable
                          vaultAddress={vault.address}
                          vaultName={vault.name}
                        />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="overview"
                        initial={{
                          opacity: 0,
                          transform: reduceMotion ? "none" : "translateY(-4px)",
                        }}
                        animate={{ opacity: 1, transform: "translateY(0px)" }}
                        exit={{
                          opacity: 0,
                          transform: reduceMotion ? "none" : "translateY(4px)",
                        }}
                        transition={{ duration: reduceMotion ? 0.08 : 0.16, ease: "easeOut" }}
                      >
                  <div className="mt-3 flex min-w-0 flex-col">
                    <span className={CARD_LABEL}>Vault Manager</span>
                    <span className="truncate font-mono text-[13px] font-semibold tabular-nums text-zinc-300">
                      {shortenAddr(vault.manager)}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 border-y border-card-border py-3">
                    <div className="flex min-w-0 flex-col pr-4">
                      <dt className="order-2 mt-1 text-[11px] font-medium text-zinc-400">All-time volume</dt>
                      <dd className="order-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground">
                        {formatVaultUsd(displayVolume)}
                      </dd>
                    </div>
                    <div className="flex min-w-0 flex-col border-l border-card-border pl-4">
                      <dt className="order-2 mt-1 text-[11px] font-medium text-zinc-400">Depositors</dt>
                      <dd className="order-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground">
                        {vault.depositors == null ? "—" : vault.depositors.toLocaleString()}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className={CARD_LABEL}>PnL</div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {chartIsReal ? "All-time, on-chain" : chartUnavailable ? "" : "Loading history"}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 flex items-baseline gap-2 font-mono tabular-nums",
                        pnlReturn == null ? "text-zinc-400" : pnlNeg ? "text-danger" : "text-accent",
                      )}
                    >
                      <span className="text-2xl font-bold">{pnlStr}</span>
                      {pnlUsdStr ? (
                        <span className="text-xs font-semibold opacity-75">
                          {pnlUsdStr}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 h-[170px] touch-pan-x">
                    {chartPoints.length >= 2 ? (
                      <AreaChart
                        data={chartPoints as unknown as Record<string, unknown>[]}
                        xDataKey="date"
                        aspectRatio="auto"
                        className="!h-full"
                        margin={{ top: 4, right: 4, bottom: 20, left: 0 }}
                        animationDuration={600}
                        yNice={false}
                        yPaddingRatio={0.025}
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
                              value: formatVaultUsd(point.pnl as number),
                            },
                          ]}
                        />
                      </AreaChart>
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">
                        {chartUnavailable ? "PnL history not available for this vault yet" : "Loading chart..."}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 space-y-1 border-t border-card-border pt-2">
                    <div className={DETAIL_ROW}>
                      <span>TVL</span>
                      <span className={DETAIL_VALUE}>{formatVaultUsd(vault.tvl)}</span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>All-time PnL</span>
                      <span className={cn(vault.all_time_pnl == null ? DETAIL_VALUE : vault.all_time_pnl < 0 ? "text-danger" : "text-accent")}>
                        {formatVaultUsd(vault.all_time_pnl)}
                      </span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>APR</span>
                      <span className={DETAIL_VALUE}>{vault.apr == null ? "—" : `${vault.apr.toFixed(2)}%`}</span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>Win Rate (12w)</span>
                      <span className={DETAIL_VALUE}>{vault.weekly_win_rate_12w == null ? "—" : `${(vault.weekly_win_rate_12w * 100).toFixed(0)}%`}</span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>Profit Share</span>
                      <span className={DETAIL_VALUE}>{vault.profit_share == null ? "—" : `${vault.profit_share}%`}</span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>Sharpe Ratio</span>
                      <span className={DETAIL_VALUE}>{vault.sharpe_ratio == null ? "—" : vault.sharpe_ratio.toFixed(2)}</span>
                    </div>
                    <div className={DETAIL_ROW}>
                      <span>Max Drawdown</span>
                      <span className={vault.max_drawdown == null ? DETAIL_VALUE : "text-danger"}>{vault.max_drawdown == null ? "—" : `${vault.max_drawdown.toFixed(1)}%`}</span>
                    </div>
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onAction(hasHolding ? "withdraw" : "deposit", vault, holding?.shares)}
                      className={CARD_BTN_PRIMARY}
                    >
                      {hasHolding ? "Manage" : "Deposit"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={tradesVaultAddress === vault.address}
                      onClick={() =>
                        setTradesVaultAddress((current) =>
                          current === vault.address ? null : vault.address,
                        )
                      }
                      className={cn(
                        CARD_BTN_NEUTRAL,
                        tradesVaultAddress === vault.address && "border-accent/30 bg-accent/10 text-accent hover:bg-accent/10",
                      )}
                    >
                      {tradesVaultAddress === vault.address ? "Overview" : "Trades"}
                    </button>
                  </div>
                </div>
                );
              })}
          </div>

          {/* Scroll indicator — tap left half to go back, right half to go forward */}
          {displayVaults.length > 1 && (
          <div className="relative flex items-center justify-center border-t border-card-border bg-card px-4 py-3">
            {/* Invisible tap zones */}
            <button
              aria-label="Previous vault"
              type="button"
              className={cn(PAGER_ZONE, "left-0")}
              onClick={() => scrollTo(activeIndex - 1)}
            />
            <button
              aria-label="Next vault"
              type="button"
              className={cn(PAGER_ZONE, "right-0")}
              onClick={() => scrollTo(activeIndex + 1)}
            />
            {/* Indicator lines */}
            <div className="flex items-center gap-1.5">
              {displayVaults.map((vault, i) => (
                <div
                  key={vault.address}
                  className={cn(
                    "h-0.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none",
                    i === activeIndex ? "w-6 bg-zinc-400" : "w-3 bg-zinc-700",
                  )}
                />
              ))}
            </div>
          </div>
          )}
          </>
          )}
        </div>
    </section>
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

/** Live on-chain state for indicators returned by Aptos-backed discovery. */
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
  const liveKey = indicators.map((i) => `${i.address}:${i.pkg ?? "legacy"}`).join(",");

  useEffect(() => {
    if (!liveKey) return;
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(
        indicators.map(async (ind) => {
          try {
            const packageQuery = ind.pkg ? `&pkg=${encodeURIComponent(ind.pkg)}` : "";
            const res = await fetch(
              `/api/launchpad/on-chain?addr=${ind.address}${packageQuery}`,
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
  { text: "text-zinc-400", bg: "bg-white/[0.06] border-card-border" },
  { text: "text-success", bg: "bg-success/10 border-success/20" },
  { text: "text-danger", bg: "bg-danger/10 border-danger/20" },
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
  onVaultAction,
  strategyVaultsByIndicator,
}: {
  enabled?: boolean;
  onVaultAction: (
    mode: VaultActionMode,
    ind: GraduatedIndicator,
    strategyVault?: StrategyVaultSummary,
    vaultAddress?: string | null,
  ) => void;
  strategyVaultsByIndicator: Record<string, StrategyVaultSummary>;
}) {
  const indicators = useGraduatedIndicators(enabled);
  const liveStates = useLiveIndicatorStates(indicators);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // All entries come from Aptos-backed discovery; sort by verified backtest score.
  const sorted = [...indicators].sort((a, b) => {
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
    <section aria-labelledby="signals-heading" className={PANEL}>
      <div className={PANEL_HEADER}>
        <h3 id="signals-heading" className={PANEL_TITLE}>
          Strategy Vaults ({sorted.length})
        </h3>
        <span className={cn(PANEL_META, "hidden truncate sm:inline")}>Indicators that trade Decibel vaults on-chain</span>
      </div>

      <div>
        <div
          ref={scrollRef}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {sorted.map((ind) => {
            const live = liveStates[ind.address.toLowerCase()];
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
              ? { bg: "border-card-border bg-white/[0.03]", text: "text-zinc-500" }
              : SIG_COLOR[sig] ?? SIG_COLOR[0];
            const sharpe = (ind.meanSharpe / 1000).toFixed(2);
            const strategyVault = strategyVaultsByIndicator[ind.address.toLowerCase()];
            const vaultAddress =
              strategyVault?.vaultAddr ??
              (isRealAptosAddress(ind.vaultAddr) ? ind.vaultAddr : null);
            const typeLabel = INDICATOR_TYPE_LABEL[ind.indicatorType ?? -1];
            const paramsLabel = ind.params?.length ? `(${ind.params.join("/")})` : "";

            const liveChart = live && live.prices.length >= 2
              ? live.prices.map((p, i) => ({
                  date: new Date((live.timestamps[i] ?? 0) * 1000 || Date.now()),
                  pnl: p,
                }))
              : null;
            const chartPoints = liveChart ?? [];
            const chartColor = sig === 2 ? "var(--danger)" : "var(--accent)";
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
                className={CARD}
                style={{ scrollSnapStop: "always" }}
              >
                {/* Title row */}
                <div className="flex items-center justify-between gap-3">
                  <span className={CARD_TITLE}>{ind.name}</span>
                  <span className={cn(CARD_CHIP, "bg-success/10 text-success")}>
                    On-chain
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {ind.assets[0]}
                  {typeLabel ? ` · ${typeLabel} ${paramsLabel}` : ""}
                </p>

                <div className={cn(DETAIL_ROW, "mt-3 border-y border-card-border py-2")}>
                  <span>Vault Manager</span>
                  <span className={cn(DETAIL_VALUE, "truncate text-right")}>{ind.name} indicator</span>
                </div>

                {/* Signal + position */}
                <div className="mt-3 flex items-center gap-2">
                  <span className={cn(
                    "rounded-[var(--radius-xs)] border px-2 py-1 font-mono text-[11px] font-bold",
                    sigColor.bg, sigColor.text,
                  )}>
                    {sigLabel}
                  </span>
                  {live?.inPosition && (
                    <span className="rounded-[var(--radius-xs)] border border-success/20 bg-success/10 px-2 py-1 font-mono text-[11px] font-bold text-success">
                      In position
                    </span>
                  )}
                  {live && (
                    <span className="ml-auto truncate font-mono text-[11px] tabular-nums text-zinc-500">
                      {live.totalPushed} ticks · {live.totalSignals} signals
                    </span>
                  )}
                </div>

                {/* Stat grid — same dl grammar as the vault cards */}
                <dl className="mt-3 grid grid-cols-2 border-y border-card-border py-3">
                  <div className="flex min-w-0 flex-col pr-4">
                    <dt className="order-2 mt-1 text-[11px] font-medium text-zinc-400">Sharpe</dt>
                    <dd className="order-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground">{sharpe}</dd>
                  </div>
                  <div className="flex min-w-0 flex-col border-l border-card-border pl-4">
                    <dt className="order-2 mt-1 text-[11px] font-medium text-zinc-400">Backtest win, of sims</dt>
                    <dd className="order-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground">
                      {ind.profitablePct}%
                    </dd>
                  </div>
                </dl>

                {/* Chart */}
                {frozenFlatChart ? (
                  <div className="mt-3 flex h-[180px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-card-border">
                    <span className="rounded-[var(--radius-xs)] bg-warning/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-warning">
                      Frozen {engineAgeLabel}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      No price movement since the last crank
                    </span>
                  </div>
                ) : (
                <div className="relative mt-3 h-[180px] touch-pan-x">
                  {engineStale && liveChart && (
                    <span className="absolute right-1 top-0 z-10 rounded-[var(--radius-xs)] bg-warning/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-warning">
                      Frozen {engineAgeLabel}
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
                            label: "Price",
                            value: `$${(point.pnl as number).toLocaleString()}`,
                          },
                        ]}
                      />
                    </AreaChart>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[11px] text-zinc-500">No on-chain price history</div>
                  )}
                </div>
                )}

                {/* Details */}
                <div className="mt-2 space-y-1 border-t border-card-border pt-2">
                  <div className={DETAIL_ROW}>
                    <span>Strategy</span>
                    <span className={DETAIL_VALUE}>On-chain verified</span>
                  </div>
                  <div className={DETAIL_ROW}>
                    <span>Vault</span>
                    <span className={DETAIL_VALUE}>{vaultAddress ? shortenAddr(vaultAddress) : "Not created"}</span>
                  </div>
                  {live && (
                    <div className={DETAIL_ROW}>
                      <span>{engineStale ? "Price at freeze" : "Last price"}</span>
                      <span className={DETAIL_VALUE}>
                        <span className={engineStale ? "text-zinc-500" : undefined}>
                          ${live.lastPrice.toLocaleString()}
                        </span>
                        {engineStale && (
                          <span className="text-warning">{` · ${engineAgeLabel}`}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                {/* CTA — one per card. Automation is not deployed, so there is
                    no second button to advertise it. */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onVaultAction(vaultAddress ? "deposit" : "create", ind, strategyVault, vaultAddress)}
                    className={vaultAddress ? CARD_BTN_PRIMARY : CARD_BTN_NEUTRAL}
                  >
                    {vaultAddress ? "Invest" : "Create Vault"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scroll indicator — tap left half to go back, right half to go forward */}
        {sorted.length > 1 && (
          <div className="relative flex items-center justify-center border-t border-card-border bg-card px-4 py-3">
            <button
              aria-label="Previous strategy"
              type="button"
              className={cn(PAGER_ZONE, "left-0")}
              onClick={() => scrollTo(activeIndex - 1)}
            />
            <button
              aria-label="Next strategy"
              type="button"
              className={cn(PAGER_ZONE, "right-0")}
              onClick={() => scrollTo(activeIndex + 1)}
            />
            <div className="flex items-center gap-1.5">
              {sorted.map((indicator, i) => (
                <div
                  key={indicator.address}
                  className={cn(
                    "h-0.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none",
                    i === activeIndex ? "w-6 bg-zinc-400" : "w-3 bg-zinc-700",
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
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
  const [currentPrice, setCurrentPrice] = useState(0);
  const [vaultAction, setVaultAction] = useState<{
    mode: VaultActionMode;
    indicator: GraduatedIndicator;
    strategyVault?: StrategyVaultSummary;
    vaultAddress?: string | null;
  } | null>(null);
  const [listedVaultAction, setListedVaultAction] = useState<{
    mode: "deposit" | "withdraw";
    vault: DecibelVault;
    maxAmount?: number;
  } | null>(null);
  const [vaultHoldingsRefreshNonce, setVaultHoldingsRefreshNonce] = useState(0);
  const [strategyVaultsByIndicator, setStrategyVaultsByIndicator] = useState<Record<string, StrategyVaultSummary>>({});
  // Mobile: the balance sheet covers the header's balance chip, which was the
  // only way into the deposit flow.
  const [mobileDepositOpen, setMobileDepositOpen] = useState(false);
  const [mobileConnectOpen, setMobileConnectOpen] = useState(false);
  const { owner, selectedSubaccount } = useDecibelSubaccounts();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const isMobile = useIsMobile();
  const queuedPriceRef = useRef(0);
  const priceCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPriceCommitAtRef = useRef(0);
  const vaultsSectionRef = useRef<HTMLDivElement>(null);
  const signalsSectionRef = useRef<HTMLDivElement>(null);
  const vaultsActive = useInViewport(vaultsSectionRef, { rootMargin: "480px" });
  const signalsActive = useInViewport(signalsSectionRef, { rootMargin: "480px" });
  const ownerWallet = owner;

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
      if (!signAndSubmitDecibelTransaction) {
        throw new Error("Connect a wallet before signing the vault transaction");
      }
      return signAndSubmitDecibelTransaction({ data: payload as any });
    },
    [signAndSubmitDecibelTransaction],
  );

  return (
    /* pb-12 clears the collapsed sheet's 44px peek — it used to reserve 96px
       for a 72px peek, so the page ended in dead space. */
    <div className="min-h-screen pb-12 md:pb-0">
      <Header />
      <div className="relative" style={{ overflow: "clip" }}>
        <main className="relative z-10 mx-auto w-full max-w-[1800px] px-4 py-3 sm:px-6 sm:py-4 lg:px-6 lg:py-5 2xl:px-8">
        {/* ── Desktop: side-by-side. Mobile: stacked ──
            Between xl and 2xl the two side columns took their maximum width and
            left the chart barely a third of the row — very visible at 125%
            browser zoom. Hold them at their designed minimum until there is
            genuinely room to grow, so the spare width goes to the chart. */}
        <div
          id="trade"
          className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px_336px] xl:items-stretch xl:gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(340px,390px)_minmax(340px,380px)] 2xl:gap-4"
        >
          {/* BTC Chart */}
          <div className="min-w-0 animate-enter animate-enter-delay-1 xl:h-[672px]">
            <BTCChart
              initialHistory={initialBtcCandles}
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

          {/* Trade Panel — right sidebar on desktop. It sizes to its content
              and self-aligns to the top: pinning it to the chart's 672px left
              ~200px of empty column under the primary CTA. */}
          <div className="min-w-0 max-w-xl animate-enter animate-enter-delay-2 xl:max-w-none xl:self-start">
            <TradePanel
              market={market.pair}
              marketId={market.id}
              marketName={decibelMarketName}
              marketAddress={decibelMarketAddress}
              maxLeverage={market.leverage}
              currentPrice={currentPrice}
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

            {/* ── Open Positions ─────────────────────────────
                In the rail, under the CTA: pinned below the grid it left ~175px
                of empty column beside a 672px chart and put the user's own
                positions below the fold at 1440x900. Below xl the rail is the
                stacked column, so the reading order is unchanged. It stays
                hidden below md because the mobile sheet (useIsMobile = 767px)
                already renders the same table there. */}
            <div id="positions" className="mt-3 hidden scroll-mt-20 animate-enter md:block">
              <DecibelPositions showOverview={false} />
            </div>
          </div>
        </div>

        <div ref={vaultsSectionRef} id="vaults" className="mt-6 scroll-mt-20 animate-enter">
          <VaultsPanel
            enabled={vaultsActive}
            holdingsRefreshNonce={vaultHoldingsRefreshNonce}
            onAction={(mode, vault, maxAmount) => setListedVaultAction({ mode, vault, maxAmount })}
            ownerAddress={ownerWallet}
          />
        </div>

        <div ref={signalsSectionRef} id="signals" className="mt-6 scroll-mt-20 animate-enter">
          <SignalProductsPanel
            enabled={signalsActive}
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
          {/* Funding was only reachable through the header's balance chip,
              which the sheet covers on mobile — deposits need a way in here. */}
          <button
            type="button"
            onClick={() => (owner ? setMobileDepositOpen(true) : setMobileConnectOpen(true))}
            className={cn(
              "mb-3 h-10 w-full rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-display font-semibold text-black hover:brightness-95",
              PRESSABLE_CONTROL,
              FOCUS_RING,
            )}
          >
            Deposit USDC
          </button>
          <DecibelPositions showOverview={false} />
        </MobilePortfolioSheet>
      )}
      {isMobile && (
        <>
          <WalletAccountModal open={mobileDepositOpen} onClose={() => setMobileDepositOpen(false)} />
          <WalletSelector open={mobileConnectOpen} onClose={() => setMobileConnectOpen(false)} />
        </>
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

      {listedVaultAction && (
        <VaultActionModal
          open={true}
          onOpenChange={(open) => {
            if (!open) setListedVaultAction(null);
          }}
          mode={listedVaultAction.mode}
          indicator={{
            id: listedVaultAction.vault.address,
            name: listedVaultAction.vault.name,
            description: listedVaultAction.vault.description ?? "Decibel mainnet vault",
            network: "mainnet",
          }}
          vaultAddress={listedVaultAction.vault.address}
          subaccount={selectedSubaccount}
          ownerWallet={ownerWallet}
          maxAmount={listedVaultAction.maxAmount}
          signAndSubmitTransaction={signVaultTransaction}
          onComplete={() => {
            setListedVaultAction(null);
            setVaultHoldingsRefreshNonce((value) => value + 1);
          }}
        />
      )}

    </div>
  );
}
