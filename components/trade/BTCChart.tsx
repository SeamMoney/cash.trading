"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { Liveline } from "liveline";
import { Check, ChevronDown, X } from "lucide-react";
import { usePriceCandles } from "@/hooks/useBtcCandles";
import { useInViewport } from "@/hooks/useInViewport";
import { usePageVisible } from "@/hooks/usePageVisible";
import { TetherLoader } from "@/components/layout/TetherLoader";
import { BtcPerpsChart, type PerpMarketSnapshot } from "@/components/trade/BtcPerpsChart";
import { PERP_MARKET_DATA, type PerpMarketData } from "@/components/trade/perpMarketConfig";
import { NumberTicker } from "@/components/ui/number-ticker";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import type { MarketHistoryCandle } from "@/lib/btc-history";
import type { Candle } from "@/hooks/useBtcCandles";
import { PRESSABLE_CONTROL } from "@/lib/surface";
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
  // Abbreviate big figures — "$17,849,016.40" clips mid-digit in the mobile
  // header; "$17.8M" always fits.
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 100_000) return `$${(v / 1_000).toFixed(0)}K`;
  return "$" + v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtFundingRate(rateBps: number | null) {
  if (rateBps === null || !Number.isFinite(rateBps)) return "—";
  const pct = rateBps / 100;
  return `${pct >= 0 ? "" : "-"}${Math.abs(pct).toFixed(4)}%`;
}

const WINDOWS = [
  { label: "1m", secs: 60 },
  { label: "3m", secs: 180 },
  { label: "5m", secs: 300 },
];
const CHART_PADDING = { top: 8, right: 80, bottom: 24, left: 8 } as const;
/* Portfolio stat-grid type pair, scaled to the compact market header. */
const STAT_LABEL = "text-[11px] font-medium leading-4 text-zinc-400";
const STAT_VALUE = "mt-0.5 truncate font-mono text-[11px] font-semibold leading-4 tabular-nums";
const CANDLE_SECS = 2;
const CANDLE_WINDOW_BUFFER = 0.05;
const MARKET_REFRESH_MS = 60_000;
const MARKET_HIDDEN_REFRESH_MS = 180_000;
const SNAPSHOT_UI_COMMIT_MS = 250;
const TRADE_MARKET_STORAGE_KEY = "cash:selected-trade-market:v1";

function selectedMarketStorageKey(network: DecibelPublicNetwork) {
  return `${TRADE_MARKET_STORAGE_KEY}:${network}`;
}

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

export interface Market {
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
  /** Optional quote used by shared selectors that are not backed by perpData. */
  displayPrice?: number | null;
  /** Short venue label for the shared spot-market selector. */
  venueLabel?: string;
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
  AVAX: "/tokens/avax.svg",
  BNB: "/tokens/bnb.png",
  BTC: "/tokens/btc.png",
  CASH: "/tokens/cash.png",
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
  USDC: "/tokens/usdc.png",
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
  CASH: "CASH",
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
  SPY: "#39ff14",
  QQQ: "#39ff14",
  EWY: "#39ff14",
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

export interface DecibelApiMarket {
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
  /** Execution product from Decibel's authoritative registry. */
  assetType?: string | null;
  /** Decibel's own listing category: "crypto" | "equity" | "commodity" | "". */
  category?: string | null;
  /** Already a percentage (e.g. 1.42 = +1.42%). */
  change24hPct?: number | null;
  volume24hUsd?: number | null;
}

/** Perp-only consumers must cross this product boundary before adapting rows. */
export function isPerpApiMarket(market: DecibelApiMarket) {
  return market.assetType === "perp";
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
  const seedPrice = market.markPrice ?? market.midPrice ?? market.oraclePrice ?? 0;
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
    oraclePrice: market.oraclePrice,
    volatility: 0.0028,
  };
}

export function apiMarketToMarket(market: DecibelApiMarket): Market {
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
    seedPrice: 0,
    oraclePrice: null,
    change24h: "—",
    volume24h: "—",
    openInterestLabel: "—",
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
  // Once Decibel responds, its market registry is authoritative. Keeping
  // legacy fallback symbols in the merged result made the selector advertise
  // markets that may no longer exist on the selected network.
  return apiMarkets.length > 0
    ? sortMarkets([...apiMarkets])
    : sortMarkets([...getFallbackMarketsForNetwork(network)]);
}

export function MarketLogo({ market, size = 20 }: { market: string; size?: number }) {
  const logo = TOKEN_LOGOS[market] ?? TOKEN_LOGOS[getBaseSymbol(market)];
  const needsDarkBacking = getBaseSymbol(market) === "APT";
  if (logo) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        loading="eager"
        decoding="async"
        className={cn(
          "shrink-0 rounded-full object-contain",
          needsDarkBacking && "p-0.5",
        )}
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          backgroundColor: needsDarkBacking ? "var(--background-secondary)" : undefined,
        }}
      />
    );
  }
  const initials = getBaseSymbol(market).slice(0, 3) || "?";
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full bg-background-elevated text-[11px] font-black text-zinc-200"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {initials}
    </span>
  );
}

/* ─── Market selector modal ────────────────────────── */

export function MarketModal({
  open,
  selected,
  selectedIds,
  multiple = false,
  onSelect,
  onToggle,
  onSelectAll,
  onClose,
  markets: marketsList = MARKETS,
  categories: categoriesList = CATEGORIES,
  disabledIds = [],
  title = "Select market",
  description,
  allLabel = "All Decibel markets",
  allDescription = "Crypto, stocks, and commodities",
  loading = false,
  network,
  selectorVariant = "default",
  disabledLabel = "Preview only",
}: {
  open: boolean;
  selected: string;
  selectedIds?: string[];
  multiple?: boolean;
  onSelect: (id: string) => void;
  onToggle?: (id: string) => void;
  onSelectAll?: () => void;
  onClose: () => void;
  markets?: Market[];
  categories?: readonly { key: MarketCategory; label: string }[];
  disabledIds?: string[];
  title?: string;
  description?: string;
  allLabel?: string;
  allDescription?: string;
  loading?: boolean;
  network: DecibelPublicNetwork;
  selectorVariant?: "default" | "spot";
  disabledLabel?: string;
}) {
  const [activeCategory, setActiveCategory] = useState<MarketCategory>("crypto");

  useEffect(() => {
    if (!open) return;
    const selectedMarket = marketsList.find((market) => market.id === selected);
    if (isMarketCategory(selectedMarket?.category)) {
      setActiveCategory(selectedMarket.category);
    }
  }, [marketsList, open, selected]);

  const filteredMarkets = useMemo(
    () => marketsList.filter((market) => market.category === activeCategory),
    [activeCategory, marketsList],
  );

  const activeCategoryLabel = useMemo(
    () => categoriesList.find((category) => category.key === activeCategory)?.label ?? "Markets",
    [activeCategory, categoriesList],
  );
  const activeIds = multiple ? (selectedIds ?? []) : [selected];
  const selectableMarkets = marketsList.filter((market) => !disabledIds.includes(market.id));
  const allSelected = selectableMarkets.length > 0 && selectableMarkets.every((market) => activeIds.includes(market.id));

  if (!open) return null;

  const renderMarketContent = (requestClose: () => void) => (
    <div className="bg-background-secondary py-3 font-mono text-sm font-medium sm:py-0">
      {multiple && (
        <button
          type="button"
          role="checkbox"
          aria-checked={allSelected}
          onClick={onSelectAll}
          className={cn(
            PRESSABLE_CONTROL,
            "mb-3 flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-card-border bg-white/[0.025] px-3 py-3 text-left outline-none transition-[transform,opacity] hover:border-border-strong hover:bg-white/[0.045] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          <span>
            <span className="block font-display text-[13px] font-semibold text-zinc-100">{allLabel}</span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">{allDescription}</span>
          </span>
          <span className={`flex h-5 w-5 items-center justify-center rounded-[var(--radius-xs)] border ${
            allSelected ? "border-accent bg-accent text-black" : "border-white/[0.18] bg-black text-transparent"
          }`}>
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
      )}
      <div className="flex items-center gap-5 overflow-x-auto border-b border-card-border">
        {categoriesList.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={activeCategory === tab.key}
            onClick={() => setActiveCategory(tab.key)}
            className={cn(
              PRESSABLE_CONTROL,
              "flex min-h-11 shrink-0 items-center border-b-2 pt-0.5 text-[13px] outline-none transition-[transform,opacity] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              activeCategory === tab.key
                ? "border-zinc-200 text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-300",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 pb-2 pt-5 text-zinc-400 sm:gap-x-4 sm:px-3",
        selectorVariant === "spot"
          ? "sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_auto]"
          : "sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto]",
      )}>
        <span className="text-xs font-bold">Symbol</span>
        <span className="hidden text-right text-xs font-bold sm:block">Price</span>
        {selectorVariant === "default" && (
          <>
            <span className="hidden text-right text-xs font-bold sm:block">Funding</span>
            <span className="hidden text-right text-xs font-bold sm:block">Open Interest</span>
          </>
        )}
        <span className="text-right text-xs font-bold">
          {selectorVariant === "spot" ? "Venue" : "Lev."}
        </span>
      </div>

      <div className="pr-1 md:max-h-[min(62dvh,600px)] md:overflow-y-auto md:overscroll-contain md:scrollbar-thin">
        <div>
          <div className="sticky top-0 z-[1] flex items-center gap-2 bg-background-secondary/95 px-2 pb-1 pt-3 sm:px-3">
            <span className="text-[11px] font-semibold text-zinc-400">
              {activeCategoryLabel}
            </span>
            {loading && (
              <span className="text-[11px] font-semibold text-accent">
                Syncing
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {filteredMarkets.map((market) => {
              const isActive = activeIds.includes(market.id);
              const isDisabled = disabledIds.includes(market.id);
              const mark = market.displayPrice ?? market.perpData?.seedPrice ?? 0;
              const fundingText =
                market.fundingRateBps == null
                  ? "—"
                  : fmtFundingRate(market.fundingRateBps);
              return (
                <button
                  key={market.id}
                  type="button"
                  aria-pressed={isActive}
                  disabled={isDisabled}
                  onClick={() => {
                    if (multiple) {
                      onToggle?.(market.id);
                    } else {
                      onSelect(market.id);
                      requestClose();
                    }
                  }}
                  className={cn(
                    PRESSABLE_CONTROL,
                    "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-[var(--radius-sm)] px-2 py-2.5 outline-none transition-[transform,opacity] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:transform-none sm:gap-x-4 sm:px-3",
                    selectorVariant === "spot"
                      ? "sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_auto]"
                      : "sm:grid-cols-[minmax(210px,1.4fr)_0.8fr_0.9fr_0.9fr_auto]",
                    isDisabled
                      ? "cursor-not-allowed bg-white/[0.015] text-zinc-400"
                      : isActive
                      ? "bg-white/[0.05] text-foreground"
                      : "text-zinc-400 hover:bg-white/[0.03] hover:text-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      <MarketLogo market={market.id} size={20} />
                    </span>
                    <span className="truncate text-[13px] font-semibold">
                      {market.label}
                    </span>
                    <span className="truncate text-[11px] text-zinc-400 sm:shrink-0">
                      {market.pair.replace(/ PERPS$/, "")}
                    </span>
                    {isActive && (
                      <Check className="size-3 shrink-0 text-accent" aria-hidden="true" />
                    )}
                    {isDisabled && (
                      <span className="shrink-0 rounded-[var(--radius-xs)] border border-card-border bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-zinc-400">{disabledLabel}</span>
                    )}
                  </span>
                  <span className="hidden text-right text-xs tabular-nums text-zinc-400 sm:block">
                    {mark > 0
                      ? mark.toLocaleString("en-US", {
                          minimumFractionDigits: getDisplayDecimals(mark),
                          maximumFractionDigits: getDisplayDecimals(mark),
                        })
                      : "—"}
                  </span>
                  {selectorVariant === "default" && (
                    <>
                      <span className="hidden text-right text-xs tabular-nums text-accent/80 sm:block">
                        {fundingText}
                      </span>
                      <span className="hidden text-right text-xs tabular-nums text-zinc-400 sm:block">
                        {market.perpData?.openInterestLabel ?? "—"}
                      </span>
                    </>
                  )}
                  <span
                    className={`text-right text-xs font-bold tabular-nums ${
                      isActive ? "text-accent" : "text-zinc-400"
                    }`}
                  >
                    {selectorVariant === "spot"
                      ? market.venueLabel ?? "Spot"
                      : market.leverage > 0 ? `${market.leverage}x` : "Spot"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {filteredMarkets.length === 0 && (
          <div className="flex h-36 items-center justify-center text-xs text-zinc-400">
            No {activeCategoryLabel.toLowerCase()} markets are available.
          </div>
        )}
        <div className="h-3" />
      </div>
      {multiple && (
        <div className="sticky bottom-0 border-t border-card-border bg-background-secondary pt-3">
          <button
            type="button"
            onClick={requestClose}
            className={cn(
              PRESSABLE_CONTROL,
              "h-10 w-full rounded-[var(--radius-sm)] bg-accent px-4 font-display text-sm font-semibold text-black outline-none transition-[transform,opacity] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary",
            )}
          >
            Done · {activeIds.length} selected
          </button>
        </div>
      )}
    </div>
  );

  return (
    <ResponsiveModalSheet
      badge={network}
      desktopContentClassName="p-4"
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? `${network} markets`}
      titleId="market-selector-title"
    >
      {renderMarketContent}
    </ResponsiveModalSheet>
  );
}

/* ─── Chart component ──────────────────────────────── */

export { MARKETS as DEFAULT_MARKETS, CATEGORIES as DEFAULT_CATEGORIES };

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
  const marketTriggerRef = useRef<HTMLButtonElement>(null);
  const pageVisible = usePageVisible();
  const inViewport = useInViewport(chartRef, { rootMargin: "160px" });
  const chartActive = pageVisible && inViewport;
  const [market, setMarket] = useState(defaultMarket ?? activeMarkets[0]?.id ?? "BTC/USD");
  const persistedMarketRef = useRef<string | null>(null);
  const persistMarketSelection = marketsProp == null && defaultMarket == null;
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<"line" | "candle">("candle");
  const [perpsMode, setPerpsMode] = useState<"line" | "candle">("candle");
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
    let requestController: AbortController | null = null;

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
      requestController?.abort();
      requestController = new AbortController();
      const requestTimeout = setTimeout(() => requestController?.abort(), 12_000);
      try {
        const res = await fetch(`/api/decibel/markets?network=${network}`, {
          cache: "no-store",
          signal: requestController.signal,
        });
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error || "Could not load Decibel markets");
        }
        const apiMarkets = (Array.isArray(json.markets) ? json.markets : [])
          // TradePanel and /api/decibel/order are perp-only. Spot markets have
          // a different contract ABI and belong exclusively on /swap.
          .filter(isPerpApiMarket)
          .map(apiMarketToMarket);
        const next = mergeMarketsWithFallback(apiMarkets, network);
        if (!cancelled && next.length > 0 && !modalOpenRef.current) {
          liveMarketsRef.current = next;
          setLiveMarkets(next);
        }
      } catch {
        // Keep the last good registry. A transient refresh failure must not
        // make dozens of live Decibel markets disappear from the selector.
      } finally {
        clearTimeout(requestTimeout);
        if (!cancelled) {
          setMarketsLoading(false);
          timer = setTimeout(loadMarkets, MARKET_REFRESH_MS);
        }
      }
    };

    void loadMarkets();

    return () => {
      cancelled = true;
      requestController?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [marketsProp, network]);

  useEffect(() => {
    persistedMarketRef.current = null;
    if (!persistMarketSelection) return;
    try {
      persistedMarketRef.current = window.localStorage.getItem(
        selectedMarketStorageKey(network),
      );
    } catch {
      // Storage can be unavailable in private browsing; the chart still works
      // with its normal first-market fallback.
    }
  }, [network, persistMarketSelection]);

  useEffect(() => {
    if (activeMarkets.length === 0) return;
    setMarket((current) => {
      const persistedMarket = persistedMarketRef.current;
      if (persistedMarket && activeMarkets.some((entry) => entry.id === persistedMarket)) {
        persistedMarketRef.current = null;
        return persistedMarket;
      }
      return activeMarkets.some((entry) => entry.id === current)
        ? current
        : activeMarkets[0].id;
    });
  }, [activeMarkets]);
  const { ticks, candles, liveCandle, price } = usePriceCandles(
    marketConfig.id,
    chartActive && !isPerpsMarket,
    marketConfig.id === "BTC/USD" ? initialHistory : EMPTY_HISTORY,
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
  const displayOracle = isPerpsMarket
    ? (perpsSnapshot?.oraclePrice || perpData?.oraclePrice || 0)
    : 0;
  const displayChange = isPerpsMarket ? perpData?.change24h ?? "—" : "—";
  // Prefer the indexer's exact 24h figure (perpData, from asset_contexts) —
  // the snapshot's estimate only sees candles loaded since mount, so it
  // undercounts and grows over the session.
  const displayVolume = isPerpsMarket
    ? perpData?.volume24h && perpData.volume24h !== "—"
      ? perpData.volume24h
      : perpsSnapshot?.volume24h != null
        ? fmtStatUsd(perpsSnapshot.volume24h)
        : "—"
    : "—";
  const displayOpenInterest = isPerpsMarket
    ? perpsSnapshot?.openInterest != null
      ? fmtStatUsd(perpsSnapshot.openInterest * Math.max(displayPrice, perpData?.seedPrice ?? 0))
      : perpData?.openInterestLabel ?? "—"
    : "—";
  const displayFunding = isPerpsMarket
    ? fmtFundingRate(perpsSnapshot?.fundingRateBps ?? marketConfig.fundingRateBps ?? null)
    : "—";
  const displayPriceDecimals = isPerpsMarket && perpData ? perpData.priceDecimals : 2;
  const displayStatDecimals = isPerpsMarket && perpData ? perpData.priceDecimals : 0;

  const handleMarketSelect = (id: string) => {
    persistedMarketRef.current = null;
    if (persistMarketSelection) {
      try {
        window.localStorage.setItem(selectedMarketStorageKey(network), id);
      } catch {
        // Keep selection functional when browser storage is unavailable.
      }
    }
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
  const closeMarketModal = useCallback(() => {
    setModalOpen(false);
    window.requestAnimationFrame(() => marketTriggerRef.current?.focus());
  }, []);

  return (
    <div ref={chartRef} className={cn("overflow-hidden rounded-[var(--radius)] border border-card-border bg-background-secondary lg:flex lg:flex-col", className)}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-card-border">
        <div className="flex items-center gap-3">
          {/* Market selector trigger */}
          <button
            ref={marketTriggerRef}
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="Open market selector"
            aria-haspopup="dialog"
            aria-expanded={modalOpen}
            className={cn(
              PRESSABLE_CONTROL,
              "-mx-2 -my-1.5 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 outline-none transition-[transform,opacity] hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <MarketLogo market={market} />
            <span className="text-[13px] font-display font-semibold whitespace-nowrap">
              {marketConfig.pair.replace(" PERPS", "")}
            </span>
            <span className="rounded-[var(--radius-xs)] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] font-bold text-zinc-400">
              {marketConfig.leverage > 0 ? `${marketConfig.leverage}x` : "Spot"}
            </span>
            <ChevronDown className="h-3 w-3 text-zinc-500" aria-hidden="true" />
          </button>

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
            className="font-mono text-base font-semibold tabular-nums text-foreground"
          />
        </div>
      </div>

      {/* Market stats bar — same label/value type pair as the Portfolio stat
          grid: a plain sentence-case label above a mono tabular value. */}
      <div className="border-b border-card-border">
        <dl className="grid grid-cols-5 gap-x-2 px-4 py-2.5 sm:gap-x-5">
          <div className="flex min-w-0 flex-col">
            <dt className={STAT_LABEL}>Oracle</dt>
            <dd className={cn(STAT_VALUE, "text-foreground")}>
              <NumberTicker
                value={displayOracle > 0 ? displayOracle : null}
                fallback="—"
                format={{
                  minimumFractionDigits: displayStatDecimals,
                  maximumFractionDigits: displayStatDecimals,
                }}
                className="truncate"
              />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className={STAT_LABEL}>24h</dt>
            <dd className={cn(STAT_VALUE, displayChange === "—" ? "text-zinc-400" : displayChange.startsWith("-") ? "text-danger" : "text-accent")}>
              {displayChange}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className={STAT_LABEL}>Volume</dt>
            <dd className={cn(STAT_VALUE, "text-foreground")}>{displayVolume}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className={STAT_LABEL}>OI</dt>
            <dd className={cn(STAT_VALUE, "text-foreground")}>{displayOpenInterest}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className={STAT_LABEL}>Funding</dt>
            <dd className={cn(STAT_VALUE, displayFunding === "—" ? "text-zinc-400" : displayFunding.startsWith("-") ? "text-danger" : "text-accent")}>
              {displayFunding}
            </dd>
          </div>
        </dl>
      </div>

      {/* Chart + subtle overlay controls.
          The plot surface is plain. Both chart paths paint their legacy
          dotted lattice from --chart-grid; scoping that token to transparent
          here retires the decibrrr-terminal pattern without reaching into
          the shared chart components. The card keeps its border-token frame,
          so no extra rules are drawn behind the price. */}
      <div
        className="relative h-[340px] sm:h-[460px] lg:h-[580px] xl:h-auto xl:min-h-0 xl:flex-1"
        style={{ "--chart-grid": "transparent" } as React.CSSProperties}
      >
        {/* Floating Line/Candles switcher — bottom-right on all screen sizes */}
        {isPerpsMarket && (
          <div className="absolute bottom-[30px] left-0 right-[80px] z-[15] h-[7px] pointer-events-none bg-background-secondary" />
        )}
        {/* Right-side fade to prevent x-axis labels from touching the button */}
        <div className="absolute bottom-0 right-0 z-[15] w-[120px] h-[32px] pointer-events-none bg-gradient-to-l from-background-secondary via-background-secondary/80 to-transparent" />
        <div className="absolute bottom-2 right-2 z-20 flex items-center rounded-[var(--radius-sm)] border border-card-border bg-background-secondary/90 p-0.5">
          <button
            type="button"
            aria-pressed={(isPerpsMarket ? perpsMode : mode) === "line"}
            onClick={() => isPerpsMarket ? setPerpsMode("line") : setMode("line")}
            className={`rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              (isPerpsMarket ? perpsMode : mode) === "line"
                ? "bg-white/[0.1] text-foreground"
                : "text-zinc-400"
            }`}
          >
            Line
          </button>
          <button
            type="button"
            aria-pressed={(isPerpsMarket ? perpsMode : mode) === "candle"}
            onClick={() => isPerpsMarket ? setPerpsMode("candle") : setMode("candle")}
            className={`rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              (isPerpsMarket ? perpsMode : mode) === "candle"
                ? "bg-white/[0.1] text-foreground"
                : "text-zinc-400"
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
                aria-label={`Moving-average overlay: ${overlayMode}`}
                onClick={() => setOverlayMode(next)}
                className={`rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] font-mono font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  overlayMode === "strategy" ? "bg-success/15 text-success"
                  : overlayMode !== "off" ? "bg-purple-500/15 text-purple-500"
                  : "text-zinc-400"
                }`}
                title={hasStrategy ? "Overlay moving averages (off → SMA → EMA → Vault 3/5)" : "Overlay moving averages (off → SMA → EMA)"}
              >
                {overlayMode === "ema" ? "EMA" : overlayMode === "strategy" ? "Vault 3/5" : "SMA"}
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
                      className="absolute top-1/2 -translate-y-1/2 rounded-[var(--radius-xs)] border px-2 py-1 text-[11px] font-mono font-semibold text-white"
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
          <div className="absolute top-2 left-3 flex items-center gap-0.5 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
            {WINDOWS.map((w) => (
              <button
                key={w.secs}
                type="button"
                aria-pressed={windowSecs === w.secs}
                onClick={() => setWindowSecs(w.secs)}
                className={`pointer-events-auto rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  windowSecs === w.secs
                    ? "bg-white/10 text-foreground"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {w.label}
              </button>
            ))}
            <span className="w-px h-3 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => setMode((m) => (m === "candle" ? "line" : "candle"))}
              className="pointer-events-auto rounded-[var(--radius-xs)] px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        onClose={closeMarketModal}
        markets={activeMarkets}
        categories={activeCategories}
        loading={marketsLoading}
        network={network}
      />
    </div>
  );
}
