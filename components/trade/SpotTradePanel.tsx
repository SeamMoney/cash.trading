"use client";

import { useState, useRef, useCallback } from "react";
import { dispatchPortfolioActivity } from "@/lib/portfolio-events";

function UsdtLogo({ size = 24 }: { size?: number }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/tokens/usdt.png"
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-contain"
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    />
  );
}

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0] as const;

/**
 * Estimate price impact based on order size.
 * Uses a simple square-root model: impact grows with sqrt of (amount / liquidity).
 * In production this would come from the DEX aggregator quote.
 */
function estimatePriceImpact(amountUsd: number): number {
  // Simulated pool depth per asset — larger pools = less impact
  const POOL_DEPTH = 2_000_000; // $2M notional depth
  if (amountUsd <= 0) return 0;
  // sqrt model: impact% = k * sqrt(amount / depth)
  const k = 0.3;
  return k * Math.sqrt(amountUsd / POOL_DEPTH);
}

function priceImpactSeverity(impact: number): "low" | "medium" | "high" {
  if (impact < 0.1) return "low";
  if (impact < 1.0) return "medium";
  return "high";
}

const IMPACT_COLORS = {
  low: "text-zinc-400",
  medium: "text-yellow-400",
  high: "text-red-400",
} as const;

export function SpotTradePanel({
  market = "BTC/USDT",
  currentPrice = 0,
  onTrade,
}: {
  market?: string;
  currentPrice?: number;
  onTrade?: (trade: { market: string; side: "buy" | "sell"; amount: number }) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [customSlippage, setCustomSlippage] = useState("");
  const [tradeStatus, setTradeStatus] = useState<"idle" | "submitting" | "success">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  const isBuy = side === "buy";
  const asset = market.split("/")[0];

  const handleSubmit = useCallback(() => {
    if (!amount || parseFloat(amount) <= 0 || tradeStatus === "submitting") return;
    inputRef.current?.blur();
    setTradeStatus("submitting");

    setTimeout(() => {
      setTradeStatus("success");
      const amt = parseFloat(amount);
      dispatchPortfolioActivity({
        type: isBuy ? "Buy" : "Sell",
        amount: isBuy ? amt : -amt,
        market,
      });
      onTrade?.({ market, side, amount: amt });
      setAmount("");
      setTimeout(() => setTradeStatus("idle"), 2500);
    }, 800);
  }, [amount, side, tradeStatus, market, isBuy, onTrade]);

  return (
    <div>
      {/* Header row — Buy / Sell */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSide("buy")}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              isBuy ? "text-success" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            Buy
          </button>
          <span className="text-zinc-700">/</span>
          <button
            onClick={() => setSide("sell")}
            className={`text-[14px] font-display font-black uppercase tracking-wider transition-colors ${
              !isBuy ? "text-danger" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            Sell
          </button>
        </div>
        <span className="text-[12px] font-mono text-zinc-500 px-3 py-1.5 rounded-[10px] border border-white/8 bg-white/[0.03]">
          Spot
        </span>
      </div>

      {/* Amount input card */}
      <div className="rounded-[16px] bg-[#0e0e0e] border border-white/[0.06] overflow-hidden">
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
          <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-white/[0.05] border border-white/[0.08] shrink-0 ml-4">
            <UsdtLogo size={22} />
            <span className="text-[14px] font-display font-semibold text-white">
              USDT
            </span>
          </div>
        </div>

        {/* Slippage tolerance — collapsible row */}
        <div className="bg-[#0e0e0e]">
          <button
            type="button"
            onClick={() => setSlippageOpen((o) => !o)}
            className="w-full py-2 flex flex-col items-center gap-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-display font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Slippage Tolerance
              </span>
              <span className="text-[13px] font-mono font-bold tabular-nums text-white">
                {slippage}%
              </span>
            </div>
            <div className="w-8 h-[3px] rounded-full bg-zinc-600" />
          </button>

          <div
            className="overflow-hidden transition-[height] duration-300 ease-out"
            style={{ height: slippageOpen ? 48 : 0 }}
          >
            <div className="px-5 pb-3 flex items-center gap-1.5">
              {SLIPPAGE_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => { setSlippage(pct); setCustomSlippage(""); }}
                  className={`flex-1 py-1.5 rounded-[8px] text-[12px] font-mono font-bold transition-colors ${
                    slippage === pct && !customSlippage
                      ? "bg-white/[0.1] text-white border border-white/[0.12]"
                      : "bg-white/[0.03] text-zinc-500 border border-white/[0.06] hover:text-zinc-300"
                  }`}
                >
                  {pct}%
                </button>
              ))}
              <div className="relative flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Custom"
                  value={customSlippage}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    if (v.split(".").length > 2) return;
                    setCustomSlippage(v);
                    const n = parseFloat(v);
                    if (n > 0 && n <= 50) setSlippage(n);
                  }}
                  className="w-full py-1.5 px-2 rounded-[8px] text-[12px] font-mono font-bold bg-white/[0.03] border border-white/[0.06] text-white placeholder-zinc-600 outline-none text-center focus:border-white/[0.15] transition-colors"
                />
                {customSlippage && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-mono text-zinc-500 pointer-events-none">%</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Order details — auto-shows when amount is entered */}
      {amount && parseFloat(amount) > 0 && currentPrice > 0 && (() => {
        const amt = parseFloat(amount);
        const impact = estimatePriceImpact(amt);
        const severity = priceImpactSeverity(impact);
        const effectivePrice = isBuy
          ? currentPrice * (1 + impact / 100)
          : currentPrice * (1 - impact / 100);
        const qty = amt / effectivePrice;
        const fee = amt * 0.001;
        const minReceived = isBuy
          ? qty * (1 - slippage / 100)
          : amt * (1 - slippage / 100);
        return (
          <div className="mt-3 rounded-[12px] bg-[#0e0e0e] border border-white/[0.06] p-4 space-y-2.5 text-[11px] font-mono tabular-nums animate-enter">
            <div className="flex justify-between">
              <span className="text-zinc-500">Price</span>
              <span className="text-white font-semibold">
                ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">{isBuy ? "You Receive" : "You Sell"}</span>
              <span className="text-white">
                {qty.toFixed(6)} {asset}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Price Impact</span>
              <span className={IMPACT_COLORS[severity]}>
                {impact < 0.01 ? "<0.01%" : `~${impact.toFixed(2)}%`}
                {severity === "high" && (
                  <span className="ml-1 text-[9px] uppercase tracking-wider">Warning</span>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Slippage Tolerance</span>
              <span className="text-zinc-400">{slippage}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">{isBuy ? "Min. Received" : "Min. Proceeds"}</span>
              <span className="text-zinc-400">
                {isBuy
                  ? `${minReceived.toFixed(6)} ${asset}`
                  : `$${minReceived.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Fee (0.10%)</span>
              <span className="text-zinc-400">${fee.toFixed(2)}</span>
            </div>
          </div>
        );
      })()}

      {/* High price impact warning */}
      {amount && parseFloat(amount) > 0 && priceImpactSeverity(estimatePriceImpact(parseFloat(amount))) === "high" && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-[10px] bg-red-500/10 border border-red-500/20 text-[11px] font-mono text-red-400 animate-enter">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Price impact is high. Consider reducing order size.
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={tradeStatus === "submitting" || (!amount && tradeStatus === "idle")}
        className={`w-full mt-4 py-3.5 rounded-[12px] text-[14px] font-display font-bold uppercase tracking-wider text-white transition-all active:scale-[0.98] disabled:opacity-50 ${
          tradeStatus === "success"
            ? "bg-success"
            : isBuy
            ? "bg-success hover:brightness-110"
            : "bg-danger hover:brightness-110"
        }`}
      >
        {tradeStatus === "submitting" ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Placing...
          </span>
        ) : tradeStatus === "success" ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Order Placed
          </span>
        ) : (
          <>{isBuy ? "Buy" : "Sell"} {asset}</>
        )}
      </button>
    </div>
  );
}
