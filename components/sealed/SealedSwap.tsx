"use client";

/**
 * Swap the strategy behind a vault.
 *
 * The launch fee is charged once per Decibel vault, so re-pointing that vault at a different
 * indicator costs gas alone. What it does NOT cost is the depositors' ability to see it coming:
 * a replacement strategy cannot trade a vault holding other people's money until it has been
 * publicly announced for 24 hours.
 *
 * That rule is enforced by the contract, in `tick_attested`, not here — this panel only
 * reports it. Gating the delegation instead would be theatre, because Decibel's
 * `delegate_dex_actions_to` is a `private entry` no module can hook. Whatever this UI shows,
 * the chain is the thing actually stopping the trade.
 *
 * Order matters and is deliberate: announce FIRST, hand over LAST. The outgoing strategy keeps
 * managing positions for the whole notice window, so the vault is never left dark.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ArrowRight, Check, ChevronDown, Clock, Loader2, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, TaskList, type AgentTask } from "@/components/ui/agent";
import { ActionButton, Banner } from "@/components/ui/interactions";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
import { SURFACE_CARD_SOLID, SURFACE_CONTROL } from "@/lib/surface";

interface VaultRow {
  strategyVaultAddr: string;
  decibelVaultAddr: string;
  name: string;
  marketName: string | null;
  programCommitment: string;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  paused: boolean;
  createdAt: string;
}

interface SwapStatus {
  isSwap: boolean;
  announcedAt: number;
  tradableAt: number;
  expiresAt: number;
  needsNotice: boolean;
  now: number;
}

/** A swap in flight, kept across reloads. The chain is still the source of truth for timing —
 *  this only remembers WHICH strategy is replacing which, which the chain does not record. */
interface PendingSwap {
  decibelVaultAddr: string;
  fromStrategy: string;
  toStrategy: string;
  toLabel: string;
  vaultName: string;
  announced: boolean;
}

const STORE_KEY = "cash.sealed.pendingSwaps.v1";

function loadPending(): PendingSwap[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as PendingSwap[]) : [];
  } catch {
    return [];
  }
}
function savePending(list: PendingSwap[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* private browsing — the swap still works, it just won't survive a reload */
  }
}

function asTxData(p: { function: string; typeArguments: string[]; functionArguments: unknown[] }) {
  return {
    function: p.function as `${string}::${string}::${string}`,
    typeArguments: p.typeArguments,
    functionArguments: p.functionArguments as Array<string | number | boolean | number[] | string[]>,
  };
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok && json.ok === true, json };
}

function countdown(secs: number): string {
  if (secs <= 0) return "ready";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  const s = secs % 60;
  return `${m}m ${s}s`;
}

export function SealedSwap({ creatorAddr }: { creatorAddr?: string }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [vaults, setVaults] = useState<VaultRow[] | null>(null);
  const [pending, setPending] = useState<PendingSwap[]>([]);
  const [status, setStatus] = useState<Record<string, SwapStatus>>({});
  const [config, setConfig] = useState<{ network: string; attestorPubkey: string | null; packageAddress: string | null; ready: boolean } | null>(null);

  const [activeVault, setActiveVault] = useState<string | null>(null);
  const [pickId, setPickId] = useState(SEALED_CATALOG[0].id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const addr = creatorAddr ?? account?.address?.toString();

  useEffect(() => setPending(loadPending()), []);
  useEffect(() => {
    fetch("/api/sealed/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  // 1s heartbeat so countdowns move without refetching the chain.
  useEffect(() => {
    if (pending.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [pending.length]);

  const loadVaults = useCallback(async () => {
    if (!addr || !config) return;
    try {
      const r = await fetch(
        `/api/sealed/vaults?network=${config.network}&creator=${addr}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      setVaults(Array.isArray(j.vaults) ? (j.vaults as VaultRow[]) : []);
    } catch {
      setVaults([]);
    }
  }, [addr, config]);

  useEffect(() => {
    void loadVaults();
  }, [loadVaults]);

  /** Re-read the notice schedule from chain. Whether notice applies depends on who holds
   *  shares RIGHT NOW, so this cannot be cached from when the swap started. */
  const refreshStatus = useCallback(async () => {
    const next: Record<string, SwapStatus> = {};
    await Promise.all(
      pending.map(async (p) => {
        try {
          const r = await fetch(`/api/sealed/swap-status?addr=${p.toStrategy}`, { cache: "no-store" });
          const j = await r.json();
          if (j.ok) next[p.toStrategy] = j as SwapStatus;
        } catch {
          /* leave it absent — the UI shows "checking" rather than a wrong number */
        }
      }),
    );
    setStatus(next);
  }, [pending]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const selected = useMemo(
    () => SEALED_CATALOG.find((s) => s.id === pickId) ?? SEALED_CATALOG[0],
    [pickId],
  );

  /** Group by Decibel vault: one vault can have had several strategies over time, and only the
   *  most recent one is live. */
  const byVault = useMemo(() => {
    const m = new Map<string, VaultRow[]>();
    for (const v of vaults ?? []) {
      const list = m.get(v.decibelVaultAddr) ?? [];
      list.push(v);
      m.set(v.decibelVaultAddr, list);
    }
    return [...m.entries()].map(([vault, rows]) => ({
      decibelVaultAddr: vault,
      rows: rows.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
      current: rows[0],
    }));
  }, [vaults]);

  const pendingFor = useCallback(
    (vault: string) => pending.find((p) => p.decibelVaultAddr === vault) ?? null,
    [pending],
  );

  const updatePending = useCallback((next: PendingSwap[]) => {
    setPending(next);
    savePending(next);
  }, []);

  // ── Stage 1: create the replacement + announce it ───────────────────────────
  const startSwap = useCallback(
    async (vault: string, currentStrategy: string, vaultName: string, market: string | null) => {
      setError(null);
      if (!connected || !account || !config?.ready) {
        setError("Connect a wallet on a network where the sealed module is published.");
        return;
      }
      try {
        setBusyStep(`${vault}:commit`);
        const commit = await postJson("/api/sealed/commit", {
          pineScript: selected.script,
          market: market ?? undefined,
        });
        if (!commit.ok) {
          setError((commit.json.error as string) ?? "That strategy can't run on-chain.");
          setBusyStep(null);
          return;
        }
        const info = commit.json as { commitment: string; manifestJson: string; market: { name: string } };

        setBusyStep(`${vault}:create`);
        const payload = await postJson("/api/sealed/payload", {
          kind: "create",
          programCommitment: info.commitment,
          attestorPubkey: config.attestorPubkey,
          decibelVaultAddr: vault,
          market: info.market.name,
        });
        if (!payload.ok) {
          setError((payload.json.error as string) ?? "Could not build the strategy transaction");
          setBusyStep(null);
          return;
        }
        const tx = await signAndSubmitTransaction({
          data: asTxData(payload.json.payload as Parameters<typeof asTxData>[0]),
        });
        await waitForTransactionConfirmation(tx.hash);
        const found = await fetch(`/api/sealed/created?tx=${tx.hash}&network=${config.network}`)
          .then((r) => r.json())
          .catch(() => null);
        const newSv = found?.strategyVaultAddr as string | undefined;
        if (!newSv) {
          setError("The strategy was created but its address didn't come back. Reload and retry.");
          setBusyStep(null);
          return;
        }

        // Announce immediately. If nobody else is in the vault the contract ignores the notice
        // entirely, but announcing anyway costs a few thousandths of a cent and means the
        // schedule is on chain even if depositors arrive mid-swap.
        setBusyStep(`${vault}:announce`);
        const ann = await postJson("/api/sealed/payload", {
          kind: "announce-swap",
          strategyVaultAddr: newSv,
        });
        let announced = false;
        if (ann.ok) {
          const at = await signAndSubmitTransaction({
            data: asTxData(ann.json.payload as Parameters<typeof asTxData>[0]),
          });
          await waitForTransactionConfirmation(at.hash);
          announced = true;
        }

        updatePending([
          ...pending.filter((p) => p.decibelVaultAddr !== vault),
          {
            decibelVaultAddr: vault,
            fromStrategy: currentStrategy,
            toStrategy: newSv,
            toLabel: selected.label,
            vaultName,
            announced,
          },
        ]);
        setBusyStep(null);
        setActiveVault(null);
        await refreshStatus();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Swap failed";
        setError(
          /reject|denied|cancel/i.test(msg)
            ? "You rejected the signature. Nothing changed — the current strategy is still running."
            : msg,
        );
        setBusyStep(null);
      }
    },
    [connected, account, config, selected, pending, updatePending, signAndSubmitTransaction, refreshStatus],
  );

  // ── Stage 2: hand trading over ──────────────────────────────────────────────
  const finishSwap = useCallback(
    async (p: PendingSwap) => {
      setError(null);
      try {
        setBusyStep(`${p.decibelVaultAddr}:revoke`);
        const rev = await postJson("/api/sealed/payload", {
          kind: "revoke",
          decibelVaultAddr: p.decibelVaultAddr,
          strategyVaultAddrs: [p.fromStrategy],
        });
        if (!rev.ok) {
          setError((rev.json.error as string) ?? "Could not build the revoke transaction");
          setBusyStep(null);
          return;
        }
        const r1 = await signAndSubmitTransaction({
          data: asTxData(rev.json.payload as Parameters<typeof asTxData>[0]),
        });
        await waitForTransactionConfirmation(r1.hash);

        setBusyStep(`${p.decibelVaultAddr}:delegate`);
        const del = await postJson("/api/sealed/payload", {
          kind: "delegate",
          decibelVaultAddr: p.decibelVaultAddr,
          strategyVaultAddr: p.toStrategy,
        });
        if (!del.ok) {
          setError(
            `Old strategy revoked but delegation failed: ${(del.json.error as string) ?? "unknown"}. ` +
              `The vault is not trading — retry to finish.`,
          );
          setBusyStep(null);
          return;
        }
        const r2 = await signAndSubmitTransaction({
          data: asTxData(del.json.payload as Parameters<typeof asTxData>[0]),
        });
        await waitForTransactionConfirmation(r2.hash);

        updatePending(pending.filter((x) => x.decibelVaultAddr !== p.decibelVaultAddr));
        setBusyStep(null);
        await loadVaults();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Handover failed";
        setError(
          /reject|denied|cancel/i.test(msg)
            ? "You rejected the signature. The swap is still pending — press Activate to finish."
            : msg,
        );
        setBusyStep(null);
      }
    },
    [pending, updatePending, signAndSubmitTransaction, loadVaults],
  );

  if (!addr) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "p-6 text-center")}>
        <p className="text-[14px] text-zinc-400">Connect a wallet to manage your bots.</p>
      </div>
    );
  }

  if (vaults === null) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "flex items-center justify-center gap-2 p-6")}>
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden />
        <span className="text-[14px] text-zinc-400">Loading your bots…</span>
      </div>
    );
  }

  if (byVault.length === 0) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "p-6 text-center")}>
        <p className="text-[15px] font-semibold text-white">No bots yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-zinc-400">
          Launch one and it appears here. After that, swapping its strategy costs only gas — the
          launch fee is charged once per vault, not once per strategy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {error && (
          <Banner tone="error" onDismiss={() => setError(null)}>
            <span className="block font-semibold">{error}</span>
          </Banner>
        )}
      </AnimatePresence>

      {byVault.map(({ decibelVaultAddr, current }) => {
        const p = pendingFor(decibelVaultAddr);
        const st = p ? status[p.toStrategy] : undefined;
        const secsLeft = st ? Math.max(0, st.tradableAt - (st.now + tick)) : 0;
        const expiresIn = st ? Math.max(0, st.expiresAt - (st.now + tick)) : 0;
        const gated = Boolean(st?.needsNotice);
        const ready = p ? !gated || secsLeft <= 0 : false;
        const expired = p ? gated && expiresIn <= 0 : false;
        const busy = busyStep?.startsWith(decibelVaultAddr) ?? false;

        const tasks: AgentTask[] = p
          ? [
              { id: "create", label: `Compile and seal “${p.toLabel}”`, detail: p.toStrategy, state: "done" },
              {
                id: "notice",
                label: gated ? "Depositor notice period" : "No notice needed — you're the only holder",
                detail: gated
                  ? expired
                    ? "Announcement expired — announce again to restart the 24h"
                    : secsLeft > 0
                      ? `Trading opens in ${countdown(secsLeft)}`
                      : "Notice complete"
                  : undefined,
                state: gated ? (expired ? "failed" : secsLeft > 0 ? "active" : "done") : "done",
              },
              {
                id: "handover",
                label: "Hand trading to the new strategy",
                detail: ready ? "Two signatures: revoke the old, delegate the new" : undefined,
                state: busyStep?.endsWith("revoke") || busyStep?.endsWith("delegate") ? "active" : "pending",
              },
            ]
          : [];

        return (
          <section key={decibelVaultAddr} className={cn(SURFACE_CARD_SOLID, "overflow-hidden")}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
              <div className="min-w-0">
                <h3 className="font-display text-[15px] font-semibold text-white">{current.name}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-zinc-400">
                  <span>{current.marketName ?? "BTC/USD"}</span>
                  <span className="text-zinc-700">·</span>
                  <span>{current.pctBps / 100}% per order</span>
                  <span className="text-zinc-700">·</span>
                  <span>{current.maxLeverageX100 / 100}x max</span>
                  {current.paused && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span className="text-amber-400">paused</span>
                    </>
                  )}
                </p>
              </div>
              {!p && (
                <button
                  type="button"
                  onClick={() =>
                    setActiveVault(activeVault === decibelVaultAddr ? null : decibelVaultAddr)
                  }
                  className={cn(
                    "shrink-0 rounded-[10px] border px-3 py-2 font-display text-[13px] font-semibold transition-colors",
                    activeVault === decibelVaultAddr
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-white/[0.06] bg-[#1a1a1a] text-white hover:border-accent/40",
                  )}
                >
                  {activeVault === decibelVaultAddr ? "Cancel" : "Swap strategy"}
                </button>
              )}
            </header>

            {/* Pick a replacement */}
            <AnimatePresence initial={false}>
              {activeVault === decibelVaultAddr && !p && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="space-y-3 px-4 py-4">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpen((o) => !o)}
                        aria-haspopup="listbox"
                        aria-expanded={menuOpen}
                        disabled={busy}
                        className={cn(
                          "flex w-full items-center justify-between rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                          "border-white/[0.06] bg-[#0d0d0d] hover:border-accent/40 disabled:opacity-50",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block font-display text-[14px] font-semibold text-white">
                            {selected.label}
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-zinc-400">
                            {selected.category} · {selected.direction} · {selected.blurb}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", menuOpen && "rotate-180")}
                          aria-hidden
                        />
                      </button>
                      <AnimatePresence>
                        {menuOpen && (
                          <motion.ul
                            role="listbox"
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute z-30 mt-1.5 max-h-[300px] w-full overflow-y-auto rounded-[16px] border border-white/[0.06] bg-[#141414] p-1 shadow-2xl"
                          >
                            {SEALED_CATALOG.map((s: CatalogStrategy) => (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={s.id === pickId}
                                  onClick={() => {
                                    setPickId(s.id);
                                    setMenuOpen(false);
                                  }}
                                  className={cn(
                                    "flex w-full items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors",
                                    s.id === pickId ? "bg-accent/10" : "hover:bg-white/[0.04]",
                                  )}
                                >
                                  <Check
                                    className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.id === pickId ? "text-accent" : "text-transparent")}
                                    aria-hidden
                                  />
                                  <span>
                                    <span className="block font-display text-[13px] font-semibold text-white">
                                      {s.label}
                                    </span>
                                    <span className="mt-0.5 block text-[12px] leading-snug text-zinc-400">
                                      {s.category} · {s.direction} · {s.blurb}
                                    </span>
                                  </span>
                                </button>
                              </li>
                            ))}
                          </motion.ul>
                        )}
                      </AnimatePresence>
                    </div>

                    <CodeBlock code={selected.script} filename={`${selected.id}.pine`} maxHeight={160} />

                    <div className={cn(SURFACE_CONTROL, "flex items-start gap-2.5 p-3")}>
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                      <p className="text-[12px] leading-relaxed text-zinc-300">
                        If anyone other than you holds shares in this vault, the new strategy
                        cannot trade for <span className="font-semibold text-white">24 hours</span>{" "}
                        after you announce it — depositors get that window to withdraw. Your
                        current strategy keeps running the whole time, so the vault is never left
                        unmanaged. If you&apos;re the only holder, the swap takes effect
                        immediately.
                      </p>
                    </div>

                    <ActionButton
                      onClick={() =>
                        startSwap(decibelVaultAddr, current.strategyVaultAddr, current.name, current.marketName)
                      }
                      state={busy ? "pending" : "idle"}
                      disabled={busy || !config?.ready}
                    >
                      Announce swap to {selected.label}
                    </ActionButton>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* A swap already in flight */}
            {p && (
              <div className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="text-zinc-400">Replacing</span>
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    {p.fromStrategy.slice(0, 10)}…
                  </code>
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  <span className="font-semibold text-white">{p.toLabel}</span>
                </div>

                {gated && !expired && secsLeft > 0 && (
                  <div className={cn(SURFACE_CONTROL, "flex items-center gap-2.5 p-3")}>
                    <Clock className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <div>
                      <p className="font-display text-[14px] font-semibold text-white">
                        Trading opens in {countdown(secsLeft)}
                      </p>
                      <p className="mt-0.5 text-[12px] text-zinc-400">
                        Depositors can withdraw until then. Your current strategy is still
                        running.
                      </p>
                    </div>
                  </div>
                )}

                <TaskList tasks={tasks} />

                {expired ? (
                  <ActionButton
                    onClick={async () => {
                      const ann = await postJson("/api/sealed/payload", {
                        kind: "announce-swap",
                        strategyVaultAddr: p.toStrategy,
                      });
                      if (ann.ok) {
                        const t = await signAndSubmitTransaction({
                          data: asTxData(ann.json.payload as Parameters<typeof asTxData>[0]),
                        });
                        await waitForTransactionConfirmation(t.hash);
                        await refreshStatus();
                      }
                    }}
                    state="idle"
                  >
                    Re-announce (restarts the 24h)
                  </ActionButton>
                ) : (
                  <ActionButton
                    onClick={() => finishSwap(p)}
                    state={busy ? "pending" : "idle"}
                    disabled={busy || !ready}
                  >
                    {ready ? "Activate new strategy" : `Locked for ${countdown(secsLeft)}`}
                  </ActionButton>
                )}

                <button
                  type="button"
                  onClick={() =>
                    updatePending(pending.filter((x) => x.decibelVaultAddr !== decibelVaultAddr))
                  }
                  className="w-full text-center text-[12px] text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
                >
                  Abandon this swap — keep the current strategy
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
