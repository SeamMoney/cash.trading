"use client";

/**
 * Launch a bot — the whole creator flow in three decisions.
 *
 * Deliberately minimal. The previous version asked for a Decibel vault address,
 * a 32-byte attestor public key, and three sliders before you could do anything;
 * none of that is a creator's decision. The attestor key is platform-managed,
 * the vault is created for you, and every rule has a bound-checked default that
 * only appears if you go looking for it.
 *
 * What you actually choose: which strategy, what to call it, and whether the
 * source stays private.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, Lock, Globe, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, ThinkingState, TaskList, DataTable, type AgentTask } from "@/components/ui/agent";
import { ActionButton, Banner, Reveal, ValidatedField, AnimatedNumber } from "@/components/ui/interactions";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
import { DECIBEL_VAULT_LIMITS, computeFeeBreakdown, launchCostUsdc } from "@/lib/vault-economics";

interface SealedConfig {
  packageAddress: string | null;
  attestorPubkey: string | null;
  ready: boolean;
  network: string;
  markets: Array<{ name: string; addr: string }>;
  defaults: {
    pctBps: number;
    maxLeverageX100: number;
    minBarIntervalS: number;
    slippageBps: number;
    performanceFeeBps: number;
  };
}

interface CommitInfo {
  commitment: string;
  manifestJson: string;
  moduleName: string;
  warmupBars: number;
  warnings: string[];
  market: { name: string; addr: string };
}

type Phase = "idle" | "committing" | "creating" | "delegating" | "sealing" | "live";

function asTxData(payload: {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
}) {
  return {
    function: payload.function as `${string}::${string}::${string}`,
    typeArguments: payload.typeArguments,
    functionArguments: payload.functionArguments as (string | number | boolean)[],
  };
}

export function SealedLaunch({ onLaunched }: { onLaunched?: () => void }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [config, setConfig] = useState<SealedConfig | null>(null);
  const [strategyId, setStrategyId] = useState(SEALED_CATALOG[0].id);
  const [customPine, setCustomPine] = useState("");
  const [tvUrl, setTvUrl] = useState("");
  const [tvBusy, setTvBusy] = useState(false);
  const [vaultName, setVaultName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const [svAddr, setSvAddr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [thinkSteps, setThinkSteps] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/sealed/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setConfig(j as SealedConfig))
      .catch(() => setConfig(null));
  }, []);

  const selected: CatalogStrategy | null = useMemo(
    () => SEALED_CATALOG.find((s) => s.id === strategyId) ?? null,
    [strategyId],
  );
  const fees = useMemo(() => computeFeeBreakdown(), []);
  const usingCustom = customPine.trim().length > 0;
  const effectivePine = usingCustom ? customPine : (selected?.script ?? "");

  const importTradingView = useCallback(async () => {
    if (!tvUrl.trim()) return;
    setError(null);
    setTvBusy(true);
    try {
      const res = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(tvUrl.trim())}`);
      const json = await res.json();
      if (!res.ok || !json.script) {
        setError(json.error ?? "Could not read that TradingView script. Paste the source instead.");
        return;
      }
      setCustomPine(json.script);
      setStatus("Imported from TradingView.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "TradingView import failed");
    } finally {
      setTvBusy(false);
    }
  }, [tvUrl]);

  /** One button: commit → create vault → delegate → seal. */
  const launch = useCallback(async () => {
    setError(null);
    setErrorList([]);
    setStatus(null);

    if (!config?.ready) {
      setError("Sealed vaults aren't configured on this deployment yet.");
      return;
    }
    if (!connected || !account) {
      setError("Connect a wallet first.");
      return;
    }
    if (!vaultName.trim()) {
      setError("Give your bot a name — this is what depositors see.");
      return;
    }

    try {
      // 1. Commit — the source is hashed server-side and never stored.
      setPhase("committing");
      setStatus("Hashing your strategy…");
      setThinkSteps([
        "Parsing PineScript",
        "Lowering to intermediate representation",
        "Checking every operation runs on-chain",
        "Emitting Move and hashing the program",
      ]);
      const commitRes = await fetch("/api/sealed/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pineScript: effectivePine }),
      });
      const commitJson = await commitRes.json();
      if (!commitRes.ok || !commitJson.ok) {
        setError(commitJson.error ?? "This strategy can't run on-chain.");
        setErrorList(Array.isArray(commitJson.errors) ? commitJson.errors : []);
        setPhase("idle");
        return;
      }
      const info = commitJson as CommitInfo;
      setCommitInfo(info);

      // 2. Create the sealed vault object.
      setPhase("creating");
      setStatus("Deploying your bot on-chain…");
      const payloadRes = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "create",
          programCommitment: info.commitment,
          attestorPubkey: config.attestorPubkey,
          decibelVaultAddr: account.address.toString(),
          market: info.market.name,
          ...config.defaults,
        }),
      });
      const payloadJson = await payloadRes.json();
      if (!payloadRes.ok || !payloadJson.ok) {
        setError(payloadJson.error ?? "Could not build the deploy transaction");
        setPhase("idle");
        return;
      }
      const created = await signAndSubmitTransaction({ data: asTxData(payloadJson.payload) });
      await waitForTransactionConfirmation(created.hash);

      const lookup = await fetch(`/api/sealed/created?tx=${created.hash}`)
        .then((r) => r.json())
        .catch(() => null);
      const addr = lookup?.strategyVaultAddr as string | undefined;
      if (!addr) {
        setError(`Deployed (tx ${created.hash.slice(0, 12)}…) but the vault address didn't come back.`);
        setPhase("idle");
        return;
      }
      setSvAddr(addr);

      // 3. Seal — freezes the commitment and every rule, one-way.
      setPhase("sealing");
      setStatus("Sealing — locking the rules permanently…");
      const sealRes = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "seal", strategyVaultAddr: addr }),
      });
      const sealJson = await sealRes.json();
      if (sealRes.ok && sealJson.ok) {
        const sealed = await signAndSubmitTransaction({ data: asTxData(sealJson.payload) });
        await waitForTransactionConfirmation(sealed.hash);

        await fetch("/api/sealed/vaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyVaultAddr: addr,
            packageAddress: config.packageAddress,
            network: config.network,
            creatorAddr: account.address.toString(),
            decibelVaultAddr: account.address.toString(),
            programCommitment: info.commitment,
            attestorPubkey: config.attestorPubkey,
            manifestJson: info.manifestJson,
            market: info.market.name,
            name: vaultName.trim(),
            description: usingCustom ? undefined : selected?.blurb,
            pctBps: config.defaults.pctBps,
            maxLeverageX100: config.defaults.maxLeverageX100,
            minBarIntervalS: config.defaults.minBarIntervalS,
            sealed: true,
            sealTxHash: sealed.hash,
            createTxHash: created.hash,
            revealedPine: isPrivate ? undefined : effectivePine,
          }),
        });
      }

      setPhase("live");
      setStatus("Your bot is live.");
      onLaunched?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setPhase("idle");
    }
  }, [
    config, connected, account, vaultName, effectivePine, usingCustom, selected,
    isPrivate, signAndSubmitTransaction, onLaunched,
  ]);

  const busy = phase !== "idle" && phase !== "live";

  const order: Phase[] = ["committing", "creating", "sealing", "live"];
  const stateFor = (p: Phase): AgentTask["state"] => {
    if (error && phase === "idle") return "pending";
    const cur = order.indexOf(phase);
    const mine = order.indexOf(p);
    if (phase === "live") return "done";
    if (cur < 0) return "pending";
    return mine < cur ? "done" : mine === cur ? "active" : "pending";
  };
  const tasks: AgentTask[] = [
    { id: "commit", label: "Hash the strategy", detail: commitInfo?.commitment, state: stateFor("committing") },
    { id: "create", label: "Deploy the vault on-chain", detail: svAddr ?? undefined, state: stateFor("creating") },
    { id: "seal", label: "Seal the rules permanently", state: stateFor("sealing") },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 1 — Strategy */}
      <section>
        <Label n={1}>Pick a strategy</Label>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy || usingCustom}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className={cn(
              "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
              "border-[#2a2a2a] bg-[#141414] hover:border-accent/40 disabled:opacity-50",
              menuOpen && "border-accent/60",
            )}
          >
            <span>
              <span className="block font-display text-[14px] font-semibold text-white">
                {usingCustom ? "Your own strategy" : (selected?.label ?? "Select…")}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {usingCustom
                  ? "Pasted source — used instead of the list"
                  : (selected?.blurb ?? "")}
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
              initial={{ opacity: 0, y: -6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.985 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="absolute z-30 mt-1.5 max-h-[320px] w-full overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#141414] p-1 shadow-2xl"
            >
              {SEALED_CATALOG.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.id === strategyId}
                    onClick={() => {
                      setStrategyId(s.id);
                      setMenuOpen(false);
                      setCommitInfo(null);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                      s.id === strategyId ? "bg-accent/10" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        s.id === strategyId ? "text-accent" : "text-transparent",
                      )}
                      aria-hidden
                    />
                    <span>
                      <span className="block font-display text-[13px] font-semibold text-white">
                        {s.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        {s.blurb}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
          </AnimatePresence>
        </div>

        {/* The actual source, in a proper code block */}
        {!usingCustom && selected && (
          <div className="mt-2">
            <CodeBlock
              code={selected.script}
              filename={`${selected.id}.pine`}
              maxHeight={200}
            />
          </div>
        )}

        {/* Or bring your own */}
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">
            <span className="underline underline-offset-2">Use your own TradingView script instead</span>
          </summary>
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                value={tvUrl}
                onChange={(e) => setTvUrl(e.target.value)}
                placeholder="https://www.tradingview.com/script/…"
                disabled={busy}
                className={inputCls}
              />
              <button
                type="button"
                onClick={importTradingView}
                disabled={busy || tvBusy || !tvUrl.trim()}
                className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 font-display text-[12px] font-semibold text-white transition-colors hover:border-accent/50 disabled:opacity-40"
              >
                {tvBusy ? "…" : "Import"}
              </button>
            </div>
            <textarea
              value={customPine}
              onChange={(e) => {
                setCustomPine(e.target.value);
                setCommitInfo(null);
              }}
              disabled={busy}
              spellCheck={false}
              rows={6}
              aria-label="PineScript source"
              placeholder="…or paste the PineScript source here"
              className="w-full resize-y rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none"
            />
          </div>
        </details>
      </section>

      {/* 2 — Name */}
      <section>
        <Label n={2}>Name your bot</Label>
        <ValidatedField
          label=""
          value={vaultName}
          onChange={setVaultName}
          placeholder="Momentum Alpha"
          disabled={busy}
          validate={(v) => (v.trim() ? null : "Depositors see this name — give your bot one.")}
        />
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Deposits go into a vault under this name. Depositors see the name — never your strategy.
        </p>
      </section>

      {/* 3 — Visibility */}
      <section>
        <Label n={3}>Keep it private?</Label>
        <div className="grid grid-cols-2 gap-2">
          <VisibilityCard
            active={isPrivate}
            onClick={() => setIsPrivate(true)}
            disabled={busy}
            icon={<Lock className="h-3.5 w-3.5" aria-hidden />}
            title="Proprietary"
            body="Only a hash goes on-chain. Nobody can read your alpha — you can reveal it later to prove every trade."
          />
          <VisibilityCard
            active={!isPrivate}
            onClick={() => setIsPrivate(false)}
            disabled={busy}
            icon={<Globe className="h-3.5 w-3.5" aria-hidden />}
            title="Public"
            body="Source published alongside the vault. Anyone can verify every trade against it immediately."
          />
        </div>
      </section>

      {/* What it costs — the one thing every creator asks first */}
      <section className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
        <h3 className="font-display text-[13px] font-semibold text-white">What it costs</h3>
        <dl className="mt-3 space-y-2">
          <FeeRow
            k="You pay once, to Decibel"
            v={`${DECIBEL_VAULT_LIMITS.creationFeeUsdc} USDC`}
            note="Protocol vault-creation fee. Not ours."
          />
          <FeeRow
            k="You seed the vault"
            v={`${DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc} USDC min`}
            note="Stays yours — it's the vault's starting capital."
          />
          <FeeRow
            k="Depositors pay on profits"
            v={`${fees.depositorPaysPct}%`}
            note={`You keep ${fees.creatorKeepsPct}% · platform takes ${fees.platformTakesPct}%. Only on gains.`}
            highlight
          />
        </dl>
        <p className="mt-3 border-t border-[#2a2a2a] pt-2.5 text-[10px] leading-snug text-zinc-600">
          Upfront to launch: <span className="text-zinc-400">{launchCostUsdc(DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc)} USDC</span>.
          Decibel caps profit share at {DECIBEL_VAULT_LIMITS.maxFeeBps / 100}% — ours comes out of that,
          never on top, so the number depositors see is the number they pay.
        </p>
      </section>

      {/* Advanced — collapsed; the chain bounds all of these anyway */}
      <details
        className="rounded-xl border border-[#2a2a2a] bg-[#141414]"
        onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none px-4 py-3 font-display text-[12px] font-semibold text-zinc-400 transition-colors hover:text-white">
          Trading rules {showAdvanced ? "−" : "+"}
        </summary>
        <dl className="grid grid-cols-2 gap-3 border-t border-[#2a2a2a] px-4 py-3 sm:grid-cols-3">
          <Setting k="Order size" v={`${(config?.defaults.pctBps ?? 1000) / 100}% of NAV`} />
          <Setting k="Max leverage" v={`${(config?.defaults.maxLeverageX100 ?? 200) / 100}x`} />
          <Setting k="Trade cadence" v={`≤1 per ${config?.defaults.minBarIntervalS ?? 60}s`} />
          <Setting k="Slippage cap" v={`${(config?.defaults.slippageBps ?? 30) / 100}%`} />
          <Setting k="Fee interval" v={`${DECIBEL_VAULT_LIMITS.minFeeIntervalS / 86400} days`} />
          <Setting k="Market" v={config?.markets[0]?.name ?? "BTC/USD"} />
        </dl>
        <p className="px-4 pb-3 text-[10px] leading-snug text-zinc-600">
          Enforced by the contract and frozen when your bot goes live.
        </p>
      </details>

      {/* Live pipeline — visible only once the user commits to launching */}
      <AnimatePresence>
        {(busy || phase === "live") && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3 overflow-hidden"
          >
            {phase === "committing" && (
              <ThinkingState label="Compiling your strategy" steps={thinkSteps} />
            )}
            <TaskList tasks={tasks} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transpiler result — the code the chain will be bound to */}
      <AnimatePresence>
        {commitInfo && (
          <Reveal>
            <div className="space-y-2">
              <DataTable
                columns={["Compiled", "Value"]}
                rows={[
                  ["Program hash", <span key="h" className="text-accent">{commitInfo.commitment}</span>],
                  ["Module", commitInfo.moduleName],
                  ["Market", commitInfo.market.name],
                  ["Warm-up", `${commitInfo.warmupBars} bars`],
                ]}
                caption="This hash is your strategy's on-chain identity. The source itself never leaves your browser session."
              />
              {commitInfo.warnings.length > 0 && (
                <Banner tone="warn">
                  {commitInfo.warnings.map((w) => (
                    <span key={w} className="block">{w}</span>
                  ))}
                </Banner>
              )}
            </div>
          </Reveal>
        )}
      </AnimatePresence>

      {/* Errors */}
      <AnimatePresence>
        {error && (
          <Banner tone="error" onDismiss={() => { setError(null); setErrorList([]); }}>
            <span className="block font-semibold">{error}</span>
            {errorList.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {errorList.map((e) => (
                  <li key={e} className="text-[11px] leading-snug text-red-300/80">• {e}</li>
                ))}
              </ul>
            )}
          </Banner>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "live" && svAddr && (
          <Banner tone="success">
            <span className="block font-semibold">Your bot is live.</span>
            <span className="mt-1 block break-all font-mono text-[10px] text-zinc-400">{svAddr}</span>
          </Banner>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {config && !config.ready && (
          <Banner tone="warn">
            Sealed vaults aren&apos;t configured on this deployment yet — the contract address and
            attestor key still need to be set. You can build and preview a bot, but not deploy one.
          </Banner>
        )}
      </AnimatePresence>

      <ActionButton
        onClick={launch}
        state={busy ? "pending" : phase === "live" ? "success" : error ? "error" : "idle"}
        successLabel="Live"
        errorLabel="Try again"
        disabled={phase === "live" || !config?.ready}
      >
        Launch bot
      </ActionButton>

    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2.5 text-[13px] text-white placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none disabled:opacity-50";

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2a2a2a] text-[9px] font-bold text-zinc-400">
        {n}
      </span>
      <span className="font-display text-[13px] font-semibold text-white">{children}</span>
    </div>
  );
}

function VisibilityCard({
  active, onClick, disabled, icon, title, body,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-3 text-left transition-all disabled:opacity-50",
        active ? "border-accent/50 bg-accent/[0.06]" : "border-[#2a2a2a] bg-[#141414] hover:border-white/20",
      )}
    >
      <span className={cn("flex items-center gap-1.5", active ? "text-accent" : "text-zinc-400")}>
        {icon}
        <span className="font-display text-[12px] font-semibold">{title}</span>
      </span>
      <span className="mt-1 block text-[10px] leading-snug text-zinc-500">{body}</span>
    </button>
  );
}

function FeeRow({
  k, v, note, highlight,
}: { k: string; v: string; note: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <dt className={cn("text-[12px]", highlight ? "font-semibold text-white" : "text-zinc-300")}>{k}</dt>
        <dd className="mt-0.5 text-[10px] leading-snug text-zinc-600">{note}</dd>
      </div>
      <span
        className={cn(
          "shrink-0 font-mono text-[13px] tabular-nums",
          highlight ? "text-accent" : "text-zinc-300",
        )}
      >
        {v}
      </span>
    </div>
  );
}

function Setting({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-zinc-600">{k}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-zinc-300">{v}</dd>
    </div>
  );
}
