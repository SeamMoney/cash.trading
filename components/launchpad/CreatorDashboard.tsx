"use client";

import { useEffect, useState } from "react";

interface CreatorIndicator {
  address: string;
  name: string;
  symbol: string;
  assets: string[];
  createdAt: number;
  isProprietary?: boolean;
  algoHash?: string;
  creatorFeeBps?: number;
  creatorFeeModel?: "none" | "flat" | "profit_share";
  creatorEarningsUsdt?: number;
}

interface Props {
  creatorAddr?: string;
}

function shortAddress(address: string) {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

function feeLabel(indicator: CreatorIndicator) {
  const bps = indicator.creatorFeeBps ?? 0;
  if (indicator.creatorFeeModel === "profit_share") {
    return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}% profit share`;
  }
  if (indicator.creatorFeeModel === "flat") {
    return `${(bps / 100).toFixed(2).replace(/\.00$/, "")}% flat fee`;
  }
  return "No creator fee";
}

export function CreatorDashboard({ creatorAddr }: Props) {
  const [indicators, setIndicators] = useState<CreatorIndicator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!creatorAddr) {
      setIndicators([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/launchpad/indicators?creator=${encodeURIComponent(creatorAddr)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Creator data is temporarily unavailable");
        const data = await response.json() as { indicators?: CreatorIndicator[] };
        setIndicators(Array.isArray(data.indicators) ? data.indicators : []);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Creator data is temporarily unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [creatorAddr]);

  if (!creatorAddr) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0f0f0f] p-10 text-center">
        <div className="w-10 h-10 rounded-xl bg-[#39ff14]/10 flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-[#39ff14]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <p className="text-sm text-zinc-300 font-medium mb-1">Connect wallet to view creator earnings</p>
        <p className="text-xs text-zinc-600">Your Aptos testnet indicators will appear here</p>
      </div>
    );
  }

  const pendingEarnings = indicators.reduce(
    (total, indicator) => total + Math.max(0, indicator.creatorEarningsUsdt ?? 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-0.5">
            Creator Dashboard
          </div>
          <p className="text-[11px] text-zinc-500 font-mono">{shortAddress(creatorAddr)}</p>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-0.5">On-chain earnings</div>
          <div className="text-[22px] font-bold font-mono text-emerald-400 tabular-nums leading-none">
            ${pendingEarnings.toFixed(2)}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 mt-0.5">USDT · Aptos testnet</div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-[#0f0f0f] overflow-hidden">
        <div className="px-5 py-3 border-b border-white/[0.04] flex items-center justify-between gap-3">
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Your indicators</span>
          {!loading && !error && (
            <span className="text-[9px] font-mono text-zinc-600">{indicators.length} on-chain</span>
          )}
        </div>

        {loading ? (
          <div className="p-5 space-y-3" aria-live="polite">
            <div className="h-14 rounded-lg bg-white/[0.03] animate-pulse" />
            <div className="h-14 rounded-lg bg-white/[0.03] animate-pulse" />
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-xs text-red-300">{error}</p>
            <p className="text-[10px] text-zinc-600 mt-1">No estimated or demo balances are shown.</p>
          </div>
        ) : indicators.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-zinc-300 font-medium mb-1">No indicators found for this wallet</p>
            <p className="text-xs text-zinc-600">Deploy a strategy and confirm it on Aptos testnet to see it here.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {indicators.map((indicator) => {
              const earnings = Math.max(0, indicator.creatorEarningsUsdt ?? 0);
              return (
                <div key={indicator.address} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-bold text-white font-mono">{indicator.symbol}</span>
                      {indicator.isProprietary && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold font-mono bg-amber-500/10 text-amber-400 border border-amber-500/25 uppercase tracking-wide">
                          Proprietary
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate">{indicator.name}</p>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[9px] font-mono text-zinc-600">
                      <span>{indicator.assets?.[0] ?? "Asset unavailable"}</span>
                      <span>·</span>
                      <span>{feeLabel(indicator)}</span>
                      <span>·</span>
                      <span title={indicator.address}>{shortAddress(indicator.address)}</span>
                      {indicator.createdAt > 0 && (
                        <>
                          <span>·</span>
                          <span>{new Date(indicator.createdAt).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-bold font-mono text-emerald-400 tabular-nums">${earnings.toFixed(2)}</div>
                    <div className="text-[9px] font-mono text-zinc-600">on-chain</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="px-5 py-3 border-t border-white/[0.04] bg-white/[0.01]">
          <p className="text-[9px] font-mono text-zinc-600 leading-relaxed">
            Payout claiming is not enabled yet. Earnings are read from the launchpad contract and remain on-chain.
          </p>
        </div>
      </div>
    </div>
  );
}
