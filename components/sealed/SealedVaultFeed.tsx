"use client";

/**
 * Sealed-vault feed (trader side).
 *
 * The pitch a depositor reads here is deliberately narrow and true: you cannot
 * see the strategy, but you can verify what it is structurally unable to do.
 * Every guarantee shown is one the Move module enforces per trade.
 */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { cn } from "@/lib/utils";
import { AnimatedNumber, Banner, ContentState, Pressable, Reveal, Skeleton, ActionButton } from "@/components/ui/interactions";
import { DataTable } from "@/components/ui/agent";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { buildDepositDecibelVaultPayload } from "@/lib/decibel-vaults";

interface SealedVault {
  strategyVaultAddr: string;
  packageAddress: string;
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

export function SealedVaultFeed() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const [vaults, setVaults] = useState<SealedVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [amount, setAmount] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sealed/vaults?network=testnet", { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
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

  const active = vaults.find((v) => v.strategyVaultAddr === selected) ?? null;

  const doDeposit = useCallback(async () => {
    if (!active) return;
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
        network: "testnet",
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

  const emptyState = (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#111] px-8 py-14 text-center">
      <h3 className="mb-1.5 font-display text-sm font-semibold text-white">No bots live yet</h3>
      <p className="mx-auto max-w-md text-[12px] leading-relaxed text-zinc-500">
        A sealed bot keeps its strategy private while the chain enforces what it can trade.
        Launch one from the Launch a Bot tab.
      </p>
    </div>
  );

  if (loading || error || vaults.length === 0) {
    return (
      <ContentState
        loading={loading}
        error={error}
        empty={vaults.length === 0}
        emptyState={emptyState}
        skeleton={
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        }
      >
        {null}
      </ContentState>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-3 sm:grid-cols-2">
        {vaults.map((v, vi) => {
          const live = Boolean(v.sealedAt) && !v.paused;
          return (
            <Reveal key={v.strategyVaultAddr} index={vi}>
            <Pressable
              onClick={() => setSelected(v.strategyVaultAddr)}
              className={cn(
                "w-full rounded-2xl border p-4 text-left transition-all",
                selected === v.strategyVaultAddr
                  ? "border-accent/50 bg-accent/[0.04]"
                  : "border-[#2a2a2a] bg-[#141414] hover:border-white/20",
              )}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <h4 className="font-display text-[14px] font-bold leading-tight text-white">
                  {v.name}
                </h4>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                    live
                      ? "bg-accent/15 text-accent"
                      : v.paused
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-zinc-500/15 text-zinc-400",
                  )}
                >
                  {live ? "Live" : v.paused ? "Paused" : "Unsealed"}
                </span>
              </div>
              {v.description && (
                <p className="mb-3 line-clamp-2 text-[11px] leading-snug text-zinc-500">
                  {v.description}
                </p>
              )}
              <dl className="grid grid-cols-3 gap-2">
                <Stat k="Market" v={v.marketName ?? "—"} />
                <Stat k="Size" v={`${(v.pctBps / 100).toFixed(0)}% NAV`} />
                <Stat k="Max lev" v={`${(v.maxLeverageX100 / 100).toFixed(2)}x`} />
              </dl>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded bg-[#0d0d0d] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                  {v.attestationTier === "tee" ? "TEE attested" : "Key attested"}
                </span>
                {v.revealed && (
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-400">
                    Source revealed
                  </span>
                )}
              </div>
            </Pressable>
            </Reveal>
          );
        })}
      </div>

      {/* Detail / deposit */}
      <aside className="rounded-2xl border border-[#2a2a2a] bg-[#141414] p-4">
        {!active ? (
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Select a vault to see what the chain enforces and to deposit.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <h4 className="font-display text-[15px] font-bold text-white">{active.name}</h4>
              <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-600">
                {active.strategyVaultAddr}
              </p>
            </div>

            <div>
              <p className="mb-1.5 font-display text-[11px] font-semibold text-zinc-300">
                Enforced on chain, every trade
              </p>
              <ul className="space-y-1 text-[11px] text-zinc-400">
                <Guarantee>Trades only {active.marketName ?? "its bound market"}</Guarantee>
                <Guarantee>Order size = {(active.pctBps / 100).toFixed(0)}% of NAV, computed on chain</Guarantee>
                <Guarantee>Hard cap {(active.maxLeverageX100 / 100).toFixed(2)}x leverage</Guarantee>
                <Guarantee>At most one trade per {active.minBarIntervalS}s</Guarantee>
                <Guarantee>Cannot withdraw — no funds authority is delegated</Guarantee>
                <Guarantee>Every bar signed and sequenced; a skipped bar is public</Guarantee>
              </ul>
            </div>

            <div>
              <p className="mb-1 font-display text-[11px] font-semibold text-zinc-300">
                Program commitment
              </p>
              <p className="break-all font-mono text-[10px] text-accent">
                {active.programCommitment}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-zinc-600">
                The strategy is private. This hash fixes it — if the creator reveals the source
                later, every past trade becomes verifiable against it.
              </p>
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
              <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-[11px] text-red-300">
                On-chain state disagrees with the registry on: {detail.mismatches.join(", ")}. Treat
                this listing as untrusted.
              </p>
            )}
            {detail?.chainError && (
              <p className="text-[10px] text-amber-500/80">
                Could not read chain state: {detail.chainError}
              </p>
            )}

            {/* Deposit */}
            <div className="border-t border-[#2a2a2a] pt-3">
              <label className="mb-1.5 block font-display text-[11px] font-semibold text-zinc-300">
                Deposit USDC
              </label>
              <div className="flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="100"
                  className="w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none"
                />
                <div className="w-28 shrink-0">
                  <ActionButton
                    onClick={doDeposit}
                    state={depositBusy ? "pending" : "idle"}
                    disabled={!active.sealedAt}
                    className="!px-3 !py-2 !text-[12px]"
                  >
                    Deposit
                  </ActionButton>
                </div>
              </div>
              {!active.sealedAt && (
                <p className="mt-1.5 text-[10px] text-amber-500/80">
                  This vault is not sealed yet — its rules can still change. Deposits are disabled.
                </p>
              )}
              {depositMsg && (
                <p className="mt-1.5 break-all text-[10px] text-zinc-400">{depositMsg}</p>
              )}
              <p className="mt-2 text-[10px] leading-snug text-zinc-600">
                Funds go to the Decibel vault, not to this app or the creator. Withdrawals follow
                Decibel&apos;s redemption queue.
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-zinc-600">{k}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-zinc-200">{v}</dd>
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
