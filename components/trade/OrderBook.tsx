"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import {
  onDecibelTradeConfirmed,
  type DecibelTradeConfirmedDetail,
} from "@/lib/decibel-trade-events";
import { cn } from "@/lib/utils";

type OrderBookStatus = "loading" | "live" | "waiting" | "unavailable";

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookTrade {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell" | "unknown";
  timestamp: number;
  txRef?: string;
}

export interface ControlledOrderBookData {
  book: {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
    timestamp: number | null;
  };
  status: OrderBookStatus;
  trades: OrderBookTrade[];
  tradesStatus: OrderBookStatus;
  network?: DecibelPublicNetwork;
  priceStep?: number;
}

interface OrderBookProps {
  marketName: string;
  marketAddress?: string;
  /** Pins this feed to a venue network instead of following Trade's selector. */
  networkOverride?: DecibelPublicNetwork;
  onPriceClick?: (price: number) => void;
  currentPrice?: number;
  className?: string;
  rowCount?: number;
  /**
   * Supplies a non-Decibel market to the same orderbook/trades renderer used on
   * the Trade page. When present, the component never opens Decibel feeds.
   */
  controlledData?: ControlledOrderBookData;
}

type Level = OrderBookLevel;

interface OrderBookData {
  bids: Level[];
  asks: Level[];
  timestamp: number | null;
}

type TradePrint = OrderBookTrade;

interface LadderRow {
  price: number;
  bidSize: number;
  askSize: number;
  isCenter: boolean;
}

const DISPLAY_LEVELS = 20;
/**
 * Ladder rows are price steps, not orders: buildLadderRows emits one row per
 * step whether or not the book has size there, so every row above the tallest
 * ceiling the venue actually quotes is guaranteed blank. 21 rows on the Trade
 * page rendered nine empty. 17 is the width SwapMarketLayout already settled
 * on, and it is the ceiling for every caller — the prop stays free to ask for
 * fewer.
 */
const MAX_LADDER_ROWS = 17;
const MIN_LADDER_ROWS = 11;
const DEFAULT_LADDER_ROWS = MAX_LADDER_ROWS;
// Theme tokens rather than literal hex so the light theme's --success /
// --danger remaps reach the ladder (a literal stays neon-on-white).
const POSITIVE_ALPHA = "color-mix(in srgb, var(--success) 18%, transparent)";
const NEGATIVE_ALPHA = "color-mix(in srgb, var(--danger) 20%, transparent)";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MAX_TRADES = 80;
const RECENT_TRADES_TIMEOUT_MS = 8_000;
const recentTradesCache = new Map<string, TradePrint[]>();
const recentTradesRequests = new Map<string, Promise<TradePrint[]>>();

function priceDecimals(price: number) {
  if (price >= 10_000) return 2;
  if (price >= 1_000) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  if (price >= 0.001) return 6;
  if (price >= 0.00000001) return 8;
  return 12;
}

function formatPrice(price: number) {
  if (!Number.isFinite(price) || price <= 0) return "—";
  const decimals = priceDecimals(price);
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (size >= 1_000) return `${(size / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (size >= 100) return size.toFixed(0);
  if (size >= 1) return size.toFixed(2).replace(/\.00$/, "");
  return size.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUsdNotional(price: number, size: number) {
  const value = price * size;
  if (!Number.isFinite(value) || value < 0) return "";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

function snapStep(price: number, step: number) {
  return Math.round(price / step) * step;
}

function inferFallbackStep(price: number) {
  if (price >= 10_000) return 2.5;
  if (price >= 1_000) return 0.5;
  if (price >= 100) return 0.25;
  if (price >= 10) return 0.05;
  if (price >= 1) return 0.005;
  if (price >= 0.1) return 0.0005;
  return 0.00005;
}

function inferStep(book: OrderBookData, center: number) {
  const prices = [...book.bids, ...book.asks]
    .map((level) => level.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  const diffs: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) diffs.push(diff);
  }
  if (diffs.length === 0) return inferFallbackStep(center);
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)] ?? inferFallbackStep(center);
  const fallback = inferFallbackStep(center);
  return Math.max(Math.min(median, fallback * 12), fallback);
}

function fitStepToTopOfBook(
  book: OrderBookData,
  center: number,
  minimumStep: number,
  rowCount: number,
) {
  if (!Number.isFinite(minimumStep) || minimumStep <= 0) return minimumStep;
  const half = Math.max(1, Math.floor(rowCount / 2));
  const topPrices = [book.bids[0]?.price, book.asks[0]?.price]
    .filter((price): price is number => Number.isFinite(price) && Number(price) > 0);
  const furthest = Math.max(0, ...topPrices.map((price) => Math.abs(price - center)));
  const requiredStep = furthest / half;
  if (requiredStep <= minimumStep * (1 + Number.EPSILON * 8)) return minimumStep;

  // When a market has an unusually wide spread, fit both sides using a clean
  // decimal display interval. Multiplying the tiny inferred tick by an
  // arbitrary integer produced misleading labels such as $1.008 for an
  // actual $1.00 ask. The familiar 1/2/2.5/5 sequence keeps real-world prices
  // on honest, readable buckets while preserving the exact shared renderer.
  const magnitude = 10 ** Math.floor(Math.log10(requiredStep));
  const normalized = requiredStep / magnitude;
  const niceNormalized = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return Math.max(minimumStep, niceNormalized * magnitude);
}

function addToBucket(map: Map<number, number>, price: number, size: number, step: number) {
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return;
  const snapped = Number(snapStep(price, step).toFixed(8));
  map.set(snapped, (map.get(snapped) ?? 0) + size);
}

function buildLadderRows(book: OrderBookData, centerPrice: number, step: number, rowCount: number): LadderRow[] {
  const half = Math.floor(rowCount / 2);
  const center = Number(snapStep(centerPrice, step).toFixed(8));
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();

  book.bids.slice(0, DISPLAY_LEVELS * 2).forEach((level) => {
    addToBucket(bidMap, level.price, level.size, step);
  });
  book.asks.slice(0, DISPLAY_LEVELS * 2).forEach((level) => {
    addToBucket(askMap, level.price, level.size, step);
  });

  return Array.from({ length: rowCount }, (_, index) => {
    const offset = half - index;
    const price = Number((center + offset * step).toFixed(8));
    return {
      price,
      bidSize: bidMap.get(price) ?? 0,
      askSize: askMap.get(price) ?? 0,
      isCenter: offset === 0,
    };
  })
    // A price step the venue does not quote is not a level. Emitting one
    // printed a price with an empty bid and ask column — six of seventeen rows
    // on the Trade page — which reads as depth that exists. Only the centre
    // row survives without size: it carries the mark, not an order.
    .filter((row) => row.isCenter || row.bidSize > 0 || row.askSize > 0);
}

function isDepthMessage(value: unknown): value is { bids?: Level[]; asks?: Level[]; depth?: { bids?: Level[]; asks?: Level[] }; unix_ms?: number; timestamp?: number } {
  return typeof value === "object" && value !== null;
}

function recordValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value != null) return value;
  }
  return undefined;
}

function normalizeLevels(levels: unknown): Level[] {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((level) => {
      const record = level as Record<string, unknown>;
      return {
        price: Number(record.price),
        size: Number(record.size),
      };
    })
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0);
}

function normalizeTimestamp(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 10_000_000_000 ? n * 1000 : n;
}

function normalizeTrade(value: unknown): TradePrint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const price = Number(recordValue(record, ["price", "px", "fill_price", "execution_price"]));
  const size = Number(recordValue(record, ["size", "sz", "quantity", "amount"]));
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null;

  const rawSide = String(
    recordValue(record, ["side", "action", "direction", "taker_side", "is_buy"]) ?? ""
  ).toLowerCase();
  const side =
    rawSide.includes("buy")
    || rawSide === "long"
    || rawSide.includes("openlong")
    || rawSide.includes("closeshort")
    || rawSide === "true"
      ? "buy"
      : rawSide.includes("sell")
        || rawSide === "short"
        || rawSide.includes("openshort")
        || rawSide.includes("closelong")
        || rawSide === "false"
        ? "sell"
        : "unknown";
  const timestamp = normalizeTimestamp(
    recordValue(record, ["transaction_unix_ms", "unix_ms", "timestamp", "time", "created_at"])
  );
  const txRefValue = recordValue(record, [
    "tx_hash",
    "transaction_hash",
    "hash",
    "txn_hash",
    "transaction_version",
    "version",
  ]);
  const txRef = txRefValue == null ? undefined : String(txRefValue);
  const rawId = recordValue(record, ["trade_id", "id", "order_id", "fill_id"]) ?? txRef;
  const id = String(rawId ?? `${timestamp}:${price}:${size}:${side}`);

  return { id, price, size, side, timestamp, txRef };
}

function collectTrades(value: unknown, out: TradePrint[] = []): TradePrint[] {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTrades(entry, out));
    return out;
  }
  if (typeof value !== "object" || value === null) return out;

  const trade = normalizeTrade(value);
  if (trade) {
    out.push(trade);
    return out;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["items", "trades", "trade", "data", "payload", "message"]) {
    if (record[key] != null) collectTrades(record[key], out);
  }
  return out;
}

function mergeTrades(current: TradePrint[], incoming: TradePrint[]) {
  if (incoming.length === 0) return current;
  const byKey = new Map<string, TradePrint>();
  for (const trade of [...incoming, ...current]) {
    const key = `${trade.id}:${trade.txRef ?? ""}:${trade.price}:${trade.size}:${trade.timestamp}`;
    if (!byKey.has(key)) byKey.set(key, trade);
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_TRADES);
}

function tradesCacheKey(network: DecibelPublicNetwork, marketAddress: string) {
  return `${network}:${marketAddress.toLowerCase()}`;
}

function storeRecentTrades(key: string, trades: TradePrint[]) {
  recentTradesCache.set(key, trades);
  if (recentTradesCache.size > 80) {
    const oldestKey = recentTradesCache.keys().next().value;
    if (oldestKey) recentTradesCache.delete(oldestKey);
  }
}

function loadRecentTrades(
  network: DecibelPublicNetwork,
  marketAddress: string,
): Promise<TradePrint[]> {
  const key = tradesCacheKey(network, marketAddress);
  const inFlight = recentTradesRequests.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const params = new URLSearchParams({
      resource: "trades",
      network,
      marketAddr: marketAddress,
      limit: String(MAX_TRADES),
      timeoutMs: String(RECENT_TRADES_TIMEOUT_MS),
    });
    const response = await fetch(`/api/decibel/public?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Could not load trades");
    const nextTrades = collectTrades(await response.json())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_TRADES);
    storeRecentTrades(key, nextTrades);
    return nextTrades;
  })().finally(() => {
    recentTradesRequests.delete(key);
  });

  recentTradesRequests.set(key, request);
  return request;
}

function explorerTxnUrl(txRef: string, network: DecibelPublicNetwork) {
  const suffix = network === "mainnet" ? "" : "?network=testnet";
  return `https://explorer.aptoslabs.com/txn/${txRef}${suffix}`;
}

function formatTime(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "--:--:--";
}

function LadderRowView({
  row,
  maxSize,
  onPriceClick,
}: {
  row: LadderRow;
  maxSize: number;
  onPriceClick?: (price: number) => void;
}) {
  const isCenter = row.isCenter;
  const bidPct = maxSize > 0 ? Math.min(100, (row.bidSize / maxSize) * 100) : 0;
  const askPct = maxSize > 0 ? Math.min(100, (row.askSize / maxSize) * 100) : 0;
  const bidLabel = row.bidSize > 0 ? formatSize(row.bidSize) : "No bid";
  const askLabel = row.askSize > 0 ? formatSize(row.askSize) : "No ask";

  return (
    <div
      role="row"
      className={cn(
        "group relative grid h-full min-h-6 w-full grid-cols-3 items-center overflow-hidden font-mono text-xs tabular-nums transition-colors hover:bg-white/[0.03] sm:text-[13px]",
      )}
    >
      <div role="cell" aria-label={bidLabel} className="relative h-full min-w-0">
        {row.bidSize > 0 && (
          <>
            <div
              aria-hidden="true"
              className="absolute right-0 top-1/2 h-[18px] -translate-y-1/2 rounded-none"
              style={{
                width: `max(1px, calc(${bidPct}% - 4px))`,
                backgroundColor: POSITIVE_ALPHA,
              }}
            />
            <span
              aria-hidden="true"
              className="absolute top-1/2 w-16 -translate-y-1/2 text-right font-bold leading-none text-success sm:w-20"
              style={{ right: `min(calc(${bidPct}% + 4px), calc(100% - 4rem))` }}
            >
              {formatSize(row.bidSize)}
            </span>
          </>
        )}
      </div>

      <span
        role="cell"
        aria-label={formatPrice(row.price)}
        className={cn(
          "relative z-[1] flex h-full min-w-0 items-center justify-center px-1",
          isCenter ? "font-bold text-foreground" : "font-normal text-zinc-400",
        )}
      >
        {onPriceClick && (
          <button
            type="button"
            onClick={() => onPriceClick(row.price)}
            aria-label={`Set price to ${formatPrice(row.price)}. Bid size ${bidLabel}. Ask size ${askLabel}.`}
            className={cn("absolute inset-y-0 -left-full -right-full z-10 rounded-[var(--radius-xs)]", FOCUS_RING, "focus-visible:ring-inset")}
          />
        )}
        {isCenter ? (
          <span className="rounded-[var(--radius-xs)] bg-background-tertiary px-2 py-0.5 leading-none ring-1 ring-accent">
            {formatPrice(row.price)}
          </span>
        ) : (
          formatPrice(row.price)
        )}
      </span>

      <div role="cell" aria-label={askLabel} className="relative h-full min-w-0">
        {row.askSize > 0 && (
          <>
            <div
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-[18px] -translate-y-1/2 rounded-none"
              style={{
                width: `max(1px, calc(${askPct}% - 4px))`,
                backgroundColor: NEGATIVE_ALPHA,
              }}
            />
            <span
              aria-hidden="true"
              className="absolute top-1/2 w-16 -translate-y-1/2 text-left font-bold leading-none text-danger sm:w-20"
              style={{ left: `min(calc(${askPct}% + 4px), calc(100% - 4rem))` }}
            >
              {formatSize(row.askSize)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function TradesTable({
  trades,
  network,
  status,
}: {
  trades: TradePrint[];
  network: DecibelPublicNetwork;
  status: "loading" | "live" | "waiting" | "unavailable";
}) {
  return (
    <div role="table" aria-label="Recent trades" className="flex min-h-0 flex-1 flex-col px-3 py-2">
      <div role="rowgroup">
        <div role="row" className="grid shrink-0 grid-cols-[72px_1fr_1fr_52px] gap-x-2 border-b border-card-border pb-1 font-mono text-[11px] uppercase text-zinc-400">
          <span role="columnheader">Time</span>
          <span role="columnheader" aria-label="Price and side" className="text-right">Price</span>
          <span role="columnheader" className="text-right">USD</span>
          <span role="columnheader" className="text-right">Tx</span>
        </div>
      </div>
      {trades.length > 0 ? (
        <div role="rowgroup" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 scrollbar-thin">
          <div
            className="grid min-h-full [--trade-row-min:44px] sm:[--trade-row-min:28px]"
            style={{ gridTemplateRows: `repeat(${trades.length}, minmax(var(--trade-row-min), 1fr))` }}
          >
            {trades.map((trade) => (
              <div
                key={`${trade.id}:${trade.txRef ?? ""}:${trade.timestamp}`}
                role="row"
                className="grid h-full min-h-11 grid-cols-[72px_1fr_1fr_52px] items-center gap-x-2 rounded-[var(--radius-xs)] font-mono text-[11px] tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.03] sm:min-h-7"
              >
                <span role="cell" className="truncate text-zinc-400">{formatTime(trade.timestamp)}</span>
                <span
                  role="cell"
                  aria-label={`${trade.side === "unknown" ? "Unknown side" : trade.side} ${formatPrice(trade.price)}`}
                  className={cn(
                    "text-right font-semibold",
                    trade.side === "sell" ? "text-danger" : trade.side === "buy" ? "text-success" : "text-zinc-300",
                  )}
                >
                  {formatPrice(trade.price)}
                </span>
                <span role="cell" className="truncate text-right text-zinc-400">
                  {formatUsdNotional(trade.price, trade.size)}
                </span>
                <span role="cell" className="text-right">
                  {trade.txRef ? (
                    <a
                      href={explorerTxnUrl(trade.txRef, network)}
                      target="_blank"
                      rel="noreferrer"
                      className={cn("inline-flex min-h-11 min-w-11 items-center justify-end rounded-[var(--radius-xs)] text-zinc-400 underline-offset-2 hover:text-zinc-200 hover:underline sm:min-h-6 sm:min-w-0", FOCUS_RING)}
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-48 items-center justify-center text-center font-mono text-xs text-zinc-400">
          {status === "loading"
            ? "Loading trades..."
            : status === "unavailable"
              ? "Trades unavailable"
              : "Waiting for live trades"}
        </div>
      )}
    </div>
  );
}

export function OrderBook({
  marketName,
  marketAddress,
  networkOverride,
  onPriceClick,
  currentPrice,
  className,
  rowCount = DEFAULT_LADDER_ROWS,
  controlledData,
}: OrderBookProps) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [book, setBook] = useState<OrderBookData>({
    bids: [],
    asks: [],
    timestamp: null,
  });
  const [status, setStatus] = useState<OrderBookStatus>("loading");
  const [trades, setTrades] = useState<TradePrint[]>([]);
  const [tradesStatus, setTradesStatus] = useState<OrderBookStatus>("loading");
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");
  const [feedActive, setFeedActive] = useState(false);
  const tabsId = useId();
  const surfaceRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<"book" | "trades", HTMLButtonElement | null>>({
    book: null,
    trades: null,
  });
  const previousPriceRef = useRef(currentPrice ?? 0);
  const isControlled = Boolean(controlledData);
  const effectiveNetwork = networkOverride ?? network;

  const resolvedMarketAddress =
    marketAddress ??
    Object.values(PERP_MARKET_DATA).find((market) => market.marketName === marketName)
      ?.marketAddr;
  const cacheKey = !isControlled && resolvedMarketAddress
    ? tradesCacheKey(effectiveNetwork, resolvedMarketAddress)
    : "";

  useEffect(() => {
    if (networkOverride) return;
    return onDecibelPublicNetworkChange(setNetwork);
  }, [networkOverride]);

  useEffect(() => {
    if (isControlled) return;
    const surface = surfaceRef.current;
    if (!surface || typeof IntersectionObserver === "undefined") {
      setFeedActive(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setFeedActive(Boolean(entry?.isIntersecting));
    }, { threshold: 0.01 });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [isControlled]);

  const ingestDepth = useCallback((message: unknown) => {
    if (!isDepthMessage(message)) return false;
    const bids = normalizeLevels(Array.isArray(message.bids) ? message.bids : message.depth?.bids);
    const asks = normalizeLevels(Array.isArray(message.asks) ? message.asks : message.depth?.asks);
    if (bids.length === 0 && asks.length === 0) return false;

    setBook({
      bids: bids.sort((a, b) => b.price - a.price).slice(0, DISPLAY_LEVELS * 2),
      asks: asks.sort((a, b) => a.price - b.price).slice(0, DISPLAY_LEVELS * 2),
      timestamp: message.unix_ms ?? message.timestamp ?? Date.now(),
    });
    setStatus("live");
    return true;
  }, []);

  const ingestTrades = useCallback((message: unknown) => {
    const nextTrades = collectTrades(message);
    if (nextTrades.length === 0) return false;
    setTrades((current) => {
      const merged = mergeTrades(current, nextTrades);
      if (cacheKey) storeRecentTrades(cacheKey, merged);
      return merged;
    });
    setTradesStatus("live");
    return true;
  }, [cacheKey]);

  useEffect(() => onDecibelTradeConfirmed((detail: DecibelTradeConfirmedDetail) => {
    if (isControlled || !feedActive) return;
    const addressMatches = Boolean(
      detail.marketAddress
      && resolvedMarketAddress
      && detail.marketAddress.toLowerCase() === resolvedMarketAddress.toLowerCase()
    );
    if (!addressMatches && detail.marketName !== marketName) return;
    ingestTrades({
      id: `confirmed:${detail.txRef}`,
      price: detail.price,
      size: detail.size,
      side: detail.side,
      timestamp: detail.timestamp,
      tx_hash: detail.txRef,
    });
  }), [feedActive, ingestTrades, isControlled, marketName, resolvedMarketAddress]);

  useEffect(() => {
    if (isControlled || !feedActive) return;
    if (!resolvedMarketAddress) {
      setTrades([]);
      setTradesStatus("unavailable");
      return;
    }
    let cancelled = false;
    const cached = recentTradesCache.get(cacheKey) ?? [];
    setTrades(cached);
    setTradesStatus(cached.length > 0 ? "live" : "loading");

    const loadTrades = async () => {
      try {
        const nextTrades = await loadRecentTrades(effectiveNetwork, resolvedMarketAddress);
        if (cancelled) return;
        setTrades((current) => {
          const merged = mergeTrades(current, nextTrades);
          storeRecentTrades(cacheKey, merged);
          return merged;
        });
        setTradesStatus(nextTrades.length > 0 ? "live" : "waiting");
      } catch {
        if (!cancelled) setTradesStatus("waiting");
      }
    };

    void loadTrades();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, effectiveNetwork, feedActive, isControlled, resolvedMarketAddress]);

  useEffect(() => {
    if (isControlled || !feedActive) return;
    if (!resolvedMarketAddress) {
      setStatus("unavailable");
      setBook({ bids: [], asks: [], timestamp: null });
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let noDepthTimer: ReturnType<typeof setTimeout> | null = null;
    let stream: EventSource | null = null;
    let reconnectAttempt = 0;

    setStatus("loading");
    setTradesStatus((current) => (current === "live" ? "live" : "loading"));
    setBook({ bids: [], asks: [], timestamp: null });

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        network: effectiveNetwork,
        topics: `depth:${resolvedMarketAddress}:1,trades:${resolvedMarketAddress}`,
      });
      stream = new EventSource(`/api/decibel/stream?${params.toString()}`);

      stream.addEventListener("open", () => {
        reconnectAttempt = 0;
      });

      stream.addEventListener("message", (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(event.data);
          if (message.success || message.type === "connected") return;
          const hasDepth = ingestDepth(message);
          const hasTrades = ingestTrades(message);
          if (hasDepth && noDepthTimer) {
            clearTimeout(noDepthTimer);
            noDepthTimer = null;
          }
          if (hasTrades) setTradesStatus("live");
        } catch {
          // Keep the stream alive on malformed frames.
        }
      });

      stream.addEventListener("error", () => {
        if (cancelled) return;
        setStatus((current) => (current === "live" ? "live" : "unavailable"));
        setTradesStatus((current) => (current === "live" ? "live" : "unavailable"));
        stream?.close();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(1000 * 1.5 ** reconnectAttempt, 8000));
      });
    };

    connect();
    noDepthTimer = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "live" ? "live" : "waiting"));
      if (!cancelled) setTradesStatus((current) => (current === "live" ? "live" : "waiting"));
    }, 2500);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (noDepthTimer) clearTimeout(noDepthTimer);
      stream?.close();
    };
  }, [effectiveNetwork, feedActive, ingestDepth, ingestTrades, isControlled, resolvedMarketAddress]);

  const renderedBook = controlledData?.book ?? book;
  const renderedStatus = controlledData?.status ?? status;
  const renderedTrades = controlledData?.trades ?? trades;
  const renderedTradesStatus = controlledData?.tradesStatus ?? tradesStatus;
  const renderedNetwork = controlledData?.network ?? effectiveNetwork;
  const bestBid = renderedBook.bids[0]?.price;
  const bestAsk = renderedBook.asks[0]?.price;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const displayPrice = currentPrice && currentPrice > 0 ? currentPrice : midPrice ?? previousPriceRef.current;

  useEffect(() => {
    if (displayPrice && displayPrice > 0) previousPriceRef.current = displayPrice;
  }, [displayPrice]);

  const visibleRowCount = Math.max(MIN_LADDER_ROWS, Math.min(MAX_LADDER_ROWS, rowCount));
  const step = useMemo(() => {
    const minimumStep = controlledData?.priceStep ?? inferStep(renderedBook, displayPrice || 1);
    return fitStepToTopOfBook(renderedBook, displayPrice || 1, minimumStep, visibleRowCount);
  }, [controlledData?.priceStep, displayPrice, renderedBook, visibleRowCount]);
  const rows = useMemo(
    () => displayPrice && displayPrice > 0
      ? buildLadderRows(renderedBook, displayPrice, step, visibleRowCount)
      : [],
    [renderedBook, displayPrice, step, visibleRowCount],
  );
  const maxSize = useMemo(
    () => Math.max(1, ...rows.flatMap((row) => [row.bidSize, row.askSize])),
    [rows],
  );

  const statusText =
    activeTab === "trades"
      ? renderedTradesStatus === "live"
        ? `${renderedTrades.length} trades`
        : renderedTradesStatus === "loading"
          ? "loading"
          : renderedTradesStatus === "waiting"
            ? "waiting"
            : "unavailable"
      : renderedStatus === "live"
        // The count names the rows on screen. It used to report every level in
        // the raw feed (40) above a 17-row ladder, so the header described a
        // book the user could not see.
        ? rows.length > 0 ? `${rows.length} levels` : "waiting"
        : renderedStatus === "loading"
        ? "loading"
        : renderedStatus === "waiting"
          ? "waiting"
          : "unavailable";
  const symbol = marketName.replace(/\/(?:USD|USDC|USDT)$/, "").replace("-PERP", "");
  const selectTab = (tab: "book" | "trades") => {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  };

  return (
    <section ref={surfaceRef} className={cn("flex min-h-[320px] flex-col overflow-hidden rounded-[var(--radius)] border border-card-border bg-background-secondary text-foreground", className)}>
      <div className="flex items-center justify-between border-b border-card-border px-3 py-2 font-mono text-[11px] uppercase text-zinc-400">
        <div className="flex items-center gap-3">
          <span>{symbol}</span>
          <div
            role="tablist"
            aria-label={`${symbol} market data`}
            aria-orientation="horizontal"
            className="flex items-center rounded-[var(--radius-xs)] bg-white/[0.03] p-0.5"
          >
            {(["book", "trades"] as const).map((tab) => (
              <button
                key={tab}
                ref={(node) => { tabRefs.current[tab] = node; }}
                type="button"
                role="tab"
                id={`${tabsId}-${tab}-tab`}
                aria-controls={`${tabsId}-panel`}
                aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    selectTab(tab === "book" ? "trades" : "book");
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    selectTab("book");
                  } else if (event.key === "End") {
                    event.preventDefault();
                    selectTab("trades");
                  }
                }}
                className={cn(
                  "min-h-11 min-w-11 rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] transition-colors sm:min-h-0 sm:min-w-0",
                  FOCUS_RING,
                  activeTab === tab
                    ? "bg-white/[0.08] text-foreground"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {tab === "book" ? "Book" : "Trades"}
              </button>
            ))}
          </div>
        </div>
        <span>{statusText}</span>
      </div>

      <div
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${activeTab}-tab`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === "book"
        && renderedStatus === "live"
        && renderedBook.bids.length + renderedBook.asks.length > 0
        && rows.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            <div
              role="table"
              aria-label={`${symbol} order book`}
              className="grid min-h-full py-1"
              style={{ gridTemplateRows: `repeat(${rows.length}, minmax(24px, 1fr))` }}
            >
              <div role="row" className="sr-only">
                <span role="columnheader">Bid size</span>
                <span role="columnheader">Price</span>
                <span role="columnheader">Ask size</span>
              </div>
              {rows.map((row) => (
                <LadderRowView
                  key={row.price}
                  row={row}
                  maxSize={maxSize}
                  onPriceClick={onPriceClick}
                />
              ))}
            </div>
          </div>
        ) : activeTab === "book" ? (
          <div className="flex min-h-48 flex-1 items-center justify-center text-center font-mono text-xs text-zinc-400">
            {renderedStatus === "loading"
              ? "Loading orderbook..."
              : renderedStatus === "unavailable"
                ? "Orderbook unavailable"
                : "Waiting for live orders"}
          </div>
        ) : (
          <TradesTable trades={renderedTrades} network={renderedNetwork} status={renderedTradesStatus} />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-card-border px-3 py-2 font-mono text-[11px] tabular-nums text-zinc-400">
        <span>{formatTime(activeTab === "book" ? renderedBook.timestamp : renderedTrades[0]?.timestamp ?? null)}</span>
        <span>{formatPrice(displayPrice || 0)}</span>
      </div>
    </section>
  );
}
