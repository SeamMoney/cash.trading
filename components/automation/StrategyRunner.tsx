"use client";

/**
 * /automation — the Personal Strategy Runner.
 *
 * One page, one job: pick a catalog Pine strategy, pick a market and caps, sign
 * one delegation, and let the per-minute cron trade YOUR OWN Decibel subaccount
 * through the operator key. No vault, no shares — the position is yours and the
 * volume earns your points.
 *
 * Two things this page is deliberately careful about:
 *
 *  1. Polling. `/api/bot/status` is polled every 10s **only** while a runner is
 *     actually running AND the tab is visible. An idle or hidden tab issues zero
 *     requests — unconditional polling is what exhausted the RPC credit and took
 *     the app's data offline once already.
 *
 *  2. Honesty about cost. Every fill pays taker fees plus the 0.10% builder fee,
 *     and `capitalUSDC` is both the position size and the realised-loss budget
 *     the cron stops on. Both are stated on the page rather than discovered.
 *
 * House style: docs/UX-GRADING.md § 4 — every panel, button, input and segment
 * on the page is a recipe imported from components/portfolio/portfolio-surface.ts,
 * so this page has no private palette to drift.
 *
 * Layout: on a wide screen the strategy list is one column, the form and its
 * status the other, so the one accent-filled control on the page ("Run on my
 * account") sits inside the first screen instead of below seven boxes. Below
 * `lg` there is only one column, so the list collapses to the chosen strategy
 * and the other six move behind the app's own sheet — same rows, ~600px less
 * scroll above the button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Header, PageConnectCta } from "@/components/layout/Header";
import {
  BUTTON_NEUTRAL,
  BUTTON_PRIMARY,
  INPUT,
  INPUT_LABEL,
  PANEL,
  PANEL_TITLE,
  ROW_ACTION,
  SECTION_TITLE,
  SEGMENTED,
  SEGMENTED_ITEM,
  SEGMENTED_ITEM_ACTIVE,
} from "@/components/portfolio/portfolio-surface";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useDecibelTransactionSubmitter } from "@/hooks/useDecibelTransactionSubmitter";
import { useDelegation } from "@/hooks/use-delegation";
import { ensureBuilderApproval } from "@/lib/decibel-builder-approval";
import { FLIP_RATE, SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";
import { FOCUS_RING, PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";

/* ── Surfaces ────────────────────────────────────────────────────────────── */

/**
 * Every shape on this page now comes from components/portfolio/portfolio-surface.ts
 * — the file that named this one in its own TODO. What is left below is the two
 * panel strips and three layout strings that carry no colour, radius or type of
 * their own, so nothing here can drift away from the rest of the app.
 */
const PANEL_HEAD =
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-card-border px-4 py-3";
const PANEL_BODY = "px-4 py-3.5";
const HELP = "text-[11px] leading-snug text-muted-foreground";

/** One height rule for every control: 44px on a phone, the canonical 40 above. */
const TOUCH = "min-h-11 sm:min-h-10";
/** Buttons fill the row on a phone and size to their label from `sm` up. */
const ACTION = `${TOUCH} w-full sm:w-auto`;
/** Segmented options share their row and dim while the runner is live. */
const SEGMENT = "flex-1 justify-center disabled:pointer-events-none disabled:opacity-40";

/** One catalog row. The inline list and the picker sheet render the same one. */
const STRATEGY_ROW =
  "flex w-full items-start gap-3 border-t border-card-border px-4 py-3 text-left first:border-t-0 disabled:pointer-events-none disabled:opacity-40";

const ROW = "flex items-baseline justify-between gap-3 py-2";
const ROW_LABEL = "shrink-0 text-[13px] text-muted-foreground";
const ROW_VALUE =
  "min-w-0 break-words text-right font-mono text-[13px] tabular-nums text-foreground";

/* ── Catalog ─────────────────────────────────────────────────────────────── */

/**
 * Display order, mirroring the launchpad: the three with the most defensible
 * default behaviour lead, and Swing Consensus — eight votes, the weakest
 * backtest — goes last rather than being the thing preselected for everyone.
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

const ORDERED_CATALOG: CatalogStrategy[] = [...SEALED_CATALOG].sort((a, b) => {
  const rank = (s: CatalogStrategy) => {
    const i = CATALOG_ORDER.indexOf(s.id);
    return i === -1 ? CATALOG_ORDER.length - 1.5 : i;
  };
  return rank(a) - rank(b);
});

const DEFAULT_STRATEGY_ID = ORDERED_CATALOG[0]?.id ?? "breakout-channel";

/**
 * One catalog row: the dot, the name, the plain-English grades, the blurb.
 *
 * `picker` turns the same row into the phone's summary — it stops being a radio
 * and becomes the control that opens the sheet holding the full list, so there
 * is one row shape on this page rather than a list row and a summary row that
 * can drift apart.
 */
function StrategyRow({
  strategy,
  active,
  disabled,
  onSelect,
  picker = false,
  className,
}: {
  strategy: CatalogStrategy;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  picker?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={picker ? undefined : "radio"}
      aria-checked={picker ? undefined : active}
      aria-haspopup={picker ? "dialog" : undefined}
      aria-label={picker ? `Strategy: ${strategy.label}. Change strategy` : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        STRATEGY_ROW,
        PRESSABLE_CONTROL,
        FOCUS_RING,
        active ? "bg-accent/[0.06]" : "hover:bg-card",
        className,
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
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span
            className={cn(
              "text-[13px] font-semibold",
              active ? "text-foreground" : "text-foreground-secondary",
            )}
          >
            {strategy.label}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {strategy.category} · {FLIP_RATE[strategy.turnover]}
            {strategy.selfSizing ? " · capped by your limits" : ""}
          </span>
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {strategy.blurb}
        </span>
      </span>
      {picker ? (
        <span
          aria-hidden
          /* 44px tall and 13px, the same floor every other inline action on
             the app holds. It was an 11px line of text with no height of its
             own — the smallest tap target on the page. */
          className="inline-flex min-h-11 shrink-0 items-center self-center text-[13px] text-muted-foreground underline underline-offset-4"
        >
          Change
        </span>
      ) : null}
    </button>
  );
}

/* ── Settings ────────────────────────────────────────────────────────────── */

const BAR_INTERVALS = ["1m", "5m", "15m"] as const;
type BarInterval = (typeof BAR_INTERVALS)[number];

/** The interval in words, so the helper line reads as a sentence. */
const INTERVAL_WORD: Record<BarInterval, string> = {
  "1m": "minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
};

/** Matches PINE_DEFAULT_MAX_LEVERAGE_X in app/api/bot/start/route.ts. */
const LEVERAGE_CHOICES = [1, 2, 3] as const;
const SIZE_PCTS = [5, 10, 25] as const;

/** The engine commits 90% of `capitalUSDC` per entry (bot-engine CAPITAL_USAGE_PCT). */
const CAPITAL_USAGE_PCT = 0.9;

/**
 * `volumeTargetUSDC` is a required, positive ceiling the cron stops on, but it
 * is not the budget this product is about — the capital/loss budget is. Rather
 * than add a control nobody asked for, derive a generous ceiling from the caps
 * the user *did* set and show the resulting number in Status, so the stop
 * condition is never a surprise.
 */
const VOLUME_TARGET_ENTRIES = 1000;

const DEFAULT_MARKET = "BTC/USD";
const PREFERRED_MARKETS = ["BTC/USD", "ETH/USD", "SOL/USD", "APT/USD"];

/* ── Types ───────────────────────────────────────────────────────────────── */

type Market = {
  name: string;
  address: string;
  markPrice: number | null;
  maxLeverage: number | null;
};

type BotStatus = {
  isRunning: boolean;
  status: {
    cumulativeVolume: number;
    volumeTargetUSDC: number;
    ordersPlaced: number;
    currentCapitalUsed: number;
    error: string | null;
    lastSignal: string | null;
    lastSignalAt: string | null;
    lastBarTs: number | null;
  } | null;
  config: {
    marketName: string;
    market: string;
    capitalUSDC: number;
    leverageX: number | null;
    strategyId: string | null;
    barInterval: string | null;
  } | null;
};

type ChainPosition = {
  market: string;
  marketAddress: string | null;
  size: number;
  isLong: boolean;
  entryPrice: number;
  estimatedPnl: number | null;
};

type Account = {
  equity: number | null;
  positions: ChainPosition[];
};

type Phase = "idle" | "builder" | "delegating" | "starting" | "stopping";

/* ── Formatting ──────────────────────────────────────────────────────────── */

function usd(value: number | null | undefined, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? "always" : "auto",
  });
}

function compactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

function clockTime(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

const SIGNAL_WORD: Record<string, string> = {
  buy: "Long",
  sell: "Short",
  neutral: "Flat",
};

/** "BTC/USD" → "BTC". A bare position size with no unit is not a number. */
function baseAsset(marketName: string | null | undefined): string {
  return (marketName ?? "").split("/")[0] || "";
}

/** Never show a raw SDK or HTTP string. Say what happened and what to do. */
function readableError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const text = raw.trim();
  if (!text) return fallback;
  if (/user rejected|rejected the request|denied|cancell?ed/i.test(text)) {
    return "You cancelled the signature. Nothing was started.";
  }
  if (/not authorized/i.test(text)) {
    return "This wallet is not authorized to run automation.";
  }
  if (/allowlist_not_configured|disabled/i.test(text)) {
    return "Automation is switched off on this deployment.";
  }
  if (/too many requests|429/i.test(text)) {
    return "Too many requests. Wait a minute and try again.";
  }
  if (/already running/i.test(text)) {
    return "A runner is already live on this account. Stop it first.";
  }
  if (text.length > 140) return fallback;
  return text;
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function StrategyRunner() {
  const { connected } = useWallet();
  const { owner, selectedSubaccount, isLoadingSubaccounts, decibelNetwork } =
    useDecibelSubaccounts();
  const { signAndSubmitDecibelTransaction } = useDecibelTransactionSubmitter();
  const { delegateTrading, revokeDelegation } = useDelegation(selectedSubaccount || null);

  const [strategyId, setStrategyId] = useState<string>(DEFAULT_STRATEGY_ID);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [marketName, setMarketName] = useState<string>(DEFAULT_MARKET);
  const [barInterval, setBarInterval] = useState<BarInterval>("5m");
  const [leverageX, setLeverageX] = useState<number>(2);
  const [sizePct, setSizePct] = useState<number | null>(10);
  const [capitalInput, setCapitalInput] = useState<string>("");

  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [marketsError, setMarketsError] = useState<string>("");
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [botError, setBotError] = useState<string>("");
  const [account, setAccount] = useState<Account | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [revoking, setRevoking] = useState(false);

  const botAbort = useRef<AbortController | null>(null);
  const accountAbort = useRef<AbortController | null>(null);

  const strategy = useMemo(
    () => ORDERED_CATALOG.find((s) => s.id === strategyId) ?? ORDERED_CATALOG[0],
    [strategyId],
  );

  /* ── Markets ───────────────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/decibel/markets?network=${decibelNetwork}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        const list: Market[] = (Array.isArray(json?.markets) ? json.markets : [])
          .filter((m: Market) => m?.name && m?.address)
          .map((m: Market) => ({
            name: m.name,
            address: m.address,
            markPrice: typeof m.markPrice === "number" ? m.markPrice : null,
            maxLeverage: typeof m.maxLeverage === "number" ? m.maxLeverage : null,
          }));
        if (cancelled) return;
        if (list.length === 0) {
          setMarkets([]);
          setMarketsError("Market list is unavailable right now.");
          return;
        }
        list.sort((a, b) => {
          const rank = (n: string) => {
            const i = PREFERRED_MARKETS.indexOf(n);
            return i === -1 ? PREFERRED_MARKETS.length : i;
          };
          return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
        });
        setMarkets(list);
        setMarketsError("");
        setMarketName((current) =>
          list.some((m) => m.name === current) ? current : list[0].name,
        );
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setMarkets([]);
        setMarketsError("Market list is unavailable right now.");
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [decibelNetwork]);

  const market = useMemo(
    () => markets?.find((m) => m.name === marketName) ?? null,
    [markets, marketName],
  );

  /** 3x is the route's own ceiling; a market may cap lower than that. */
  const leverageChoices = useMemo(() => {
    const cap = market?.maxLeverage;
    if (cap == null || !Number.isFinite(cap)) return LEVERAGE_CHOICES.slice();
    return LEVERAGE_CHOICES.filter((x) => x <= Math.max(1, Math.floor(cap)));
  }, [market]);

  useEffect(() => {
    if (leverageChoices.length === 0) return;
    if (!leverageChoices.includes(leverageX as (typeof LEVERAGE_CHOICES)[number])) {
      setLeverageX(leverageChoices[leverageChoices.length - 1]);
    }
  }, [leverageChoices, leverageX]);

  /* ── Reads ─────────────────────────────────────────────────────────────── */

  const refreshBot = useCallback(async () => {
    if (!owner || !selectedSubaccount) {
      setBot(null);
      return;
    }
    botAbort.current?.abort();
    const controller = new AbortController();
    botAbort.current = controller;
    try {
      const params = new URLSearchParams({
        userWalletAddress: owner,
        userSubaccount: selectedSubaccount,
      });
      const res = await fetch(`/api/bot/status?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(json?.error || `Status unavailable (${res.status})`);
      setBot(json as BotStatus);
      setBotError("");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setBotError(readableError(err, "Could not read the runner's status."));
    }
  }, [owner, selectedSubaccount]);

  const refreshAccount = useCallback(async () => {
    if (!selectedSubaccount) {
      setAccount(null);
      return;
    }
    accountAbort.current?.abort();
    const controller = new AbortController();
    accountAbort.current = controller;
    try {
      const params = new URLSearchParams({
        address: selectedSubaccount,
        network: decibelNetwork,
      });
      const res = await fetch(`/api/decibel/positions?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json();
      if (controller.signal.aborted || !res.ok || json?.error) return;
      setAccount({
        equity: typeof json?.overview?.equity === "number" ? json.overview.equity : null,
        positions: Array.isArray(json?.positions) ? json.positions : [],
      });
    } catch {
      /* Non-fatal: equity only pre-fills the capital field. */
    }
  }, [decibelNetwork, selectedSubaccount]);

  /* One-shot on load: the page cannot render "running or stopped" without it. */
  useEffect(() => {
    void refreshBot();
    void refreshAccount();
    return () => {
      botAbort.current?.abort();
      accountAbort.current?.abort();
    };
  }, [refreshBot, refreshAccount]);

  const running = bot?.isRunning === true;

  /**
   * 10s, and ONLY while a runner is live and the tab is on screen. A stopped
   * runner or a backgrounded tab issues zero requests — including on first
   * paint, since the interval never starts while `document.hidden`.
   */
  useEffect(() => {
    if (!running || !owner || !selectedSubaccount) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      void refreshBot();
      void refreshAccount();
    };
    const start = () => {
      if (timer || document.hidden) return;
      timer = setInterval(tick, 10_000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        tick();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running, owner, selectedSubaccount, refreshBot, refreshAccount]);

  /* ── Derived settings ──────────────────────────────────────────────────── */

  const equity = account?.equity ?? null;

  /* The percent buttons write the capital field; typing switches it to custom. */
  useEffect(() => {
    if (sizePct == null || equity == null || running) return;
    const next = Math.max(0, Math.round(equity * sizePct) / 100);
    setCapitalInput(next > 0 ? next.toFixed(2) : "");
  }, [equity, running, sizePct]);

  const capitalUSDC = useMemo(() => {
    const n = Number(capitalInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [capitalInput]);

  const notionalPerEntry = capitalUSDC * CAPITAL_USAGE_PCT * leverageX;
  const volumeTargetUSDC = useMemo(
    () => Math.max(1, Math.round(notionalPerEntry * VOLUME_TARGET_ENTRIES)),
    [notionalPerEntry],
  );

  /* ── States ────────────────────────────────────────────────────────────── */

  const loading = connected && isLoadingSubaccounts && !selectedSubaccount;
  const noSubaccount = connected && !isLoadingSubaccounts && !selectedSubaccount;
  const busy = phase !== "idle";
  const locked = running || busy;

  /**
   * The Running/Stopped badge is a claim about THIS account, so it may only
   * render once a status has actually come back for it. Disconnected, still
   * loading, no subaccount, or a failed read all mean "not known" — and the
   * body of the panel says so in words.
   */
  const statusKnown = connected && bot !== null && !botError;

  const startBlockedReason = !connected
    ? ""
    : noSubaccount
      ? "Deposit into a Decibel account first."
      : !market
        ? "Pick a market."
        : capitalUSDC <= 0
          ? "Enter the capital this runner may use."
          : "";

  /* ── Actions ───────────────────────────────────────────────────────────── */

  const run = useCallback(async () => {
    if (!connected) {
      window.dispatchEvent(new Event("cash:open-wallet-selector"));
      return;
    }
    if (!owner || !selectedSubaccount || !market || capitalUSDC <= 0) return;

    setError("");
    setNote("");
    try {
      // First run only: the one-time builder-fee consent, so this account's
      // fills carry the cash.trading code. Never blocks — a decline just means
      // the code earns nothing.
      setPhase("builder");
      setNote("Checking fee routing…");
      await ensureBuilderApproval({
        subaccount: selectedSubaccount,
        network: decibelNetwork,
        signAndSubmit: signAndSubmitDecibelTransaction as never,
        onStep: (message) => setNote(message),
      });

      // Authoritative delegation read: the hook's own check writes React state
      // this handler cannot observe in time, and guessing here costs the user
      // a redundant on-chain signature.
      setNote("Checking trading permission…");
      const params = new URLSearchParams({
        userSubaccount: selectedSubaccount,
        userWalletAddress: owner,
      });
      const checkRes = await fetch(`/api/bot/check-delegation?${params}`, {
        cache: "no-store",
      });
      const checkJson = await checkRes.json();
      if (!checkRes.ok) throw new Error(checkJson?.error || "Could not check trading permission.");

      if (checkJson?.hasDelegation !== true) {
        setPhase("delegating");
        setNote("Approve trading permission in your wallet (expires in 30 days).");
        const ok = await delegateTrading();
        if (!ok) throw new Error("Trading permission was not granted.");
      }

      setPhase("starting");
      setNote("Starting the runner…");
      const res = await fetch("/api/bot/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userWalletAddress: owner,
          userSubaccount: selectedSubaccount,
          strategy: "pine",
          strategyId,
          barInterval,
          leverageX,
          capitalUSDC,
          volumeTargetUSDC,
          bias: "neutral",
          market: market.address,
          marketName: market.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Could not start the runner (${res.status})`);

      setNote("Running. The next closed candle is the first one it can trade.");
      await refreshBot();
      await refreshAccount();
    } catch (err) {
      setNote("");
      setError(readableError(err, "Could not start the runner. Nothing was started."));
    } finally {
      setPhase("idle");
    }
  }, [
    barInterval,
    capitalUSDC,
    connected,
    decibelNetwork,
    delegateTrading,
    leverageX,
    market,
    owner,
    refreshAccount,
    refreshBot,
    selectedSubaccount,
    signAndSubmitDecibelTransaction,
    strategyId,
    volumeTargetUSDC,
  ]);

  const stop = useCallback(async () => {
    if (!owner || !selectedSubaccount) return;
    setError("");
    setPhase("stopping");
    setNote("Stopping and closing any open position…");
    try {
      const res = await fetch("/api/bot/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userWalletAddress: owner, userSubaccount: selectedSubaccount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Could not stop the runner (${res.status})`);
      setNote(
        json?.closedPosition
          ? "Stopped. The close is filling over the next minute or two."
          : "Stopped.",
      );
      await refreshBot();
      await refreshAccount();
    } catch (err) {
      setNote("");
      setError(readableError(err, "Could not stop the runner. Try again."));
    } finally {
      setPhase("idle");
    }
  }, [owner, refreshAccount, refreshBot, selectedSubaccount]);

  const revoke = useCallback(async () => {
    if (!selectedSubaccount) return;
    setError("");
    setRevoking(true);
    setNote("Revoking trading permission…");
    try {
      const ok = await revokeDelegation();
      setNote(ok ? "Trading permission revoked." : "");
      if (!ok) setError("Trading permission was not revoked.");
    } catch (err) {
      setNote("");
      setError(readableError(err, "Could not revoke trading permission."));
    } finally {
      setRevoking(false);
    }
  }, [revokeDelegation, selectedSubaccount]);

  /* ── Status values ─────────────────────────────────────────────────────── */

  const runningConfig = running ? bot?.config ?? null : null;
  const runningStatus = running ? bot?.status ?? null : null;
  const position = useMemo(() => {
    if (!runningConfig || !account) return null;
    const addr = runningConfig.market?.toLowerCase();
    return (
      account.positions.find((p) => p.marketAddress?.toLowerCase() === addr) ??
      account.positions.find((p) => p.market === runningConfig.marketName) ??
      null
    );
  }, [account, runningConfig]);

  const runningStrategy = runningConfig?.strategyId
    ? ORDERED_CATALOG.find((s) => s.id === runningConfig.strategyId) ?? null
    : null;

  const primaryLabel = !connected
    ? "Connect wallet"
    : phase === "builder" || phase === "delegating"
      ? "Waiting for your wallet…"
      : phase === "starting"
        ? "Starting…"
        : "Run on my account";

  return (
    /* PageConnectCta: disconnected, this page's own accent primary reads
       "Connect wallet", so the header drops its outline copy of the same act. */
    <PageConnectCta present={!connected}>
    <div className="cash-trade-theme min-h-screen bg-background text-zinc-200">
      <Header />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
        <div className="mb-6">
          <h1 className={SECTION_TITLE}>Strategy runner</h1>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            It trades your own Decibel account. No vault, no shares — the position
            and the points are yours.
          </p>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* ── Strategy ───────────────────────────────────────────────── */}
          <section className={PANEL}>
            <div className={PANEL_HEAD}>
              <h2 className={PANEL_TITLE}>Strategy</h2>
              <p className={HELP}>Acts when a period ends, never mid-move</p>
            </div>
            {/* One column below lg: seven rows would push the page's one
                accent button ~1400px down, so the phone gets the chosen row
                and the other six move into the sheet below — same rows, same
                radiogroup, no extra chrome. */}
            <StrategyRow
              strategy={strategy}
              active
              disabled={locked}
              picker
              onSelect={() => setPickerOpen(true)}
              className="border-t-0 hover:bg-accent/[0.1] lg:hidden"
            />
            <div role="radiogroup" aria-label="Strategy" className="hidden lg:block">
              {ORDERED_CATALOG.map((s) => (
                <StrategyRow
                  key={s.id}
                  strategy={s}
                  active={s.id === strategyId}
                  disabled={locked}
                  onSelect={() => setStrategyId(s.id)}
                />
              ))}
            </div>
          </section>

          {/* ── Settings, then Status ──────────────────────────────────── */}
          <div className="grid content-start gap-6">
            {/* ── Settings ─────────────────────────────────────────────── */}
            <section className={PANEL}>
              {/* The action is the first thing in this panel, not the last.
                  Below `lg` the five settings stack, and with the button under
                  them it measured y=1059 in an 844-tall phone — ~300px past
                  the fold, so the page's one purpose was on the second screen.
                  Every field below it has a working default (capital fills
                  from your equity), and the line under the button names the
                  one thing still missing when something is. */}
              <div className={cn(PANEL_BODY, "border-b border-card-border")}>
                {running ? (
                  <button
                    type="button"
                    onClick={() => void stop()}
                    disabled={phase === "stopping"}
                    className={cn(BUTTON_NEUTRAL, TOUCH, "w-full")}
                  >
                    {phase === "stopping" ? "Stopping…" : "Stop runner"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void run()}
                    disabled={busy || Boolean(startBlockedReason)}
                    title={startBlockedReason || undefined}
                    className={cn(BUTTON_PRIMARY, TOUCH, "w-full")}
                  >
                    {primaryLabel}
                  </button>
                )}
                <p className={cn(HELP, "mt-2")} aria-live="polite">
                  {error ? (
                    <span className="text-danger">{error}</span>
                  ) : note ? (
                    note
                  ) : startBlockedReason ? (
                    startBlockedReason
                  ) : connected ? (
                    "One signature the first time, then it trades on its own."
                  ) : (
                    "Connect a wallet to run a strategy on your own account."
                  )}
                </p>
                <p className={cn(HELP, "mt-1")}>
                  Taker fees and a 0.10% builder fee apply on every fill
                </p>
              </div>

              <div className={PANEL_HEAD}>
                <h2 className={PANEL_TITLE}>Settings</h2>
                {locked ? (
                  <p className={HELP}>Stop the runner to change these</p>
                ) : null}
              </div>

              <div className={cn(PANEL_BODY, "grid gap-4 sm:grid-cols-2")}>
                <div>
                  <label htmlFor="runner-market" className={INPUT_LABEL}>
                    Market
                  </label>
                  {markets === null ? (
                    <div
                      className={cn(INPUT, TOUCH, "animate-pulse bg-background-tertiary")}
                      aria-hidden
                    />
                  ) : (
                    <select
                      id="runner-market"
                      value={marketName}
                      disabled={locked || markets.length === 0}
                      onChange={(e) => setMarketName(e.target.value)}
                      className={cn(INPUT, TOUCH)}
                    >
                      {markets.map((m) => (
                        <option key={m.address} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className={cn(HELP, "mt-1.5")}>
                    {marketsError
                      ? marketsError
                      : market?.markPrice != null
                        ? `Mark ${usd(market.markPrice)}`
                        : "Loading markets…"}
                  </p>
                </div>

                <div>
                  <span className={INPUT_LABEL} id="runner-interval-label">
                    Decides every
                  </span>
                  <div className={cn(SEGMENTED, "mt-1")} role="group" aria-labelledby="runner-interval-label">
                    {BAR_INTERVALS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={barInterval === value}
                        disabled={locked}
                        onClick={() => setBarInterval(value)}
                        className={cn(
                          SEGMENTED_ITEM,
                          SEGMENT,
                          barInterval === value && SEGMENTED_ITEM_ACTIVE,
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <p className={cn(HELP, "mt-1.5")}>
                    Checks the price once every {INTERVAL_WORD[barInterval]}.
                  </p>
                </div>

                <div>
                  <span className={INPUT_LABEL} id="runner-leverage-label">
                    Leverage
                  </span>
                  <div className={cn(SEGMENTED, "mt-1")} role="group" aria-labelledby="runner-leverage-label">
                    {leverageChoices.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={leverageX === value}
                        disabled={locked}
                        onClick={() => setLeverageX(value)}
                        className={cn(
                          SEGMENTED_ITEM,
                          SEGMENT,
                          leverageX === value && SEGMENTED_ITEM_ACTIVE,
                        )}
                      >
                        {value}×
                      </button>
                    ))}
                  </div>
                  <p className={cn(HELP, "mt-1.5")}>
                    Capped at 3×. A strategy asking for more is held to it.
                  </p>
                </div>

                <div>
                  <span className={INPUT_LABEL} id="runner-size-label">
                    Size
                  </span>
                  <div className={cn(SEGMENTED, "mt-1")} role="group" aria-labelledby="runner-size-label">
                    {SIZE_PCTS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={sizePct === value}
                        disabled={locked || equity == null}
                        title={equity == null ? "Needs your account equity" : undefined}
                        onClick={() => setSizePct(value)}
                        className={cn(
                          SEGMENTED_ITEM,
                          SEGMENT,
                          sizePct === value && SEGMENTED_ITEM_ACTIVE,
                        )}
                      >
                        {value}%
                      </button>
                    ))}
                  </div>
                  <p className={cn(HELP, "mt-1.5")}>
                    {equity == null
                      ? "Percent of equity. Type an amount until your balance loads."
                      : `Percent of your ${usd(equity)} equity.`}
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="runner-capital" className={INPUT_LABEL}>
                    Capital (USDC)
                  </label>
                  <input
                    id="runner-capital"
                    type="text"
                    inputMode="decimal"
                    value={capitalInput}
                    disabled={locked}
                    placeholder="0.00"
                    onChange={(e) => {
                      const next = e.target.value.replace(/[^0-9.]/g, "");
                      setCapitalInput(next);
                      setSizePct(null);
                    }}
                    className={cn(INPUT, TOUCH, "tabular-nums")}
                  />
                  <p className={cn(HELP, "mt-1.5")}>
                    Sizes every entry and caps realised loss. The runner stops when losses
                    reach it.{" "}
                    {capitalUSDC > 0
                      ? `About ${usd(notionalPerEntry)} of position per entry at ${leverageX}×.`
                      : ""}
                  </p>
                </div>
              </div>

            </section>

            {/* ── Status ───────────────────────────────────────────────── */}
            <aside aria-labelledby="runner-status-title" className={PANEL}>
              <div className={PANEL_HEAD}>
                <h2 id="runner-status-title" className={PANEL_TITLE}>
                  Status
                </h2>
                {/* Only claim a state once this account's status has been read. */}
                {statusKnown ? (
                  <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        running ? "bg-accent" : "bg-muted-foreground",
                      )}
                    />
                    {running ? "Running" : "Stopped"}
                  </span>
                ) : null}
              </div>

              <div className={PANEL_BODY}>
                {loading ? (
                  <div className="grid gap-2" aria-hidden>
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-9 animate-pulse rounded-[var(--radius-sm)] bg-background-tertiary"
                      />
                    ))}
                  </div>
                ) : !connected ? (
                  /* The action lives once on this page — the primary button
                     directly above already reads "Connect wallet". */
                  <p className="text-[13px] text-muted-foreground">
                    Connect a wallet to see whether a runner is live on your account.
                  </p>
                ) : noSubaccount ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">
                      No Decibel account on this wallet yet. Deposit USDC to open one.
                    </p>
                    <Link href="/portfolio" className={cn(BUTTON_NEUTRAL, ACTION, "mt-3")}>
                      Deposit USDC
                    </Link>
                  </>
                ) : botError ? (
                  <>
                    <p className="text-[13px] text-danger">{botError}</p>
                    <button
                      type="button"
                      onClick={() => void refreshBot()}
                      className={cn(BUTTON_NEUTRAL, ACTION, "mt-3")}
                    >
                      Try again
                    </button>
                  </>
                ) : !running ? (
                  <p className="text-[13px] text-muted-foreground">
                    No runner is live on this account. Pick a strategy and press
                    “Run on my account”.
                  </p>
                ) : (
                  <div className="divide-y divide-card-border">
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Strategy</span>
                      <span className="text-right text-[13px] text-foreground">
                        {runningStrategy?.label ?? runningConfig?.strategyId ?? "—"}
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Market</span>
                      <span className={ROW_VALUE}>
                        {runningConfig?.marketName ?? "—"}
                        {runningConfig?.barInterval ? ` · ${runningConfig.barInterval}` : ""}
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Last signal</span>
                      <span className="text-right text-[13px] text-foreground">
                        {runningStatus?.lastSignal
                          ? SIGNAL_WORD[runningStatus.lastSignal] ?? runningStatus.lastSignal
                          : "Waiting for the first closed bar"}
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Bar evaluated</span>
                      <span className={ROW_VALUE}>
                        {clockTime(runningStatus?.lastBarTs ?? runningStatus?.lastSignalAt)}
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Position</span>
                      <span className={ROW_VALUE}>
                        {position
                          ? `${position.isLong ? "Long" : "Short"} ${position.size} ${baseAsset(position.market ?? runningConfig?.marketName)}`.trim()
                          : "Flat"}
                      </span>
                    </div>
                    {position ? (
                      <>
                        <div className={ROW}>
                          <span className={ROW_LABEL}>Entry</span>
                          <span className={ROW_VALUE}>{usd(position.entryPrice)}</span>
                        </div>
                        <div className={ROW}>
                          <span className={ROW_LABEL}>Unrealised PnL</span>
                          <span
                            className={cn(
                              ROW_VALUE,
                              position.estimatedPnl == null
                                ? "text-muted-foreground"
                                : position.estimatedPnl >= 0
                                  ? "text-success"
                                  : "text-danger",
                            )}
                          >
                            {usd(position.estimatedPnl, true)}
                          </span>
                        </div>
                      </>
                    ) : null}
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Volume traded</span>
                      <span className={ROW_VALUE}>
                        {compactUsd(runningStatus?.cumulativeVolume)}
                      </span>
                    </div>
                    <div className={ROW}>
                      <span className={ROW_LABEL}>Fills</span>
                      <span className={ROW_VALUE}>{runningStatus?.ordersPlaced ?? 0}</span>
                    </div>
                    {runningStatus?.error ? (
                      <p className="py-2 text-xs text-danger">
                        Last tick failed: {readableError(runningStatus.error, "unknown error")}
                      </p>
                    ) : null}
                    <p className="py-2 text-[11px] leading-snug text-muted-foreground">
                      Stops on its own at{" "}
                      {compactUsd(runningStatus?.volumeTargetUSDC)} of volume or{" "}
                      {usd(runningConfig?.capitalUSDC)} of realised loss. Position and PnL
                      read from chain, refreshed every 10 seconds while this tab is open.
                    </p>
                  </div>
                )}
              </div>

              <div
                className={cn(
                  PANEL_BODY,
                  "flex flex-wrap items-center gap-x-4 border-t border-card-border",
                )}
              >
                <Link href="/points" className={cn(ROW_ACTION, "text-muted-foreground")}>
                  View points
                </Link>
                {connected && selectedSubaccount ? (
                  <button
                    type="button"
                    onClick={() => void revoke()}
                    disabled={revoking || running || busy}
                    title={
                      running
                        ? "Stop the runner before revoking its permission."
                        : undefined
                    }
                    className={cn(ROW_ACTION, "text-muted-foreground")}
                  >
                    {revoking ? "Revoking…" : "Revoke trading permission"}
                  </button>
                ) : null}
              </div>
            </aside>
          </div>
        </div>

        {/* The other six, in the same sheet the wallet and market pickers use. */}
        {pickerOpen ? (
          <ResponsiveModalSheet
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            title="Strategy"
            description="Acts when a period ends, never mid-move"
            desktopContentClassName="px-0 pb-0"
            desktopMaxWidthClassName="sm:!max-w-lg"
            mobileContentClassName="px-0"
            titleId="runner-strategy-picker-title"
          >
            {(requestClose) => (
              <div role="radiogroup" aria-label="Strategy">
                {ORDERED_CATALOG.map((s) => (
                  <StrategyRow
                    key={s.id}
                    strategy={s}
                    active={s.id === strategyId}
                    disabled={locked}
                    onSelect={() => {
                      setStrategyId(s.id);
                      requestClose();
                    }}
                  />
                ))}
              </div>
            )}
          </ResponsiveModalSheet>
        ) : null}
      </main>
    </div>
    </PageConnectCta>
  );
}
