"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Check, ChevronDown } from "lucide-react";
import { dispatchPortfolioActivity } from "@/lib/portfolio-events";
import { explorerTxUrl } from "@/lib/constants";
import { getEstimatedLiquidationPrice } from "@/lib/trade-utils";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import { emitDecibelTradeConfirmed } from "@/lib/decibel-trade-events";
import { extractConfirmedDecibelFill } from "@/lib/decibel-trade-fill";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { ensureBuilderApproval } from "@/lib/decibel-builder-approval";
import {
  COLLATERAL_TOKENS,
  type CollateralToken,
  TokenLogo,
} from "@/components/trade/StablecoinLogo";
// import { OrderBook } from "@/components/trade/OrderBook";

const LEVERAGE_MIN = 1.1;
/** Drawer height: pt-4 + 44px slider hit area + mt-2 + the min/max caption. */
const SLIDER_CONTENT_HEIGHT = 92;
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/* House style is sentence case: no uppercase, no letter-spacing. min-h-11
   keeps the side switch a 44px touch target without a visible box. */
const SIDE_BUTTON =
  "inline-flex min-h-11 items-center rounded-[var(--radius-xs)] px-1 text-sm font-display font-semibold transition-colors";

type OrderLifecycle =
  | "idle"
  | "building"
  | "wallet"
  | "submitted"
  | "open"
  | "filled"
  | "canceled"
  | "stale-oracle-denied"
  | "denied"
  | "error";

type MarketStatus = {
  isOpen: boolean;
  mode: string;
  markPrice: number | null;
};

export function TradePanel({
  market = "BTC/USDC",
  marketId,
  marketName,
  marketAddress,
  maxLeverage = 40,
  currentPrice = 0,
  className,
}: {
  market?: string;
  marketId?: string;
  marketName?: string;
  marketAddress?: string;
  maxLeverage?: number;
  currentPrice?: number;
  chartHeight?: number;
  className?: string;
}) {
  const { account, connected } = useWallet();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const [side, setSide] = useState<"long" | "short">("long");
  const [amount, setAmount] = useState("");
  const [availableUsdc, setAvailableUsdc] = useState<number | null>(null);
  const [collateralToken, setCollateralToken] = useState<CollateralToken>("USDC");
  const [collateralOpen, setCollateralOpen] = useState(false);
  const [leverage, setLeverage] = useState(1.1);
  const [dragging, setDragging] = useState(false);
  const [leverageOpen, setLeverageOpen] = useState(false);
  const [tradeStatus, setTradeStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [tradeAction, setTradeAction] = useState<"idle" | "order">("idle");
  const [orderLifecycle, setOrderLifecycle] = useState<OrderLifecycle>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusHash, setStatusHash] = useState("");
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [decibelNetwork, setDecibelNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const collateralDropdownRef = useRef<HTMLDivElement>(null);
  const collateralTriggerRef = useRef<HTMLButtonElement>(null);
  const submissionTokenRef = useRef<symbol | null>(null);
  const statusResetTokenRef = useRef<symbol | null>(null);
  const {
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    owner,
    selectedSubaccount,
    subaccounts,
  } = useDecibelSubaccounts();
  const decibelMarketName =
    marketName ||
    (marketId && PERP_MARKET_DATA[marketId]?.marketName) ||
    market.replace(" PERPS", "").replace("/USDT", "/USD").replace("/USDC", "/USD");
  const tradeContext = `${owner}:${decibelNetwork}:${selectedSubaccount ?? ""}:${decibelMarketName}`;
  const tradeContextRef = useRef(tradeContext);
  tradeContextRef.current = tradeContext;
  const inputAmount = Number(amount);
  const hasTradeAmount = Number.isFinite(inputAmount) && inputAmount > 0;
  const supportedDecibelMarket = Boolean(decibelMarketName || marketAddress);
  const usesDecibelCollateral = collateralToken === "USDC";
  const canUseDecibel = Boolean(
    connected && account && hasDecibelAccount && supportedDecibelMarket && usesDecibelCollateral
  );
  const marketAllowsOrders = marketStatus?.isOpen !== false;
  const canSubmitDecibel = Boolean(canUseDecibel && marketAllowsOrders && hasTradeAmount && currentPrice > 0 && tradeStatus !== "submitting");
  const isOrderSubmitting = tradeStatus === "submitting" && tradeAction === "order";
  const isOrderSuccess = tradeStatus === "success" && tradeAction === "order";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setLeverageOpen(true);
    }
  }, []);

  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

  useEffect(() => {
    if (!selectedSubaccount) {
      setAvailableUsdc(null);
      return;
    }

    let cancelled = false;
    const loadAvailableUsdc = async () => {
      try {
        const response = await fetch(
          `/api/decibel/positions?address=${encodeURIComponent(selectedSubaccount)}&openOrders=false&network=${decibelNetwork}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => null) as {
          overview?: { crossWithdrawable?: number };
        } | null;
        const next = Number(data?.overview?.crossWithdrawable);
        if (!cancelled && response.ok) {
          setAvailableUsdc(Number.isFinite(next) ? Math.max(0, next) : null);
        }
      } catch {
        if (!cancelled) setAvailableUsdc(null);
      }
    };

    void loadAvailableUsdc();
    const interval = window.setInterval(() => void loadAvailableUsdc(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [decibelNetwork, selectedSubaccount]);

  useEffect(() => {
    submissionTokenRef.current = null;
    statusResetTokenRef.current = null;
    setTradeStatus("idle");
    setTradeAction("idle");
    setOrderLifecycle("idle");
    setStatusMessage("");
    setStatusHash("");
  }, [tradeContext]);

  useEffect(() => {
    if (!collateralOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!collateralDropdownRef.current?.contains(event.target as Node)) {
        setCollateralOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCollateralOpen(false);
      collateralTriggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [collateralOpen]);

  useEffect(() => {
    if (!supportedDecibelMarket) {
      setMarketStatus(null);
      return;
    }

    const controller = new AbortController();

    const params = new URLSearchParams({ network: decibelNetwork });
    if (marketAddress) params.set("marketAddress", marketAddress);
    else params.set("marketName", decibelMarketName);

    fetch(`/api/decibel/order?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || json.error) {
          throw new Error(json.error || "Could not read market status");
        }
        setMarketStatus(json.marketStatus ?? null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMarketStatus(null);
      });

    return () => controller.abort();
  }, [decibelMarketName, decibelNetwork, marketAddress, supportedDecibelMarket]);

  const leveragePct =
    ((leverage - LEVERAGE_MIN) / (maxLeverage - LEVERAGE_MIN)) * 100;

  const updateLeverage = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = LEVERAGE_MIN + pct * (maxLeverage - LEVERAGE_MIN);
      const snapped = Math.round(raw * 10) / 10;
      setLeverage(Math.max(LEVERAGE_MIN, Math.min(maxLeverage, snapped)));
    },
    [maxLeverage]
  );

  const handleLeverageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next = leverage;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 0.1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 0.1;
    else if (event.key === "PageDown") next -= 1;
    else if (event.key === "PageUp") next += 1;
    else if (event.key === "Home") next = LEVERAGE_MIN;
    else if (event.key === "End") next = maxLeverage;
    else return;
    event.preventDefault();
    setLeverage(Math.round(Math.max(LEVERAGE_MIN, Math.min(maxLeverage, next)) * 10) / 10);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    setDragging(true);
    dragRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateLeverage(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    updateLeverage(e.clientX);
  };

  const handlePointerUp = () => {
    setDragging(false);
    setTimeout(() => { dragRef.current = false; }, 50);
  };

  const handleSubmit = useCallback(async () => {
    const collateral = Number(amount);
    if (submissionTokenRef.current) return;
    if (!connected || !account) {
      setStatusMessage("Connect wallet before placing a Decibel order.");
      setTradeStatus("error");
      return;
    }
    if (isLoadingSubaccounts || lookupIncomplete) {
      setStatusMessage(
        "Decibel account lookup is not verified yet. Open the account modal and refresh."
      );
      setTradeStatus("error");
      return;
    }
    if (!selectedSubaccount || !subaccounts.some((s) => s.address === selectedSubaccount)) {
      setStatusMessage("Create a Decibel trading account before placing orders.");
      setTradeStatus("error");
      return;
    }
    if (collateralToken !== "USDC") {
      setStatusMessage("Decibel perps currently require USDC collateral.");
      setTradeStatus("error");
      return;
    }
    if (!supportedDecibelMarket) {
      setStatusMessage("Select a Decibel market before placing orders.");
      setTradeStatus("error");
      setOrderLifecycle("denied");
      return;
    }
    if (marketStatus?.isOpen === false) {
      const code = /stale|oracle/i.test(marketStatus.mode)
        ? "stale-oracle-denied"
        : "denied";
      setStatusMessage(
        /stale|oracle/i.test(marketStatus.mode)
          ? `${decibelMarketName} is blocked because the oracle is stale.`
          : `${decibelMarketName} is not open (${marketStatus.mode}).`
      );
      setTradeStatus("error");
      setOrderLifecycle(code);
      return;
    }
    if (!Number.isFinite(collateral) || collateral <= 0) {
      setStatusMessage("Enter a USDC amount before placing an order.");
      setTradeStatus("error");
      return;
    }
    if (currentPrice <= 0) {
      setStatusMessage("Market price is not ready yet. Refresh before placing an order.");
      setTradeStatus("error");
      return;
    }
    const submissionToken = Symbol("decibel-order");
    const startedInContext = tradeContextRef.current;
    const isCurrentSubmission = () =>
      submissionTokenRef.current === submissionToken
      && tradeContextRef.current === startedInContext;
    submissionTokenRef.current = submissionToken;
    statusResetTokenRef.current = null;
    inputRef.current?.blur();
    setTradeAction("order");
    setTradeStatus("submitting");
    setOrderLifecycle("building");
    setStatusMessage("Build Decibel market order...");
    setStatusHash("");

    try {
      // First trade only: sign the one-time builder-fee consent so this and
      // every later order carries the cash.trading code. Must land BEFORE the
      // order is built — the order route reads the approval on-chain.
      if (selectedSubaccount) {
        await ensureBuilderApproval({
          subaccount: selectedSubaccount,
          network: decibelNetwork,
          signAndSubmit: signAndSubmitDecibelTransaction as never,
          onStep: (message) => {
            if (isCurrentSubmission()) setStatusMessage(message);
          },
        });
        if (!isCurrentSubmission()) return;
        setStatusMessage("Build Decibel market order...");
      }

      const orderValue = collateral * leverage;
      const size = orderValue / currentPrice;
      const res = await fetch("/api/decibel/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketName: decibelMarketName,
          marketAddress,
          network: decibelNetwork,
          price: currentPrice,
          size,
          isBuy: side === "long",
          orderType: "market",
          subaccount: selectedSubaccount,
        }),
      });
      const json = await res.json();
      if (!isCurrentSubmission()) return;
      if (!res.ok || json.error) {
        const code = typeof json.code === "string" ? json.code : "";
        if (code === "STALE_ORACLE_DENIED") setOrderLifecycle("stale-oracle-denied");
        else if (code === "MARKET_CLOSED") setOrderLifecycle("denied");
        throw new Error(json.error || "Order builder failed");
      }

      if (json.meta?.marketStatus) setMarketStatus(json.meta.marketStatus);
      setOrderLifecycle("wallet");
      setStatusMessage("Sign Decibel order in your wallet...");
      const result = await signAndSubmitDecibelTransaction({ data: json.payload });
      if (isCurrentSubmission()) {
        setStatusHash(result.hash);
        setOrderLifecycle("submitted");
        setStatusMessage("Order submitted. Waiting for on-chain confirmation...");
      }
      emitDecibelPositionsRefresh();
      const confirmedTransaction = await waitForTransactionConfirmation(result.hash);
      emitDecibelPositionsRefresh();
      if (!isCurrentSubmission()) return;
      const confirmedFill = extractConfirmedDecibelFill({
        transaction: confirmedTransaction,
        subaccount: selectedSubaccount,
        marketAddress: json.meta?.marketAddress ?? marketAddress,
        requestedSize: json.meta?.size,
        requestedSizeRaw: json.meta?.sizeRaw,
        requestedPrice: json.meta?.price,
        requestedPriceRaw: json.meta?.priceRaw,
      });
      if (confirmedFill) {
        emitDecibelTradeConfirmed({
          marketAddress: json.meta?.marketAddress ?? marketAddress,
          marketName: decibelMarketName,
          price: confirmedFill.price,
          size: confirmedFill.size,
          side: side === "long" ? "buy" : "sell",
          timestamp: Date.now(),
          txRef: result.hash,
        });
      }
      setStatusMessage("Order confirmed. Checking Decibel position state...");

      const positionsRes = await fetch(
        `/api/decibel/positions?address=${selectedSubaccount}&openOrders=true&network=${decibelNetwork}`
      );
      const positionsJson = await positionsRes.json().catch(() => ({}));
      if (!isCurrentSubmission()) return;
      const hasMatchingPosition = Array.isArray(positionsJson.positions)
        ? positionsJson.positions.some(
            (position: { market?: string }) =>
              position.market === decibelMarketName || position.market === market
          )
        : false;
      const hasMatchingOpenOrder = Array.isArray(positionsJson.openOrders)
        ? positionsJson.openOrders.some(
            (order: { market?: string; isBuy?: boolean }) =>
              (order.market === decibelMarketName || order.market === market) &&
              order.isBuy === (side === "long")
          )
        : false;

      setTradeStatus("success");
      setOrderLifecycle(hasMatchingPosition ? "filled" : hasMatchingOpenOrder ? "open" : "submitted");
      setStatusMessage(
        hasMatchingPosition
          ? "Decibel order confirmed and position detected."
          : hasMatchingOpenOrder
          ? "Decibel order confirmed and resting open."
          : "Decibel order confirmed. Waiting for indexed fill state."
      );
      dispatchPortfolioActivity({
        type: side === "long" ? "Long" : "Short",
        amount: collateral,
        market,
      });
      emitDecibelPositionsRefresh();
      setAmount("");
      const resetToken = Symbol("decibel-order-reset");
      statusResetTokenRef.current = resetToken;
      setTimeout(() => {
        if (
          statusResetTokenRef.current !== resetToken
          || tradeContextRef.current !== startedInContext
        ) return;
        statusResetTokenRef.current = null;
        setTradeStatus("idle");
        setTradeAction("idle");
        setOrderLifecycle("idle");
      }, 2500);
    } catch (err) {
      if (isCurrentSubmission()) {
        setStatusMessage(err instanceof Error ? err.message : "Order failed");
        setTradeStatus("error");
        setOrderLifecycle((current) =>
          current === "stale-oracle-denied" || current === "denied"
            ? current
            : "error"
        );
      }
    } finally {
      if (submissionTokenRef.current === submissionToken) {
        submissionTokenRef.current = null;
      }
    }
  }, [
    account,
    amount,
    collateralToken,
    connected,
    currentPrice,
    decibelMarketName,
    decibelNetwork,
    leverage,
    isLoadingSubaccounts,
    lookupIncomplete,
    market,
    marketAddress,
    marketStatus,
    selectedSubaccount,
    side,
    signAndSubmitDecibelTransaction,
    subaccounts,
    supportedDecibelMarket,
  ]);

  const isLong = side === "long";
  const submitLabel =
    collateralToken !== "USDC"
      ? "Select USDC for Decibel"
      : !connected
        ? "Connect wallet"
      : isLoadingSubaccounts
        ? "Checking account"
      : lookupIncomplete
        ? "Verify account"
      : !hasDecibelAccount
        ? "Create account first"
      : !supportedDecibelMarket
        ? `${decibelMarketName} unavailable`
      : marketStatus?.isOpen === false
        ? /stale|oracle/i.test(marketStatus.mode)
          ? "Oracle stale"
          : "Market closed"
      : !hasTradeAmount
        ? "Enter amount"
      : isLong
        ? `Long ${market}`
        : `Short ${market}`;
  return (
    <div className={cn("flex flex-col", className)}>
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={isLong}
            onClick={() => {
              setSide("long");
              if (tradeStatus !== "submitting") setOrderLifecycle("idle");
            }}
            className={cn(
              SIDE_BUTTON,
              FOCUS_RING,
              isLong ? "text-success" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {isLong ? "You are long" : "Long"}
          </button>
          <span className="text-zinc-600">/</span>
          <button
            type="button"
            aria-pressed={!isLong}
            onClick={() => {
              setSide("short");
              if (tradeStatus !== "submitting") setOrderLifecycle("idle");
            }}
            className={cn(
              SIDE_BUTTON,
              FOCUS_RING,
              !isLong ? "text-danger" : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {!isLong ? "You are short" : "Short"}
          </button>
        </div>
        <span className="rounded-[var(--radius-xs)] bg-white/[0.03] px-2.5 py-1 text-[11px] font-mono text-zinc-500">
          0.034% Fee
        </span>
      </div>

      {/* Amount input card */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-card-border bg-background-secondary">
        <div className="flex items-center justify-between px-4 pt-3 font-mono text-[11px] tabular-nums text-zinc-500 sm:px-5">
          <span>
            Available {availableUsdc == null
              ? "—"
              : availableUsdc.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC
          </span>
          <button
            type="button"
            onClick={() => {
              if (availableUsdc == null) return;
              setAmount(availableUsdc.toFixed(6).replace(/\.?0+$/, ""));
              setTradeStatus("idle");
              setOrderLifecycle("idle");
            }}
            disabled={availableUsdc == null || availableUsdc <= 0}
            className={cn(
              // The chip stays small, but an invisible 44px-tall band centred
              // on it carries the tap so the control is thumb-reachable.
              "relative rounded-[var(--radius-xs)] px-2 py-1 text-[11px] font-semibold text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:text-zinc-600",
              "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
              FOCUS_RING,
            )}
          >
            MAX
          </button>
        </div>
        {/* Input row */}
        <div className="relative z-[1] flex items-center justify-between rounded-[var(--radius)] bg-background-tertiary px-4 py-3 sm:px-5 sm:py-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            aria-label="Order collateral amount"
            aria-describedby={statusMessage ? "trade-status-message" : undefined}
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if (v.split(".").length <= 2) setAmount(v);
              if (tradeStatus !== "idle") {
                setTradeStatus("idle");
                setOrderLifecycle("idle");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            style={{ fontSize: "28px" }}
            className="w-full min-w-0 rounded-[var(--radius-xs)] bg-transparent font-mono font-bold tracking-tight text-foreground placeholder-zinc-600 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div ref={collateralDropdownRef} className="relative shrink-0 ml-4">
            <button
              ref={collateralTriggerRef}
              type="button"
              aria-controls="trade-collateral-menu"
              aria-expanded={collateralOpen}
              aria-haspopup="menu"
              onClick={() => setCollateralOpen((open) => !open)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-white/[0.05] px-3 py-2 transition-colors hover:bg-white/[0.08]",
                FOCUS_RING,
              )}
            >
              <TokenLogo token={collateralToken} size={22} />
              <span className="text-sm font-display font-semibold text-foreground">
                {collateralToken}
              </span>
              <ChevronDown className={`h-3 w-3 text-zinc-500 transition-transform ${collateralOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {collateralOpen && (
              <div id="trade-collateral-menu" role="menu" className="absolute right-0 top-[calc(100%+8px)] z-30 flex w-[178px] flex-col gap-1 rounded-[var(--radius-sm)] border border-card-border bg-background-elevated p-1 shadow-2xl shadow-black/40">
                {COLLATERAL_TOKENS.map((token) => {
                  const active = token.symbol === collateralToken;
                  return (
                    <button
                      key={token.symbol}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setCollateralToken(token.symbol);
                        setCollateralOpen(false);
                        collateralTriggerRef.current?.focus();
                        if (tradeStatus !== "idle") {
                          setTradeStatus("idle");
                          setOrderLifecycle("idle");
                        }
                      }}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-xs)] px-2.5 py-2 text-left transition-colors",
                        FOCUS_RING,
                        active
                          ? "bg-white/[0.05] text-foreground"
                          : "text-zinc-400 hover:bg-white/[0.03] hover:text-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <TokenLogo token={token.symbol} size={20} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-display font-semibold leading-tight">
                            {token.symbol}
                          </span>
                          <span className="block text-[11px] leading-tight text-zinc-500">
                            {token.name}
                          </span>
                        </span>
                      </span>
                      {active && (
                        <Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Leverage mini drawer */}
        <div>
          <div
            className="overflow-hidden transition-[height] duration-150 ease-out motion-reduce:transition-none"
            style={{ height: leverageOpen ? SLIDER_CONTENT_HEIGHT : 0 }}
          >
            <div
              className="px-5 pt-4 transition-transform duration-150 ease-out motion-reduce:transition-none"
              style={{ transform: leverageOpen ? "translateY(0)" : "translateY(-12px)" }}
            >
              <div
                ref={trackRef}
                id="trade-leverage-slider"
                aria-label="Leverage"
                aria-valuemax={maxLeverage}
                aria-valuemin={LEVERAGE_MIN}
                aria-valuenow={leverage}
                aria-valuetext={`${leverage.toFixed(1)} times`}
                className={cn(
                  // 44px tall hit area, 24px visible bar. updateLeverage reads
                  // only rect.left/rect.width, so the taller box is inert to
                  // the drag math.
                  "relative flex h-11 cursor-pointer touch-none items-center rounded-full",
                  FOCUS_RING,
                )}
                onKeyDown={handleLeverageKeyDown}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                role="slider"
                tabIndex={leverageOpen ? 0 : -1}
              >
                <div className="relative h-6 w-full overflow-hidden rounded-full bg-zinc-800">
                  {leveragePct > 0 && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `calc(${leveragePct}% + 12px)`,
                        background: isLong ? "var(--accent)" : "var(--danger)",
                      }}
                    />
                  )}
                </div>
                <div
                  className="absolute top-1/2 z-[2] h-5 w-5 -translate-y-1/2 rounded-full"
                  style={{
                    left: `clamp(2px, calc(${leveragePct}% - 10px), calc(100% - 22px))`,
                    background: isLong ? "var(--accent)" : "var(--danger)",
                    filter: `brightness(${dragging ? 1.3 : 1.1})`,
                    boxShadow: dragging
                      ? `0 0 12px color-mix(in srgb, ${isLong ? "var(--accent)" : "var(--danger)"} 60%, transparent)`
                      : "none",
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-xs font-bold text-zinc-500">
                <span>{LEVERAGE_MIN}x</span>
                <span>{maxLeverage}x</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-controls="trade-leverage-slider"
            aria-expanded={leverageOpen}
            onClick={() => { if (!dragRef.current) setLeverageOpen((o) => !o); }}
            className={cn(
              "flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-xs)] px-5 pb-3 pt-2",
              FOCUS_RING,
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-display font-semibold text-zinc-500">
                Leverage
              </span>
              <span className={`text-[13px] font-mono font-bold tabular-nums ${isLong ? "text-success" : "text-danger"}`}>
                {leverage.toFixed(1)}x
              </span>
            </div>
            <div className="h-[3px] w-8 rounded-full bg-zinc-600" />
          </button>
        </div>
      </div>

      {/* Order details — present at rest, not only after an amount is typed.
          Est. liquidation depends on price, side and leverage alone, so a
          leveraged-perp UI can and must show it before the user commits;
          amount-dependent rows read "—" until there is an amount. Leverage
          (already in the drawer above) and margin fold away on phones. */}
      {(() => {
        const amt = parseFloat(amount);
        const hasAmount = Number.isFinite(amt) && amt > 0;
        const hasPrice = currentPrice > 0;
        const orderValue = hasAmount ? amt * leverage : null;
        const orderBase = orderValue != null && hasPrice ? orderValue / currentPrice : null;
        const marginRequired = orderValue;
        const estLiqPrice = hasPrice
          ? getEstimatedLiquidationPrice(currentPrice, side, leverage)
          : null;
        const usd = (value: number) =>
          `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return (
          <dl className="mt-3 space-y-2.5 rounded-[var(--radius-sm)] border border-card-border bg-background-secondary p-4 font-mono text-[11px] tabular-nums">
            <div className="hidden justify-between sm:flex">
              <dt className="text-zinc-500">Leverage</dt>
              <dd className="font-semibold text-foreground">{leverage.toFixed(1)}x</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Order value</dt>
              <dd className="text-right text-foreground">
                {orderValue == null || orderBase == null
                  ? "—"
                  : `${orderBase.toFixed(4)} ${market.split("/")[0]} / ${orderValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Est. liquidation</dt>
              <dd className="text-foreground">
                {estLiqPrice == null ? "—" : usd(estLiqPrice)}
              </dd>
            </div>
            <div className="hidden justify-between sm:flex">
              <dt className="text-zinc-500">Margin required</dt>
              <dd className="text-foreground">
                {marginRequired == null ? "—" : usd(marginRequired)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Slippage</dt>
              <dd className="text-zinc-400">Est: 0.00% / Max: 8%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Fees</dt>
              <dd className="text-zinc-400">0.0340% / 0.0110%</dd>
            </div>
          </dl>
        );
      })()}

      {/* Submit button — when no wallet is connected this is the page's
          primary CTA, so it must be clickable and open the selector rather
          than sit disabled. */}
      <button
        type="button"
        onClick={
          !connected
            ? () => window.dispatchEvent(new CustomEvent("cash:open-wallet-selector"))
            : handleSubmit
        }
        disabled={connected && !canSubmitDecibel}
        className={cn(
          "mt-3 min-h-11 w-full rounded-[var(--radius-sm)] py-3.5 text-sm font-display font-semibold disabled:cursor-not-allowed sm:mt-4",
          PRESSABLE_CONTROL,
          FOCUS_RING,
          isOrderSuccess
            ? "bg-success text-white"
            : !connected
              ? "bg-accent text-black hover:brightness-110"
              : canSubmitDecibel
                ? isLong
                  ? "bg-success text-white hover:brightness-110"
                  : "bg-danger text-white hover:brightness-110"
                : "border border-card-border bg-white/[0.04] text-zinc-500"
        )}
      >
        {isOrderSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Signing...
          </span>
        ) : isOrderSuccess ? (
          <span className="flex items-center justify-center gap-2">
            <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />
            Order submitted
          </span>
        ) : (
          <>{submitLabel}</>
        )}
      </button>

      {statusMessage && (
        <div
          id="trade-status-message"
          aria-live={tradeStatus === "error" ? "assertive" : "polite"}
          role={tradeStatus === "error" ? "alert" : "status"}
          className={`mt-3 rounded-[var(--radius-xs)] px-3 py-2 text-[11px] ${
            tradeStatus === "error"
              ? "bg-danger/10 text-danger"
              : "bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p>{statusMessage}</p>
          {statusHash && (
            <a
              href={explorerTxUrl(statusHash)}
              target="_blank"
              rel="noreferrer"
              className={cn("mt-1 inline-block rounded-[var(--radius-xs)] text-accent underline", FOCUS_RING)}
            >
              View transaction
            </a>
          )}
        </div>
      )}
    </div>
  );
}
