"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { Header, PageConnectCta } from "@/components/layout/Header";
import {
  MarketModal,
  type Market,
} from "@/components/trade/BTCChart";
import { CashSpotSwap } from "@/components/trade/CashSpotSwap";
import { DecibelSpotSwap } from "@/components/trade/DecibelSpotSwap";
import {
  DECIBEL_MAINNET_SPOT_MARKETS,
  normalizeDecibelSpotAddress,
  resolvePinnedDecibelSpotMarket,
  type DecibelSpotSide,
  type ValidatedDecibelSpotMarket,
} from "@/lib/decibel-spot";
import { PAGE_SHELL_WIDE } from "@/lib/surface";
import { cn } from "@/lib/utils";

type SwapMarketName = "CASH/USDC" | "APT/USDC" | "BTC/USDC";
type SwapAssetId = "CASH" | "APT" | "BTC" | "USDC";
type SelectorSide = "pay" | "receive";

interface SpotMarketsResponse {
  fetchedAt?: number;
  markets?: unknown;
  network?: unknown;
  ready?: unknown;
  resource?: unknown;
}

// v2: the default pair moved from CASH/USDC (not live) to APT/USDC (live on
// Decibel), so selections persisted under the old key are intentionally dropped.
const STORAGE_KEY = "cash:selected-swap-market:v2:mainnet";
const DIRECTION_STORAGE_KEY = "cash:selected-swap-direction:v1:mainnet";
const DEFAULT_MARKET: SwapMarketName = "APT/USDC";
const SPOT_MARKET_REFRESH_MS = 15_000;
const SWAP_CATEGORIES = [{ key: "crypto", label: "Assets" }] as const;

const CASH_ASSET: Market = {
  id: "CASH",
  label: "CASH",
  pair: "CASH/USDC",
  leverage: 0,
  color: "#00d54b",
  category: "crypto",
  marketName: "CASH/USDC",
  mode: "Open",
  displayPrice: null,
  venueLabel: "Not live yet",
};

const USDC_ASSET: Market = {
  id: "USDC",
  label: "USD Coin",
  pair: "USDC",
  leverage: 0,
  color: "#2775ca",
  category: "crypto",
  marketName: "USDC",
  mode: "Open",
  displayPrice: 1,
  venueLabel: "Quote",
};

function isSwapMarketName(value: unknown): value is SwapMarketName {
  return value === "CASH/USDC" || value === "APT/USDC" || value === "BTC/USDC";
}

function isSwapAssetId(value: unknown): value is SwapAssetId {
  return value === "CASH" || value === "APT" || value === "BTC" || value === "USDC";
}

function baseAssetForMarket(market: SwapMarketName): Exclude<SwapAssetId, "USDC"> {
  return market.slice(0, market.indexOf("/")) as Exclude<SwapAssetId, "USDC">;
}

function marketForBaseAsset(asset: Exclude<SwapAssetId, "USDC">): SwapMarketName {
  return `${asset}/USDC`;
}

function validateClientSpotMarkets(value: unknown): ValidatedDecibelSpotMarket[] {
  if (!Array.isArray(value) || value.length !== DECIBEL_MAINNET_SPOT_MARKETS.length) {
    throw new Error("The reviewed Decibel spot registry is incomplete");
  }
  const seen = new Set<string>();
  const markets = value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("A Decibel spot market row is malformed");
    }
    const row = raw as Partial<ValidatedDecibelSpotMarket>;
    const pinned = resolvePinnedDecibelSpotMarket(row.marketAddress);
    if (
      row.marketName !== pinned.marketName
      || normalizeDecibelSpotAddress(row.marketAddress) !== pinned.marketAddress
      || row.assetType !== "spot"
      || row.mode !== "Open"
      || row.baseAssetAddress !== pinned.baseAssetAddress
      || row.quoteAssetAddress !== pinned.quoteAssetAddress
      || row.baseDecimals !== pinned.baseDecimals
      || row.quoteDecimals !== pinned.quoteDecimals
      || row.tickSizeRaw !== pinned.tickSizeRaw
      || row.lotSizeRaw !== pinned.lotSizeRaw
      || row.minSizeRaw !== pinned.minSizeRaw
      || row.minPriceRaw !== pinned.minPriceRaw
      || row.maxPriceRaw !== pinned.maxPriceRaw
      || !Number.isSafeInteger(row.contextTimestampMs)
      || (row.mid !== null && typeof row.mid !== "string")
      || seen.has(row.marketName)
    ) {
      throw new Error("A Decibel spot market changed outside the reviewed configuration");
    }
    seen.add(row.marketName);
    return row as ValidatedDecibelSpotMarket;
  });
  return markets.sort((left, right) => left.marketName.localeCompare(right.marketName));
}

function marketView(market: ValidatedDecibelSpotMarket): Market {
  const symbol = market.marketName.startsWith("BTC") ? "BTC" : "APT";
  return {
    id: symbol,
    label: symbol === "BTC" ? "Bitcoin" : "Aptos",
    pair: market.marketName,
    leverage: 0,
    color: symbol === "BTC" ? "#f7931a" : "#00d54b",
    category: "crypto",
    marketAddr: market.marketAddress,
    marketName: market.marketName,
    mode: market.mode,
    displayPrice: market.mid === null ? null : Number(market.mid),
    venueLabel: "Decibel",
  };
}

/**
 * The reviewed on-chain parameters for a Decibel pair, used as the form's
 * market before (or while) the live registry is unavailable. DecibelSpotSwap
 * quotes only from its own verified orderbook snapshot, so this never feeds a
 * price; it only lets the live pair render its own loading/unavailable state
 * instead of falling back to the CASH form.
 */
function provisionalMarket(marketName: SwapMarketName): ValidatedDecibelSpotMarket {
  const pinned = resolvePinnedDecibelSpotMarket(marketName);
  return { ...pinned, assetType: "spot", mode: "Open", contextTimestampMs: 0, mid: null };
}

function placeholderMarket(
  market: (typeof DECIBEL_MAINNET_SPOT_MARKETS)[number],
): Market {
  const symbol = market.marketName.startsWith("BTC") ? "BTC" : "APT";
  return {
    id: symbol,
    label: symbol === "BTC" ? "Bitcoin" : "Aptos",
    pair: market.marketName,
    leverage: 0,
    color: symbol === "BTC" ? "#f7931a" : "#00d54b",
    category: "crypto",
    marketAddr: market.marketAddress,
    marketName: market.marketName,
    mode: "Checking",
    displayPrice: null,
    venueLabel: "Decibel",
  };
}

export function SwapPageClient() {
  const { connected } = useWallet();
  const [spotMarkets, setSpotMarkets] = useState<ValidatedDecibelSpotMarket[]>([]);
  const [registryStatus, setRegistryStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [selectedMarket, setSelectedMarket] = useState<SwapMarketName>(DEFAULT_MARKET);
  const [activeDirection, setActiveDirection] = useState<DecibelSpotSide>("buy");
  const [selectorSide, setSelectorSide] = useState<SelectorSide | null>(null);
  const [selectorCurrentAsset, setSelectorCurrentAsset] = useState<SwapAssetId | null>(null);
  const [formKey, setFormKey] = useState(0);
  const lastSelectorSideRef = useRef<SelectorSide>("receive");
  const pendingSelectorFocusRef = useRef<SelectorSide | null>(null);
  const payTriggerRef = useRef<HTMLButtonElement>(null);
  const receiveTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let desired: unknown = null;
    try {
      const search = new URLSearchParams(window.location.search);
      desired = search.get("market")
        ?? window.localStorage.getItem(STORAGE_KEY);
      const desiredDirection = search.get("side")
        ?? window.localStorage.getItem(DIRECTION_STORAGE_KEY);
      if (desiredDirection === "buy" || desiredDirection === "sell") {
        setActiveDirection(desiredDirection);
      }
    } catch {
      // Selection persistence is optional.
    }
    if (isSwapMarketName(desired)) setSelectedMarket(desired);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      controller = new AbortController();
      try {
        const response = await fetch("/api/decibel/spot?resource=markets&network=mainnet", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as SpotMarketsResponse;
        if (
          !response.ok
          || body.ready !== true
          || body.resource !== "markets"
          || body.network !== "mainnet"
        ) {
          throw new Error("Decibel spot markets are unavailable");
        }
        const validated = validateClientSpotMarkets(body.markets);
        if (cancelled) return;
        setSpotMarkets(validated);
        setRegistryStatus("ready");
      } catch {
        if (!cancelled && !controller.signal.aborted) setRegistryStatus("unavailable");
      } finally {
        if (!cancelled) timer = setTimeout(load, SPOT_MARKET_REFRESH_MS);
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const selectorMarkets = useMemo<Market[]>(() => {
    const live = new Map(spotMarkets.map((entry) => [entry.marketName, entry]));
    // Live Decibel pairs first; CASH stays selectable but is labelled not live.
    return [
      ...[...DECIBEL_MAINNET_SPOT_MARKETS]
        .sort((left, right) => left.marketName.localeCompare(right.marketName))
        .map((entry) => {
        const validated = live.get(entry.marketName);
        return validated ? marketView(validated) : placeholderMarket(entry);
        }),
      CASH_ASSET,
      USDC_ASSET,
    ];
  }, [spotMarkets]);

  const disabledIds = useMemo<string[]>(
    () => registryStatus === "ready"
      ? DECIBEL_MAINNET_SPOT_MARKETS
          .filter((entry) => !spotMarkets.some((live) => live.marketName === entry.marketName))
          .map((entry) => baseAssetForMarket(entry.marketName))
      : DECIBEL_MAINNET_SPOT_MARKETS.map((entry) => baseAssetForMarket(entry.marketName)),
    [registryStatus, spotMarkets],
  );

  const selectedDecibelMarket = selectedMarket === "CASH/USDC"
    ? undefined
    : spotMarkets.find((entry) => entry.marketName === selectedMarket)
      ?? provisionalMarket(selectedMarket);

  const openSelector = useCallback((side: SelectorSide, currentSymbol: string) => {
    if (!isSwapAssetId(currentSymbol)) return;
    lastSelectorSideRef.current = side;
    setSelectorCurrentAsset(currentSymbol);
    setSelectorSide(side);
  }, []);

  const closeSelector = useCallback(() => {
    pendingSelectorFocusRef.current = lastSelectorSideRef.current;
    setSelectorSide(null);
    setSelectorCurrentAsset(null);
  }, []);

  useEffect(() => {
    if (selectorSide !== null || pendingSelectorFocusRef.current === null) return;
    const side = pendingSelectorFocusRef.current;
    const frame = window.requestAnimationFrame(() => {
      (side === "pay" ? payTriggerRef.current : receiveTriggerRef.current)?.focus();
      pendingSelectorFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectorSide]);

  const persistSelection = useCallback((market: SwapMarketName, direction: DecibelSpotSide) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, market);
      window.localStorage.setItem(DIRECTION_STORAGE_KEY, direction);
      const url = new URL(window.location.href);
      if (market === DEFAULT_MARKET) url.searchParams.delete("market");
      else url.searchParams.set("market", market);
      if (direction === "buy") url.searchParams.delete("side");
      else url.searchParams.set("side", direction);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    } catch {
      // URL and storage persistence are enhancements, not execution inputs.
    }
  }, []);

  const selectAsset = useCallback((id: string) => {
    if (!isSwapAssetId(id) || disabledIds.includes(id) || !selectorSide) return;
    if (id === selectorCurrentAsset) return;

    const nextMarket = id === "USDC"
      ? selectedMarket
      : marketForBaseAsset(id);
    const nextDirection: DecibelSpotSide = selectorSide === "pay"
      ? id === "USDC" ? "buy" : "sell"
      : id === "USDC" ? "sell" : "buy";

    if (nextMarket !== selectedMarket || nextDirection !== activeDirection) {
      setSelectedMarket(nextMarket);
      setActiveDirection(nextDirection);
      setFormKey((value) => value + 1);
      persistSelection(nextMarket, nextDirection);
    }
  }, [activeDirection, disabledIds, persistSelection, selectedMarket, selectorCurrentAsset, selectorSide]);

  const handleDirectionChange = useCallback((direction: DecibelSpotSide) => {
    setActiveDirection(direction);
    persistSelection(selectedMarket, direction);
  }, [persistSelection, selectedMarket]);

  const sharedProps = {
    assetSelectionDisabled: selectorSide !== null,
    assetSelectorSide: selectorSide,
    initialDirection: activeDirection,
    marketLayout: true,
    onDirectionChange: handleDirectionChange,
    onPayAssetSelect: (symbol: string) => openSelector("pay", symbol),
    onReceiveAssetSelect: (symbol: string) => openSelector("receive", symbol),
    payAssetButtonRef: payTriggerRef,
    receiveAssetButtonRef: receiveTriggerRef,
  } as const;

  return (
    // Disconnected, the swap card renders the filled "Connect wallet" primary,
    // so the header must not render its outline copy 500px above it.
    <PageConnectCta present={!connected}>
    {/* pb-10 is the stacked column's bottom breathing room. From md the page
        already ends on <main>'s own padding, and the extra 40px only pushed
        black under the last card — the same trim /trade makes with pb-12
        md:pb-0. */}
    <div className="cash-trade-theme min-h-screen bg-background pb-10 md:pb-0">
      <Header />
      {/* PAGE_SHELL_WIDE, not a private 1800px measure — see TradePageClient. */}
      <main className={cn(PAGE_SHELL_WIDE, "relative z-10 py-3 sm:py-4 lg:py-5")}>
        <h1 className="sr-only">Swap spot assets</h1>
      {!selectedDecibelMarket ? (
        <CashSpotSwap key={`cash-${formKey}`} {...sharedProps} />
      ) : (
        <DecibelSpotSwap
          key={`${selectedDecibelMarket.marketAddress}-${formKey}`}
          {...sharedProps}
          market={selectedDecibelMarket}
        />
      )}

      <MarketModal
        open={selectorSide !== null}
        selected={selectorCurrentAsset ?? baseAssetForMarket(selectedMarket)}
        onSelect={selectAsset}
        onClose={closeSelector}
        markets={selectorMarkets}
        categories={SWAP_CATEGORIES}
        disabledIds={disabledIds}
        disabledLabel={registryStatus === "loading" ? "Checking" : "Unavailable"}
        title={selectorSide === "pay" ? "Choose what you pay" : "Choose what you receive"}
        description={registryStatus === "unavailable"
          ? "Decibel spot assets are temporarily unavailable and will retry automatically. CASH is not live yet."
          : "Choose a live Decibel spot asset against USDC. CASH is not live yet."}
        loading={registryStatus === "loading"}
        network="mainnet"
        selectorVariant="spot"
      />
      </main>
    </div>
    </PageConnectCta>
  );
}
