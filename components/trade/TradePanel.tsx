"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { dispatchPortfolioActivity } from "@/lib/portfolio-events";
import { explorerTxUrl } from "@/lib/constants";
import { getEstimatedLiquidationPrice } from "@/lib/trade-utils";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";
import { emitDecibelPositionsRefresh } from "@/lib/decibel-selection";
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
const SUPPORTED_DECIBEL_MARKETS = new Set([
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "APT/USD",
  "XRP/USD",
  "DOGE/USD",
  "HYPE/USD",
  "SUI/USD",
  "BNB/USD",
  "ZEC/USD",
]);

export function TradePanel({ market = "BTC/USDC", marketId, maxLeverage = 40, currentPrice = 0, onPositionOpen, chartHeight }: { market?: string; marketId?: string; maxLeverage?: number; currentPrice?: number; onPositionOpen?: (pos: { market: string; side: "long" | "short"; collateral: number; leverage: number }) => void; chartHeight?: number }) {
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
  const [statusMessage, setStatusMessage] = useState("");
  const [statusHash, setStatusHash] = useState("");
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const collateralDropdownRef = useRef<HTMLDivElement>(null);
  const {
    hasDecibelAccount,
    isLoadingSubaccounts,
    lookupIncomplete,
    selectedSubaccount,
    subaccounts,
  } = useDecibelSubaccounts();
  const decibelMarketName =
    (marketId && PERP_MARKET_DATA[marketId]?.marketName) ||
    market.replace(" PERPS", "").replace("/USDT", "/USD").replace("/USDC", "/USD");
  const inputAmount = Number(amount);
  const hasTradeAmount = Number.isFinite(inputAmount) && inputAmount > 0;
  const supportedDecibelMarket = SUPPORTED_DECIBEL_MARKETS.has(decibelMarketName);
  const usesDecibelCollateral = collateralToken === "USDC";
  const canUseDecibel = Boolean(
    connected && account && hasDecibelAccount && supportedDecibelMarket && usesDecibelCollateral
  );
  const canSubmitDecibel = Boolean(canUseDecibel && hasTradeAmount && currentPrice > 0 && tradeStatus !== "submitting");
  const isOrderSubmitting = tradeStatus === "submitting" && tradeAction === "order";
  const isOrderSuccess = tradeStatus === "success" && tradeAction === "order";

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
    if (tradeStatus === "submitting") return;
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
    if (!SUPPORTED_DECIBEL_MARKETS.has(decibelMarketName)) {
      setStatusMessage(`${decibelMarketName} is not enabled in this Decibel deployment yet.`);
      setTradeStatus("error");
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
    inputRef.current?.blur();
    setTradeAction("order");
    setTradeStatus("submitting");
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
          price: currentPrice,
          size,
          isBuy: side === "long",
          orderType: "market",
          subaccount: selectedSubaccount,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Order builder failed");

      setStatusMessage("Sign Decibel order in your wallet...");
      const result = await signAndSubmitTransaction({ data: json.payload });
      setStatusHash(result.hash);
      setStatusMessage("Order submitted. Waiting for on-chain confirmation...");
      await waitForTransactionConfirmation(result.hash);
      emitDecibelPositionsRefresh();
      setStatusMessage("Order confirmed. Checking Decibel position state...");

      const positionsRes = await fetch(
        `/api/decibel/positions?address=${selectedSubaccount}`
      );
      const positionsJson = await positionsRes.json().catch(() => ({}));
      const hasMatchingPosition = Array.isArray(positionsJson.positions)
        ? positionsJson.positions.some(
            (position: { market?: string }) =>
              position.market === decibelMarketName || position.market === market
          )
        : false;

      setTradeStatus("success");
      setStatusMessage(
        hasMatchingPosition
          ? "Decibel order confirmed and position detected."
          : "Decibel order confirmed. Refresh positions to verify fill."
      );
      dispatchPortfolioActivity({
        type: side === "long" ? "Long" : "Short",
        amount: collateral,
        market,
      });
      if (hasMatchingPosition) {
        onPositionOpen?.({ market, side, collateral, leverage });
      }
      emitDecibelPositionsRefresh();
      setAmount("");
      setTimeout(() => {
        setTradeStatus("idle");
        setTradeAction("idle");
      }, 2500);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Order failed");
      setTradeStatus("error");
    }
  }, [
    account,
    amount,
    collateralToken,
    connected,
    currentPrice,
    decibelMarketName,
    leverage,
    isLoadingSubaccounts,
    lookupIncomplete,
    market,
    onPositionOpen,
    selectedSubaccount,
    side,
    signAndSubmitTransaction,
    subaccounts,
    tradeStatus,
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
      : !hasTradeAmount
        ? "Enter amount"
      : isLong
        ? `Long ${market}`
        : `Short ${market}`;

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSide("long")}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              isLong ? "text-success" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {isLong ? "You are LONGING" : "Long"}
          </button>
          <span className="text-zinc-700">/</span>
          <button
            onClick={() => setSide("short")}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              !isLong ? "text-danger" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {!isLong ? "You are SHORTING" : "Short"}
          </button>
        </div>
        <span className="text-[12px] font-mono text-zinc-500 px-3 py-1.5 rounded-[10px] border border-white/8 bg-white/[0.03]">
          0.045% Fee
        </span>
      </div>

      {/* Amount input card */}
      <div className="rounded-[16px] bg-[#0e0e0e] border border-white/[0.06]">
        {/* Input row */}
        <div className="flex items-center justify-between px-5 py-4 rounded-[16px] bg-[#141414] relative z-[1]">
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              if (v.split(".").length <= 2) setAmount(v);
              if (tradeStatus !== "idle") setTradeStatus("idle");
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
              className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
            >
              <TokenLogo token={collateralToken} size={22} />
              <span className="text-[14px] font-display font-semibold text-white">
                {collateralToken}
              </span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-zinc-500 transition-transform ${collateralOpen ? "rotate-180" : ""}`}>
                <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {collateralOpen && (
              <div className="absolute right-0 top-[calc(100%+8px)] z-30 flex w-[178px] flex-col gap-1 rounded-[12px] border border-white/[0.08] bg-[#181818] p-1 shadow-2xl shadow-black/40">
                {COLLATERAL_TOKENS.map((token) => {
                  const active = token.symbol === collateralToken;
                  return (
                    <button
                      key={token.symbol}
                      type="button"
                      onClick={() => {
                        setCollateralToken(token.symbol);
                        setCollateralOpen(false);
                        if (tradeStatus !== "idle") setTradeStatus("idle");
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
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="shrink-0 text-green-400">
                          <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Leverage mini bottom sheet */}
        <div className="bg-[#0e0e0e]">
          {/* Tappable handle area */}
          <button
            type="button"
            onClick={() => { if (!dragRef.current) setLeverageOpen((o) => !o); }}
            className="w-full py-2 flex flex-col items-center gap-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-display font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Leverage
              </span>
              <span className={`text-[13px] font-mono font-bold tabular-nums ${isLong ? "text-success" : "text-danger"}`}>
                {leverage.toFixed(1)}x
              </span>
            </div>
            <div className="w-8 h-[3px] rounded-full bg-zinc-600" />
          </button>

          {/* Collapsible slider */}
          <div
            className="overflow-hidden transition-[height] duration-300 ease-out"
            style={{ height: leverageOpen ? SLIDER_CONTENT_HEIGHT : 0 }}
          >
            <div className="px-5 pb-4">
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
                  {LEVERAGE_MIN}X
                </span>
                <span className="text-[12px] font-mono font-bold text-zinc-500">
                  {maxLeverage}X
                </span>
              </div>
            </div>
          </div>
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
          <div className="mt-3 rounded-[12px] bg-[#0e0e0e] border border-white/[0.06] p-4 space-y-2.5 text-[11px] font-mono tabular-nums animate-enter">
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
        );
      })()}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmitDecibel}
        className={cn(
          "mt-4 w-full rounded-[12px] py-3.5 text-[14px] font-display font-bold uppercase tracking-wider transition-all disabled:cursor-not-allowed",
          canSubmitDecibel && "active:scale-[0.98]",
          isOrderSuccess
            ? "bg-success text-white"
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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Order Submitted
          </span>
        ) : (
          <>{submitLabel}</>
        )}
      </button>

      {statusMessage && (
        <div
          className={`mt-3 rounded-[10px] border px-3 py-2 text-[11px] ${
            tradeStatus === "error"
              ? "border-red-500/25 bg-red-500/10 text-red-300"
              : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
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

      {/* OrderBook — hidden for now (Decibel depth API unavailable on mainnet) */}
    </div>
  );
}
