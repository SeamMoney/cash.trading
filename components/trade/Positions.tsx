"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { AnimatePresence, motion } from "motion/react";
import { explorerTxUrl } from "@/lib/constants";
import {
  emitDecibelPositionsRefresh,
  onDecibelPositionsRefresh,
  onDecibelSubaccountChange,
  pickDecibelSubaccount,
} from "@/lib/decibel-selection";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { buildAndSign, waitForTransactionConfirmation } from "@/lib/tx-utils";
import { NumberTicker } from "@/components/ui/number-ticker";

const POSITION_POLL_MS = 1000;
const INDEXED_REFRESH_MS = 6000;

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
  client_order_id: string | null;
  orig_size: number | null;
  remaining_size: number | null;
  size_delta: number | null;
  price: number | null;
  is_buy: boolean;
  details: string;
  unix_ms: number;
};

type DecibelWsMarketPrice = {
  market: string;
  mark_px: number;
};

interface Position {
  market: string;
  marketAddress: string | null;
  size: number;
  isLong: boolean;
  leverage: number;
  entryPrice: number;
  markPrice: number | null;
  notionalEntry: number;
  value: number | null;
  estimatedPnl: number | null;
  marginUsed: number;
  isIsolated: boolean;
  unrealizedFunding: number | null;
  estimatedLiquidationPrice: number | null;
  tpTriggerPrice: number | null;
  slTriggerPrice: number | null;
  source: "chain" | "indexed";
  decimalsKnown: boolean;
}

interface OpenOrder {
  orderId: string;
  market: string;
  marketAddress: string | null;
  isBuy: boolean;
  price: number;
  origSize: number;
  remainingSize: number;
  details: string;
  status?: string;
  timestamp: number;
}

interface Overview {
  equity: number;
  unrealizedPnl: number;
  realizedPnl: number | null;
  marginRatio: number;
  maintenanceMargin: number;
  leverage: number | null;
  totalMargin: number;
  totalNotional: number;
  collateral: number;
  crossWithdrawable: number;
  volume30d: number | null;
}

interface Subaccount {
  address: string;
  isPrimary?: boolean;
}

type ActionStatus = {
  tone: "pending" | "success" | "error";
  message: string;
  hash?: string;
};

function positionKey(p: Pick<Position, "marketAddress" | "market" | "isLong">) {
  if (p.marketAddress) return p.marketAddress.toLowerCase();
  return `${p.market}:${p.isLong ? "L" : "S"}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getKnownMarketName(
  marketAddress: string,
  refs: {
    positions: Position[];
    orders: OpenOrder[];
  }
) {
  const lower = marketAddress.toLowerCase();
  const position = refs.positions.find(
    (item) => item.marketAddress?.toLowerCase() === lower && item.market !== "Unknown"
  );
  if (position) return position.market;
  const order = refs.orders.find(
    (item) => item.marketAddress?.toLowerCase() === lower && item.market !== "Unknown"
  );
  return order?.market ?? marketAddress;
}

function applyMarkCarry(position: Position, previous: Position | null): Position {
  if (!previous || previous.isLong !== position.isLong) return position;
  const mark = position.markPrice ?? previous.markPrice;
  const absSize = Math.abs(position.size);
  const value = mark !== null ? absSize * mark : null;
  const estimatedPnl =
    mark !== null
      ? position.isLong
        ? (mark - position.entryPrice) * absSize
        : (position.entryPrice - mark) * absSize
      : null;

  return {
    ...position,
    markPrice: mark,
    value,
    estimatedPnl,
    market:
      position.market !== position.marketAddress && position.market !== "Unknown"
        ? position.market
        : previous.market,
  };
}

function decibelWsPositionToPosition(
  row: DecibelWsPosition,
  previousByMarket: Map<string, Position>,
  refs: { positions: Position[]; orders: OpenOrder[] }
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
  const notionalEntry = absSize * entryPrice;
  const marginUsed = leverage > 0 ? notionalEntry / leverage : 0;
  const previous = previousByMarket.get(marketAddress.toLowerCase()) ?? null;
  const liq =
    isFiniteNumber(row.estimated_liquidation_price) &&
    row.estimated_liquidation_price !== 0
      ? row.estimated_liquidation_price
      : null;

  const position: Position = {
    market: getKnownMarketName(marketAddress, refs),
    marketAddress,
    size: row.size,
    isLong,
    leverage,
    entryPrice,
    markPrice: null,
    notionalEntry,
    value: null,
    estimatedPnl: null,
    marginUsed,
    isIsolated: Boolean(row.is_isolated),
    unrealizedFunding: isFiniteNumber(row.unrealized_funding)
      ? row.unrealized_funding
      : null,
    estimatedLiquidationPrice: liq,
    tpTriggerPrice: row.tp_trigger_price,
    slTriggerPrice: row.sl_trigger_price,
    source: "indexed",
    decimalsKnown: true,
  };

  return applyMarkCarry(position, previous);
}

function decibelWsOverviewToOverview(
  row: DecibelWsOverview,
  previous: Overview | null
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
    maintenanceMargin: isFiniteNumber(row.maintenance_margin)
      ? row.maintenance_margin
      : 0,
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
  refs: { positions: Position[]; orders: OpenOrder[] }
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
    details: row.details ?? "Open",
    status: "Open",
    timestamp: isFiniteNumber(row.unix_ms) ? row.unix_ms : Date.now(),
  };
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

/**
 * Merge a fresh hot-path (`chainOnly=true`) positions snapshot with the
 * previous list. The hot path never attempts mark enrichment, so it always
 * returns `markPrice: null`; we carry over the last known `markPrice` from
 * the previous snapshot, then recompute `value` and `estimatedPnl` from the
 * fresh row's `size`/`entryPrice`/`isLong` so derived fields always reflect
 * current position state — never a stale cached pair.
 *
 * IMPORTANT: only call this on the hot path. The indexed path is
 * authoritative: if it returns `markPrice: null` for a position, that means
 * the registry mark view actually failed for that address and the UI must
 * render `—`. Carrying stale mark data into an indexed update would hide
 * that failure.
 */
function mergeHotIntoPrev(prev: Position[], next: Position[]): Position[] {
  if (prev.length === 0) return next;
  const prevByKey = new Map<string, Position>();
  for (const p of prev) prevByKey.set(positionKey(p), p);

  return next.map((n) => {
    const last = prevByKey.get(positionKey(n));
    if (!last) return n;

    // Side flip on the same market: position was reversed between polls.
    // Don't carry direction-specific risk fields (liq, funding, TP/SL) —
    // they belong to the previous side. Use the fresh hot row entirely;
    // the next 6s indexed refresh will repopulate the new side's values.
    if (last.isLong !== n.isLong) return n;

    // Defense-in-depth cold-cache guard: when the parser explicitly tells
    // us decimals were not available for this market (`decimalsKnown:
    // false`) but the previous row was indexed and thus authoritatively
    // scaled, keep the prior indexed shape until the next default-path
    // refresh repopulates the cache. This NEVER fires when decimals are
    // known — large legitimate position changes (partial closes, big
    // adds) pass through immediately.
    if (last.source === "indexed" && n.decimalsKnown === false) {
      const mark = last.markPrice;
      const lastAbs = Math.abs(last.size);
      const value = mark !== null ? lastAbs * mark : null;
      const estimatedPnl =
        mark !== null
          ? last.isLong
            ? (mark - last.entryPrice) * lastAbs
            : (last.entryPrice - mark) * lastAbs
          : null;
      return { ...last, markPrice: mark, value, estimatedPnl };
    }

    // Always use the fresh hot row's size / entryPrice / leverage / isLong.
    // The chain hot row is decimals-correct once the server-side metadata
    // cache has been populated by the default indexed path (which the
    // frontend triggers in parallel). Trusting fresh chain data here
    // means partial closes and resizes propagate at 1s instead of being
    // hidden by stale indexed data for up to 6s.
    //
    // markPrice: chain hot path never fetches marks, so it's always null
    // on `n`. Carry forward `last.markPrice` (set by the most recent
    // default-path response) and recompute value/PnL from FRESH size +
    // carried mark so a partial close shrinks Value/PnL immediately.
    const mark = n.markPrice ?? last.markPrice;
    const absSize = Math.abs(n.size);
    const value = mark !== null ? absSize * mark : null;
    const estimatedPnl =
      mark !== null
        ? n.isLong
          ? (mark - n.entryPrice) * absSize
          : (n.entryPrice - mark) * absSize
        : null;

    // Carry liq / funding / TP/SL from the last indexed snapshot when the
    // fresh hot row doesn't have them — chain hot path can't compute these.
    // Only carry from indexed source: chain → chain carry would re-spread
    // a stale value rather than honestly reverting to `—`.
    const carryFromIndexed = last.source === "indexed";
    return {
      ...n,
      markPrice: mark,
      value,
      estimatedPnl,
      estimatedLiquidationPrice:
        n.estimatedLiquidationPrice ??
        (carryFromIndexed ? last.estimatedLiquidationPrice : null),
      unrealizedFunding:
        n.unrealizedFunding ??
        (carryFromIndexed ? last.unrealizedFunding : null),
      tpTriggerPrice:
        n.tpTriggerPrice ??
        (carryFromIndexed ? last.tpTriggerPrice : null),
      slTriggerPrice:
        n.slTriggerPrice ??
        (carryFromIndexed ? last.slTriggerPrice : null),
      // Preserve indexed provenance while carrying indexed-only risk fields
      // so the next hot tick does not drop them before the next indexed poll.
      source: carryFromIndexed ? "indexed" : n.source,
      // Prefer fresh non-Unknown name; otherwise keep last good label.
      market: n.market !== "Unknown" ? n.market : last.market,
    };
  });
}

function formatUsd(value: number, options: { signed?: boolean } = {}): string {
  const sign = options.signed && value > 0 ? "+" : "";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : sign}$${formatted}`;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  })}`;
}

function formatVolume(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function actionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/anonymous requests|authorization:\s*bearer|http error 401|unauthorized/i.test(message)) {
    return "Decibel market data auth failed on a server read. Refresh and retry; close orders use chain fallback when the market address is available.";
  }
  return message;
}

/**
 * Positions component — reads Decibel account state from chain-first API routes.
 * Open-order listing is REST-enriched when Decibel's indexer is available.
 *
 * Mark price / value / est. PnL come from the slower 6s indexed path; the 1s
 * `chainOnly=true` hot path doesn't add any new RPC. Hot snapshots are merged
 * with the last enriched list by `marketAddress` so derived fields don't
 * flicker between polls.
 */
export function Positions() {
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const ownerAddress = account?.address?.toString() ?? "";
  const [positions, setPositions] = useState<Position[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedSubaccount, setSelectedSubaccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [closingPositionKeys, setClosingPositionKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [cancelingOrderIds, setCancelingOrderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [decibelNetwork, setDecibelNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const chainControllerRef = useRef<AbortController | null>(null);
  const indexedControllerRef = useRef<AbortController | null>(null);
  const positionsRef = useRef<Position[]>([]);
  const openOrdersRef = useRef<OpenOrder[]>([]);
  const overviewRef = useRef<Overview | null>(null);

  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    openOrdersRef.current = openOrders;
  }, [openOrders]);

  useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

  const loadSelectedSubaccount = useCallback(async (signal?: AbortSignal) => {
    if (!ownerAddress) {
      setSelectedSubaccount(null);
      return null;
    }

    try {
      const params = new URLSearchParams({
        address: ownerAddress,
        network: decibelNetwork,
      });
      const subaccountRes = await fetch(
        `/api/decibel/subaccount?${params.toString()}`,
        { cache: "no-store", signal }
      );
      const subaccountData = await subaccountRes.json();
      const subaccounts = Array.isArray(subaccountData.subaccounts)
        ? subaccountData.subaccounts as Subaccount[]
        : [];
      const subaccount = pickDecibelSubaccount(
        subaccounts,
        ownerAddress
      );

      setSelectedSubaccount(subaccount);
      if (!subaccount) {
        setPositions([]);
        setOpenOrders([]);
        setOverview(null);
      }
      return subaccount;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      setSelectedSubaccount(null);
      return null;
    }
  }, [decibelNetwork, ownerAddress]);

  const fetchChainState = useCallback(async (subaccount: string) => {
    if (!subaccount) return;

    chainControllerRef.current?.abort();
    const controller = new AbortController();
    chainControllerRef.current = controller;
    setRefreshing(true);

    try {
      const res = await fetch(
        `/api/decibel/positions?address=${subaccount}&chainOnly=true&network=${decibelNetwork}`,
        { cache: "no-store", signal: controller.signal }
      );
      const data = await res.json();

      if (!data.error && !controller.signal.aborted) {
        const incoming = (data.positions || []) as Position[];
        setPositions((prev) => mergeHotIntoPrev(prev, incoming));
        setOverview(data.overview || null);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        // Keep the last good snapshot; Decibel state will refresh on the next tick.
      }
    } finally {
      if (chainControllerRef.current === controller) {
        chainControllerRef.current = null;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [decibelNetwork]);

  const fetchIndexedState = useCallback(async (subaccount: string) => {
    if (!subaccount) return;

    indexedControllerRef.current?.abort();
    const controller = new AbortController();
    indexedControllerRef.current = controller;

    try {
      const res = await fetch(
        `/api/decibel/positions?address=${subaccount}&openOrders=true&network=${decibelNetwork}`,
        { cache: "no-store", signal: controller.signal }
      );
      const data = await res.json();

      if (!subaccount) {
        setPositions([]);
        setOpenOrders([]);
        setOverview(null);
        return;
      }

      if (!data.error && !controller.signal.aborted) {
        const incoming = (data.positions || []) as Position[];
        // Indexed path is authoritative for mark/value/PnL: if a per-address
        // mark view failed, the API returns markPrice: null and the UI must
        // honestly render `—` rather than reuse stale data. Replace, don't merge.
        setPositions(incoming);
        setOpenOrders(data.openOrders || []);
        setOverview(data.overview || null);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        // Keep the last good indexed snapshot; open orders are not on the hot path.
      }
    } finally {
      if (indexedControllerRef.current === controller) {
        indexedControllerRef.current = null;
      }
    }
  }, [decibelNetwork]);

  const setClosingPosition = useCallback((key: string, pending: boolean) => {
    setClosingPositionKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const setCancelingOrder = useCallback((orderId: string, pending: boolean) => {
    setCancelingOrderIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }, []);

  const handleClosePosition = useCallback(
    async (position: Position) => {
      const key = positionKey(position);
      const referencePrice = position.markPrice ?? position.entryPrice;
      const size = Math.abs(position.size);

      if (!selectedSubaccount) {
        setActionStatus({
          tone: "error",
          message: "Select a Decibel subaccount before closing positions.",
        });
        return;
      }
      if (!signAndSubmitTransaction) {
        setActionStatus({
          tone: "error",
          message: "Wallet signing is not available.",
        });
        return;
      }
      if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
        setActionStatus({
          tone: "error",
          message: `No usable mark or entry price for ${position.market}.`,
        });
        return;
      }
      if (!Number.isFinite(size) || size <= 0) {
        setActionStatus({
          tone: "error",
          message: `No open size detected for ${position.market}.`,
        });
        return;
      }

      setClosingPosition(key, true);
      setActionStatus({
        tone: "pending",
        message: `Sign reduce-only close for ${position.market}.`,
      });

      try {
        const { hash } = await buildAndSign(
          "/api/decibel/order",
          {
            marketName: position.market,
            marketAddress: position.marketAddress ?? undefined,
            price: referencePrice,
            size,
            isBuy: !position.isLong,
            orderType: "market",
            reduceOnly: true,
            subaccount: selectedSubaccount,
            network: decibelNetwork,
          },
          signAndSubmitTransaction
        );

        setActionStatus({
          tone: "pending",
          message: "Close submitted. Waiting for confirmation...",
          hash,
        });
        emitDecibelPositionsRefresh();
        await waitForTransactionConfirmation(hash);
        emitDecibelPositionsRefresh();
        setActionStatus({
          tone: "success",
          message: `Close confirmed for ${position.market}.`,
          hash,
        });
      } catch (error) {
        setActionStatus({
          tone: "error",
          message: actionErrorMessage(error, `Failed to close ${position.market}.`),
        });
      } finally {
        setClosingPosition(key, false);
      }
    },
    [
      selectedSubaccount,
      decibelNetwork,
      setClosingPosition,
      signAndSubmitTransaction,
    ]
  );

  const handleCancelOrder = useCallback(
    async (order: OpenOrder) => {
      const orderId = String(order.orderId);
      if (!selectedSubaccount) {
        setActionStatus({
          tone: "error",
          message: "Select a Decibel subaccount before canceling orders.",
        });
        return;
      }
      if (!signAndSubmitTransaction) {
        setActionStatus({
          tone: "error",
          message: "Wallet signing is not available.",
        });
        return;
      }
      if (!order.marketAddress) {
        setActionStatus({
          tone: "error",
          message: `Missing market address for order ${orderId}.`,
        });
        return;
      }

      setCancelingOrder(orderId, true);
      setActionStatus({
        tone: "pending",
        message: `Sign cancel for ${order.market} order ${orderId}.`,
      });

      try {
        const { hash } = await buildAndSign(
          "/api/decibel/cancel-order",
          {
            subaccount: selectedSubaccount,
            marketName: order.market,
            marketAddress: order.marketAddress,
            orderId,
            network: decibelNetwork,
          },
          signAndSubmitTransaction
        );

        setOpenOrders((prev) =>
          prev.filter((item) => String(item.orderId) !== orderId)
        );
        setActionStatus({
          tone: "pending",
          message: "Cancel submitted. Waiting for confirmation...",
          hash,
        });
        emitDecibelPositionsRefresh();
        await waitForTransactionConfirmation(hash);
        emitDecibelPositionsRefresh();
        setActionStatus({
          tone: "success",
          message: `Order ${orderId} canceled.`,
          hash,
        });
      } catch (error) {
        setActionStatus({
          tone: "error",
          message: actionErrorMessage(error, `Failed to cancel order ${orderId}.`),
        });
      } finally {
        setCancelingOrder(orderId, false);
      }
    },
    [decibelNetwork, selectedSubaccount, setCancelingOrder, signAndSubmitTransaction]
  );

  useEffect(() => {
    if (!connected || !ownerAddress) {
      setPositions([]);
      setOpenOrders([]);
      setOverview(null);
      setSelectedSubaccount(null);
      setActionStatus(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    void loadSelectedSubaccount(controller.signal).finally(() => setLoading(false));

    const unsubscribeSubaccount = onDecibelSubaccountChange(() => {
      void loadSelectedSubaccount();
    });

    return () => {
      controller.abort();
      unsubscribeSubaccount();
    };
  }, [connected, loadSelectedSubaccount, ownerAddress]);

  useEffect(() => {
    if (!connected || !selectedSubaccount) return;

    const isVisible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";

    const refreshHotState = () => {
      if (isVisible()) void fetchChainState(selectedSubaccount);
    };
    const refreshIndexedState = () => {
      if (isVisible()) void fetchIndexedState(selectedSubaccount);
    };

    refreshHotState();
    refreshIndexedState();

    const hotInterval = setInterval(refreshHotState, POSITION_POLL_MS);
    const indexedInterval = setInterval(refreshIndexedState, INDEXED_REFRESH_MS);
    const unsubscribeRefresh = onDecibelPositionsRefresh(() => {
      refreshHotState();
      refreshIndexedState();
    });

    return () => {
      clearInterval(hotInterval);
      clearInterval(indexedInterval);
      unsubscribeRefresh();
      chainControllerRef.current?.abort();
      indexedControllerRef.current?.abort();
    };
  }, [connected, fetchChainState, fetchIndexedState, selectedSubaccount]);

  useEffect(() => {
    if (!connected || !selectedSubaccount || typeof window === "undefined") {
      return;
    }

    let closed = false;
    let stream: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let indexedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleIndexedRefresh = (delay = 250) => {
      if (indexedRefreshTimer) clearTimeout(indexedRefreshTimer);
      indexedRefreshTimer = setTimeout(() => {
        if (closed) return;
        void fetchIndexedState(selectedSubaccount);
      }, delay);
    };

    const applyPositionsFrame = (rows: unknown) => {
      if (!Array.isArray(rows)) return false;
      const previousByMarket = new Map<string, Position>();
      for (const item of positionsRef.current) {
        if (item.marketAddress) {
          previousByMarket.set(item.marketAddress.toLowerCase(), item);
        }
      }
      const refs = {
        positions: positionsRef.current,
        orders: openOrdersRef.current,
      };
      const next = rows
        .map((row) =>
          decibelWsPositionToPosition(
            row as DecibelWsPosition,
            previousByMarket,
            refs
          )
        )
        .filter((row): row is Position => row !== null);
      setPositions(next);
      setLoading(false);
      setRefreshing(false);
      return true;
    };

    const applyOverviewFrame = (row: unknown) => {
      if (!row || typeof row !== "object") return false;
      setOverview(decibelWsOverviewToOverview(row as DecibelWsOverview, overviewRef.current));
      setLoading(false);
      setRefreshing(false);
      return true;
    };

    const applyOpenOrdersFrame = (rows: unknown) => {
      if (!Array.isArray(rows)) return false;
      const refs = {
        positions: positionsRef.current,
        orders: openOrdersRef.current,
      };
      const next = rows
        .map((row) => decibelWsOpenOrderToOpenOrder(row as DecibelWsOpenOrder, refs))
        .filter((row): row is OpenOrder => row !== null);
      setOpenOrders(next);
      return true;
    };

    const applyMarketPricesFrame = (rows: unknown) => {
      if (!Array.isArray(rows)) return false;
      const marks = new Map<string, number>();
      for (const row of rows as DecibelWsMarketPrice[]) {
        if (row.market && isFiniteNumber(row.mark_px)) {
          marks.set(row.market.toLowerCase(), row.mark_px);
        }
      }
      if (marks.size === 0) return false;
      setPositions((prev) =>
        prev.map((position) => {
          const market = position.marketAddress?.toLowerCase();
          const mark = market ? marks.get(market) : undefined;
          return mark === undefined ? position : applyLiveMark(position, mark);
        })
      );
      return true;
    };

    const connect = () => {
      if (closed) return;
      const params = new URLSearchParams({
        network: decibelNetwork,
        topics: [
          "all_market_prices",
          `account_positions:${selectedSubaccount}`,
          `account_overview:${selectedSubaccount}`,
          `account_open_orders:${selectedSubaccount}`,
          `order_updates:${selectedSubaccount}`,
          `user_trades:${selectedSubaccount}`,
        ].join(","),
      });

      stream = new EventSource(`/api/decibel/stream?${params.toString()}`);
      stream.onopen = () => {
        attempt = 0;
      };
      stream.onmessage = (event) => {
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
          if (message.topic === "all_market_prices") {
            applyMarketPricesFrame(message.prices);
            return;
          }
          if (message.topic === `account_positions:${selectedSubaccount}`) {
            if (applyPositionsFrame(message.positions)) {
              scheduleIndexedRefresh(1_500);
              return;
            }
          }
          if (message.topic === `account_overview:${selectedSubaccount}`) {
            if (applyOverviewFrame(message.account_overview)) return;
          }
          if (message.topic === `account_open_orders:${selectedSubaccount}`) {
            if (applyOpenOrdersFrame(message.orders)) return;
          }
          if (message.topic?.startsWith("order_updates:")) {
            scheduleIndexedRefresh(100);
            return;
          }
          if (message.topic?.startsWith("user_trades:")) {
            void fetchChainState(selectedSubaccount);
            scheduleIndexedRefresh(250);
          }
        } catch {
          scheduleIndexedRefresh();
        }
      };
      stream.onerror = () => {
        stream?.close();
        stream = null;
        if (closed) return;
        const delay = Math.min(8_000, 750 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      stream?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (indexedRefreshTimer) clearTimeout(indexedRefreshTimer);
    };
  }, [connected, decibelNetwork, fetchChainState, fetchIndexedState, selectedSubaccount]);

  if (!connected) {
    return (
      <div className="surface-1 rounded-[16px] p-6 text-center text-[13px] text-zinc-500">
        Connect your wallet to view positions and orders
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Account Overview */}
      {overview && (
        <div className="hidden md:grid md:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            {
              label: "Equity",
              value: formatUsd(overview.equity),
              raw: overview.equity,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
            {
              label: "Available",
              value: formatUsd(overview.crossWithdrawable),
              raw: overview.crossWithdrawable,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
            {
              label: "Cross Position",
              value: formatUsd(overview.totalNotional),
              raw: overview.totalNotional,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
            },
            {
              label: "Unrealized P&L",
              value: formatUsd(overview.unrealizedPnl, { signed: true }),
              raw: overview.unrealizedPnl,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" },
              color:
                overview.unrealizedPnl >= 0
                  ? "text-success"
                  : "text-danger",
            },
            {
              label: "Realized P&L",
              value:
                overview.realizedPnl !== null
                  ? formatUsd(overview.realizedPnl, { signed: true })
                  : "—",
              raw: overview.realizedPnl,
              format: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" },
              color:
                overview.realizedPnl === null
                  ? undefined
                  : overview.realizedPnl > 0
                  ? "text-success"
                  : overview.realizedPnl < 0
                  ? "text-danger"
                  : undefined,
            },
            {
              label: "Margin Ratio",
              value: `${(overview.marginRatio * 100).toFixed(1)}%`,
              raw: overview.marginRatio * 100,
              format: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
              suffix: "%",
            },
            {
              label: "Leverage",
              value: overview.leverage
                ? `${overview.leverage.toFixed(1)}x`
                : "—",
              raw: overview.leverage,
              format: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
              suffix: "x",
            },
            {
              label: "30d Volume",
              value: formatVolume(overview.volume30d),
            },
          ].map((item) => (
            <motion.div
              key={item.label}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="surface-1 rounded-[12px] p-3"
            >
              <div className="text-[11px] text-zinc-500 mb-1">{item.label}</div>
              <div
                className={`text-[13px] font-semibold font-mono tabular-nums ${"color" in item && item.color ? item.color : ""}`}
              >
                {"raw" in item && item.raw != null ? (
                  <NumberTicker
                    value={item.raw}
                    fallback={item.value}
                    format={"format" in item ? item.format as Intl.NumberFormatOptions : undefined}
                    suffix={"suffix" in item ? item.suffix : undefined}
                  />
                ) : (
                  item.value
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {actionStatus && (
        <div
          className={`surface-1 rounded-[12px] p-3 text-[12px] ${
            actionStatus.tone === "success"
              ? "text-success"
              : actionStatus.tone === "pending"
              ? "text-accent"
              : "text-danger"
          }`}
        >
          {actionStatus.message}
          {actionStatus.hash && (
            <a
              href={explorerTxUrl(actionStatus.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 underline"
            >
              View on Explorer
            </a>
          )}
        </div>
      )}

      {/* Open Positions */}
      <div className="surface-1 rounded-[16px] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-[13px] font-display font-semibold">
            Open Positions ({positions.length})
          </h3>
          {(loading || refreshing) && (
            <span className="text-[11px] text-zinc-500">updating...</span>
          )}
        </div>

        {positions.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-zinc-500">
            No open positions
          </div>
        ) : (
          <>
            <div className="md:hidden">
              <AnimatePresence initial={false}>
              {positions.map((p) => {
                const pnl = p.estimatedPnl;
                const pnlPct =
                  pnl !== null && p.marginUsed > 0
                    ? (pnl / p.marginUsed) * 100
                    : null;
                const pnlColor =
                  pnl === null
                    ? "text-zinc-500"
                    : pnl >= 0
                    ? "text-success"
                    : "text-danger";
                const fundingColor =
                  p.unrealizedFunding === null
                    ? "text-zinc-500"
                    : p.unrealizedFunding > 0
                    ? "text-success"
                    : p.unrealizedFunding < 0
                    ? "text-danger"
                    : "text-zinc-500";
                const actionKey = positionKey(p);
                const isClosing = closingPositionKeys.has(actionKey);
                const canClose = Boolean(
                  selectedSubaccount &&
                    !isClosing &&
                    Number.isFinite(Math.abs(p.size)) &&
                    Math.abs(p.size) > 0 &&
                    Number.isFinite(p.markPrice ?? p.entryPrice) &&
                    (p.markPrice ?? p.entryPrice) > 0
                );

                return (
                  <motion.div
                    key={actionKey}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16, ease: "easeOut" }}
                    className="border-b border-white/5 px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-zinc-100">
                          {p.market}
                        </div>
                        <div
                          className={`mt-1 text-[11px] font-semibold uppercase ${
                            p.isLong ? "text-success" : "text-danger"
                          }`}
                        >
                          {p.isLong ? "Long" : "Short"} {p.leverage}x
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleClosePosition(p)}
                        disabled={!canClose}
                        className="shrink-0 rounded-[8px] border border-white/10 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isClosing ? "Closing" : "Close"}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                      <div>
                        <div className="text-zinc-600">Size</div>
                        <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                          {Math.abs(p.size).toLocaleString(undefined, {
                            maximumFractionDigits: 6,
                          })}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Value</div>
                        <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                          {p.value !== null ? formatUsd(p.value) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-zinc-600">Entry / Mark</div>
                        <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                          {formatPrice(p.entryPrice)} / {p.markPrice !== null ? formatPrice(p.markPrice) : "—"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Est. PnL</div>
                        <div className={`mt-0.5 font-mono tabular-nums ${pnlColor}`}>
                          {pnl !== null ? formatUsd(pnl, { signed: true }) : "—"}
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
                        <div className="mt-0.5 font-mono tabular-nums text-zinc-400">
                          {p.estimatedLiquidationPrice !== null
                            ? formatPrice(p.estimatedLiquidationPrice)
                            : "—"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-600">Margin / Funding</div>
                        <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                          {p.marginUsed > 0 ? formatUsd(p.marginUsed) : "—"}
                          <span className={`ml-2 ${fundingColor}`}>
                            {p.unrealizedFunding !== null
                              ? formatUsd(p.unrealizedFunding, { signed: true })
                              : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
              </AnimatePresence>
            </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/5 text-zinc-500">
                  <th className="text-left px-4 py-2 font-medium">Market</th>
                  <th className="text-right px-4 py-2 font-medium">Side</th>
                  <th className="text-right px-4 py-2 font-medium">Size</th>
                  <th className="text-right px-4 py-2 font-medium">Value</th>
                  <th className="text-right px-4 py-2 font-medium">Entry</th>
                  <th className="text-right px-4 py-2 font-medium">Mark</th>
                  <th className="text-right px-4 py-2 font-medium">Est. PnL</th>
                  <th className="text-right px-4 py-2 font-medium">Liq.</th>
                  <th className="text-right px-4 py-2 font-medium">Margin</th>
                  <th className="text-right px-4 py-2 font-medium">Funding</th>
                  <th className="text-right px-4 py-2 font-medium">TP/SL</th>
                  <th className="text-right px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p, i) => {
                  const pnl = p.estimatedPnl;
                  const pnlPctDenom = p.marginUsed > 0 ? p.marginUsed : 0;
                  const pnlPct =
                    pnl !== null && pnlPctDenom > 0
                      ? (pnl / pnlPctDenom) * 100
                      : null;
                  const pnlColor =
                    pnl === null
                      ? "text-zinc-500"
                      : pnl >= 0
                      ? "text-success"
                      : "text-danger";
                  const fundingColor =
                    p.unrealizedFunding === null
                      ? "text-zinc-500"
                      : p.unrealizedFunding > 0
                      ? "text-success"
                      : p.unrealizedFunding < 0
                      ? "text-danger"
                      : "text-zinc-500";
                  const actionKey = positionKey(p);
                  const isClosing = closingPositionKeys.has(actionKey);
                  const canClose = Boolean(
                    selectedSubaccount &&
                      !isClosing &&
                      Number.isFinite(Math.abs(p.size)) &&
                      Math.abs(p.size) > 0 &&
                      Number.isFinite(p.markPrice ?? p.entryPrice) &&
                      (p.markPrice ?? p.entryPrice) > 0
                  );

                  return (
                    <tr
                      key={`${p.marketAddress ?? p.market}:${p.isLong ? "L" : "S"}:${i}`}
                      className="border-b border-white/5"
                    >
                      <td className="px-4 py-3 font-medium">{p.market}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          p.isLong ? "text-success" : "text-danger"
                        }`}
                      >
                        {p.isLong ? "LONG" : "SHORT"} {p.leverage}x
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {Math.abs(p.size).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {p.value !== null ? formatUsd(p.value) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatPrice(p.entryPrice)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {p.markPrice !== null ? formatPrice(p.markPrice) : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${pnlColor}`}
                      >
                        {pnl !== null ? formatUsd(pnl, { signed: true }) : "—"}
                        {pnlPct !== null && (
                          <span className="text-zinc-500 ml-1">
                            ({pnlPct >= 0 ? "+" : ""}
                            {pnlPct.toFixed(2)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-500 font-mono tabular-nums">
                        {p.estimatedLiquidationPrice !== null
                          ? formatPrice(p.estimatedLiquidationPrice)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {p.marginUsed > 0 ? formatUsd(p.marginUsed) : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono tabular-nums ${fundingColor}`}
                      >
                        {p.unrealizedFunding !== null
                          ? formatUsd(p.unrealizedFunding, { signed: true })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-500 tabular-nums">
                        {p.tpTriggerPrice
                          ? `TP:${p.tpTriggerPrice.toFixed(0)}`
                          : ""}
                        {p.tpTriggerPrice && p.slTriggerPrice ? " / " : ""}
                        {p.slTriggerPrice
                          ? `SL:${p.slTriggerPrice.toFixed(0)}`
                          : ""}
                        {!p.tpTriggerPrice && !p.slTriggerPrice ? "—" : ""}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleClosePosition(p)}
                          disabled={!canClose}
                          className="rounded-[8px] border border-white/10 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isClosing ? "Closing" : "Close"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Open Orders */}
      {openOrders.length > 0 && (
        <div className="surface-1 rounded-[16px] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5">
            <h3 className="text-[13px] font-display font-semibold">
              Open Orders ({openOrders.length})
            </h3>
          </div>
          <div className="md:hidden">
            <AnimatePresence initial={false}>
            {openOrders.map((o) => {
              const orderId = String(o.orderId);
              const isCanceling = cancelingOrderIds.has(orderId);
              const canCancel = Boolean(
                selectedSubaccount &&
                  o.marketAddress &&
                  !isCanceling
              );

              return (
                <motion.div
                  key={orderId}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                  className="border-b border-white/5 px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-zinc-100">
                        {o.market}
                      </div>
                      <div
                        className={`mt-1 text-[11px] font-semibold uppercase ${
                          o.isBuy ? "text-success" : "text-danger"
                        }`}
                      >
                        {o.isBuy ? "Buy" : "Sell"} · {o.status ?? "Open"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCancelOrder(o)}
                      disabled={!canCancel}
                      className="shrink-0 rounded-[8px] border border-white/10 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isCanceling ? "Canceling" : "Cancel"}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div>
                      <div className="text-zinc-600">Price</div>
                      <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                        ${Number(o.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-zinc-600">Remaining / Original</div>
                      <div className="mt-0.5 font-mono tabular-nums text-zinc-200">
                        {Number(o.remainingSize).toFixed(4)} / {Number(o.origSize).toFixed(4)}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            </AnimatePresence>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/5 text-zinc-500">
                  <th className="text-left px-4 py-2 font-medium">Market</th>
                  <th className="text-right px-4 py-2 font-medium">Side</th>
                  <th className="text-right px-4 py-2 font-medium">Price</th>
                  <th className="text-right px-4 py-2 font-medium">
                    Size (Remaining)
                  </th>
                  <th className="text-right px-4 py-2 font-medium">Type</th>
                  <th className="text-right px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((o) => {
                  const orderId = String(o.orderId);
                  const isCanceling = cancelingOrderIds.has(orderId);
                  const canCancel = Boolean(
                    selectedSubaccount &&
                      o.marketAddress &&
                      !isCanceling
                  );

                  return (
                    <tr
                      key={orderId}
                      className="border-b border-white/5"
                    >
                      <td className="px-4 py-3 font-medium">{o.market}</td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          o.isBuy ? "text-success" : "text-danger"
                        }`}
                      >
                        {o.isBuy ? "BUY" : "SELL"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        ${Number(o.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {Number(o.remainingSize).toFixed(4)} / {Number(o.origSize).toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-500">
                        {o.details}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">
                          {o.status ?? "Open"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleCancelOrder(o)}
                          disabled={!canCancel}
                          className="rounded-[8px] border border-white/10 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isCanceling ? "Canceling" : "Cancel"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
