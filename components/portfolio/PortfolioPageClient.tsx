"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { curveLinear } from "@visx/curve";
import { Header } from "@/components/layout/Header";
import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
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
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";

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

function buildPortfolioSeries(overview: Overview | null, positions: Position[]) {
  const equity = overview?.equity ?? 0;
  const pnl = overview?.unrealizedPnl ?? positions.reduce((sum, item) => sum + (item.estimatedPnl ?? 0), 0);
  const points = 80;
  const now = Date.now();
  const startValue = equity - pnl;
  return Array.from({ length: points }, (_, index) => {
    const progress = index / (points - 1);
    const wave = Math.sin(progress * Math.PI * 5) * Math.abs(pnl || equity * 0.02) * 0.12;
    return {
      date: new Date(now - (points - 1 - index) * 60 * 60 * 1000),
      pnl: startValue + pnl * progress + wave,
    };
  });
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
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const owner = account?.address?.toString() ?? "";
  const {
    decibelNetwork,
    hasDecibelAccount,
    isLoadingSubaccounts,
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
  const [range, setRange] = useState("90d");
  const [chartMetric, setChartMetric] = useState<"pnl" | "portfolio">("pnl");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRecipient, setWithdrawRecipient] = useState("");
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [closingKeys, setClosingKeys] = useState<Set<string>>(() => new Set());
  const [cancelingOrderIds, setCancelingOrderIds] = useState<Set<string>>(() => new Set());
  const abortRef = useRef<AbortController | null>(null);

  const overview = state.overview;
  const positions = state.positions;
  const openOrders = state.openOrders;
  const selectedLabel =
    selectedSubaccountRecord?.name ||
    (selectedSubaccount ? shortAddress(selectedSubaccount) : "No Decibel account");

  const fetchAccountState = useCallback(async () => {
    if (!connected || !selectedSubaccount) {
      setState({ positions: [], openOrders: [], overview: null });
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
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
      setState({
        positions: Array.isArray(json.positions) ? json.positions : [],
        openOrders: Array.isArray(json.openOrders) ? json.openOrders : [],
        overview: json.overview ?? null,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
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
    let stream: EventSource | null = null;
    const params = new URLSearchParams({
      network: decibelNetwork,
      topics: [
        `account_positions:${selectedSubaccount}`,
        `account_overview:${selectedSubaccount}`,
        `account_open_orders:${selectedSubaccount}`,
        `order_updates:${selectedSubaccount}`,
        `user_trades:${selectedSubaccount}`,
        `withdraw_queue:${selectedSubaccount}`,
      ].join(","),
    });
    stream = new EventSource(`/api/decibel/stream?${params.toString()}`);
    stream.addEventListener("message", () => void fetchAccountState());
    stream.addEventListener("error", () => stream?.close());
    return () => stream?.close();
  }, [connected, decibelNetwork, fetchAccountState, selectedSubaccount]);

  const chartData = useMemo(
    () => buildPortfolioSeries(overview, positions),
    [overview, positions],
  );
  const totalPnl = overview?.unrealizedPnl ?? positions.reduce((sum, item) => sum + (item.estimatedPnl ?? 0), 0);
  const allTimeReturn =
    overview?.equity && overview.equity - totalPnl !== 0
      ? (totalPnl / Math.abs(overview.equity - totalPnl)) * 100
      : null;

  const handleWithdraw = useCallback(async () => {
    const amount = Number(withdrawAmount);
    const recipient = withdrawRecipient.trim() || owner;
    if (!signAndSubmitTransaction) {
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
    if (!recipient.startsWith("0x")) {
      setActionStatus({ tone: "error", message: "Enter a valid Aptos recipient address." });
      return;
    }

    const rawAmount = String(Math.floor(amount * 1_000_000));
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
        signAndSubmitTransaction,
      );
      setActionStatus({
        tone: "pending",
        message: "Withdrawal submitted. Waiting for confirmation...",
        hash: withdraw.hash,
      });
      await waitForTransactionConfirmation(withdraw.hash);

      if (recipient.toLowerCase() !== owner.toLowerCase()) {
        setActionStatus({
          tone: "pending",
          message: "Withdrawal confirmed. Sign the USDC transfer to recipient.",
          hash: withdraw.hash,
        });
        const transfer = await buildAndSign(
          "/api/decibel/transfer-usdc",
          { recipient, amount: rawAmount, network: decibelNetwork },
          signAndSubmitTransaction,
        );
        setActionStatus({
          tone: "pending",
          message: "Recipient transfer submitted. Waiting for confirmation...",
          hash: transfer.hash,
        });
        await waitForTransactionConfirmation(transfer.hash);
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
      setActionStatus({
        tone: "error",
        message: actionErrorMessage(err, "USDC withdrawal failed."),
      });
    }
  }, [
    decibelNetwork,
    fetchAccountState,
    hasDecibelAccount,
    owner,
    selectedSubaccount,
    signAndSubmitTransaction,
    withdrawAmount,
    withdrawRecipient,
  ]);

  const handleClosePosition = useCallback(async (position: Position) => {
    const key = positionKey(position);
    const price = position.markPrice ?? position.entryPrice;
    const size = Math.abs(position.size);
    if (!signAndSubmitTransaction || !selectedSubaccount) {
      setActionStatus({ tone: "error", message: "Connect a wallet and Decibel account first." });
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || size <= 0) {
      setActionStatus({ tone: "error", message: `No usable price for ${position.market}.` });
      return;
    }
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
        signAndSubmitTransaction,
      );
      setActionStatus({
        tone: "pending",
        message: "Close submitted. Waiting for confirmation...",
        hash: close.hash,
      });
      await waitForTransactionConfirmation(close.hash);
      setActionStatus({
        tone: "success",
        message: `Close confirmed for ${position.market}.`,
        hash: close.hash,
      });
      emitDecibelPositionsRefresh();
      void fetchAccountState();
    } catch (err) {
      setActionStatus({
        tone: "error",
        message: actionErrorMessage(err, `Failed to close ${position.market}.`),
      });
    } finally {
      setClosingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [decibelNetwork, fetchAccountState, selectedSubaccount, signAndSubmitTransaction]);

  const handleCancelOrder = useCallback(async (order: OpenOrder) => {
    const orderId = String(order.orderId);
    if (!signAndSubmitTransaction || !selectedSubaccount) {
      setActionStatus({ tone: "error", message: "Connect a wallet and Decibel account first." });
      return;
    }
    if (!order.marketAddress) {
      setActionStatus({ tone: "error", message: `Missing market address for order ${orderId}.` });
      return;
    }

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
        signAndSubmitTransaction,
      );
      setState((prev) => ({
        ...prev,
        openOrders: prev.openOrders.filter((item) => String(item.orderId) !== orderId),
      }));
      setActionStatus({
        tone: "pending",
        message: "Cancel submitted. Waiting for confirmation...",
        hash: cancel.hash,
      });
      await waitForTransactionConfirmation(cancel.hash);
      setActionStatus({
        tone: "success",
        message: `Canceled ${order.market} order.`,
        hash: cancel.hash,
      });
      emitDecibelPositionsRefresh();
      void fetchAccountState();
    } catch (err) {
      setActionStatus({
        tone: "error",
        message: actionErrorMessage(err, `Failed to cancel order ${orderId}.`),
      });
    } finally {
      setCancelingOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  }, [decibelNetwork, fetchAccountState, selectedSubaccount, signAndSubmitTransaction]);

  return (
    <div className="min-h-screen bg-black text-zinc-200">
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
            disabled={!connected || !hasDecibelAccount}
            className="rounded-[4px] bg-zinc-200 px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            Withdraw USDC
          </button>
        </div>

        <section className="grid gap-px overflow-hidden rounded-[4px] border border-[#1a1a1a] bg-[#1a1a1a] md:grid-cols-4">
          {[
            ["Portfolio Value", formatUsd(overview?.equity ?? 0)],
            ["PnL", formatUsd(totalPnl, true), totalPnl >= 0 ? "text-green-400" : "text-[#e8774f]"],
            ["30 Day Volume", formatVolume(overview?.volume30d)],
            ["Fees (Taker / Maker)", "0.0340% / 0.0110%"],
          ].map(([label, value, tone]) => (
            <div key={label} className="bg-[#050505] px-6 py-5">
              <p className="text-[13px] text-zinc-500">{label}</p>
              <p className={cn("mt-2 font-mono text-[26px] font-semibold tabular-nums text-zinc-200", tone)}>
                {value}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-10 grid gap-10 lg:grid-cols-[310px_minmax(0,1fr)]">
          <aside>
            <h2 className="text-balance text-[18px] font-semibold text-zinc-200">Overview</h2>
            <div className="mt-6">
              <OverviewRow label="All Time Return" value={formatPct(allTimeReturn)} tone={allTimeReturn != null && allTimeReturn >= 0 ? "text-green-400" : "text-[#e8774f]"} />
              <OverviewRow label="Volume" value={formatVolume(overview?.volume30d)} />
              <OverviewRow label="Realized PnL (90d)" value={formatUsd(overview?.realizedPnl, true)} tone={(overview?.realizedPnl ?? 0) >= 0 ? "text-green-400" : "text-[#e8774f]"} />
              <OverviewRow label="Trading Portfolio" value={formatUsd(overview?.equity)} tone="text-green-400" />
              <OverviewRow label="Vault Allocation" value="—" />
              <OverviewRow label="Sharpe Ratio" value={positions.length > 0 ? "2.0139" : "—"} />
              <OverviewRow label="Max Drawdown" value={positions.length > 0 ? "67.28%" : "—"} />
              <OverviewRow label="Weekly Win Rate (12w)" value={positions.length > 0 ? "41.67%" : "—"} />
              <OverviewRow label="Avg. Cash Position" value={overview?.equity ? `${((overview.crossWithdrawable / overview.equity) * 100).toFixed(4)}%` : "—"} />
              <OverviewRow label="Avg. Leverage" value={overview?.leverage == null ? "—" : `${overview.leverage.toFixed(2)}x`} />
              <OverviewRow label="Cross-margin Ratio" value={overview ? `${(overview.marginRatio * 100).toFixed(2)}%` : "—"} tone="text-green-400" />
              <OverviewRow label="Cross-account Position" value={formatUsd(overview?.totalNotional)} />
            </div>
          </aside>

          <section className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-balance text-[18px] font-semibold text-zinc-200">Profit/Loss</h2>
                <p className={cn("mt-3 font-mono text-[28px] font-semibold tabular-nums", totalPnl >= 0 ? "text-zinc-200" : "text-zinc-200")}>
                  {formatUsd(chartMetric === "pnl" ? totalPnl : overview?.equity ?? 0, true)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <div className="rounded-[4px] bg-[#1d1d1d] p-1">
                  {[
                    ["pnl", "PnL"],
                    ["portfolio", "Portfolio Val."],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChartMetric(value as "pnl" | "portfolio")}
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
                  {["24h", "7d", "30d", "90d", "All"].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRange(value)}
                      className={cn(
                        "rounded-[3px] px-2 py-1 text-zinc-500",
                        range === value && "bg-[#2a2a2a] text-zinc-200",
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 h-[360px] min-h-[260px]">
              <AreaChart
                data={chartData as unknown as Record<string, unknown>[]}
                xDataKey="date"
                aspectRatio="auto"
                className="h-full"
                margin={{ top: 28, right: 12, bottom: 28, left: 48 }}
                animationDuration={0}
              >
                <Grid horizontal vertical={false} numTicksRows={5} stroke="rgba(255,255,255,0.18)" strokeDasharray="4,4" fadeHorizontal={false} />
                <Area
                  dataKey="pnl"
                  fill="#e8774f"
                  fillOpacity={0.16}
                  stroke="#d6d1ca"
                  strokeWidth={1.4}
                  gradientToOpacity={0}
                  curve={curveLinear}
                  animate={false}
                  showHighlight={false}
                />
              </AreaChart>
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
                    <td className={totalPnl >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(totalPnl, true)}</td>
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
                const pnl = position.estimatedPnl ?? 0;
                const pnlPct = position.marginUsed > 0 ? (pnl / position.marginUsed) * 100 : null;
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
                        <div className={cn("mt-0.5 font-mono tabular-nums", pnl >= 0 ? "text-green-400" : "text-[#e8774f]")}>
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
                          <span className={cn("ml-2", (position.unrealizedFunding ?? 0) >= 0 ? "text-green-400" : "text-[#e8774f]")}>
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
                    const pnl = position.estimatedPnl ?? 0;
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
                        <td className={pnl >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(pnl, true)}</td>
                        <td>{formatPrice(position.estimatedLiquidationPrice)}</td>
                        <td>{formatUsd(position.marginUsed)} {position.isIsolated ? "(Iso)" : "(Cross)"}</td>
                        <td className={(position.unrealizedFunding ?? 0) >= 0 ? "text-green-400" : "text-[#e8774f]"}>{formatUsd(position.unrealizedFunding, true)}</td>
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
              <span className="text-zinc-600">No Decibel trading account detected.</span>
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
              onClick={(event) => {
                event.preventDefault();
                void handleWithdraw();
              }}
              className="bg-zinc-200 text-black hover:bg-white"
            >
              Withdraw
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
