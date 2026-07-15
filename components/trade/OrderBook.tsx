"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { cn } from "@/lib/utils";

interface OrderBookProps {
  marketName: string;
  marketAddress?: string;
  onPriceClick?: (price: number) => void;
  currentPrice?: number;
  className?: string;
  rowCount?: number;
}

interface Level {
  price: number;
  size: number;
}

interface OrderBookData {
  bids: Level[];
  asks: Level[];
  timestamp: number | null;
}

interface TradePrint {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell" | "unknown";
  timestamp: number;
  txRef?: string;
}

interface LadderRow {
  price: number;
  bidSize: number;
  askSize: number;
}

const DISPLAY_LEVELS = 20;
const DEFAULT_LADDER_ROWS = 39;
const POSITIVE = "#00d20c";
const NEGATIVE = "#ff5000";
const POSITIVE_ALPHA = "rgba(0, 210, 12, 0.18)";
const NEGATIVE_ALPHA = "rgba(255, 80, 0, 0.20)";
const CENTER_BG = "#1f1f22";
const MAX_TRADES = 80;

function priceDecimals(price: number) {
  if (price >= 10_000) return 2;
  if (price >= 1_000) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  return 6;
}

function formatPrice(price: number) {
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
    };
  });
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
    rawSide.includes("buy") || rawSide.includes("long") || rawSide === "true"
      ? "buy"
      : rawSide.includes("sell") || rawSide.includes("short") || rawSide === "false"
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

function explorerTxnUrl(txRef: string, network: DecibelPublicNetwork) {
  const suffix = network === "mainnet" ? "" : "?network=testnet";
  return `https://explorer.aptoslabs.com/txn/${txRef}${suffix}`;
}

function formatTime(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "--:--:--";
}

function LadderRowView({
  row,
  center,
  maxSize,
  onPriceClick,
}: {
  row: LadderRow;
  center: number;
  maxSize: number;
  onPriceClick?: (price: number) => void;
}) {
  const isCenter = Math.abs(row.price - center) < 1e-8;
  const bidPct = maxSize > 0 ? Math.min(100, (row.bidSize / maxSize) * 100) : 0;
  const askPct = maxSize > 0 ? Math.min(100, (row.askSize / maxSize) * 100) : 0;

  return (
    <button
      type="button"
      onClick={() => onPriceClick?.(row.price)}
      className={cn(
        "group relative grid h-full min-h-6 w-full grid-cols-3 items-center overflow-hidden font-mono text-[12px] tabular-nums transition-colors hover:bg-white/[0.03] sm:text-[13px]",
      )}
    >
      <div className="relative h-full min-w-0">
        {row.bidSize > 0 && (
          <>
            <div
              className="absolute right-0 top-1/2 h-[18px] -translate-y-1/2 rounded-[2px]"
              style={{
                width: `max(1px, calc(${bidPct}% - 4px))`,
                backgroundColor: POSITIVE_ALPHA,
              }}
            />
            <span
              className="absolute top-1/2 w-16 -translate-y-1/2 text-right font-bold leading-none sm:w-20"
              style={{
                right: `min(calc(${bidPct}% + 4px), calc(100% - 4rem))`,
                color: POSITIVE,
              }}
            >
              {formatSize(row.bidSize)}
            </span>
          </>
        )}
      </div>

      <span
        className="relative z-[1] flex h-full min-w-0 items-center justify-center px-1"
        style={{
          color: isCenter ? "#ffffff" : "#85858b",
          fontWeight: isCenter ? 700 : 400,
        }}
      >
        {isCenter ? (
          <span
            className="rounded-[4px] px-[10px] py-[2px] leading-none"
            style={{ backgroundColor: CENTER_BG, boxShadow: `0 0 0 1px ${POSITIVE}` }}
          >
            {formatPrice(row.price)}
          </span>
        ) : (
          formatPrice(row.price)
        )}
      </span>

      <div className="relative h-full min-w-0">
        {row.askSize > 0 && (
          <>
            <div
              className="absolute left-0 top-1/2 h-[18px] -translate-y-1/2 rounded-[2px]"
              style={{
                width: `max(1px, calc(${askPct}% - 4px))`,
                backgroundColor: NEGATIVE_ALPHA,
              }}
            />
            <span
              className="absolute top-1/2 w-16 -translate-y-1/2 text-left font-bold leading-none sm:w-20"
              style={{
                left: `min(calc(${askPct}% + 4px), calc(100% - 4rem))`,
                color: NEGATIVE,
              }}
            >
              {formatSize(row.askSize)}
            </span>
          </>
        )}
      </div>
    </button>
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
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
      <div className="grid shrink-0 grid-cols-[72px_1fr_1fr_52px] gap-x-2 border-b border-white/[0.06] pb-1 font-mono text-[9px] uppercase text-zinc-600">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Tx</span>
      </div>
      {trades.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 scrollbar-thin">
          <div
            className="grid min-h-full"
            style={{ gridTemplateRows: `repeat(${trades.length}, minmax(28px, 1fr))` }}
          >
            {trades.map((trade) => (
              <div
                key={`${trade.id}:${trade.txRef ?? ""}:${trade.timestamp}`}
                className="grid h-full min-h-7 grid-cols-[72px_1fr_1fr_52px] items-center gap-x-2 rounded-[4px] font-mono text-[11px] tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.03]"
              >
                <span className="truncate text-zinc-600">{formatTime(trade.timestamp)}</span>
                <span
                  className="text-right font-semibold"
                  style={{ color: trade.side === "sell" ? NEGATIVE : trade.side === "buy" ? POSITIVE : "#d4d4d8" }}
                >
                  {formatPrice(trade.price)}
                </span>
                <span className="truncate text-right text-zinc-400">{formatSize(trade.size)}</span>
                {trade.txRef ? (
                  <a
                    href={explorerTxnUrl(trade.txRef, network)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-right text-zinc-500 underline-offset-2 hover:text-zinc-200 hover:underline"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-right text-zinc-700">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-48 items-center justify-center text-center font-mono text-[12px] text-zinc-600">
          {status === "loading" ? "Loading trades..." : "Waiting for live trades"}
        </div>
      )}
    </div>
  );
}

export function OrderBook({
  marketName,
  marketAddress,
  onPriceClick,
  currentPrice,
  className,
  rowCount = DEFAULT_LADDER_ROWS,
}: OrderBookProps) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [book, setBook] = useState<OrderBookData>({
    bids: [],
    asks: [],
    timestamp: null,
  });
  const [status, setStatus] = useState<"loading" | "live" | "waiting" | "unavailable">("loading");
  const [trades, setTrades] = useState<TradePrint[]>([]);
  const [tradesStatus, setTradesStatus] = useState<"loading" | "live" | "waiting" | "unavailable">("loading");
  const [activeTab, setActiveTab] = useState<"book" | "trades">("book");
  const previousPriceRef = useRef(currentPrice ?? 0);

  const resolvedMarketAddress =
    marketAddress ??
    Object.values(PERP_MARKET_DATA).find((market) => market.marketName === marketName)
      ?.marketAddr;

  useEffect(() => onDecibelPublicNetworkChange(setNetwork), []);

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
    setTrades((current) => mergeTrades(current, nextTrades));
    setTradesStatus("live");
    return true;
  }, []);

  useEffect(() => {
    if (!resolvedMarketAddress) {
      setTrades([]);
      setTradesStatus("unavailable");
      return;
    }
    let cancelled = false;
    setTrades([]);
    setTradesStatus("loading");

    const loadTrades = async () => {
      try {
        const params = new URLSearchParams({
          resource: "trades",
          network,
          marketAddr: resolvedMarketAddress,
          limit: "80",
          timeoutMs: "3500",
        });
        const response = await fetch(`/api/decibel/public?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load trades");
        const json = await response.json();
        if (cancelled) return;
        const nextTrades = collectTrades(json);
        setTrades(nextTrades.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_TRADES));
        setTradesStatus(nextTrades.length > 0 ? "live" : "waiting");
      } catch {
        if (!cancelled) setTradesStatus("waiting");
      }
    };

    void loadTrades();
    return () => {
      cancelled = true;
    };
  }, [network, resolvedMarketAddress]);

  useEffect(() => {
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
        network,
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
  }, [ingestDepth, ingestTrades, network, resolvedMarketAddress]);

  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const displayPrice = currentPrice && currentPrice > 0 ? currentPrice : midPrice ?? previousPriceRef.current;

  useEffect(() => {
    if (displayPrice && displayPrice > 0) previousPriceRef.current = displayPrice;
  }, [displayPrice]);

  const step = useMemo(() => inferStep(book, displayPrice || 1), [book, displayPrice]);
  const center = Number(snapStep(displayPrice || 1, step).toFixed(8));
  const visibleRowCount = Math.max(13, Math.min(45, rowCount));
  const rows = useMemo(
    () => buildLadderRows(book, displayPrice || 1, step, visibleRowCount),
    [book, displayPrice, step, visibleRowCount],
  );
  const maxSize = useMemo(
    () => Math.max(1, ...rows.flatMap((row) => [row.bidSize, row.askSize])),
    [rows],
  );

  const statusText =
    activeTab === "trades"
      ? tradesStatus === "live"
        ? `${trades.length} trades`
        : tradesStatus === "loading"
          ? "loading"
          : tradesStatus === "waiting"
            ? "waiting"
            : "unavailable"
      : status === "live"
        ? `${book.bids.length + book.asks.length} levels`
        : status === "loading"
        ? "loading"
        : status === "waiting"
          ? "waiting"
          : "unavailable";
  const symbol = marketName.replace("/USD", "").replace("-PERP", "");

  return (
    <section className={cn("surface-1 flex min-h-[320px] flex-col overflow-hidden rounded-[16px] bg-[#111111] text-zinc-100", className)}>
      <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2 font-mono text-[10px] uppercase text-zinc-600">
        <div className="flex items-center gap-3">
          <span>{symbol}</span>
          <div className="flex items-center rounded-[6px] bg-white/[0.03] p-0.5">
            {(["book", "trades"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "rounded-[5px] px-2 py-0.5 text-[9px] transition-colors",
                  activeTab === tab
                    ? "bg-white/[0.08] text-zinc-200"
                    : "text-zinc-600 hover:text-zinc-400",
                )}
              >
                {tab === "book" ? "Book" : "Trades"}
              </button>
            ))}
          </div>
        </div>
        <span>{statusText}</span>
      </div>

      {activeTab === "book" ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          <div
            className="grid min-h-full py-1"
            style={{ gridTemplateRows: `repeat(${rows.length}, minmax(24px, 1fr))` }}
          >
            {rows.map((row) => (
              <LadderRowView
                key={row.price}
                row={row}
                center={center}
                maxSize={maxSize}
                onPriceClick={onPriceClick}
              />
            ))}
          </div>
        </div>
      ) : (
        <TradesTable trades={trades} network={network} status={tradesStatus} />
      )}

      <div className="flex items-center justify-between border-t border-white/[0.08] px-3 py-2 font-mono text-[10px] text-zinc-700">
        <span>{formatTime(activeTab === "book" ? book.timestamp : trades[0]?.timestamp ?? null)}</span>
        <span>{formatPrice(displayPrice || 0)}</span>
      </div>
    </section>
  );
}
