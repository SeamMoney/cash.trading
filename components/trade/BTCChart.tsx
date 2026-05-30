"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Liveline } from "liveline";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { usePriceCandles } from "@/hooks/useBtcCandles";
import { useInViewport } from "@/hooks/useInViewport";
import { usePageVisible } from "@/hooks/usePageVisible";
import { TetherLoader } from "@/components/layout/TetherLoader";
import { BtcPerpsChart, type PerpMarketSnapshot } from "@/components/trade/BtcPerpsChart";
import { PERP_MARKET_DATA, type PerpMarketData } from "@/components/trade/perpMarketConfig";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
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
const EMPTY_HISTORY: MarketHistoryCandle[] = [];
const EMPTY_LIQUIDATION_LINES: LiquidationLine[] = [];

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
  marketAddr?: string;
  marketName?: string;
  mode?: string;
  fundingRateBps?: number | null;
}

const CATEGORIES = [
  { key: "crypto", label: "Crypto" },
  { key: "stocks", label: "Stocks" },
  { key: "commodities", label: "Commodities" },
] as const;

const PRIMARY_MARKET_TABS = [
  { key: "all", label: "All" },
  { key: "crypto", label: "Crypto" },
  { key: "tradfi", label: "TradFi" },
] as const;

const TRADFI_MARKET_TABS = [
  { key: "all", label: "All" },
  { key: "stocks", label: "Stocks" },
  { key: "commodities", label: "Commodities" },
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

const MARKET_LABELS: Record<string, string> = {
  AAPL: "Apple",
  AMZN: "Amazon",
  APT: "Aptos",
  BTC: "Bitcoin",
  BNB: "BNB",
  CBRS: "Chainbase",
  DOGE: "Dogecoin",
  ETH: "Ethereum",
  GOLD: "Gold",
  GOOGL: "Google",
  HYPE: "Hyperliquid",
  MEGA: "Mega",
  MU: "Micron",
  NVDA: "Nvidia",
  SNDK: "SanDisk",
  SILVER: "Silver",
  SOL: "Solana",
  SUI: "Sui",
  TSLA: "Tesla",
  XRP: "XRP",
  ZEC: "Zcash",
};

const MARKET_COLORS: Record<string, string> = {
  APT: "#39ff14",
  BTC: "#f7931a",
  BNB: "#f3ba2f",
  DOGE: "#c2a633",
  ETH: "#627eea",
  GOLD: "#d4a017",
  HYPE: "#50e3c2",
  SILVER: "#c0c0c0",
  SOL: "#9945ff",
  SUI: "#6dd6ff",
  XRP: "#d9d9d9",
  ZEC: "#f4b728",
};

const COMMODITY_SYMBOLS = new Set([
  "GOLD",
  "SILVER",
  "XAU",
  "XAG",
  "OIL",
  "WTI",
  "BRENT",
  "NATGAS",
]);

const CRYPTO_SYMBOLS = new Set([
  "AAVE",
  "APT",
  "BNB",
  "BTC",
  "DOGE",
  "ENA",
  "ETH",
  "HYPE",
  "LINK",
  "SOL",
  "SUI",
  "USDC",
  "USDT",
  "WLFI",
  "XRP",
  "ZEC",
]);

interface DecibelApiMarket {
  name: string;
  address: string;
  markPrice: number | null;
  midPrice: number | null;
  oraclePrice: number | null;
  fundingRateBps: number | null;
  isFundingPositive: boolean | null;
  openInterest: number | null;
  priceUpdatedAt: number | null;
  maxLeverage: number | null;
  tickSize: number | null;
  minSize: number | null;
  lotSize: number | null;
  mode: string;
  szDecimals: number | null;
  pxDecimals: number | null;
}

type MarketChangePayload = {
  id: string;
  pair: string;
  leverage: number;
  marketAddr?: string;
  marketName?: string;
};

function getBaseSymbol(marketName: string) {
  return marketName.split("/")[0]?.toUpperCase() || marketName.toUpperCase();
}

function getMarketLabel(marketName: string) {
  const base = getBaseSymbol(marketName);
  return MARKET_LABELS[base] ?? base;
}

function getMarketColor(marketName: string) {
  return MARKET_COLORS[getBaseSymbol(marketName)] ?? "#39ff14";
}

function classifyMarketCategory(marketName: string): "crypto" | "stocks" | "commodities" {
  const base = getBaseSymbol(marketName);
  if (COMMODITY_SYMBOLS.has(base)) return "commodities";
  if (CRYPTO_SYMBOLS.has(base)) return "crypto";
  return "stocks";
}

function getDisplayDecimals(price: number | null | undefined) {
  const value = Number(price ?? 0);
  if (value >= 1_000) return 2;
  if (value >= 100) return 2;
  if (value >= 1) return 4;
  if (value >= 0.01) return 5;
  return 6;
}

function toPerpMarketData(market: DecibelApiMarket): PerpMarketData {
  const seedPrice = market.markPrice ?? market.midPrice ?? market.oraclePrice ?? 1;
  const leverage = Math.max(1, Number(market.maxLeverage ?? 1));
  const openInterestUsd =
    market.openInterest != null && seedPrice > 0
      ? fmtStatUsd(market.openInterest * seedPrice)
      : "—";

  return {
    id: market.name,
    label: getMarketLabel(market.name),
    pair: market.name,
    marketAddr: market.address,
    marketName: market.name,
    leverage,
    color: getMarketColor(market.name),
    seedPrice,
    priceDecimals: getDisplayDecimals(seedPrice),
    change24h: "—",
    volume24h: "—",
    openInterestLabel: openInterestUsd,
    volatility: 0.0028,
  };
}

function apiMarketToMarket(market: DecibelApiMarket): Market {
  const perpData = toPerpMarketData(market);
  return {
    id: market.name,
    label: perpData.label,
    pair: market.name,
    leverage: perpData.leverage,
    color: perpData.color,
    chartKind: "perps",
    perpData,
    category: classifyMarketCategory(market.name),
    marketAddr: market.address,
    marketName: market.name,
    mode: market.mode,
    fundingRateBps: market.fundingRateBps,
  };
}

const FALLBACK_MARKETS: Market[] = Object.values(PERP_MARKET_DATA).map((market) => ({
  id: market.marketName,
  label: getMarketLabel(market.marketName),
  pair: market.marketName,
  leverage: market.leverage,
  color: market.color,
  chartKind: "perps",
  perpData: {
    ...market,
    id: market.marketName,
    label: getMarketLabel(market.marketName),
    pair: market.marketName,
  },
  category: classifyMarketCategory(market.marketName),
  marketAddr: market.marketAddr,
  marketName: market.marketName,
  fundingRateBps: null,
}));
const MARKETS = FALLBACK_MARKETS;

function MarketLogo({ market, size = 20 }: { market: string; size?: number }) {
  const logo = TOKEN_LOGOS[market];
  if (logo) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={logo} alt="" width={size} height={size} loading="eager" decoding="async" className="shrink-0 rounded-full object-contain" style={{ width: size, height: size, minWidth: size, minHeight: size }} />
    );
  }
  const initials = getBaseSymbol(market).slice(0, 3) || "?";
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-[#242424] text-[9px] font-black text-zinc-200"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {initials}
    </span>
  );
}

/* ─── Market selector modal ────────────────────────── */

function MarketModal({
  open,
  selected,
  onSelect,
  onClose,
  markets: marketsList = MARKETS,
  categories: categoriesList = CATEGORIES,
  loading = false,
  network,
}: {
  open: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  markets?: Market[];
  categories?: readonly { key: string; label: string }[];
  loading?: boolean;
  network: DecibelPublicNetwork;
}) {
  const [query, setQuery] = useState("");
  const [primaryTab, setPrimaryTab] = useState<"all" | "crypto" | "tradfi">("all");
  const [tradfiTab, setTradfiTab] = useState<"all" | "stocks" | "commodities">("all");

  const filteredMarkets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return marketsList.filter((market) => {
      const isTradFi = market.category === "stocks" || market.category === "commodities";
      if (primaryTab === "crypto" && market.category !== "crypto") return false;
      if (primaryTab === "tradfi" && !isTradFi) return false;
      if (primaryTab === "tradfi" && tradfiTab !== "all" && market.category !== tradfiTab) {
        return false;
      }
      if (!normalizedQuery) return true;
      return [
        market.label,
        market.pair,
        market.marketName,
        market.id,
        getBaseSymbol(market.id),
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [marketsList, primaryTab, query, tradfiTab]);

  const visibleCategories = useMemo(
    () =>
      categoriesList
        .map((category) => ({
          ...category,
          items: filteredMarkets.filter((market) => market.category === category.key),
        }))
        .filter((category) => category.items.length > 0),
    [categoriesList, filteredMarkets],
  );

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
        className="relative w-full max-w-[760px] bg-[#141414] rounded-[12px] p-1 shadow-[0px_0px_1px_rgba(0,0,0,0.50)]"
        style={{ animation: "market-modal-in 0.2s ease-out" }}
      >
        <div className="overflow-hidden rounded-[10px] border border-[#303030]">
          {/* Header — same style as PAYMENT_LOGS / APTOS_MAINNET */}
          <header className="border-b border-[#2a2a2a] text-[#888] bg-[#202020] flex items-center justify-between px-5 py-4 font-mono text-sm font-semibold">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
              <span>SELECT MARKET</span>
              <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-400">
                {network}
              </span>
            </span>
            <button
              onClick={onClose}
              aria-label="Close market selector"
              className="text-[#666] hover:text-white transition-colors"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </header>

          {/* Content — grid rows matching table style */}
          <div className="bg-[#101010] p-4 font-mono text-sm font-medium">
            <label className="flex h-11 items-center gap-3 rounded-[8px] border border-[#303030] bg-[#0d0d0d] px-4 text-[#777] focus-within:border-[#484848]">
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                placeholder="Search coins"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-200 outline-none placeholder:text-zinc-500"
              />
            </label>

            <div className="mt-4 flex items-center gap-5 border-b border-[#252525]">
              {PRIMARY_MARKET_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setPrimaryTab(tab.key)}
                  className={`pb-2 text-[13px] transition-colors ${
                    primaryTab === tab.key
                      ? "border-b-2 border-zinc-200 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {primaryTab === "tradfi" && (
              <div className="mt-3 flex items-center gap-5 border-b border-[#252525]">
                {TRADFI_MARKET_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setTradfiTab(tab.key)}
                    className={`pb-2 text-[13px] transition-colors ${
                      tradfiTab === tab.key
                        ? "border-b-2 border-zinc-200 text-zinc-100"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {/* Column headers */}
            <div className="grid grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto] items-center gap-x-4 px-3 pt-5 pb-2 text-[#999]">
              <span className="text-xs font-bold">Symbol</span>
              <span className="text-right text-xs font-bold">Price</span>
              <span className="text-right text-xs font-bold">Funding</span>
              <span className="text-right text-xs font-bold">Open Interest</span>
              <span className="text-right text-xs font-bold">Lev.</span>
            </div>

            {loading && (
              <div className="px-3 pb-2 text-[10px] font-bold uppercase text-green-500/70">
                Updating market registry...
              </div>
            )}

            {/* Category groups */}
            <div className="max-h-[min(58vh,560px)] overflow-y-auto pr-1">
            {visibleCategories.map((cat) => {
              const items = cat.items;
              return (
                <div key={cat.key}>
                  <div className="px-3 pt-3 pb-1 flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase text-[#555]">
                      {cat.label}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {items.map((m) => {
                      const isActive = m.id === selected;
                      const mark = m.perpData?.seedPrice ?? 0;
                      const fundingText = m.fundingRateBps == null ? "—" : fmtFundingRate(m.fundingRateBps);
                      return (
                        <button
                          key={m.id}
                          onClick={() => { onSelect(m.id); onClose(); }}
                          className={`grid w-full grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto] items-center gap-x-4 rounded-[8px] px-3 py-2.5 transition-colors ${
                            isActive
                              ? "bg-white/[0.05] text-white"
                              : "text-[#888] hover:bg-white/[0.03] hover:text-white/80"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0 flex items-center justify-center w-5 h-5">
                              <MarketLogo market={m.id} size={20} />
                            </span>
                            <span className="text-[13px] font-semibold truncate">{m.label}</span>
                            <span className="text-[11px] text-[#555] shrink-0">{m.pair.replace(/ PERPS$/, "")}</span>
                            {isActive && (
                              <Check className="h-3 w-3 shrink-0 text-green-400" aria-hidden="true" />
                            )}
                          </span>
                          <span className="text-right text-[12px] tabular-nums text-zinc-500">
                            {mark > 0 ? mark.toLocaleString("en-US", {
                              minimumFractionDigits: getDisplayDecimals(mark),
                              maximumFractionDigits: getDisplayDecimals(mark),
                            }) : "—"}
                          </span>
                          <span className="text-right text-[12px] tabular-nums text-green-400/80">
                            {fundingText}
                          </span>
                          <span className="text-right text-[12px] tabular-nums text-[#555]">
                            {m.perpData?.openInterestLabel ?? "—"}
                          </span>
                          <span className={`text-right text-xs font-bold tabular-nums ${
                            isActive ? "text-green-400" : "text-[#666]"
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
            {visibleCategories.length === 0 && (
              <div className="flex h-36 items-center justify-center text-[12px] text-zinc-600">
                No Decibel markets match this search.
              </div>
            )}
            <div className="h-3" />
            </div>
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
  initialHistory = EMPTY_HISTORY,
  liquidationLines = EMPTY_LIQUIDATION_LINES,
  onMarketChange,
  onPriceUpdate,
  markets: marketsProp,
  categories: categoriesProp,
  defaultMarket,
}: {
  initialHistory?: MarketHistoryCandle[];
  liquidationLines?: LiquidationLine[];
  onMarketChange?: (m: MarketChangePayload) => void;
  onPriceUpdate?: (price: number) => void;
  markets?: Market[];
  categories?: readonly { key: string; label: string }[];
  defaultMarket?: string;
}) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [liveMarkets, setLiveMarkets] = useState<Market[]>(MARKETS);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const activeMarkets = marketsProp ?? liveMarkets;
  const activeCategories = categoriesProp ?? CATEGORIES;
  const chartRef = useRef<HTMLDivElement>(null);
  const pageVisible = usePageVisible();
  const inViewport = useInViewport(chartRef, { rootMargin: "160px" });
  const chartActive = pageVisible && inViewport;
  const [market, setMarket] = useState(defaultMarket ?? activeMarkets[0]?.id ?? "BTC/USD");
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"line" | "candle">("line");
  const [perpsMode, setPerpsMode] = useState<"line" | "candle">("line");
  const [windowSecs, setWindowSecs] = useState(60);
  const marketConfig = activeMarkets.find((m) => m.id === market) || activeMarkets[0] || MARKETS[0];
  const isPerpsMarket = marketConfig.chartKind === "perps";
  const perpData = marketConfig.perpData ?? null;
  const [perpsSnapshot, setPerpsSnapshot] = useState<PerpMarketSnapshot | null>(null);
  const lastEmittedMarketRef = useRef("");

  useEffect(() => onDecibelPublicNetworkChange(setNetwork), []);

  useEffect(() => {
    if (marketsProp) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadMarkets = async () => {
      setMarketsLoading(true);
      try {
        const res = await fetch(`/api/decibel/markets?network=${network}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error || "Could not load Decibel markets");
        }
        const next = (Array.isArray(json.markets) ? json.markets : [])
          .map(apiMarketToMarket)
          .sort((a: Market, b: Market) => {
            if (a.id === "BTC/USD") return -1;
            if (b.id === "BTC/USD") return 1;
            return a.id.localeCompare(b.id);
          });
        if (!cancelled && next.length > 0) setLiveMarkets(next);
      } catch {
        if (!cancelled) setLiveMarkets((current) => current.length > 0 ? current : MARKETS);
      } finally {
        if (!cancelled) {
          setMarketsLoading(false);
          timer = setTimeout(loadMarkets, 3_000);
        }
      }
    };

    void loadMarkets();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [marketsProp, network]);

  useEffect(() => {
    if (activeMarkets.length === 0) return;
    setMarket((current) => activeMarkets.some((entry) => entry.id === current)
      ? current
      : activeMarkets[0].id);
  }, [activeMarkets]);
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

  const handlePerpsSnapshotChange = useCallback((nextSnapshot: PerpMarketSnapshot) => {
    setPerpsSnapshot(nextSnapshot);
    if (nextSnapshot.price > 0) {
      priceCallbackRef.current?.(nextSnapshot.price);
    }
  }, []);

  useEffect(() => {
    if (!marketConfig || !onMarketChange) return;
    const key = `${marketConfig.id}:${marketConfig.marketAddr ?? ""}`;
    if (lastEmittedMarketRef.current === key) return;
    lastEmittedMarketRef.current = key;
    onMarketChange({
      id: marketConfig.id,
      pair: marketConfig.pair,
      leverage: marketConfig.leverage,
      marketAddr: marketConfig.marketAddr ?? marketConfig.perpData?.marketAddr,
      marketName: marketConfig.marketName ?? marketConfig.perpData?.marketName,
    });
  }, [marketConfig, onMarketChange]);

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
    if (m && onMarketChange) onMarketChange({
      id: m.id,
      pair: m.pair,
      leverage: m.leverage,
      marketAddr: m.marketAddr ?? m.perpData?.marketAddr,
      marketName: m.marketName ?? m.perpData?.marketName,
    });
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
            <ChevronDown className="h-3 w-3 text-zinc-500" aria-hidden="true" />
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
            <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase text-zinc-500">
              {network}
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
            onSnapshotChange={handlePerpsSnapshotChange}
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
        loading={marketsLoading}
        network={network}
      />
    </div>
  );
}
