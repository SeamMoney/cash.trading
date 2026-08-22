"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { IndicatorEntry } from "@/app/api/launchpad/indicators/route";
import Scrubber from "@/components/ui/scrubber";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { PRODUCT_CONTROL_CLASS } from "@/components/ui/product-surface";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

import type { ScheduledJob } from "@/lib/launchpad/types";
export type { ScheduledJob };

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  indicator: IndicatorEntry;
  isOpen: boolean;
  onClose: () => void;
  onScheduled: (job: ScheduledJob) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

// ─── ScheduleTradeModal ────────────────────────────────────────────────────────

export function ScheduleTradeModal({ indicator, isOpen, onClose, onScheduled }: Props) {
  const { connected, account } = useWallet();
  const { selectedSubaccount } = useDecibelSubaccounts();
  const [allocation, setAllocation] = useState(5); // % of balance
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mkt = indicator.assets[0] ?? "BTC/USD";
  const asset = mkt.split("/")[0];

  const handleAllocation = useCallback((v: number) => setAllocation(v), []);

  // Reset on open
  useEffect(() => {
    if (isOpen) { setError(null); setSuccess(false); setAllocation(5); }
  }, [isOpen]);

  async function deploy() {
    if (!connected || !account?.address) {
      setError("Connect your wallet first");
      return;
    }
    if (!selectedSubaccount) {
      setError("Select or create a Decibel subaccount before deploying this bot");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/launchpad/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerType: "signal",
          indicatorAddr: indicator.address,
          indicatorName: indicator.name,
          expectedSignal: 0, // follow all signals
          actionType: "record_signal",
          actionData: JSON.stringify({
            market: mkt,
            allocationPct: allocation,
            decibelSubaccount: selectedSubaccount,
          }),
          actionAmount: allocation / 100,
          gasDeposit: 0.05,
          owner: account.address.toString(),
          recurring: true,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuccess(true);
      setTimeout(() => {
        onScheduled(data.job as ScheduledJob);
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <ResponsiveModalSheet
      badge={mkt}
      desktopContentClassName="p-0"
      desktopMaxWidthClassName="sm:!max-w-lg"
      initialSnap="compact"
      onClose={onClose}
      open={isOpen}
      title="Deploy bot"
      description={`Follow ${indicator.name} signals on ${mkt}`}
      titleId="schedule-trade-title"
    >
      <div className="space-y-5 px-2 py-4 sm:px-5">

          {/* Indicator info */}
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent/12 bg-accent/10">
              <svg className="size-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white">{indicator.name}</div>
              <div className="text-[11px] text-zinc-500">{mkt}</div>
            </div>
          </div>

          {/* How it works — single sentence */}
          <div className={cn(PRODUCT_CONTROL_CLASS, "px-4 py-3")}>
            <p className="text-pretty text-[12px] leading-relaxed text-zinc-400">
              This bot follows <span className="text-white font-medium">{indicator.name}</span>'s signals automatically.
              When it signals <span className="text-emerald-400 font-medium">BUY</span>, the bot opens a long position.
              When it signals <span className="text-red-400 font-medium">SELL</span>, it closes.
            </p>
          </div>

          {/* Allocation scrubber */}
          <Scrubber
            label="Position size"
            value={allocation}
            onValueChange={handleAllocation}
            min={1}
            max={25}
            step={1}
            decimals={0}
            ticks={4}
            unit="%"
          />

          {/* Preview card */}
          <div className={cn(PRODUCT_CONTROL_CLASS, "p-3.5 text-[12px]")}>
            <div className="text-[10px] text-zinc-600 mb-2 font-medium">Preview</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-zinc-400">BUY signal</span>
                </div>
                <span className="text-zinc-300 font-mono">Open long {allocation}% {asset}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span className="text-zinc-400">SELL signal</span>
                </div>
                <span className="text-zinc-300 font-mono">Close position</span>
              </div>
            </div>
            <div className="flex justify-between mt-3 pt-2.5 border-t border-white/[0.04] font-mono text-[11px]">
              <span className="text-zinc-600">Gas reserve</span>
              <span className="text-zinc-400">0.05 APT</span>
            </div>
          </div>

          {/* Success */}
          {success && (
            <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/12 text-emerald-400 text-[12px] font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Bot deployed — it will trade automatically when signals fire.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/12 text-red-400 text-[11px]">
              {error}
            </div>
          )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-card-border bg-background-secondary px-2 py-4 sm:px-5">
          <button
            onClick={onClose}
            className={cn(PRODUCT_CONTROL_CLASS, "px-5 py-2.5 text-[12px] font-medium text-zinc-400 transition-colors hover:border-border-strong hover:text-white")}
          >
            Cancel
          </button>
          <button
            onClick={deploy}
            disabled={submitting || !connected}
            className={`ml-3 flex-1 rounded-[var(--radius-sm)] px-5 py-2.5 text-[13px] font-semibold transition-colors ${
              submitting
                ? "cursor-wait bg-accent/50 text-accent-foreground/50"
                : connected
                  ? "bg-accent text-accent-foreground hover:brightness-95"
                  : "border border-card-border bg-card text-zinc-500"
            }`}
          >
            {submitting ? "Deploying..." : connected ? "Deploy Bot" : "Connect Wallet"}
          </button>
      </div>
    </ResponsiveModalSheet>
  );
}
