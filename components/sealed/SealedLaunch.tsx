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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, Lock, Globe, Check, ExternalLink, Zap, Server } from "lucide-react";

import { cn } from "@/lib/utils";
import { ThinkingState, TaskList, DataTable, type AgentTask } from "@/components/ui/agent";
import { ActionButton, Banner, Reveal } from "@/components/ui/interactions";
import {
  PRODUCT_CONTROL_CLASS,
  PRODUCT_PRESSABLE_CLASS,
  ProductPanel,
  ProductSection,
  ProductSegmented,
  ProductSelectorButton,
} from "@/components/ui/product-surface";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { requestedLeverageX100, requestedPctBps } from "@/lib/pine-declarations";
import { SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
import { SURFACE_CARD_SOLID } from "@/lib/surface";
import { PineVisualPreview } from "@/components/launchpad/PineVisualPreview";
import { StrategySourceEditor } from "@/components/launchpad/StrategySourceEditor";
import {
  PineMarketplace,
  type PineMarketplaceSelection,
} from "@/components/launchpad/PineMarketplace";
import { MarketPermissionsModal } from "@/components/launchpad/MarketPermissionsModal";
import { SealedBacktest } from "@/components/sealed/SealedBacktest";
import {
  MarketLogo,
  apiMarketToMarket,
  isPerpApiMarket,
  type DecibelApiMarket,
  type Market,
} from "@/components/trade/BTCChart";

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
  portfolioDefaults?: {
    maxPctBps: number;
    maxLeverageX100: number;
    maxPortfolioLeverageX100: number;
    maxPositions: number;
    maxHoldBars: number;
    maxAdverseFundingBps: number;
  };
  economics: {
    creationFeeUsdc: number;
    minFundingUsdc: number;
    feeIntervalDays: number;
    launchFeeUsdc: number;
    builderFeeBps: number;
    termsOnChain: boolean;
    subaccountUsdc: number;
    walletUsdc: number;
    totalUsdc: number;
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
  /** Deployable USDC in the Decibel subaccount — pays Decibel's fee and the seed. */
  usdc: number;
  /** USDC in the wallet's primary store — pays OUR launch fee. A different pot. */
  walletUsdc: number;
  requiredSubaccountUsdc: number;
  requiredWalletUsdc: number;
  canLaunch: boolean;
  shortfallSubaccountUsdc: number;
  shortfallWalletUsdc: number;
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
const LAUNCH_STEPS: readonly StepId[] = ["commit", "vault", "bind", "delegate"];

function asTxData(payload: {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
}) {
  return {
    function: payload.function as `${string}::${string}::${string}`,
    typeArguments: payload.typeArguments,
    // `vector<u8>` arguments arrive as number[] — the server encodes them that way because a
    // hex string would be serialized as its UTF-8 bytes and a Uint8Array would not survive
    // JSON. Do not narrow this to (string | number | boolean)[].
    functionArguments: payload.functionArguments as Array<
      string | number | boolean | number[]
    >,
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
  const reducedMotion = useReducedMotion();

  const [config, setConfig] = useState<SealedConfig | null>(null);
  const [preflight, setPreflight] = useState<Preflight | null>(null);

  const [strategyId, setStrategyId] = useState(SEALED_CATALOG[0].id);
  const [customPine, setCustomPine] = useState("");
  const [importedScript, setImportedScript] = useState<PineMarketplaceSelection | null>(null);
  const [editingSource, setEditingSource] = useState(false);
  const [tvUrl, setTvUrl] = useState("");
  const [tvBusy, setTvBusy] = useState(false);
  const [vaultName, setVaultName] = useState(SEALED_CATALOG[0].label);
  const nameTouched = useRef(false);
  const [isPrivate, setIsPrivate] = useState(true);
  // Default ON: a bot nobody runs is not a bot. The trade-off is stated in full below.
  const [managed, setManaged] = useState(true);

  // Rules — defaults chosen so the common case needs zero interaction.
  const [pctBps, setPctBps] = useState(1000);
  const [maxLeverageX100, setMaxLeverageX100] = useState(200);
  const [minBarIntervalS, setMinBarIntervalS] = useState(60);
  const [seedUsdc, setSeedUsdc] = useState(SEED_CHOICES[0]);
  // A LIST, not one market. Selecting a second market is what turns this into a portfolio
  // vault — there is no separate mode switch, because "which markets" and "single or
  // portfolio" are the same question asked twice.
  const [markets, setMarkets] = useState<string[]>([]);
  const [marketOptions, setMarketOptions] = useState<Market[]>([]);
  const [marketOptionsLoading, setMarketOptionsLoading] = useState(true);
  const [previewMarket, setPreviewMarket] = useState("BTC/USD");
  const [marketAccessOpen, setMarketAccessOpen] = useState(false);
  const workbenchRef = useRef<HTMLDivElement>(null);

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
  /** Two or more markets means the portfolio module, with its own bounds and guarantees. */
  const isPortfolio = markets.length > 1;
  /** The market the preview chart and the commitment manifest are built against. */
  const primaryMarket = markets[0] ?? config?.markets[0]?.name ?? "BTC/USD";
  const primaryMarketAddress = config?.markets.find((market) => market.name === primaryMarket)?.addr;

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
        setMarkets(cfg.markets?.[0]?.name ? [cfg.markets[0].name] : []);
        setPreviewMarket(cfg.markets?.[0]?.name ?? "BTC/USD");
      })
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const network = config?.network === "testnet" ? "testnet" : "mainnet";
    setMarketOptionsLoading(true);
    fetch(`/api/decibel/markets?network=${network}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { markets?: DecibelApiMarket[] }) => {
        if (controller.signal.aborted || !Array.isArray(payload.markets)) return;
        setMarketOptions(
          payload.markets
            .filter(isPerpApiMarket)
            .map(apiMarketToMarket),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setMarketOptionsLoading(false);
      });
    return () => controller.abort();
  }, [config?.network]);

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

  const selected: CatalogStrategy | null = useMemo(
    () => SEALED_CATALOG.find((s) => s.id === strategyId) ?? null,
    [strategyId],
  );
  // Keep an intentionally blank editor mounted while the creator is editing. Falling back to
  // the catalog source as soon as the last character is deleted makes the editor look haunted
  // and can commit a different program than the one on screen.
  const usingCustom = editingSource || importedScript !== null || customPine.trim().length > 0;
  const effectivePine = usingCustom ? customPine : (selected?.script ?? "");
  const activeMarketplaceSelection = useMemo<PineMarketplaceSelection | null>(() => {
    if (importedScript) return importedScript;
    if (!selected) return null;
    return {
      source: selected.script,
      title: selected.label,
      url: selected.source?.url ?? "",
      author: selected.source?.label ?? "cash.trading",
    };
  }, [importedScript, selected]);
  const executionMarketOptions = useMemo<Market[]>(() => {
    const byName = new Map(marketOptions.map((market) => [market.id, market]));
    return (config?.markets ?? []).map((market) => byName.get(market.name) ?? {
      id: market.name,
      label: market.name.replace("/USD", ""),
      pair: market.name,
      leverage: 0,
      category: "crypto" as const,
      color: "#27272a",
    });
  }, [config?.markets, marketOptions]);
  const toggleMarketAccess = useCallback((id: string) => {
    if (!executionMarketOptions.some((market) => market.id === id)) return;

    if (markets.includes(id)) {
      if (markets.length === 1) return;
      const next = markets.filter((market) => market !== id);
      setMarkets(next);
      if (previewMarket === id) setPreviewMarket(next[0]);
    } else {
      setMarkets([...markets, id]);
      setPreviewMarket(id);
    }
    setCommitInfo(null);
  }, [executionMarketOptions, markets, previewMarket]);

  const toggleAllMarketAccess = useCallback((checked: boolean) => {
    const all = executionMarketOptions.map((market) => market.id);
    if (all.length === 0) return;

    if (checked) {
      setMarkets(all);
      if (!all.includes(previewMarket)) setPreviewMarket(all[0]);
    } else {
      const retained = all.includes(previewMarket) ? previewMarket : all[0];
      setMarkets([retained]);
      setPreviewMarket(retained);
    }
    setCommitInfo(null);
  }, [executionMarketOptions, previewMarket]);
  // What the SCRIPT asks for, if anything. Shown so a creator whose strategy declares its own
  // size or leverage is not left thinking the controls below decided them — and so one whose
  // script declares nothing knows the controls are the whole answer.
  const scriptPctBps = useMemo(() => requestedPctBps(effectivePine), [effectivePine]);
  const scriptLeverageX100 = useMemo(() => requestedLeverageX100(effectivePine), [effectivePine]);
  const effectivePctBps = Math.min(scriptPctBps ?? pctBps, pctBps);
  const effectiveLeverageX100 = Math.min(scriptLeverageX100 ?? maxLeverageX100, maxLeverageX100);

  /** Name the vault for them. Only overwrite while the field is untouched. */
  const pickStrategy = useCallback(
    (s: CatalogStrategy) => {
      setStrategyId(s.id);
      setImportedScript(null);
      setCommitInfo(null);
      if (!nameTouched.current) setVaultName(s.label);
    },
    [],
  );

  const useMarketplaceScript = useCallback((script: PineMarketplaceSelection) => {
    setCustomPine(script.source);
    setImportedScript(script);
    setEditingSource(false);
    setTvUrl(script.url);
    setCommitInfo(null);
    setError(null);
    if (!nameTouched.current) setVaultName(script.title);
  }, []);

  useEffect(() => {
    if (!importedScript) return;
    // Two frames let the marketplace dialog unmount and restore body scrolling before the
    // mobile page is repositioned. A single immediate scroll was swallowed by iOS Safari.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        workbenchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [importedScript]);

  const importTradingView = useCallback(async () => {
    if (!tvUrl.trim()) return;
    setError(null);
    setTvBusy(true);
    try {
      const res = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(tvUrl.trim())}`);
      const json = await res.json();
      const source = typeof json.source === "string"
        ? json.source
        : typeof json.script === "string"
          ? json.script
          : "";
      if (!res.ok || !source) {
        setError(json.error ?? "Could not read that TradingView script. Paste the source instead.");
        return;
      }
      const title = typeof json.title === "string" ? json.title : "TradingView script";
      setCustomPine(source);
      setImportedScript({
        source,
        title,
        url: tvUrl.trim(),
        author: "TradingView author",
      });
      setEditingSource(false);
      setCommitInfo(null);
      if (!nameTouched.current) setVaultName(title);
    } catch (err) {
      setError(err instanceof Error ? err.message : "TradingView import failed");
    } finally {
      setTvBusy(false);
    }
  }, [tvUrl]);

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
          market: primaryMarket,
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
        // Two modules, chosen by how many markets the creator picked. The single-market path
        // stays exactly as it was — a one-market vault does not pay for machinery it will
        // never use, and the audited contract keeps handling the audited case.
        const { ok, json } = await postJson("/api/sealed/payload", isPortfolio
          ? {
              kind: "create-portfolio",
              programCommitment: info.commitment,
              attestorPubkey: config.attestorPubkey,
              decibelVaultAddr: vault,
              markets,
              // The per-leg cap is the creator's chosen order size; the aggregate cap and the
              // close guarantees come from the platform defaults the Markets card displays.
              maxPctBps: pctBps,
              maxLeverageX100,
              minBarIntervalS,
              slippageBps: config.defaults.slippageBps,
              // `maxPositions` cannot exceed the allowlist — the contract would abort, and
              // clamping here keeps the number the card showed honest.
              maxPositions: Math.min(
                config.portfolioDefaults?.maxPositions ?? 4,
                markets.length,
              ),
            }
          : {
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
        // Every market this vault trades. The registry stored only the manifest's market, so
        // a portfolio vault would have listed as single-market and the cron would have ticked
        // it with a one-element allowlist — indices that address the wrong books.
        markets,
        vaultKind: isPortfolio ? "portfolio" : "single",
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
        // Sent when the creator opted into managed attestation. Stored encrypted, and only
        // after the server confirms it reproduces the vault's commitment.
        managedPine: managed ? effectivePine : undefined,
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
    commitInfo, decibelVaultAddr, svAddr, bindTxHash, markets, primaryMarket, isPortfolio,
    seedUsdc, pctBps, managed,
    maxLeverageX100, minBarIntervalS,
    signAndSubmitTransaction, onLaunched, refreshPreflight,
  ]);

  // ── Task states ────────────────────────────────────────────────────────────
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
    const i = LAUNCH_STEPS.indexOf(id);
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

  const previewMode = Boolean(config && !config.ready);

  return (
    <div className="w-full">
      {/* Preview banner spans both columns — the unavailable state must be the first thing
          read, not something discovered after configuring everything. */}
      {previewMode && (
        <div className="mb-3 rounded-[var(--radius)] border border-amber-500/14 bg-amber-500/[0.06] px-3 py-2.5 sm:p-4">
          <p className="font-display text-[13px] font-semibold text-amber-300 sm:text-[14px]">
            Preview mode · launching unavailable on {config?.network}
          </p>
          <p className="mt-1 hidden text-[13px] leading-relaxed text-amber-200/70 sm:block">
            The sealed-vault contract isn&apos;t deployed here yet. You can pick a strategy, see
            its program hash and read the full cost breakdown — nothing can be funded or
            launched.
          </p>
          {config?.missing && config.missing.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer list-none text-[12px] text-amber-200/60 underline underline-offset-2 hover:text-amber-200">
                Developer details
              </summary>
              <div className="mt-2 space-y-1">
                {config.missing.map((m) => (
                  <p key={m} className="font-mono text-[11px] text-amber-300/80">{m}</p>
                ))}
                <p className="pt-1 text-[11px] leading-relaxed text-zinc-400">
                  Publish with{" "}
                  <span className="font-mono text-zinc-300">
                    pnpm sealed:publish --network {config.network}
                  </span>{" "}
                  and set the values it prints. See docs/DEPLOY-SEALED.md.
                </p>
              </div>
            </details>
          )}
        </div>
      )}

      <MarketPermissionsModal
        busy={busy}
        loading={marketOptionsLoading && executionMarketOptions.length === 0}
        markets={executionMarketOptions}
        onClose={() => setMarketAccessOpen(false)}
        onPreview={setPreviewMarket}
        onToggle={toggleMarketAccess}
        onToggleAll={toggleAllMarketAccess}
        open={marketAccessOpen}
        previewMarket={previewMarket}
        selectedIds={markets}
      />

      {/* The original Whop launchpad worked because this was one bounded workbench: source on
          the left, deployment decisions on the right, and the visual result attached below.
          Keep every newer cash.trading capability, but restore that information architecture. */}
      <div ref={workbenchRef} className="scroll-mt-4">
        <ProductPanel className="overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-card-border bg-card px-4 py-3 sm:px-5">
            <div className="min-w-0">
              {/* Names this stage specifically. It used to repeat the enclosing
                  panel's "Deploy a Strategy" verbatim, so the same four words
                  appeared twice within ~110px and the tab looked like it had
                  changed nothing. */}
              <h2 className="font-display text-[14px] font-semibold text-foreground sm:text-[15px]">
                Launch a sealed vault
              </h2>
              <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">
                Import Pine, verify the chart, then bind the strategy to a Decibel vault.
              </p>
            </div>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Pine → Aptos
            </span>
          </header>

          <div className="grid grid-cols-1 gap-3 p-2 sm:p-3 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ══ LEFT: source ══ */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* Import is a first-class path, not a footnote under the code block. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <input
              value={tvUrl}
              onChange={(e) => setTvUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && importTradingView()}
              placeholder="Paste a TradingView script URL"
              disabled={busy}
              aria-label="TradingView indicator URL"
              className={cn(inputCls, "col-span-2 sm:col-span-1")}
            />
            <button
              type="button"
              onClick={importTradingView}
              disabled={busy || tvBusy || !tvUrl.trim()}
              className={cn(PRODUCT_CONTROL_CLASS, PRODUCT_PRESSABLE_CLASS, "shrink-0 px-4 py-2.5 font-display text-[13px] font-semibold text-foreground hover:border-accent/18 disabled:pointer-events-none disabled:opacity-40")}
            >
              {tvBusy ? "Fetching…" : "Import"}
            </button>
            <PineMarketplace
              activeSelection={activeMarketplaceSelection}
              disabled={busy}
              launcherOnly
              market={previewMarket}
              onUse={useMarketplaceScript}
            />
          </div>

          <details className={cn(SURFACE_CARD_SOLID, "group overflow-hidden")}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-display text-[12px] font-semibold text-zinc-300 hover:text-white">
              <span>Vault-ready examples</span>
              <ChevronDown className="h-4 w-4 text-zinc-600 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="flex gap-1.5 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap border-t border-card-border py-2 overscroll-x-contain sm:overflow-x-visible">
              {SEALED_CATALOG.map((strategy) => {
                const active = !usingCustom && strategy.id === strategyId;
                return (
                  <button
                    key={strategy.id}
                    type="button"
                    onClick={() => {
                      setCustomPine("");
                      pickStrategy(strategy);
                    }}
                    disabled={busy}
                    aria-pressed={active}
                    className={cn(
                      "w-[210px] shrink-0 rounded-[var(--radius-sm)] border px-3 py-2 text-left disabled:opacity-40 sm:w-[calc(50%-0.1875rem)]",
                      PRODUCT_PRESSABLE_CLASS,
                      active
                        ? "border-accent/15 bg-accent/[0.06]"
                        : "border-transparent bg-card hover:border-border-strong hover:bg-card-hover",
                    )}
                  >
                    <span className={cn("block font-display text-[12px] font-semibold", active ? "text-accent" : "text-zinc-200")}>{strategy.label}</span>
                    <span className="mt-0.5 line-clamp-1 block text-[10px] text-zinc-500">{strategy.blurb}</span>
                  </button>
                );
              })}
            </div>
          </details>

          {/* What the selected strategy actually does. */}
          {!usingCustom && selected && (
            <div className={cn(SURFACE_CARD_SOLID, "px-4 py-3")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-display text-[15px] font-semibold text-white">
                  {selected.label}
                </h3>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Tag>{selected.category}</Tag>
                  <Tag>{selected.direction}</Tag>
                  <Tag>{isPortfolio ? `${markets.length} markets` : primaryMarket}</Tag>
                  <Tag>
                    {minBarIntervalS < 60 ? `${minBarIntervalS}s` : `${minBarIntervalS / 60}m`} bars
                  </Tag>
                  <Tag>{selected.turnover} turnover</Tag>
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-300">{selected.blurb}</p>
              <p className="mt-1 font-mono text-[11px] text-zinc-500">
                Draws {selected.draws.toLowerCase()}.
              </p>
              {selected.source && (
                <a
                  href={selected.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex font-mono text-[11px] text-zinc-500 underline decoration-white/15 underline-offset-2 transition-colors hover:text-zinc-300"
                >
                  Adapted from {selected.source.label}
                </a>
              )}
            </div>
          )}

          {/* The old Whop deployer felt like an IDE because Pine and its generated Move source
              shared one stable, full-height workbench. Keep that density and preserve the exact
              vault-target transpilation used by the sealed commitment. */}
          {(selected || usingCustom) && (
            <StrategySourceEditor
              pineScript={effectivePine}
              sourceName={importedScript?.title ?? selected?.id ?? "strategy"}
              originalUrl={importedScript?.url || selected?.source?.url}
              editing={editingSource}
              canReset={usingCustom}
              disabled={busy}
              creatorAddress={account?.address.toString()}
              marketAddress={primaryMarketAddress}
              onEditingChange={(nextEditing) => {
                if (nextEditing && !usingCustom && selected) {
                  setCustomPine(selected.script);
                  setImportedScript(null);
                }
                setEditingSource(nextEditing);
              }}
              onPineChange={(source) => {
                setCustomPine(source);
                setCommitInfo(null);
              }}
              onReset={() => {
                setCustomPine("");
                setImportedScript(null);
                setEditingSource(false);
                setCommitInfo(null);
              }}
            />
          )}

          {/* Compile result */}
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
                    caption="This hash is your strategy's on-chain identity."
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

        </div>

        {/* ══ RIGHT: decisions + action, sticky ══ */}
        <div className="min-w-0 lg:self-start" aria-label="Launch settings">
          <ProductPanel className="overflow-hidden">
          <div className="flex flex-col divide-y divide-card-border">
            {/* Name */}
            <ProductSection
              title={<label htmlFor="vault-name">Bot name</label>}
              description="The public name depositors see. Your source stays separate."
            >
              <input
                id="vault-name"
                value={vaultName}
                onChange={(e) => {
                  nameTouched.current = true;
                  setVaultName(e.target.value);
                }}
                disabled={busy}
                placeholder="Momentum Alpha"
                className={inputCls}
              />
            </ProductSection>

            <ProductSection
              title="Markets to trade"
              description={
                markets.length === executionMarketOptions.length && markets.length > 1
                  ? `All ${markets.length} supported markets are approved.`
                  : `${markets.length} market${markets.length === 1 ? "" : "s"} approved for this bot.`
              }
            >
              <ProductSelectorButton
                onClick={() => setMarketAccessOpen(true)}
                disabled={busy}
                aria-label="Configure bot market access"
                aria-haspopup="dialog"
                aria-expanded={marketAccessOpen}
                aria-busy={marketOptionsLoading && executionMarketOptions.length === 0}
                className="w-full"
                icon={<MarketLogo market={previewMarket} size={24} />}
                label="Bot market access"
                value={previewMarket}
                detail={
                  marketOptionsLoading && executionMarketOptions.length === 0
                    ? "Loading"
                    : markets.length === executionMarketOptions.length && markets.length > 1
                      ? "All approved"
                      : `${markets.length} approved`
                }
              />
            </ProductSection>

            {/* Only show portfolio-specific rules when several markets are approved. */}
            {config && isPortfolio && (
              <ProductSection
                title="Portfolio safeguards"
                description={`${markets.length} markets approved for this bot.`}
              >
                <p className="text-pretty text-[12px] leading-relaxed text-zinc-300">
                  The strategy is evaluated separately on each approved market and can hold up
                  to {Math.min(config.portfolioDefaults?.maxPositions ?? 4, markets.length)} positions.
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  <Review
                    k="Total exposure cap"
                    v={`${(config.portfolioDefaults?.maxPortfolioLeverageX100 ?? 300) / 100}x NAV`}
                  />
                  <Review
                    k="Per position"
                    v={`${(config.portfolioDefaults?.maxPctBps ?? 2500) / 100}% max`}
                  />
                  <Review
                    k="Auto-close after"
                    v={`${Math.round(((config.portfolioDefaults?.maxHoldBars ?? 1440) * minBarIntervalS) / 3600)}h`}
                  />
                  <Review
                    k="Funding stop-out"
                    v={`${(config.portfolioDefaults?.maxAdverseFundingBps ?? 200) / 100}%`}
                  />
                </dl>
              </ProductSection>
            )}

            {/* Source visibility */}
            <ProductSection title="Source visibility">
              <div className="grid grid-cols-2 gap-1.5">
                <RailChoice
                  active={isPrivate}
                  onClick={() => setIsPrivate(true)}
                  disabled={busy}
                  icon={<Lock className="h-3.5 w-3.5" aria-hidden />}
                  title="Private"
                  body="Only a commitment goes on-chain. Reveal later to prove every trade came from it."
                />
                <RailChoice
                  active={!isPrivate}
                  onClick={() => setIsPrivate(false)}
                  disabled={busy}
                  icon={<Globe className="h-3.5 w-3.5" aria-hidden />}
                  title="Public"
                  body="Published with the vault so anyone can check it against the trades it made."
                />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {isPrivate
                  ? "Only a commitment goes on-chain. Reveal later to prove every trade came from it."
                  : "Published with the vault so anyone can check it against the trades it made."}
              </p>
            </ProductSection>

            {/* Who runs it */}
            <ProductSection title="Who runs it">
              <div className="grid grid-cols-2 gap-1.5">
                <RailChoice
                  active={managed}
                  onClick={() => setManaged(true)}
                  disabled={busy}
                  icon={<Zap className="h-3.5 w-3.5" aria-hidden />}
                  title="We run it"
                  body="Runs every minute automatically. We keep an encrypted copy to execute it — so we can technically read it."
                />
                <RailChoice
                  active={!managed}
                  onClick={() => setManaged(false)}
                  disabled={busy}
                  icon={<Server className="h-3.5 w-3.5" aria-hidden />}
                  title="I run it myself"
                  body="We never receive your source. The vault trades only while your attestor is running."
                />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {managed
                  ? "Runs every minute automatically. We keep an encrypted copy to execute it — so we can technically read it."
                  : "We never receive your source. The vault trades only while your attestor is running."}
              </p>
            </ProductSection>

            {/* Cost */}
            {config && (
              <ProductSection
                title="Required to launch"
                action={(
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-accent">
                    {config.economics.creationFeeUsdc + config.economics.launchFeeUsdc + seedUsdc} USDC
                  </span>
                )}
              >
                <dl className="space-y-1.5">
                  <RailRow k="Decibel protocol fee" v={`${config.economics.creationFeeUsdc}`} />
                  <RailRow k="Our launch fee" v={`${config.economics.launchFeeUsdc}`} />
                  <RailRow k="Starting capital" v={`${seedUsdc}`} tone="warn" />
                </dl>
                {/* Three lines of caveat on a phone pushed everything else off-screen, so the
                    mobile version keeps only the part that changes a decision. */}
                <p className="mt-1.5 text-[12px] leading-relaxed text-amber-400/80 lg:hidden">
                  Starting capital is at risk — it is traded, not a fee.
                </p>
                <p className="mt-1.5 hidden text-[12px] leading-relaxed text-zinc-400 lg:block">
                  Starting capital is not a fee — it is traded by the strategy and exposed to its
                  gains and losses. The launch fee is once per vault; swapping indicators later is
                  free.
                </p>
                <div className="mt-2.5 space-y-1.5 border-t border-card-border pt-2.5">
                  <PotRow
                    label="Decibel balance"
                    need={config.economics.creationFeeUsdc + seedUsdc}
                    have={preflight?.usdc}
                  />
                  <PotRow
                    label="Wallet"
                    need={config.economics.launchFeeUsdc}
                    have={preflight?.walletUsdc}
                  />
                </div>
                <dl className="mt-2.5 space-y-1.5 border-t border-card-border pt-2.5">
                  <RailRow
                    k="Performance fee"
                    v={`${config.economics.depositorPaysPct}%`}
                    note={`Depositors pay. You get ${config.economics.creatorKeepsPct}%.`}
                  />
                  <RailRow
                    k="Trading fee"
                    v={`${config.economics.builderFeeBps / 100}%`}
                    note="Per fill, on notional."
                  />
                </dl>
                {!config.economics.termsOnChain && (
                  <p className="mt-2 text-[12px] leading-relaxed text-amber-500/90">
                    Estimated — the contract isn&apos;t deployed here, so these are defaults.
                  </p>
                )}
              </ProductSection>
            )}

            {/* Rules */}
            <details className="group overflow-hidden bg-background-secondary">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3.5 font-display text-[13px] font-semibold text-foreground-secondary transition-colors hover:text-foreground">
                <span>Execution settings</span>
                <span className="font-normal text-muted-foreground">· defaults applied</span>
                <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              </summary>
              <div className="space-y-3 border-t border-card-border px-4 py-3.5">
                <Segmented label="Order size" hint="Share of vault NAV per order." options={ORDER_SIZE_CHOICES} value={pctBps} onChange={setPctBps} disabled={busy} />
                <Segmented label="Max leverage" hint="Hard cap the contract enforces." options={LEVERAGE_CHOICES} value={maxLeverageX100} onChange={setMaxLeverageX100} disabled={busy} />
                <Segmented label="Trade cadence" hint="Minimum time between bars." options={CADENCE_CHOICES} value={minBarIntervalS} onChange={setMinBarIntervalS} disabled={busy} />
                <Segmented label="Seed capital" hint="Your own USDC, at risk." options={SEED_CHOICES.map((v) => ({ label: `${v}`, value: v }))} value={seedUsdc} onChange={setSeedUsdc} disabled={busy} />
                <p className="border-t border-card-border pt-2.5 text-[12px] leading-relaxed text-zinc-400">
                  Frozen when your bot goes live. Slippage {(config?.defaults.slippageBps ?? 30) / 100}%
                  and the {config?.economics.feeIntervalDays ?? 30}-day fee interval are protocol
                  floors, not choices.
                </p>
              </div>
            </details>

            {/* Risk, immediately before the action */}
            {config && (
              <ProductSection title="Before you launch">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Review k="Direction" v={usingCustom ? "Per your script" : (selected?.direction ?? "—")} />
                  <Review
                    k={isPortfolio ? "Markets" : "Market"}
                    // Bare tickers when there are several: four "/USD" suffixes wrap the value
                    // onto a second line and add nothing — every market here is USD-quoted.
                    v={isPortfolio ? markets.map((m) => m.replace("/USD", "")).join(", ") : primaryMarket}
                  />
                  <Review k="Capital at risk" v={`${seedUsdc} USDC`} tone="warn" />
                  <Review
                    k="Max leverage"
                    v={`${effectiveLeverageX100 / 100}x`}
                    tone={effectiveLeverageX100 > 200 ? "warn" : undefined}
                  />
                  <Review k="Order size" v={`${effectivePctBps / 100}% of NAV`} />
                  <Review k="Runs" v={managed ? "Automatically" : "Only while you run it"} tone={managed ? undefined : "warn"} />
                </dl>
                {(scriptPctBps !== null || scriptLeverageX100 !== null) && (
                  <p className="mt-2.5 border-t border-card-border pt-2.5 text-[12px] leading-relaxed text-zinc-300">
                    Your script sets its own{" "}
                    {scriptPctBps !== null && scriptLeverageX100 !== null
                      ? "size and leverage"
                      : scriptPctBps !== null
                        ? "position size"
                        : "leverage"}
                    .{" "}
                    {/* Naming the cap matters: "your script chooses" printed next to a number
                        SMALLER than the script asked for reads as a contradiction, and the
                        creator would go looking for a bug that is really a working limit. */}
                    {scriptPctBps !== null && scriptPctBps > pctBps ? (
                      <>
                        It asks for {scriptPctBps / 100}% per position; the {pctBps / 100}% order
                        size above caps it.
                      </>
                    ) : scriptLeverageX100 !== null && scriptLeverageX100 > maxLeverageX100 ? (
                      <>
                        It asks for {scriptLeverageX100 / 100}x; the {maxLeverageX100 / 100}x cap
                        above limits it.
                      </>
                    ) : (
                      <>The settings above are ceilings it stays inside.</>
                    )}
                  </p>
                )}
                <p className="mt-2.5 border-t border-card-border pt-2.5 text-[12px] leading-relaxed text-zinc-400">
                  Leveraged perpetual futures. At {effectiveLeverageX100 / 100}x, a{" "}
                  <span className="font-semibold text-white">
                    {(100 / (effectiveLeverageX100 / 100)).toFixed(0)}%
                  </span>{" "}
                  adverse move wipes out the capital behind a full-size position. On-chain
                  enforcement guarantees the vault follows your rules — not that they are
                  profitable.
                </p>
              </ProductSection>
            )}

            {/* Live pipeline */}
            <AnimatePresence>
              {(busy || started) && (
                <motion.div
                  initial={{ opacity: 0, transform: reducedMotion ? "none" : "translateY(4px)" }}
                  animate={{ opacity: 1, transform: "none" }}
                  exit={{ opacity: 0, transform: reducedMotion ? "none" : "translateY(-4px)" }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-3"
                >
                  {step === "commit" && (
                    <ThinkingState label="Compiling your strategy" steps={thinkSteps} />
                  )}
                  <TaskList tasks={tasks} />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <Banner tone="error" onDismiss={() => { setError(null); setErrorList([]); }}>
                  <span className="block font-semibold">{error}</span>
                  {errorList.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {errorList.map((e) => (
                        <li key={e} className="text-[12px] leading-relaxed text-red-300/80">• {e}</li>
                      ))}
                    </ul>
                  )}
                  {started && !live && (
                    <span className="mt-2 block text-[12px] leading-relaxed text-red-300/70">
                      {doneThrough >= 2
                        ? "Your Decibel vault exists and its funds are safe — resuming will not create a second one."
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
                  <span className="mt-2 flex flex-col gap-1">
                    <ExplorerLink label="Strategy" addr={svAddr} base={explorerBase} suffix={explorerSuffix} />
                    {decibelVaultAddr && (
                      <ExplorerLink label="Vault" addr={decibelVaultAddr} base={explorerBase} suffix={explorerSuffix} />
                    )}
                  </span>
                </Banner>
              )}
            </AnimatePresence>

          </div>

          {/* Pinned action. Desktop only — on a phone this sits ~3000px down the page, so the
              mobile action is a fixed bottom bar instead (below). */}
          <div className="hidden shrink-0 border-t border-card-border bg-background-secondary p-3 lg:block">
            {config && !previewMode && (
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-zinc-400">Required to launch</span>
                <span className="font-mono text-[14px] font-semibold tabular-nums text-white">
                  {config.economics.creationFeeUsdc + config.economics.launchFeeUsdc + seedUsdc} USDC
                </span>
              </div>
            )}
            {previewMode ? (
              <div
                role="status"
                className={cn(PRODUCT_CONTROL_CLASS, "flex w-full items-center justify-center gap-2 px-4 py-3.5 font-display text-[14px] font-semibold text-muted-foreground")}
              >
                <Lock className="h-4 w-4" aria-hidden />
                Launch unavailable in preview mode
              </div>
            ) : (
              <ActionButton
                onClick={launch}
                state={busy ? "pending" : live ? "success" : error ? "error" : "idle"}
                successLabel="Live"
                errorLabel={started ? `Resume (step ${doneThrough + 1} of 4)` : "Try again"}
                disabled={live}
              >
                {buttonLabel}
              </ActionButton>
            )}
            {!started && !previewMode && (
              <p className="mt-1.5 text-center text-[12px] leading-relaxed text-zinc-400">
                Three wallet signatures — Decibel requires each to be its own transaction.
              </p>
            )}
          </div>
          </ProductPanel>
        </div>
      </div>

          {/* Whop's deploy screen put the rendered strategy after the editor and rail. It lets
              creators understand the source first, then inspect the full-width visual result
              without sacrificing half of the chart to form controls. */}
          {effectivePine && (
            <section className="border-t border-card-border">
              <PineVisualPreview
                asset={previewMarket}
                embedded
                pineScript={effectivePine}
                title={activeMarketplaceSelection?.title ?? selected?.label}
              />
            </section>
          )}

          {/* Keep cash.trading's real evaluator beneath the visual preview. This is additive to
              the original Whop workbench, not a second disconnected page. */}
          {effectivePine && (
            <section className="border-t border-card-border p-2 sm:p-3">
              <SealedBacktest
                asset={primaryMarket}
                markets={markets}
                initialCapital={seedUsdc}
                maxLeverageX100={maxLeverageX100}
                pctBps={pctBps}
                pineScript={effectivePine}
                slippageBps={config?.defaults?.slippageBps ?? 30}
              />
            </section>
          )}
        </ProductPanel>
      </div>

      {/*
        Mobile action bar. The launch button lived at the very bottom of a 3200px page on a
        phone — a user had to scroll four screens past content they had already decided on to
        reach it, which is the single worst thing about a checkout flow. Fixed to the viewport
        instead, with the total beside it so the commitment is never out of sight.
      */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden"
      >
        {previewMode ? (
          <div
            role="status"
            className={cn(PRODUCT_CONTROL_CLASS, "flex w-full items-center justify-center gap-2 px-4 py-3 font-display text-[14px] font-semibold text-muted-foreground")}
          >
            <Lock className="h-4 w-4" aria-hidden />
            Launch unavailable
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {config && (
              <div className="min-w-0 shrink-0">
                <span className="block text-[11px] leading-none text-zinc-400">Required</span>
                <span className="mt-0.5 block font-mono text-[15px] font-semibold leading-none tabular-nums text-white">
                  {config.economics.creationFeeUsdc + config.economics.launchFeeUsdc + seedUsdc}
                  <span className="ml-1 text-[11px] text-zinc-400">USDC</span>
                </span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <ActionButton
                onClick={launch}
                state={busy ? "pending" : live ? "success" : error ? "error" : "idle"}
                successLabel="Live"
                errorLabel={started ? `Resume ${doneThrough + 1}/4` : "Try again"}
                disabled={live}
              >
                {live ? "Live" : started ? `Resume ${doneThrough + 1}/4` : "Launch bot"}
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      {/* Spacer so the bar never covers the last card. */}
      <div className="h-24 lg:hidden" aria-hidden />
    </div>
  );
}

const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary px-3 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-accent/16 focus:outline-none disabled:opacity-50";

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
        <span className="text-right text-[12px] leading-relaxed text-zinc-400">{hint}</span>
      </div>
      <ProductSegmented
        role="radiogroup"
        aria-label={label}
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
              "flex-1 rounded-[var(--radius-xs)] px-2 py-1.5 font-mono text-[11px] tabular-nums transition-colors disabled:opacity-50",
              PRODUCT_PRESSABLE_CLASS,
              o.value === value
                ? "bg-accent/15 text-accent"
                : "text-muted-foreground hover:bg-card-hover hover:text-foreground-secondary",
            )}
          >
            {o.label}
          </button>
        ))}
      </ProductSegmented>
    </div>
  );
}

/** A choice in the right rail. Full-width row rather than a half-width card — at 360px the
 *  side-by-side card pair wrapped into unreadable slivers. */
function RailChoice({
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
        PRODUCT_CONTROL_CLASS,
        PRODUCT_PRESSABLE_CLASS,
        "min-h-10 p-2.5 text-left disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-accent/18 bg-accent/[0.06]"
          : "hover:border-border-strong hover:bg-card-hover",
      )}
    >
      <span className={cn("flex items-center gap-1.5", active ? "text-accent" : "text-zinc-300")}>
        {icon}
        <span className="font-display text-[13px] font-semibold">{title}</span>
      </span>
      <span className="sr-only">{body}</span>
    </button>
  );
}

/** A single money line in the rail. */
function RailRow({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: "warn" }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-[12px] text-zinc-300">{k}</dt>
        <dd
          className={cn(
            "shrink-0 font-mono text-[12px] tabular-nums",
            tone === "warn" ? "text-amber-400" : "text-zinc-200",
          )}
        >
          {v}
        </dd>
      </div>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{note}</p>}
    </div>
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

/** Small metadata chip. Deliberately readable rather than 9px uppercase. */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
      {children}
    </span>
  );
}

function Review({ k, v, tone }: { k: string; v: string; tone?: "warn" }) {
  return (
    <div>
      <dt className="text-[12px] text-zinc-500">{k}</dt>
      <dd className={cn("mt-0.5 font-display text-[14px] font-semibold", tone === "warn" ? "text-amber-400" : "text-white")}>
        {v}
      </dd>
    </div>
  );
}

/** One funding requirement, against what the connected wallet actually holds. Two separate
 *  pots — Decibel spends from the subaccount, our fee comes from the wallet — and a creator
 *  with plenty in the wrong one still cannot launch. */
function PotRow({ label, need, have }: { label: string; need: number; have?: number }) {
  const known = typeof have === "number";
  const ok = known && have >= need;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-zinc-400">{label}</span>
      <span className="shrink-0 font-mono tabular-nums">
        <span className={ok ? "text-accent" : known ? "text-amber-400" : "text-zinc-500"}>
          {known ? have.toFixed(2) : "—"}
        </span>
        <span className="text-zinc-500"> / {need} USDC</span>
        {known && !ok && (
          <span className="ml-1.5 text-amber-400">add {(need - have).toFixed(2)}</span>
        )}
      </span>
    </div>
  );
}
