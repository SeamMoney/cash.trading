"use client";

import { memo, useEffect, useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { NumberTicker } from "@/components/ui/number-ticker";

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
      className={`group relative grid h-[20px] w-full grid-cols-[1fr_92px_1fr] items-center overflow-hidden px-3 text-[10px] transition-colors sm:h-[22px] sm:grid-cols-[1fr_96px_1fr] sm:text-[11px] ${
        side === "bid" ? "hover:bg-[#17c964]/10" : "hover:bg-[#ff8a00]/10"
      }`}
    >
      <div className="pointer-events-none absolute inset-y-0 left-3 right-[calc(50%+46px)] sm:right-[calc(50%+48px)]">
        {side === "bid" && (
          <div
            className="ml-auto h-full bg-[#17c964]/20 group-hover:bg-[#17c964]/25"
            style={{ width: `${depthPct.toFixed(1)}%` }}
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-[calc(50%+46px)] right-3 sm:left-[calc(50%+48px)]">
        {side === "ask" && (
          <div
            className="h-full bg-[#ff8a00]/20 group-hover:bg-[#ff8a00]/25"
            style={{ width: `${depthPct.toFixed(1)}%` }}
          />
        )}
      </div>

      <span
        className={`relative min-w-0 text-left font-mono tabular-nums ${
          side === "bid" ? "text-[#17c964]" : "text-transparent"
        }`}
      >
        {side === "bid" ? level.size.toFixed(4) : ""}
      </span>
      <span
        className={`relative text-center font-mono font-semibold tabular-nums ${
          side === "bid" ? "text-[#17c964]" : "text-[#ff9b2f]"
        }`}
      >
        {formattedPrice}
      </span>
      <span
        className={`relative min-w-0 text-right font-mono tabular-nums ${
          side === "ask" ? "text-[#ff9b2f]" : "text-transparent"
        }`}
      >
        {side === "ask" ? level.size.toFixed(4) : ""}
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
    let noDepthTimer: ReturnType<typeof setTimeout> | null = null;
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
          if (noDepthTimer) {
            clearTimeout(noDepthTimer);
            noDepthTimer = null;
          }
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
    noDepthTimer = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setError("Depth stream waiting");
    }, 2500);

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (noDepthTimer) clearTimeout(noDepthTimer);
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
  const displayPrice = currentPrice ?? midPrice;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  const spreadPct =
    spread && midPrice ? ((spread / midPrice) * 100).toFixed(3) : null;

  if (loading) {
    return (
      <div className="bg-[#0b0b0b] px-3 py-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase text-zinc-600">
          <span>Order Book</span>
          <span>Loading</span>
        </div>
        <div className="animate-pulse space-y-[3px]">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="h-[22px] bg-white/[0.04]" />
          ))}
        </div>
      </div>
    );
  }

  // If error and no data, show clean empty state
  if (error && book.bids.length === 0 && book.asks.length === 0) {
    return (
      <div className="overflow-hidden bg-[#0b0b0b]">
        <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase text-zinc-600">
          <h3 className="font-display font-semibold text-zinc-500">Order Book</h3>
          <span>Unavailable</span>
        </div>
        <div className="px-3 py-8 text-center">
          <p className="font-mono text-[11px] text-zinc-600">No depth data for this market</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden bg-[#0b0b0b]">
      <div className="flex items-center justify-between px-3 py-2 text-[10px] uppercase text-zinc-600">
        <h3 className="font-display font-semibold text-zinc-500">Order Book</h3>
        {error ? (
          <span>Unavailable</span>
        ) : (
          <span>
            Live · {book.bids.length + book.asks.length} levels
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_92px_1fr] px-3 pb-1 text-[10px] font-medium text-zinc-700 sm:grid-cols-[1fr_96px_1fr]">
        <span>Size</span>
        <span className="text-center">Price</span>
        <span className="text-right">Size</span>
      </div>

      <div className="max-h-[160px] overflow-y-auto no-scrollbar sm:max-h-[176px]">
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

      <div className="px-3 py-2">
        <NumberTicker
          value={displayPrice || null}
          fallback="—"
          format={{
            style: "currency",
            currency: "USD",
            minimumFractionDigits: displayPrice ? priceDecimals(displayPrice) : 2,
            maximumFractionDigits: displayPrice ? priceDecimals(displayPrice) : 2,
          }}
          className="block text-center font-mono text-[18px] font-bold text-white"
        />
        {spread !== null && (
          <div className="mt-0.5 text-center font-mono text-[10px] tabular-nums text-zinc-600">
            Spread {spread.toFixed(2)} ({spreadPct}%)
          </div>
        )}
      </div>

      <div className="max-h-[160px] overflow-y-auto no-scrollbar sm:max-h-[176px]">
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

      {book.timestamp && (
        <div className="px-3 py-1 text-right font-mono text-[9px] text-zinc-700">
          {new Date(book.timestamp).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
