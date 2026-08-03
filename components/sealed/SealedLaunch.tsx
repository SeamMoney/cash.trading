"use client";

/**
 * Launch a bot.
 *
 * Two decisions and a button. Pick a strategy (the first one is preselected), keep or edit the
 * name we generated, hit Launch. Visibility defaults to proprietary. Every trading rule has a
 * bound-checked default and lives behind a closed disclosure; when you do open it, the controls
 * are segmented choices, not sliders or free text — there is no number a creator can type here
 * that the chain wouldn't have to reject.
 *
 * Behind that one button are three wallet signatures, and that is the protocol floor, not
 * laziness:
 *
 *   1. `vault_api::create_and_fund_vault`      — the Decibel vault holding depositor capital
 *   2. `sealed_vault::create_sealed_vault`     — the strategy binding, sealed at birth
 *   3. `vault_admin_api::delegate_dex_actions_to` — hands trading to the sealed module, only
 *
 * Steps 1 and 3 are `private entry` on Decibel's package, so no Move module and no transaction
 * script can call them — they must be top-level transactions. And step 2 needs the vault
 * address that only exists once step 1 has landed. The previous version of this file skipped
 * steps 1 and 3 entirely and passed the user's own wallet address where the vault belonged,
 * which would have produced a vault that could never trade.
 *
 * Every step is resumable. If a signature is rejected or a transaction fails, the completed
 * steps are kept and the button restarts from the first incomplete one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, Lock, Globe, Check, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, ThinkingState, TaskList, DataTable, type AgentTask } from "@/components/ui/agent";
import { ActionButton, Banner, Reveal, ValidatedField } from "@/components/ui/interactions";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
import { SURFACE_CARD_SOLID, SURFACE_CONTROL } from "@/lib/surface";

interface SealedConfig {
  packageAddress: string | null;
  attestorPubkey: string | null;
  ready: boolean;
  missing?: string[];
  network: string;
  markets: Array<{ name: string; addr: string }>;
  defaults: {
    pctBps: number;
    maxLeverageX100: number;
    minBarIntervalS: number;
    slippageBps: number;
    performanceFeeBps: number;
  };
  economics: {
    creationFeeUsdc: number;
    minFundingUsdc: number;
    totalLaunchUsdc: number;
    feeIntervalDays: number;
    depositorPaysPct: number;
    creatorKeepsPct: number;
    platformTakesPct: number;
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

interface Preflight {
  subaccountAddr: string;
  usdc: number;
  requiredUsdc: number;
  canLaunch: boolean;
  shortfallUsdc: number;
}

/** Rules the creator may change. Segmented choices only — every value is inside the bounds the
 *  contract enforces, so no selection here can produce a Move abort. */
const ORDER_SIZE_CHOICES = [
  { label: "5%", value: 500 },
  { label: "10%", value: 1000 },
  { label: "25%", value: 2500 },
];
const LEVERAGE_CHOICES = [
  { label: "1x", value: 100 },
  { label: "2x", value: 200 },
  { label: "3x", value: 300 },
];
const CADENCE_CHOICES = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
];
const SEED_CHOICES = [100, 250, 1000];

/** The launch steps, in order. `done` gates resumption. */
type StepId = "commit" | "vault" | "bind" | "delegate";

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

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok && json.ok === true, json };
}

export function SealedLaunch({ onLaunched }: { onLaunched?: () => void }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [config, setConfig] = useState<SealedConfig | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);

  const [strategyId, setStrategyId] = useState(SEALED_CATALOG[0].id);
  const [customPine, setCustomPine] = useState("");
  const [tvUrl, setTvUrl] = useState("");
  const [tvBusy, setTvBusy] = useState(false);
  const [vaultName, setVaultName] = useState(SEALED_CATALOG[0].label);
  const [nameTouched, setNameTouched] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  // Rules — defaults chosen so the common case needs zero interaction.
  const [pctBps, setPctBps] = useState(1000);
  const [maxLeverageX100, setMaxLeverageX100] = useState(200);
  const [minBarIntervalS, setMinBarIntervalS] = useState(60);
  const [seedUsdc, setSeedUsdc] = useState(SEED_CHOICES[0]);
  const [marketName, setMarketName] = useState<string | null>(null);

  // Progress. Each address is the receipt for a completed step, so a retry resumes.
  const [step, setStep] = useState<StepId | null>(null);
  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const [decibelVaultAddr, setDecibelVaultAddr] = useState<string | null>(null);
  const [svAddr, setSvAddr] = useState<string | null>(null);
  const [bindTxHash, setBindTxHash] = useState<string | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [thinkSteps, setThinkSteps] = useState<string[]>([]);

  const busy = step !== null && !delegated;
  const live = delegated && Boolean(svAddr);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/sealed/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const cfg = j as SealedConfig;
        setConfig(cfg);
        setPctBps(cfg.defaults?.pctBps ?? 1000);
        setMaxLeverageX100(cfg.defaults?.maxLeverageX100 ?? 200);
        setMinBarIntervalS(cfg.defaults?.minBarIntervalS ?? 60);
        setSeedUsdc(cfg.economics?.minFundingUsdc ?? 100);
        setMarketName(cfg.markets?.[0]?.name ?? null);
      })
      .catch(() => setConfig(null));
  }, []);

  // Preflight: the one prerequisite we cannot create for the user is USDC sitting in their
  // Decibel subaccount. Check it up front so the cost panel states fact, not requirement.
  const refreshPreflight = useCallback(async () => {
    if (!account) return;
    try {
      const r = await fetch(
        `/api/sealed/decibel-vault?owner=${account.address.toString()}`,
        { cache: "no-store" },
      );
      const j = await r.json();
      if (j.ok) setPreflight(j as Preflight);
    } catch {
      setPreflight(null);
    }
  }, [account]);

  useEffect(() => {
    void refreshPreflight();
  }, [refreshPreflight]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const selected: CatalogStrategy | null = useMemo(
    () => SEALED_CATALOG.find((s) => s.id === strategyId) ?? null,
    [strategyId],
  );
  const usingCustom = customPine.trim().length > 0;
  const effectivePine = usingCustom ? customPine : (selected?.script ?? "");

  /** Name the vault for them. Only overwrite while the field is untouched. */
  const pickStrategy = useCallback(
    (s: CatalogStrategy) => {
      setStrategyId(s.id);
      setMenuOpen(false);
      setCommitInfo(null);
      if (!nameTouched) setVaultName(s.label);
    },
    [nameTouched],
  );

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
      setCommitInfo(null);
      if (!nameTouched) setVaultName(typeof json.title === "string" ? json.title : "My Strategy");
    } catch (err) {
      setError(err instanceof Error ? err.message : "TradingView import failed");
    } finally {
      setTvBusy(false);
    }
  }, [tvUrl, nameTouched]);

  /**
   * The whole launch. Resumable: every completed step is remembered, so pressing the button
   * again after a rejected signature picks up where it stopped rather than paying for the
   * Decibel vault twice.
   */
  const launch = useCallback(async () => {
    setError(null);
    setErrorList([]);

    if (!config?.ready) {
      setError("Sealed vaults aren't configured on this deployment yet.");
      return;
    }
    if (!connected || !account) {
      setError("Connect a wallet first.");
      return;
    }
    const name = vaultName.trim();
    if (!name) {
      setError("Give your bot a name — this is what depositors see.");
      return;
    }

    const creator = account.address.toString();

    try {
      // ── 1. Commit. The source is hashed here and never stored unless you publish it.
      let info = commitInfo;
      if (!info) {
        setStep("commit");
        setThinkSteps([
          "Parsing PineScript",
          "Lowering to intermediate representation",
          "Checking every operation runs on-chain",
          "Emitting Move and hashing the program",
        ]);
        const { ok, json } = await postJson("/api/sealed/commit", {
          pineScript: effectivePine,
          market: marketName ?? undefined,
        });
        if (!ok) {
          setError((json.error as string) ?? "This strategy can't run on-chain.");
          setErrorList(Array.isArray(json.errors) ? (json.errors as string[]) : []);
          setStep(null);
          return;
        }
        info = json as unknown as CommitInfo;
        setCommitInfo(info);
      }

      // ── 2. The Decibel vault. Signature 1 — this is the one that costs money.
      let vault = decibelVaultAddr;
      if (!vault) {
        setStep("vault");
        const { ok, json } = await postJson("/api/sealed/payload", {
          kind: "decibel-vault",
          creatorAddr: creator,
          name,
          description: usingCustom ? undefined : selected?.blurb,
          fundingUsdc: seedUsdc,
        });
        if (!ok) {
          setError((json.error as string) ?? "Could not build the vault transaction");
          setErrorList(Array.isArray(json.errors) ? (json.errors as string[]) : []);
          setStep(null);
          return;
        }
        const tx = await signAndSubmitTransaction({
          data: asTxData(json.payload as Parameters<typeof asTxData>[0]),
        });
        await waitForTransactionConfirmation(tx.hash);

        const found = await fetch(`/api/sealed/decibel-vault?tx=${tx.hash}`).then((r) => r.json());
        if (!found?.decibelVaultAddr) {
          setError(
            `The vault transaction landed (${tx.hash.slice(0, 12)}…) but its address didn't come ` +
              `back. Press Launch again — it will resume without re-creating the vault.`,
          );
          setStep(null);
          return;
        }
        vault = found.decibelVaultAddr as string;
        setDecibelVaultAddr(vault);
      }

      // ── 3. The sealed strategy, bound to that vault. Signature 2.
      //    Sealed at birth: the commitment and every rule are immutable from this transaction.
      let sv = svAddr;
      if (!sv) {
        setStep("bind");
        const { ok, json } = await postJson("/api/sealed/payload", {
          kind: "create",
          programCommitment: info.commitment,
          attestorPubkey: config.attestorPubkey,
          decibelVaultAddr: vault,
          market: info.market.name,
          pctBps,
          maxLeverageX100,
          minBarIntervalS,
          slippageBps: config.defaults.slippageBps,
        });
        if (!ok) {
          setError((json.error as string) ?? "Could not build the strategy transaction");
          setStep(null);
          return;
        }
        const tx = await signAndSubmitTransaction({
          data: asTxData(json.payload as Parameters<typeof asTxData>[0]),
        });
        await waitForTransactionConfirmation(tx.hash);

        const found = await fetch(`/api/sealed/created?tx=${tx.hash}&network=${config.network}`)
          .then((r) => r.json())
          .catch(() => null);
        if (!found?.strategyVaultAddr) {
          setError(
            `The strategy transaction landed (${tx.hash.slice(0, 12)}…) but its address didn't ` +
              `come back. Press Launch again to resume.`,
          );
          setStep(null);
          return;
        }
        sv = found.strategyVaultAddr as string;
        setSvAddr(sv);
        setBindTxHash(tx.hash);
      }

      // ── 4. Delegation. Signature 3 — until this lands the vault cannot place an order.
      //    It is deliberately last: nothing before it grants any trading authority.
      setStep("delegate");
      const { ok, json } = await postJson("/api/sealed/payload", {
        kind: "delegate",
        strategyVaultAddr: sv,
        decibelVaultAddr: vault,
      });
      if (!ok) {
        setError((json.error as string) ?? "Could not build the delegation transaction");
        setStep(null);
        return;
      }
      const tx = await signAndSubmitTransaction({
        data: asTxData(json.payload as Parameters<typeof asTxData>[0]),
      });
      await waitForTransactionConfirmation(tx.hash);
      setDelegated(true);

      // Register for the feed. A failure here costs nothing on-chain — the vault is already
      // live and every field below is re-read from chain by the detail route anyway.
      await postJson("/api/sealed/vaults", {
        strategyVaultAddr: sv,
        packageAddress: config.packageAddress,
        network: config.network,
        creatorAddr: creator,
        decibelVaultAddr: vault,
        programCommitment: info.commitment,
        attestorPubkey: config.attestorPubkey,
        manifestJson: info.manifestJson,
        market: info.market.name,
        name,
        description: usingCustom ? undefined : selected?.blurb,
        pctBps,
        maxLeverageX100,
        minBarIntervalS,
        sealed: true,
        // Create and seal are the same transaction now — the vault is sealed at birth.
        createTxHash: bindTxHash,
        sealTxHash: bindTxHash,
        // Only sent when the creator chose Public. The server re-hashes it against the
        // commitment and refuses to publish a source that doesn't match.
        revealedPine: isPrivate ? undefined : effectivePine,
      }).catch(() => undefined);

      setStep(null);
      void refreshPreflight();
      onLaunched?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Launch failed";
      setError(
        /reject|denied|cancel/i.test(msg)
          ? "You rejected the signature. Nothing was lost — press Launch to resume from here."
          : msg,
      );
      setStep(null);
    }
  }, [
    config, connected, account, vaultName, effectivePine, usingCustom, selected, isPrivate,
    commitInfo, decibelVaultAddr, svAddr, bindTxHash, marketName, seedUsdc, pctBps,
    maxLeverageX100, minBarIntervalS,
    signAndSubmitTransaction, onLaunched, refreshPreflight,
  ]);

  // ── Task states ────────────────────────────────────────────────────────────
  const ORDER: StepId[] = ["commit", "vault", "bind", "delegate"];
  const doneThrough = delegated
    ? 4
    : svAddr
      ? 3
      : decibelVaultAddr
        ? 2
        : commitInfo
          ? 1
          : 0;
  const stateFor = (id: StepId): AgentTask["state"] => {
    const i = ORDER.indexOf(id);
    if (i < doneThrough) return "done";
    if (step === id) return "active";
    if (error && i === doneThrough) return "failed";
    return "pending";
  };
  const tasks: AgentTask[] = [
    { id: "commit", label: "Hash the strategy", detail: commitInfo?.commitment, state: stateFor("commit") },
    { id: "vault", label: "Create the Decibel vault", detail: decibelVaultAddr ?? "Signature 1 — pays the 100 USDC protocol fee and seeds the vault", state: stateFor("vault") },
    { id: "bind", label: "Seal the strategy on-chain", detail: svAddr ?? "Signature 2 — freezes the commitment and every rule, permanently", state: stateFor("bind") },
    { id: "delegate", label: "Hand trading to the sealed module", detail: delegated ? "Delegated" : "Signature 3 — the only thing that can place an order for this vault", state: stateFor("delegate") },
  ];

  const started = doneThrough > 0;
  const buttonLabel = live
    ? "Live"
    : started
      ? `Resume launch (step ${doneThrough + 1} of 4)`
      : "Launch bot";

  const explorerBase =
    config?.network === "mainnet"
      ? "https://explorer.aptoslabs.com/object"
      : "https://explorer.aptoslabs.com/object";
  const explorerSuffix = `?network=${config?.network ?? "testnet"}`;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 1 — Strategy */}
      <section>
        <Label n={1}>Pick a strategy</Label>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy || usingCustom}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className={cn(
              "flex w-full items-center justify-between rounded-[16px] border px-4 py-3 text-left transition-colors",
              "border-white/[0.06] bg-[#141414] hover:border-accent/40 disabled:opacity-50",
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
                className="absolute z-30 mt-1.5 max-h-[320px] w-full overflow-y-auto rounded-[16px] border border-white/[0.06] bg-[#141414] p-1 shadow-2xl"
              >
                {SEALED_CATALOG.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={s.id === strategyId}
                      onClick={() => pickStrategy(s)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-left transition-colors",
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

        {!usingCustom && selected && (
          <div className="mt-2">
            <CodeBlock code={selected.script} filename={`${selected.id}.pine`} maxHeight={200} />
          </div>
        )}

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
                className="shrink-0 rounded-[10px] border border-white/[0.06] bg-[#1a1a1a] px-3 py-2 font-display text-[12px] font-semibold text-white transition-colors hover:border-accent/50 disabled:opacity-40"
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
              className="w-full resize-y rounded-[10px] border border-white/[0.06] bg-[#0d0d0d] p-3 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none"
            />
          </div>
        </details>
      </section>

      {/* 2 — Name (prefilled) */}
      <section>
        <Label n={2}>Name your bot</Label>
        <ValidatedField
          label=""
          value={vaultName}
          onChange={(v) => {
            setNameTouched(true);
            setVaultName(v);
          }}
          placeholder="Momentum Alpha"
          disabled={busy}
          validate={(v) => (v.trim() ? null : "Depositors see this name — give your bot one.")}
        />
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Named after your strategy by default. Depositors see the name — never your source.
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

      {/* What it costs */}
      {config && (
        <section className={cn(SURFACE_CARD_SOLID, "p-4")}>
          <h3 className="font-display text-[13px] font-semibold text-white">What it costs</h3>
          <dl className="mt-3 space-y-2">
            <FeeRow
              k="Decibel's vault-creation fee"
              v={`${config.economics.creationFeeUsdc} USDC`}
              note="Charged once by the protocol. Not ours."
            />
            <FeeRow
              k="You seed the vault"
              v={`${seedUsdc} USDC`}
              note="Stays yours — it's the vault's starting capital."
            />
            <FeeRow
              k="Depositors pay on profits"
              v={`${config.economics.depositorPaysPct}%`}
              note={`You keep ${config.economics.creatorKeepsPct}% · platform takes ${config.economics.platformTakesPct}%. Only on gains.`}
              highlight
            />
          </dl>
          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
            <p className="text-[10px] leading-snug text-zinc-600">
              Needed in your Decibel account to launch:{" "}
              <span className="text-zinc-400">
                {config.economics.creationFeeUsdc + seedUsdc} USDC
              </span>
              . Decibel caps profit share at {config.economics.depositorPaysPct}% — ours comes out
              of that, never on top, so the number depositors see is the number they pay.
            </p>
            {preflight && (
              <p
                className={cn(
                  "mt-1.5 text-[10px] leading-snug",
                  preflight.usdc >= config.economics.creationFeeUsdc + seedUsdc
                    ? "text-accent"
                    : "text-amber-400",
                )}
              >
                {preflight.usdc >= config.economics.creationFeeUsdc + seedUsdc
                  ? `You have ${preflight.usdc.toFixed(2)} USDC available. Ready to launch.`
                  : `You have ${preflight.usdc.toFixed(2)} USDC available — deposit ${(
                      config.economics.creationFeeUsdc + seedUsdc - preflight.usdc
                    ).toFixed(2)} more to your Decibel account first.`}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Custom settings — closed by default; segmented choices only */}
      <details className={cn(SURFACE_CARD_SOLID, "overflow-hidden")}>
        <summary className="cursor-pointer list-none px-4 py-3 font-display text-[12px] font-semibold text-zinc-400 transition-colors hover:text-white">
          Custom settings
          <span className="ml-2 font-normal text-zinc-600">optional — sensible defaults applied</span>
        </summary>
        <div className="space-y-3 border-t border-white/[0.06] px-4 py-3.5">
          <Segmented
            label="Order size"
            hint="Notional per order, as a share of vault NAV."
            options={ORDER_SIZE_CHOICES}
            value={pctBps}
            onChange={setPctBps}
            disabled={busy}
          />
          <Segmented
            label="Max leverage"
            hint="Hard cap the contract enforces on notional ÷ NAV."
            options={LEVERAGE_CHOICES}
            value={maxLeverageX100}
            onChange={setMaxLeverageX100}
            disabled={busy}
          />
          <Segmented
            label="Trade cadence"
            hint="Minimum time between bars the vault will act on."
            options={CADENCE_CHOICES}
            value={minBarIntervalS}
            onChange={setMinBarIntervalS}
            disabled={busy}
          />
          <Segmented
            label="Seed capital"
            hint="Your own USDC that starts the vault. You keep it."
            options={SEED_CHOICES.map((v) => ({ label: `${v} USDC`, value: v }))}
            value={seedUsdc}
            onChange={setSeedUsdc}
            disabled={busy}
          />
          {config && config.markets.length > 1 && (
            <Segmented
              label="Market"
              hint="The perp market this vault trades."
              options={config.markets.map((m) => ({ label: m.name, value: m.name }))}
              value={marketName ?? config.markets[0].name}
              onChange={(m) => {
                setMarketName(m);
                setCommitInfo(null);
              }}
              disabled={busy}
            />
          )}
          <p className="border-t border-white/[0.06] pt-2.5 text-[10px] leading-snug text-zinc-600">
            Every value here is inside the range the contract accepts, and all of them are frozen
            the moment your bot goes live. Slippage is fixed at{" "}
            {(config?.defaults.slippageBps ?? 30) / 100}% and the fee interval at{" "}
            {config?.economics.feeIntervalDays ?? 30} days — both are protocol floors, not choices.
          </p>
        </div>
      </details>

      {/* Live pipeline */}
      <AnimatePresence>
        {(busy || started) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3 overflow-hidden"
          >
            {step === "commit" && (
              <ThinkingState label="Compiling your strategy" steps={thinkSteps} />
            )}
            <TaskList tasks={tasks} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transpiler result */}
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
                caption="This hash is your strategy's on-chain identity. The source itself never leaves your browser session unless you chose Public."
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
            {started && !live && (
              <span className="mt-2 block text-[11px] leading-snug text-red-300/70">
                {doneThrough >= 2
                  ? "Your Decibel vault already exists and its funds are safe — resuming will not create a second one."
                  : "Nothing has been spent yet."}
              </span>
            )}
          </Banner>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {live && svAddr && (
          <Banner tone="success">
            <span className="block font-semibold">Your bot is live and trading.</span>
            <span className="mt-1.5 block text-[11px] leading-snug text-zinc-400">
              The sealed module is now the only account that can place an order for this vault.
            </span>
            <span className="mt-2 flex flex-col gap-1">
              <ExplorerLink label="Strategy" addr={svAddr} base={explorerBase} suffix={explorerSuffix} />
              {decibelVaultAddr && (
                <ExplorerLink label="Vault" addr={decibelVaultAddr} base={explorerBase} suffix={explorerSuffix} />
              )}
            </span>
          </Banner>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {config && !config.ready && (
          <Banner tone="warn">
            <span className="block font-semibold">Not deployable on this environment yet</span>
            <span className="mt-1 block leading-snug">
              The sealed-vault contract hasn&apos;t been published to{" "}
              <span className="font-mono">{config.network}</span> yet, so there&apos;s nothing to
              deploy into. Everything above still works — pick a strategy, see its program hash
              and costs.
            </span>
            {config.missing && config.missing.length > 0 && (
              <span className="mt-2 block">
                <span className="block text-[10px] uppercase tracking-wide text-amber-500/70">
                  Missing configuration
                </span>
                {config.missing.map((m) => (
                  <span key={m} className="mt-0.5 block font-mono text-[10px] text-amber-300/90">
                    {m}
                  </span>
                ))}
                <span className="mt-1.5 block text-[10px] leading-snug text-zinc-500">
                  Publish with{" "}
                  <span className="font-mono text-zinc-400">
                    pnpm sealed:e2e run --network {config.network}
                  </span>
                  , then set the values it prints. See docs/SEALED-INDICATOR.md §8.
                </span>
              </span>
            )}
          </Banner>
        )}
      </AnimatePresence>

      <ActionButton
        onClick={launch}
        state={busy ? "pending" : live ? "success" : error ? "error" : "idle"}
        successLabel="Live"
        errorLabel={started ? `Resume launch (step ${doneThrough + 1} of 4)` : "Try again"}
        disabled={live || !config?.ready}
      >
        {buttonLabel}
      </ActionButton>

      {!started && config?.ready && (
        <p className="-mt-2 text-center text-[10px] leading-snug text-zinc-600">
          Three wallet signatures: create the vault, seal the strategy, hand it trading rights.
          Decibel requires each to be its own transaction.
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-[10px] border border-white/[0.06] bg-[#0d0d0d] px-3 py-2.5 text-[13px] text-white placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none disabled:opacity-50";

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/[0.08] text-[9px] font-bold text-zinc-400">
        {n}
      </span>
      <span className="font-display text-[13px] font-semibold text-white">{children}</span>
    </div>
  );
}

/** Segmented choice. Replaces every slider and number input in this flow — the set of legal
 *  values is small and known, so picking from it is both faster and impossible to get wrong. */
function Segmented<T extends string | number>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-display text-[12px] font-semibold text-white">{label}</span>
        <span className="text-right text-[10px] leading-snug text-zinc-600">{hint}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(SURFACE_CONTROL, "flex gap-1 p-1")}
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-[7px] px-2 py-1.5 font-mono text-[11px] tabular-nums transition-colors disabled:opacity-50",
              o.value === value
                ? "bg-accent/15 text-accent"
                : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
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
        "rounded-[16px] border p-3 text-left transition-all disabled:opacity-50",
        active ? "border-accent/50 bg-accent/[0.06]" : "border-white/[0.06] bg-[#141414] hover:border-white/20",
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

function ExplorerLink({
  label, addr, base, suffix,
}: { label: string; addr: string; base: string; suffix: string }) {
  return (
    <a
      href={`${base}/${addr}${suffix}`}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 text-[10px] text-zinc-500 transition-colors hover:text-accent"
    >
      <span className="w-12 shrink-0 uppercase tracking-wide">{label}</span>
      <span className="truncate font-mono">{addr}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </a>
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
