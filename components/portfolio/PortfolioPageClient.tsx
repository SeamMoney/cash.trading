"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { curveLinear } from "@visx/curve";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip";
import { XAxis } from "@/components/charts/x-axis";
import { Header } from "@/components/layout/Header";
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
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { isValidAptosAddress } from "@/lib/decibel";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/ui/number-ticker";
import { CashRewardsPanel } from "@/components/portfolio/CashRewardsPanel";

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

const TABS = [
  "Balances",
  "Collateral",
  "Positions",
  "Open Orders",
  "TWAPs",
  "TWAP History",
  "Trade History",
  "Funding History",
  "Order History",
  "Transfers",
] as const;

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

function OverviewRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1 text-[13px]">
      <span className="text-zinc-500 underline decoration-dashed underline-offset-4">{label}</span>
      <span className={cn("font-mono tabular-nums text-zinc-300", tone)}>{value}</span>
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
  const [chartMetric, setChartMetric] = useState<"pnl" | "portfolio">("pnl");
  const [chartRange, setChartRange] = useState<PortfolioChartRange>("30d");
  const [historyPoints, setHistoryPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [closingKeys, setClosingKeys] = useState<Set<string>>(() => new Set());
  const [cancelingOrderIds, setCancelingOrderIds] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
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
      ? "#e8774f"
      : "#75ff47";
  const chartData = useMemo(
    () => historyPoints as unknown as Record<string, unknown>[],
    [historyPoints],
  );

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

  useEffect(() => {
    if (!connected || !selectedSubaccount) return;
    const interval = setInterval(() => void fetchAccountState(), 4_000);
    return () => clearInterval(interval);
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
  const openPositionReturn =
    totalPnl != null && overview?.totalMargin && overview.totalMargin > 0
      ? (totalPnl / overview.totalMargin) * 100
      : null;

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
    <div className="cash-trade-theme min-h-screen bg-black text-zinc-200">
      <Header />
      <main className="mx-auto max-w-[1536px] px-4 py-8 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-balance text-[18px] font-semibold text-zinc-200">Portfolio</h1>
            <p className="mt-1 text-pretty text-[12px] text-zinc-600">
              {connected ? `${selectedLabel} · ${decibelNetwork}` : "Connect wallet to load Decibel account state"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            disabled={!connected || !hasDecibelAccount || withdrawing}
            className="rounded-[4px] bg-zinc-200 px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            {withdrawing ? "Withdrawing..." : "Withdraw USDC"}
          </button>
        </div>

        <section className="grid gap-px overflow-hidden rounded-[4px] border border-[#1a1a1a] bg-[#1a1a1a] md:grid-cols-4">
          {[
            {
              label: "Portfolio Value",
              value: formatUsd(overview?.equity),
              raw: overview?.equity,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
            {
              label: "PnL",
              value: formatUsd(totalPnl, true),
              raw: totalPnl,
              tone: totalPnl == null ? "text-zinc-500" : totalPnl >= 0 ? "text-green-400" : "text-[#e8774f]",
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" },
            },
            {
              label: "30 Day Volume",
              value: formatVolume(overview?.volume30d),
              raw: overview?.volume30d,
              format: { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 },
            },
            { label: "Fees (Taker / Maker)", value: "0.0340% / 0.0110%" },
          ].map((item) => (
            <div key={item.label} className="bg-[#050505] px-6 py-5">
              <p className="text-[13px] text-zinc-500">{item.label}</p>
              <p className={cn("mt-2 font-mono text-[26px] font-semibold tabular-nums text-zinc-200", "tone" in item && item.tone)}>
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
            </div>
          ))}
        </section>

        <CashRewardsPanel
          connected={connected}
          network={decibelNetwork}
          owner={owner}
          subaccount={selectedSubaccount}
        />

        <section className="mt-10 grid gap-10 lg:grid-cols-[310px_minmax(0,1fr)]">
          <aside>
            <h2 className="text-balance text-[18px] font-semibold text-zinc-200">Overview</h2>
            <div className="mt-6">
              <OverviewRow label="Open Position Return" value={formatPct(openPositionReturn)} tone={openPositionReturn != null && openPositionReturn >= 0 ? "text-green-400" : "text-[#e8774f]"} />
              <OverviewRow label="30d Volume" value={formatVolume(overview?.volume30d)} />
              <OverviewRow label="Realized PnL" value={formatUsd(overview?.realizedPnl, true)} tone={(overview?.realizedPnl ?? 0) >= 0 ? "text-green-400" : "text-[#e8774f]"} />
              <OverviewRow label="Trading Portfolio" value={formatUsd(overview?.equity)} tone="text-green-400" />
              <OverviewRow label="Vault Allocation" value="—" />
              <OverviewRow label="Sharpe Ratio" value="—" />
              <OverviewRow label="Max Drawdown" value="—" />
              <OverviewRow label="Weekly Win Rate (12w)" value="—" />
              <OverviewRow label="Withdrawable Share" value={overview?.equity ? `${((overview.crossWithdrawable / overview.equity) * 100).toFixed(4)}%` : "—"} />
              <OverviewRow label="Avg. Leverage" value={overview?.leverage == null ? "—" : `${overview.leverage.toFixed(2)}x`} />
              <OverviewRow label="Cross-margin Ratio" value={overview ? `${(overview.marginRatio * 100).toFixed(2)}%` : "—"} tone="text-green-400" />
              <OverviewRow label="Cross-account Position" value={formatUsd(overview?.totalNotional)} />
            </div>
          </aside>

          <section className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-balance text-[18px] font-semibold text-zinc-200">
                  {chartMetric === "pnl" ? "Profit/Loss" : "Portfolio Value"}
                </h2>
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
                  className="mt-3 block font-mono text-[28px] font-semibold text-zinc-200"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
                <div className="rounded-[4px] bg-[#1d1d1d] p-1">
                  {[
                    ["pnl", "PnL"],
                    ["portfolio", "Portfolio Val."],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChartMetric(value as "pnl" | "portfolio")}
                      aria-pressed={chartMetric === value}
                      className={cn(
                        "rounded-[3px] px-2 py-1 text-zinc-500",
                        chartMetric === value && "bg-[#2a2a2a] text-zinc-200",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="rounded-[4px] bg-[#1d1d1d] p-1">
                  {PORTFOLIO_CHART_RANGES.map((range) => (
                    <button
                      key={range.value}
                      type="button"
                      onClick={() => setChartRange(range.value)}
                      aria-pressed={chartRange === range.value}
                      className={cn(
                        "rounded-[3px] px-2 py-1 text-zinc-500",
                        chartRange === range.value && "bg-[#2a2a2a] text-zinc-200",
                      )}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 h-[360px] min-h-[260px]">
              {historyPoints.length >= 2 ? (
                <AreaChart
                  data={chartData}
                  xDataKey="date"
                  aspectRatio="auto"
                  className="!h-full"
                  margin={{ top: 12, right: 8, bottom: 30, left: 8 }}
                  animationDuration={350}
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
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-[#2a2a2a] px-6 text-center">
                  <span className="text-[13px] text-zinc-500">
                    {!connected
                      ? "Connect a wallet to see your Decibel portfolio"
                      : !selectedSubaccount
                        ? "Select a Decibel account to load portfolio history"
                        : historyLoading
                          ? `Loading ${chartRange} portfolio history...`
                          : historyError || `No ${chartRange} portfolio history was returned`}
                  </span>
                  <span className="text-[11px] text-zinc-700">
                    {connected
                      ? "Current equity and PnL above are live; cash.trading does not fabricate missing history."
                      : "Live equity, PnL, positions, and orders will load after connection."}
                  </span>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className="mt-8 overflow-hidden rounded-[4px] border border-[#242424] bg-[#141414]">
          <div className="flex items-center justify-between gap-4 overflow-x-auto border-b border-[#242424] px-3">
            <div className="flex min-w-max items-center gap-4">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "py-3 text-[13px] text-zinc-500 transition-colors hover:text-zinc-300",
                    activeTab === tab && "border-b-2 border-zinc-200 text-zinc-200",
                  )}
                >
                  {tab}{tab === "Positions" && positions.length > 0 ? ` (${positions.length})` : ""}
                </button>
              ))}
            </div>
            <span className="shrink-0 text-[12px] text-zinc-500">All</span>
          </div>

          {activeTab === "Balances" || activeTab === "Collateral" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-[13px]">
                <thead className="text-zinc-500">
                  <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                    <th>Coin</th>
                    <th>Total Balance</th>
                    <th>Available Balance</th>
                    <th>USD Value</th>
                    <th>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[#242424] text-zinc-300 [&>td]:px-4 [&>td]:py-4">
                    <td>USDC</td>
                    <td>{formatUsd(overview?.collateral)}</td>
                    <td>{formatUsd(overview?.crossWithdrawable)}</td>
                    <td>{formatUsd(overview?.equity)}</td>
                    <td className={totalPnl == null ? "text-zinc-500" : totalPnl >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(totalPnl, true)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : activeTab === "Open Orders" ? (
            <>
            <div className="md:hidden">
              {openOrders.length === 0 ? (
                <div className="px-4 py-12 text-center text-zinc-600">No open orders</div>
              ) : openOrders.map((order) => {
                const orderId = String(order.orderId);
                const canCancel = Boolean(order.marketAddress && !cancelingOrderIds.has(orderId));
                return (
                <div key={orderId} className="border-t border-[#242424] px-4 py-4 text-[13px] text-zinc-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-100">{order.market}</div>
                      <div className={cn("mt-1 text-[11px] font-semibold uppercase", order.isBuy ? "text-green-400" : "text-[#e8774f]")}>
                        {order.isBuy ? "Buy" : "Sell"} · {order.status ?? "Open"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancelOrder(order)}
                      disabled={!canCancel}
                      className="shrink-0 underline decoration-zinc-500 underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
                    >
                      {cancelingOrderIds.has(orderId) ? "Canceling" : "Cancel"}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                    <div>
                      <div className="text-zinc-600">Remaining / Original</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {formatNumber(order.remainingSize)} / {formatNumber(order.origSize)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-600">Price</div>
                      <div className="mt-0.5 font-mono tabular-nums">
                        {formatPrice(order.price)}
                      </div>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead className="text-zinc-500">
                  <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                    <th>Market</th>
                    <th>Side</th>
                    <th>Remaining</th>
                    <th>Original</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Order ID</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-600">No open orders</td></tr>
                  ) : openOrders.map((order) => {
                    const orderId = String(order.orderId);
                    const canCancel = Boolean(order.marketAddress && !cancelingOrderIds.has(orderId));
                    return (
                    <tr key={orderId} className="border-t border-[#242424] text-zinc-300 [&>td]:px-4 [&>td]:py-4">
                      <td>{order.market}</td>
                      <td className={order.isBuy ? "text-green-400" : "text-[#e8774f]"}>{order.isBuy ? "Buy" : "Sell"}</td>
                      <td>{formatNumber(order.remainingSize)}</td>
                      <td>{formatNumber(order.origSize)}</td>
                      <td>{formatPrice(order.price)}</td>
                      <td>{order.status ?? "Open"}</td>
                      <td className="font-mono text-zinc-500">{orderId.slice(-8)}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleCancelOrder(order)}
                          disabled={!canCancel}
                          className="underline decoration-zinc-500 underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
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
              {positions.length === 0 ? (
                <div className="px-4 py-12 text-center text-zinc-600">No open positions</div>
              ) : positions.map((position) => {
                const key = positionKey(position);
                const pnl = position.estimatedPnl;
                const pnlPct = pnl != null && position.marginUsed > 0 ? (pnl / position.marginUsed) * 100 : null;
                return (
                  <div key={key} className="border-t border-[#242424] px-4 py-4 text-[13px] text-zinc-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-zinc-100">
                          {position.market.replace("/USD", "")} {position.leverage.toFixed(0)}x
                        </div>
                        <div
                          className={cn(
                            "mt-1 text-[11px] font-semibold uppercase",
                            position.isLong ? "text-green-400" : "text-[#e8774f]",
                          )}
                        >
                          {position.isLong ? "Long" : "Short"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleClosePosition(position)}
                        disabled={closingKeys.has(key)}
                        className="shrink-0 underline decoration-zinc-500 underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
                      >
                        {closingKeys.has(key) ? "Closing" : "Close"}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
                      <div>
                        <div className="text-zinc-600">Size</div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          {formatNumber(Math.abs(position.size))} {position.market.split("/")[0]}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Value</div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          {formatUsd(position.value)}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-600">Entry / Mark</div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          {formatPrice(position.entryPrice)} / {formatPrice(position.markPrice)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Est. PnL</div>
                        <div className={cn("mt-0.5 font-mono tabular-nums", pnl == null ? "text-zinc-500" : pnl >= 0 ? "text-green-400" : "text-[#e8774f]")}>
                          {formatUsd(pnl, true)}
                          {pnlPct !== null && (
                            <span className="ml-1 text-zinc-500">
                              ({pnlPct >= 0 ? "+" : ""}
                              {pnlPct.toFixed(1)}%)
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-600">Liq.</div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          {formatPrice(position.estimatedLiquidationPrice)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Margin / Funding</div>
                        <div className="mt-0.5 font-mono tabular-nums">
                          {formatUsd(position.marginUsed)}
                          <span className={cn("ml-2", position.unrealizedFunding == null ? "text-zinc-500" : position.unrealizedFunding >= 0 ? "text-green-400" : "text-[#e8774f]")}>
                            {formatUsd(position.unrealizedFunding, true)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1160px] text-left text-[13px]">
                <thead className="text-zinc-500">
                  <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                    <th>Coin/Side</th>
                    <th>Size</th>
                    <th>Value</th>
                    <th>Entry Price</th>
                    <th>Mark Price</th>
                    <th>Est. PnL</th>
                    <th>Est. Liq. Price</th>
                    <th>Margin</th>
                    <th>Funding</th>
                    <th>TP/SL</th>
                    <th>Close</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-12 text-center text-zinc-600">No open positions</td></tr>
                  ) : positions.map((position) => {
                    const key = positionKey(position);
                    const pnl = position.estimatedPnl;
                    return (
                      <tr key={key} className="border-t border-[#242424] text-zinc-300 [&>td]:px-4 [&>td]:py-4">
                        <td>
                          <span>{position.market.replace("/USD", "")} {position.leverage.toFixed(0)}x</span>{" "}
                          <span className={cn("rounded-[4px] px-1.5 py-0.5 text-[11px]", position.isLong ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-300")}>
                            {position.isLong ? "Long" : "Short"}
                          </span>
                        </td>
                        <td>{formatNumber(Math.abs(position.size))} {position.market.split("/")[0]}</td>
                        <td>{formatUsd(position.value)}</td>
                        <td>{formatPrice(position.entryPrice)}</td>
                        <td>{formatPrice(position.markPrice)}</td>
                        <td className={pnl == null ? "text-zinc-500" : pnl >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(pnl, true)}</td>
                        <td>{formatPrice(position.estimatedLiquidationPrice)}</td>
                        <td>{formatUsd(position.marginUsed)} {position.isIsolated ? "(Iso)" : "(Cross)"}</td>
                        <td className={position.unrealizedFunding == null ? "text-zinc-500" : position.unrealizedFunding >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(position.unrealizedFunding, true)}</td>
                        <td>-- / --</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => void handleClosePosition(position)}
                            disabled={closingKeys.has(key)}
                            className="underline decoration-zinc-500 underline-offset-4 hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700"
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
          ) : (
            <div className="px-4 py-12 text-center text-[13px] text-zinc-600">
              {activeTab} will appear here when Decibel returns rows for this account.
            </div>
          )}
        </section>

        {(loading || error || actionStatus || !connected || (connected && !hasDecibelAccount && !isLoadingSubaccounts)) && (
          <div className="mt-4 text-[12px]">
            {loading && <span className="text-zinc-600">updating...</span>}
            {error && <span className="text-[#e8774f]">{error}</span>}
            {!connected && <span className="text-zinc-600">Connect wallet to load your Decibel portfolio.</span>}
            {connected && !hasDecibelAccount && !isLoadingSubaccounts && (
              <span className="text-zinc-600">
                {lookupError || lookupIncomplete
                  ? `Decibel account lookup is incomplete${lookupError ? `: ${lookupError}` : "."}`
                  : "No Decibel trading account detected."}
              </span>
            )}
            {actionStatus && (
              <div className={cn(
                "mt-2 rounded-[4px] px-3 py-2",
                actionStatus.tone === "error" ? "bg-red-500/10 text-red-300" :
                  actionStatus.tone === "success" ? "bg-green-500/10 text-green-300" :
                    "bg-white/[0.04] text-zinc-400",
              )}>
                {actionStatus.message}
              </div>
            )}
          </div>
        )}
      </main>

      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent className="border-[#242424] bg-[#101010] text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance">Withdraw USDC</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty text-zinc-500">
              Decibel withdraws collateral to your wallet first. If the recipient differs, you will sign a second USDC transfer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <label className="block">
              <span className="text-[11px] text-zinc-500">Amount</span>
              <input
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                disabled={withdrawing}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded-[4px] border border-[#242424] bg-black px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-zinc-500">Recipient Aptos address</span>
              <input
                value={withdrawRecipient}
                onChange={(event) => setWithdrawRecipient(event.target.value)}
                disabled={withdrawing}
                placeholder={owner || "0x..."}
                className="mt-1 w-full rounded-[4px] border border-[#242424] bg-black px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500"
              />
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#303030] bg-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={withdrawing}
              onClick={(event) => {
                event.preventDefault();
                void handleWithdraw();
              }}
              className="bg-zinc-200 text-black hover:bg-white"
            >
              {withdrawing ? "Withdrawing..." : "Withdraw"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
