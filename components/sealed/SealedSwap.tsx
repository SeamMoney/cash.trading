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
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
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
  /** Whether we tick this vault. Carried forward on a swap: a replacement registered without it
   *  is a vault nothing ever ticks. */
  managedAttestation: boolean;
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
  /** Catalog id. The handover re-derives the replacement's commitment from this, so the
   *  registry row it writes is the one the chain actually sealed. Labels can be renamed;
   *  a swap that survives a page reload cannot depend on one. */
  toStrategyId: string | null;
  vaultName: string;
  announced: boolean;
}

/** Legacy store. Read once so a swap started before server persistence isn't stranded. */
const LEGACY_KEY = "cash.sealed.pendingSwaps.v1";

function drainLegacy(): PendingSwap[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    window.localStorage.removeItem(LEGACY_KEY);
    return JSON.parse(raw) as PendingSwap[];
  } catch {
    return [];
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

  /** Server-held, so clearing browser data no longer strands a swap. */
  const loadPending = useCallback(async () => {
    if (!addr) return;
    try {
      const r = await fetch(`/api/sealed/pending-swap?creator=${addr}`, { cache: "no-store" });
      const j = await r.json();
      const rows: PendingSwap[] = Array.isArray(j.swaps)
        ? j.swaps.map((x: Record<string, string | boolean>) => ({
            decibelVaultAddr: String(x.decibelVaultAddr),
            fromStrategy: String(x.fromStrategyAddr),
            toStrategy: String(x.toStrategyAddr),
            toLabel: String(x.toLabel),
            toStrategyId: x.toStrategyId ? String(x.toStrategyId) : null,
            vaultName: String(x.vaultName),
            announced: Boolean(x.announced),
          }))
        : [];
      // Migrate anything left in localStorage from before this moved server-side.
      const legacy = drainLegacy().filter(
        (l) => !rows.some((r2) => r2.decibelVaultAddr === l.decibelVaultAddr),
      );
      for (const l of legacy) {
        await fetch("/api/sealed/pending-swap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decibelVaultAddr: l.decibelVaultAddr,
            creatorAddr: addr,
            fromStrategyAddr: l.fromStrategy,
            toStrategyAddr: l.toStrategy,
            toLabel: l.toLabel,
            toStrategyId: l.toStrategyId,
            vaultName: l.vaultName,
            announced: l.announced,
          }),
        }).catch(() => undefined);
      }
      setPending([...rows, ...legacy]);
    } catch {
      setPending([]);
    }
  }, [addr]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);
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

  const recordSwap = useCallback(
    async (p: PendingSwap) => {
      setPending((cur) => [...cur.filter((x) => x.decibelVaultAddr !== p.decibelVaultAddr), p]);
      await fetch("/api/sealed/pending-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decibelVaultAddr: p.decibelVaultAddr,
          creatorAddr: addr,
          fromStrategyAddr: p.fromStrategy,
          toStrategyAddr: p.toStrategy,
          toLabel: p.toLabel,
          toStrategyId: p.toStrategyId,
          vaultName: p.vaultName,
          announced: p.announced,
        }),
      }).catch(() => undefined);
    },
    [addr],
  );

  const clearSwap = useCallback(async (vault: string) => {
    setPending((cur) => cur.filter((x) => x.decibelVaultAddr !== vault));
    await fetch(`/api/sealed/pending-swap?vault=${vault}&creator=${addr}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }, [addr]);

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

        await recordSwap({
          decibelVaultAddr: vault,
          fromStrategy: currentStrategy,
          toStrategy: newSv,
          toLabel: selected.label,
          toStrategyId: selected.id,
          vaultName,
          announced,
        });
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
    [connected, account, config, selected, recordSwap, signAndSubmitTransaction, refreshStatus],
  );

  /**
   * Put the replacement into the tick cron's working set and take the strategies it replaced
   * out of it, in one write.
   *
   * The commitment is re-derived rather than remembered: `/api/sealed/commit` is deterministic
   * over (script, market), so re-running it reproduces exactly what was sealed on chain at
   * announce time. That matters because this step can run minutes or days after the announce,
   * on a different page load — and the server refuses a registration whose source does not hash
   * to the commitment, so a wrong guess here fails loudly instead of registering a lie.
   */
  const registerReplacement = useCallback(
    async (
      p: PendingSwap,
      siblings: VaultRow[],
      retires: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!config?.packageAddress || !config.attestorPubkey || !addr) {
        return { ok: false, error: "the sealed module is not configured on this network" };
      }
      // Whatever this vault was before the swap: its name, its sizing, and crucially whether we
      // are the ones ticking it. A creator running their own attestor must not be quietly
      // switched onto ours, and a creator on ours must not be quietly switched off it.
      const prior = siblings.find(
        (v) => v.strategyVaultAddr.toLowerCase() === p.fromStrategy.toLowerCase(),
      ) ?? siblings[0];
      const strategy = p.toStrategyId
        ? SEALED_CATALOG.find((s) => s.id === p.toStrategyId)
        : SEALED_CATALOG.find((s) => s.label === p.toLabel);
      if (!strategy) {
        return { ok: false, error: `unknown strategy "${p.toLabel}"` };
      }

      const commit = await postJson("/api/sealed/commit", {
        pineScript: strategy.script,
        market: prior?.marketName ?? undefined,
      });
      if (!commit.ok) {
        return { ok: false, error: (commit.json.error as string) ?? "could not re-derive the commitment" };
      }
      const info = commit.json as { commitment: string; manifestJson: string; market: { name: string } };

      const res = await postJson("/api/sealed/vaults", {
        strategyVaultAddr: p.toStrategy,
        packageAddress: config.packageAddress,
        network: config.network,
        creatorAddr: addr,
        decibelVaultAddr: p.decibelVaultAddr,
        programCommitment: info.commitment,
        attestorPubkey: config.attestorPubkey,
        manifestJson: info.manifestJson,
        market: info.market.name,
        name: p.vaultName,
        description: strategy.blurb,
        pctBps: prior?.pctBps,
        maxLeverageX100: prior?.maxLeverageX100,
        minBarIntervalS: prior?.minBarIntervalS,
        sealed: true,
        // Catalog strategies are public source, so revealing costs no alpha and lets a
        // depositor read what their money is now following.
        revealedPine: strategy.script,
        // Only if the vault it replaces was managed. Otherwise the creator ticks it themselves,
        // exactly as they were doing before.
        managedPine: prior?.managedAttestation ? strategy.script : undefined,
        retiresStrategyVaultAddrs: retires,
      });
      if (!res.ok) {
        return { ok: false, error: (res.json.error as string) ?? "registry write failed" };
      }
      return { ok: true };
    },
    [config, addr],
  );

  // ── Stage 2: hand trading over ──────────────────────────────────────────────
  //
  // Three things have to happen together, and the order is not negotiable:
  //
  //   1. Revoke EVERY delegation on this Decibel vault — `revoke_all_dex_actions_delegations`,
  //      not a list we compiled. Two delegates share one trading subaccount, so the engine nets
  //      their positions against each other and each vault's own book then describes a position
  //      it does not solely own (docs/DEPLOY-SEALED.md §8.5c — the failure that could strand
  //      sub-minimum dust). A list can be wrong; revoke-all cannot.
  //   2. Delegate the replacement.
  //   3. Tell the registry, in ONE call that registers the replacement and retires the old
  //      rows. Until this lands the cron is ticking a strategy whose delegation we just revoked
  //      and ignoring the one that now holds the money — a vault that silently stops trading.
  const finishSwap = useCallback(
    async (p: PendingSwap, siblings: VaultRow[]) => {
      setError(null);
      try {
        // Everything the registry still believes is live on this Decibel vault, minus the
        // incoming strategy. Normally that is exactly `fromStrategy`; it is more when an
        // earlier swap was abandoned after its create but before its handover. This drives the
        // registry write only — the on-chain revoke below does not consult it, because the
        // registry is not authoritative about who Decibel thinks is delegated.
        const stale = Array.from(
          new Set(
            [p.fromStrategy, ...siblings.map((v) => v.strategyVaultAddr)]
              .map((a) => a.toLowerCase())
              .filter((a) => a !== p.toStrategy.toLowerCase()),
          ),
        );

        // No address list: revoke EVERY delegation. Naming addresses would only disarm the
        // delegates we happen to know about, and one we missed keeps trading the same
        // subaccount as the replacement — the netting failure in DEPLOY-SEALED §8.5c. The vault
        // is disarmed for the few seconds between this and the delegate below, which is the
        // safe direction to fail in.
        setBusyStep(`${p.decibelVaultAddr}:revoke`);
        const rev = await postJson("/api/sealed/payload", {
          kind: "revoke",
          decibelVaultAddr: p.decibelVaultAddr,
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

        // The chain is now correct. The registry is not, and until it is, this vault is dark:
        // the replacement is not in the tick cron's working set and the strategy that is has no
        // delegation left. Everything above cost a signature; this costs none, so it is worth
        // reporting loudly rather than swallowing.
        setBusyStep(`${p.decibelVaultAddr}:register`);
        const registered = await registerReplacement(p, siblings, stale);
        if (!registered.ok) {
          setError(
            `Trading was handed over on-chain, but the replacement could not be registered ` +
              `(${registered.error}). It will NOT trade until it is — press Activate again.`,
          );
          setBusyStep(null);
          await loadVaults();
          return;
        }

        await clearSwap(p.decibelVaultAddr);
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
    [clearSwap, signAndSubmitTransaction, loadVaults, registerReplacement],
  );

  if (!addr) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "p-6 text-center")}>
        <p className="text-sm text-zinc-400">Connect a wallet to manage your bots.</p>
      </div>
    );
  }

  if (vaults === null) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "flex items-center justify-center gap-2 p-6")}>
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" aria-hidden />
        <span className="text-sm text-zinc-400">Loading your bots…</span>
      </div>
    );
  }

  if (byVault.length === 0) {
    return (
      <div className={cn(SURFACE_CARD_SOLID, "p-6 text-center")}>
        <p className="text-lg font-semibold text-foreground">No bots yet</p>
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

      {byVault.map(({ decibelVaultAddr, rows, current }) => {
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
                detail: ready
                  ? "Two signatures — revoke the old, delegate the new — then the new one " +
                    "starts getting ticked and the old one stops"
                  : undefined,
                state:
                  busyStep?.endsWith("revoke") ||
                  busyStep?.endsWith("delegate") ||
                  busyStep?.endsWith("register")
                    ? "active"
                    : "pending",
              },
            ]
          : [];

        return (
          <section key={decibelVaultAddr} className={cn(SURFACE_CARD_SOLID, "overflow-hidden")}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-foreground">{current.name}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
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
                    "shrink-0 rounded-[var(--radius-sm)] border px-3 py-2 font-display text-[13px] font-semibold transition-colors",
                    activeVault === decibelVaultAddr
                      ? "border-accent/18 bg-accent/10 text-accent"
                      : "border-card-border bg-background-tertiary text-foreground hover:border-accent/16",
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
                        aria-haspopup="dialog"
                        aria-expanded={menuOpen}
                        disabled={busy}
                        className={cn(
                          "flex w-full items-center justify-between rounded-[var(--radius-sm)] border px-3.5 py-3 text-left transition-colors",
                          "border-card-border bg-background-secondary hover:border-accent/16 disabled:opacity-50",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block font-display text-sm font-semibold text-white">
                            {selected.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
                            {selected.category} · {selected.direction} · {selected.blurb}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", menuOpen && "rotate-180")}
                          aria-hidden
                        />
                      </button>
                      <ResponsiveModalSheet
                        open={menuOpen}
                        onClose={() => setMenuOpen(false)}
                        title="Choose replacement strategy"
                        titleId="sealed-swap-strategy-title"
                        initialSnap="mid"
                        desktopMaxWidthClassName="sm:!max-w-lg"
                      >
                        <ul className="space-y-0.5 p-1">
                          {SEALED_CATALOG.map((s: CatalogStrategy) => (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPickId(s.id);
                                  setMenuOpen(false);
                                }}
                                className={cn(
                                  "flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors",
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
                                  <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
                                    {s.category} · {s.direction} · {s.blurb}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </ResponsiveModalSheet>
                    </div>

                    <CodeBlock code={selected.script} filename={`${selected.id}.pine`} maxHeight={160} />

                    <div className={cn(SURFACE_CONTROL, "flex items-start gap-2.5 p-3")}>
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                      <p className="text-xs leading-relaxed text-zinc-300">
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
                  <code className="rounded-[var(--radius-xs)] bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
                    {p.fromStrategy.slice(0, 10)}…
                  </code>
                  <ArrowRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
                  <span className="font-semibold text-white">{p.toLabel}</span>
                </div>

                {gated && !expired && secsLeft > 0 && (
                  <div className={cn(SURFACE_CONTROL, "flex items-center gap-2.5 p-3")}>
                    <Clock className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <div>
                      <p className="font-display text-sm font-semibold text-white">
                        Trading opens in {countdown(secsLeft)}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">
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
                    onClick={() => finishSwap(p, rows)}
                    state={busy ? "pending" : "idle"}
                    disabled={busy || !ready}
                  >
                    {ready ? "Activate new strategy" : `Locked for ${countdown(secsLeft)}`}
                  </ActionButton>
                )}

                <button
                  type="button"
                  onClick={() => void clearSwap(decibelVaultAddr)}
                  className="w-full text-center text-xs text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
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
