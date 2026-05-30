"use client";

import { memo, useEffect, useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
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

interface CumulativeLevel extends Level {
  cumulative: number;
}

interface OrderBookData {
  bids: Level[];
  asks: Level[];
  timestamp: number | null;
}

const DISPLAY_LEVELS = 16;

function priceDecimals(price: number) {
  if (price >= 1_000) return 1;
  if (price >= 10) return 2;
  return 4;
}

function usePriceFlash<T extends HTMLElement = HTMLElement>(
  price: number,
): RefObject<T> {
  const ref = useRef<T>(null);
  const prevRef = useRef(price);

  useEffect(() => {
    const element = ref.current;
    if (!element || price === prevRef.current) return;

    const isUp = price > prevRef.current;
    prevRef.current = price;
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(
      [
        { backgroundColor: isUp ? "rgba(57, 255, 20, 0.16)" : "rgba(242, 26, 26, 0.16)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 180, easing: "ease-out", fill: "none" },
    );
  }, [price]);

  return ref;
}

const OrderBookRow = memo(function OrderBookRow({
  level,
  side,
  maxTotal,
  onPriceClick,
}: {
  level: CumulativeLevel;
  side: "bid" | "ask";
  maxTotal: number;
  onPriceClick?: (price: number) => void;
}) {
  const flashRef = usePriceFlash<HTMLButtonElement>(level.price);
  const depthPct = maxTotal > 0 ? (level.cumulative / maxTotal) * 100 : 0;
  const formattedPrice = level.price.toLocaleString("en-US", {
    minimumFractionDigits: priceDecimals(level.price),
    maximumFractionDigits: priceDecimals(level.price),
  });

  return (
    <button
      ref={flashRef}
      type="button"
      onClick={() => onPriceClick?.(level.price)}
      className={`relative grid w-full grid-cols-3 px-4 py-[2.5px] text-[11px] transition-colors ${
        side === "bid" ? "hover:bg-green-500/10" : "hover:bg-red-500/10"
      }`}
    >
      <div
        className={`absolute inset-y-0 ${side === "bid" ? "left-0 bg-green-500/8" : "right-0 bg-red-500/8"}`}
        style={{ width: `${depthPct.toFixed(1)}%` }}
      />
      <span className="relative text-left font-mono tabular-nums text-zinc-400">
        {level.size.toFixed(4)}
      </span>
      <span
        className={`relative text-right font-mono font-medium tabular-nums ${
          side === "bid" ? "text-success" : "text-danger"
        }`}
      >
        {formattedPrice}
      </span>
      <span className="relative text-right font-mono tabular-nums text-zinc-500">
        {level.cumulative.toFixed(4)}
      </span>
    </button>
  );
});

function withCumulative(levels: Level[], reverse = false): CumulativeLevel[] {
  let cumulative = 0;
  const source = reverse ? [...levels].reverse() : levels;
  const next = source.map((level) => {
    cumulative += level.size;
    return { ...level, cumulative };
  });
  return reverse ? next.reverse() : next;
}

/**
 * Real orderbook component using Decibel's authenticated WebSocket stream
 * through the server-side SSE proxy. SDK 0.4 exposes depth as a stream, not a
 * REST reader, so this is the primary depth path.
 */
export function OrderBook({ marketName, marketAddress, onPriceClick }: OrderBookProps) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [book, setBook] = useState<OrderBookData>({
    bids: [],
    asks: [],
    timestamp: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedMarketAddress =
    marketAddress ??
    Object.values(PERP_MARKET_DATA).find((market) => market.marketName === marketName)
      ?.marketAddr;

  useEffect(() => onDecibelPublicNetworkChange(setNetwork), []);

  const ingestDepth = useCallback((message: any) => {
    const bids = Array.isArray(message?.bids) ? message.bids : message?.depth?.bids;
    const asks = Array.isArray(message?.asks) ? message.asks : message?.depth?.asks;
    if (!Array.isArray(bids) || !Array.isArray(asks)) return;

    setBook({
      bids: bids.slice(0, DISPLAY_LEVELS),
      asks: asks.slice(0, DISPLAY_LEVELS),
      timestamp: message.unix_ms ?? message.timestamp ?? Date.now(),
    });
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!resolvedMarketAddress) {
      setLoading(false);
      setError("Unknown Decibel market");
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stream: EventSource | null = null;
    let reconnectAttempt = 0;

    setLoading(true);
    setBook({ bids: [], asks: [], timestamp: null });
    setError(null);

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
          ingestDepth(message);
        } catch {
          // Ignore malformed frames and keep the stream open.
        }
      });

      stream.addEventListener("error", () => {
        if (cancelled) return;
        setError("Depth stream unavailable");
        setLoading(false);
        stream?.close();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(
          connect,
          Math.min(1000 * 1.5 ** reconnectAttempt, 8000)
        );
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream?.close();
    };
  }, [ingestDepth, network, resolvedMarketAddress]);

  const asksWithCumulative = useMemo(
    () => withCumulative(book.asks.slice(0, DISPLAY_LEVELS), true),
    [book.asks],
  );
  const bidsWithCumulative = useMemo(
    () => withCumulative(book.bids.slice(0, DISPLAY_LEVELS)),
    [book.bids],
  );
  const maxAskTotal = asksWithCumulative[0]?.cumulative ?? 0;
  const maxBidTotal = bidsWithCumulative[bidsWithCumulative.length - 1]?.cumulative ?? 0;

  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const midPrice =
    bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadPct =
    spread && midPrice ? ((spread / midPrice) * 100).toFixed(3) : null;

  if (loading) {
    return (
      <div className="rounded-[16px] bg-[#0e0e0e] border border-white/[0.06] p-4">
        <div className="text-[11px] font-display font-medium text-zinc-500 uppercase tracking-wider mb-3">Order Book</div>
        <div className="animate-pulse space-y-1">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-5 bg-zinc-800/50 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // If error and no data, show clean empty state
  if (error && book.bids.length === 0 && book.asks.length === 0) {
    return (
      <div className="rounded-[16px] bg-[#0e0e0e] border border-white/[0.06] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
          <h3 className="text-[11px] font-display font-semibold uppercase tracking-wider text-zinc-400">Order Book</h3>
          <span className="text-[10px] text-zinc-600">Unavailable</span>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="text-[11px] text-zinc-600 font-mono">No depth data for this market</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[16px] bg-[#0e0e0e] border border-white/[0.06] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h3 className="text-[11px] font-display font-semibold uppercase tracking-wider text-zinc-400">Order Book</h3>
        {error ? (
          <span className="text-[10px] text-zinc-600">Unavailable</span>
        ) : (
          <span className="text-[10px] text-zinc-600">
            Live · {book.bids.length + book.asks.length} levels
          </span>
        )}
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-4 py-1.5 text-[10px] text-zinc-600 font-semibold border-b border-white/[0.06]">
        <span>Size ({marketName.split("/")[0]})</span>
        <span className="text-right">Price</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (sells) — displayed highest price at top, lowest near spread */}
      <div className="max-h-52 overflow-y-auto no-scrollbar flex flex-col-reverse">
        {asksWithCumulative.map((level, i) => (
          <OrderBookRow
            key={`ask-${i}`}
            level={level}
            side="ask"
            maxTotal={maxAskTotal}
            onPriceClick={onPriceClick}
          />
        ))}
      </div>

      {/* Spread / Mid Price */}
      <div className="border-y border-white/[0.06] bg-[#141414] px-4 py-2">
        <div className="text-center font-mono text-[17px] font-bold tabular-nums text-white">
          {midPrice ? `$${midPrice.toLocaleString("en-US", { minimumFractionDigits: priceDecimals(midPrice), maximumFractionDigits: priceDecimals(midPrice) })}` : "—"}
        </div>
        {spread !== null && (
          <div className="mt-0.5 text-center text-[10px] font-mono tabular-nums text-zinc-500">
            Spread {spread.toFixed(2)} ({spreadPct}%)
          </div>
        )}
      </div>

      {/* Bids (buys) — highest bid at top, descending */}
      <div className="max-h-52 overflow-y-auto no-scrollbar">
        {bidsWithCumulative.map((level, i) => (
          <OrderBookRow
            key={`bid-${i}`}
            level={level}
            side="bid"
            maxTotal={maxBidTotal}
            onPriceClick={onPriceClick}
          />
        ))}
      </div>

      {/* Timestamp */}
      {book.timestamp && (
        <div className="px-4 py-1 border-t border-white/[0.06] text-[9px] text-zinc-600 text-right font-mono">
          {new Date(book.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
