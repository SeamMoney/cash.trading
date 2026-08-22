"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  Deserializer,
  RawTransaction,
  SimpleTransaction,
  generateUserTransactionHash,
} from "@aptos-labs/ts-sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowDownUp,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Info,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import {
  CashSwapTransactionState,
  type SwapTransactionReceipt,
} from "@/components/trade/cash-swap/CashSwapTransactionState";
import { SwapAssetButton } from "@/components/trade/swap/SwapAssetButton";
import { SwapFlowScreen } from "@/components/trade/swap/SwapFlowScreen";
import { SwapMarketLayout } from "@/components/trade/swap/SwapMarketLayout";
import { SwapQuoteAmount } from "@/components/trade/swap/SwapQuoteAmount";
import {
  SpotSwapReview,
  type SpotSwapReviewNotice,
  type SpotSwapReviewRow,
} from "@/components/trade/swap/SpotSwapReview";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import {
  confirmDecibelSpotTransaction,
  type DecibelSpotConfirmation,
  type DecibelSpotOrderIdentity,
} from "@/lib/decibel-spot-confirmation";
import { fetchDecibelSpotSettlementStatus } from "@/lib/decibel-spot-settlement-client";
import {
  clearDecibelSpotAmbiguity,
  DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX,
  DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX,
  decibelSpotAmbiguityStorageKey,
  decibelSpotPendingStorageKey,
  decibelSpotQuarantineStorageKey,
  decibelSpotWalletLockName,
  loadDecibelSpotAmbiguity,
  makeDecibelSpotExactOrderIdentity,
  normalizeDecibelSpotOwnerKey,
  persistDecibelSpotAmbiguity,
  validateDecibelSpotAmbiguityRecord,
  validateDecibelSpotAmbiguityRecovery,
  validateSignedDecibelSpotRawTransaction,
  type DecibelSpotAmbiguityPrepareResponse,
  type DecibelSpotAmbiguityRecord,
  type DecibelSpotAmbiguityResolveResponse,
} from "@/lib/decibel-spot-ambiguity";
import {
  DECIBEL_SPOT_MAX_SLIPPAGE_BPS,
  buildDecibelSpotIocPayload,
  formatDecibelSpotAtomic,
  normalizeDecibelSpotAddress,
  normalizeDecibelSpotOrderId,
  parseDecibelSpotAmountInput,
  quoteDecibelSpotExactInput,
  resolvePinnedDecibelSpotMarket,
  type DecibelSpotQuote,
  type DecibelSpotSide,
  type ValidatedDecibelSpotMarket,
  type ValidatedDecibelSpotSnapshot,
} from "@/lib/decibel-spot";
import { isAptosTransactionHash } from "@/lib/cash-orderbook-confirmation";
import { emitDecibelTradeConfirmed } from "@/lib/decibel-trade-events";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { hasCashWalletOperationEvidence } from "@/lib/wallet-operation-guard";

type AssetSymbol = "APT" | "BTC" | "USDC";
type SubmitStage = "idle" | "wallet" | "chain";
type FlowScreen = "form" | "review";
type SelectorSide = "pay" | "receive";

interface SpotBalance {
  atomic: string;
  decimals: number;
  symbol: string;
}

interface SpotBalances {
  apt: SpotBalance;
  base: SpotBalance;
  quote: SpotBalance;
}

interface MarketsResponse {
  ready: boolean;
  message?: string;
}

interface OrderbookResponse extends MarketsResponse {
  resource?: string;
  snapshot?: ValidatedDecibelSpotSnapshot;
}

interface BalancesResponse extends MarketsResponse {
  owner?: string;
  marketAddress?: string;
  balances?: SpotBalances;
}

interface StoredSpotPending {
  ambiguity?: DecibelSpotAmbiguityRecord;
  baseDecimals: number;
  baseSymbol: "APT" | "BTC";
  createdAt: number;
  hash: string;
  identity: DecibelSpotOrderIdentity;
  marketName: "APT/USDC" | "BTC/USDC";
  quoteDecimals: number;
  quoteSymbol: "USDC";
  settlementOrderId?: string;
}

type StoredSpotPendingRead =
  | { status: "none" }
  | { status: "valid"; pending: StoredSpotPending; raw: string; sourceKey: string }
  | { status: "quarantined"; reason: string };

interface ReviewSnapshot {
  receiveAmount: string;
  signature: string;
}

export interface DecibelSpotSwapProps {
  assetSelectionDisabled?: boolean;
  assetSelectorSide?: SelectorSide | null;
  initialDirection?: DecibelSpotSide;
  market: ValidatedDecibelSpotMarket;
  marketLayout?: boolean;
  onPayAssetSelect?: (currentSymbol: AssetSymbol) => void;
  onReceiveAssetSelect?: (currentSymbol: AssetSymbol) => void;
  onDirectionChange?: (direction: DecibelSpotSide) => void;
  payAssetButtonRef?: Ref<HTMLButtonElement>;
  receiveAssetButtonRef?: Ref<HTMLButtonElement>;
}

const POLL_MS = 5_000;
const APT_GAS_RESERVE_ATOMIC = 1_000_000n; // 0.01 APT
const SLIPPAGE_LABEL = `Max ${DECIBEL_SPOT_MAX_SLIPPAGE_BPS / 100}%`;

function iconFor(symbol: AssetSymbol) {
  if (symbol === "BTC") return "/tokens/btc.png";
  if (symbol === "APT") return "/tokens/apt.png";
  return "/tokens/usdc.png";
}

function groupedDecimal(value: string) {
  const [whole = "0", fraction] = value.split(".");
  const grouped = BigInt(whole || "0").toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function displayDecimals(symbol: AssetSymbol) {
  return symbol === "BTC" ? 8 : 6;
}

function formatAtomic(value: string | bigint, decimals: number, symbol: AssetSymbol) {
  return groupedDecimal(formatDecibelSpotAtomic(value, decimals, displayDecimals(symbol)));
}

function decimalFromAtomic(value: string | bigint, decimals: number, maxDecimals = decimals) {
  return formatDecibelSpotAtomic(value, decimals, maxDecimals);
}

function baseSymbol(marketName: ValidatedDecibelSpotMarket["marketName"]) {
  return marketName.startsWith("BTC") ? "BTC" as const : "APT" as const;
}

function persistPending(pending: StoredSpotPending) {
  try {
    const normalizedOwner = normalizeDecibelSpotOwnerKey(pending.identity.ownerAddress);
    const normalized = {
      ...pending,
      identity: {
        ...pending.identity,
        ownerAddress: normalizedOwner,
        marketAddress: normalizeDecibelSpotAddress(pending.identity.marketAddress),
      },
    };
    const raw = JSON.stringify(normalized);
    const key = decibelSpotPendingStorageKey(normalizedOwner);
    window.localStorage.setItem(key, raw);
    return window.localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

function readPending(owner: string): StoredSpotPendingRead {
  const normalizedOwner = normalizeDecibelSpotOwnerKey(owner);
  const normalizedKey = decibelSpotPendingStorageKey(normalizedOwner);
  const legacyKeys = [
    `${DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX}:${owner.toLowerCase()}`,
    `${DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX}:${normalizedOwner}`,
  ];
  let sourceKey = normalizedKey;
  let raw = "unreadable";
  try {
    const foundKey = [normalizedKey, ...legacyKeys]
      .find((key, index, keys) => keys.indexOf(key) === index && window.localStorage.getItem(key) !== null);
    if (!foundKey) return { status: "none" };
    sourceKey = foundKey;
    raw = window.localStorage.getItem(sourceKey) ?? "unreadable";
    if (raw === "unreadable") throw new Error("pending transaction disappeared while it was read");
    const stored = JSON.parse(raw) as Partial<StoredSpotPending>;
    const identity = stored.identity;
    if (!identity) throw new Error("pending transaction identity was missing");
    const exactIdentity = makeDecibelSpotExactOrderIdentity(identity);
    const pinned = resolvePinnedDecibelSpotMarket(exactIdentity.marketAddress);
    const originatingAmbiguity = stored.ambiguity === undefined
      ? undefined
      : validateDecibelSpotAmbiguityRecord(stored.ambiguity, normalizedOwner);
    const settlementOrderId = stored.settlementOrderId === undefined
      ? undefined
      : normalizeDecibelSpotOrderId(stored.settlementOrderId);
    if (
      !stored.hash
      || !isAptosTransactionHash(stored.hash)
      || exactIdentity.ownerAddress !== normalizedOwner
      || pinned.marketName !== stored.marketName
      || pinned.baseDecimals !== stored.baseDecimals
      || pinned.quoteDecimals !== stored.quoteDecimals
      || (stored.marketName !== "APT/USDC" && stored.marketName !== "BTC/USDC")
      || stored.baseSymbol !== baseSymbol(pinned.marketName)
      || stored.quoteSymbol !== "USDC"
      || !Number.isSafeInteger(stored.baseDecimals)
      || !Number.isSafeInteger(stored.quoteDecimals)
      || !Number.isSafeInteger(stored.createdAt)
      || Number(stored.createdAt) < 0
      || (originatingAmbiguity !== undefined
        && (
          JSON.stringify(originatingAmbiguity.identity) !== JSON.stringify(exactIdentity)
          || originatingAmbiguity.createdAt !== stored.createdAt
        ))
    ) {
      throw new Error("pending transaction fields were malformed");
    }
    const normalized: StoredSpotPending = {
      ...(stored as StoredSpotPending),
      ...(originatingAmbiguity ? { ambiguity: originatingAmbiguity } : {}),
      ...(settlementOrderId === undefined ? {} : { settlementOrderId }),
      identity: {
        ownerAddress: exactIdentity.ownerAddress,
        marketAddress: exactIdentity.marketAddress,
        priceAtomic: exactIdentity.priceAtomic,
        sizeAtomic: exactIdentity.sizeAtomic,
        isBid: exactIdentity.isBid,
      },
    };
    return { status: "valid", pending: normalized, raw, sourceKey };
  } catch {
    return {
      status: "quarantined",
      reason: "An invalid Decibel pending safety record was preserved unchanged. Retrying stays locked until it can be reviewed.",
    };
  }
}

function samePendingSubmission(left: StoredSpotPending, right: StoredSpotPending) {
  return left.hash === right.hash
    && left.baseDecimals === right.baseDecimals
    && left.baseSymbol === right.baseSymbol
    && left.createdAt === right.createdAt
    && left.marketName === right.marketName
    && left.quoteDecimals === right.quoteDecimals
    && left.quoteSymbol === right.quoteSymbol
    && JSON.stringify(left.identity) === JSON.stringify(right.identity)
    && JSON.stringify(left.ambiguity ?? null) === JSON.stringify(right.ambiguity ?? null);
}

function samePendingRecord(left: StoredSpotPending, right: StoredSpotPending) {
  return samePendingSubmission(left, right)
    && left.settlementOrderId === right.settlementOrderId;
}

function pendingSettlementBindingKey(pending: StoredSpotPending) {
  if (!pending.settlementOrderId) return "";
  return JSON.stringify([
    "decibel-spot-pending-binding-v1",
    pending.hash.toLowerCase(),
    pending.settlementOrderId,
    pending.identity.ownerAddress,
    pending.identity.marketAddress,
    pending.identity.priceAtomic,
    pending.identity.sizeAtomic,
    pending.identity.isBid,
    pending.marketName,
    pending.baseSymbol,
    pending.baseDecimals,
    pending.quoteSymbol,
    pending.quoteDecimals,
    pending.createdAt,
    pending.ambiguity ?? null,
  ]);
}

function clearPending(pending: StoredSpotPending) {
  try {
    // At most one normalized and two legacy keys can exist. Delete only records
    // that still byte-match the exact, fully validated pending request.
    for (let index = 0; index < 3; index += 1) {
      const current = readPending(pending.identity.ownerAddress);
      if (current.status === "none") return true;
      if (
        current.status !== "valid"
        || !samePendingRecord(current.pending, pending)
        || window.localStorage.getItem(current.sourceKey) !== current.raw
      ) return false;
      window.localStorage.removeItem(current.sourceKey);
      if (window.localStorage.getItem(current.sourceKey) !== null) return false;
    }
    return readPending(pending.identity.ownerAddress).status === "none";
  } catch {
    return false;
  }
}

async function requestPreparedAmbiguity(
  ownerAddress: string,
  identity: DecibelSpotOrderIdentity,
) {
  const response = await fetch("/api/decibel/spot/recovery", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", ownerAddress, identity }),
  });
  const body = await response.json() as Partial<DecibelSpotAmbiguityPrepareResponse> & { message?: string };
  if (!response.ok || !body.ready || body.action !== "prepare" || !body.ambiguity) {
    throw new Error(body.message || "Aptos account sequence could not be verified");
  }
  const ambiguity = validateDecibelSpotAmbiguityRecord(body.ambiguity, ownerAddress);
  if (
    JSON.stringify(ambiguity.identity)
      !== JSON.stringify(makeDecibelSpotExactOrderIdentity(identity))
  ) {
    throw new Error("Aptos account sequence was returned for another spot order");
  }
  return ambiguity;
}

async function requestAmbiguityRecovery(ambiguity: DecibelSpotAmbiguityRecord) {
  const response = await fetch("/api/decibel/spot/recovery", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve", ambiguity }),
  });
  const body = await response.json() as Partial<DecibelSpotAmbiguityResolveResponse> & { message?: string };
  if (!response.ok || !body.ready || body.action !== "resolve" || !body.recovery) {
    throw new Error(body.message || "Aptos wallet activity could not be verified");
  }
  return validateDecibelSpotAmbiguityRecovery(body.recovery, ambiguity);
}

async function withOwnerWalletLock<T>(owner: string, task: () => Promise<T>): Promise<T | null> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error("Safe cross-tab wallet coordination is unavailable in this browser");
  }
  return navigator.locks.request(
    decibelSpotWalletLockName(owner),
    { mode: "exclusive", ifAvailable: true },
    (lock) => lock ? task() : null,
  );
}

type PendingEnrichment =
  | { status: "ready"; pending: StoredSpotPending }
  | { status: "changed"; pending: StoredSpotPending }
  | { status: "missing" }
  | { status: "conflict" }
  | { status: "retry" };

async function enrichPendingSettlementOrder(
  stored: StoredSpotPending,
  orderId: string,
): Promise<PendingEnrichment> {
  try {
    const normalizedOrderId = normalizeDecibelSpotOrderId(orderId);
    const enriched = await withOwnerWalletLock(stored.identity.ownerAddress, async () => {
      const current = readPending(stored.identity.ownerAddress);
      if (current.status === "none") {
        const candidate = { ...stored, settlementOrderId: normalizedOrderId };
        if (persistPending(candidate)) {
          const verified = readPending(stored.identity.ownerAddress);
          if (
            verified.status === "valid"
            && samePendingRecord(verified.pending, candidate)
          ) {
            return { status: "ready" as const, pending: verified.pending };
          }
        }
        return { status: "missing" as const };
      }
      if (current.status !== "valid") return { status: "retry" as const };
      if (!samePendingSubmission(current.pending, stored)) {
        return { status: "changed" as const, pending: current.pending };
      }
      if (
        current.pending.settlementOrderId !== undefined
        && current.pending.settlementOrderId !== normalizedOrderId
      ) {
        return { status: "conflict" as const };
      }
      const candidate = {
        ...current.pending,
        settlementOrderId: normalizedOrderId,
      };
      if (
        samePendingRecord(current.pending, candidate)
        && current.sourceKey === decibelSpotPendingStorageKey(stored.identity.ownerAddress)
      ) {
        return { status: "ready" as const, pending: current.pending };
      }
      if (window.localStorage.getItem(current.sourceKey) !== current.raw) {
        return { status: "retry" as const };
      }
      if (!persistPending(candidate)) return { status: "retry" as const };
      if (current.sourceKey !== decibelSpotPendingStorageKey(stored.identity.ownerAddress)) {
        if (window.localStorage.getItem(current.sourceKey) !== current.raw) {
          return { status: "retry" as const };
        }
        window.localStorage.removeItem(current.sourceKey);
        if (window.localStorage.getItem(current.sourceKey) !== null) {
          return { status: "retry" as const };
        }
      }
      const verified = readPending(stored.identity.ownerAddress);
      if (
        verified.status !== "valid"
        || !samePendingRecord(verified.pending, candidate)
      ) {
        return { status: "retry" as const };
      }
      return { status: "ready" as const, pending: verified.pending };
    });
    return enriched ?? { status: "retry" };
  } catch {
    return { status: "retry" };
  }
}

function wasRejectedByWallet(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() === "User has rejected the request";
}

function friendlyQuoteError(
  message: string,
  side: DecibelSpotSide,
  market?: Pick<ValidatedDecibelSpotMarket, "marketName" | "minSizeRaw" | "baseDecimals">,
) {
  if (/no asks|no bids/i.test(message)) {
    return `No ${side === "buy" ? "sell" : "buy"} liquidity is available right now.`;
  }
  if (/minimum|too small|one Decibel spot lot/i.test(message)) {
    if (!market) return "Increase the amount to meet this market’s minimum order size.";
    // The on-chain minimum is denominated in the base asset for both sides.
    const minimumBase = Number(market.minSizeRaw) / 10 ** market.baseDecimals;
    return `Minimum order is ${minimumBase} ${baseSymbol(market.marketName)} per swap on Decibel.`;
  }
  if (/insufficient.*depth/i.test(message)) {
    return "There is not enough live depth for that amount.";
  }
  if (/stale/i.test(message)) return "The quote expired. Refreshing the orderbook.";
  return "A protected quote is not available for this amount.";
}

function quoteSignature(quote: DecibelSpotQuote) {
  return JSON.stringify([
    "decibel-spot-exact-input-v1",
    "aptos-mainnet",
    1,
    quote.market.marketAddress,
    quote.market.marketName,
    quote.market.baseAssetAddress,
    quote.market.quoteAssetAddress,
    quote.market.baseDecimals,
    quote.market.quoteDecimals,
    quote.market.tickSizeRaw,
    quote.market.lotSizeRaw,
    quote.market.minSizeRaw,
    quote.market.minPriceRaw,
    quote.market.maxPriceRaw,
    quote.market.assetType,
    quote.market.mode,
    quote.side,
    quote.requestedInputAtomic,
    quote.orderSizeRaw,
    quote.limitPriceRaw,
    quote.expectedBaseAmountRaw,
    quote.expectedQuoteAmountRaw,
    quote.estimatedInputUsedAtomic,
    quote.estimatedGrossOutputAtomic,
    quote.estimatedNetOutputAtomic,
    quote.estimatedMaxProtocolFeeAtomic,
    quote.minimumNetOutputAtFullFillAtomic,
    quote.maximumProtocolFeeAtFullFillAtomic,
    quote.maximumInputEscrowAtomic,
    quote.uncommittedInputAtomic,
    quote.unspentInputAtQuotedBookAtomic,
    quote.worstQuotedPriceRaw,
    quote.maxSlippageBps,
    quote.timeInForce,
    quote.timeInForceCode,
    quote.partialFillPossible,
    quote.unfilledSizeCancels,
    quote.minimumOutputAtomic,
    quote.protocolFeeIncluded,
    quote.protocolFeeAssetAddress,
    quote.maxSpotTakerFeeRateRaw,
    quote.spotFeeRateDenominator,
  ]);
}

function priceFromQuote(quote: DecibelSpotQuote) {
  const base = Number(decimalFromAtomic(
    quote.expectedBaseAmountRaw,
    quote.market.baseDecimals,
  ));
  const quoteAmount = Number(decimalFromAtomic(
    quote.expectedQuoteAmountRaw,
    quote.market.quoteDecimals,
  ));
  return base > 0 && Number.isFinite(base) && Number.isFinite(quoteAmount)
    ? quoteAmount / base
    : 0;
}

function percent(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(3)}%`;
}

function DetailRow({ label, value, tone }: {
  label: string;
  value: string;
  tone?: "warning" | "positive";
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-[12px] leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "text-right font-mono tabular-nums text-foreground-secondary",
        tone === "warning" && "text-warning",
        tone === "positive" && "text-accent",
      )}>
        {value}
      </span>
    </div>
  );
}

function EmptyFillState({ onNewSwap }: { onNewSwap: () => void }) {
  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center px-4 py-8 text-center" role="status">
      <span className="grid size-16 place-items-center rounded-full border border-card-border bg-background-elevated text-foreground-secondary">
        <Info aria-hidden="true" className="size-7" strokeWidth={2.5} />
      </span>
      <h3 data-swap-screen-heading tabIndex={-1} className="mt-5 font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground outline-none">
        No fill this time
      </h3>
      <p className="mt-2 max-w-[330px] text-pretty text-[12px] leading-5 text-foreground-secondary">
        No liquidity was available inside your protected price. The unfilled amount stayed in your wallet.
      </p>
      <button
        type="button"
        onClick={onNewSwap}
        className={cn(
          "mt-6 min-h-12 w-full rounded-[var(--radius-sm)] bg-accent px-4 text-[14px] font-semibold text-accent-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
          PRESSABLE_CONTROL,
        )}
      >
        Try a new quote
      </button>
    </div>
  );
}

export function DecibelSpotSwap({
  assetSelectionDisabled = false,
  assetSelectorSide = null,
  initialDirection = "buy",
  market,
  marketLayout = false,
  onPayAssetSelect,
  onReceiveAssetSelect,
  onDirectionChange,
  payAssetButtonRef,
  receiveAssetButtonRef,
}: DecibelSpotSwapProps) {
  const {
    account,
    connected,
    network,
    signTransaction,
    submitTransaction,
  } = useWallet();
  const reduceMotion = useReducedMotion();
  const inputId = useId();
  const inputIssueId = `${inputId}-issue`;
  const detailsPanelId = `${inputId}-details`;
  const ownerAddress = account?.address
    ? normalizeDecibelSpotOwnerKey(account.address.toString())
    : "";
  const activeOwnerRef = useRef(ownerAddress);
  activeOwnerRef.current = ownerAddress;
  const activeMarketAddressRef = useRef(market.marketAddress);
  activeMarketAddressRef.current = market.marketAddress;
  const activeNetworkChainIdRef = useRef(network?.chainId);
  activeNetworkChainIdRef.current = network?.chainId;
  const balanceRequestIdRef = useRef(0);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const reviewScreenRef = useRef<HTMLDivElement>(null);
  const transactionScreenRef = useRef<HTMLDivElement>(null);
  const focusedScreenRef = useRef("form");

  const [direction, setDirection] = useState<DecibelSpotSide>(initialDirection);
  const [amount, setAmount] = useState("");
  const [snapshot, setSnapshot] = useState<ValidatedDecibelSpotSnapshot | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [balances, setBalances] = useState<SpotBalances | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [balanceMessage, setBalanceMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [flowScreen, setFlowScreen] = useState<FlowScreen>("form");
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewSnapshot | null>(null);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [directionRotation, setDirectionRotation] = useState(0);
  const [submitStage, setSubmitStage] = useState<SubmitStage>("idle");
  const [pending, setPending] = useState<StoredSpotPending | null>(null);
  const [confirmationDelayed, setConfirmationDelayed] = useState(false);
  const [verificationIssue, setVerificationIssue] = useState("");
  const [submissionAmbiguity, setSubmissionAmbiguity] = useState<DecibelSpotAmbiguityRecord | null>(null);
  const [ambiguityQuarantineReason, setAmbiguityQuarantineReason] = useState("");
  const [ambiguityChecking, setAmbiguityChecking] = useState(false);
  const [transactionError, setTransactionError] = useState("");
  const [successHash, setSuccessHash] = useState("");
  const [receipt, setReceipt] = useState<SwapTransactionReceipt | null>(null);
  const [noFill, setNoFill] = useState(false);
  const confirmationInFlightRef = useRef("");
  const confirmedSettlementBindingsRef = useRef(new Set<string>());

  const activeMarket = snapshot?.market ?? market;
  const base = baseSymbol(activeMarket.marketName);
  const fromSymbol: AssetSymbol = direction === "buy" ? "USDC" : base;
  const toSymbol: AssetSymbol = direction === "buy" ? base : "USDC";
  const fromDecimals = direction === "buy" ? activeMarket.quoteDecimals : activeMarket.baseDecimals;
  const toDecimals = direction === "buy" ? activeMarket.baseDecimals : activeMarket.quoteDecimals;
  const submissionOutcomeUnknown = Boolean(submissionAmbiguity) || Boolean(ambiguityQuarantineReason);
  const interactionLocked = submitStage !== "idle" || Boolean(pending) || submissionOutcomeUnknown;
  const wrongNetwork = connected && network?.chainId !== 1;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (manual = false) => {
      controller?.abort();
      controller = new AbortController();
      if (manual) setRefreshing(true);
      else if (!snapshot) setSnapshotStatus("loading");
      try {
        const params = new URLSearchParams({
          resource: "orderbook",
          network: "mainnet",
          market: market.marketName,
          depth: "25",
        });
        const response = await fetch(`/api/decibel/spot?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as OrderbookResponse;
        if (!response.ok || !body.ready || body.resource !== "orderbook" || !body.snapshot) {
          throw new Error(body.message || "Decibel spot quote is unavailable");
        }
        if (cancelled) return;
        setSnapshot(body.snapshot);
        setSnapshotStatus("ready");
        setSnapshotMessage("");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setSnapshot(null);
        setSnapshotStatus("unavailable");
        setSnapshotMessage(error instanceof Error ? error.message : "Decibel spot quote is unavailable");
      } finally {
        if (!cancelled) {
          setRefreshing(false);
          timer = setTimeout(() => void load(), POLL_MS);
        }
      }
    };

    void load(refreshNonce > 0);
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  // refreshNonce intentionally restarts the sequential poll for a manual refresh.
  }, [market.marketAddress, market.marketName, refreshNonce]);

  const loadVerifiedBalances = useCallback(async (
    capturedOwner: string,
    capturedMarket: ValidatedDecibelSpotMarket,
  ) => {
    const params = new URLSearchParams({
      resource: "balances",
      network: "mainnet",
      market: capturedMarket.marketName,
      owner: capturedOwner,
    });
    const response = await fetch(`/api/decibel/spot?${params.toString()}`, { cache: "no-store" });
    const body = await response.json() as BalancesResponse;
    if (
      !response.ok
      || !body.ready
      || !body.balances
      || normalizeDecibelSpotAddress(body.owner) !== normalizeDecibelSpotAddress(capturedOwner)
      || normalizeDecibelSpotAddress(body.marketAddress) !== normalizeDecibelSpotAddress(capturedMarket.marketAddress)
    ) {
      throw new Error(body.message || "Wallet balances are unavailable");
    }
    return body.balances;
  }, []);

  const loadFreshOrderbook = useCallback(async (
    capturedMarket: ValidatedDecibelSpotMarket,
  ) => {
    const params = new URLSearchParams({
      resource: "orderbook",
      network: "mainnet",
      market: capturedMarket.marketName,
      depth: "25",
      fresh: "1",
    });
    const response = await fetch(`/api/decibel/spot?${params.toString()}`, {
      cache: "no-store",
    });
    const body = await response.json() as OrderbookResponse;
    if (
      !response.ok
      || !body.ready
      || body.resource !== "orderbook"
      || !body.snapshot
      || body.snapshot.network !== "mainnet"
      || normalizeDecibelSpotAddress(body.snapshot.market.marketAddress)
        !== normalizeDecibelSpotAddress(capturedMarket.marketAddress)
      || body.snapshot.market.marketName !== capturedMarket.marketName
    ) {
      throw new Error(body.message || "A fresh Decibel spot quote is unavailable");
    }
    return body.snapshot;
  }, []);

  const refreshBalances = useCallback(async () => {
    const capturedOwner = ownerAddress;
    const capturedMarket = market;
    const requestId = ++balanceRequestIdRef.current;
    if (!connected || !capturedOwner) {
      setBalances(null);
      setBalanceStatus("idle");
      setBalanceMessage("");
      return;
    }
    setBalanceStatus((current) => current === "ready" ? "ready" : "loading");
    setBalanceMessage("");
    try {
      const nextBalances = await loadVerifiedBalances(capturedOwner, capturedMarket);
      if (
        requestId !== balanceRequestIdRef.current
        || activeOwnerRef.current !== capturedOwner
        || activeMarketAddressRef.current !== capturedMarket.marketAddress
      ) return;
      setBalances(nextBalances);
      setBalanceStatus("ready");
    } catch (error) {
      if (
        requestId !== balanceRequestIdRef.current
        || activeOwnerRef.current !== capturedOwner
        || activeMarketAddressRef.current !== capturedMarket.marketAddress
      ) return;
      setBalances(null);
      setBalanceStatus("unavailable");
      setBalanceMessage(error instanceof Error ? error.message : "Wallet balances are unavailable");
    }
  }, [connected, loadVerifiedBalances, market, ownerAddress]);

  useEffect(() => {
    balanceRequestIdRef.current += 1;
    setBalances(null);
    setBalanceStatus(connected && ownerAddress ? "loading" : "idle");
    void refreshBalances();
    if (!connected || !ownerAddress) return;
    const timer = window.setInterval(() => void refreshBalances(), 10_000);
    return () => clearInterval(timer);
  }, [connected, market.marketAddress, ownerAddress, refreshBalances]);

  const adoptPending = useCallback((stored: StoredSpotPending) => {
    setPending(stored);
    setSubmissionAmbiguity(null);
    setAmbiguityQuarantineReason("");
    setSubmitStage("chain");
    setConfirmationDelayed(false);
    setVerificationIssue("");
    setSuccessHash("");
    setReceipt(null);
    setNoFill(false);
  }, []);

  const syncStoredAmbiguityState = useCallback((owner: string) => {
    const loaded = loadDecibelSpotAmbiguity(window.localStorage, owner);
    setSubmissionAmbiguity(loaded.status === "valid" ? loaded.record : null);
    setAmbiguityQuarantineReason(
      loaded.status === "quarantined" ? loaded.reason : "",
    );
  }, []);

  const clearResolvedStorage = useCallback(async (stored: StoredSpotPending) => {
    try {
      const cleared = await withOwnerWalletLock(stored.identity.ownerAddress, async () => {
        if (!clearPending(stored)) return false;
        if (!stored.ambiguity) return true;
        const loaded = loadDecibelSpotAmbiguity(
          window.localStorage,
          stored.identity.ownerAddress,
        );
        if (loaded.status !== "valid") return true;
        if (JSON.stringify(loaded.record) !== JSON.stringify(stored.ambiguity)) {
          // This is evidence for a newer request. Leave it untouched.
          return true;
        }
        return clearDecibelSpotAmbiguity(window.localStorage, stored.ambiguity);
      });
      return cleared === true;
    } catch {
      return false;
    }
  }, []);

  const confirmSubmitted = useCallback(async (stored: StoredSpotPending) => {
    if (confirmationInFlightRef.current === stored.hash) return;
    confirmationInFlightRef.current = stored.hash;
    try {
      let resolving = stored;
      let result: DecibelSpotConfirmation | null = null;
      const storedBindingKey = pendingSettlementBindingKey(resolving);
      if (
        !storedBindingKey
        || !confirmedSettlementBindingsRef.current.has(storedBindingKey)
      ) {
        result = await confirmDecibelSpotTransaction(resolving.hash, resolving.identity);
        if (activeOwnerRef.current !== resolving.identity.ownerAddress) return;
        if (result.status === "pending") {
          const confirmedPending = {
            ...resolving,
            settlementOrderId: normalizeDecibelSpotOrderId(result.pending.orderId),
          };
          const enrichment = await enrichPendingSettlementOrder(
            resolving,
            result.pending.orderId,
          );
          if (activeOwnerRef.current !== resolving.identity.ownerAddress) return;
          if (enrichment.status === "changed") {
            setPending(enrichment.pending);
            setSubmitStage("chain");
            setConfirmationDelayed(true);
            setVerificationIssue("");
            return;
          }
          if (enrichment.status === "conflict") {
            setSubmitStage("chain");
            setConfirmationDelayed(false);
            setVerificationIssue("The stored Decibel order ID conflicts with its confirmed pending event. Retrying stays blocked.");
            return;
          }
          resolving = enrichment.status === "ready"
            ? enrichment.pending
            : confirmedPending;
          setPending(resolving);
          confirmedSettlementBindingsRef.current.add(
            pendingSettlementBindingKey(resolving),
          );
        } else if (resolving.settlementOrderId) {
          setSubmitStage("chain");
          setConfirmationDelayed(false);
          setVerificationIssue("The stored Decibel order ID was not emitted by its original transaction. Retrying stays blocked.");
          return;
        }
      }
      if (resolving.settlementOrderId) {
        const settlement = await fetchDecibelSpotSettlementStatus({
          lookup: {
            ownerAddress: resolving.identity.ownerAddress,
            marketAddress: resolving.identity.marketAddress,
            orderId: resolving.settlementOrderId,
            expectedOrder: {
              priceAtomic: resolving.identity.priceAtomic,
              sizeAtomic: resolving.identity.sizeAtomic,
              isBid: resolving.identity.isBid,
            },
          },
        });
        if (activeOwnerRef.current !== resolving.identity.ownerAddress) return;
        if (
          settlement.settlement.status === "pending"
          || settlement.settlement.status === "unverified"
        ) {
          setSubmitStage("chain");
          setConfirmationDelayed(true);
          setVerificationIssue("");
          return;
        }
        result = settlement.settlement.status === "filled"
          ? { status: "filled", execution: settlement.settlement.execution }
          : { status: "no-fill" };
      }
      if (!result) throw new Error("Decibel spot settlement did not return a resolvable state");
      if (activeOwnerRef.current !== resolving.identity.ownerAddress) return;
      if (result.status === "filled") {
        const pendingCleared = await clearResolvedStorage(resolving);
        const paidAtomic = resolving.identity.isBid
          ? result.execution.quoteAmountAtomic
          : result.execution.sizeAtomic;
        const receivedAtomic = resolving.identity.isBid
          ? (BigInt(result.execution.sizeAtomic) - BigInt(result.execution.baseFeeAtomic)).toString()
          : (BigInt(result.execution.quoteAmountAtomic) - BigInt(result.execution.quoteFeeAtomic)).toString();
        const from = resolving.identity.isBid ? "USDC" : resolving.baseSymbol;
        const to = resolving.identity.isBid ? resolving.baseSymbol : "USDC";
        setReceipt({
          fromSymbol: from,
          toSymbol: to,
          paid: formatAtomic(
            paidAtomic,
            resolving.identity.isBid ? resolving.quoteDecimals : resolving.baseDecimals,
            from,
          ),
          received: formatAtomic(
            receivedAtomic,
            resolving.identity.isBid ? resolving.baseDecimals : resolving.quoteDecimals,
            to,
          ),
        });
        setSuccessHash(resolving.hash);
        if (!pendingCleared) {
          setSubmitStage("chain");
          setVerificationIssue("The swap settled, but its browser safety record could not be cleared. Retrying stays blocked in this tab.");
          return;
        }
        setPending(null);
        syncStoredAmbiguityState(resolving.identity.ownerAddress);
        setSubmitStage("idle");
        setConfirmationDelayed(false);
        setVerificationIssue("");
        const executedBase = Number(decimalFromAtomic(result.execution.sizeAtomic, resolving.baseDecimals));
        const executedQuote = Number(decimalFromAtomic(result.execution.quoteAmountAtomic, resolving.quoteDecimals));
        if (executedBase > 0 && Number.isFinite(executedBase) && Number.isFinite(executedQuote)) {
          emitDecibelTradeConfirmed({
            marketAddress: resolving.identity.marketAddress,
            marketName: resolving.marketName,
            price: executedQuote / executedBase,
            size: executedBase,
            side: resolving.identity.isBid ? "buy" : "sell",
            timestamp: Date.now(),
            txRef: resolving.hash,
          });
        }
        void refreshBalances();
        setRefreshNonce((value) => value + 1);
        return;
      }
      if (result.status === "no-fill") {
        const pendingCleared = await clearResolvedStorage(resolving);
        if (!pendingCleared) {
          setSubmitStage("chain");
          setVerificationIssue("The no-fill result was confirmed, but its browser safety record could not be cleared. Retrying stays blocked in this tab.");
          return;
        }
        setPending(null);
        syncStoredAmbiguityState(resolving.identity.ownerAddress);
        setSubmitStage("idle");
        setNoFill(true);
        setConfirmationDelayed(false);
        setVerificationIssue("");
        void refreshBalances();
        setRefreshNonce((value) => value + 1);
        return;
      }
      if (result.status === "failed") {
        const pendingCleared = await clearResolvedStorage(resolving);
        if (!pendingCleared) {
          setSubmitStage("chain");
          setVerificationIssue("The failed transaction was confirmed, but its browser safety record could not be cleared. Retrying stays blocked in this tab.");
          return;
        }
        setPending(null);
        syncStoredAmbiguityState(resolving.identity.ownerAddress);
        setSubmitStage("idle");
        setConfirmationDelayed(false);
        setTransactionError("The Decibel spot order failed on Aptos. Your assets stayed in your wallet.");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setRiskAcknowledged(false);
        void refreshBalances();
        return;
      }
      if (result.status === "pending") {
        setSubmitStage("chain");
        setConfirmationDelayed(true);
        setVerificationIssue("");
        return;
      }
      setConfirmationDelayed(false);
      setVerificationIssue(result.reason);
    } catch {
      if (activeOwnerRef.current === stored.identity.ownerAddress) {
        setConfirmationDelayed(true);
        setSubmitStage("chain");
      }
    } finally {
      if (confirmationInFlightRef.current === stored.hash) confirmationInFlightRef.current = "";
    }
  }, [clearResolvedStorage, refreshBalances, syncStoredAmbiguityState]);

  useEffect(() => {
    confirmedSettlementBindingsRef.current.clear();
    setPending(null);
    setSubmitStage("idle");
    setConfirmationDelayed(false);
    setVerificationIssue("");
    setSubmissionAmbiguity(null);
    setAmbiguityQuarantineReason("");
    setAmbiguityChecking(false);
    setTransactionError("");
    setSuccessHash("");
    setReceipt(null);
    setNoFill(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
    if (!connected || !ownerAddress) return;
    const stored = readPending(ownerAddress);
    if (stored.status === "valid") {
      adoptPending(stored.pending);
      void confirmSubmitted(stored.pending);
      return;
    }
    if (stored.status === "quarantined") {
      setAmbiguityQuarantineReason(stored.reason);
      return;
    }
    const ambiguity = loadDecibelSpotAmbiguity(window.localStorage, ownerAddress);
    if (ambiguity.status === "valid") setSubmissionAmbiguity(ambiguity.record);
    if (ambiguity.status === "quarantined") setAmbiguityQuarantineReason(ambiguity.reason);
  }, [adoptPending, confirmSubmitted, connected, ownerAddress]);

  useEffect(() => {
    if (!connected || !ownerAddress) return;
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (
        event.key === decibelSpotPendingStorageKey(ownerAddress)
        || event.key === `${DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX}:${ownerAddress.toLowerCase()}`
      ) {
        const stored = readPending(ownerAddress);
        if (stored.status === "valid") {
          adoptPending(stored.pending);
          void confirmSubmitted(stored.pending);
        } else if (stored.status === "quarantined") {
          setPending(null);
          setSubmitStage("idle");
          setSubmissionAmbiguity(null);
          setAmbiguityQuarantineReason(stored.reason);
        } else if (!successHash) {
          setPending(null);
          setSubmitStage("idle");
          setConfirmationDelayed(false);
          setVerificationIssue("");
          setTransactionError("This transaction was resolved in another tab. Wallet balances were refreshed.");
          void refreshBalances();
        }
      }
      if (
        event.key === decibelSpotAmbiguityStorageKey(ownerAddress)
        || event.key === decibelSpotQuarantineStorageKey(ownerAddress)
        || event.key === `${DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${ownerAddress.toLowerCase()}`
      ) {
        const ambiguity = loadDecibelSpotAmbiguity(window.localStorage, ownerAddress);
        setSubmissionAmbiguity(ambiguity.status === "valid" ? ambiguity.record : null);
        setAmbiguityQuarantineReason(
          ambiguity.status === "quarantined" ? ambiguity.reason : "",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adoptPending, confirmSubmitted, connected, ownerAddress, successHash]);

  useEffect(() => {
    if (!pending || verificationIssue || !confirmationDelayed) return;
    const timer = window.setTimeout(() => void confirmSubmitted(pending), 5_000);
    return () => clearTimeout(timer);
  }, [confirmationDelayed, confirmSubmitted, pending, verificationIssue]);

  const quoteResult = useMemo(() => {
    if (!amount) return { inputAtomic: null, quote: null, error: "" };
    try {
      const inputAtomic = parseDecibelSpotAmountInput(amount, fromDecimals);
      if (BigInt(inputAtomic) <= 0n) return { inputAtomic, quote: null, error: "" };
      if (!snapshot) return { inputAtomic, quote: null, error: snapshotMessage || "Refreshing the orderbook." };
      const quote = quoteDecibelSpotExactInput({
        snapshot,
        side: direction,
        inputAtomic,
        nowMs: clock,
      });
      return { inputAtomic, quote, error: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Quote unavailable";
      return { inputAtomic: null, quote: null, error: friendlyQuoteError(message, direction, activeMarket) };
    }
  }, [amount, clock, direction, fromDecimals, snapshot, snapshotMessage]);

  const quote = quoteResult.quote;
  const quoteExpired = Boolean(snapshot && clock > snapshot.expiresAtMs);
  const fromBalance = direction === "buy" ? balances?.quote : balances?.base;
  const fromBalanceAtomic = fromBalance?.atomic ? BigInt(fromBalance.atomic) : null;
  const requiredInputAtomic = quote
    ? BigInt(direction === "buy" ? quote.maximumInputEscrowAtomic : quote.orderSizeRaw)
    : 0n;
  const aptReserveNeeded = direction === "sell" && base === "APT"
    ? APT_GAS_RESERVE_ATOMIC
    : 0n;
  const insufficientBalance = fromBalanceAtomic !== null
    && requiredInputAtomic > 0n
    && requiredInputAtomic + aptReserveNeeded > fromBalanceAtomic;
  const needsGas = balances !== null && BigInt(balances.apt.atomic) < APT_GAS_RESERVE_ATOMIC;
  const quotePrice = quote ? priceFromQuote(quote) : 0;
  const midPrice = snapshot?.market.mid ? Number(snapshot.market.mid) : 0;
  const bestBid = snapshot?.bids[0] ? Number(snapshot.bids[0].price) : 0;
  const bestAsk = snapshot?.asks[0] ? Number(snapshot.asks[0].price) : 0;
  const spread = bestBid > 0 && bestAsk > 0 ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100 : Infinity;
  const priceImpact = quotePrice > 0 && midPrice > 0
    ? Math.max(0, direction === "buy"
        ? ((quotePrice - midPrice) / midPrice) * 100
        : ((midPrice - quotePrice) / midPrice) * 100)
    : Infinity;
  const highRisk = !Number.isFinite(priceImpact) || !Number.isFinite(spread) || priceImpact > 1 || spread > 2;
  const outputDisplay = quote
    ? formatAtomic(quote.estimatedNetOutputAtomic, toDecimals, toSymbol)
    : "0";
  const currentSignature = quote ? quoteSignature(quote) : "";
  const reviewChanged = flowScreen === "review"
    && Boolean(reviewSnapshot)
    && reviewSnapshot?.signature !== currentSignature;
  const inputIssue = insufficientBalance
    ? `Insufficient ${fromSymbol} balance.`
    : quoteResult.error && amount ? quoteResult.error : "";

  const setBalanceFraction = useCallback((numerator: bigint) => {
    if (!fromBalance) return;
    let available = BigInt(fromBalance.atomic);
    if (direction === "sell" && base === "APT") {
      available = available > APT_GAS_RESERVE_ATOMIC ? available - APT_GAS_RESERVE_ATOMIC : 0n;
    }
    const next = (available * numerator) / 100n;
    setAmount(decimalFromAtomic(next, fromDecimals));
    setFlowScreen("form");
    setReviewSnapshot(null);
    setRiskAcknowledged(false);
    setTransactionError("");
  }, [base, direction, fromBalance, fromDecimals]);

  const reverse = useCallback(() => {
    if (interactionLocked) return;
    const nextDirection = direction === "buy" ? "sell" : "buy";
    const nextAmount = quote
      ? decimalFromAtomic(quote.estimatedNetOutputAtomic, toDecimals)
      : "";
    setDirection(nextDirection);
    onDirectionChange?.(nextDirection);
    setDirectionRotation((value) => value + 180);
    setAmount(nextAmount);
    setFlowScreen("form");
    setReviewSnapshot(null);
    setRiskAcknowledged(false);
    setTransactionError("");
  }, [direction, interactionLocked, onDirectionChange, quote, toDecimals]);

  const acknowledgeAmbiguity = useCallback(async () => {
    if (!ownerAddress || !submissionAmbiguity || ambiguityQuarantineReason) return;
    setAmbiguityChecking(true);
    setTransactionError("");
    try {
      const result = await withOwnerWalletLock(ownerAddress, async () => {
        const loaded = loadDecibelSpotAmbiguity(window.localStorage, ownerAddress);
        if (loaded.status !== "valid") return { kind: "changed" as const };
        if (JSON.stringify(loaded.record) !== JSON.stringify(submissionAmbiguity)) {
          return { kind: "changed" as const };
        }
        const recovery = await requestAmbiguityRecovery(loaded.record);
        if (recovery.status === "submitted") {
          const market = resolvePinnedDecibelSpotMarket(loaded.record.identity.marketAddress);
          const stored: StoredSpotPending = {
            ambiguity: loaded.record,
            hash: recovery.hash,
            identity: loaded.record.identity,
            marketName: market.marketName,
            baseSymbol: baseSymbol(market.marketName),
            quoteSymbol: "USDC",
            baseDecimals: market.baseDecimals,
            quoteDecimals: market.quoteDecimals,
            createdAt: loaded.record.createdAt,
          };
          if (!persistPending(stored)) return { kind: "storage" as const };
          clearDecibelSpotAmbiguity(window.localStorage, loaded.record);
          return { kind: "submitted" as const, pending: stored };
        }
        if (recovery.status === "safe-to-retry") {
          if (!clearDecibelSpotAmbiguity(window.localStorage, loaded.record)) {
            return { kind: "changed" as const };
          }
          return { kind: "safe" as const };
        }
        return {
          kind: "blocked" as const,
          retryAfterMs: recovery.retryAfterMs,
        };
      });
      if (activeOwnerRef.current !== ownerAddress) return;
      if (result === null) {
        setTransactionError("Another wallet request is still open in a different tab.");
      } else if (result.kind === "submitted") {
        setSubmissionAmbiguity(null);
        setAmbiguityQuarantineReason("");
        adoptPending(result.pending);
        void confirmSubmitted(result.pending);
      } else if (result.kind === "safe") {
        setSubmissionAmbiguity(null);
        setAmbiguityQuarantineReason("");
        setTransactionError("The earlier wallet request can no longer execute. Review a fresh quote before swapping.");
        setRefreshNonce((value) => value + 1);
        void refreshBalances();
      } else if (result.kind === "blocked") {
        const minutes = result.retryAfterMs
          ? Math.max(1, Math.ceil(result.retryAfterMs / 60_000))
          : null;
        setTransactionError(
          minutes
            ? `No matching Aptos transaction was found. This account stays locked for about ${minutes} more minute${minutes === 1 ? "" : "s"}.`
            : "Aptos could not prove that the earlier wallet request is finished. Retrying stays blocked.",
        );
      } else if (result.kind === "storage") {
        setTransactionError("The recovered transaction could not be stored safely. Retrying stays blocked.");
      } else {
        const latest = loadDecibelSpotAmbiguity(window.localStorage, ownerAddress);
        setSubmissionAmbiguity(latest.status === "valid" ? latest.record : null);
        setAmbiguityQuarantineReason(
          latest.status === "quarantined" ? latest.reason : "A wallet safety record changed in another tab.",
        );
      }
    } catch {
      setTransactionError("Aptos wallet activity could not be verified. Retrying stays blocked.");
    } finally {
      if (activeOwnerRef.current === ownerAddress) setAmbiguityChecking(false);
    }
  }, [
    adoptPending,
    ambiguityQuarantineReason,
    confirmSubmitted,
    ownerAddress,
    refreshBalances,
    submissionAmbiguity,
  ]);

  const submit = useCallback(async (reviewedSignature: string) => {
    if (!connected || !ownerAddress || !quote || currentSignature !== reviewedSignature) return;
    const submittedOwner = ownerAddress;
    const reviewedQuote = quote;
    const submittedMarket = reviewedQuote.market;
    setTransactionError("");
    try {
      const result = await withOwnerWalletLock(submittedOwner, async () => {
        if (hasCashWalletOperationEvidence(window.localStorage, submittedOwner)) {
          return { kind: "foreign-operation" as const };
        }
        const existing = readPending(submittedOwner);
        if (existing.status === "valid") {
          return { kind: "pending" as const, pending: existing.pending };
        }
        if (existing.status === "quarantined") {
          return {
            kind: "ambiguous" as const,
            ambiguity: { status: "quarantined" as const, reason: existing.reason },
          };
        }
        const existingAmbiguity = loadDecibelSpotAmbiguity(window.localStorage, submittedOwner);
        if (existingAmbiguity.status !== "none") {
          return { kind: "ambiguous" as const, ambiguity: existingAmbiguity };
        }
        if (activeOwnerRef.current !== submittedOwner) return { kind: "owner-changed" as const };
        if (activeNetworkChainIdRef.current !== 1) return { kind: "network-changed" as const };
        let latestSnapshot: ValidatedDecibelSpotSnapshot;
        let latestQuote: DecibelSpotQuote;
        let latestBalances: SpotBalances;
        let payload: ReturnType<typeof buildDecibelSpotIocPayload>;
        let ambiguity: DecibelSpotAmbiguityRecord;
        let identity: DecibelSpotOrderIdentity;
        try {
          latestSnapshot = await loadFreshOrderbook(submittedMarket);
          if (activeOwnerRef.current !== submittedOwner) return { kind: "owner-changed" as const };
          if (activeNetworkChainIdRef.current !== 1) return { kind: "network-changed" as const };
          try {
            latestQuote = quoteDecibelSpotExactInput({
              snapshot: latestSnapshot,
              side: reviewedQuote.side,
              inputAtomic: reviewedQuote.requestedInputAtomic,
              nowMs: Date.now(),
            });
          } catch (error) {
            const message = error instanceof Error
              ? friendlyQuoteError(error.message, reviewedQuote.side, submittedMarket)
              : "A protected quote is no longer available for this amount.";
            return {
              kind: "quote-unavailable" as const,
              message,
              snapshot: latestSnapshot,
            };
          }
          if (quoteSignature(latestQuote) !== reviewedSignature) {
            return { kind: "quote-changed" as const, snapshot: latestSnapshot };
          }
          identity = {
            ownerAddress: submittedOwner,
            marketAddress: latestQuote.market.marketAddress,
            priceAtomic: latestQuote.limitPriceRaw,
            sizeAtomic: latestQuote.orderSizeRaw,
            isBid: latestQuote.side === "buy",
          };
          latestBalances = await loadVerifiedBalances(submittedOwner, submittedMarket);
          if (activeOwnerRef.current !== submittedOwner) return { kind: "owner-changed" as const };
          const availableInput = BigInt(
            latestQuote.side === "buy" ? latestBalances.quote.atomic : latestBalances.base.atomic,
          );
          const requiredInput = BigInt(
            latestQuote.side === "buy" ? latestQuote.maximumInputEscrowAtomic : latestQuote.orderSizeRaw,
          );
          const reserve = latestQuote.side === "sell" && baseSymbol(submittedMarket.marketName) === "APT"
            ? APT_GAS_RESERVE_ATOMIC
            : 0n;
          if (requiredInput + reserve > availableInput) {
            return { kind: "preflight" as const, message: `Your ${latestQuote.side === "buy" ? "USDC" : baseSymbol(submittedMarket.marketName)} balance changed. Review a new quote.` };
          }
          if (BigInt(latestBalances.apt.atomic) < APT_GAS_RESERVE_ATOMIC) {
            return { kind: "preflight" as const, message: "Add at least 0.01 APT for network gas." };
          }
          payload = buildDecibelSpotIocPayload(latestQuote, Date.now());
          ambiguity = await requestPreparedAmbiguity(submittedOwner, identity);
          if (activeOwnerRef.current !== submittedOwner) return { kind: "owner-changed" as const };
          if (activeNetworkChainIdRef.current !== 1) return { kind: "network-changed" as const };
        } catch (error) {
          return {
            kind: "preflight" as const,
            message: error instanceof Error && /stale|quote/i.test(error.message)
              ? "The quote expired. Review the refreshed price before signing."
              : "Wallet balances, account sequence, or the protected quote could not be reverified.",
          };
        }
        if (!persistDecibelSpotAmbiguity(window.localStorage, ambiguity)) {
          return { kind: "storage" as const };
        }
        if (activeOwnerRef.current !== submittedOwner) {
          if (!clearDecibelSpotAmbiguity(window.localStorage, ambiguity)) {
            return {
              kind: "ambiguous" as const,
              ambiguity: loadDecibelSpotAmbiguity(window.localStorage, submittedOwner),
            };
          }
          return { kind: "owner-changed" as const };
        }
        if (activeNetworkChainIdRef.current !== 1) {
          if (!clearDecibelSpotAmbiguity(window.localStorage, ambiguity)) {
            return {
              kind: "ambiguous" as const,
              ambiguity: loadDecibelSpotAmbiguity(window.localStorage, submittedOwner),
            };
          }
          return { kind: "network-changed" as const };
        }
        if (activeOwnerRef.current === submittedOwner) setSubmitStage("wallet");
        let submissionAttempted = false;
        try {
          const signed = await signTransaction({
            transactionOrPayload: {
              sender: submittedOwner,
              data: payload,
              options: {
                accountSequenceNumber: BigInt(ambiguity.preSignSequenceNumber),
                expireTimestamp: ambiguity.requestedExpirationTimestampSecs,
                expirationTimestamp: ambiguity.requestedExpirationTimestampSecs,
              },
            },
          });
          const deserializer = new Deserializer(signed.rawTransaction);
          const rawTransaction = validateSignedDecibelSpotRawTransaction(
            RawTransaction.deserialize(deserializer),
            ambiguity,
          );
          deserializer.assertFinished();
          const transaction = new SimpleTransaction(rawTransaction);
          const submission = {
            transaction,
            senderAuthenticator: signed.authenticator,
          };
          const expectedHash = generateUserTransactionHash(submission);
          if (activeOwnerRef.current !== submittedOwner) {
            return { kind: "unknown" as const, ambiguity };
          }
          if (activeNetworkChainIdRef.current !== 1) {
            return { kind: "unknown" as const, ambiguity };
          }
          if (activeOwnerRef.current === submittedOwner) setSubmitStage("chain");
          submissionAttempted = true;
          const response = await submitTransaction(submission);
          const hash = (response as { hash?: unknown }).hash;
          if (!isAptosTransactionHash(hash) || hash.toLowerCase() !== expectedHash.toLowerCase()) {
            return { kind: "unknown" as const, ambiguity };
          }
          const stored: StoredSpotPending = {
            ambiguity,
            hash,
            identity,
            marketName: submittedMarket.marketName,
            baseSymbol: baseSymbol(submittedMarket.marketName),
            quoteSymbol: "USDC",
            baseDecimals: submittedMarket.baseDecimals,
            quoteDecimals: submittedMarket.quoteDecimals,
            createdAt: ambiguity.createdAt,
          };
          const persisted = persistPending(stored);
          if (persisted) clearDecibelSpotAmbiguity(window.localStorage, ambiguity);
          return { kind: "submitted" as const, pending: stored };
        } catch (error) {
          if (!submissionAttempted && wasRejectedByWallet(error)) {
            if (!clearDecibelSpotAmbiguity(window.localStorage, ambiguity)) {
              return {
                kind: "ambiguous" as const,
                ambiguity: loadDecibelSpotAmbiguity(window.localStorage, submittedOwner),
              };
            }
            return { kind: "rejected" as const };
          }
          // Reassert the exact evidence before releasing the cross-tab lock.
          persistDecibelSpotAmbiguity(window.localStorage, ambiguity);
          return { kind: "unknown" as const, ambiguity };
        }
      });

      if (activeOwnerRef.current !== submittedOwner) return;
      if (result === null) {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setTransactionError("Another wallet request is already open for this account.");
        return;
      }
      if (result.kind === "foreign-operation") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setTransactionError("Finish or recover the pending CASH wallet action before starting this swap.");
        return;
      }
      if (result.kind === "quote-changed") {
        setSubmitStage("idle");
        setSnapshot(result.snapshot);
        setSnapshotStatus("ready");
        setSnapshotMessage("");
        setRiskAcknowledged(false);
        setTransactionError("");
        return;
      }
      if (result.kind === "quote-unavailable") {
        setSubmitStage("idle");
        setSnapshot(result.snapshot);
        setSnapshotStatus("ready");
        setSnapshotMessage("");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setRiskAcknowledged(false);
        setTransactionError(result.message);
        return;
      }
      if (result.kind === "pending") {
        adoptPending(result.pending);
        void confirmSubmitted(result.pending);
        return;
      }
      if (result.kind === "ambiguous" || result.kind === "unknown") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        if (result.kind === "unknown") {
          setSubmissionAmbiguity(result.ambiguity);
          setAmbiguityQuarantineReason("");
        } else if (result.ambiguity.status === "valid") {
          setSubmissionAmbiguity(result.ambiguity.record);
          setAmbiguityQuarantineReason("");
        } else if (result.ambiguity.status === "quarantined") {
          setSubmissionAmbiguity(null);
          setAmbiguityQuarantineReason(result.ambiguity.reason);
        } else {
          setSubmissionAmbiguity(null);
          setAmbiguityQuarantineReason("The wallet safety marker could not be verified after the wallet request.");
        }
        setTransactionError("The wallet did not return a transaction hash. Run the Aptos safety check before retrying.");
        return;
      }
      if (result.kind === "storage") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setTransactionError("Browser storage is unavailable, so this swap cannot be submitted safely.");
        return;
      }
      if (result.kind === "rejected") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setTransactionError("Swap cancelled in your wallet.");
        return;
      }
      if (result.kind === "owner-changed") return;
      if (result.kind === "network-changed") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setRiskAcknowledged(false);
        setTransactionError("Switch your wallet to Aptos mainnet, then review the swap again.");
        return;
      }
      if (result.kind === "preflight") {
        setSubmitStage("idle");
        setFlowScreen("form");
        setReviewSnapshot(null);
        setRiskAcknowledged(false);
        setTransactionError(result.message);
        void refreshBalances();
        setRefreshNonce((value) => value + 1);
        return;
      }
      adoptPending(result.pending);
      void confirmSubmitted(result.pending);
    } catch {
      if (activeOwnerRef.current === submittedOwner) {
        setSubmitStage("idle");
        setTransactionError("Safe cross-tab wallet coordination is unavailable in this browser.");
      }
    }
  }, [
    adoptPending,
    confirmSubmitted,
    connected,
    currentSignature,
    loadFreshOrderbook,
    loadVerifiedBalances,
    ownerAddress,
    quote,
    signTransaction,
    submitTransaction,
  ]);

  const startAnotherSwap = useCallback(() => {
    setSuccessHash("");
    setReceipt(null);
    setNoFill(false);
    setAmount("");
    setFlowScreen("form");
    setReviewSnapshot(null);
    setRiskAcknowledged(false);
    setTransactionError("");
  }, []);

  const primaryAction = useCallback(() => {
    if (!connected) {
      setWalletOpen(true);
      return;
    }
    if (!quote || wrongNetwork || insufficientBalance || needsGas || balanceStatus !== "ready") return;
    setReviewSnapshot({ signature: quoteSignature(quote), receiveAmount: outputDisplay });
    setRiskAcknowledged(false);
    setFlowScreen("review");
  }, [balanceStatus, connected, insufficientBalance, needsGas, outputDisplay, quote, wrongNetwork]);

  const cta = useMemo(() => {
    if (!connected) return { label: "Connect wallet", disabled: false };
    if (wrongNetwork) return { label: "Switch to Aptos mainnet", disabled: true };
    if (submissionOutcomeUnknown) return { label: "Resolve earlier wallet request", disabled: true };
    if (snapshotStatus === "loading") return { label: "Checking Decibel spot", disabled: true };
    if (snapshotStatus === "unavailable" || !snapshot) return { label: "Live quote unavailable", disabled: true };
    if (!amount || quoteResult.inputAtomic === "0") return { label: "Enter an amount", disabled: true };
    if (!quote) return { label: quoteResult.error || "Protected quote unavailable", disabled: true };
    if (balanceStatus === "loading") return { label: "Checking wallet balance", disabled: true };
    if (balanceStatus === "unavailable" || !balances) return { label: "Wallet balance unavailable", disabled: true };
    if (insufficientBalance) return { label: `Insufficient ${fromSymbol}`, disabled: true };
    if (needsGas) return { label: "Add 0.01 APT for gas", disabled: true };
    return { label: "Review swap", disabled: false };
  }, [
    amount,
    balanceStatus,
    balances,
    connected,
    fromSymbol,
    insufficientBalance,
    needsGas,
    quote,
    quoteResult.error,
    quoteResult.inputAtomic,
    snapshot,
    snapshotStatus,
    submissionOutcomeUnknown,
    wrongNetwork,
  ]);

  const notice = useMemo(() => {
    if (ambiguityQuarantineReason) return {
      tone: "warning" as const,
      title: "Wallet safety record needs support",
      body: `${ambiguityQuarantineReason} Retrying stays blocked because the earlier request cannot be reconstructed safely.`,
      action: null,
    };
    if (submissionOutcomeUnknown) return {
      tone: "warning" as const,
      title: "Verify the earlier wallet request",
      body: transactionError || "The wallet returned no transaction hash. Check Aptos for the exact reviewed order before another swap can be submitted.",
      action: "acknowledge" as const,
    };
    if (transactionError) return {
      tone: "error" as const,
      title: transactionError,
      body: "",
      action: null,
    };
    if (snapshotStatus === "unavailable") return {
      tone: "warning" as const,
      title: "Live quotes are unavailable",
      body: snapshotMessage || "Decibel spot data could not be verified. Your wallet has not been touched.",
      action: null,
    };
    if (balanceStatus === "unavailable" && connected) return {
      tone: "warning" as const,
      title: "Wallet balances are unavailable",
      body: balanceMessage || "Balances could not be verified, so swapping is paused.",
      action: null,
    };
    if (quoteResult.error && amount) return {
      tone: "warning" as const,
      title: quoteResult.error,
      body: "Your wallet has not been touched.",
      action: null,
    };
    return null;
  }, [
    ambiguityQuarantineReason,
    amount,
    balanceMessage,
    balanceStatus,
    connected,
    quoteResult.error,
    snapshotMessage,
    snapshotStatus,
    submissionOutcomeUnknown,
    transactionError,
  ]);

  const reviewNotice = useMemo<SpotSwapReviewNotice | null>(() => {
    if (wrongNetwork) return {
      title: "Switch to Aptos mainnet",
      body: "Your wallet network changed after this quote was reviewed. Return to the swap and review it again on mainnet.",
    };
    if (reviewChanged) return {
      title: "Quote updated",
      body: reviewSnapshot?.receiveAmount !== outputDisplay
        ? `Estimated output changed from ${reviewSnapshot?.receiveAmount ?? "0"} to ${outputDisplay} ${toSymbol}. Review the new amounts before confirming.`
        : "The live depth, fee, or protected limit changed. Review the updated details before confirming.",
    };
    if (highRisk) return {
      title: Number.isFinite(priceImpact)
        ? `${priceImpact.toFixed(2)}% price impact`
        : "No two-sided price reference",
      body: "This Decibel spot book is thin or widely spread. Check the execution estimate and protected limit carefully.",
    };
    return null;
  }, [highRisk, outputDisplay, priceImpact, reviewChanged, reviewSnapshot?.receiveAmount, toSymbol, wrongNetwork]);

  const acceptUpdatedQuote = useCallback(() => {
    if (!quote) return;
    setReviewSnapshot({ signature: quoteSignature(quote), receiveAmount: outputDisplay });
    setRiskAcknowledged(false);
  }, [outputDisplay, quote]);

  const reviewDetails = useMemo<SpotSwapReviewRow[]>(() => {
    if (!quote) return [];
    const feeSymbol = toSymbol;
    const fee = formatAtomic(quote.estimatedMaxProtocolFeeAtomic, toDecimals, feeSymbol);
    const limit = formatAtomic(quote.limitPriceRaw, quote.market.quoteDecimals, "USDC");
    return [
      { label: "Estimated rate", value: `1 ${base} = ${quotePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC` },
      {
        label: "Price impact",
        value: Number.isFinite(priceImpact) ? percent(priceImpact) : "No midpoint",
        tone: highRisk ? "warning" : undefined,
      },
      {
        label: "Bid / ask spread",
        value: Number.isFinite(spread) ? percent(spread) : "One-sided book",
        tone: highRisk ? "warning" : undefined,
      },
      { label: direction === "buy" ? "Maximum buy price" : "Minimum sell price", value: `${limit} USDC` },
      { label: "Estimated Decibel fee", value: `${fee} ${feeSymbol}` },
      { label: "Unfilled portion", value: "Returns to wallet" },
      { label: "Max price movement", value: SLIPPAGE_LABEL.replace("Max ", "") },
      { label: "Venue", value: "Decibel spot", tone: "positive" },
    ];
  }, [base, direction, highRisk, priceImpact, quote, quotePrice, spread, toDecimals, toSymbol]);

  const transactionVisible = Boolean(pending || successHash || noFill || submitStage !== "idle");

  useEffect(() => {
    const screenKey = transactionVisible
      ? successHash || noFill ? "complete" : "pending"
      : flowScreen === "review" ? "review" : "form";
    if (screenKey === focusedScreenRef.current) return;
    focusedScreenRef.current = screenKey;
    if (screenKey === "form") {
      const frame = window.requestAnimationFrame(() => {
        amountInputRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const container = screenKey === "review"
      ? reviewScreenRef.current
      : transactionScreenRef.current;
    const frame = window.requestAnimationFrame(() => {
      container?.querySelector<HTMLElement>("[data-swap-screen-heading]")
        ?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flowScreen, noFill, successHash, transactionVisible]);

  const form = (
    <section aria-label={`${market.marketName} spot swap`} className="w-full rounded-[var(--radius)] bg-background-secondary p-2">
      <div className="flex h-14 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="font-display text-[17px] font-semibold text-foreground">Swap</h2>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  // Sized to match the app's other pills (the trade page's leverage badge):
                  // 10px text, px-1.5 py-0.5, ~19px tall. Not a 44px tap target.
                  "shrink-0 rounded-full border border-card-border bg-card px-1.5 py-0.5 text-[10px] font-medium leading-[13px] text-foreground-secondary outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  PRESSABLE_CONTROL,
                )}
                aria-label={`${SLIPPAGE_LABEL} maximum price movement. Open details.`}
              >
                {SLIPPAGE_LABEL}
              </button>
            </PopoverTrigger>
            <PopoverContent aria-label="Maximum price movement" align="start" className="w-[260px] p-3">
              <p className="text-[12px] font-semibold text-foreground">Maximum price movement</p>
              <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">
                The on-chain limit price stays within 0.5% of the reviewed live depth. Any unfilled amount returns to your wallet.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        {(snapshotStatus !== "ready" || quoteExpired) ? (
          <button
            type="button"
            onClick={() => setRefreshNonce((value) => value + 1)}
            disabled={snapshotStatus === "loading" || refreshing || interactionLocked}
            className={cn(
              "grid size-11 place-items-center rounded-[var(--radius-sm)] text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
              PRESSABLE_CONTROL,
            )}
            aria-label={`Refresh ${market.marketName} quote`}
            title="Refresh quote"
          >
            <RotateCcw
              aria-hidden="true"
              strokeWidth={3}
              className={cn("size-5", (snapshotStatus === "loading" || refreshing) && "animate-spin motion-reduce:animate-none")}
            />
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false} mode="popLayout">
      {transactionVisible ? (
        <SwapFlowScreen key="transaction" ref={transactionScreenRef} reducedMotion={Boolean(reduceMotion)}>
          {noFill ? (
            <EmptyFillState onNewSwap={startAnotherSwap} />
          ) : (
            <CashSwapTransactionState
              confirmationDelayed={confirmationDelayed}
              onCheck={() => pending && void confirmSubmitted(pending)}
              onNewSwap={startAnotherSwap}
              pendingHash={pending?.hash ?? ""}
              pendingIconSrc={iconFor(base)}
              receipt={receipt}
              stage={submitStage}
              successBody="Your Decibel spot IOC settled directly to your Aptos wallet."
              successHash={successHash}
              verificationIssue={verificationIssue}
            />
          )}
        </SwapFlowScreen>
      ) : flowScreen === "review" && quote && reviewSnapshot ? (
        <SwapFlowScreen key="review" ref={reviewScreenRef} reducedMotion={Boolean(reduceMotion)}>
          <SpotSwapReview
            acknowledgement={highRisk && !reviewChanged ? {
              checked: riskAcknowledged,
              label: "I reviewed this thin market and the protected limit price.",
              onChange: setRiskAcknowledged,
            } : undefined}
            busy={submitStage !== "idle"}
            confirmDisabled={wrongNetwork || quoteExpired || (!reviewChanged && highRisk && !riskAcknowledged)}
            confirmLabel={reviewChanged ? "Use updated quote" : submitStage !== "idle" ? "Open wallet to confirm" : "Confirm swap"}
            details={reviewDetails}
            fromAsset={{ symbol: fromSymbol, iconSrc: iconFor(fromSymbol) }}
            notice={reviewNotice}
            onBack={() => {
              setFlowScreen("form");
              setReviewSnapshot(null);
              setRiskAcknowledged(false);
            }}
            onConfirm={reviewChanged ? acceptUpdatedQuote : () => void submit(reviewSnapshot.signature)}
            payAmount={formatAtomic(
              direction === "buy" ? quote.maximumInputEscrowAtomic : quote.orderSizeRaw,
              fromDecimals,
              fromSymbol,
            )}
            payLabel="You pay up to"
            receiveAmount={outputDisplay}
            receiveLabel="Estimated receive"
            safetyCopy="The 0.5% limit price is enforced on-chain. Decibel deducts its current spot fee from the asset you receive, and any unfilled amount returns to your wallet."
            toAsset={{ symbol: toSymbol, iconSrc: iconFor(toSymbol) }}
          />
        </SwapFlowScreen>
      ) : (
        <SwapFlowScreen key="form" reducedMotion={Boolean(reduceMotion)}>
          <div className="flex min-h-[152px] flex-col rounded-[var(--radius)] border border-transparent bg-background-tertiary p-4 transition-colors duration-150 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none">
            <div className="flex h-4 items-center justify-between gap-3 text-[13px] leading-4 text-muted-foreground">
              <label htmlFor={inputId}>You pay up to</label>
              {connected ? (
                <span className="min-w-0 truncate text-[11px]">
                  {balanceStatus === "loading"
                    ? "Checking balance"
                    : fromBalance
                      ? <>Balance <span className="font-mono tabular-nums text-foreground-secondary">{formatAtomic(fromBalance.atomic, fromBalance.decimals, fromSymbol)}</span></>
                      : "Balance —"}
                </span>
              ) : null}
            </div>
            <div className="flex min-h-[68px] flex-1 items-center gap-3">
              <input
                ref={amountInputRef}
                id={inputId}
                value={amount}
                onChange={(event) => {
                  const next = event.target.value;
                  const decimals = fromDecimals;
                  const pattern = new RegExp(`^(?:\\d+\\.?\\d{0,${decimals}}|\\.\\d{1,${decimals}})$`);
                  if (next === "" || pattern.test(next)) setAmount(next);
                  setTransactionError("");
                  setFlowScreen("form");
                  setReviewSnapshot(null);
                  setRiskAcknowledged(false);
                  setSuccessHash("");
                  setReceipt(null);
                  setNoFill(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    primaryAction();
                  }
                }}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="0"
                disabled={interactionLocked}
                aria-invalid={Boolean(inputIssue) || undefined}
                aria-describedby={inputIssue ? inputIssueId : undefined}
                aria-errormessage={inputIssue ? inputIssueId : undefined}
                className="min-w-0 flex-1 bg-transparent font-mono text-[28px] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed disabled:opacity-55 min-[380px]:text-[36px]"
              />
              {inputIssue ? <span id={inputIssueId} className="sr-only">{inputIssue}</span> : null}
              <SwapAssetButton
                ref={payAssetButtonRef}
                symbol={fromSymbol}
                iconSrc={iconFor(fromSymbol)}
                onSelect={onPayAssetSelect ? () => onPayAssetSelect(fromSymbol) : undefined}
                disabled={assetSelectionDisabled || interactionLocked}
                ariaLabel={`Choose pay asset, currently ${fromSymbol}`}
                expanded={assetSelectorSide === "pay"}
              />
            </div>
            <div className="flex min-h-4 flex-wrap items-center justify-between gap-2 text-[11px] leading-4">
              <span className="min-w-0 truncate text-muted-foreground">
                {direction === "sell" && base === "APT" && fromBalance ? "Max reserves 0.01 APT for gas" : ""}
              </span>
              {connected && fromBalance && BigInt(fromBalance.atomic) > 0n ? (
                <div role="group" className="ml-auto grid w-full max-w-[212px] min-w-0 flex-1 grid-cols-4 gap-0.5" aria-label={`Use a percentage of your ${fromSymbol} balance`}>
                  {[25n, 50n, 75n].map((value) => (
                    <button
                      key={value.toString()}
                      type="button"
                      onClick={() => setBalanceFraction(value)}
                      aria-label={`Use ${value.toString()}% of ${fromSymbol} balance`}
                      disabled={interactionLocked || balanceStatus !== "ready"}
                      className={cn(
                        "rounded-[var(--radius-xs)] px-2 py-1 text-[10px] font-semibold text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45",
                        PRESSABLE_CONTROL,
                      )}
                    >
                      {value.toString()}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBalanceFraction(100n)}
                    aria-label={`Use maximum ${fromSymbol} balance`}
                    disabled={interactionLocked || balanceStatus !== "ready"}
                    className={cn(
                      "rounded-[var(--radius-xs)] px-2 py-1 text-[10px] font-semibold text-accent outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45",
                      PRESSABLE_CONTROL,
                    )}
                  >
                    Max
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative z-10 -my-[18px] flex justify-center">
            <button
              type="button"
              onClick={reverse}
              disabled={interactionLocked}
              className={cn(
                "grid size-11 place-items-center rounded-[12px] border-4 border-background-secondary bg-background-elevated text-muted-foreground outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                PRESSABLE_CONTROL,
              )}
              aria-label={`Switch to ${direction === "buy" ? `selling ${base}` : `buying ${base}`}`}
            >
              <motion.span
                className="flex"
                animate={{ transform: `rotate(${directionRotation}deg)` }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              >
                <ArrowDownUp aria-hidden="true" className="size-4" />
              </motion.span>
            </button>
          </div>

          <div className="flex min-h-[152px] flex-col rounded-[var(--radius)] border border-transparent bg-background-tertiary p-4">
            <div className="flex h-4 items-center justify-between gap-3 text-[13px] leading-4 text-muted-foreground">
              <span>Estimated receive</span>
              {connected ? (
                <span className="truncate text-[11px]">
                  {balanceStatus === "loading"
                    ? "Checking balance"
                    : balances
                      ? <>Balance <span className="font-mono tabular-nums text-foreground-secondary">{formatAtomic(direction === "buy" ? balances.base.atomic : balances.quote.atomic, toDecimals, toSymbol)}</span></>
                      : "Balance —"}
                </span>
              ) : null}
            </div>
            <div className="flex min-h-[76px] flex-1 items-center gap-3">
              <div className="min-w-0 flex-1 [container-type:inline-size]">
                <SwapQuoteAmount
                  announcement={quote ? `Estimated receive ${outputDisplay} ${toSymbol}` : ""}
                  display={outputDisplay}
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[clamp(22px,15cqw,36px)] font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground"
                />
              </div>
              <SwapAssetButton
                ref={receiveAssetButtonRef}
                symbol={toSymbol}
                iconSrc={iconFor(toSymbol)}
                onSelect={onReceiveAssetSelect ? () => onReceiveAssetSelect(toSymbol) : undefined}
                disabled={assetSelectionDisabled || interactionLocked}
                ariaLabel={`Choose receive asset, currently ${toSymbol}`}
                expanded={assetSelectorSide === "receive"}
              />
            </div>
            <div className="flex min-h-4 items-center text-[11px] leading-4 text-muted-foreground">
              <span className="truncate">
                {quote ? `Est. fee ${(Number(quote.maxSpotTakerFeeRateRaw) / 10_000).toFixed(3)}% · Unfilled amount returns` : ""}
              </span>
            </div>
          </div>

          {notice ? (
            <div
              role={notice.tone === "error" ? "alert" : "status"}
              className={cn(
                "mx-1 mt-3 flex gap-2.5 rounded-[var(--radius-sm)] border p-3 text-foreground",
                notice.tone === "error"
                  ? "border-destructive/35 bg-destructive/[0.08]"
                  : "border-warning/35 bg-warning/[0.07]",
              )}
            >
              {notice.tone === "error"
                ? <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                : <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div className="min-w-0">
                <p className="text-pretty text-[12px] font-semibold leading-4">{notice.title}</p>
                {notice.body ? <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">{notice.body}</p> : null}
                {notice.action === "acknowledge" ? (
                  <button
                    type="button"
                    onClick={() => void acknowledgeAmbiguity()}
                    disabled={ambiguityChecking}
                    aria-busy={ambiguityChecking}
                    className={cn(
                      "mt-2 min-h-11 rounded-[var(--radius-sm)] border border-border-strong bg-background-elevated px-3 text-[12px] font-semibold text-foreground outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring",
                      PRESSABLE_CONTROL,
                    )}
                  >
                    {ambiguityChecking ? "Checking Aptos…" : "Check Aptos and recover"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={primaryAction}
            disabled={cta.disabled || interactionLocked}
            aria-busy={snapshotStatus === "loading" || submitStage !== "idle"}
            className={cn(
              "mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent px-4 py-2 text-center font-display text-[17px] font-semibold leading-5 text-accent-foreground outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-background-elevated disabled:text-muted-foreground disabled:opacity-100",
              PRESSABLE_CONTROL,
            )}
          >
            {(snapshotStatus === "loading" || submitStage !== "idle") ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {cta.label}
          </button>

          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className={cn(
              "mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-card-border bg-background px-3 text-left text-[12px] text-muted-foreground outline-none hover:border-border-strong hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-ring",
              PRESSABLE_CONTROL,
            )}
            aria-expanded={detailsOpen}
            aria-controls={detailsPanelId}
          >
            <span className="min-w-0 truncate font-mono tabular-nums">
              {quote ? `1 ${base} ≈ ${quotePrice.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC` : "Enter an amount to see price details"}
            </span>
            <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", detailsOpen && "rotate-180")} />
          </button>

          <AnimatePresence initial={false}>
            {detailsOpen ? (
              <motion.div
                id={detailsPanelId}
                initial={reduceMotion ? false : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
                animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
                exit={reduceMotion ? undefined : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
                transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] }}
                className="mx-1 mb-1 mt-2 space-y-2 rounded-[var(--radius-sm)] border border-card-border bg-card p-3"
              >
                <DetailRow label="Route" value="Decibel spot" tone="positive" />
                <DetailRow label="Price impact" value={Number.isFinite(priceImpact) ? percent(priceImpact) : "No midpoint"} tone={highRisk ? "warning" : undefined} />
                <DetailRow label="Bid / ask spread" value={Number.isFinite(spread) ? percent(spread) : "One-sided book"} tone={highRisk ? "warning" : undefined} />
                <DetailRow label="Max price movement" value={`${DECIBEL_SPOT_MAX_SLIPPAGE_BPS / 100}%`} />
                <DetailRow label="Order behavior" value="Immediate or cancel" />
                <div className="border-t border-card-border pt-2 text-pretty text-[10px] leading-4 text-muted-foreground">
                  Decibel charges its current spot taker fee in the asset you receive. This integration does not add a builder fee. APT is required for network gas.
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </SwapFlowScreen>
      )}
      </AnimatePresence>

      <WalletSelector open={walletOpen} onClose={() => setWalletOpen(false)} preferredChain="Aptos" />
    </section>
  );

  if (!marketLayout) return form;
  return (
    <SwapMarketLayout
      orderBookProps={{
        marketName: market.marketName,
        marketAddress: market.marketAddress,
        networkOverride: "mainnet",
        currentPrice: snapshot?.market.mid ? Number(snapshot.market.mid) : undefined,
      }}
    >
      {form}
    </SwapMarketLayout>
  );
}
