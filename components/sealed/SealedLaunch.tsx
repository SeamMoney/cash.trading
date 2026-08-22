"use client";

/**
 * Launch a vault.
 *
 * Three steps and a button. Pick a strategy (Donchian Breakout is preselected), approve the
 * markets and caps, name it, hit Launch. Every trading rule has a bound-checked default and the
 * controls are segmented choices, not sliders or free text — there is no number a creator can
 * type here that the chain wouldn't have to reject.
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
import { ChevronDown, Lock, Globe, ExternalLink, Zap, Server, X } from "lucide-react";

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
import { BUTTON_PRIMARY } from "@/components/portfolio/portfolio-surface";
import { FOCUS_RING } from "@/lib/surface";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { requestedLeverageX100, requestedPctBps } from "@/lib/pine-declarations";
import { FLIP_RATE, SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
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
    /** The fee split in one sentence, composed server-side from the numbers above. */
    summary?: string;
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

/**
 * Display order for the catalog. The three with the most defensible default behaviour lead;
 * Swing Consensus — eight votes and the weakest backtest — goes last rather than first, where it
 * used to be preselected for every new creator.
 */
const CATALOG_ORDER = [
  "breakout-channel",
  "rsi-reversion",
  "sma-trend",
  "ema-cross",
  "bollinger-breakout",
  "multi-asset-momentum",
  "swing-consensus",
];
const rankOf = (s: CatalogStrategy) => {
  const i = CATALOG_ORDER.indexOf(s.id);
  return i === -1 ? CATALOG_ORDER.length - 1.5 : i;
};
const ORDERED_CATALOG: CatalogStrategy[] = [...SEALED_CATALOG].sort((a, b) => rankOf(a) - rankOf(b));
const DEFAULT_STRATEGY = ORDERED_CATALOG[0];

/** The launch steps, in order. `done` gates resumption. */
type StepId = "commit" | "vault" | "bind" | "delegate";
const LAUNCH_STEPS: readonly StepId[] = ["commit", "vault", "bind", "delegate"];

/** The three screens of the flow. Distinct from the on-chain launch steps above. */
type Stage = 1 | 2 | 3;
const STAGES: Array<{ n: Stage; label: string }> = [
  { n: 1, label: "Strategy" },
  { n: 2, label: "Markets & limits" },
  { n: 3, label: "Name & fund" },
];

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

export function SealedLaunch({
  onLaunched,
  onCancel,
}: {
  onLaunched?: () => void;
  /** Leave the flow. Hidden while a launch is in flight. */
  onCancel?: () => void;
}) {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const reducedMotion = useReducedMotion();

  const [config, setConfig] = useState<SealedConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);

  const [stage, setStage] = useState<Stage>(1);
  const [maxStage, setMaxStage] = useState<Stage>(1);
  const [strategyId, setStrategyId] = useState(DEFAULT_STRATEGY.id);
  const [customPine, setCustomPine] = useState("");
  const [importedScript, setImportedScript] = useState<PineMarketplaceSelection | null>(null);
  const [editingSource, setEditingSource] = useState(false);
  const [tvUrl, setTvUrl] = useState("");
  const [tvBusy, setTvBusy] = useState(false);
  const [vaultName, setVaultName] = useState(DEFAULT_STRATEGY.label);
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
  // Heavy panes mount only once opened: Monaco, the candle renderer and the evaluator together
  // cost more than the rest of the page, and most launches never open them.
  const [importOpen, setImportOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
        setConfigError(false);
        setPctBps(cfg.defaults?.pctBps ?? 1000);
        setMaxLeverageX100(cfg.defaults?.maxLeverageX100 ?? 200);
        setMinBarIntervalS(cfg.defaults?.minBarIntervalS ?? 60);
        setSeedUsdc(cfg.economics?.minFundingUsdc ?? 100);
        setMarkets(cfg.markets?.[0]?.name ? [cfg.markets[0].name] : []);
        setPreviewMarket(cfg.markets?.[0]?.name ?? "BTC/USD");
      })
      .catch(() => {
        setConfig(null);
        setConfigError(true);
      });
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
      // Placeholder tint for a market the chart carries no palette for. The
      // token, not a literal grey, which would stay near-black on a white page.
      color: "var(--card-border)",
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

  /** Back to the catalog after an import or an edit. */
  const resetSource = useCallback(() => {
    setCustomPine("");
    setImportedScript(null);
    setEditingSource(false);
    setCommitInfo(null);
    if (!nameTouched.current && selected) setVaultName(selected.label);
  }, [selected]);

  const useMarketplaceScript = useCallback((script: PineMarketplaceSelection) => {
    setCustomPine(script.source);
    setImportedScript(script);
    setEditingSource(false);
    setTvUrl(script.url);
    setCommitInfo(null);
    setError(null);
    if (!nameTouched.current) setVaultName(script.title);
  }, []);

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
  const creationFee = config?.economics.creationFeeUsdc ?? 100;
  const tasks: AgentTask[] = [
    { id: "commit", label: "Hash the strategy", detail: commitInfo?.commitment, state: stateFor("commit") },
    { id: "vault", label: "Create the Decibel vault", detail: decibelVaultAddr ?? `Signature 1 — pays the ${creationFee} USDC protocol fee and seeds the vault`, state: stateFor("vault") },
    { id: "bind", label: "Seal the strategy on-chain", detail: svAddr ?? "Signature 2 — freezes the commitment and every rule, permanently", state: stateFor("bind") },
    { id: "delegate", label: "Hand trading to the sealed module", detail: delegated ? "Delegated" : "Signature 3 — the only thing that can place an order for this vault", state: stateFor("delegate") },
  ];

  const started = doneThrough > 0;
  const buttonLabel = live
    ? "Live"
    : started
      ? `Resume launch (step ${doneThrough + 1} of 4)`
      : "Launch vault";

  const explorerBase =
    config?.network === "mainnet"
      ? "https://explorer.aptoslabs.com/object"
      : "https://explorer.aptoslabs.com/object";
  const explorerSuffix = `?network=${config?.network ?? "testnet"}`;

  const previewMode = Boolean(config && !config.ready);
  const totalUsdc = config
    ? config.economics.creationFeeUsdc + config.economics.launchFeeUsdc + seedUsdc
    : null;
  const feeSplit = config
    ? (config.economics.summary
      ?? `${config.economics.depositorPaysPct}% of profits — you keep ${config.economics.creatorKeepsPct}%, platform takes ${config.economics.platformTakesPct}%.`)
    : null;

  // ── Stage navigation ───────────────────────────────────────────────────────
  const goTo = useCallback((next: Stage) => {
    setStage(next);
    setMaxStage((m) => (next > m ? next : m));
    // The panel header is the natural landmark for "a new screen" — on a phone the previous
    // step's controls would otherwise still fill the viewport after the swap.
    panelRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }, [reducedMotion]);

  const openWalletSelector = () => window.dispatchEvent(new Event("cash:open-wallet-selector"));

  const sourceLabel = importedScript
    ? importedScript.title
    : usingCustom
      ? "Edited source"
      : selected?.label ?? "";

  /**
   * The action row. Rendered twice — in the desktop panel footer and in the fixed mobile bar —
   * so the primary action is never below the fold on either.
   */
  const footer = (compact: boolean) => {
    const primary = (() => {
      if (stage < 3) {
        return (
          <button
            type="button"
            onClick={() => goTo((stage + 1) as Stage)}
            disabled={busy}
            className={cn(BUTTON_PRIMARY, "min-h-11 w-full px-5 font-display font-bold")}
          >
            Continue
          </button>
        );
      }
      // One visible label at every width: the long form wrapped to two lines inside the
      // w-56 desktop box and broke the row's own height. The banner above carries the
      // reason on screen; the accessible name carries it for a screen reader.
      if (previewMode) {
        return (
          <div
            role="status"
            aria-label="Launch unavailable in preview mode"
            className={cn(PRODUCT_CONTROL_CLASS, "flex min-h-11 w-full items-center justify-center gap-2 px-4 font-display text-sm font-semibold text-muted-foreground")}
          >
            <Lock className="h-4 w-4" aria-hidden />
            Launch unavailable
          </div>
        );
      }
      if (live) {
        return (
          <button
            type="button"
            onClick={onCancel}
            className={cn(BUTTON_PRIMARY, "min-h-11 w-full px-5 font-display font-bold")}
          >
            Done
          </button>
        );
      }
      if (!connected) {
        return (
          <button
            type="button"
            onClick={openWalletSelector}
            className={cn(BUTTON_PRIMARY, "min-h-11 w-full px-5 font-display font-bold")}
          >
            Connect wallet
          </button>
        );
      }
      return (
        <ActionButton
          onClick={launch}
          state={busy ? "pending" : live ? "success" : error ? "error" : "idle"}
          successLabel="Live"
          errorLabel={started ? (compact ? `Resume ${doneThrough + 1}/4` : `Resume (step ${doneThrough + 1} of 4)`) : "Try again"}
          disabled={live}
          className="!min-h-11 !py-2.5"
        >
          {compact && started ? `Resume ${doneThrough + 1}/4` : buttonLabel}
        </ActionButton>
      );
    })();

    return (
      <div className="flex items-center gap-3">
        {stage > 1 && !live && (
          <button
            type="button"
            onClick={() => goTo((stage - 1) as Stage)}
            disabled={busy}
            className={cn(
              "shrink-0 rounded-[var(--radius-sm)] px-3 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40",
              PRODUCT_PRESSABLE_CLASS, FOCUS_RING,
            )}
          >
            Back
          </button>
        )}
        {totalUsdc !== null && !previewMode && (
          <div className="ml-auto min-w-0 shrink-0 text-right">
            <span className="block text-[11px] leading-none text-muted-foreground">Required</span>
            <span className="mt-0.5 block font-mono text-[13px] font-semibold leading-none tabular-nums text-foreground">
              {totalUsdc} <span className="text-[11px] font-normal text-muted-foreground">USDC</span>
            </span>
          </div>
        )}
        <div className={cn("min-w-0", compact ? "flex-1" : "w-56 shrink-0", totalUsdc === null && "ml-auto")}>
          {primary}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      {/* Preview banner above the flow — the unavailable state must be the first thing read,
          not something discovered after configuring everything. */}
      {previewMode && (
        <div className="mb-3 rounded-[var(--radius)] border border-warning/20 bg-warning/[0.06] px-3 py-2.5 sm:p-4">
          <p className="font-display text-[13px] font-semibold text-warning">
            Preview mode · launching is unavailable on {config?.network}
          </p>
          <p className="mt-1 hidden text-[13px] leading-relaxed text-warning/70 sm:block">
            The sealed-vault attestor isn&apos;t configured here. You can pick a strategy, see
            its program hash and read the full cost breakdown — nothing can be funded or
            launched.
          </p>
          {/* Env-var names and a pnpm command are for whoever runs the deploy, not for
              someone reading a vault page in production. */}
          {process.env.NODE_ENV !== "production" && config?.missing && config.missing.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer list-none text-xs text-warning/60 underline underline-offset-2 hover:text-warning">
                Developer details
              </summary>
              <div className="mt-2 space-y-1">
                {config.missing.map((m) => (
                  <p key={m} className="font-mono text-[11px] text-warning/80">{m}</p>
                ))}
                <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Publish with{" "}
                  <span className="font-mono text-foreground">
                    pnpm sealed:publish --network {config.network}
                  </span>{" "}
                  and set the values it prints. See docs/DEPLOY-SEALED.md.
                </p>
              </div>
            </details>
          )}
        </div>
      )}

      {configError && (
        <div className="mb-3">
          <Banner tone="error">
            <span className="block font-semibold">Launch settings are unavailable right now.</span>
            <span className="mt-1 block">Fees and markets could not be loaded. Reload the page to try again.</span>
          </Banner>
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

      <div ref={panelRef} className="scroll-mt-4">
        <ProductPanel className="overflow-hidden">
          <header className="flex items-start justify-between gap-3 border-b border-card-border px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="font-display text-[13px] font-semibold text-foreground">
                Launch a vault
              </h2>
              <ol className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs" aria-label="Steps">
                {STAGES.map((s, i) => {
                  const reachable = s.n <= maxStage && !busy && !live;
                  const current = s.n === stage;
                  return (
                    <li key={s.n} className="flex items-center gap-1">
                      {i > 0 && <span aria-hidden className="text-muted-foreground/60">›</span>}
                      <button
                        type="button"
                        onClick={() => reachable && goTo(s.n)}
                        disabled={!reachable}
                        aria-current={current ? "step" : undefined}
                        className={cn(
                          "rounded-[var(--radius-xs)] px-1 py-0.5 disabled:cursor-default",
                          FOCUS_RING,
                          current ? "font-semibold text-foreground" : "text-muted-foreground",
                          reachable && !current && "hover:text-foreground",
                        )}
                      >
                        <span className="font-mono tabular-nums">{s.n}</span> {s.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            {onCancel && !busy && !live && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close launch flow"
                className={cn(
                  "-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-card-hover hover:text-foreground",
                  PRODUCT_PRESSABLE_CLASS, FOCUS_RING,
                )}
              >
                <X className="size-4" aria-hidden />
              </button>
            )}
          </header>

          {/* ══ Step 1 · Strategy ══ */}
          {stage === 1 && (
            <div className="divide-y divide-card-border">
              <ProductSection
                title="Choose a strategy"
                description="Every strategy here compiles to Move and runs on-chain. Backtest any of them in the next step."
              >
                <div role="radiogroup" aria-label="Strategy" className="flex flex-col gap-1">
                  {usingCustom && (
                    <div
                      role="radio"
                      aria-checked
                      className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-accent/30 bg-accent/[0.06] px-3 py-2.5"
                    >
                      <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="truncate font-display text-[13px] font-semibold text-foreground">{sourceLabel}</span>
                          <Tag>{importedScript ? "Imported" : "Edited"}</Tag>
                        </div>
                        {importedScript?.author && (
                          <p className="mt-0.5 text-xs text-muted-foreground">by {importedScript.author}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={resetSource}
                        disabled={busy}
                        className={cn("shrink-0 rounded-[var(--radius-xs)] px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40", PRODUCT_PRESSABLE_CLASS, FOCUS_RING)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                  {ORDERED_CATALOG.map((strategy) => {
                    const active = !usingCustom && strategy.id === strategyId;
                    return (
                      <button
                        key={strategy.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setCustomPine("");
                          setEditingSource(false);
                          pickStrategy(strategy);
                        }}
                        disabled={busy}
                        className={cn(
                          "flex min-h-11 w-full items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left disabled:opacity-40",
                          PRODUCT_PRESSABLE_CLASS, FOCUS_RING,
                          active
                            ? "border-accent/30 bg-accent/[0.06]"
                            : "border-card-border bg-background-tertiary hover:border-border-strong",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            active ? "bg-accent" : "border border-border-strong",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className={cn("font-display text-[13px] font-semibold", active ? "text-foreground" : "text-foreground-secondary")}>
                              {strategy.label}
                            </span>
                            <Tag>{strategy.category}</Tag>
                            <Tag>{FLIP_RATE[strategy.turnover]}</Tag>
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                            {strategy.blurb}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ProductSection>

              <Disclosure
                label="Import from TradingView"
                open={importOpen}
                onToggle={setImportOpen}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <input
                    value={tvUrl}
                    onChange={(e) => setTvUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && importTradingView()}
                    placeholder="Paste a TradingView script URL"
                    disabled={busy}
                    aria-label="TradingView indicator URL"
                    className={inputCls}
                  />
                  <button
                    type="button"
                    onClick={importTradingView}
                    disabled={busy || tvBusy || !tvUrl.trim()}
                    className={cn(PRODUCT_CONTROL_CLASS, PRODUCT_PRESSABLE_CLASS, FOCUS_RING, "min-h-11 shrink-0 px-4 font-display text-[13px] font-semibold text-foreground hover:border-accent/18 disabled:pointer-events-none disabled:opacity-40")}
                  >
                    {tvBusy ? "Fetching…" : "Import"}
                  </button>
                  <div className="col-span-2">
                    <PineMarketplace
                      activeSelection={activeMarketplaceSelection}
                      disabled={busy}
                      launcherOnly
                      market={previewMarket}
                      onUse={useMarketplaceScript}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  Only close-price strategies compile. OHLC and volume scripts are rejected at launch.
                </p>
              </Disclosure>

              {error && stage === 1 && (
                <div className="p-4">
                  <Banner tone="error" onDismiss={() => { setError(null); setErrorList([]); }}>
                    <span className="block font-semibold">{error}</span>
                  </Banner>
                </div>
              )}
            </div>
          )}

          {/* ══ Step 2 · Markets & limits ══ */}
          {stage === 2 && (
            <div className="divide-y divide-card-border">
              <ProductSection
                title="Markets"
                description={
                  markets.length === executionMarketOptions.length && markets.length > 1
                    ? `All ${markets.length} supported markets approved. Two or more makes this a portfolio vault.`
                    : `${markets.length} market${markets.length === 1 ? "" : "s"} approved. Two or more makes this a portfolio vault.`
                }
              >
                <ProductSelectorButton
                  onClick={() => setMarketAccessOpen(true)}
                  disabled={busy}
                  aria-label="Configure vault market access"
                  aria-haspopup="dialog"
                  aria-expanded={marketAccessOpen}
                  aria-busy={marketOptionsLoading && executionMarketOptions.length === 0}
                  className="w-full"
                  icon={<MarketLogo market={previewMarket} size={24} />}
                  label="Vault market access"
                  value={isPortfolio ? markets.map((m) => m.replace("/USD", "")).join(", ") : previewMarket}
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
                  description={`Evaluated separately on each market; holds up to ${Math.min(config.portfolioDefaults?.maxPositions ?? 4, markets.length)} positions.`}
                >
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
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

              <ProductSection
                title="Limits"
                description="Ceilings the contract enforces on every trade. Frozen when the vault goes live."
              >
                <div className="space-y-3">
                  <Segmented label="Order size" hint="Share of vault NAV per order." options={ORDER_SIZE_CHOICES} value={pctBps} onChange={setPctBps} disabled={busy} />
                  <Segmented label="Max leverage" hint="Hard cap the contract enforces." options={LEVERAGE_CHOICES} value={maxLeverageX100} onChange={setMaxLeverageX100} disabled={busy} />
                  <Segmented label="Trade cadence" hint="Minimum time between bars." options={CADENCE_CHOICES} value={minBarIntervalS} onChange={setMinBarIntervalS} disabled={busy} />
                  <Segmented label="Seed capital" hint="Your own USDC, at risk." options={SEED_CHOICES.map((v) => ({ label: `${v}`, value: v }))} value={seedUsdc} onChange={setSeedUsdc} disabled={busy} />
                  <p className="border-t border-card-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
                    Slippage {(config?.defaults.slippageBps ?? 30) / 100}% and the{" "}
                    {config?.economics.feeIntervalDays ?? 30}-day fee interval are protocol floors, not choices.
                  </p>
                </div>
              </ProductSection>

              <ProductSection title="Source & operation">
                <div className="space-y-3">
                  <div>
                    <p className="mb-1.5 font-display text-xs font-semibold text-foreground">Source visibility</p>
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
                    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                      {isPrivate
                        ? "Only a commitment goes on-chain. Reveal later to prove every trade came from it."
                        : "Published with the vault so anyone can check it against the trades it made."}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 font-display text-xs font-semibold text-foreground">Who runs it</p>
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
                    <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                      {managed
                        ? "Runs every minute automatically. We keep an encrypted copy to execute it — so we can technically read it."
                        : "We never receive your source. The vault trades only while your attestor is running."}
                    </p>
                  </div>
                </div>
              </ProductSection>

              {/* The heavy panes. Each mounts only once opened. */}
              <Disclosure label="View strategy source" detail={sourceLabel} open={sourceOpen} onToggle={setSourceOpen}>
                {sourceOpen && (selected || usingCustom) && (
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
                    onReset={resetSource}
                  />
                )}
              </Disclosure>

              <Disclosure label="Preview on chart" detail={previewMarket} open={chartOpen} onToggle={setChartOpen} flush>
                {chartOpen && effectivePine && (
                  <PineVisualPreview
                    asset={previewMarket}
                    embedded
                    pineScript={effectivePine}
                    title={activeMarketplaceSelection?.title ?? selected?.label}
                  />
                )}
              </Disclosure>

              <Disclosure label="Backtest" detail="fees and funding included" open={backtestOpen} onToggle={setBacktestOpen}>
                {backtestOpen && effectivePine && (
                  <SealedBacktest
                    asset={primaryMarket}
                    markets={markets}
                    initialCapital={seedUsdc}
                    maxLeverageX100={maxLeverageX100}
                    pctBps={pctBps}
                    pineScript={effectivePine}
                    slippageBps={config?.defaults?.slippageBps ?? 30}
                  />
                )}
              </Disclosure>
            </div>
          )}

          {/* ══ Step 3 · Name & fund ══ */}
          {stage === 3 && (
            <div className="divide-y divide-card-border">
              <ProductSection
                title={<label htmlFor="vault-name">Vault name</label>}
                description="The public name depositors see. Your source stays separate."
              >
                <input
                  id="vault-name"
                  value={vaultName}
                  onChange={(e) => {
                    nameTouched.current = true;
                    setVaultName(e.target.value);
                  }}
                  disabled={busy || live}
                  placeholder="Momentum Alpha"
                  className={inputCls}
                />
              </ProductSection>

              {/* Cost — every number from /api/sealed/config, nothing hard-coded. */}
              {config ? (
                <ProductSection
                  title="Required to launch"
                  action={(
                    <span className="font-mono text-base font-semibold tabular-nums text-accent">
                      {totalUsdc} USDC
                    </span>
                  )}
                >
                  <dl className="space-y-1.5">
                    <RailRow k="Decibel protocol fee" v={`${config.economics.creationFeeUsdc} USDC`} />
                    <RailRow k="Our launch fee" v={`${config.economics.launchFeeUsdc} USDC`} />
                    <RailRow k="Starting capital" v={`${seedUsdc} USDC`} tone="warn" />
                  </dl>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Starting capital is not a fee — it is traded by the strategy and exposed to its
                    gains and losses. The launch fee is once per vault; swapping strategies later is free.
                  </p>
                  {connected && (
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
                  )}
                  <dl className="mt-2.5 space-y-1.5 border-t border-card-border pt-2.5">
                    <RailRow
                      k="Performance fee"
                      v={`${config.economics.depositorPaysPct}%`}
                      note={feeSplit ?? undefined}
                    />
                    <RailRow
                      k="Trading fee"
                      v={`${config.economics.builderFeeBps / 100}%`}
                      note="Per fill, on notional."
                    />
                  </dl>
                  {!config.economics.termsOnChain && (
                    <p className="mt-2 text-xs leading-relaxed text-warning/90">
                      Estimated — the contract isn&apos;t deployed here, so these are defaults.
                    </p>
                  )}
                </ProductSection>
              ) : (
                <ProductSection title="Required to launch">
                  {configError ? (
                    <p className="text-xs text-muted-foreground">Costs unavailable — launch settings did not load.</p>
                  ) : (
                    <div className="space-y-1.5" aria-busy>
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-4 animate-pulse rounded-[var(--radius-xs)] bg-card motion-reduce:animate-none" />
                      ))}
                    </div>
                  )}
                </ProductSection>
              )}

              {/* Risk, immediately before the action */}
              {config && (
                <ProductSection title="Before you launch">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
                    <Review k="Strategy" v={sourceLabel} />
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
                    <Review k="Source" v={isPrivate ? "Private" : "Public"} />
                  </dl>
                  {(scriptPctBps !== null || scriptLeverageX100 !== null) && (
                    <p className="mt-2.5 border-t border-card-border pt-2.5 text-xs leading-relaxed text-foreground-secondary">
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
                          size caps it.
                        </>
                      ) : scriptLeverageX100 !== null && scriptLeverageX100 > maxLeverageX100 ? (
                        <>
                          It asks for {scriptLeverageX100 / 100}x; the {maxLeverageX100 / 100}x cap
                          limits it.
                        </>
                      ) : (
                        <>The limits you set are ceilings it stays inside.</>
                      )}
                    </p>
                  )}
                  <p className="mt-2.5 border-t border-card-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
                    Leveraged perpetual futures. At {effectiveLeverageX100 / 100}x, a{" "}
                    <span className="font-semibold text-foreground">
                      {(100 / (effectiveLeverageX100 / 100)).toFixed(0)}%
                    </span>{" "}
                    adverse move wipes out the capital behind a full-size position. On-chain
                    enforcement guarantees the vault follows your rules — not that they are
                    profitable.
                  </p>
                  {!started && !previewMode && connected && (
                    <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                      Three wallet signatures — Decibel requires each to be its own transaction.
                    </p>
                  )}
                </ProductSection>
              )}

              {/* Live pipeline, errors, success */}
              {(busy || started || error) && (
                <div className="space-y-3 p-4">
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

                  <AnimatePresence>
                    {error && (
                      <Banner tone="error" onDismiss={() => { setError(null); setErrorList([]); }}>
                        <span className="block font-semibold">{error}</span>
                        {errorList.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {errorList.map((e) => (
                              <li key={e} className="text-xs leading-relaxed text-destructive/80">• {e}</li>
                            ))}
                          </ul>
                        )}
                        {started && !live && (
                          <span className="mt-2 block text-xs leading-relaxed text-destructive/70">
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
                        <span className="block font-semibold">Your vault is live and trading.</span>
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
              )}
            </div>
          )}

          {/* Desktop action row. On a phone the same controls sit in a fixed bottom bar. */}
          <div className="hidden border-t border-card-border bg-background-secondary p-3 lg:block">
            {footer(false)}
          </div>
        </ProductPanel>
      </div>

      {/*
        Mobile action bar. Fixed to the viewport so the primary action is always one thumb
        away, with the total beside it so the commitment is never out of sight.
      */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden"
      >
        {footer(true)}
      </div>

      {/* Spacer so the bar never covers the last card. */}
      <div className="h-24 lg:hidden" aria-hidden />
    </div>
  );
}

const inputCls =
  "min-h-11 w-full rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:text-[13px]";

/** A collapsed section. The heavy children are the caller's to mount only when `open`. */
function Disclosure({
  label,
  detail,
  open,
  onToggle,
  flush,
  children,
}: {
  label: string;
  detail?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** No inner padding — for full-bleed content like the chart. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="group"
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-display text-[13px] font-semibold text-foreground-secondary hover:text-foreground [&::-webkit-details-marker]:hidden",
          FOCUS_RING,
        )}
      >
        <span>{label}</span>
        {detail && <span className="min-w-0 truncate font-normal text-muted-foreground">· {detail}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className={cn("border-t border-card-border", flush ? "" : "px-4 py-3.5")}>
        {children}
      </div>
    </details>
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
        <span className="font-display text-xs font-semibold text-foreground">{label}</span>
        <span className="text-right text-xs leading-relaxed text-muted-foreground">{hint}</span>
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
              "min-h-9 flex-1 rounded-[var(--radius-xs)] px-2 py-1.5 font-mono text-xs tabular-nums transition-colors disabled:opacity-50",
              PRODUCT_PRESSABLE_CLASS, FOCUS_RING,
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

/** A two-way choice. Full-width row rather than a half-width card — at 360px the
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
        FOCUS_RING,
        "min-h-11 p-2.5 text-left disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-accent/30 bg-accent/[0.06]"
          : "hover:border-border-strong hover:bg-card-hover",
      )}
    >
      <span className={cn("flex items-center gap-1.5", active ? "text-accent" : "text-foreground-secondary")}>
        {icon}
        <span className="font-display text-[13px] font-semibold">{title}</span>
      </span>
      <span className="sr-only">{body}</span>
    </button>
  );
}

/** A single money line. */
function RailRow({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: "warn" }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-foreground-secondary">{k}</dt>
        <dd
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            tone === "warn" ? "text-warning" : "text-foreground",
          )}
        >
          {v}
        </dd>
      </div>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{note}</p>}
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
      className={cn("group inline-flex min-w-0 items-center gap-1.5 rounded-[var(--radius-xs)] text-[11px] text-muted-foreground transition-colors hover:text-accent", FOCUS_RING)}
    >
      <span className="w-14 shrink-0">{label}</span>
      <span className="truncate font-mono">{addr}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    </a>
  );
}

/** Small metadata chip. Deliberately readable rather than 9px uppercase. */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-card-hover px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
      {children}
    </span>
  );
}

function Review({ k, v, tone }: { k: string; v: string; tone?: "warn" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={cn("mt-0.5 truncate font-display text-[13px] font-semibold", tone === "warn" ? "text-warning" : "text-foreground")}>
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
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono tabular-nums">
        <span className={ok ? "text-accent" : known ? "text-warning" : "text-muted-foreground"}>
          {known ? have.toFixed(2) : "—"}
        </span>
        <span className="text-muted-foreground"> / {need} USDC</span>
        {known && !ok && (
          <span className="ml-1.5 text-warning">add {(need - have).toFixed(2)}</span>
        )}
      </span>
    </div>
  );
}
