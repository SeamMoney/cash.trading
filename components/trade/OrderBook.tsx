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

interface LadderRow {
  price: number;
  bidSize: number;
  askSize: number;
}

const DISPLAY_LEVELS = 20;
const DEFAULT_LADDER_ROWS = 39;
const POSITIVE = "#52c83f";
const NEGATIVE = "#ff5b22";

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
      className="group relative grid h-full w-full grid-cols-[minmax(78px,1fr)_118px_minmax(78px,1fr)] items-center overflow-hidden font-mono text-[12px] tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.035]"
    >
      <div className="relative h-full">
        {row.bidSize > 0 && (
          <>
            <div
              className="absolute right-0 top-[3px] h-[16px]"
              style={{ width: `${bidPct}%`, backgroundColor: "rgba(82, 200, 63, 0.68)" }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 font-bold"
              style={{
                right: `min(calc(${bidPct}% + 5px), calc(100% - 52px))`,
                color: POSITIVE,
              }}
            >
              {formatSize(row.bidSize)}
            </span>
          </>
        )}
      </div>

      <span
        className="relative z-[1] flex h-full items-center justify-center text-[13px]"
        style={{
          color: isCenter ? "#ffffff" : "rgba(255,255,255,0.62)",
          backgroundColor: isCenter ? POSITIVE : "transparent",
          fontWeight: isCenter ? 800 : 500,
        }}
      >
        {formatPrice(row.price)}
      </span>

      <div className="relative h-full">
        {row.askSize > 0 && (
          <>
            <div
              className="absolute left-0 top-[3px] h-[16px]"
              style={{ width: `${askPct}%`, backgroundColor: "rgba(255, 91, 34, 0.64)" }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 font-bold"
              style={{
                left: `min(calc(${askPct}% + 5px), calc(100% - 52px))`,
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
  const previousPriceRef = useRef(currentPrice ?? 0);

  const resolvedMarketAddress =
    marketAddress ??
    Object.values(PERP_MARKET_DATA).find((market) => market.marketName === marketName)
      ?.marketAddr;

  useEffect(() => onDecibelPublicNetworkChange(setNetwork), []);

  const ingestDepth = useCallback((message: unknown) => {
    if (!isDepthMessage(message)) return;
    const bids = normalizeLevels(Array.isArray(message.bids) ? message.bids : message.depth?.bids);
    const asks = normalizeLevels(Array.isArray(message.asks) ? message.asks : message.depth?.asks);
    if (bids.length === 0 && asks.length === 0) return;

    setBook({
      bids: bids.sort((a, b) => b.price - a.price).slice(0, DISPLAY_LEVELS * 2),
      asks: asks.sort((a, b) => a.price - b.price).slice(0, DISPLAY_LEVELS * 2),
      timestamp: message.unix_ms ?? message.timestamp ?? Date.now(),
    });
    setStatus("live");
  }, []);

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
    setBook({ bids: [], asks: [], timestamp: null });

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        network,
        topics: `depth:${resolvedMarketAddress}:1`,
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
          if (noDepthTimer) {
            clearTimeout(noDepthTimer);
            noDepthTimer = null;
          }
          ingestDepth(message);
        } catch {
          // Keep the stream alive on malformed frames.
        }
      });

      stream.addEventListener("error", () => {
        if (cancelled) return;
        setStatus((current) => (current === "live" ? "live" : "unavailable"));
        stream?.close();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, Math.min(1000 * 1.5 ** reconnectAttempt, 8000));
      });
    };

    connect();
    noDepthTimer = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "live" ? "live" : "waiting"));
    }, 2500);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (noDepthTimer) clearTimeout(noDepthTimer);
      stream?.close();
    };
  }, [ingestDepth, network, resolvedMarketAddress]);

  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const displayPrice = currentPrice && currentPrice > 0 ? currentPrice : midPrice ?? previousPriceRef.current;

  useEffect(() => {
    if (displayPrice && displayPrice > 0) previousPriceRef.current = displayPrice;
  }, [displayPrice]);

  const step = useMemo(() => inferStep(book, displayPrice || 1), [book, displayPrice]);
  const center = Number(snapStep(displayPrice || 1, step).toFixed(8));
  const rows = useMemo(
    () => buildLadderRows(book, displayPrice || 1, step, rowCount),
    [book, displayPrice, rowCount, step],
  );
  const maxSize = useMemo(
    () => Math.max(1, ...rows.flatMap((row) => [row.bidSize, row.askSize])),
    [rows],
  );

  const statusText =
    status === "live"
      ? `${book.bids.length + book.asks.length} levels`
      : status === "loading"
        ? "loading"
        : status === "waiting"
          ? "waiting"
          : "unavailable";
  const symbol = marketName.replace("/USD", "").replace("-PERP", "");

  return (
    <section className={cn("surface-1 flex min-h-[320px] flex-col overflow-hidden rounded-[16px] text-zinc-100", className)}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2 font-mono text-[10px] uppercase text-zinc-600">
        <span>{symbol}</span>
        <span>{statusText}</span>
      </div>

      <div
        className="grid flex-1 overflow-hidden py-1"
        style={{ gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}
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

      <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-1 font-mono text-[10px] text-zinc-700">
        <span>{book.timestamp ? new Date(book.timestamp).toLocaleTimeString() : "--:--:--"}</span>
        <span>{formatPrice(displayPrice || 0)}</span>
      </div>
    </section>
  );
}
