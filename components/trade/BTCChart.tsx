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
import { NumberTicker } from "@/components/ui/number-ticker";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import type { Candle } from "@/hooks/useBtcCandles";
import { cn } from "@/lib/utils";

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
const MARKET_REFRESH_MS = 60_000;
const MARKET_HIDDEN_REFRESH_MS = 180_000;
const SNAPSHOT_UI_COMMIT_MS = 250;

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

type MarketCategory = (typeof CATEGORIES)[number]["key"];

function isMarketCategory(value: string | undefined): value is MarketCategory {
  return value === "crypto" || value === "stocks" || value === "commodities";
}

/* ─── Token logos ──────────────────────────────────── */

const TOKEN_LOGOS: Record<string, string> = {
  AAVE: "/tokens/aave.svg",
  ADA: "/tokens/ada.svg",
  AMZN: "/tokens/amzn.svg",
  APT: "/tokens/apt.png",
  BNB: "/tokens/bnb.png",
  BTC: "/tokens/btc.png",
  CBRS: "/tokens/cbrs.svg",
  CHIP: "/tokens/chip.svg",
  DOGE: "/tokens/doge.png",
  ENA: "/tokens/ena.svg",
  ETH: "/tokens/eth.png",
  EWY: "/tokens/ewy.png",
  FARTCOIN: "/tokens/fartcoin.svg",
  GOLD: "/tokens/gold.svg",
  GOOGL: "/tokens/googl.svg",
  HYPE: "/tokens/hype.png",
  KPEPE: "/tokens/kpepe.svg",
  LINK: "/tokens/link.svg",
  MEGA: "/tokens/mega.svg",
  MU: "/tokens/mu.svg",
  NEAR: "/tokens/near.svg",
  NVDA: "/tokens/nvda.svg",
  QQQ: "/tokens/qqq.png",
  SILVER: "/tokens/silver.svg",
  SNDK: "/tokens/sndk.svg",
  SOL: "/tokens/sol.png",
  SPY: "/tokens/spy.png",
  SUI: "/tokens/sui.png",
  TAO: "/tokens/tao.svg",
  TRUMP: "/tokens/trump.svg",
  TSLA: "/tokens/tsla.svg",
  WLFI: "/tokens/wlfi.svg",
  WTIOIL: "/tokens/wtioil.svg",
  XPL: "/tokens/xpl.svg",
  XRP: "/tokens/xrp.png",
  ZEC: "/tokens/zec.png",
  ZRO: "/tokens/zro.svg",
  "BTC/USD": "/tokens/btc.png",
  "BTC-PERP/USD": "/tokens/btc.png",
  "ETH/USD": "/tokens/eth.png",
  "SOL/USD": "/tokens/sol.png",
  "APT/USD": "/tokens/apt.png",
  "HYPE/USD": "/tokens/hype.png",
  "BNB/USD": "/tokens/bnb.png",
  "XRP/USD": "/tokens/xrp.png",
  "DOGE/USD": "/tokens/doge.png",
  "SUI/USD": "/tokens/sui.png",
  "ZEC/USD": "/tokens/zec.png",
  "SPY/USD": "/tokens/spy.png",
  "QQQ/USD": "/tokens/qqq.png",
  "EWY/USD": "/tokens/ewy.png",
};

const MARKET_LABELS: Record<string, string> = {
  AAPL: "Apple",
  ADA: "Cardano",
  AMZN: "Amazon",
  AAVE: "Aave",
  APT: "Aptos",
  BTC: "Bitcoin",
  BNB: "BNB",
  CBRS: "Chainbase",
  CHIP: "Chip",
  DOGE: "Dogecoin",
  ETH: "Ethereum",
  EWY: "iShares MSCI South Korea",
  FARTCOIN: "Fartcoin",
  GOLD: "Gold",
  GOOGL: "Google",
  HYPE: "Hyperliquid",
  KPEPE: "Pepe",
  LINK: "Chainlink",
  MEGA: "Mega",
  MU: "Micron",
  NEAR: "Near",
  NVDA: "Nvidia",
  QQQ: "Invesco QQQ",
  SNDK: "SanDisk",
  SILVER: "Silver",
  SOL: "Solana",
  SPY: "SPDR S&P 500 ETF",
  SUI: "Sui",
  TAO: "Bittensor",
  TRUMP: "Trump",
  TSLA: "Tesla",
  WTIOIL: "WTI Oil",
  XPL: "Plasma",
  XRP: "XRP",
  ZEC: "Zcash",
  ZRO: "LayerZero",
};

const MARKET_COLORS: Record<string, string> = {
  APT: "#39ff14",
  BTC: "#f7931a",
  BNB: "#f3ba2f",
  DOGE: "#c2a633",
  ETH: "#627eea",
  GOLD: "#d4a017",
  HYPE: "#50e3c2",
  KPEPE: "#8bc34a",
  LINK: "#2a5ada",
  MEGA: "#d9d9d9",
  NEAR: "#d9d9d9",
  SILVER: "#c0c0c0",
  SOL: "#9945ff",
  SPY: "#72ff4b",
  QQQ: "#72ff4b",
  EWY: "#72ff4b",
  SUI: "#6dd6ff",
  TAO: "#d9d9d9",
  TRUMP: "#d9d9d9",
  WTIOIL: "#1f7a1f",
  XPL: "#d9d9d9",
  XRP: "#d9d9d9",
  ZEC: "#f4b728",
  ZRO: "#d9d9d9",
};

const STOCK_SYMBOLS = new Set([
  "AAPL",
  "AMD",
  "AMZN",
  "ARM",
  "ASML",
  "BABA",
  "CBRS",
  "COIN",
  "CRCL",
  "DRAM",
  "EWY",
  "GOOGL",
  "HOOD",
  "IBM",
  "INTC",
  "META",
  "MRVL",
  "MSFT",
  "MSTR",
  "MU",
  "NFLX",
  "NVDA",
  "QCOM",
  "QQQ",
  "SAMSUNG",
  "SKHYNIX",
  "SNDK",
  "SPCX",
  "SPY",
  "TSLA",
]);

const COMMODITY_SYMBOLS = new Set([
  "GOLD",
  "SILVER",
  "WTIOIL",
  "COPPER",
  "NATGAS",
]);

const CRYPTO_SYMBOLS = new Set([
  "AAVE",
  "ADA",
  "APT",
  "BNB",
  "BTC",
  "CHIP",
  "DOGE",
  "ENA",
  "ETH",
  "FARTCOIN",
  "HYPE",
  "KPEPE",
  "LINK",
  "MEGA",
  "NEAR",
  "SOL",
  "SUI",
  "TAO",
  "TRUMP",
  "USDC",
  "USDT",
  "WLFI",
  "XPL",
  "XRP",
  "ZEC",
  "ZRO",
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
  /** Decibel's own listing category: "crypto" | "equity" | "commodity" | "". */
  category?: string | null;
  /** Already a percentage (e.g. 1.42 = +1.42%). */
  change24hPct?: number | null;
  volume24hUsd?: number | null;
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

function classifyMarketCategory(
  marketName: string,
  apiCategory?: string | null
): "crypto" | "stocks" | "commodities" {
  // Prefer Decibel's own listing category so newly listed markets land in the
  // right tab without a code change; symbol sets remain the fallback.
  if (apiCategory === "equity") return "stocks";
  if (apiCategory === "commodity") return "commodities";
  if (apiCategory === "crypto") return "crypto";
  const base = getBaseSymbol(marketName);
  if (COMMODITY_SYMBOLS.has(base)) return "commodities";
  if (STOCK_SYMBOLS.has(base)) return "stocks";
  if (CRYPTO_SYMBOLS.has(base)) return "crypto";
  return "crypto";
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
    change24h: market.change24hPct != null
      ? `${market.change24hPct >= 0 ? "+" : ""}${market.change24hPct.toFixed(2)}%`
      : "—",
    volume24h: market.volume24hUsd != null ? fmtStatUsd(market.volume24hUsd) : "—",
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
    category: classifyMarketCategory(market.name, market.category),
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
const MAINNET_ONLY_FALLBACK_MARKETS = new Set(["SPY/USD", "QQQ/USD", "EWY/USD"]);

function getFallbackMarketsForNetwork(network: DecibelPublicNetwork) {
  return network === "mainnet"
    ? MARKETS
    : MARKETS.filter((market) => !MAINNET_ONLY_FALLBACK_MARKETS.has(market.id));
}

function sortMarkets(markets: Market[]) {
  return markets.sort((a, b) => {
    if (a.id === "BTC/USD") return -1;
    if (b.id === "BTC/USD") return 1;
    return a.id.localeCompare(b.id);
  });
}

function mergeMarketsWithFallback(apiMarkets: Market[], network: DecibelPublicNetwork) {
  const merged = new Map<string, Market>();
  for (const market of getFallbackMarketsForNetwork(network)) {
    merged.set(market.id, market);
  }
  for (const market of apiMarkets) {
    merged.set(market.id, market);
  }
  return sortMarkets(Array.from(merged.values()));
}

function MarketLogo({ market, size = 20 }: { market: string; size?: number }) {
  const logo = TOKEN_LOGOS[market] ?? TOKEN_LOGOS[getBaseSymbol(market)];
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
  categories?: readonly { key: MarketCategory; label: string }[];
  loading?: boolean;
  network: DecibelPublicNetwork;
}) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("crypto");

  useEffect(() => {
    if (!open) return;
    const selectedMarket = marketsList.find((market) => market.id === selected);
    if (isMarketCategory(selectedMarket?.category)) {
      setActiveCategory(selectedMarket.category);
    }
  }, [marketsList, open, selected]);

  const filteredMarkets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return marketsList.filter((market) => {
      if (market.category !== activeCategory) return false;
      if (!normalizedQuery) return true;
      return [
        market.label,
        market.pair,
        market.marketName,
        market.id,
        getBaseSymbol(market.id),
      ].some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [activeCategory, marketsList, query]);

  const activeCategoryLabel = useMemo(
    () => categoriesList.find((category) => category.key === activeCategory)?.label ?? "Markets",
    [activeCategory, categoriesList],
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
      className="cash-trade-theme fixed inset-0 z-[9999] flex items-end justify-center px-0 sm:items-center sm:px-4 sm:py-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/85" />

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[calc(100dvh-0.75rem)] w-full overflow-hidden rounded-t-[14px] border-t border-white/[0.08] bg-[#101010] shadow-2xl shadow-black/70 sm:max-w-[900px] sm:rounded-[12px] sm:border"
        style={{ animation: "market-modal-in 0.2s ease-out" }}
      >
        <div className="overflow-hidden">
          {/* Header — same style as PAYMENT_LOGS / APTOS_MAINNET */}
          <header className="flex items-center justify-between border-b border-white/[0.06] bg-[#171717] px-4 py-3 font-mono text-[13px] font-semibold text-[#888] sm:px-5">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
              <span>SELECT MARKET</span>
              <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-400">
                {network}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close market selector"
              className="rounded-md p-2 text-[#666] transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </header>

          {/* Content — grid rows matching table style */}
          <div className="bg-[#101010] p-3 font-mono text-sm font-medium sm:p-4">
            <label className="flex h-10 items-center gap-3 rounded-md bg-white/[0.04] px-3 text-[#777] focus-within:bg-white/[0.06]">
              <Search className="size-4 shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
                placeholder="Search markets"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-200 outline-none placeholder:text-zinc-500"
              />
            </label>

            <div className="mt-4 flex items-center gap-5 overflow-x-auto border-b border-white/[0.06]">
              {categoriesList.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveCategory(tab.key)}
                  className={`pb-2 text-[13px] transition-colors ${
                    activeCategory === tab.key
                      ? "border-b-2 border-zinc-200 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 pb-2 pt-5 text-[#999] sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto] sm:gap-x-4 sm:px-3">
              <span className="text-xs font-bold">Symbol</span>
              <span className="hidden text-right text-xs font-bold sm:block">Price</span>
              <span className="hidden text-right text-xs font-bold sm:block">Funding</span>
              <span className="hidden text-right text-xs font-bold sm:block">Open Interest</span>
              <span className="text-right text-xs font-bold">Lev.</span>
            </div>

            {/* Market rows */}
            <div className="max-h-[calc(100dvh-230px)] overflow-y-auto overscroll-contain pr-1 scrollbar-thin sm:max-h-[min(62dvh,600px)]">
                <div>
                  <div className="sticky top-0 z-[1] flex items-center gap-2 bg-[#101010]/95 px-2 pb-1 pt-3 sm:px-3">
                    <span className="text-[10px] font-bold uppercase text-[#555]">
                      {activeCategoryLabel}
                    </span>
                    {loading && (
                      <span className="text-[10px] font-bold uppercase text-green-500/60">
                        Syncing
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {filteredMarkets.map((m) => {
                      const isActive = m.id === selected;
                      const mark = m.perpData?.seedPrice ?? 0;
                      const fundingText = m.fundingRateBps == null ? "—" : fmtFundingRate(m.fundingRateBps);
                      return (
                        <button
                          key={m.id}
                          onClick={() => { onSelect(m.id); onClose(); }}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-2.5 transition-colors sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto] sm:gap-x-4 sm:px-3 ${
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
                            <span className="truncate text-[11px] text-[#555] sm:shrink-0">{m.pair.replace(/ PERPS$/, "")}</span>
                            {isActive && (
                              <Check className="h-3 w-3 shrink-0 text-green-400" aria-hidden="true" />
                            )}
                          </span>
                          <span className="hidden text-right text-[12px] tabular-nums text-zinc-500 sm:block">
                            {mark > 0 ? mark.toLocaleString("en-US", {
                              minimumFractionDigits: getDisplayDecimals(mark),
                              maximumFractionDigits: getDisplayDecimals(mark),
                            }) : "—"}
                          </span>
                          <span className="hidden text-right text-[12px] tabular-nums text-green-400/80 sm:block">
                            {fundingText}
                          </span>
                          <span className="hidden text-right text-[12px] tabular-nums text-[#555] sm:block">
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
            {filteredMarkets.length === 0 && (
              <div className="flex h-36 items-center justify-center text-[12px] text-zinc-600">
                No {activeCategoryLabel.toLowerCase()} markets match this search.
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
  className,
}: {
  initialHistory?: MarketHistoryCandle[];
  liquidationLines?: LiquidationLine[];
  onMarketChange?: (m: MarketChangePayload) => void;
  onPriceUpdate?: (price: number) => void;
  markets?: Market[];
  categories?: readonly { key: MarketCategory; label: string }[];
  defaultMarket?: string;
  className?: string;
}) {
  const [network, setNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const [liveMarkets, setLiveMarkets] = useState<Market[]>(() =>
    getFallbackMarketsForNetwork(getDecibelPublicNetwork()),
  );
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
  const [overlayMode, setOverlayMode] = useState<"off" | "sma" | "ema" | "strategy">("off");
  const [windowSecs, setWindowSecs] = useState(60);
  const marketConfig = activeMarkets.find((m) => m.id === market) || activeMarkets[0] || MARKETS[0];
  const isPerpsMarket = marketConfig.chartKind === "perps";
  const perpData = marketConfig.perpData ?? null;
  const [perpsSnapshot, setPerpsSnapshot] = useState<PerpMarketSnapshot | null>(null);
  const lastEmittedMarketRef = useRef("");
  const modalOpenRef = useRef(false);
  const liveMarketsRef = useRef(liveMarkets);
  const pendingPerpsSnapshotRef = useRef<PerpMarketSnapshot | null>(null);
  const perpsSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPerpsSnapshotCommitAtRef = useRef(0);

  useEffect(() => onDecibelPublicNetworkChange(setNetwork), []);
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);
  useEffect(() => {
    liveMarketsRef.current = liveMarkets;
  }, [liveMarkets]);

  useEffect(() => {
    if (marketsProp) return;
    setLiveMarkets(getFallbackMarketsForNetwork(network));
  }, [marketsProp, network]);

  useEffect(() => {
    if (marketsProp) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loadMarkets = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(loadMarkets, MARKET_HIDDEN_REFRESH_MS);
        return;
      }
      if (modalOpenRef.current) {
        timer = setTimeout(loadMarkets, MARKET_REFRESH_MS);
        return;
      }

      const firstLoad = liveMarketsRef.current.length === 0;
      setMarketsLoading(firstLoad);
      try {
        const res = await fetch(`/api/decibel/markets?network=${network}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error || "Could not load Decibel markets");
        }
        const apiMarkets = (Array.isArray(json.markets) ? json.markets : [])
          .map(apiMarketToMarket);
        const next = mergeMarketsWithFallback(apiMarkets, network);
        if (!cancelled && next.length > 0 && !modalOpenRef.current) setLiveMarkets(next);
      } catch {
        if (!cancelled && !modalOpenRef.current) {
          setLiveMarkets(getFallbackMarketsForNetwork(network));
        }
      } finally {
        if (!cancelled) {
          setMarketsLoading(false);
          timer = setTimeout(loadMarkets, MARKET_REFRESH_MS);
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
    undefined,
    undefined,
    { preserveStateOnResume: true },
  );

  const priceCallbackRef = useRef(onPriceUpdate);
  priceCallbackRef.current = onPriceUpdate;
  useEffect(() => {
    if (!isPerpsMarket && price > 0) priceCallbackRef.current?.(price);
  }, [isPerpsMarket, price]);

  useEffect(() => {
    return () => {
      if (perpsSnapshotTimerRef.current) clearTimeout(perpsSnapshotTimerRef.current);
    };
  }, []);

  const handlePerpsSnapshotChange = useCallback((nextSnapshot: PerpMarketSnapshot) => {
    pendingPerpsSnapshotRef.current = nextSnapshot;

    const commit = () => {
      perpsSnapshotTimerRef.current = null;
      const latest = pendingPerpsSnapshotRef.current;
      if (!latest) return;
      lastPerpsSnapshotCommitAtRef.current = performance.now();
      setPerpsSnapshot(latest);
      if (latest.price > 0) {
        priceCallbackRef.current?.(latest.price);
      }
    };

    const now = performance.now();
    const elapsed = now - lastPerpsSnapshotCommitAtRef.current;
    if (elapsed >= SNAPSHOT_UI_COMMIT_MS && !perpsSnapshotTimerRef.current) {
      commit();
      return;
    }

    if (!perpsSnapshotTimerRef.current) {
      perpsSnapshotTimerRef.current = setTimeout(commit, Math.max(16, SNAPSHOT_UI_COMMIT_MS - elapsed));
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
  const displayVolume = isPerpsMarket
    ? perpsSnapshot?.volume24h != null
      ? fmtStatUsd(perpsSnapshot.volume24h)
      : perpData?.volume24h ?? "$29.3M"
    : "$29.3M";
  const displayOpenInterest = isPerpsMarket
    ? perpsSnapshot?.openInterest != null
      ? fmtStatUsd(perpsSnapshot.openInterest * Math.max(displayPrice, perpData?.seedPrice ?? 0))
      : perpData?.openInterestLabel ?? "$1.46M"
    : "$1.46M";
  const displayFunding = isPerpsMarket
    ? fmtFundingRate(perpsSnapshot?.fundingRateBps ?? null)
    : "0.0010%";
  const displayPriceDecimals = isPerpsMarket && perpData ? perpData.priceDecimals : 2;
  const displayStatDecimals = isPerpsMarket && perpData ? perpData.priceDecimals : 0;

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
    <div ref={chartRef} className={cn("surface-1 overflow-hidden rounded-[16px] lg:flex lg:flex-col", className)}>
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
          <NumberTicker
            value={displayPrice > 0 ? displayPrice : null}
            fallback="—"
            format={{
              style: "currency",
              currency: "USD",
              minimumFractionDigits: displayPriceDecimals,
              maximumFractionDigits: displayPriceDecimals,
            }}
            className="font-mono text-[15px] font-bold text-zinc-100"
          />
        </div>
      </div>

      {/* Market stats bar */}
      <div className="relative border-b border-white/5">
        <div className="px-4 py-2 flex items-center gap-4 sm:gap-6 overflow-x-auto no-scrollbar text-[11px] font-mono tabular-nums pr-10">
          <div className="flex flex-col shrink-0 min-w-[72px]">
            <span className="text-zinc-600 text-[9px]">Mark Price</span>
            <NumberTicker
              value={displayPrice > 0 ? displayPrice : null}
              fallback="—"
              format={{
                minimumFractionDigits: displayStatDecimals,
                maximumFractionDigits: displayStatDecimals,
              }}
              className="font-semibold text-white"
            />
          </div>
          <div className="flex flex-col shrink-0 min-w-[64px]">
            <span className="text-zinc-600 text-[9px]">Oracle</span>
            <NumberTicker
              value={displayOracle > 0 ? displayOracle : null}
              fallback="—"
              format={{
                minimumFractionDigits: displayStatDecimals,
                maximumFractionDigits: displayStatDecimals,
              }}
              className="font-semibold text-white"
            />
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
      <div className="relative h-[340px] sm:h-[460px] lg:h-[580px] xl:h-auto xl:min-h-0 xl:flex-1">
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
          {isPerpsMarket && (() => {
            // The live trustless strategy vault trades BTC/USD with SMA 3/5 —
            // on that market the toggle gains a "vault strategy" state so the
            // chart shows exactly what the on-chain strategy sees.
            const hasStrategy = perpData?.marketName === "BTC/USD";
            const next = (v: typeof overlayMode) =>
              v === "off" ? "sma"
              : v === "sma" ? "ema"
              : v === "ema" && hasStrategy ? "strategy"
              : "off";
            return (
              <button
                type="button"
                onClick={() => setOverlayMode(next)}
                className={`rounded-[6px] px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors ${
                  overlayMode === "strategy" ? "bg-emerald-500/20 text-emerald-300"
                  : overlayMode !== "off" ? "bg-purple-500/20 text-purple-300"
                  : "text-zinc-500"
                }`}
                title={hasStrategy ? "Overlay moving averages (off → SMA → EMA → Vault 3/5)" : "Overlay moving averages (off → SMA → EMA)"}
              >
                {overlayMode === "ema" ? "EMA" : overlayMode === "strategy" ? "VAULT 3/5" : "SMA"}
              </button>
            );
          })()}
        </div>
        {isPerpsMarket && perpData ? (
          <BtcPerpsChart
            active={chartActive}
            liquidationLines={liquidationLines}
            market={perpData}
            mode={perpsMode}
            onSnapshotChange={handlePerpsSnapshotChange}
            overlayMode={overlayMode}
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
