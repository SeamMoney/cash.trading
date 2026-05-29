"use client";

import { useState, useEffect, useCallback } from "react";
import { getDecibelPublicNetwork } from "@/lib/decibel-public";
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

/**
 * Real orderbook component using Decibel's authenticated WebSocket stream
 * through the server-side SSE proxy. SDK 0.4 exposes depth as a stream, not a
 * REST reader, so this is the primary depth path.
 */
export function OrderBook({ marketName, marketAddress, onPriceClick }: OrderBookProps) {
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

  const ingestDepth = useCallback((message: any) => {
    const bids = Array.isArray(message?.bids) ? message.bids : message?.depth?.bids;
    const asks = Array.isArray(message?.asks) ? message.asks : message?.depth?.asks;
    if (!Array.isArray(bids) || !Array.isArray(asks)) return;

    setBook({
      bids: bids.slice(0, 15),
      asks: asks.slice(0, 15),
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

    const connect = () => {
      if (cancelled) return;
      const params = new URLSearchParams({
        network: getDecibelPublicNetwork(),
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
  }, [ingestDepth, resolvedMarketAddress]);

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

  // Calculate cumulative totals and max for depth visualization
  let askCumulative = 0;
  const asksWithCumulative = [...book.asks]
    .reverse() // lowest ask at bottom
    .map((level) => {
      askCumulative += level.size;
      return { ...level, cumulative: askCumulative };
    })
    .reverse();

  let bidCumulative = 0;
  const bidsWithCumulative = book.bids.map((level) => {
    bidCumulative += level.size;
    return { ...level, cumulative: bidCumulative };
  });

  const maxCumulative = Math.max(askCumulative, bidCumulative, 1);

  // Midpoint = average of best bid and best ask
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const midPrice =
    bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadPct =
    spread && midPrice ? ((spread / midPrice) * 100).toFixed(3) : null;

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
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (sells) — displayed highest price at top, lowest near spread */}
      <div className="max-h-52 overflow-y-auto no-scrollbar flex flex-col-reverse">
        {asksWithCumulative.map((level, i) => {
          const depthPct = (level.cumulative / maxCumulative) * 100;
          return (
            <button
              key={`ask-${i}`}
              onClick={() => onPriceClick?.(level.price)}
              className="relative grid grid-cols-3 px-4 py-[2.5px] text-[11px] w-full hover:bg-red-500/10 transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-red-500/8"
                style={{ width: `${depthPct}%` }}
              />
              <span className="relative text-danger font-mono tabular-nums">
                {level.price.toFixed(2)}
              </span>
              <span className="relative text-right font-mono tabular-nums">
                {level.size.toFixed(4)}
              </span>
              <span className="relative text-right text-zinc-500 font-mono tabular-nums">
                {level.cumulative.toFixed(4)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Spread / Mid Price */}
      <div className="px-4 py-1.5 border-y border-white/[0.06] bg-[#141414] flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">Spread</span>
        {spread !== null && (
          <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
            {spread.toFixed(2)} ({spreadPct}%)
          </span>
        )}
      </div>

      {/* Bids (buys) — highest bid at top, descending */}
      <div className="max-h-52 overflow-y-auto no-scrollbar">
        {bidsWithCumulative.map((level, i) => {
          const depthPct = (level.cumulative / maxCumulative) * 100;
          return (
            <button
              key={`bid-${i}`}
              onClick={() => onPriceClick?.(level.price)}
              className="relative grid grid-cols-3 px-4 py-[2.5px] text-[11px] w-full hover:bg-green-500/10 transition-colors"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-green-500/8"
                style={{ width: `${depthPct}%` }}
              />
              <span className="relative text-success font-mono tabular-nums">
                {level.price.toFixed(2)}
              </span>
              <span className="relative text-right font-mono tabular-nums">
                {level.size.toFixed(4)}
              </span>
              <span className="relative text-right text-zinc-500 font-mono tabular-nums">
                {level.cumulative.toFixed(4)}
              </span>
            </button>
          );
        })}
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
