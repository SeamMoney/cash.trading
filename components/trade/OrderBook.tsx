"use client";

import { useState, useEffect, useCallback } from "react";

interface OrderBookProps {
  marketName: string;
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
 * Real orderbook component using Decibel's marketDepth.getByName() via /api/decibel/depth.
 * Polls every 2 seconds for live bid/ask levels.
 */
export function OrderBook({ marketName, onPriceClick, currentPrice }: OrderBookProps) {
  const [book, setBook] = useState<OrderBookData>({
    bids: [],
    asks: [],
    timestamp: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBook = useCallback(async () => {
    if (!marketName) return;
    try {
      // URL-encode market name: "BTC/USD" → "BTC-USD" for URL safety
      const urlMarket = marketName.replace("/", "-");
      const priceHint = currentPrice && currentPrice > 0 ? `&price=${currentPrice}` : "";
      const res = await fetch(`/api/decibel/depth?market=${urlMarket}&limit=15${priceHint}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setBook({
        bids: data.bids || [],
        asks: data.asks || [],
        timestamp: data.timestamp || null,
      });
      setError(null);
    } catch {
      setError("Failed to connect to orderbook");
    } finally {
      setLoading(false);
    }
  }, [marketName, currentPrice]);

  useEffect(() => {
    setLoading(true);
    fetchBook();
    // Poll every 2 seconds for real-time-ish orderbook
    const interval = setInterval(fetchBook, 2000);
    return () => clearInterval(interval);
  }, [fetchBook]);

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
            {book.bids.length + book.asks.length} levels
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
