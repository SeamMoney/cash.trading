"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { curveLinear } from "@visx/curve";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { XAxis } from "@/components/charts/x-axis";
import { Header, PageConnectCta } from "@/components/layout/Header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { explorerTxUrl } from "@/lib/constants";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { isValidAptosAddress } from "@/lib/decibel";
import { PAGE_SHELL_WIDE } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";
// The app's one skeleton primitive, already shaping the /points leaderboard's
// loading rows. Imported rather than re-authored: two skeleton systems is how
// a pulse ends up a different grey on two pages.
import { Skeleton } from "@/components/ui/skeleton";
import { CashRewardsPanel } from "@/components/portfolio/CashRewardsPanel";
import {
  BUTTON_NEUTRAL,
  BUTTON_PRIMARY,
  CARD_ROW,
  CARD_ROW_GRID,
  CARD_ROW_LABEL,
  CARD_ROW_VALUE,
  INPUT,
  INPUT_LABEL,
  PANEL,
  ROW_ACTION,
  SECTION_GAP,
  SECTION_TITLE,
  SEGMENTED,
  SEGMENTED_ITEM,
  SEGMENTED_ITEM_ACTIVE,
  STAT_GRID_PANEL,
  STAT_LABEL,
  STAT_NOTE,
  STAT_TILE,
  STAT_VALUE,
  TAB,
  TAB_ACTIVE,
  TABLE,
  TABLE_EMPTY,
  TABLE_HEAD,
  TABLE_ROW,
  signTone,
} from "@/components/portfolio/portfolio-surface";
import { WalletAccountModal } from "@/components/wallet/wallet-account-modal";

type Position = {
  market: string;
  marketAddress: string | null;
  size: number;
  isLong: boolean;
  leverage: number;
  entryPrice: number;
  markPrice: number | null;
  value: number | null;
  estimatedPnl: number | null;
  marginUsed: number;
  isIsolated: boolean;
  unrealizedFunding: number | null;
  estimatedLiquidationPrice: number | null;
  tpTriggerPrice: number | null;
  slTriggerPrice: number | null;
};

type OpenOrder = {
  orderId: string;
  market: string;
  marketAddress: string | null;
  isBuy: boolean;
  price: number;
  origSize: number;
  remainingSize: number;
  status?: string;
  timestamp: number;
};

type Overview = {
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number | null;
  marginRatio: number;
  leverage: number | null;
  totalMargin: number;
  totalNotional: number;
  collateral: number;
  crossWithdrawable: number;
  volume30d: number | null;
};

type AccountState = {
  positions: Position[];
  openOrders: OpenOrder[];
  overview: Overview | null;
};

type PortfolioChartRange = "24h" | "7d" | "30d" | "90d" | "all";

type PortfolioHistoryPoint = {
  date: Date;
  value: number;
};

type FeeSummary = {
  fills: number;
  totalFeesPaidUsd: number;
  truncated: boolean;
};

type DecibelWsPosition = {
  market: string;
  size: number;
  user_leverage: number;
  entry_price: number;
  is_isolated: boolean;
  unrealized_funding: number;
  estimated_liquidation_price: number;
  tp_trigger_price: number | null;
  sl_trigger_price: number | null;
};

type DecibelWsOverview = {
  perp_equity_balance: number;
  unrealized_pnl: number;
  cross_margin_ratio: number;
  maintenance_margin: number;
  cross_account_leverage_ratio: number | null;
  cross_account_position: number;
  total_margin: number;
  usdc_cross_withdrawable_balance: number;
  usdc_isolated_withdrawable_balance: number;
  realized_pnl: number | null;
};

type DecibelWsOpenOrder = {
  market: string;
  order_id: string;
  orig_size: number | null;
  remaining_size: number | null;
  size_delta: number | null;
  price: number | null;
  is_buy: boolean;
  details?: string;
  unix_ms: number;
};

type DecibelWsMarketPrice = {
  market: string;
  mark_px: number;
};

type ActionStatus = {
  tone: "pending" | "success" | "error";
  message: string;
  hash?: string;
};

// Only surfaces that are actually wired to a Decibel read. The page used to
// carry seven more tabs (TWAPs, TWAP History, Trade History, Funding History,
// Order History, Transfers, and a Collateral tab that rendered the Balances
// table verbatim); none of them had a fetch behind it, so every one promised
// rows that could never arrive.
const TABS = ["Positions", "Open orders", "Balances"] as const;

const PORTFOLIO_CHART_RANGES: ReadonlyArray<{
  value: PortfolioChartRange;
  label: string;
}> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

const DEFAULT_CHART_METRIC = "pnl" as const;
const DEFAULT_CHART_RANGE: PortfolioChartRange = "30d";

function formatUsd(value: number | null | undefined, signed = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const digits = value >= 1_000 ? 1 : value >= 1 ? 4 : 6;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1_000 ? 1 : 2,
    maximumFractionDigits: digits,
  });
}

function formatPct(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function actionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/anonymous requests|authorization:\s*bearer|http error 401|unauthorized/i.test(message)) {
    return "Decibel market data auth failed on a server read. Refresh and retry; portfolio actions use chain fallback when the market address is available.";
  }
  return message;
}

function formatVolume(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatUsd(value);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function positionKey(position: Pick<Position, "marketAddress" | "market" | "isLong">) {
  return position.marketAddress
    ? position.marketAddress.toLowerCase()
    : `${position.market}:${position.isLong ? "L" : "S"}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getKnownMarketName(
  marketAddress: string,
  refs: { positions: Position[]; orders: OpenOrder[] },
) {
  const lower = marketAddress.toLowerCase();
  const position = refs.positions.find(
    (item) => item.marketAddress?.toLowerCase() === lower && item.market !== "Unknown",
  );
  if (position) return position.market;
  const order = refs.orders.find(
    (item) => item.marketAddress?.toLowerCase() === lower && item.market !== "Unknown",
  );
  return order?.market ?? marketAddress;
}

function applyLiveMark(position: Position, mark: number): Position {
  if (!Number.isFinite(mark) || mark <= 0) return position;
  const absSize = Math.abs(position.size);
  const value = absSize * mark;
  const estimatedPnl = position.isLong
    ? (mark - position.entryPrice) * absSize
    : (position.entryPrice - mark) * absSize;
  return {
    ...position,
    markPrice: mark,
    value,
    estimatedPnl,
  };
}

function decibelWsPositionToPosition(
  row: DecibelWsPosition,
  previousByMarket: Map<string, Position>,
  refs: { positions: Position[]; orders: OpenOrder[] },
): Position | null {
  if (!row.market || !isFiniteNumber(row.size) || row.size === 0) return null;
  const marketAddress = row.market;
  const isLong = row.size > 0;
  const absSize = Math.abs(row.size);
  const entryPrice = isFiniteNumber(row.entry_price) ? row.entry_price : 0;
  const leverage =
    isFiniteNumber(row.user_leverage) && row.user_leverage > 0
      ? row.user_leverage
      : 1;
  const previous = previousByMarket.get(marketAddress.toLowerCase()) ?? null;
  const base: Position = {
    market: previous?.market ?? getKnownMarketName(marketAddress, refs),
    marketAddress,
    size: row.size,
    isLong,
    leverage,
    entryPrice,
    markPrice: previous?.isLong === isLong ? previous.markPrice : null,
    value: null,
    estimatedPnl: null,
    marginUsed: leverage > 0 ? (absSize * entryPrice) / leverage : 0,
    isIsolated: Boolean(row.is_isolated),
    unrealizedFunding: isFiniteNumber(row.unrealized_funding)
      ? row.unrealized_funding
      : null,
    estimatedLiquidationPrice:
      isFiniteNumber(row.estimated_liquidation_price) &&
      row.estimated_liquidation_price !== 0
        ? row.estimated_liquidation_price
        : null,
    tpTriggerPrice: row.tp_trigger_price,
    slTriggerPrice: row.sl_trigger_price,
  };
  return base.markPrice ? applyLiveMark(base, base.markPrice) : base;
}

function decibelWsOverviewToOverview(
  row: DecibelWsOverview,
  previous: Overview | null,
): Overview {
  const equity = isFiniteNumber(row.perp_equity_balance)
    ? row.perp_equity_balance
    : 0;
  const unrealizedPnl = isFiniteNumber(row.unrealized_pnl)
    ? row.unrealized_pnl
    : 0;
  const crossWithdrawable = isFiniteNumber(row.usdc_cross_withdrawable_balance)
    ? row.usdc_cross_withdrawable_balance
    : 0;
  const isolatedWithdrawable = isFiniteNumber(row.usdc_isolated_withdrawable_balance)
    ? row.usdc_isolated_withdrawable_balance
    : 0;
  return {
    equity,
    unrealizedPnl,
    realizedPnl: isFiniteNumber(row.realized_pnl) ? row.realized_pnl : null,
    marginRatio: isFiniteNumber(row.cross_margin_ratio) ? row.cross_margin_ratio : 0,
    leverage: isFiniteNumber(row.cross_account_leverage_ratio)
      ? row.cross_account_leverage_ratio
      : null,
    totalMargin: isFiniteNumber(row.total_margin) ? row.total_margin : 0,
    totalNotional: isFiniteNumber(row.cross_account_position)
      ? row.cross_account_position
      : 0,
    collateral: previous?.collateral ?? equity - unrealizedPnl,
    crossWithdrawable: crossWithdrawable + isolatedWithdrawable,
    volume30d: previous?.volume30d ?? null,
  };
}

function decibelWsOpenOrderToOpenOrder(
  row: DecibelWsOpenOrder,
  refs: { positions: Position[]; orders: OpenOrder[] },
): OpenOrder | null {
  if (!row.market || !row.order_id) return null;
  return {
    orderId: row.order_id,
    market: getKnownMarketName(row.market, refs),
    marketAddress: row.market,
    isBuy: Boolean(row.is_buy),
    price: isFiniteNumber(row.price) ? row.price : 0,
    origSize:
      isFiniteNumber(row.orig_size) ? row.orig_size : isFiniteNumber(row.size_delta) ? row.size_delta : 0,
    remainingSize: isFiniteNumber(row.remaining_size) ? row.remaining_size : 0,
    status: "Open",
    timestamp: isFiniteNumber(row.unix_ms) ? row.unix_ms : Date.now(),
  };
}

// The dashed underline this row used to carry read as "hover me for a
// definition" and nothing was ever bound to it.
function OverviewRow({ label, value, tone, pending }: { label: string; value: string; tone?: string; pending?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      {pending ? (
        /* The row's own 13px line box, so the column does not reflow as the
           eight values land one request at a time. */
        <Skeleton className="h-[19px] w-16" />
      ) : (
        <span className={cn("font-mono tabular-nums text-foreground", tone)}>{value}</span>
      )}
    </div>
  );
}

export function PortfolioPageClient() {
  const { connected } = useWallet();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const {
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupError,
    lookupIncomplete,
    owner,
    selectedSubaccount,
    selectedSubaccountRecord,
    subaccounts,
  } = useDecibelSubaccounts();
  const [state, setState] = useState<AccountState>({
    positions: [],
    openOrders: [],
    overview: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Positions");
  const tabPanelId = "portfolio-tabpanel";
  const [chartMetric, setChartMetric] = useState<"pnl" | "portfolio">(DEFAULT_CHART_METRIC);
  const [chartRange, setChartRange] = useState<PortfolioChartRange>(DEFAULT_CHART_RANGE);
  const [historyPoints, setHistoryPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [feeSummary, setFeeSummary] = useState<FeeSummary | null>(null);
  const [feeSummaryLoading, setFeeSummaryLoading] = useState(false);
  const [feeSummaryError, setFeeSummaryError] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  // Deposit reuses the full account modal (wallet, account creation, bridge)
  // rather than a second bespoke deposit form.
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [closingKeys, setClosingKeys] = useState<Set<string>>(() => new Set());
  const [cancelingOrderIds, setCancelingOrderIds] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const feeSummaryAbortRef = useRef<AbortController | null>(null);
  const withdrawingRef = useRef(false);
  const withdrawalTokenRef = useRef<symbol | null>(null);
  const closingActionTokensRef = useRef(new Map<string, symbol>());
  const cancelingActionTokensRef = useRef(new Map<string, symbol>());
  const stateRef = useRef<AccountState>(state);
  const actionContext = `${owner}:${decibelNetwork}:${selectedSubaccount ?? ""}`;
  const actionContextRef = useRef(actionContext);
  actionContextRef.current = actionContext;

  const overview = state.overview;
  const positions = state.positions;
  const openOrders = state.openOrders;
  const selectedLabel =
    selectedSubaccountRecord?.name ||
    (selectedSubaccount ? shortAddress(selectedSubaccount) : "No Decibel account");
  const chartColor =
    chartMetric === "pnl" && (historyPoints.at(-1)?.value ?? 0) < 0
      ? "var(--danger)"
      : "var(--accent)";
  const chartData = useMemo(
    () => historyPoints as unknown as Record<string, unknown>[],
    [historyPoints],
  );
  // Nine enabled options over an empty frame read as a broken chart. The
  // controls appear once there is something to switch between: a rendered
  // series, or a non-default selection the reader has to be able to undo.
  const chartSeriesRendered = historyPoints.length >= 2;
  const chartControlsVisible =
    chartSeriesRendered
    || chartMetric !== DEFAULT_CHART_METRIC
    || chartRange !== DEFAULT_CHART_RANGE;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    withdrawalTokenRef.current = null;
    withdrawingRef.current = false;
    closingActionTokensRef.current.clear();
    cancelingActionTokensRef.current.clear();
    setWithdrawing(false);
    setClosingKeys(new Set());
    setCancelingOrderIds(new Set());
    setActionStatus(null);
    setState({ positions: [], openOrders: [], overview: null });
    setError("");
  }, [actionContext]);

  useEffect(() => {
    historyAbortRef.current?.abort();
    if (!connected || !selectedSubaccount) {
      setHistoryPoints([]);
      setHistoryLoading(false);
      setHistoryError("");
      return;
    }

    const controller = new AbortController();
    const requestContext = actionContextRef.current;
    historyAbortRef.current = controller;
    setHistoryPoints([]);
    setHistoryLoading(true);
    setHistoryError("");

    const loadHistory = async () => {
      try {
        const params = new URLSearchParams({
          address: selectedSubaccount,
          network: decibelNetwork,
          range: chartRange,
          type: chartMetric === "pnl" ? "pnl" : "account_value",
        });
        const response = await fetch(`/api/decibel/portfolio-chart?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || json.error) {
          throw new Error(json.error || "Failed to load portfolio history");
        }
        if (controller.signal.aborted || actionContextRef.current !== requestContext) return;

        const points = Array.isArray(json.points)
          ? json.points
              .map((row: unknown) => {
                if (typeof row !== "object" || row === null) return null;
                const record = row as Record<string, unknown>;
                const timestamp = Number(record.timestamp);
                const value = Number(record.value);
                if (!Number.isFinite(timestamp) || !Number.isFinite(value) || timestamp <= 0) return null;
                return { date: new Date(timestamp), value };
              })
              .filter((point: PortfolioHistoryPoint | null): point is PortfolioHistoryPoint => point != null)
          : [];
        setHistoryPoints(points);
      } catch (historyRequestError) {
        if (historyRequestError instanceof DOMException && historyRequestError.name === "AbortError") return;
        if (actionContextRef.current !== requestContext) return;
        setHistoryError(
          historyRequestError instanceof Error
            ? historyRequestError.message
            : "Failed to load portfolio history",
        );
      } finally {
        if (historyAbortRef.current === controller) {
          historyAbortRef.current = null;
          setHistoryLoading(false);
        }
      }
    };

    void loadHistory();
    return () => controller.abort();
  }, [chartMetric, chartRange, connected, decibelNetwork, selectedSubaccount]);

  useEffect(() => {
    feeSummaryAbortRef.current?.abort();
    if (!connected || !selectedSubaccount) {
      setFeeSummary(null);
      setFeeSummaryLoading(false);
      setFeeSummaryError("");
      return;
    }

    let activeController: AbortController | null = null;
    const requestContext = actionContextRef.current;
    const loadFeeSummary = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      feeSummaryAbortRef.current = controller;
      setFeeSummaryLoading(true);
      setFeeSummaryError("");
      try {
        const params = new URLSearchParams({
          address: selectedSubaccount,
          network: decibelNetwork,
        });
        const response = await fetch(`/api/decibel/fees?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null) as FeeSummary & { error?: string } | null;
        if (!response.ok || !data || data.error) {
          throw new Error(data?.error || "Failed to load fee history");
        }
        if (controller.signal.aborted || actionContextRef.current !== requestContext) return;
        setFeeSummary(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (actionContextRef.current !== requestContext) return;
        setFeeSummaryError(error instanceof Error ? error.message : "Fee history unavailable");
      } finally {
        if (!controller.signal.aborted && actionContextRef.current === requestContext) {
          setFeeSummaryLoading(false);
        }
      }
    };

    void loadFeeSummary();
    const interval = setInterval(() => void loadFeeSummary(), 60_000);
    return () => {
      clearInterval(interval);
      activeController?.abort();
    };
  }, [connected, decibelNetwork, selectedSubaccount]);

  const fetchAccountState = useCallback(async () => {
    if (!connected || !selectedSubaccount) {
      setState({ positions: [], openOrders: [], overview: null });
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    const requestContext = actionContextRef.current;
    abortRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        address: selectedSubaccount,
        openOrders: "true",
        network: decibelNetwork,
      });
      const res = await fetch(`/api/decibel/positions?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Failed to load Decibel portfolio");
      }
      if (controller.signal.aborted || actionContextRef.current !== requestContext) return;
      setState({
        positions: Array.isArray(json.positions) ? json.positions : [],
        openOrders: Array.isArray(json.openOrders) ? json.openOrders : [],
        overview: json.overview ?? null,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (actionContextRef.current !== requestContext) return;
      setError(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [connected, decibelNetwork, selectedSubaccount]);

  useEffect(() => {
    void fetchAccountState();
    return () => abortRef.current?.abort();
  }, [fetchAccountState]);

  // 20s, and only while the tab is visible. At 4s this refetched chain state
  // ~21,600 times per open hour per tab, which is what exhausted the RPC
  // provider's monthly credit and took the whole app's data offline.
  useEffect(() => {
    if (!connected || !selectedSubaccount) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval || document.hidden) return;
      interval = setInterval(() => void fetchAccountState(), 20_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void fetchAccountState();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [connected, fetchAccountState, selectedSubaccount]);

  useEffect(() => {
    if (!connected || !selectedSubaccount || typeof window === "undefined") return;
    const streamContext = actionContextRef.current;
    let stream: EventSource | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const params = new URLSearchParams({
      network: decibelNetwork,
      topics: [
        "all_market_prices",
        `account_positions:${selectedSubaccount}`,
        `account_overview:${selectedSubaccount}`,
        `account_open_orders:${selectedSubaccount}`,
        `order_updates:${selectedSubaccount}`,
        `user_trades:${selectedSubaccount}`,
        `withdraw_queue:${selectedSubaccount}`,
      ].join(","),
    });
    stream = new EventSource(`/api/decibel/stream?${params.toString()}`);

    const scheduleRefresh = (delay = 250) => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (actionContextRef.current === streamContext) void fetchAccountState();
      }, delay);
    };

    const handleMessage = (event: MessageEvent) => {
      if (actionContextRef.current !== streamContext) return;
      try {
        const message = JSON.parse(event.data) as {
          topic?: string;
          type?: string;
          positions?: unknown;
          account_overview?: unknown;
          orders?: unknown;
          prices?: unknown;
        };
        if (message.type === "connected" || message.type === "closed") return;

        if (message.topic === "all_market_prices" && Array.isArray(message.prices)) {
          const marks = new Map<string, number>();
          for (const row of message.prices as DecibelWsMarketPrice[]) {
            if (row.market && isFiniteNumber(row.mark_px)) {
              marks.set(row.market.toLowerCase(), row.mark_px);
            }
          }
          if (marks.size === 0) return;
          setState((prev) => ({
            ...prev,
            positions: prev.positions.map((position) => {
              const market = position.marketAddress?.toLowerCase();
              const mark = market ? marks.get(market) : undefined;
              return mark === undefined ? position : applyLiveMark(position, mark);
            }),
          }));
          return;
        }

        if (
          message.topic === `account_positions:${selectedSubaccount}` &&
          Array.isArray(message.positions)
        ) {
          const previousByMarket = new Map<string, Position>();
          for (const item of stateRef.current.positions) {
            if (item.marketAddress) {
              previousByMarket.set(item.marketAddress.toLowerCase(), item);
            }
          }
          const refs = {
            positions: stateRef.current.positions,
            orders: stateRef.current.openOrders,
          };
          const next = message.positions
            .map((row) =>
              decibelWsPositionToPosition(
                row as DecibelWsPosition,
                previousByMarket,
                refs,
              ),
            )
            .filter((row): row is Position => row !== null);
          setState((prev) => ({ ...prev, positions: next }));
          setLoading(false);
          scheduleRefresh(1_500);
          return;
        }

        if (
          message.topic === `account_overview:${selectedSubaccount}` &&
          message.account_overview
        ) {
          setState((prev) => ({
            ...prev,
            overview: decibelWsOverviewToOverview(
              message.account_overview as DecibelWsOverview,
              prev.overview,
            ),
          }));
          setLoading(false);
          return;
        }

        if (
          message.topic === `account_open_orders:${selectedSubaccount}` &&
          Array.isArray(message.orders)
        ) {
          const refs = {
            positions: stateRef.current.positions,
            orders: stateRef.current.openOrders,
          };
          const next = message.orders
            .map((row) => decibelWsOpenOrderToOpenOrder(row as DecibelWsOpenOrder, refs))
            .filter((row): row is OpenOrder => row !== null);
          setState((prev) => ({ ...prev, openOrders: next }));
          return;
        }

        if (
          message.topic?.startsWith("order_updates:") ||
          message.topic?.startsWith("user_trades:") ||
          message.topic?.startsWith("withdraw_queue:")
        ) {
          scheduleRefresh(150);
        }
      } catch {
        scheduleRefresh();
      }
    };
    const handleError = () => stream?.close();
    stream.addEventListener("message", handleMessage);
    stream.addEventListener("error", handleError);
    return () => {
      stream?.removeEventListener("message", handleMessage);
      stream?.removeEventListener("error", handleError);
      stream?.close();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [connected, decibelNetwork, fetchAccountState, selectedSubaccount]);

  const totalPnl = overview?.unrealizedPnl ?? null;
  // Every number on this page used to arrive by resizing from an em dash. Both
  // flags are true only while a request that will resolve them is in flight —
  // `loading` and `isLoadingSubaccounts` both terminate, so a skeleton can
  // never outlive its fetch and become the new permanent placeholder.
  const accountPending = connected && !overview && (loading || isLoadingSubaccounts);
  const feesPending = feeSummaryLoading && !feeSummary;
  const openPositionReturn =
    totalPnl != null && overview?.totalMargin && overview.totalMargin > 0
      ? (totalPnl / overview.totalMargin) * 100
      : null;
  // A disabled control has to say why it is disabled (D4). Disconnected is not
  // a case here: the pair is replaced by one "Connect wallet" primary.
  const withdrawDisabledReason = withdrawing
    ? "A withdrawal is already in flight"
    : !hasDecibelAccount
      ? "No Decibel trading account on this wallet"
      : undefined;

  const handleWithdraw = useCallback(async () => {
    if (withdrawingRef.current || withdrawalTokenRef.current) return;
    const amount = Number(withdrawAmount);
    const recipient = withdrawRecipient.trim() || owner;
    if (!signAndSubmitDecibelTransaction) {
      setActionStatus({ tone: "error", message: "Wallet signing is not available." });
      return;
    }
    if (!selectedSubaccount || !hasDecibelAccount) {
      setActionStatus({ tone: "error", message: "Select a Decibel trading account first." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionStatus({ tone: "error", message: "Enter a valid USDC amount." });
      return;
    }
    if (!isValidAptosAddress(recipient)) {
      setActionStatus({ tone: "error", message: "Enter a valid Aptos recipient address." });
      return;
    }

    const rawAmount = String(Math.floor(amount * 1_000_000));
    const token = Symbol("portfolio-withdrawal");
    const startedInContext = actionContextRef.current;
    const isCurrentWithdrawal = () =>
      withdrawalTokenRef.current === token
      && actionContextRef.current === startedInContext;
    withdrawalTokenRef.current = token;
    withdrawingRef.current = true;
    setWithdrawing(true);
    setWithdrawOpen(false);
    setActionStatus({
      tone: "pending",
      message: recipient === owner
        ? "Sign Decibel USDC withdrawal."
        : "Sign Decibel USDC withdrawal, then sign the recipient transfer.",
    });

    try {
      const withdraw = await buildAndSign(
        "/api/decibel/withdraw",
        { subaccount: selectedSubaccount, amount: rawAmount, network: decibelNetwork },
        signAndSubmitDecibelTransaction,
        isCurrentWithdrawal,
      );
      if (isCurrentWithdrawal()) {
        setActionStatus({
          tone: "pending",
          message: "Withdrawal submitted. Waiting for confirmation...",
          hash: withdraw.hash,
        });
      }
      await waitForTransactionConfirmation(withdraw.hash);
      if (!isCurrentWithdrawal()) return;

      if (recipient.toLowerCase() !== owner.toLowerCase()) {
        setActionStatus({
          tone: "pending",
          message: "Withdrawal confirmed. Sign the USDC transfer to recipient.",
          hash: withdraw.hash,
        });
        const transfer = await buildAndSign(
          "/api/decibel/transfer-usdc",
          { recipient, amount: rawAmount, network: decibelNetwork },
          signAndSubmitDecibelTransaction,
          isCurrentWithdrawal,
        );
        setActionStatus({
          tone: "pending",
          message: "Recipient transfer submitted. Waiting for confirmation...",
          hash: transfer.hash,
        });
        await waitForTransactionConfirmation(transfer.hash);
        if (!isCurrentWithdrawal()) return;
        setActionStatus({
          tone: "success",
          message: `Withdrew and transferred ${amount.toFixed(2)} USDC.`,
          hash: transfer.hash,
        });
      } else {
        setActionStatus({
          tone: "success",
          message: `Withdrew ${amount.toFixed(2)} USDC to your wallet.`,
          hash: withdraw.hash,
        });
      }
      setWithdrawAmount("");
      emitDecibelPositionsRefresh();
      void fetchAccountState();
    } catch (err) {
      if (isCurrentWithdrawal()) {
        setActionStatus({
          tone: "error",
          message: actionErrorMessage(err, "USDC withdrawal failed."),
        });
      }
    } finally {
      if (withdrawalTokenRef.current === token) {
        withdrawalTokenRef.current = null;
        withdrawingRef.current = false;
        setWithdrawing(false);
      }
    }
  }, [
    decibelNetwork,
    fetchAccountState,
    hasDecibelAccount,
    owner,
    selectedSubaccount,
    signAndSubmitDecibelTransaction,
    withdrawAmount,
    withdrawRecipient,
  ]);

  const handleClosePosition = useCallback(async (position: Position) => {
    const key = positionKey(position);
    if (closingActionTokensRef.current.has(key)) return;
    const price = position.markPrice ?? position.entryPrice;
    const size = Math.abs(position.size);
    if (!signAndSubmitDecibelTransaction || !selectedSubaccount) {
      setActionStatus({ tone: "error", message: "Connect a wallet and Decibel account first." });
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || size <= 0) {
      setActionStatus({ tone: "error", message: `No usable price for ${position.market}.` });
      return;
    }
    const token = Symbol(key);
    const startedInContext = actionContextRef.current;
    closingActionTokensRef.current.set(key, token);
    setClosingKeys((prev) => new Set(prev).add(key));
    setActionStatus({ tone: "pending", message: `Sign close order for ${position.market}.` });
    try {
      const close = await buildAndSign(
        "/api/decibel/order",
        {
          marketName: position.market,
          marketAddress: position.marketAddress ?? undefined,
          price,
          size,
          isBuy: !position.isLong,
          orderType: "market",
          reduceOnly: true,
          subaccount: selectedSubaccount,
          network: decibelNetwork,
        },
        signAndSubmitDecibelTransaction,
        () =>
          closingActionTokensRef.current.get(key) === token
          && actionContextRef.current === startedInContext,
      );
      if (actionContextRef.current === startedInContext) {
        setActionStatus({
          tone: "pending",
          message: "Close submitted. Waiting for confirmation...",
          hash: close.hash,
        });
      }
      await waitForTransactionConfirmation(close.hash);
      if (actionContextRef.current === startedInContext) {
        setActionStatus({
          tone: "success",
          message: `Close confirmed for ${position.market}.`,
          hash: close.hash,
        });
        emitDecibelPositionsRefresh();
        void fetchAccountState();
      }
    } catch (err) {
      if (actionContextRef.current === startedInContext) {
        setActionStatus({
          tone: "error",
          message: actionErrorMessage(err, `Failed to close ${position.market}.`),
        });
      }
    } finally {
      if (closingActionTokensRef.current.get(key) === token) {
        closingActionTokensRef.current.delete(key);
        setClosingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  }, [decibelNetwork, fetchAccountState, selectedSubaccount, signAndSubmitDecibelTransaction]);

  const handleCancelOrder = useCallback(async (order: OpenOrder) => {
    const orderId = String(order.orderId);
    if (cancelingActionTokensRef.current.has(orderId)) return;
    if (!signAndSubmitDecibelTransaction || !selectedSubaccount) {
      setActionStatus({ tone: "error", message: "Connect a wallet and Decibel account first." });
      return;
    }
    if (!order.marketAddress) {
      setActionStatus({ tone: "error", message: `Missing market address for order ${orderId}.` });
      return;
    }

    const token = Symbol(orderId);
    const startedInContext = actionContextRef.current;
    cancelingActionTokensRef.current.set(orderId, token);
    setCancelingOrderIds((prev) => new Set(prev).add(orderId));
    setActionStatus({ tone: "pending", message: `Sign cancel for ${order.market} order.` });
    try {
      const cancel = await buildAndSign(
        "/api/decibel/cancel-order",
        {
          subaccount: selectedSubaccount,
          marketName: order.market,
          marketAddress: order.marketAddress,
          orderId,
          network: decibelNetwork,
        },
        signAndSubmitDecibelTransaction,
        () =>
          cancelingActionTokensRef.current.get(orderId) === token
          && actionContextRef.current === startedInContext,
      );
      if (actionContextRef.current === startedInContext) {
        setActionStatus({
          tone: "pending",
          message: "Cancel submitted. Waiting for confirmation...",
          hash: cancel.hash,
        });
      }
      await waitForTransactionConfirmation(cancel.hash);
      if (actionContextRef.current === startedInContext) {
        setState((prev) => ({
          ...prev,
          openOrders: prev.openOrders.filter((item) => String(item.orderId) !== orderId),
        }));
        setActionStatus({
          tone: "success",
          message: `Canceled ${order.market} order.`,
          hash: cancel.hash,
        });
        emitDecibelPositionsRefresh();
        void fetchAccountState();
      }
    } catch (err) {
      if (actionContextRef.current === startedInContext) {
        setActionStatus({
          tone: "error",
          message: actionErrorMessage(err, `Failed to cancel order ${orderId}.`),
        });
      }
    } finally {
      if (cancelingActionTokensRef.current.get(orderId) === token) {
        cancelingActionTokensRef.current.delete(orderId);
        setCancelingOrderIds((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    }
  }, [decibelNetwork, fetchAccountState, selectedSubaccount, signAndSubmitDecibelTransaction]);

  return (
    // cash-trade-theme scopes the neon accent vars; without it the Header's
    // logo/Sign-In fall back to the near-black :root --accent and look dead.
    // PageConnectCta: disconnected, this page renders the filled "Connect
    // wallet" primary below, so the header must not render its outline copy.
    <PageConnectCta present={!connected}>
    <div className="cash-trade-theme min-h-screen bg-background text-zinc-200">
      <Header />
      {/* The shell is shared, not restated: /portfolio is the dense tier the
          trade and swap pages now also render, so the content's left edge no
          longer moves as you change tabs. */}
      <main className={PAGE_SHELL_WIDE}>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className={SECTION_TITLE}>Portfolio</h1>
            {/* The subtitle names the account you are looking at. Disconnected
                it said "Connect wallet to load Decibel account state" — the
                same request as the button beside it, so it is not rendered. */}
            {connected ? (
              <p className="mt-1 text-pretty text-xs text-muted-foreground">
                {selectedLabel} · {decibelNetwork}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {connected ? (
              <>
                <button
                  type="button"
                  onClick={() => setDepositOpen(true)}
                  className={BUTTON_PRIMARY}
                >
                  Deposit USDC
                </button>
                {/* Neutral, not a second accent fill: one primary per screen.
                    The reason lived in a title attribute, i.e. nowhere on a
                    phone; it now sits under the control it explains instead of
                    wrapping under Deposit. */}
                <div className="flex flex-col items-start">
                  <button
                    type="button"
                    onClick={() => setWithdrawOpen(true)}
                    disabled={Boolean(withdrawDisabledReason)}
                    className={BUTTON_NEUTRAL}
                  >
                    {withdrawing ? "Withdrawing…" : "Withdraw USDC"}
                  </button>
                  {withdrawDisabledReason ? (
                    <p className={STAT_NOTE}>{withdrawDisabledReason}</p>
                  ) : null}
                </div>
              </>
            ) : (
              /* Disconnected, the loudest control was "Deposit USDC" next to a
                 button explaining you need a wallet first. One primary, the
                 same one every other page uses, and the reason disappears with
                 the control it was explaining. */
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("cash:open-wallet-selector"))}
                className={BUTTON_PRIMARY}
              >
                Connect wallet
              </button>
            )}
          </div>
        </div>

        {/* Disconnected, everything below this line — four em-dash tiles, an
            em-dash hero, a rewards promise and a twelve-column table of
            nothing — asked the same question the button above already asks.
            One prompt is rendered instead, and it says what lands here. */}
        {connected ? (
        <>

        {/* Two columns on a phone: four stacked tiles were 390px of scrolling
            before the page's first real content. */}
        <section className={cn(STAT_GRID_PANEL, "grid-cols-2 md:grid-cols-4")}>
          {[
            {
              label: "Portfolio value",
              value: formatUsd(overview?.equity),
              raw: overview?.equity,
              pending: accountPending,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
            {
              label: "PnL",
              value: formatUsd(totalPnl, true),
              raw: totalPnl,
              pending: accountPending,
              tone: signTone(totalPnl),
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" },
            },
            {
              label: "30-day volume",
              value: formatVolume(overview?.volume30d),
              raw: overview?.volume30d,
              pending: accountPending,
              format: { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 },
            },
            {
              label: "Total fees paid",
              // The "…" this rendered while loading was a third width for one
              // slot: ellipsis, then em dash, then a number.
              value: feeSummaryError || !feeSummary
                ? "—"
                : `${formatUsd(feeSummary.totalFeesPaidUsd)}${feeSummary.truncated ? "+" : ""}`,
              raw: feeSummary && !feeSummary.truncated ? feeSummary.totalFeesPaidUsd : undefined,
              pending: feesPending,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
          ].map((item) => (
            <div key={item.label} className={STAT_TILE}>
              <p className={STAT_LABEL}>{item.label}</p>
              {item.pending ? (
                /* mt-2 + h-8 is exactly the box STAT_VALUE occupies, so the
                   tile holds its height when the number lands. */
                <Skeleton className="mt-2 h-8 w-[7ch]" />
              ) : (
                <p className={cn(STAT_VALUE, "tone" in item && item.tone)}>
                  {"raw" in item && item.raw != null ? (
                    <NumberTicker
                      value={item.raw}
                      fallback={item.value}
                      format={"format" in item ? item.format as Intl.NumberFormatOptions : undefined}
                    />
                  ) : (
                    item.value
                  )}
                </p>
              )}
            </div>
          ))}
        </section>

        <CashRewardsPanel
          connected={connected}
          network={decibelNetwork}
          owner={owner}
          subaccount={selectedSubaccount}
        />

        <section className={cn(SECTION_GAP, "grid gap-8 lg:grid-cols-[310px_minmax(0,1fr)]")}>
          <aside>
            <h2 className={SECTION_TITLE}>Overview</h2>
            {/* Vault allocation, Sharpe ratio, Max drawdown, Weekly win rate
                and a "Trading portfolio" row that restated Portfolio value all
                lived here as permanent em dashes with no reader behind them. */}
            <div className="mt-4">
              <OverviewRow label="Open position return" value={formatPct(openPositionReturn)} tone={signTone(openPositionReturn)} pending={accountPending} />
              <OverviewRow label="30-day volume" value={formatVolume(overview?.volume30d)} pending={accountPending} />
              <OverviewRow
                label="Total fees paid"
                pending={feesPending}
                value={
                  feeSummaryError || !feeSummary
                    ? "—"
                    : `${formatUsd(feeSummary.totalFeesPaidUsd)}${feeSummary.truncated ? "+" : ""}`
                }
              />
              <OverviewRow label="Realized PnL" value={formatUsd(overview?.realizedPnl, true)} tone={signTone(overview?.realizedPnl)} pending={accountPending} />
              <OverviewRow label="Available to withdraw" value={overview?.equity ? `${((overview.crossWithdrawable / overview.equity) * 100).toFixed(2)}%` : "—"} pending={accountPending} />
              <OverviewRow label="Avg. leverage" value={overview?.leverage == null ? "—" : `${overview.leverage.toFixed(2)}x`} pending={accountPending} />
              <OverviewRow label="Margin used" value={overview ? `${(overview.marginRatio * 100).toFixed(2)}%` : "—"} pending={accountPending} />
              <OverviewRow label="Total position" value={formatUsd(overview?.totalNotional)} pending={accountPending} />
            </div>
          </aside>

          <section className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {/* "PnL" everywhere: this heading said "Profit/loss" while the
                    stat tile, the metric switch and the tooltip under it all
                    said PnL — three names for one number. */}
                <h2 className={SECTION_TITLE}>
                  {chartMetric === "pnl" ? "PnL" : "Portfolio value"}
                </h2>
                {accountPending ? (
                  <Skeleton className="mt-2 h-8 w-40" />
                ) : (
                  <NumberTicker
                    value={chartMetric === "pnl" ? totalPnl : overview?.equity}
                    fallback="—"
                    format={{
                      style: "currency",
                      currency: "USD",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                      signDisplay: chartMetric === "pnl" ? "always" : "auto",
                    }}
                    className="mt-2 block font-mono text-2xl font-semibold text-foreground"
                  />
                )}
              </div>
              {chartControlsVisible ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className={SEGMENTED} role="group" aria-label="Chart metric">
                  {[
                    ["pnl", "PnL"],
                    ["portfolio", "Portfolio value"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChartMetric(value as "pnl" | "portfolio")}
                      aria-pressed={chartMetric === value}
                      className={cn(SEGMENTED_ITEM, chartMetric === value && SEGMENTED_ITEM_ACTIVE)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={SEGMENTED} role="group" aria-label="Chart range">
                  {PORTFOLIO_CHART_RANGES.map((range) => (
                    <button
                      key={range.value}
                      type="button"
                      onClick={() => setChartRange(range.value)}
                      aria-pressed={chartRange === range.value}
                      className={cn(SEGMENTED_ITEM, chartRange === range.value && SEGMENTED_ITEM_ACTIVE)}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>
              ) : null}
            </div>
            {/* The 360px well is reserved for the whole life of the fetch, so
                the chart drops in without shifting the page. It only exists on
                the connected branch: reserving a viewport for one sentence is
                what made this page read as half empty. */}
            <div className="mt-6 h-[360px] min-h-[260px]">
              {chartSeriesRendered ? (
                <AreaChart
                  data={chartData}
                  xDataKey="date"
                  aspectRatio="auto"
                  className="!h-full"
                  margin={{ top: 12, right: 8, bottom: 30, left: 8 }}
                  animationDuration={200}
                  touchAction="pan-y"
                >
                  <Grid
                    horizontal
                    fadeHorizontal
                    numTicksRows={4}
                    stroke="rgba(255,255,255,0.07)"
                    strokeDasharray="2,5"
                  />
                  <Area
                    dataKey="value"
                    fill={chartColor}
                    fillOpacity={0.16}
                    stroke={chartColor}
                    strokeWidth={2}
                    gradientToOpacity={0}
                    curve={curveLinear}
                    animate={false}
                  />
                  <ChartTooltip
                    showCrosshair
                    showDots
                    rows={(point) => [
                      {
                        color: chartColor,
                        label: chartMetric === "pnl" ? "PnL" : "Portfolio value",
                        value: formatUsd(Number(point.value), chartMetric === "pnl"),
                      },
                    ]}
                  />
                  <XAxis numTicks={5} />
                </AreaChart>
              ) : historyLoading ? (
                /* Was the sentence "Loading 7d portfolio history…" centred in
                    an empty 360px frame; the skeleton is the shape of the
                    thing being fetched. */
                <Skeleton className="h-full w-full rounded-[var(--radius)]" aria-label={`Loading ${chartRange} portfolio history`} role="status" />
              ) : (
                <div
                  role="status"
                  className="flex h-full flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-card-border px-6 py-8 text-center"
                >
                  <span className="text-[13px] text-foreground">
                    {!selectedSubaccount
                      ? "Select a Decibel account to load portfolio history"
                      : historyError || `No ${chartRange} portfolio history was returned`}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Current equity and PnL above are live; cash.trading does not fabricate missing history.
                  </span>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className={cn(SECTION_GAP, PANEL)}>
          <div
            role="tablist"
            aria-label="Account detail"
            className="flex items-center gap-1 overflow-x-auto border-b border-card-border px-2"
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${tabPanelId}-${tab.replace(/\s+/g, "-").toLowerCase()}`}
                aria-selected={activeTab === tab}
                aria-controls={tabPanelId}
                onClick={() => setActiveTab(tab)}
                className={cn(TAB, activeTab === tab && TAB_ACTIVE)}
              >
                {tab}{tab === "Positions" && positions.length > 0 ? ` (${positions.length})` : ""}
              </button>
            ))}
          </div>

          <div
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`${tabPanelId}-${activeTab.replace(/\s+/g, "-").toLowerCase()}`}
          >
          {activeTab === "Balances" ? (
            <div className="overflow-x-auto">
              <table className={cn(TABLE, "min-w-[680px]")}>
                <caption className="sr-only">Decibel collateral balances</caption>
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th scope="col">Coin</th>
                    <th scope="col">Total balance</th>
                    <th scope="col">Available balance</th>
                    <th scope="col">USD value</th>
                    <th scope="col">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={TABLE_ROW}>
                    <td>USDC</td>
                    {accountPending ? (
                      <>
                        <td><Skeleton className="h-[19px] w-20" /></td>
                        <td><Skeleton className="h-[19px] w-20" /></td>
                        <td><Skeleton className="h-[19px] w-20" /></td>
                        <td><Skeleton className="h-[19px] w-16" /></td>
                      </>
                    ) : (
                      <>
                        <td>{formatUsd(overview?.collateral)}</td>
                        <td>{formatUsd(overview?.crossWithdrawable)}</td>
                        <td>{formatUsd(overview?.equity)}</td>
                        <td className={signTone(totalPnl)}>{formatUsd(totalPnl, true)}</td>
                      </>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : activeTab === "Open orders" ? (
            <>
            <div className="md:hidden">
              {accountPending ? (
                /* "No open orders" was rendered while the fetch was still in
                   flight — an answer the page did not have yet. */
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className={CARD_ROW}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Skeleton className="h-[19px] w-24" />
                        <Skeleton className="mt-1 h-4 w-16" />
                      </div>
                      <Skeleton className="h-5 w-12" />
                    </div>
                    <div className={CARD_ROW_GRID}>
                      <Skeleton className="h-8 w-24" />
                      <Skeleton className="ml-auto h-8 w-20" />
                    </div>
                  </div>
                ))
              ) : openOrders.length === 0 ? (
                <div className={TABLE_EMPTY}>No open orders</div>
              ) : openOrders.map((order) => {
                const orderId = String(order.orderId);
                const canCancel = Boolean(order.marketAddress && !cancelingOrderIds.has(orderId));
                return (
                <div key={orderId} className={CARD_ROW}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{order.market}</div>
                      <div className={cn("mt-1 text-[11px] font-semibold uppercase tracking-wide", order.isBuy ? "text-success" : "text-danger")}>
                        {order.isBuy ? "Buy" : "Sell"} · {order.status ?? "Open"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancelOrder(order)}
                      disabled={!canCancel}
                      title={order.marketAddress ? undefined : "This order has no market address to cancel against"}
                      className={ROW_ACTION}
                    >
                      {cancelingOrderIds.has(orderId) ? "Canceling" : "Cancel"}
                    </button>
                  </div>
                  <div className={CARD_ROW_GRID}>
                    <div>
                      <div className={CARD_ROW_LABEL}>Remaining / original</div>
                      <div className={CARD_ROW_VALUE}>
                        {formatNumber(order.remainingSize)} / {formatNumber(order.origSize)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={CARD_ROW_LABEL}>Price</div>
                      <div className={CARD_ROW_VALUE}>
                        {formatPrice(order.price)}
                      </div>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className={cn(TABLE, "min-w-[820px]")}>
                <caption className="sr-only">Open Decibel orders</caption>
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th scope="col">Market</th>
                    <th scope="col">Side</th>
                    <th scope="col">Remaining</th>
                    <th scope="col">Original</th>
                    <th scope="col">Price</th>
                    <th scope="col">Status</th>
                    <th scope="col">Order ID</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {accountPending ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <tr key={index} className={TABLE_ROW}>
                        {["w-24", "w-10", "w-14", "w-14", "w-20", "w-12", "w-16", "w-12"].map((width, cell) => (
                          <td key={cell}><Skeleton className={cn("h-[19px]", width)} /></td>
                        ))}
                      </tr>
                    ))
                  ) : openOrders.length === 0 ? (
                    <tr><td colSpan={8} className={TABLE_EMPTY}>No open orders</td></tr>
                  ) : openOrders.map((order) => {
                    const orderId = String(order.orderId);
                    const canCancel = Boolean(order.marketAddress && !cancelingOrderIds.has(orderId));
                    return (
                    <tr key={orderId} className={TABLE_ROW}>
                      <td>{order.market}</td>
                      <td className={order.isBuy ? "text-success" : "text-danger"}>{order.isBuy ? "Buy" : "Sell"}</td>
                      <td>{formatNumber(order.remainingSize)}</td>
                      <td>{formatNumber(order.origSize)}</td>
                      <td>{formatPrice(order.price)}</td>
                      <td>{order.status ?? "Open"}</td>
                      <td className="font-mono text-muted-foreground">{orderId.slice(-8)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleCancelOrder(order)}
                          disabled={!canCancel}
                          title={order.marketAddress ? undefined : "This order has no market address to cancel against"}
                          className={ROW_ACTION}
                        >
                          {cancelingOrderIds.has(orderId) ? "Canceling" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : activeTab === "Positions" ? (
            <>
            <div className="md:hidden">
              {accountPending ? (
                /* The loaded row's own shape: a title line over the same
                   two-column block, so the list does not grow under the thumb
                   when the positions land. */
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className={CARD_ROW}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Skeleton className="h-[19px] w-24" />
                        <Skeleton className="mt-1 h-4 w-12" />
                      </div>
                      <Skeleton className="h-5 w-12" />
                    </div>
                    {/* Eight cells, the count a loaded position renders, so the
                        list does not grow under the thumb on arrival. */}
                    <div className={CARD_ROW_GRID}>
                      {Array.from({ length: 8 }).map((__, cell) => (
                        <Skeleton key={cell} className={cn("h-8", cell % 2 ? "ml-auto w-20" : "w-24")} />
                      ))}
                    </div>
                  </div>
                ))
              ) : positions.length === 0 ? (
                <div className={TABLE_EMPTY}>No open positions</div>
              ) : positions.map((position) => {
                const key = positionKey(position);
                const pnl = position.estimatedPnl;
                const pnlPct = pnl != null && position.marginUsed > 0 ? (pnl / position.marginUsed) * 100 : null;
                return (
                  <div key={key} className={CARD_ROW}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">
                          {position.market.replace("/USD", "")} {position.leverage.toFixed(0)}x
                        </div>
                        <div
                          className={cn(
                            "mt-1 text-[11px] font-semibold uppercase tracking-wide",
                            position.isLong ? "text-success" : "text-danger",
                          )}
                        >
                          {position.isLong ? "Long" : "Short"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleClosePosition(position)}
                        disabled={closingKeys.has(key)}
                        className={ROW_ACTION}
                      >
                        {closingKeys.has(key) ? "Closing" : "Close"}
                      </button>
                    </div>

                    <div className={CARD_ROW_GRID}>
                      <div>
                        <div className={CARD_ROW_LABEL}>Size</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatNumber(Math.abs(position.size))} {position.market.split("/")[0]}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={CARD_ROW_LABEL}>Value</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatUsd(position.value)}
                        </div>
                      </div>
                      <div>
                        <div className={CARD_ROW_LABEL}>Entry / mark</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatPrice(position.entryPrice)} / {formatPrice(position.markPrice)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={CARD_ROW_LABEL}>Est. PnL</div>
                        <div className={cn(CARD_ROW_VALUE, signTone(pnl))}>
                          {formatUsd(pnl, true)}
                          {pnlPct !== null && (
                            <span className="ml-1 text-muted-foreground">
                              ({pnlPct >= 0 ? "+" : ""}
                              {pnlPct.toFixed(1)}%)
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className={CARD_ROW_LABEL}>Est. liq. price</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatPrice(position.estimatedLiquidationPrice)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={CARD_ROW_LABEL}>Margin / funding</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatUsd(position.marginUsed)}
                          <span className={cn("ml-2", signTone(position.unrealizedFunding))}>
                            {formatUsd(position.unrealizedFunding, true)}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className={CARD_ROW_LABEL}>Take profit / stop loss</div>
                        <div className={CARD_ROW_VALUE}>
                          {formatPrice(position.tpTriggerPrice)} / {formatPrice(position.slTriggerPrice)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className={cn(TABLE, "min-w-[1160px]")}>
                <caption className="sr-only">Open Decibel positions</caption>
                <thead>
                  <tr className={TABLE_HEAD}>
                    <th scope="col">Coin/side</th>
                    <th scope="col">Size</th>
                    <th scope="col">Value</th>
                    <th scope="col">Entry price</th>
                    <th scope="col">Mark price</th>
                    <th scope="col">Est. PnL</th>
                    <th scope="col">Est. liq. price</th>
                    <th scope="col">Margin</th>
                    <th scope="col">Funding</th>
                    <th scope="col">TP / SL</th>
                    <th scope="col">Close</th>
                  </tr>
                </thead>
                <tbody>
                  {accountPending ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <tr key={index} className={TABLE_ROW}>
                        {["w-28", "w-16", "w-16", "w-20", "w-20", "w-16", "w-20", "w-24", "w-14", "w-24", "w-12"].map((width, cell) => (
                          <td key={cell}><Skeleton className={cn("h-[19px]", width)} /></td>
                        ))}
                      </tr>
                    ))
                  ) : positions.length === 0 ? (
                    <tr><td colSpan={11} className={TABLE_EMPTY}>No open positions</td></tr>
                  ) : positions.map((position) => {
                    const key = positionKey(position);
                    const pnl = position.estimatedPnl;
                    return (
                      <tr key={key} className={TABLE_ROW}>
                        <td>
                          <span>{position.market.replace("/USD", "")} {position.leverage.toFixed(0)}x</span>{" "}
                          <span className={cn("rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[11px]", position.isLong ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
                            {position.isLong ? "Long" : "Short"}
                          </span>
                        </td>
                        <td>{formatNumber(Math.abs(position.size))} {position.market.split("/")[0]}</td>
                        <td>{formatUsd(position.value)}</td>
                        <td>{formatPrice(position.entryPrice)}</td>
                        <td>{formatPrice(position.markPrice)}</td>
                        <td className={signTone(pnl)}>{formatUsd(pnl, true)}</td>
                        <td>{formatPrice(position.estimatedLiquidationPrice)}</td>
                        <td>{formatUsd(position.marginUsed)} {position.isIsolated ? "(Iso)" : "(Cross)"}</td>
                        <td className={signTone(position.unrealizedFunding)}>{formatUsd(position.unrealizedFunding, true)}</td>
                        {/* Was a hard-coded "-- / --" while the real trigger
                            prices were already on the position. */}
                        <td>{formatPrice(position.tpTriggerPrice)} / {formatPrice(position.slTriggerPrice)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => void handleClosePosition(position)}
                            disabled={closingKeys.has(key)}
                            className={ROW_ACTION}
                          >
                            {closingKeys.has(key) ? "Closing" : "Close"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : null}
          </div>
        </section>

        {/* The disconnected line here ("Connect wallet to load your Decibel
            portfolio.") was a fifth request to connect, at the bottom of the
            page, where nothing can act on it. */}
        {(loading || error || actionStatus || (connected && !hasDecibelAccount && !isLoadingSubaccounts)) && (
          <div className={cn(SECTION_GAP, "text-xs")} role="status" aria-live="polite">
            {loading && <span className="text-muted-foreground">Updating…</span>}
            {error && <span className="text-danger">{error}</span>}
            {connected && !hasDecibelAccount && !isLoadingSubaccounts && (
              <span className="text-muted-foreground">
                {lookupError || lookupIncomplete
                  ? `Decibel account lookup is incomplete${lookupError ? `: ${lookupError}` : "."}`
                  : "No Decibel trading account detected."}
              </span>
            )}
            {actionStatus && (
              <div className={cn(
                "mt-2 rounded-[var(--radius-sm)] px-3 py-2",
                actionStatus.tone === "error" ? "bg-danger/10 text-danger" :
                  actionStatus.tone === "success" ? "bg-success/10 text-success" :
                    "bg-card text-muted-foreground",
              )}>
                {actionStatus.message}
                {/* The hash was carried through every action and never shown. */}
                {actionStatus.hash && (
                  <a
                    href={explorerTxUrl(actionStatus.hash, decibelNetwork)}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                  >
                    View transaction
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        </>
        ) : (
          /* The one thing a disconnected visitor sees below the header: what
             this page is for. The action is the "Connect wallet" primary
             above — repeating the ask here is what turned one question into
             five. */
          <p className="rounded-[var(--radius)] border border-dashed border-card-border px-6 py-10 text-center text-[13px] text-muted-foreground">
            Live equity, PnL, positions and orders load here once you connect.
          </p>
        )}
      </main>

      <WalletAccountModal open={depositOpen} onClose={() => setDepositOpen(false)} />
      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent className="rounded-[var(--radius)] border-card-border bg-background-secondary text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-[13px] font-semibold">Withdraw USDC</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty text-[13px] text-muted-foreground">
              Decibel withdraws collateral to your wallet first. If the recipient differs, you will sign a second USDC transfer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <label className="block">
              <span className={INPUT_LABEL}>Amount</span>
              <input
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                disabled={withdrawing}
                inputMode="decimal"
                placeholder="0.00"
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={INPUT_LABEL}>Recipient Aptos address</span>
              <input
                value={withdrawRecipient}
                onChange={(event) => setWithdrawRecipient(event.target.value)}
                disabled={withdrawing}
                placeholder={owner || "0x…"}
                className={INPUT}
              />
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[var(--radius-sm)] border-card-border bg-transparent text-foreground hover:border-border-strong hover:bg-card">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={withdrawing}
              onClick={(event) => {
                event.preventDefault();
                void handleWithdraw();
              }}
              className="rounded-[var(--radius-sm)] bg-accent text-accent-foreground hover:brightness-95"
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PageConnectCta>
  );
}
