"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Check, ChevronDown } from "lucide-react";
import { dispatchPortfolioActivity } from "@/lib/portfolio-events";
import { explorerTxUrl } from "@/lib/constants";
import { getEstimatedLiquidationPrice } from "@/lib/trade-utils";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";
import { PERP_MARKET_DATA } from "@/components/trade/perpMarketConfig";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import {
  COLLATERAL_TOKENS,
  type CollateralToken,
  TokenLogo,
} from "@/components/trade/StablecoinLogo";
// import { OrderBook } from "@/components/trade/OrderBook";

const LEVERAGE_MIN = 1.1;
const SLIDER_CONTENT_HEIGHT = 72;

function shortAddress(value?: string | null) {
  if (!value) return "—";
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

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
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const [side, setSide] = useState<"long" | "short">("long");
  const [amount, setAmount] = useState("");
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
  const submissionTokenRef = useRef<symbol | null>(null);
  const statusResetTokenRef = useRef<symbol | null>(null);
  const {
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    selectedSubaccount,
    subaccounts,
  } = useDecibelSubaccounts();
  const decibelMarketName =
    marketName ||
    (marketId && PERP_MARKET_DATA[marketId]?.marketName) ||
    market.replace(" PERPS", "").replace("/USDT", "/USD").replace("/USDC", "/USD");
  const tradeContext = `${account?.address?.toString() ?? ""}:${decibelNetwork}:${selectedSubaccount ?? ""}:${decibelMarketName}`;
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
  const accountState = !connected
    ? "Wallet disconnected"
    : isLoadingSubaccounts
      ? "Checking account"
      : lookupIncomplete
        ? "Needs refresh"
        : hasDecibelAccount
          ? "Ready"
          : "No Decibel account";
  const marketState = !supportedDecibelMarket
    ? "Unavailable"
    : marketStatus?.isOpen === false
      ? marketStatus.mode || "Closed"
      : "Open";

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setLeverageOpen(true);
    }
  }, []);

  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

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
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
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
      const result = await signAndSubmitTransaction({ data: json.payload });
      if (isCurrentSubmission()) {
        setStatusHash(result.hash);
        setOrderLifecycle("submitted");
        setStatusMessage("Order submitted. Waiting for on-chain confirmation...");
      }
      emitDecibelPositionsRefresh();
      await waitForTransactionConfirmation(result.hash);
      emitDecibelPositionsRefresh();
      if (!isCurrentSubmission()) return;
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
    signAndSubmitTransaction,
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
            onClick={() => {
              setSide("long");
              if (tradeStatus !== "submitting") setOrderLifecycle("idle");
            }}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              isLong ? "text-success" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {isLong ? "You are LONG" : "Long"}
          </button>
          <span className="text-zinc-700">/</span>
          <button
            onClick={() => {
              setSide("short");
              if (tradeStatus !== "submitting") setOrderLifecycle("idle");
            }}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              !isLong ? "text-danger" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {!isLong ? "You are SHORT" : "Short"}
          </button>
        </div>
        <span className="rounded-md bg-white/[0.03] px-2.5 py-1 text-[11px] font-mono text-zinc-500">
          0.045% Fee
        </span>
      </div>

      {/* Amount input card */}
      <div className="overflow-hidden rounded-[14px] bg-[#0e0e0e] sm:border sm:border-white/[0.06]">
        {/* Input row */}
        <div className="relative z-[1] flex items-center justify-between rounded-[14px] bg-[#141414] px-4 py-3 sm:px-5 sm:py-4">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
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
            className="bg-transparent font-mono font-bold text-white placeholder-zinc-600 outline-none w-full min-w-0 tracking-tight"
          />
          <div ref={collateralDropdownRef} className="relative shrink-0 ml-4">
            <button
              type="button"
              onClick={() => setCollateralOpen((open) => !open)}
              className="flex items-center gap-2 rounded-md bg-white/[0.05] px-3 py-2 transition-colors hover:bg-white/[0.08]"
            >
              <TokenLogo token={collateralToken} size={22} />
              <span className="text-[14px] font-display font-semibold text-white">
                {collateralToken}
              </span>
              <ChevronDown className={`h-3 w-3 text-zinc-500 transition-transform ${collateralOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>

            {collateralOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-30 flex w-[178px] flex-col gap-1 rounded-[10px] border border-white/[0.08] bg-[#181818] p-1 shadow-2xl shadow-black/40">
                {COLLATERAL_TOKENS.map((token) => {
                  const active = token.symbol === collateralToken;
                  return (
                    <button
                      key={token.symbol}
                      type="button"
                      onClick={() => {
                        setCollateralToken(token.symbol);
                        setCollateralOpen(false);
                        if (tradeStatus !== "idle") {
                          setTradeStatus("idle");
                          setOrderLifecycle("idle");
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors ${
                        active
                          ? "bg-white/[0.05] text-white"
                          : "text-[#888] hover:bg-white/[0.03] hover:text-white/80"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <TokenLogo token={token.symbol} size={20} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-display font-semibold leading-tight">
                            {token.symbol}
                          </span>
                          <span className="block text-[10px] text-[#555] leading-tight">
                            {token.name}
                          </span>
                        </span>
                      </span>
                      {active && (
                        <Check className="h-3 w-3 shrink-0 text-green-400" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Leverage mini drawer */}
        <div className="bg-[#0e0e0e]">
          <div
            className="overflow-hidden transition-[height] duration-150 ease-out"
            style={{ height: leverageOpen ? SLIDER_CONTENT_HEIGHT : 0 }}
          >
            <div
              className="px-5 pt-4 transition-transform duration-150 ease-out"
              style={{ transform: leverageOpen ? "translateY(0)" : "translateY(-12px)" }}
            >
              <div
                ref={trackRef}
                className="relative h-[24px] rounded-full bg-zinc-800 cursor-pointer touch-none overflow-hidden"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                {leveragePct > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `calc(${leveragePct}% + 12px)`,
                      background: isLong
                        ? "linear-gradient(90deg, #0DA726 0%, #4ade80 100%)"
                        : "linear-gradient(90deg, #b91c1c 0%, #F21A1A 100%)",
                    }}
                  />
                )}
                <div
                  className="absolute top-[2px] w-[20px] h-[20px] rounded-full z-[2]"
                  style={{
                    left: `clamp(2px, calc(${leveragePct}% - 10px), calc(100% - 22px))`,
                    background: isLong ? "#0DA726" : "#F21A1A",
                    filter: `brightness(${dragging ? 1.3 : 1.1})`,
                    boxShadow: dragging
                      ? `0 0 12px ${isLong ? "rgba(13,167,38,0.6)" : "rgba(242,26,26,0.6)"}`
                      : "none",
                  }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[12px] font-mono font-bold text-zinc-500">
                  {LEVERAGE_MIN}x
                </span>
                <span className="text-[12px] font-mono font-bold text-zinc-500">
                  {maxLeverage}x
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-expanded={leverageOpen}
            onClick={() => { if (!dragRef.current) setLeverageOpen((o) => !o); }}
            className="flex w-full flex-col items-center gap-1 px-5 pb-3 pt-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-display font-semibold uppercase tracking-[0.2em] text-zinc-500">
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

      {/* Order details — auto-shows when amount is entered */}
      {amount && parseFloat(amount) > 0 && currentPrice > 0 && (() => {
        const amt = parseFloat(amount);
        const orderValue = amt * leverage;
        const orderBtc = orderValue / currentPrice;
        const marginRequired = orderValue;
        const estLiqPrice = getEstimatedLiquidationPrice(currentPrice, side, leverage);
        return (
          <div className="mt-3 hidden rounded-[10px] bg-[#0e0e0e] p-4 text-[11px] font-mono tabular-nums animate-enter sm:block sm:border sm:border-white/[0.06]">
            <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">Leverage</span>
              <span className="text-white font-semibold">{leverage.toFixed(1)}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Order Value</span>
              <span className="text-white">{orderBtc.toFixed(4)} {market.split("/")[0]} / {orderValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Est. Liquidation</span>
              <span className="text-white">${estLiqPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Margin Required</span>
              <span className="text-white">${marginRequired.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Slippage</span>
              <span className="text-zinc-400">Est: 0.00% / Max: 8%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Fees</span>
              <span className="text-zinc-400">0.0340% / 0.0110%</span>
            </div>
            </div>
          </div>
        );
      })()}

      {/* Submit button — when no wallet is connected this is the page's
          primary CTA, so it must be clickable and open the selector rather
          than sit disabled. */}
      <button
        onClick={
          !connected
            ? () => window.dispatchEvent(new CustomEvent("cash:open-wallet-selector"))
            : handleSubmit
        }
        disabled={connected && !canSubmitDecibel}
        className={cn(
          "mt-3 w-full rounded-[10px] py-3.5 text-[14px] font-display font-bold uppercase tracking-wider transition-all disabled:cursor-not-allowed sm:mt-4",
          (canSubmitDecibel || !connected) && "active:scale-[0.98]",
          isOrderSuccess
            ? "bg-success text-white"
            : !connected
              ? "bg-accent text-black hover:brightness-110"
              : canSubmitDecibel
                ? isLong
                  ? "bg-success text-white hover:brightness-110"
                  : "bg-danger text-white hover:brightness-110"
                : "border border-white/[0.06] bg-white/[0.04] text-zinc-500"
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
            Order Submitted
          </span>
        ) : (
          <>{submitLabel}</>
        )}
      </button>

      {statusMessage && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-[11px] ${
            tradeStatus === "error"
              ? "bg-red-500/10 text-red-300"
              : "bg-white/[0.03] text-zinc-400"
          }`}
        >
          <p>{statusMessage}</p>
          {statusHash && (
            <a
              href={explorerTxUrl(statusHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-accent underline"
            >
              View transaction
            </a>
          )}
        </div>
      )}

      <div className="mt-auto hidden pt-4 xl:block">
        <div className="border-t border-white/[0.06] pt-4 font-mono text-[11px] tabular-nums">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-zinc-500">Execution</span>
            <span
              className={cn(
                "rounded-[6px] px-2 py-1 text-[10px]",
                canUseDecibel && marketAllowsOrders ? "bg-green-500/10 text-green-400" : "bg-white/[0.04] text-zinc-500",
              )}
            >
              {canUseDecibel && marketAllowsOrders ? "READY" : "WAITING"}
            </span>
          </div>
          <div className="space-y-2.5 text-zinc-500">
            <div className="flex justify-between gap-4">
              <span>Account</span>
              <span className="text-right text-zinc-300">{accountState}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Subaccount</span>
              <span className="text-right text-zinc-300">{shortAddress(selectedSubaccount)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Market</span>
              <span className="text-right text-zinc-300">{marketState}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Network</span>
              <span className="text-right text-zinc-300">{decibelNetwork}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Max lev.</span>
              <span className="text-right text-zinc-300">{maxLeverage}x</span>
            </div>
          </div>
        </div>
      </div>

      {/* OrderBook — hidden for now (Decibel depth API unavailable on mainnet) */}
    </div>
  );
}
