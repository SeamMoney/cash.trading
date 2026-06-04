"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleSlash2, Minus, Plus } from "lucide-react";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";

interface OrderBookProps {
  marketName: string;
  marketAddress?: string;
  onPriceClick?: (price: number) => void;
  currentPrice?: number;
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
const LADDER_ROWS = 39;
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

function buildLadderRows(book: OrderBookData, centerPrice: number, step: number): LadderRow[] {
  const half = Math.floor(LADDER_ROWS / 2);
  const center = Number(snapStep(centerPrice, step).toFixed(8));
  const bidMap = new Map<number, number>();
  const askMap = new Map<number, number>();

  book.bids.slice(0, DISPLAY_LEVELS * 2).forEach((level) => {
    addToBucket(bidMap, level.price, level.size, step);
  });
  book.asks.slice(0, DISPLAY_LEVELS * 2).forEach((level) => {
    addToBucket(askMap, level.price, level.size, step);
  });

  return Array.from({ length: LADDER_ROWS }, (_, index) => {
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
      className="group relative grid h-[22px] w-full grid-cols-[minmax(0,1fr)_116px_minmax(0,1fr)] items-center overflow-hidden font-mono text-[12px] tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.04]"
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
              style={{ right: `calc(${bidPct}% + 5px)`, color: POSITIVE }}
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
              style={{ left: `calc(${askPct}% + 5px)`, color: NEGATIVE }}
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
}: OrderBookProps) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [book, setBook] = useState<OrderBookData>({
    bids: [],
    asks: [],
    timestamp: null,
  });
  const [status, setStatus] = useState<"loading" | "live" | "waiting" | "unavailable">("loading");
  const [qty, setQty] = useState(1);
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
  const rows = useMemo(() => buildLadderRows(book, displayPrice || 1, step), [book, displayPrice, step]);
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

  return (
    <section className="overflow-hidden bg-black text-zinc-100">
      <div className="border-b border-white/[0.08] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="font-sans text-[15px] leading-tight text-zinc-500">
            <div>▲ -- Open P&amp;L</div>
            <div className="mt-1">▲ -- Day P&amp;L</div>
          </div>
          <div className="flex items-start gap-2 text-right">
            <div className="font-sans text-[15px] leading-tight text-zinc-500">
              <div>No position</div>
              <div className="mt-1">0 open orders</div>
            </div>
            <button
              type="button"
              aria-label="No active position"
              className="flex size-9 items-center justify-center rounded-md bg-white/[0.08] text-zinc-500"
            >
              <CircleSlash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_96px_1fr] gap-2">
          <button
            type="button"
            className="h-9 rounded-md bg-white/[0.1] px-3 text-left font-mono text-[13px] font-black"
            style={{ color: POSITIVE }}
          >
            Buy MKT
          </button>
          <div className="grid grid-cols-[30px_1fr_30px] items-center gap-1 rounded-md bg-white/[0.08] p-1">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQty((value) => Math.max(1, value - 1))}
              className="flex size-7 items-center justify-center rounded bg-white/[0.08] text-zinc-500"
            >
              <Minus className="size-3" aria-hidden="true" />
            </button>
            <div className="text-center font-mono text-[18px] font-bold text-zinc-200 tabular-nums">{qty}</div>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQty((value) => Math.min(999, value + 1))}
              className="flex size-7 items-center justify-center rounded bg-white/[0.08] text-zinc-200"
            >
              <Plus className="size-3" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="h-9 rounded-md bg-white/[0.1] px-3 text-right font-mono text-[13px] font-black"
            style={{ color: NEGATIVE }}
          >
            Short MKT
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-1 font-mono text-[10px] uppercase text-zinc-700">
        <span>{marketName.replace("/USD", "")}</span>
        <span>{statusText}</span>
      </div>

      <div className="h-[520px] overflow-hidden border-y border-white/[0.06] py-1 sm:h-[560px]">
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

      <div className="flex items-center justify-between px-3 py-1 font-mono text-[10px] text-zinc-700">
        <span>{book.timestamp ? new Date(book.timestamp).toLocaleTimeString() : "--:--:--"}</span>
        <span>{formatPrice(displayPrice || 0)}</span>
      </div>
    </section>
  );
}
