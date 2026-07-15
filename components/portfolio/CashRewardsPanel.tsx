"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, ExternalLink, ShieldCheck } from "lucide-react";
import { NumberTicker } from "@/components/ui/number-ticker";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/constants";
import type { DecibelPublicNetwork } from "@/lib/decibel-public";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { cn } from "@/lib/utils";

type RewardSnapshot = {
  generatedAt: string;
  epochEndsAt: string;
  verified: {
    fills: number;
    activeDays: number;
    feeUsd: number;
    actualVolumeUsd: number;
    capitalDollarHours: number;
    truncated: boolean;
  };
  components: {
    feesCash: number;
    capitalHoursCash: number;
    activeDaysCash: number;
  };
  totals: {
    earnedCash: number;
    claimedCash: number;
    claimableCash: number;
    walletBalanceCash: number;
  };
  stream: {
    estimatedCashPerSecond: number;
    remainingWalletCapCash: number;
  };
  config: {
    enabled: boolean;
    disabledReason?: string;
    walletEpochCapCash: number;
    globalEpochCapCash: number;
  };
  contract: {
    status: string;
    statusLabel: string;
    managerAddress: string;
    vaultBalanceCash: number;
    epochEmittedCash: number;
  };
  voucher: null | {
    epoch: string;
    cumulativeAmountAtomic: string;
    expiresAtSeconds: string;
    signature: number[];
    function: string;
    typeArguments: string[];
  };
};

type ClaimStatus = {
  tone: "pending" | "success" | "error";
  message: string;
  hash?: string;
};

type Props = {
  connected: boolean;
  network: DecibelPublicNetwork;
  owner: string;
  subaccount: string;
};

function compactCash(value: number) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 100 ? 2 : 0,
  });
}

function shortAddress(value: string) {
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function statusTone(status: string) {
  if (status === "live") return "bg-green-500/10 text-green-400";
  if (status === "issuer_mismatch") return "bg-red-500/10 text-red-300";
  return "bg-yellow-500/10 text-yellow-300";
}

export function CashRewardsPanel({ connected, network, owner, subaccount }: Props) {
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const [snapshot, setSnapshot] = useState<RewardSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const requestRef = useRef<AbortController | null>(null);
  const claimTokenRef = useRef<symbol | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    requestRef.current?.abort();
    if (!connected || !owner || !subaccount) {
      setSnapshot(null);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ owner, subaccount, network });
      const response = await fetch(`/api/cash/rewards?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as
        | (RewardSnapshot & { error?: string })
        | null;
      if (!response.ok || !data) {
        throw new Error(data?.error || `CASH reward lookup failed (${response.status}).`);
      }
      setSnapshot(data);
      setClock(Date.now());
      setError("");
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "CASH rewards are temporarily unavailable.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [connected, network, owner, subaccount]);

  useEffect(() => {
    refresh().catch(() => undefined);
    const interval = window.setInterval(() => refresh(true).catch(() => undefined), 15_000);
    return () => {
      window.clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!snapshot || snapshot.stream.estimatedCashPerSecond <= 0) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [snapshot]);

  useEffect(() => {
    claimTokenRef.current = null;
    setClaiming(false);
    setClaimStatus(null);
  }, [network, owner, subaccount]);

  const estimatedEarned = useMemo(() => {
    if (!snapshot) return null;
    const elapsedSeconds = Math.max(
      0,
      (clock - new Date(snapshot.generatedAt).getTime()) / 1_000,
    );
    const streamed = Math.min(
      snapshot.stream.remainingWalletCapCash,
      elapsedSeconds * snapshot.stream.estimatedCashPerSecond,
    );
    return snapshot.totals.earnedCash + streamed;
  }, [clock, snapshot]);

  const claim = useCallback(async () => {
    if (!snapshot?.voucher || claiming) return;
    const token = Symbol("cash-claim");
    claimTokenRef.current = token;
    setClaiming(true);
    setClaimStatus({ tone: "pending", message: "Confirm the CASH claim in your wallet..." });
    try {
      const voucher = snapshot.voucher;
      const submitted = await signAndSubmitDecibelTransaction({
        data: {
          function: voucher.function as `${string}::${string}::${string}`,
          typeArguments: voucher.typeArguments,
          functionArguments: [
            voucher.epoch,
            voucher.cumulativeAmountAtomic,
            voucher.expiresAtSeconds,
            voucher.signature,
          ],
        },
      });
      setClaimStatus({
        tone: "pending",
        message: "Claim submitted. Waiting for Aptos confirmation...",
        hash: submitted.hash,
      });
      await waitForTransactionConfirmation(submitted.hash);
      if (claimTokenRef.current !== token) return;
      setClaimStatus({
        tone: "success",
        message: `${compactCash(snapshot.totals.claimableCash)} CASH claimed to your Decibel owner account.`,
        hash: submitted.hash,
      });
      await refresh(true);
    } catch (reason) {
      if (claimTokenRef.current !== token) return;
      setClaimStatus({
        tone: "error",
        message: reason instanceof Error ? reason.message : "The CASH claim failed.",
      });
    } finally {
      if (claimTokenRef.current === token) {
        claimTokenRef.current = null;
        setClaiming(false);
      }
    }
  }, [claiming, refresh, signAndSubmitDecibelTransaction, snapshot]);

  const progress = snapshot
    ? Math.min(100, (snapshot.totals.earnedCash / snapshot.config.walletEpochCapCash) * 100)
    : 0;
  const claimLabel = claiming
    ? "Claiming..."
    : snapshot?.voucher
      ? `Claim ${compactCash(snapshot.totals.claimableCash)} CASH`
      : snapshot?.contract.status === "live"
        ? "Nothing new to claim"
        : "Claims unlock after canary funding";

  return (
    <section className="mt-8 overflow-hidden rounded-[4px] border border-[#1a1a1a] bg-[#050505]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1a1a1a] px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-[4px] bg-green-500/10 text-green-400">
            <Coins className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-200">CASH rewards</h2>
            <p className="mt-1 max-w-2xl text-pretty text-[12px] leading-5 text-zinc-500">
              Earn from verified fees and capital kept in Decibel positions. Rewards use actual activity, not inflated leverage notional.
            </p>
          </div>
        </div>
        {snapshot && (
          <span className={cn("rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide", statusTone(snapshot.contract.status))}>
            {snapshot.contract.statusLabel}
          </span>
        )}
      </div>

      {!connected || !subaccount ? (
        <div className="px-6 py-8 text-[13px] text-zinc-500">
          Connect a wallet with a Decibel trading account to preview verified CASH earnings.
        </div>
      ) : (
        <>
          <div className="grid gap-px bg-[#1a1a1a] sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[#050505] px-5 py-5 sm:px-6">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">Estimated this week</p>
              <NumberTicker
                value={estimatedEarned}
                fallback={loading ? "Loading..." : "—"}
                format={{ maximumFractionDigits: 0 }}
                suffix=" CASH"
                className="mt-2 block font-mono text-[24px] font-semibold text-green-400"
              />
              <p className="mt-2 text-[11px] text-zinc-600">Live estimate; server re-verifies every fill</p>
            </div>
            <div className="bg-[#050505] px-5 py-5 sm:px-6">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">
                {snapshot?.contract.status === "live" ? "Claimable" : "Verified accrued"}
              </p>
              <NumberTicker
                value={snapshot?.totals.claimableCash}
                fallback="—"
                format={{ maximumFractionDigits: 0 }}
                suffix=" CASH"
                className="mt-2 block font-mono text-[24px] font-semibold text-zinc-200"
              />
              <p className="mt-2 text-[11px] text-zinc-600">
                {snapshot?.contract.status === "live"
                  ? "Owner-bound, expiring voucher"
                  : "Unlocks after the distributor launches"}
              </p>
            </div>
            <div className="bg-[#050505] px-5 py-5 sm:px-6">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">Claimed this week</p>
              <NumberTicker
                value={snapshot?.totals.claimedCash}
                fallback="—"
                format={{ maximumFractionDigits: 0 }}
                suffix=" CASH"
                className="mt-2 block font-mono text-[24px] font-semibold text-zinc-200"
              />
              <p className="mt-2 text-[11px] text-zinc-600">Cumulative on-chain record</p>
            </div>
            <div className="bg-[#050505] px-5 py-5 sm:px-6">
              <p className="text-[11px] uppercase tracking-wide text-zinc-600">Wallet CASH</p>
              <NumberTicker
                value={snapshot?.totals.walletBalanceCash}
                fallback="—"
                format={{ maximumFractionDigits: 0 }}
                suffix=" CASH"
                className="mt-2 block font-mono text-[24px] font-semibold text-zinc-200"
              />
              <p className="mt-2 text-[11px] text-zinc-600">Decibel owner account balance</p>
            </div>
          </div>

          <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <div className="flex items-center justify-between gap-4 text-[11px]">
                <span className="text-zinc-500">Weekly wallet ceiling</span>
                <span className="font-mono tabular-nums text-zinc-400">
                  {snapshot ? `${compactCash(snapshot.totals.earnedCash)} / ${compactCash(snapshot.config.walletEpochCapCash)} CASH` : "—"}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Weekly CASH reward progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900"
              >
                <div className="h-full rounded-full bg-green-500" style={{ width: `${progress}%` }} />
              </div>

              <dl className="mt-5 grid gap-3 text-[12px] sm:grid-cols-3">
                <div>
                  <dt className="text-zinc-600">Verified fills</dt>
                  <dd className="mt-1 font-mono tabular-nums text-zinc-300">{snapshot?.verified.fills ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">Fee rewards</dt>
                  <dd className="mt-1 font-mono tabular-nums text-zinc-300">{snapshot ? `${compactCash(snapshot.components.feesCash)} CASH` : "—"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600">Capital-time rewards</dt>
                  <dd className="mt-1 font-mono tabular-nums text-zinc-300">{snapshot ? `${compactCash(snapshot.components.capitalHoursCash)} CASH` : "—"}</dd>
                </div>
              </dl>
              {snapshot?.verified.truncated && (
                <p className="mt-3 text-[11px] text-yellow-300">
                  This account exceeded the 1,000-fill preview window. The displayed estimate is conservative.
                </p>
              )}
            </div>

            <div className="rounded-[4px] border border-[#1a1a1a] bg-[#0a0a0a] p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
                <ShieldCheck className="size-3.5 text-green-400" aria-hidden="true" />
                On-chain guardrails
              </div>
              <div className="mt-3 space-y-2 text-[11px] text-zinc-500">
                <div className="flex justify-between gap-4">
                  <span>Epoch emission cap</span>
                  <span className="font-mono tabular-nums text-zinc-300">{snapshot ? `${compactCash(snapshot.config.globalEpochCapCash)} CASH` : "—"}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Vault balance</span>
                  <span className="font-mono tabular-nums text-zinc-300">{snapshot ? `${compactCash(snapshot.contract.vaultBalanceCash)} CASH` : "—"}</span>
                </div>
                {snapshot && (
                  <a
                    href={explorerAccountUrl(snapshot.contract.managerAddress, network)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-4 text-zinc-500 hover:text-zinc-300"
                  >
                    <span>Isolated manager</span>
                    <span className="flex items-center gap-1 font-mono">
                      {shortAddress(snapshot.contract.managerAddress)}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </span>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={claim}
                disabled={!snapshot?.voucher || claiming}
                className="mt-4 w-full rounded-[4px] bg-green-500 px-4 py-2.5 text-[12px] font-semibold text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-600"
              >
                {claimLabel}
              </button>
            </div>
          </div>
        </>
      )}

      {(error || claimStatus) && (
        <div
          role={error || claimStatus?.tone === "error" ? "alert" : "status"}
          className={cn(
            "border-t border-[#1a1a1a] px-5 py-3 text-[12px] sm:px-6",
            error || claimStatus?.tone === "error"
              ? "text-red-300"
              : claimStatus?.tone === "success"
                ? "text-green-300"
                : "text-zinc-400",
          )}
        >
          {error || claimStatus?.message}
          {claimStatus?.hash && (
            <a
              href={explorerTxUrl(claimStatus.hash, network)}
              target="_blank"
              rel="noreferrer"
              className="ml-2 inline-flex items-center gap-1 underline underline-offset-4 hover:text-zinc-200"
            >
              View transaction <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}
