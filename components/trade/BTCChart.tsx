"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Liveline } from "liveline";
import { usePriceCandles } from "@/hooks/useBtcCandles";
import { useInViewport } from "@/hooks/useInViewport";
import { usePageVisible } from "@/hooks/usePageVisible";
import { TetherLoader } from "@/components/layout/TetherLoader";
import { BtcPerpsChart, type PerpMarketSnapshot } from "@/components/trade/BtcPerpsChart";
import { PERP_MARKET_DATA, type PerpMarketData } from "@/components/trade/perpMarketConfig";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import type { Candle } from "@/hooks/useBtcCandles";

function fmtPrice(v: number): string {
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPerpPrice(v: number, decimals: number): string {
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtStatUsd(v: number): string {
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFundingRate(rateBps: number | null) {
  if (rateBps === null || !Number.isFinite(rateBps)) return "0.0010%";
  const pct = rateBps / 100;
  return `${pct >= 0 ? "" : "-"}${Math.abs(pct).toFixed(4)}%`;
}

const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "3m", secs: 180 },
  { label: "5m", secs: 300 },
];
const CHART_PADDING = { top: 8, right: 80, bottom: 24, left: 8 } as const;
const CANDLE_SECS = 2;
const CANDLE_WINDOW_BUFFER = 0.05;

type LiquidationLine = { id: string; price: number; side: "long" | "short" };

function computeCandleRange(candles: Candle[]) {
  let min = Infinity;
  let max = -Infinity;

  for (const candle of candles) {
    if (candle.low < min) min = candle.low;
    if (candle.high > max) max = candle.high;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const range = max - min;
  const margin = range * 0.12;
  const minRange = range * 0.1 || 0.4;

  if (range < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }

  return { min: min - margin, max: max + margin };
}

function getVisibleCandleRange(
  candles: Candle[],
  liveCandle: Candle | null,
  windowSecs: number,
) {
  const now = Date.now() / 1000;
  const rightEdge = now + windowSecs * CANDLE_WINDOW_BUFFER;
  const leftEdge = rightEdge - windowSecs;
  const visible = candles.filter(
    (candle) => candle.time + CANDLE_SECS >= leftEdge && candle.time <= rightEdge,
  );

  if (liveCandle && liveCandle.time + CANDLE_SECS >= leftEdge && liveCandle.time <= rightEdge) {
    visible.push(liveCandle);
  }

  return visible.length > 0 ? computeCandleRange(visible) : null;
}

function getLiquidationLinePosition(price: number, range: { min: number; max: number }) {
  const span = range.max - range.min || 1e-3;
  const raw = 1 - (price - range.min) / span;

  if (raw >= 0 && raw <= 1) {
    return {
      ratio: raw,
      isCompressed: false,
    };
  }

  const overshoot = raw > 1
    ? (range.min - price) / span
    : (price - range.max) / span;
  const compression = 1 - Math.exp(-Math.max(overshoot, 0) * 0.85);

  if (raw > 1) {
    return {
      ratio: 0.82 + compression * 0.13,
      isCompressed: true,
    };
  }

  return {
    ratio: 0.18 - compression * 0.13,
    isCompressed: true,
  };
}

/* ─── Market data ───────────────────────────────────── */

interface Market {
  id: string;
  label: string;
  pair: string;
  leverage: number;
  color: string;
  chartKind?: "classic" | "perps";
  perpData?: PerpMarketData;
  category: string;
}

const MARKETS: Market[] = [
  // Crypto
  { ...PERP_MARKET_DATA["BTC-PERP/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["BTC-PERP/USD"] },
  { id: "BTC/USD",  label: "Bitcoin",       pair: "BTC/USDT",   leverage: 40, color: "#f7931a", category: "crypto" },
  { ...PERP_MARKET_DATA["APT/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["APT/USD"] },
  { ...PERP_MARKET_DATA["HYPE/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["HYPE/USD"] },
  { ...PERP_MARKET_DATA["ETH/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["ETH/USD"] },
  { ...PERP_MARKET_DATA["XRP/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["XRP/USD"] },
  { ...PERP_MARKET_DATA["SOL/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["SOL/USD"] },
  { ...PERP_MARKET_DATA["ZEC/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["ZEC/USD"] },
  { ...PERP_MARKET_DATA["SUI/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["SUI/USD"] },
  { ...PERP_MARKET_DATA["DOGE/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["DOGE/USD"] },
  { ...PERP_MARKET_DATA["BNB/USD"], chartKind: "perps", category: "crypto", perpData: PERP_MARKET_DATA["BNB/USD"] },
  // Tokenized Stocks
  { id: "AAPL/USD", label: "Apple",         pair: "AAPL/USDT",  leverage: 20, color: "#555555", category: "equities" },
  { id: "TSLA/USD", label: "Tesla",         pair: "TSLA/USDT",  leverage: 20, color: "#cc0000", category: "equities" },
  { id: "NVDA/USD", label: "NVIDIA",        pair: "NVDA/USDT",  leverage: 20, color: "#76b900", category: "equities" },
  { id: "SNAP/USD", label: "Snap Inc.",     pair: "SNAP/USDT",  leverage: 10, color: "#FFFC00", category: "equities" },
  // Commodities
  { id: "XAU/USD",  label: "Gold",          pair: "XAU/USDT",   leverage: 50, color: "#d4a017", category: "commodities" },
  { id: "OIL/USD",  label: "Crude Oil",     pair: "OIL/USDT",   leverage: 30, color: "#8B6914", category: "commodities" },
  // Forex
  { id: "EUR/USD",  label: "Euro",          pair: "EUR/USD",    leverage: 100, color: "#003399", category: "forex" },
  { id: "GBP/USD",  label: "British Pound", pair: "GBP/USD",    leverage: 100, color: "#012169", category: "forex" },
  { id: "USD/JPY",  label: "Japanese Yen",  pair: "USD/JPY",    leverage: 100, color: "#BC002D", category: "forex" },
  { id: "AUD/USD",  label: "Aussie Dollar", pair: "AUD/USD",    leverage: 50,  color: "#00008B", category: "forex" },
  { id: "USD/CAD",  label: "Canadian Dollar",pair: "USD/CAD",   leverage: 50,  color: "#FF0000", category: "forex" },
  // Emojicoins
  { id: "GLOBE/USD",    label: "Globe",          pair: "🌐/USDT",   leverage: 0, color: "#4A90D9", category: "emojicoin" },
  { id: "MONEY/USD",    label: "Dollar",         pair: "💵/USDT",   leverage: 0, color: "#85BB65", category: "emojicoin" },
  { id: "HONGBAO/USD",  label: "Hongbao",        pair: "🧧/USDT",   leverage: 0, color: "#DE2910", category: "emojicoin" },
  { id: "BEE/USD",      label: "Bee",            pair: "🐝/USDT",   leverage: 0, color: "#FFD700", category: "emojicoin" },
];

const CATEGORIES = [
  { key: "crypto",      label: "Crypto" },
  { key: "equities",    label: "Tokenized Stocks" },
  { key: "commodities", label: "Commodities" },
  { key: "forex",       label: "Forex" },
  { key: "emojicoin",   label: "Isolated Margin" },
] as const;

/* ─── Token logos ──────────────────────────────────── */

const TOKEN_LOGOS: Record<string, string> = {
  "BTC/USD": "/tokens/btc.svg",
  "BTC-PERP/USD": "/tokens/btc.svg",
  "ETH/USD": "/tokens/eth.svg",
  "SOL/USD": "/tokens/sol.png",
  "APT/USD": "/tokens/apt.png",
  "HYPE/USD": "/tokens/hype.png",
  "BNB/USD": "/tokens/bnb.svg",
  "XRP/USD": "/tokens/xrp.svg",
  "DOGE/USD": "/tokens/doge.svg",
  "SUI/USD": "/tokens/sui.svg",
  "ZEC/USD": "/tokens/zec.svg",
};

function MarketLogo({ market, size = 20 }: { market: string; size?: number }) {
  const logo = TOKEN_LOGOS[market];
  if (logo) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={logo} alt="" width={size} height={size} loading="eager" decoding="async" className="shrink-0 rounded-full object-contain" style={{ width: size, height: size, minWidth: size, minHeight: size }} />
    );
  }
  const EMOJI_MAP: Record<string, string> = {
    "GLOBE/USD": "🌐", "MONEY/USD": "💵", "HONGBAO/USD": "🧧", "BEE/USD": "🐝",
  };
  if (EMOJI_MAP[market]) {
    return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>{EMOJI_MAP[market]}</span>;
  }
  const r = size / 2;
  switch (market) {
    case "AAPL/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#555" />
          <path d="M21.3 22.5c-.7 1-1.5 2-2.6 2-1.2 0-1.5-.7-2.8-.7-1.3 0-1.7.7-2.8.7-1.1 0-2-1.1-2.7-2.1-1.5-2.1-2.6-6-.5-8.6.7-1 2-1.6 3.2-1.6 1.2 0 1.9.7 2.8.7.9 0 1.5-.7 2.9-.7 1.1 0 2.1.5 2.8 1.4-2.5 1.4-2.1 4.9.4 5.8-.5 1.2-1 2.1-1.7 3.1zM18 9.5c-.7-.1-1.5.3-2 .7-.5.4-.9 1.1-.8 1.8.8.1 1.5-.2 2-.7.5-.4.8-1.1.8-1.8z" fill="white" />
        </svg>
      );
    case "TSLA/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#cc0000" />
          <path d="M16 10c3.5 0 6.5.7 8 1.5-.3.5-.8 1-1.5 1.3-1.5-.5-3.8-.8-6.5-.8s-5 .3-6.5.8c-.7-.3-1.2-.8-1.5-1.3C9.5 10.7 12.5 10 16 10zm-1 3h2v10h-2V13z" fill="white" />
        </svg>
      );
    case "NVDA/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#76B900" />
          <path d="M12.5 14.5v3.2c1.1-.1 2.1-.1 3-.2v-4.3c-1.5.2-2.4.6-3 1.3zm3-3.3v1.3c1.5-.1 3.2 0 5 .5v-1.4c-1.8-.5-3.5-.6-5-.4zm0 5.5c-.9.1-1.9.1-3 .2v2.6h3v-2.8zm5-3.5c1.3.6 2.2 1.4 2.5 2.3v4.5h-2.5v-3c0-.4 0-.9-.3-1.3-.2-.3-.5-.5-.9-.7v5h-3.8v-7.3c1.8.1 3.5.2 5 .5z" fill="white" />
        </svg>
      );
    case "SNAP/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#FFFC00" />
          <path d="M16 9c1.8 0 3.2.8 3.8 2.2.3.7.3 1.8.2 2.8l-.1 1.5c.5.2 1 .3 1.3.5.2.1.3.3.3.5 0 .3-.3.5-.8.7-.3.1-.7.2-1.1.3 0 0-.1.5-.3.9-.3.5-.7 1-1.3 1.3-.6.4-1.3.5-2 .5s-1.4-.2-2-.5c-.6-.3-1-.8-1.3-1.3-.2-.4-.3-.9-.3-.9-.4-.1-.8-.2-1.1-.3-.5-.2-.8-.4-.8-.7 0-.2.1-.4.3-.5.3-.2.8-.3 1.3-.5l-.1-1.5c-.1-1-.1-2.1.2-2.8C12.8 9.8 14.2 9 16 9z" fill="#333" />
        </svg>
      );
    case "XAU/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#d4a017" />
          <rect x="10" y="13" width="12" height="8" rx="1" fill="#fff" fillOpacity="0.9" />
          <rect x="10" y="13" width="12" height="8" rx="1" fill="url(#gold-grad)" />
          <line x1="16" y1="13" x2="16" y2="21" stroke="#d4a017" strokeWidth="0.5" />
          <line x1="10" y1="17" x2="22" y2="17" stroke="#d4a017" strokeWidth="0.5" />
          <defs><linearGradient id="gold-grad" x1="10" y1="13" x2="22" y2="21"><stop stopColor="#f5d76e" /><stop offset="1" stopColor="#d4a017" /></linearGradient></defs>
        </svg>
      );
    case "OIL/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#8B6914" />
          <path d="M16 8c0 0-5 6-5 10a5 5 0 0 0 10 0c0-4-5-10-5-10z" fill="#222" />
          <path d="M16 10c0 0-3.5 4.5-3.5 7.5a3.5 3.5 0 0 0 7 0c0-3-3.5-7.5-3.5-7.5z" fill="#444" />
        </svg>
      );
    case "EUR/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#003399" />
          <text x="16" y="21" textAnchor="middle" fill="#FFD700" fontSize="14" fontWeight="bold" fontFamily="system-ui">€</text>
        </svg>
      );
    case "GBP/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#012169" />
          <text x="16" y="21" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="system-ui">£</text>
        </svg>
      );
    case "USD/JPY":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="white" />
          <circle cx="16" cy="16" r="6" fill="#BC002D" />
        </svg>
      );
    case "AUD/USD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#00008B" />
          <text x="16" y="21" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="system-ui">A$</text>
        </svg>
      );
    case "USD/CAD":
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="#FF0000" />
          <path d="M16 9l1 3h-1l2 2-1 1 2 1-3 5h-1l-1 2-1-2h-1l-3-5 2-1-1-1 2-2h-1l1-3z" fill="white" />
        </svg>
      );
    default:
      const initials = market.split("/")[0]?.slice(0, 3).toUpperCase() || "?";
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <circle cx={r} cy={r} r={r} fill="#2a2a2a" />
          <text
            x="16"
            y="20"
            textAnchor="middle"
            fill="white"
            fontSize="10"
            fontWeight="700"
            fontFamily="system-ui"
          >
            {initials}
          </text>
        </svg>
      );
  }
}

/* ─── Market selector modal ────────────────────────── */

function MarketModal({
  open,
  selected,
  onSelect,
  onClose,
  markets: marketsList = MARKETS,
  categories: categoriesList = CATEGORIES,
}: {
  open: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  markets?: Market[];
  categories?: readonly { key: string; label: string }[];
}) {
  // Lock body scroll + escape key
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="cash-trade-theme fixed inset-0 z-[9999] flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* Backdrop — strong blur to freeze the page visually */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />

      {/* Outer card — matches payments log pattern */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[420px] bg-[#1c1c1c] rounded-2xl p-2 shadow-[0px_0px_1px_rgba(0,0,0,0.50)]"
        style={{ animation: "market-modal-in 0.2s ease-out" }}
      >
        <div className="border border-[#2a2a2a] overflow-hidden rounded-lg">
          {/* Header — same style as PAYMENT_LOGS / APTOS_MAINNET */}
          <header className="border-b border-[#2a2a2a] text-[#888] bg-[#202020] flex items-center justify-between px-5 py-4 font-mono text-sm font-semibold">
            <span className="flex items-center gap-2">
              <span className="relative h-2 w-2 shrink-0 rounded-full bg-green-500">
                <span className="absolute inset-0 animate-ping rounded-full bg-green-500 opacity-75" />
              </span>
              <span>SELECT MARKET</span>
            </span>
            <button
              onClick={onClose}
              aria-label="Close market selector"
              className="text-[#666] hover:text-white transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {/* Content — grid rows matching table style */}
          <div className="bg-[#181818] font-mono text-sm font-medium max-h-[50vh] overflow-y-auto">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_auto_auto] items-center text-[#999] px-5 pt-4 pb-3 sticky top-0 bg-[#181818] z-10 gap-x-2">
              <span className="font-bold text-xs">MARKET</span>
              <span className="font-bold text-xs text-right whitespace-nowrap">OPEN INT.</span>
              <span className="font-bold text-xs text-right whitespace-nowrap">LEV.</span>
            </div>

            {/* Category groups */}
            {categoriesList.map((cat) => {
              const items = marketsList.filter((m) => m.category === cat.key);
              if (items.length === 0) return null;
              const comingSoon = cat.key !== "crypto";
              return (
                <div key={cat.key}>
                  <div className="px-5 pt-2 pb-1 flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#555]">
                      {cat.label}
                    </span>
                    {comingSoon && (
                      <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-yellow-500/70">
                        <span className="relative h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-500">
                          <span className="absolute inset-0 animate-ping rounded-full bg-yellow-500 opacity-75" />
                        </span>
                        Coming Soon
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 px-3">
                    {items.map((m) => {
                      const isActive = !comingSoon && m.id === selected;
                      return (
                        <button
                          key={m.id}
                          disabled={comingSoon}
                          onClick={() => { if (!comingSoon) { onSelect(m.id); onClose(); } }}
                          className={`w-full grid grid-cols-[1fr_auto_auto] items-center gap-x-2 px-2 py-2 rounded-md transition-colors ${
                            comingSoon
                              ? "text-[#333] cursor-not-allowed opacity-50"
                              : isActive
                              ? "bg-white/[0.05] text-white"
                              : "text-[#888] hover:bg-white/[0.03] hover:text-white/80"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`shrink-0 flex items-center justify-center w-5 h-5 ${comingSoon ? "opacity-40" : ""}`}>
                              <MarketLogo market={m.id} size={20} />
                            </span>
                            <span className="text-[13px] font-semibold truncate">{m.label}</span>
                            <span className="text-[11px] text-[#555] shrink-0">{m.pair.replace(/ PERPS$/, "")}</span>
                            {isActive && (
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0">
                                <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-400" />
                              </svg>
                            )}
                          </span>
                          <span className={`text-[10px] tabular-nums text-right shrink-0 ${
                            comingSoon ? "text-[#333]" : "text-[#555]"
                          }`}>
                            {m.perpData?.openInterestLabel ?? "—"}
                          </span>
                          <span className={`text-xs font-bold tabular-nums text-right shrink-0 ${
                            comingSoon ? "text-[#333]" : isActive ? "text-green-400" : "text-[#666]"
                          }`}>
                            {m.leverage > 0 ? `${m.leverage}x` : "Spot"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="h-3" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ─── Chart component ──────────────────────────────── */

export { MARKETS as DEFAULT_MARKETS, CATEGORIES as DEFAULT_CATEGORIES };
export type { Market };

export function BTCChart({
  initialHistory = [],
  liquidationLines = [],
  onMarketChange,
  onPriceUpdate,
  markets: marketsProp,
  categories: categoriesProp,
  defaultMarket,
}: {
  initialHistory?: MarketHistoryCandle[];
  liquidationLines?: LiquidationLine[];
  onMarketChange?: (m: { id: string; pair: string; leverage: number }) => void;
  onPriceUpdate?: (price: number) => void;
  markets?: Market[];
  categories?: readonly { key: string; label: string }[];
  defaultMarket?: string;
}) {
  const activeMarkets = marketsProp ?? MARKETS;
  const activeCategories = categoriesProp ?? CATEGORIES;
  const chartRef = useRef<HTMLDivElement>(null);
  const pageVisible = usePageVisible();
  const inViewport = useInViewport(chartRef, { rootMargin: "160px" });
  const chartActive = pageVisible && inViewport;
  const [market, setMarket] = useState(defaultMarket ?? activeMarkets[0]?.id ?? "BTC-PERP/USD");
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"line" | "candle">("line");
  const [perpsMode, setPerpsMode] = useState<"line" | "candle">("line");
  const [windowSecs, setWindowSecs] = useState(60);
  const marketConfig = activeMarkets.find((m) => m.id === market) || activeMarkets[0];
  const isPerpsMarket = marketConfig.chartKind === "perps";
  const perpData = marketConfig.perpData ?? null;
  const [perpsSnapshot, setPerpsSnapshot] = useState<PerpMarketSnapshot | null>(null);
  // Always stream BTC data — other markets use BTC feed as demo
  const { ticks, candles, liveCandle, price, connected } = usePriceCandles(
    "BTC/USD",
    chartActive && !isPerpsMarket,
    initialHistory,
  );

  const priceCallbackRef = useRef(onPriceUpdate);
  priceCallbackRef.current = onPriceUpdate;
  useEffect(() => {
    if (!isPerpsMarket && price > 0) priceCallbackRef.current?.(price);
  }, [isPerpsMarket, price]);

  const visibleRange = getVisibleCandleRange(candles, liveCandle, windowSecs);
  const chartLoading = !isPerpsMarket && candles.length === 0 && ticks.length <= 1;
  const displayPrice = isPerpsMarket
    ? perpsSnapshot?.price ?? perpData?.seedPrice ?? 0
    : price;
  const displayConnected = isPerpsMarket
    ? perpsSnapshot?.connected ?? false
    : connected;
  const displayOracle = isPerpsMarket
    ? perpsSnapshot?.oraclePrice ?? (perpData ? perpData.seedPrice * 1.0004 : 0)
    : price > 0
      ? price + Math.round(price * 0.0004)
      : 0;
  const displayChange = isPerpsMarket ? perpData?.change24h ?? "-3.41%" : "-3.41%";
  const displayVolume = isPerpsMarket ? perpData?.volume24h ?? "$29.3M" : "$29.3M";
  const displayOpenInterest = isPerpsMarket
    ? perpsSnapshot?.openInterest != null
      ? fmtStatUsd(perpsSnapshot.openInterest * Math.max(displayPrice, perpData?.seedPrice ?? 0))
      : perpData?.openInterestLabel ?? "$1.46M"
    : "$1.46M";
  const displayFunding = isPerpsMarket
    ? fmtFundingRate(perpsSnapshot?.fundingRateBps ?? null)
    : "0.0010%";

  const handleMarketSelect = (id: string) => {
    setMarket(id);
    setPerpsSnapshot(null);
    const m = activeMarkets.find((mk) => mk.id === id);
    if (m?.chartKind === "perps") setPerpsMode("line");
    if (m && onMarketChange) onMarketChange({ id: m.id, pair: m.pair, leverage: m.leverage });
  };

  return (
    <div ref={chartRef} className="surface-1 rounded-[16px] overflow-hidden lg:flex lg:flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-3">
          {/* Market selector trigger */}
          <button
            onClick={() => setModalOpen(true)}
            aria-label="Open market selector"
            className="flex items-center gap-2 hover:bg-white/5 rounded-lg px-2 py-1.5 -mx-2 -my-1.5 transition-colors"
          >
            <MarketLogo market={market} />
            <span className="text-[13px] font-display font-semibold whitespace-nowrap">
              {marketConfig.pair.replace(" PERPS", "")}
            </span>
            <span className="text-[10px] font-mono font-bold text-zinc-500 bg-white/[0.04] px-1.5 py-0.5 rounded-md">
              {marketConfig.leverage > 0 ? `${marketConfig.leverage}x` : "Spot"}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-zinc-500">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                displayConnected ? "bg-success" : "bg-muted"
              }`}
            />
            <span className="text-[11px] text-zinc-500">
              {displayConnected ? "Live" : "..."}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[15px] font-mono font-bold tabular-nums">
            {displayPrice > 0
              ? isPerpsMarket && perpData
                ? fmtPerpPrice(displayPrice, perpData.priceDecimals)
                : fmtPrice(displayPrice)
              : "\u2014"}
          </span>
        </div>
      </div>

      {/* Market stats bar */}
      <div className="relative border-b border-white/5">
        <div className="px-4 py-2 flex items-center gap-4 sm:gap-6 overflow-x-auto no-scrollbar text-[11px] font-mono tabular-nums pr-10">
          <div className="flex flex-col shrink-0 min-w-[72px]">
            <span className="text-zinc-600 text-[9px]">Mark Price</span>
            <span className="text-white font-semibold">
              {displayPrice > 0
                ? displayPrice.toLocaleString("en-US", {
                    minimumFractionDigits: isPerpsMarket && perpData ? perpData.priceDecimals : 0,
                    maximumFractionDigits: isPerpsMarket && perpData ? perpData.priceDecimals : 0,
                  })
                : "—"}
            </span>
          </div>
          <div className="flex flex-col shrink-0 min-w-[64px]">
            <span className="text-zinc-600 text-[9px]">Oracle</span>
            <span className="text-white font-semibold">
              {displayOracle > 0
                ? displayOracle.toLocaleString("en-US", {
                    minimumFractionDigits: isPerpsMarket && perpData ? perpData.priceDecimals : 0,
                    maximumFractionDigits: isPerpsMarket && perpData ? perpData.priceDecimals : 0,
                  })
                : "—"}
            </span>
          </div>
          <div className="flex flex-col shrink-0 min-w-[64px]">
            <span className="text-zinc-600 text-[9px]">24h Change</span>
            <span className={`${displayChange.startsWith("-") ? "text-red-400" : "text-green-400"} font-semibold`}>
              {displayChange}
            </span>
          </div>
          <div className="flex flex-col shrink-0 min-w-[64px]">
            <span className="text-zinc-600 text-[9px]">24h Volume</span>
            <span className="text-white font-semibold">{displayVolume}</span>
          </div>
          <div className="flex flex-col shrink-0 min-w-[72px]">
            <span className="text-zinc-600 text-[9px]">Open Interest</span>
            <span className="text-white font-semibold">{displayOpenInterest}</span>
          </div>
          <div className="flex flex-col shrink-0 min-w-[56px]">
            <span className="text-zinc-600 text-[9px]">Funding</span>
            <span className={`${displayFunding.startsWith("-") ? "text-red-400" : "text-green-400"} font-semibold`}>
              {displayFunding}
            </span>
          </div>
        </div>
        {/* Right fade to hint horizontal scroll */}
        <div className="absolute inset-y-0 right-0 w-10 pointer-events-none bg-gradient-to-l from-[#141414] to-transparent" />
      </div>

      {/* Chart + subtle overlay controls */}
      <div className="relative h-[340px] sm:h-[460px] lg:h-[560px] lg:min-h-0">
        {/* Floating Line/Candles switcher — bottom-right on all screen sizes */}
        {isPerpsMarket && (
          <div className="absolute bottom-[30px] left-0 right-[80px] z-[15] h-[7px] pointer-events-none bg-[#141414]" />
        )}
        {/* Right-side fade to prevent x-axis labels from touching the button */}
        <div className="absolute bottom-0 right-0 z-[15] w-[120px] h-[32px] pointer-events-none bg-gradient-to-l from-[#141414] via-[#141414]/80 to-transparent" />
        <div className="absolute bottom-2 right-2 z-20 flex items-center rounded-[8px] border border-white/[0.08] bg-[#141414]/90 backdrop-blur-sm p-0.5">
          <button
            type="button"
            onClick={() => isPerpsMarket ? setPerpsMode("line") : setMode("line")}
            className={`rounded-[6px] px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors ${
              (isPerpsMarket ? perpsMode : mode) === "line"
                ? "bg-white/[0.1] text-white"
                : "text-zinc-500"
            }`}
          >
            Line
          </button>
          <button
            type="button"
            onClick={() => isPerpsMarket ? setPerpsMode("candle") : setMode("candle")}
            className={`rounded-[6px] px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors ${
              (isPerpsMarket ? perpsMode : mode) === "candle"
                ? "bg-white/[0.1] text-white"
                : "text-zinc-500"
            }`}
          >
            Candles
          </button>
        </div>
        {isPerpsMarket && perpData ? (
          <BtcPerpsChart
            active={chartActive}
            liquidationLines={liquidationLines}
            market={perpData}
            mode={perpsMode}
            onSnapshotChange={(nextSnapshot) => {
              setPerpsSnapshot(nextSnapshot);
              if (nextSnapshot.price > 0) {
                priceCallbackRef.current?.(nextSnapshot.price);
              }
            }}
          />
        ) : (
          <Liveline
            mode="candle"
            data={ticks}
            value={price}
            candles={candles}
            candleWidth={1}
            liveCandle={liveCandle ?? undefined}
            lineMode={mode === "line"}
            lineData={ticks}
            lineValue={price}
            theme="dark"
            color={marketConfig.color}
            window={windowSecs}
            grid
            scrub
            exaggerate
            badge
            badgeTail
            badgeVariant="default"
            formatValue={(v: number) => fmtPrice(v)}
            loading={chartLoading}
            emptyText=""
            padding={CHART_PADDING}
          />
        )}

        {!isPerpsMarket && visibleRange && liquidationLines.length > 0 && (
          <div className="absolute inset-0 z-[6] pointer-events-none">
            {liquidationLines
              .slice()
              .sort((a, b) => b.price - a.price)
              .map((line) => {
                const { ratio, isCompressed } = getLiquidationLinePosition(line.price, visibleRange);
                const top = `calc(${CHART_PADDING.top}px + ${ratio} * (100% - ${CHART_PADDING.top + CHART_PADDING.bottom}px))`;
                const accent = line.side === "long" ? "#f97316" : "#f43f5e";

                return (
                  <div
                    key={line.id}
                    className="absolute"
                    style={{
                      top,
                      left: CHART_PADDING.left,
                      right: CHART_PADDING.right,
                      transform: "translateY(-50%)",
                    }}
                  >
                    <div
                      className="h-px border-t border-dashed"
                      style={{
                        borderColor: accent,
                        opacity: isCompressed ? 0.62 : 0.92,
                      }}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-[10px] font-mono font-semibold uppercase tracking-[0.12em] text-white"
                      style={{
                        right: 12,
                        background: "rgba(9, 9, 11, 0.86)",
                        borderColor: `${accent}33`,
                        boxShadow: `0 0 0 1px ${accent}14 inset`,
                        opacity: isCompressed ? 0.86 : 1,
                      }}
                    >
                      {line.side === "long" ? "Long Liq" : "Short Liq"} {fmtPrice(line.price)}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Custom loader overlay */}
        {chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <TetherLoader size={56} label="Connecting" />
          </div>
        )}

        {/* Minimal overlay controls — fade in on hover */}
        {!isPerpsMarket && (
          <div className="absolute top-2 left-3 flex items-center gap-0.5 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 pointer-events-none z-10">
            {WINDOWS.map((w) => (
              <button
                key={w.secs}
                onClick={() => setWindowSecs(w.secs)}
                className={`pointer-events-auto text-[10px] font-mono px-1.5 py-0.5 rounded-md transition-colors ${
                  windowSecs === w.secs
                    ? "text-white/70 bg-white/10"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {w.label}
              </button>
            ))}
            <span className="w-px h-3 bg-white/10 mx-1" />
            <button
              onClick={() => setMode((m) => (m === "candle" ? "line" : "candle"))}
              className="pointer-events-auto text-[10px] font-mono px-1.5 py-0.5 rounded-md text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {mode === "candle" ? "Line" : "OHLC"}
            </button>
          </div>
        )}
      </div>

      {/* Market selector modal */}
      <MarketModal
        open={modalOpen}
        selected={market}
        onSelect={handleMarketSelect}
        onClose={() => setModalOpen(false)}
        markets={activeMarkets}
        categories={activeCategories}
      />
    </div>
  );
}
