"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import type { IndicatorEntry } from "@/app/api/launchpad/indicators/route";
import Scrubber from "@/components/ui/scrubber";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";

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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

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
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#0f0f0f] rounded-t-[20px] sm:rounded-[16px] w-full sm:max-w-lg max-h-[92vh] overflow-hidden flex flex-col border border-white/[0.08]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[14px] font-semibold text-white">Deploy Bot</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg border border-white/[0.08] flex items-center justify-center text-zinc-500 text-[14px] hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Indicator info */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-white">{indicator.name}</div>
              <div className="text-[11px] text-zinc-500">{mkt}</div>
            </div>
          </div>

          {/* How it works — single sentence */}
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3">
            <p className="text-[12px] text-zinc-400 leading-relaxed">
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
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3.5 text-[12px]">
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
            <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[12px] font-medium flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Bot deployed — it will trade automatically when signals fire.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between px-5 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-[10px] border border-white/[0.08] text-zinc-400 text-[12px] font-medium hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={deploy}
            disabled={submitting || !connected}
            className={`flex-1 ml-3 px-5 py-2.5 rounded-[10px] text-[13px] font-semibold transition-colors ${
              submitting
                ? "bg-purple-500/50 text-white/50 cursor-wait"
                : connected
                  ? "bg-purple-500 text-white hover:bg-purple-400"
                  : "bg-white/[0.06] text-zinc-500 border border-white/[0.08]"
            }`}
          >
            {submitting ? "Deploying..." : connected ? "Deploy Bot" : "Connect Wallet"}
          </button>
        </div>
      </div>
    </div>
  );
}
