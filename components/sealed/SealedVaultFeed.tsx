"use client";

/**
 * Sealed-vault feed (trader side).
 *
 * The pitch a depositor reads here is deliberately narrow and true: you cannot
 * see the strategy, but you can verify what it is structurally unable to do.
 * Every guarantee shown is one the Move module enforces per trade.
 *
 * The list is fetched by `useSealedVaults` so the page that hosts it can show honest counts in
 * its header from the same request, rather than a second fetch that can disagree.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown } from "lucide-react";
import { SealedTraceChart, type TraceFill } from "@/components/sealed/SealedTraceChart";

import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/components/ui/interactions";
import { DataTable } from "@/components/ui/agent";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { buildDepositDecibelVaultPayload } from "@/lib/decibel-vaults";

export interface SealedVault {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  creatorAddr: string;
  decibelVaultAddr: string;
  marketName: string | null;
  programCommitment: string;
  attestorPubkey: string;
  name: string;
  description: string | null;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  sealedAt: string | null;
  paused: boolean;
  revealed: boolean;
  attestationTier: "bare" | "tee";
}

interface Detail {
  onChain: {
    inPosition: boolean;
    isLong: boolean;
    trades: number;
    seq: number;
    inputDigest: string;
    sealed: boolean;
    paused: boolean;
  } | null;
  registryMatchesChain: boolean | null;
  mismatches: string[];
  chainError: string | null;
}

interface PerfSummary {
  bars: number;
  trades: number;
  closedTrades: number;
  winRatePct: number | null;
  cumulativeReturnPct: number | null;
  maxDrawdownPct: number | null;
  tradeSource: "recorded" | "unavailable";
  note: string;
  /** Committed price series, 1e8-scaled, oldest first. */
  trace?: number[];
  traceTimestamps?: number[];
  /** Individual fills, for marking on the trace. */
  fills?: TraceFill[];
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function vaultIsLive(v: SealedVault): boolean {
  return Boolean(v.sealedAt) && !v.paused;
}

/** The registry's list for the configured network. One request, shared by header and list. */
export function useSealedVaults() {
  const [vaults, setVaults] = useState<SealedVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const network = process.env.NEXT_PUBLIC_DECIBEL_NETWORK === "mainnet" ? "mainnet" : "testnet";

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sealed/vaults?network=${network}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not load sealed vaults");
        setVaults([]);
        return;
      }
      setVaults(Array.isArray(json.vaults) ? json.vaults : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { vaults, loading, error, reload, network };
}

export function SealedVaultFeed({
  vaults,
  loading,
  error,
  onRetry,
  onLaunch,
}: {
  vaults: SealedVault[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLaunch: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (loading) {
    return (
      <ul aria-busy aria-label="Loading vaults" className="divide-y divide-card-border">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex min-h-[60px] items-center gap-4 px-4">
            <div className="h-3.5 w-40 animate-pulse rounded-[4px] bg-[#1d1d1d] motion-reduce:animate-none" />
            <div className="ml-auto h-3.5 w-16 animate-pulse rounded-[4px] bg-[#1d1d1d] motion-reduce:animate-none" />
            <div className="hidden h-3.5 w-12 animate-pulse rounded-[4px] bg-[#1d1d1d] motion-reduce:animate-none sm:block" />
          </li>
        ))}
      </ul>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-[13px] text-zinc-200">Could not load vaults.</p>
        <p className="max-w-md text-[12px] text-zinc-500">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className={cn("rounded-[4px] border border-[#242424] px-3 py-2 text-[12px] font-semibold text-zinc-200 hover:bg-[#1a1a1a]", PRESSABLE_CONTROL, FOCUS_RING)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (vaults.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <p className="text-[13px] font-semibold text-zinc-200">No vaults yet</p>
        <p className="max-w-md text-[12px] leading-relaxed text-zinc-500">
          A sealed vault trades Decibel capital with a committed strategy. The chain enforces
          its rules on every trade.
        </p>
        <button
          type="button"
          onClick={onLaunch}
          className={cn("mt-1 min-h-10 rounded-[4px] bg-accent px-4 py-2 text-[12px] font-semibold text-black transition-[filter] hover:brightness-95", PRESSABLE_CONTROL, FOCUS_RING)}
        >
          Launch a vault
        </button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-card-border">
      {vaults.map((v) => {
        const open = selected === v.strategyVaultAddr;
        const live = vaultIsLive(v);
        return (
          <li key={v.strategyVaultAddr}>
            <button
              type="button"
              onClick={() => setSelected(open ? null : v.strategyVaultAddr)}
              aria-expanded={open}
              className={cn(
                "grid min-h-[60px] w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-4 py-3 text-left hover:bg-[#181818] sm:grid-cols-[minmax(0,1fr)_88px_72px_72px_auto]",
                PRESSABLE_CONTROL, FOCUS_RING,
                open && "bg-[#181818]",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-zinc-200">{v.name}</span>
                <span className="mt-0.5 block truncate text-[12px] text-zinc-500">
                  {v.marketName ?? "—"}
                  {v.description ? ` · ${v.description}` : ""}
                </span>
              </span>
              <span className="hidden font-mono text-[12px] tabular-nums text-zinc-400 sm:block">
                {(v.pctBps / 100).toFixed(0)}% NAV
              </span>
              <span className="hidden font-mono text-[12px] tabular-nums text-zinc-400 sm:block">
                {(v.maxLeverageX100 / 100).toFixed(1)}x
              </span>
              <span
                className={cn(
                  "justify-self-end rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium",
                  live ? "bg-accent/15 text-accent" : v.paused ? "bg-warning/15 text-warning" : "bg-zinc-500/15 text-zinc-400",
                )}
              >
                {live ? "Running" : v.paused ? "Paused" : "Unsealed"}
              </span>
              <ChevronDown
                className={cn("size-4 text-zinc-600 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")}
                aria-hidden
              />
            </button>
            {open && <VaultDetail vault={v} />}
          </li>
        );
      })}
    </ul>
  );
}

function VaultDetail({ vault: active }: { vault: SealedVault }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const [perf, setPerf] = useState<PerfSummary | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [amount, setAmount] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);
  const selected = active.strategyVaultAddr;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sealed/vaults/${selected}`, { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && res.ok) setDetail(json as Detail);
      } catch {
        /* detail is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Track record, rebuilt from chain. A depositor should not be asked to fund a strategy on a
  // name and a fee schedule alone.
  useEffect(() => {
    let cancelled = false;
    setPerfLoading(true);
    fetch(`/api/sealed/vaults/${selected}/performance`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setPerf(j?.ok ? (j as PerfSummary) : null);
      })
      .catch(() => {
        if (!cancelled) setPerf(null);
      })
      .finally(() => {
        if (!cancelled) setPerfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const doDeposit = useCallback(async () => {
    setDepositMsg(null);
    if (!connected || !account) {
      setDepositMsg("Connect a wallet to deposit.");
      return;
    }
    const usdc = Number(amount);
    if (!Number.isFinite(usdc) || usdc <= 0) {
      setDepositMsg("Enter an amount.");
      return;
    }
    setDepositBusy(true);
    try {
      // Deposits go through Decibel's own vault contract — the sealed module has
      // no funds-movement capability at all, by construction.
      const built = buildDepositDecibelVaultPayload({
        vaultAddress: active.decibelVaultAddr,
        owner: account.address.toString(),
        amountUsdc: usdc,
        network: active.network === "mainnet" ? "mainnet" : "testnet",
      });
      const submitted = await signAndSubmitTransaction({
        data: {
          function: built.payload.function as `${string}::${string}::${string}`,
          typeArguments: built.payload.typeArguments,
          // [subaccount, vaultAddress, contributionAsset, amountRaw] — all simple
          // wallet-adapter argument types.
          functionArguments: built.payload.functionArguments as (string | number)[],
        },
      });
      await waitForTransactionConfirmation(submitted.hash);
      setDepositMsg(`Deposited. tx ${submitted.hash.slice(0, 18)}…`);
      setAmount("");
    } catch (err) {
      setDepositMsg(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setDepositBusy(false);
    }
  }, [active, connected, account, amount, signAndSubmitTransaction]);

  const explorer = `https://explorer.aptoslabs.com/object/${active.strategyVaultAddr}?network=${active.network}`;

  return (
    <div className="grid gap-4 border-t border-[#1a1a1a] bg-[#050505] px-4 py-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-zinc-200">Enforced on chain, every trade</p>
          <ul className="space-y-1 text-[12px] text-zinc-400">
            <Guarantee>Trades only {active.marketName ?? "its bound market"}</Guarantee>
            <Guarantee>Order size = {(active.pctBps / 100).toFixed(0)}% of NAV, computed on chain</Guarantee>
            <Guarantee>Hard cap {(active.maxLeverageX100 / 100).toFixed(2)}x leverage</Guarantee>
            <Guarantee>At most one trade per {active.minBarIntervalS}s</Guarantee>
            <Guarantee>Cannot withdraw — no funds authority is delegated</Guarantee>
            <Guarantee>Every bar signed and sequenced; a skipped bar is public</Guarantee>
          </ul>
        </div>

        <div>
          <p className="mb-1 text-[12px] font-semibold text-zinc-200">Program commitment</p>
          <p className="break-all font-mono text-[11px] text-accent">{active.programCommitment}</p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            The strategy is private. This hash fixes it — if the creator reveals the source
            later, every past trade becomes verifiable against it.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="rounded-[4px] bg-[#1a1a1a] px-1.5 py-0.5 text-zinc-400">
              {active.attestationTier === "tee" ? "TEE attested" : "Key attested"}
            </span>
            {active.revealed && (
              <span className="rounded-[4px] bg-[#1a1a1a] px-1.5 py-0.5 text-zinc-400">Source revealed</span>
            )}
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className={cn("rounded-[4px] font-mono text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200", FOCUS_RING)}
            >
              {active.strategyVaultAddr.slice(0, 10)}…{active.strategyVaultAddr.slice(-6)} ↗
            </a>
          </div>
        </div>

        {detail?.onChain && (
          <DataTable
            columns={["Live on-chain", ""]}
            rows={[
              ["Bars processed", <AnimatedNumber key="b" value={detail.onChain.seq} />],
              ["Trades placed", <AnimatedNumber key="t" value={detail.onChain.trades} />],
              [
                "Position",
                detail.onChain.inPosition ? (detail.onChain.isLong ? "Long" : "Short") : "Flat",
              ],
              ["Rules frozen", detail.onChain.sealed ? "Yes" : "No"],
            ]}
          />
        )}

        {detail?.registryMatchesChain === false && (
          <p role="alert" className="rounded-[4px] border border-destructive/30 bg-destructive/5 p-2.5 text-[12px] text-destructive">
            On-chain state disagrees with the registry on: {detail.mismatches.join(", ")}. Treat
            this listing as untrusted.
          </p>
        )}
        {detail?.chainError && (
          <p className="text-[11px] text-warning">Could not read chain state: {detail.chainError}</p>
        )}
      </div>

      <div className="space-y-4">
        {/* What the vault actually did, on the prices the contract actually signed.
            A depositor should be able to see their money move, not just read a
            summary statistic about it. */}
        {perf?.trace && perf.traceTimestamps && perf.trace.length > 1 && (
          <SealedTraceChart
            fills={perf.fills ?? []}
            trace={perf.trace}
            traceTimestamps={perf.traceTimestamps}
          />
        )}

        {/* Track record. Every number here is derived from what the contract actually did —
            nothing is self-reported by the creator. */}
        <div className="rounded-[4px] border border-[#242424] bg-[#141414] p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h5 className="text-[13px] font-semibold text-zinc-200">Track record</h5>
            {perfLoading && <span className="text-[11px] text-zinc-500">reading chain…</span>}
          </div>

          {perf && perf.closedTrades > 0 ? (
            <>
              <dl className="mt-2.5 grid grid-cols-3 gap-3">
                <PerfStat
                  k="Return"
                  v={`${perf.cumulativeReturnPct! >= 0 ? "+" : "−"}${Math.abs(perf.cumulativeReturnPct!).toFixed(1)}%`}
                  tone={perf.cumulativeReturnPct! >= 0 ? "good" : "bad"}
                />
                <PerfStat k="Win rate" v={`${perf.winRatePct!.toFixed(0)}%`} />
                <PerfStat
                  k="Max drawdown"
                  v={`${perf.maxDrawdownPct!.toFixed(1)}%`}
                  tone={perf.maxDrawdownPct! < -20 ? "bad" : undefined}
                />
              </dl>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                {perf.closedTrades} closed trade{perf.closedTrades === 1 ? "" : "s"} over{" "}
                {perf.bars} bars. Returns are per-trade price moves before leverage, fees and
                slippage — not the vault&apos;s net return to depositors.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
              {perf?.note ??
                "No closed trades yet — there is no track record to judge this vault on."}
            </p>
          )}
          <p className="mt-2 border-t border-[#242424] pt-2 text-[11px] leading-relaxed text-zinc-500">
            Past performance says nothing about future results. This is a leveraged strategy
            and deposits can lose value.
          </p>
        </div>

        {/* Deposit */}
        <div>
          <label htmlFor={`deposit-${selected}`} className="mb-1.5 block text-[12px] font-semibold text-zinc-200">
            Deposit USDC
          </label>
          <div className="flex gap-2">
            <input
              id={`deposit-${selected}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="100"
              disabled={!active.sealedAt}
              className={cn("min-h-10 w-full rounded-[4px] border border-[#242424] bg-black px-3 font-mono text-[16px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-500 disabled:opacity-50 sm:text-[13px]", FOCUS_RING)}
            />
            <button
              type="button"
              onClick={doDeposit}
              disabled={!active.sealedAt || depositBusy}
              aria-busy={depositBusy}
              className={cn("min-h-10 shrink-0 rounded-[4px] bg-accent px-4 text-[12px] font-semibold text-black transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40", PRESSABLE_CONTROL, FOCUS_RING)}
            >
              {depositBusy ? "Depositing…" : connected ? "Deposit" : "Connect wallet"}
            </button>
          </div>
          {!active.sealedAt && (
            <p className="mt-1.5 text-[11px] text-warning">
              This vault is not sealed yet — its rules can still change. Deposits are disabled.
            </p>
          )}
          {depositMsg && (
            <p className="mt-1.5 break-all text-[11px] text-zinc-400">{depositMsg}</p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-zinc-500">
            Funds go to the Decibel vault, not to this app or the creator. Withdrawals follow
            Decibel&apos;s redemption queue.
          </p>
        </div>
      </div>
    </div>
  );
}

function PerfStat({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-500">{k}</dt>
      <dd
        className={cn(
          "mt-0.5 font-mono text-[15px] font-semibold tabular-nums",
          tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-zinc-200",
        )}
      >
        {v}
      </dd>
    </div>
  );
}

function Guarantee({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-1.5">
      <span aria-hidden className="mt-px text-accent">✓</span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}
