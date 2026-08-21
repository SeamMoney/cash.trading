"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
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

import { BUTTON_PRIMARY } from "@/components/portfolio/portfolio-surface";
import type {
  ControlledOrderBookData,
  OrderBookTrade,
} from "@/components/trade/OrderBook";
import { CashSwapReview } from "@/components/trade/cash-swap/CashSwapReview";
import { CashSwapTransactionState } from "@/components/trade/cash-swap/CashSwapTransactionState";
import { SwapAssetButton } from "@/components/trade/swap/SwapAssetButton";
import { SwapFlowScreen } from "@/components/trade/swap/SwapFlowScreen";
import { SwapMarketLayout } from "@/components/trade/swap/SwapMarketLayout";
import { SwapQuoteAmount } from "@/components/trade/swap/SwapQuoteAmount";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import {
  confirmCashMigrationTransaction,
  confirmCashSwapTransaction,
  isAptosTransactionHash,
} from "@/lib/cash-orderbook-confirmation";
import {
  cashAmbiguityQuarantineStorageKey,
  cashAmbiguityStorageKey,
  cashSwapFunctionArguments,
  cashWalletLockName,
  clearCashAmbiguity,
  loadCashAmbiguity,
  makeCashMigrationAmbiguityIdentity,
  makeCashSwapAmbiguityIdentity,
  normalizeCashAmbiguityOwner,
  persistCashAmbiguity,
  validateCashAmbiguityRecord,
  validateCashAmbiguityRecovery,
  validateSignedCashRawTransaction,
  type CashAmbiguityPrepareResponse,
  type CashAmbiguityRecord,
  type CashAmbiguityResolveResponse,
  type CashStoredAmbiguity,
} from "@/lib/cash-orderbook-ambiguity";
import {
  buildCashBuyPayload,
  buildCashMigrationPayload,
  buildCashSellPayload,
  CASH_LOT_SIZE,
  CASH_MIN_ORDER_SIZE,
  CASH_SWAP_SLIPPAGE_BPS,
  minimumCashBuyCost,
  quoteCashBuy,
  quoteCashSell,
  type CashBuyQuote,
  type CashOrderbookDepth,
  type CashSellQuote,
} from "@/lib/cash-orderbook";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { hasDecibelSpotWalletOperationEvidence } from "@/lib/wallet-operation-guard";

export type CashSpotSwapPreviewState =
  | "default"
  | "hover"
  | "focus-visible"
  | "active"
  | "disabled"
  | "loading"
  | "error"
  | "success";

export interface CashSpotSwapProps {
  marketLayout?: boolean;
  previewState?: CashSpotSwapPreviewState;
  onPayAssetSelect?: (currentSymbol: AssetSymbol) => void;
  onReceiveAssetSelect?: (currentSymbol: AssetSymbol) => void;
  onDirectionChange?: (direction: Direction) => void;
  assetSelectionDisabled?: boolean;
  assetSelectorSide?: "pay" | "receive" | null;
  payAssetButtonRef?: Ref<HTMLButtonElement>;
  receiveAssetButtonRef?: Ref<HTMLButtonElement>;
  initialDirection?: Direction;
}

type Direction = "buy" | "sell";
type AssetSymbol = "CASH" | "USDC";
type SubmitStage = "idle" | "wallet" | "chain";

interface DepthResponse {
  ready: boolean;
  contractAddress: string;
  depth: CashOrderbookDepth | null;
  depthTruncated?: boolean;
  execution?: {
    nodeBudget: number;
    bids: { scannedNodes: number; hasMoreRawNodes: boolean };
    asks: { scannedNodes: number; hasMoreRawNodes: boolean };
  } | null;
  message?: string;
  excludedOwner?: string | null;
}

interface WalletBalances {
  CASH: number | null;
  USDC: number | null;
  legacyCash: number | null;
  APT: number | null;
}

interface BalanceResponse {
  balances?: Partial<WalletBalances>;
  error?: string;
}

interface TradesResponse {
  ready: boolean;
  trades?: OrderBookTrade[];
  message?: string;
}

interface SwapReceipt {
  paid: number;
  received: number;
  fromSymbol: AssetSymbol;
  toSymbol: AssetSymbol;
  quoted?: boolean;
}

interface QuoteSnapshot {
  inputKey: string;
  signature: string;
  bookUpdatedAt: number;
}

interface ReviewQuoteSnapshot {
  inputKey: string;
  receiveAmount: number;
  signature: string;
}

interface SubmissionGuard {
  owner: string;
  quoteSignature: string;
  contractAddress: string;
  bookUpdatedAt: number;
  executable: boolean;
}

const SAMPLE_DEPTH: CashOrderbookDepth = {
  bids: [
    { price: 0.00001293, quantity: 1_941_000 },
    { price: 0.00001288, quantity: 8_400_000 },
  ],
  asks: [
    { price: 0.00001307, quantity: 12_000_000 },
    { price: 0.00001312, quantity: 48_000_000 },
  ],
};
const SAMPLE_BOOK_UPDATED_AT = 1_787_030_000_000;

const SAMPLE_TRADES: OrderBookTrade[] = [
  {
    id: "preview-buy",
    price: 0.00001307,
    size: 1_912_000,
    side: "buy",
    timestamp: 1_787_030_000_000,
  },
  {
    id: "preview-sell",
    price: 0.00001293,
    size: 850_000,
    side: "sell",
    timestamp: 1_787_029_941_000,
  },
];

const EMPTY_BALANCES: WalletBalances = {
  CASH: null,
  USDC: null,
  legacyCash: null,
  APT: null,
};

const PREVIEW_BALANCES: WalletBalances = {
  CASH: 600_000_000,
  USDC: 250,
  legacyCash: 0,
  APT: 1.42,
};

const QUOTE_STALE_AFTER_MS = 15_000;
const HIGH_PRICE_IMPACT_PCT = 1;
const SLIPPAGE_LABEL = `Max ${CASH_SWAP_SLIPPAGE_BPS / 100}%`;
const PENDING_SWAP_STORAGE_PREFIX = "cash:pending-spot-swap:v1";
const PENDING_MIGRATION_STORAGE_PREFIX = "cash:pending-legacy-migration:v1";

interface StoredPendingSwap {
  ambiguity: CashAmbiguityRecord;
  hash: string;
  owner: string;
  contractAddress: string;
  receipt: SwapReceipt;
  createdAt: number;
}

interface StoredPendingMigration {
  ambiguity: CashAmbiguityRecord;
  hash: string;
  owner: string;
  createdAt: number;
}

type WalletLockResult =
  | { kind: "swap-pending"; pending: StoredPendingSwap }
  | { kind: "migration-pending"; pending: StoredPendingMigration }
  | { kind: "ambiguous"; ambiguity: CashStoredAmbiguity }
  | { kind: "storage-unavailable" }
  | { kind: "retry"; message: string }
  | { kind: "submitted-swap"; pending: StoredPendingSwap }
  | { kind: "submitted-migration"; pending: StoredPendingMigration };

function pendingSwapStorageKey(owner: string) {
  return `${PENDING_SWAP_STORAGE_PREFIX}:${owner.toLowerCase()}`;
}

function receiptFromAmbiguity(ambiguity: CashAmbiguityRecord): SwapReceipt {
  if (ambiguity.identity.operation !== "swap") {
    throw new Error("CASH swap receipt requires a swap ambiguity record");
  }
  const identity = ambiguity.identity;
  const cash = atomicSixDecimalsToNumber(identity.cashAmountAtomic);
  const quote = atomicSixDecimalsToNumber(identity.expectedQuoteAmountAtomic);
  return identity.direction === "buy"
    ? { paid: quote, received: cash, fromSymbol: "USDC", toSymbol: "CASH", quoted: true }
    : { paid: cash, received: quote, fromSymbol: "CASH", toSymbol: "USDC", quoted: true };
}

function persistPendingSwap(stored: StoredPendingSwap): boolean {
  try {
    const validated = validateCashAmbiguityRecord(stored.ambiguity, stored.owner);
    if (validated.identity.operation !== "swap") return false;
    const normalized: StoredPendingSwap = {
      ...stored,
      owner: validated.ownerAddress,
      contractAddress: validated.identity.contractAddress,
      receipt: receiptFromAmbiguity(validated),
      createdAt: validated.createdAt,
      ambiguity: validated,
    };
    if (!isAptosTransactionHash(normalized.hash)) return false;
    const raw = JSON.stringify(normalized);
    const key = pendingSwapStorageKey(normalized.owner);
    window.localStorage.setItem(key, raw);
    return window.localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

function readPersistedPendingSwap(owner: string): StoredPendingSwap | null {
  try {
    const raw = window.localStorage.getItem(pendingSwapStorageKey(owner));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredPendingSwap>;
    const ambiguity = validateCashAmbiguityRecord(stored.ambiguity, owner);
    if (ambiguity.identity.operation !== "swap") return null;
    const expectedReceipt = receiptFromAmbiguity(ambiguity);
    if (
      !stored.hash
      || !isAptosTransactionHash(stored.hash)
      || stored.owner?.toLowerCase() !== ambiguity.ownerAddress.toLowerCase()
      || stored.contractAddress?.toLowerCase() !== ambiguity.identity.contractAddress.toLowerCase()
      || JSON.stringify(stored.receipt) !== JSON.stringify(expectedReceipt)
      || stored.createdAt !== ambiguity.createdAt
    ) return null;
    return { ...(stored as StoredPendingSwap), ambiguity, receipt: expectedReceipt };
  } catch {
    // Preserve malformed evidence. loadCashAmbiguity quarantines legacy or
    // malformed records before another wallet request can start.
    return null;
  }
}

function pendingMigrationStorageKey(owner: string) {
  return `${PENDING_MIGRATION_STORAGE_PREFIX}:${owner.toLowerCase()}`;
}

function persistPendingMigration(stored: StoredPendingMigration) {
  try {
    const ambiguity = validateCashAmbiguityRecord(stored.ambiguity, stored.owner);
    if (ambiguity.identity.operation !== "migration" || !isAptosTransactionHash(stored.hash)) return false;
    const normalized: StoredPendingMigration = {
      ...stored,
      ambiguity,
      owner: ambiguity.ownerAddress,
      createdAt: ambiguity.createdAt,
    };
    const raw = JSON.stringify(normalized);
    const key = pendingMigrationStorageKey(normalized.owner);
    window.localStorage.setItem(key, raw);
    return window.localStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}

function readPersistedPendingMigration(owner: string): StoredPendingMigration | null {
  try {
    const raw = window.localStorage.getItem(pendingMigrationStorageKey(owner));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredPendingMigration>;
    const ambiguity = validateCashAmbiguityRecord(stored.ambiguity, owner);
    if (
      ambiguity.identity.operation !== "migration"
      ||
      !stored.hash
      || !isAptosTransactionHash(stored.hash)
      || stored.owner?.toLowerCase() !== ambiguity.ownerAddress.toLowerCase()
      || stored.createdAt !== ambiguity.createdAt
    ) return null;
    return { ...(stored as StoredPendingMigration), ambiguity };
  } catch {
    // Preserve malformed evidence for quarantine.
    return null;
  }
}

async function withOwnerWalletLock<T>(owner: string, task: () => Promise<T>): Promise<T | null> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error("Safe cross-tab wallet coordination is unavailable in this browser");
  }
  return navigator.locks.request(
    cashWalletLockName(owner),
    { mode: "exclusive", ifAvailable: true },
    (lock) => lock ? task() : null,
  );
}

async function requestPreparedAmbiguity(
  ownerAddress: string,
  identity: CashAmbiguityRecord["identity"],
) {
  const response = await fetch("/api/cash-orderbook/recovery", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", ownerAddress, identity }),
  });
  const body = await response.json() as Partial<CashAmbiguityPrepareResponse> & { message?: string };
  if (!response.ok || !body.ready || body.action !== "prepare" || !body.ambiguity) {
    throw new Error(body.message || "Aptos account sequence could not be verified");
  }
  const ambiguity = validateCashAmbiguityRecord(body.ambiguity, ownerAddress);
  if (JSON.stringify(ambiguity.identity) !== JSON.stringify(identity)) {
    throw new Error("Aptos account sequence was returned for another CASH transaction");
  }
  return ambiguity;
}

async function requestAmbiguityRecovery(ambiguity: CashAmbiguityRecord) {
  const response = await fetch("/api/cash-orderbook/recovery", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve", ambiguity }),
  });
  const body = await response.json() as Partial<CashAmbiguityResolveResponse> & { message?: string };
  if (!response.ok || !body.ready || body.action !== "resolve" || !body.recovery) {
    throw new Error(body.message || "Aptos wallet activity could not be verified");
  }
  return validateCashAmbiguityRecovery(body.recovery, ambiguity);
}

function pendingSwapFromAmbiguity(hash: string, ambiguity: CashAmbiguityRecord): StoredPendingSwap {
  const validated = validateCashAmbiguityRecord(ambiguity);
  if (validated.identity.operation !== "swap" || !isAptosTransactionHash(hash)) {
    throw new Error("Recovered CASH swap evidence was invalid");
  }
  return {
    ambiguity: validated,
    hash,
    owner: validated.ownerAddress,
    contractAddress: validated.identity.contractAddress,
    receipt: receiptFromAmbiguity(validated),
    createdAt: validated.createdAt,
  };
}

function pendingMigrationFromAmbiguity(
  hash: string,
  ambiguity: CashAmbiguityRecord,
): StoredPendingMigration {
  const validated = validateCashAmbiguityRecord(ambiguity);
  if (validated.identity.operation !== "migration" || !isAptosTransactionHash(hash)) {
    throw new Error("Recovered CASH migration evidence was invalid");
  }
  return {
    ambiguity: validated,
    hash,
    owner: validated.ownerAddress,
    createdAt: validated.createdAt,
  };
}

function clearExpectedAmbiguityOrAlreadyCleared(expected: CashAmbiguityRecord) {
  const loaded = loadCashAmbiguity(window.localStorage, expected.ownerAddress);
  if (loaded.status === "none") return true;
  if (
    loaded.status !== "valid"
    || JSON.stringify(loaded.record) !== JSON.stringify(expected)
  ) return false;
  return clearCashAmbiguity(window.localStorage, expected);
}

async function clearResolvedPendingSwap(expected: StoredPendingSwap) {
  const result = await withOwnerWalletLock(expected.owner, async () => {
    const current = readPersistedPendingSwap(expected.owner);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return false;
    const key = pendingSwapStorageKey(expected.owner);
    const raw = window.localStorage.getItem(key);
    if (raw !== JSON.stringify(current)) return false;
    if (!clearExpectedAmbiguityOrAlreadyCleared(expected.ambiguity)) return false;
    if (window.localStorage.getItem(key) !== raw) return false;
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  });
  return result === true;
}

async function clearResolvedPendingMigration(expected: StoredPendingMigration) {
  const result = await withOwnerWalletLock(expected.owner, async () => {
    const current = readPersistedPendingMigration(expected.owner);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return false;
    const key = pendingMigrationStorageKey(expected.owner);
    const raw = window.localStorage.getItem(key);
    if (raw !== JSON.stringify(current)) return false;
    if (!clearExpectedAmbiguityOrAlreadyCleared(expected.ambiguity)) return false;
    if (window.localStorage.getItem(key) !== raw) return false;
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  });
  return result === true;
}

function formatAmount(
  value: number,
  maximumFractionDigits = 6,
  minimumFractionDigits = 0,
) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(value);
}

function formatPrice(value: number) {
  return value > 0
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: 8,
        maximumFractionDigits: 12,
      })
    : "—";
}

function formatWalletBalance(value: number, symbol: AssetSymbol) {
  if (value >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatAmount(value, symbol === "CASH" ? 0 : 2);
}

function amountForInput(value: number, symbol: AssetSymbol) {
  const maximumFractionDigits = symbol === "CASH" ? 0 : 6;
  return value
    .toFixed(maximumFractionDigits)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function atomicSixDecimalsToNumber(value: string) {
  return Number(BigInt(value)) / 1_000_000;
}

function wasRejectedByWallet(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return message.trim() === "User has rejected the request";
}

function friendlyTransactionError(cause: unknown, confirmedFailure = false) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (wasRejectedByWallet(cause)) {
    return "Transaction cancelled in your wallet.";
  }
  if (/insufficient.*gas|gas.*insufficient|sequence_number_too_old/i.test(message)) {
    return "Your wallet needs a little more APT for gas. Add APT, then try again.";
  }
  if (/min.*output|slippage|price.*move|limit.*exceed/i.test(message)) {
    return "Price moved before the transaction landed. Review the new amount and try again.";
  }
  if (/insufficient/i.test(message)) {
    return "Your wallet balance is too low for this swap.";
  }
  return confirmedFailure
    ? "The swap failed on Aptos. Your assets stayed in your wallet."
    : "Aptos has not verified the wallet request yet. Use Check swap status before retrying.";
}

function friendlyMigrationError(cause: unknown, confirmedFailure = false) {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (wasRejectedByWallet(cause)) {
    return "Migration cancelled in your wallet.";
  }
  if (/insufficient.*gas|gas.*insufficient|sequence_number_too_old/i.test(message)) {
    return "Your wallet needs a little more APT for gas. Add APT, then try again.";
  }
  return confirmedFailure
    ? "CASH migration failed on Aptos. Your CASH stayed in your wallet."
    : "Aptos has not verified the migration request yet. Use Check migration status before retrying.";
}

function TokenIcon({ symbol }: { symbol: AssetSymbol }) {
  return (
    <Image
      src={symbol === "CASH" ? "/tokens/cash.png" : "/tokens/usdc.png"}
      alt=""
      width={28}
      height={28}
      className="size-6 shrink-0 rounded-full object-cover min-[360px]:size-7"
    />
  );
}

function DetailRow({ label, value, valueClassName }: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px] leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-mono tabular-nums text-foreground-secondary", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

export function CashSpotSwap({
  marketLayout = false,
  previewState,
  onPayAssetSelect,
  onReceiveAssetSelect,
  onDirectionChange,
  assetSelectionDisabled = false,
  assetSelectorSide = null,
  payAssetButtonRef,
  receiveAssetButtonRef,
  initialDirection = "buy",
}: CashSpotSwapProps = {}) {
  const {
    account,
    connected,
    network,
    signTransaction,
    submitTransaction,
  } = useWallet();
  const reduceMotion = useReducedMotion();
  const isPreview = Boolean(previewState);
  const effectiveConnected = isPreview || connected;
  const ownerAddress = account?.address
    ? normalizeCashAmbiguityOwner(account.address.toString())
    : "";
  const balanceContext = `${connected}:${ownerAddress}`;
  const depthContext = ownerAddress.toLowerCase();

  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [amount, setAmount] = useState(isPreview ? "25" : "");
  const [walletOpen, setWalletOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!isPreview || previewState === "loading");
  const [refreshing, setRefreshing] = useState(false);
  const [submitStage, setSubmitStage] = useState<SubmitStage>("idle");
  const [transactionError, setTransactionError] = useState(
    previewState === "error" ? "Live orderbook quotes are temporarily unavailable." : "",
  );
  const [successHash, setSuccessHash] = useState(previewState === "success" ? "0xpreview" : "");
  const [failedHash, setFailedHash] = useState("");
  const [pendingHash, setPendingHash] = useState("");
  const [pendingOwner, setPendingOwner] = useState("");
  const [pendingContractAddress, setPendingContractAddress] = useState("");
  const [pendingReceipt, setPendingReceipt] = useState<SwapReceipt | null>(null);
  const [confirmationDelayed, setConfirmationDelayed] = useState(false);
  const [verificationIssue, setVerificationIssue] = useState("");
  const [submissionOutcomeUnknown, setSubmissionOutcomeUnknown] = useState(false);
  const [submissionAmbiguity, setSubmissionAmbiguity] = useState<CashAmbiguityRecord | null>(null);
  const [ambiguityQuarantineReason, setAmbiguityQuarantineReason] = useState("");
  const [ambiguityChecking, setAmbiguityChecking] = useState(false);
  const [pendingAmbiguity, setPendingAmbiguity] = useState<CashAmbiguityRecord | null>(null);
  const [migrationStage, setMigrationStage] = useState<SubmitStage>("idle");
  const [migrationHash, setMigrationHash] = useState("");
  const [migrationOwner, setMigrationOwner] = useState("");
  const [migrationDelayed, setMigrationDelayed] = useState(false);
  const [migrationVerificationIssue, setMigrationVerificationIssue] = useState("");
  const [migrationOutcomeUnknown, setMigrationOutcomeUnknown] = useState(false);
  const [migrationAmbiguity, setMigrationAmbiguity] = useState<CashAmbiguityRecord | null>(null);
  const [migrationSuccessHash, setMigrationSuccessHash] = useState("");
  const [receipt, setReceipt] = useState<SwapReceipt | null>(
    previewState === "success"
      ? { paid: 25, received: 1_912_000, fromSymbol: "USDC", toSymbol: "CASH" }
      : null,
  );
  const [bookUpdatedAt, setBookUpdatedAt] = useState(isPreview ? SAMPLE_BOOK_UPDATED_AT : 0);
  const [clock, setClock] = useState(() => Date.now());
  const [directionRotation, setDirectionRotation] = useState(0);
  const [quoteNeedsReview, setQuoteNeedsReview] = useState(false);
  const [highImpactAcknowledged, setHighImpactAcknowledged] = useState(false);
  const [flowScreen, setFlowScreen] = useState<"form" | "review">("form");
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewQuoteSnapshot | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [balances, setBalances] = useState<WalletBalances>(
    isPreview ? PREVIEW_BALANCES : EMPTY_BALANCES,
  );
  const [balanceOwnerContext, setBalanceOwnerContext] = useState(
    isPreview ? balanceContext : "__unloaded__",
  );
  const [book, setBook] = useState<DepthResponse>({
    ready: isPreview && previewState !== "disabled" && previewState !== "error",
    contractAddress: isPreview ? "0xcafe" : "",
    depth: isPreview ? SAMPLE_DEPTH : null,
    message: previewState === "error" ? "Live orderbook quotes are temporarily unavailable." : undefined,
  });
  const [bookOwnerContext, setBookOwnerContext] = useState(
    isPreview ? depthContext : "__unloaded__",
  );
  const [marketTrades, setMarketTrades] = useState<OrderBookTrade[]>(
    isPreview ? SAMPLE_TRADES : [],
  );
  const [marketTradesStatus, setMarketTradesStatus] = useState<
    "loading" | "live" | "waiting" | "unavailable"
  >(isPreview ? "live" : "loading");
  const quoteSnapshotRef = useRef<QuoteSnapshot | null>(null);
  const submissionGuardRef = useRef<SubmissionGuard>({
    owner: "",
    quoteSignature: "",
    contractAddress: "",
    bookUpdatedAt: 0,
    executable: false,
  });
  const amountInputRef = useRef<HTMLInputElement>(null);
  const reviewScreenRef = useRef<HTMLDivElement>(null);
  const transactionScreenRef = useRef<HTMLDivElement>(null);
  const focusedScreenRef = useRef("form");
  const confirmationInFlightRef = useRef(new Set<string>());
  const migrationConfirmationInFlightRef = useRef(new Set<string>());
  const depthRequestIdRef = useRef(0);
  const tradesRequestIdRef = useRef(0);
  const depthContextRef = useRef(depthContext);
  const balanceRequestIdRef = useRef(0);
  const balanceContextRef = useRef(balanceContext);
  const activeOwnerRef = useRef(depthContext);
  const activeNetworkChainIdRef = useRef(network?.chainId);
  const previousWalletContextRef = useRef(balanceContext);
  balanceContextRef.current = balanceContext;
  depthContextRef.current = depthContext;
  activeOwnerRef.current = depthContext;
  activeNetworkChainIdRef.current = network?.chainId;

  const adoptPersistedSwap = useCallback((stored: StoredPendingSwap) => {
    setPendingHash(stored.hash);
    setPendingOwner(stored.owner);
    setPendingContractAddress(stored.contractAddress);
    setPendingReceipt(stored.receipt);
    setPendingAmbiguity(stored.ambiguity);
    setConfirmationDelayed(true);
    setVerificationIssue("");
    setSubmissionOutcomeUnknown(false);
    setSubmissionAmbiguity(null);
    setAmbiguityQuarantineReason("");
    setSuccessHash("");
    setFailedHash("");
    setReceipt(null);
  }, []);

  const adoptPersistedMigration = useCallback((stored: StoredPendingMigration) => {
    setMigrationHash(stored.hash);
    setMigrationOwner(stored.owner);
    setMigrationAmbiguity(stored.ambiguity);
    setMigrationDelayed(true);
    setMigrationVerificationIssue("");
    setMigrationOutcomeUnknown(false);
    setSubmissionAmbiguity(null);
    setAmbiguityQuarantineReason("");
    setMigrationSuccessHash("");
    setFailedHash("");
  }, []);

  const fetchDepth = useCallback(async (signal?: AbortSignal, manual = false) => {
    if (isPreview) return;
    const requestContext = ownerAddress.toLowerCase();
    const requestId = ++depthRequestIdRef.current;
    const isCurrentRequest = () => (
      depthRequestIdRef.current === requestId
      && depthContextRef.current === requestContext
      && !signal?.aborted
    );
    if (manual) setRefreshing(true);
    try {
      const depthUrl = ownerAddress
        ? `/api/cash-orderbook/depth?excludeOwner=${encodeURIComponent(ownerAddress)}`
        : "/api/cash-orderbook/depth";
      const response = await fetch(depthUrl, {
        cache: "no-store",
        signal,
      });
      const data = await response.json() as DepthResponse;
      if (!response.ok) throw new Error(data.message || `Quote request failed (${response.status})`);
      const responseContext = data.excludedOwner?.toLowerCase() ?? "";
      if (responseContext !== requestContext) {
        throw new Error("The quote was prepared for a different wallet");
      }
      if (isCurrentRequest()) {
        setBook(data);
        setBookOwnerContext(requestContext);
        if (data.ready && data.depth) setBookUpdatedAt(Date.now());
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (isCurrentRequest()) {
        setBook((current) => ({
          ...current,
          ready: false,
          depth: null,
          message: "Live orderbook quotes are temporarily unavailable.",
        }));
        setBookOwnerContext(requestContext);
        setBookUpdatedAt(0);
      }
    } finally {
      if (isCurrentRequest()) {
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [isPreview, ownerAddress]);

  const fetchMarketTrades = useCallback(async (signal?: AbortSignal) => {
    if (isPreview || !marketLayout) return;
    const requestId = ++tradesRequestIdRef.current;
    const isCurrentRequest = () => (
      tradesRequestIdRef.current === requestId
      && !signal?.aborted
    );
    try {
      const response = await fetch("/api/cash-orderbook/trades", {
        cache: "no-store",
        signal,
      });
      const data = await response.json() as TradesResponse;
      if (!response.ok || !data.ready || !Array.isArray(data.trades)) {
        throw new Error(data.message || `Trade request failed (${response.status})`);
      }
      if (isCurrentRequest()) {
        setMarketTrades([...data.trades]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 80));
        setMarketTradesStatus(data.trades.length > 0 ? "live" : "waiting");
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (isCurrentRequest()) {
        setMarketTrades([]);
        setMarketTradesStatus("unavailable");
      }
    }
  }, [isPreview, marketLayout]);

  const fetchBalances = useCallback(async (signal?: AbortSignal) => {
    if (isPreview) return;
    const requestContext = `${connected}:${ownerAddress}`;
    const requestId = ++balanceRequestIdRef.current;
    const isCurrentRequest = () => (
      balanceRequestIdRef.current === requestId
      && balanceContextRef.current === requestContext
      && !signal?.aborted
    );
    if (!connected || !ownerAddress) {
      if (isCurrentRequest()) {
        setBalances(EMPTY_BALANCES);
        setBalanceOwnerContext(requestContext);
        setBalanceError("");
        setBalanceLoading(false);
      }
      return;
    }
    setBalanceLoading(true);
    setBalanceError("");
    try {
      const response = await fetch(
        `/api/cash-orderbook/balances?address=${encodeURIComponent(ownerAddress)}`,
        { cache: "no-store", signal },
      );
      const data = await response.json() as BalanceResponse;
      if (!response.ok || !data.balances) {
        throw new Error(data.error || `Balance request failed (${response.status})`);
      }
      if (isCurrentRequest()) {
        setBalances({
          CASH: typeof data.balances.CASH === "number" ? data.balances.CASH : null,
          USDC: typeof data.balances.USDC === "number" ? data.balances.USDC : null,
          legacyCash: typeof data.balances.legacyCash === "number" ? data.balances.legacyCash : null,
          APT: typeof data.balances.APT === "number" ? data.balances.APT : null,
        });
        setBalanceOwnerContext(requestContext);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (isCurrentRequest()) {
        setBalances(EMPTY_BALANCES);
        setBalanceOwnerContext(requestContext);
        setBalanceError("Balance unavailable");
      }
    } finally {
      if (isCurrentRequest()) setBalanceLoading(false);
    }
  }, [connected, isPreview, ownerAddress]);

  useEffect(() => {
    if (isPreview || previousWalletContextRef.current === balanceContext) return;
    previousWalletContextRef.current = balanceContext;
    setAmount("");
    setTransactionError("");
    setSuccessHash("");
    setFailedHash("");
    setPendingHash("");
    setPendingOwner("");
    setPendingContractAddress("");
    setPendingReceipt(null);
    setPendingAmbiguity(null);
    setConfirmationDelayed(false);
    setVerificationIssue("");
    setSubmissionOutcomeUnknown(false);
    setSubmissionAmbiguity(null);
    setAmbiguityQuarantineReason("");
    setAmbiguityChecking(false);
    setMigrationStage("idle");
    setMigrationHash("");
    setMigrationOwner("");
    setMigrationAmbiguity(null);
    setMigrationDelayed(false);
    setMigrationVerificationIssue("");
    setMigrationOutcomeUnknown(false);
    setMigrationSuccessHash("");
    setReceipt(null);
    setSubmitStage("idle");
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
    setBalances(EMPTY_BALANCES);
    setBalanceError("");
    setBalanceLoading(Boolean(connected && ownerAddress));
    setBookUpdatedAt(0);
    setInitialLoading(true);
    quoteSnapshotRef.current = null;
  }, [balanceContext, connected, isPreview, ownerAddress]);

  useEffect(() => {
    if (isPreview) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (!document.hidden) await fetchDepth(controller.signal);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 5_000);
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchDepth, isPreview]);

  useEffect(() => {
    if (isPreview || !marketLayout) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (!document.hidden) await fetchMarketTrades(controller.signal);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 5_000);
    };
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchMarketTrades, isPreview, marketLayout]);

  useEffect(() => {
    if (isPreview) return;
    const controller = new AbortController();
    void fetchBalances(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchBalances();
    }, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [fetchBalances, isPreview]);

  useEffect(() => {
    if (isPreview || !connected || !ownerAddress) return;

    const swapKey = pendingSwapStorageKey(ownerAddress);
    const migrationKey = pendingMigrationStorageKey(ownerAddress);
    const ambiguityKey = cashAmbiguityStorageKey(ownerAddress);
    const quarantineKey = cashAmbiguityQuarantineStorageKey(ownerAddress);

    const syncWalletSafetyState = () => {
      const storedSwap = readPersistedPendingSwap(ownerAddress);
      if (storedSwap) {
        adoptPersistedSwap(storedSwap);
        setMigrationOutcomeUnknown(false);
        return;
      }
      const storedMigration = readPersistedPendingMigration(ownerAddress);
      if (storedMigration) {
        adoptPersistedMigration(storedMigration);
        setSubmissionOutcomeUnknown(false);
        return;
      }
      const loaded = loadCashAmbiguity(window.localStorage, ownerAddress);
      if (loaded.status === "valid") {
        setSubmissionAmbiguity(loaded.record);
        setAmbiguityQuarantineReason("");
        setSubmissionOutcomeUnknown(loaded.record.identity.operation === "swap");
        setMigrationOutcomeUnknown(loaded.record.identity.operation === "migration");
        return;
      }
      setSubmissionAmbiguity(null);
      setAmbiguityQuarantineReason(loaded.status === "quarantined" ? loaded.reason : "");
      setSubmissionOutcomeUnknown(loaded.status === "quarantined");
      setMigrationOutcomeUnknown(false);
    };

    syncWalletSafetyState();

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (
        event.key === swapKey
        || event.key === migrationKey
        || event.key === ambiguityKey
        || event.key === quarantineKey
      ) syncWalletSafetyState();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [
    adoptPersistedMigration,
    adoptPersistedSwap,
    connected,
    isPreview,
    ownerAddress,
  ]);

  useEffect(() => {
    if (!bookUpdatedAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [bookUpdatedAt]);

  const bookMatchesWallet = isPreview || bookOwnerContext === depthContext;
  const balanceMatchesWallet = isPreview || balanceOwnerContext === balanceContext;
  const activeDepth = bookMatchesWallet ? book.depth : null;
  const activeExecution = bookMatchesWallet ? book.execution : null;
  const bookReady = bookMatchesWallet && book.ready;
  const walletBalances = balanceMatchesWallet ? balances : EMPTY_BALANCES;
  const inputAmount = Number(amount);
  const buyQuote = useMemo<CashBuyQuote | null>(() => (
    direction === "buy" && activeDepth ? quoteCashBuy(amount, activeDepth) : null
  ), [activeDepth, amount, direction]);
  const sellQuote = useMemo<CashSellQuote | null>(() => (
    direction === "sell" && activeDepth ? quoteCashSell(amount, activeDepth) : null
  ), [activeDepth, amount, direction]);
  const activeQuote = buyQuote ?? sellQuote;
  const outputAmount = buyQuote?.cashAmount ?? sellQuote?.usdcAmount ?? 0;
  const fromSymbol: AssetSymbol = direction === "buy" ? "USDC" : "CASH";
  const toSymbol: AssetSymbol = direction === "buy" ? "CASH" : "USDC";
  const hasLiquidity = direction === "buy"
    ? Boolean(activeDepth?.asks.length)
    : Boolean(activeDepth?.bids.length);
  const sufficientLiquidity = activeQuote?.sufficientLiquidity ?? false;
  const executableSide = direction === "buy" ? activeExecution?.asks : activeExecution?.bids;
  const executionLimitReached = Boolean(
    inputAmount > 0
    && !sufficientLiquidity
    && executableSide?.hasMoreRawNodes,
  );
  const effectiveLoading = initialLoading
    || (!isPreview && !bookMatchesWallet)
    || previewState === "loading";
  const quoteAgeSeconds = bookUpdatedAt ? Math.max(0, Math.floor((clock - bookUpdatedAt) / 1_000)) : null;
  const quoteStale = Boolean(!isPreview && bookReady && bookUpdatedAt && clock - bookUpdatedAt > QUOTE_STALE_AFTER_MS);
  const fromBalance = walletBalances[fromSymbol];
  const toBalance = walletBalances[toSymbol];
  const executableInputAmount = buyQuote?.maxUsdcAmount ?? sellQuote?.cashAmount ?? inputAmount;
  const insufficientBalance = effectiveConnected
    && fromBalance !== null
    && executableInputAmount > 0
    && executableInputAmount > fromBalance;
  const needsGas = effectiveConnected && walletBalances.APT !== null && walletBalances.APT <= 0;
  const wrongNetwork = !isPreview
    && connected
    && network?.chainId !== 1;
  const minimumBuyUsdc = activeDepth ? minimumCashBuyCost(activeDepth) : null;
  const minimumBuyUnavailable = direction === "buy"
    && inputAmount > 0
    && hasLiquidity
    && !buyQuote
    && minimumBuyUsdc === null;
  const belowMinimum = inputAmount > 0
    && hasLiquidity
    && !activeQuote
    && (direction === "sell"
      ? inputAmount < CASH_MIN_ORDER_SIZE
      : minimumBuyUsdc !== null && inputAmount < minimumBuyUsdc);
  const alignmentAdjusted = Boolean(
    sellQuote
    && inputAmount > 0
    && Math.abs(inputAmount - sellQuote.cashAmount) >= 0.000001,
  );
  const orderbookCurrentPrice = useMemo(() => {
    const bestBid = activeDepth?.bids[0]?.price ?? 0;
    const bestAsk = activeDepth?.asks[0]?.price ?? 0;
    return bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  }, [activeDepth]);
  const controlledOrderbookData = useMemo<ControlledOrderBookData>(() => ({
    book: {
      bids: (activeDepth?.bids ?? []).map((level) => ({
        price: level.price,
        size: level.quantity,
      })),
      asks: (activeDepth?.asks ?? []).map((level) => ({
        price: level.price,
        size: level.quantity,
      })),
      timestamp: bookUpdatedAt || null,
    },
    status: effectiveLoading ? "loading" : bookReady ? "live" : "unavailable",
    trades: marketTrades,
    tradesStatus: marketTradesStatus,
    network: "mainnet",
    priceStep: 0.00000001,
  }), [
    activeDepth,
    bookReady,
    bookUpdatedAt,
    effectiveLoading,
    marketTrades,
    marketTradesStatus,
  ]);

  const quoteSignature = buyQuote
    ? `buy:${buyQuote.cashAmountAtomic}:${buyQuote.usdcSpentAtomic}:${buyQuote.maxUsdcAmountAtomic}:${buyQuote.minCashAmountAtomic}:${buyQuote.priceImpactPct.toFixed(6)}:${buyQuote.spreadPct.toFixed(6)}:${buyQuote.referencePriceAvailable}:${buyQuote.sufficientLiquidity}`
    : sellQuote
      ? `sell:${sellQuote.cashAmountAtomic}:${sellQuote.usdcAmountAtomic}:${sellQuote.minUsdcAmountAtomic}:${sellQuote.priceImpactPct.toFixed(6)}:${sellQuote.spreadPct.toFixed(6)}:${sellQuote.referencePriceAvailable}:${sellQuote.sufficientLiquidity}`
      : "";
  const quoteInputKey = `${direction}:${amount}`;
  submissionGuardRef.current = {
    owner: depthContext,
    quoteSignature,
    contractAddress: book.contractAddress,
    bookUpdatedAt,
    executable: Boolean(
      activeQuote
      && sufficientLiquidity
      && bookReady
      && !quoteNeedsReview
    ),
  };

  useEffect(() => {
    if (!activeQuote || !bookUpdatedAt) {
      quoteSnapshotRef.current = null;
      return;
    }
    const previous = quoteSnapshotRef.current;
    if (
      previous
      && previous.inputKey === quoteInputKey
      && previous.bookUpdatedAt !== bookUpdatedAt
      && previous.signature !== quoteSignature
    ) {
      setQuoteNeedsReview(true);
      setHighImpactAcknowledged(false);
    }
    quoteSnapshotRef.current = {
      inputKey: quoteInputKey,
      signature: quoteSignature,
      bookUpdatedAt,
    };
  }, [activeQuote, bookUpdatedAt, quoteInputKey, quoteSignature]);

  useEffect(() => {
    if (flowScreen !== "review" || activeQuote) return;
    setFlowScreen("form");
    setReviewSnapshot(null);
  }, [activeQuote, flowScreen]);

  const reverse = useCallback(() => {
    const nextAmount = activeQuote && outputAmount > 0
      ? amountForInput(outputAmount, toSymbol)
      : "";
    const nextDirection = direction === "buy" ? "sell" : "buy";
    setDirection(nextDirection);
    onDirectionChange?.(nextDirection);
    setDirectionRotation((current) => current + 180);
    setAmount(nextAmount);
    setTransactionError("");
    setSuccessHash("");
    setFailedHash("");
    setReceipt(null);
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
    quoteSnapshotRef.current = null;
  }, [activeQuote, direction, onDirectionChange, outputAmount, toSymbol]);

  const setMaximum = useCallback(() => {
    if (fromBalance === null || fromBalance <= 0) return;
    const maximum = fromSymbol === "CASH"
      ? Math.floor(fromBalance / CASH_LOT_SIZE) * CASH_LOT_SIZE
      : fromBalance;
    setAmount(amountForInput(maximum, fromSymbol));
    setTransactionError("");
    setSuccessHash("");
    setFailedHash("");
    setReceipt(null);
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
  }, [fromBalance, fromSymbol]);

  const setBalanceFraction = useCallback((fraction: number) => {
    if (fromBalance === null || fromBalance <= 0) return;
    const requested = fromBalance * fraction;
    const aligned = fromSymbol === "CASH"
      ? Math.floor(requested / CASH_LOT_SIZE) * CASH_LOT_SIZE
      : Math.floor(requested * 1_000_000) / 1_000_000;
    if (aligned <= 0) return;
    setAmount(amountForInput(aligned, fromSymbol));
    setTransactionError("");
    setSuccessHash("");
    setFailedHash("");
    setReceipt(null);
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
  }, [fromBalance, fromSymbol]);

  const confirmSubmittedSwap = useCallback(async (
    transactionHash: string,
    submittedReceipt: SwapReceipt,
    submittedOwner: string,
    submittedContractAddress: string,
    submittedAmbiguity: CashAmbiguityRecord,
  ) => {
    const submittedOwnerContext = submittedOwner.toLowerCase();
    const confirmationKey = `${submittedOwnerContext}:${transactionHash.toLowerCase()}`;
    if (confirmationInFlightRef.current.has(confirmationKey)) return;
    confirmationInFlightRef.current.add(confirmationKey);
    const isActiveOwner = () => activeOwnerRef.current === submittedOwnerContext;
    if (isActiveOwner()) setSubmitStage("chain");
    try {
      const submittedPending = pendingSwapFromAmbiguity(transactionHash, submittedAmbiguity);
      if (
        submittedPending.contractAddress !== normalizeCashAmbiguityOwner(submittedContractAddress)
        || JSON.stringify(submittedPending.receipt) !== JSON.stringify(submittedReceipt)
      ) throw new Error("Pending CASH swap evidence changed");
      const confirmation = await confirmCashSwapTransaction(
        transactionHash,
        submittedOwner,
        submittedReceipt.fromSymbol === "USDC" ? "buy" : "sell",
        submittedContractAddress,
        submittedPending.ambiguity.identity.operation === "swap"
          ? cashSwapFunctionArguments(submittedPending.ambiguity.identity)
          : undefined,
      );
      if (confirmation.status === "unverified") {
        if (isActiveOwner()) {
          setConfirmationDelayed(false);
          setFailedHash(transactionHash);
          setVerificationIssue(
            "The transaction confirmed, but its CASH fill could not be verified. Do not retry or submit another swap.",
          );
          await fetchDepth();
        }
        return;
      }
      if (confirmation.status === "failed") {
        if (!await clearResolvedPendingSwap(submittedPending)) {
          if (isActiveOwner()) {
            setConfirmationDelayed(false);
            setVerificationIssue(
              "Aptos confirmed that the swap failed, but its local safety record could not be cleared. Retrying stays blocked.",
            );
          }
          return;
        }
        if (isActiveOwner()) {
          setPendingHash("");
          setPendingOwner("");
          setPendingContractAddress("");
          setPendingReceipt(null);
          setPendingAmbiguity(null);
          setConfirmationDelayed(false);
          setVerificationIssue("");
          setSubmissionOutcomeUnknown(false);
          setSubmissionAmbiguity(null);
          setFailedHash(transactionHash);
          setTransactionError(friendlyTransactionError(new Error(confirmation.vmStatus), true));
          setFlowScreen("form");
          setReviewSnapshot(null);
          await fetchDepth();
        }
        return;
      }

      if (!await clearResolvedPendingSwap(submittedPending)) {
        if (isActiveOwner()) {
          setConfirmationDelayed(false);
          setVerificationIssue(
            "The swap confirmed, but its local safety record could not be cleared. Retrying stays blocked.",
          );
        }
        return;
      }
      if (isActiveOwner()) {
        setPendingHash("");
        setPendingOwner("");
        setPendingContractAddress("");
        setPendingReceipt(null);
        setPendingAmbiguity(null);
        setConfirmationDelayed(false);
        setVerificationIssue("");
        setSubmissionOutcomeUnknown(false);
        setSubmissionAmbiguity(null);
        setFailedHash("");
        setSuccessHash(transactionHash);
        const baseAmount = atomicSixDecimalsToNumber(confirmation.execution.baseAmountAtomic);
        const quoteAmount = atomicSixDecimalsToNumber(confirmation.execution.quoteAmountAtomic);
        const takerFee = atomicSixDecimalsToNumber(confirmation.execution.takerFeeAtomic);
        setReceipt(submittedReceipt.fromSymbol === "USDC"
          ? {
              paid: quoteAmount + takerFee,
              received: baseAmount,
              fromSymbol: "USDC",
              toSymbol: "CASH",
            }
          : {
              paid: baseAmount,
              received: Math.max(0, quoteAmount - takerFee),
              fromSymbol: "CASH",
              toSymbol: "USDC",
            });
        setAmount("");
        setQuoteNeedsReview(false);
        setHighImpactAcknowledged(false);
        quoteSnapshotRef.current = null;
        await Promise.all([fetchDepth(), fetchBalances(), fetchMarketTrades()]);
      }
    } catch {
      // A submitted hash is not a failed transaction. Keep it visible and
      // continue polling so the user cannot accidentally send a duplicate.
      if (isActiveOwner()) setConfirmationDelayed(true);
    } finally {
      confirmationInFlightRef.current.delete(confirmationKey);
      if (isActiveOwner()) setSubmitStage("idle");
    }
  }, [fetchBalances, fetchDepth, fetchMarketTrades]);

  useEffect(() => {
    if (
      !pendingHash
      || !pendingOwner
      || !pendingContractAddress
      || !pendingReceipt
      || !pendingAmbiguity
      || !confirmationDelayed
      || verificationIssue
    ) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void confirmSubmittedSwap(
          pendingHash,
          pendingReceipt,
          pendingOwner,
          pendingContractAddress,
          pendingAmbiguity,
        );
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [
    confirmSubmittedSwap,
    confirmationDelayed,
    pendingHash,
    pendingAmbiguity,
    pendingContractAddress,
    pendingOwner,
    pendingReceipt,
    verificationIssue,
  ]);

  const confirmSubmittedMigration = useCallback(async (
    transactionHash: string,
    submittedOwner: string,
    submittedAmbiguity: CashAmbiguityRecord,
  ) => {
    const submittedOwnerContext = submittedOwner.toLowerCase();
    const confirmationKey = `${submittedOwnerContext}:${transactionHash.toLowerCase()}`;
    if (migrationConfirmationInFlightRef.current.has(confirmationKey)) return;
    migrationConfirmationInFlightRef.current.add(confirmationKey);
    const isActiveOwner = () => activeOwnerRef.current === submittedOwnerContext;
    if (isActiveOwner()) setMigrationStage("chain");
    try {
      const submittedPending = pendingMigrationFromAmbiguity(transactionHash, submittedAmbiguity);
      const confirmation = await confirmCashMigrationTransaction(transactionHash, submittedOwner);
      if (confirmation.status === "unverified") {
        if (isActiveOwner()) {
          setMigrationDelayed(false);
          setMigrationVerificationIssue(
            "The transaction confirmed, but it could not be verified as this wallet’s reviewed CASH migration. Do not submit another migration.",
          );
          setFailedHash(transactionHash);
        }
        return;
      }
      if (!await clearResolvedPendingMigration(submittedPending)) {
        if (isActiveOwner()) {
          setMigrationDelayed(false);
          setMigrationVerificationIssue(
            "Aptos confirmed the migration, but its local safety record could not be cleared. Retrying stays blocked.",
          );
        }
        return;
      }
      if (confirmation.status === "failed") {
        if (isActiveOwner()) {
          setMigrationHash("");
          setMigrationOwner("");
          setMigrationAmbiguity(null);
          setMigrationDelayed(false);
          setMigrationVerificationIssue("");
          setMigrationOutcomeUnknown(false);
          setSubmissionAmbiguity(null);
          setFailedHash(transactionHash);
          setTransactionError(friendlyMigrationError(new Error(confirmation.vmStatus), true));
        }
        return;
      }

      if (isActiveOwner()) {
        setMigrationHash("");
        setMigrationOwner("");
        setMigrationAmbiguity(null);
        setMigrationDelayed(false);
        setMigrationVerificationIssue("");
        setMigrationOutcomeUnknown(false);
        setSubmissionAmbiguity(null);
        setMigrationSuccessHash(transactionHash);
        setFailedHash("");
        setTransactionError("");
        await fetchBalances();
      }
    } catch {
      // Preserve the submitted hash and poll again; never invite a duplicate.
      if (isActiveOwner()) setMigrationDelayed(true);
    } finally {
      migrationConfirmationInFlightRef.current.delete(confirmationKey);
      if (isActiveOwner()) setMigrationStage("idle");
    }
  }, [fetchBalances]);

  useEffect(() => {
    if (!migrationHash || !migrationOwner || !migrationAmbiguity || !migrationDelayed) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void confirmSubmittedMigration(migrationHash, migrationOwner, migrationAmbiguity);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [confirmSubmittedMigration, migrationDelayed, migrationHash, migrationOwner, migrationAmbiguity]);

  const resolveCashAmbiguity = useCallback(async () => {
    if (!ownerAddress || !submissionAmbiguity || ambiguityQuarantineReason) return;
    setAmbiguityChecking(true);
    setTransactionError("");
    try {
      const result = await withOwnerWalletLock(ownerAddress, async () => {
        const loaded = loadCashAmbiguity(window.localStorage, ownerAddress);
        if (loaded.status !== "valid") return { kind: "changed" as const };
        if (JSON.stringify(loaded.record) !== JSON.stringify(submissionAmbiguity)) {
          return { kind: "changed" as const };
        }
        const recovery = await requestAmbiguityRecovery(loaded.record);
        if (recovery.status === "submitted") {
          if (loaded.record.identity.operation === "swap") {
            const pending = pendingSwapFromAmbiguity(recovery.hash, loaded.record);
            if (!persistPendingSwap(pending)) return { kind: "storage" as const };
            return { kind: "submitted-swap" as const, pending };
          }
          const pending = pendingMigrationFromAmbiguity(recovery.hash, loaded.record);
          if (!persistPendingMigration(pending)) return { kind: "storage" as const };
          return { kind: "submitted-migration" as const, pending };
        }
        if (recovery.status === "safe-to-retry") {
          if (!clearCashAmbiguity(window.localStorage, loaded.record)) {
            return { kind: "changed" as const };
          }
          return { kind: "safe" as const };
        }
        return { kind: "blocked" as const, retryAfterMs: recovery.retryAfterMs };
      });
      if (activeOwnerRef.current !== ownerAddress) return;
      if (result === null) {
        setTransactionError("Another CASH wallet request is still open in a different tab.");
      } else if (result.kind === "submitted-swap") {
        setSubmissionAmbiguity(null);
        setSubmissionOutcomeUnknown(false);
        setAmbiguityQuarantineReason("");
        adoptPersistedSwap(result.pending);
        void confirmSubmittedSwap(
          result.pending.hash,
          result.pending.receipt,
          result.pending.owner,
          result.pending.contractAddress,
          result.pending.ambiguity,
        );
      } else if (result.kind === "submitted-migration") {
        setSubmissionAmbiguity(null);
        setMigrationOutcomeUnknown(false);
        setAmbiguityQuarantineReason("");
        adoptPersistedMigration(result.pending);
        void confirmSubmittedMigration(
          result.pending.hash,
          result.pending.owner,
          result.pending.ambiguity,
        );
      } else if (result.kind === "safe") {
        setSubmissionAmbiguity(null);
        setSubmissionOutcomeUnknown(false);
        setMigrationOutcomeUnknown(false);
        setAmbiguityQuarantineReason("");
        setTransactionError(
          "Aptos proved that the earlier wallet request can no longer execute. Review fresh values before continuing.",
        );
        setFlowScreen("form");
        setReviewSnapshot(null);
        void Promise.all([fetchDepth(undefined, true), fetchBalances()]);
      } else if (result.kind === "blocked") {
        const minutes = result.retryAfterMs
          ? Math.max(1, Math.ceil(result.retryAfterMs / 60_000))
          : null;
        setTransactionError(
          minutes
            ? `No matching Aptos transaction was found. This wallet stays locked for about ${minutes} more minute${minutes === 1 ? "" : "s"}.`
            : "Aptos could not prove that the earlier wallet request is finished. Retrying stays blocked.",
        );
      } else if (result.kind === "storage") {
        setTransactionError("The recovered transaction could not be stored safely. Retrying stays blocked.");
      } else {
        const latest = loadCashAmbiguity(window.localStorage, ownerAddress);
        setSubmissionAmbiguity(latest.status === "valid" ? latest.record : null);
        setAmbiguityQuarantineReason(
          latest.status === "quarantined"
            ? latest.reason
            : "A CASH wallet safety record changed in another tab.",
        );
        setSubmissionOutcomeUnknown(true);
        setMigrationOutcomeUnknown(false);
      }
    } catch {
      setTransactionError("Aptos wallet activity could not be verified. Retrying stays blocked.");
    } finally {
      if (activeOwnerRef.current === ownerAddress) setAmbiguityChecking(false);
    }
  }, [
    adoptPersistedMigration,
    adoptPersistedSwap,
    ambiguityQuarantineReason,
    confirmSubmittedMigration,
    confirmSubmittedSwap,
    fetchBalances,
    fetchDepth,
    ownerAddress,
    submissionAmbiguity,
  ]);

  const migrateLegacyCash = useCallback(async () => {
    if (migrationOutcomeUnknown) {
      await resolveCashAmbiguity();
      return;
    }
    setTransactionError("");
    setFailedHash("");
    setMigrationSuccessHash("");
    setMigrationVerificationIssue("");
    if (!connected || !account) {
      setWalletOpen(true);
      return;
    }
    if (wrongNetwork) {
      setTransactionError("Switch your Aptos wallet to mainnet before migrating CASH.");
      return;
    }
    if (migrationHash && migrationOwner) {
      if (migrationAmbiguity) {
        await confirmSubmittedMigration(migrationHash, migrationOwner, migrationAmbiguity);
      }
      return;
    }
    if ((walletBalances.legacyCash ?? 0) <= 0) return;
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      setTransactionError(
        "This browser cannot safely coordinate wallet requests across tabs. Use a current browser before migrating CASH.",
      );
      return;
    }

    const submittedOwner = ownerAddress;
    const submittedOwnerContext = submittedOwner.toLowerCase();
    setMigrationStage("wallet");
    try {
      const result = await withOwnerWalletLock<WalletLockResult>(submittedOwner, async () => {
        if (activeOwnerRef.current !== submittedOwnerContext) {
          return { kind: "retry", message: "Your connected wallet changed. Review the CASH migration again." };
        }
        if (hasDecibelSpotWalletOperationEvidence(window.localStorage, submittedOwner)) {
          return {
            kind: "retry",
            message: "Finish or recover the other pending swap for this wallet before migrating CASH.",
          };
        }
        const storedSwap = readPersistedPendingSwap(submittedOwner);
        if (storedSwap) return { kind: "swap-pending", pending: storedSwap };
        const storedMigration = readPersistedPendingMigration(submittedOwner);
        if (storedMigration) return { kind: "migration-pending", pending: storedMigration };
        const existingAmbiguity = loadCashAmbiguity(window.localStorage, submittedOwner);
        if (existingAmbiguity.status !== "none") {
          return { kind: "ambiguous", ambiguity: existingAmbiguity };
        }
        if (activeNetworkChainIdRef.current !== 1) {
          return { kind: "retry", message: "Your wallet network changed. Switch back to Aptos mainnet." };
        }
        const payload = buildCashMigrationPayload();
        const identity = makeCashMigrationAmbiguityIdentity(submittedOwner);
        let ambiguity: CashAmbiguityRecord;
        let submissionAttempted = false;
        try {
          ambiguity = await requestPreparedAmbiguity(submittedOwner, identity);
        } catch {
          return {
            kind: "retry",
            message: "The wallet sequence and migration details could not be verified. Try again after Aptos recovers.",
          };
        }
        if (!persistCashAmbiguity(window.localStorage, ambiguity)) {
          return { kind: "storage-unavailable" };
        }
        if (
          activeOwnerRef.current !== submittedOwnerContext
          || activeNetworkChainIdRef.current !== 1
        ) {
          if (!clearCashAmbiguity(window.localStorage, ambiguity)) {
            return { kind: "ambiguous", ambiguity: loadCashAmbiguity(window.localStorage, submittedOwner) };
          }
          return { kind: "retry", message: "Your wallet changed. Review the CASH migration again." };
        }

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
          const rawTransaction = validateSignedCashRawTransaction(
            RawTransaction.deserialize(deserializer),
            ambiguity,
          );
          deserializer.assertFinished();
          const transaction = new SimpleTransaction(rawTransaction);
          const submission = { transaction, senderAuthenticator: signed.authenticator };
          const expectedHash = generateUserTransactionHash(submission);
          if (
            activeOwnerRef.current !== submittedOwnerContext
            || activeNetworkChainIdRef.current !== 1
          ) return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          submissionAttempted = true;
          const response = await submitTransaction(submission);
          const hash = (response as { hash?: unknown }).hash;
          if (!isAptosTransactionHash(hash) || hash.toLowerCase() !== expectedHash.toLowerCase()) {
            return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          }
          const pending = pendingMigrationFromAmbiguity(hash, ambiguity);
          if (!persistPendingMigration(pending)) {
            return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          }
          return { kind: "submitted-migration", pending };
        } catch (cause) {
          if (!submissionAttempted && wasRejectedByWallet(cause)) {
            if (!clearCashAmbiguity(window.localStorage, ambiguity)) {
              return { kind: "ambiguous", ambiguity: loadCashAmbiguity(window.localStorage, submittedOwner) };
            }
            throw cause;
          }
          const preserved = persistCashAmbiguity(window.localStorage, ambiguity);
          const loaded = loadCashAmbiguity(window.localStorage, submittedOwner);
          return {
            kind: "ambiguous",
            ambiguity: preserved && loaded.status === "valid"
              ? loaded
              : {
                  status: "quarantined",
                  reason: "The CASH migration safety record could not be reverified after the wallet response.",
                },
          };
        }
      });

      const ownerStillActive = activeOwnerRef.current === submittedOwnerContext;
      if (!result) {
        if (ownerStillActive) {
          setTransactionError("Another CASH wallet request is open. Finish it before trying again.");
        }
        return;
      }
      if (result.kind === "swap-pending") {
        if (ownerStillActive) adoptPersistedSwap(result.pending);
        await confirmSubmittedSwap(
          result.pending.hash,
          result.pending.receipt,
          result.pending.owner,
          result.pending.contractAddress,
          result.pending.ambiguity,
        );
        return;
      }
      if (result.kind === "migration-pending") {
        if (ownerStillActive) adoptPersistedMigration(result.pending);
        await confirmSubmittedMigration(
          result.pending.hash,
          result.pending.owner,
          result.pending.ambiguity,
        );
        return;
      }
      if (result.kind === "ambiguous") {
        if (!ownerStillActive) return;
        if (result.ambiguity.status === "valid") {
          setSubmissionAmbiguity(result.ambiguity.record);
          setAmbiguityQuarantineReason("");
          setSubmissionOutcomeUnknown(result.ambiguity.record.identity.operation === "swap");
          setMigrationOutcomeUnknown(result.ambiguity.record.identity.operation === "migration");
        } else {
          setSubmissionAmbiguity(null);
          setAmbiguityQuarantineReason(
            result.ambiguity.status === "quarantined"
              ? result.ambiguity.reason
              : "A CASH wallet safety record changed while it was checked.",
          );
          setSubmissionOutcomeUnknown(true);
          setMigrationOutcomeUnknown(false);
        }
        setTransactionError(
          "A previous CASH wallet request has an unresolved outcome. Check its Aptos status before continuing.",
        );
        return;
      }
      if (result.kind === "storage-unavailable") {
        if (!ownerStillActive) return;
        setTransactionError(
          "Safe wallet request storage is unavailable. Enable site storage before migrating CASH.",
        );
        return;
      }
      if (result.kind === "retry") {
        if (ownerStillActive) setTransactionError(result.message);
        return;
      }

      if (result.kind !== "submitted-migration") return;
      if (ownerStillActive) adoptPersistedMigration(result.pending);
      await confirmSubmittedMigration(
        result.pending.hash,
        result.pending.owner,
        result.pending.ambiguity,
      );
    } catch (cause) {
      if (activeOwnerRef.current === submittedOwnerContext) {
        const loaded = loadCashAmbiguity(window.localStorage, submittedOwner);
        setSubmissionAmbiguity(loaded.status === "valid" ? loaded.record : null);
        setAmbiguityQuarantineReason(loaded.status === "quarantined" ? loaded.reason : "");
        setMigrationOutcomeUnknown(!wasRejectedByWallet(cause) && loaded.status !== "none");
        setTransactionError(friendlyMigrationError(cause));
      }
    } finally {
      if (activeOwnerRef.current === submittedOwnerContext) setMigrationStage("idle");
    }
  }, [
    account,
    adoptPersistedMigration,
    adoptPersistedSwap,
    confirmSubmittedSwap,
    confirmSubmittedMigration,
    connected,
    fetchBalances,
    migrationAmbiguity,
    migrationHash,
    migrationOutcomeUnknown,
    migrationOwner,
    ownerAddress,
    resolveCashAmbiguity,
    signTransaction,
    submitTransaction,
    walletBalances.legacyCash,
    wrongNetwork,
  ]);

  const submit = useCallback(async (acceptedQuoteSignature: string) => {
    setTransactionError("");
    setSuccessHash("");
    setFailedHash("");
    setVerificationIssue("");
    setReceipt(null);
    if (!connected || !account) {
      setWalletOpen(true);
      return;
    }
    if (wrongNetwork) {
      setTransactionError("Switch your Aptos wallet to mainnet before swapping.");
      return;
    }
    if (
      !activeQuote
      || acceptedQuoteSignature !== quoteSignature
      || !sufficientLiquidity
      || !bookReady
      || quoteStale
      || quoteNeedsReview
      || ((
        activeQuote.priceImpactPct > HIGH_PRICE_IMPACT_PCT
        || !activeQuote.referencePriceAvailable
      ) && !highImpactAcknowledged)
    ) return;
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      setTransactionError(
        "This browser cannot safely coordinate wallet requests across tabs. Use a current browser before swapping.",
      );
      setFlowScreen("form");
      setReviewSnapshot(null);
      return;
    }

    const payload = buyQuote
      ? buildCashBuyPayload({
          contractAddress: book.contractAddress,
          quote: buyQuote,
        })
      : buildCashSellPayload({ contractAddress: book.contractAddress, quote: sellQuote! });
    const submittedOwner = ownerAddress;
    const submittedOwnerContext = submittedOwner.toLowerCase();
    const submittedContractAddress = book.contractAddress;

    setSubmitStage("wallet");
    try {
      const result = await withOwnerWalletLock<WalletLockResult>(submittedOwner, async () => {
        if (activeOwnerRef.current !== submittedOwnerContext) {
          return { kind: "retry", message: "Your connected wallet changed. Review the latest amount before swapping." };
        }
        if (hasDecibelSpotWalletOperationEvidence(window.localStorage, submittedOwner)) {
          return {
            kind: "retry",
            message: "Finish or recover the other pending swap for this wallet before starting a CASH swap.",
          };
        }
        const storedSwap = readPersistedPendingSwap(submittedOwner);
        if (storedSwap) return { kind: "swap-pending", pending: storedSwap };
        const storedMigration = readPersistedPendingMigration(submittedOwner);
        if (storedMigration) return { kind: "migration-pending", pending: storedMigration };
        const existingAmbiguity = loadCashAmbiguity(window.localStorage, submittedOwner);
        if (existingAmbiguity.status !== "none") {
          return { kind: "ambiguous", ambiguity: existingAmbiguity };
        }

        const guard = submissionGuardRef.current;
        if (
          activeOwnerRef.current !== submittedOwnerContext
          || guard.owner !== submittedOwnerContext
          || guard.quoteSignature !== acceptedQuoteSignature
          || guard.contractAddress.toLowerCase() !== submittedContractAddress.toLowerCase()
          || !guard.executable
          || !guard.bookUpdatedAt
          || Date.now() - guard.bookUpdatedAt > QUOTE_STALE_AFTER_MS
          || activeNetworkChainIdRef.current !== 1
        ) {
          return { kind: "retry", message: "The quote changed while waiting. Review the latest amount before swapping." };
        }
        const identity = makeCashSwapAmbiguityIdentity({
          ownerAddress: submittedOwner,
          direction: buyQuote ? "buy" : "sell",
          contractAddress: submittedContractAddress,
          cashAmountAtomic: buyQuote?.cashAmountAtomic ?? sellQuote!.cashAmountAtomic,
          expectedQuoteAmountAtomic: buyQuote?.usdcSpentAtomic ?? sellQuote!.usdcAmountAtomic,
          maximumQuoteAmountAtomic: buyQuote?.maxUsdcAmountAtomic ?? null,
          minimumOutputAmountAtomic: buyQuote?.minCashAmountAtomic ?? sellQuote!.minUsdcAmountAtomic,
        });
        let ambiguity: CashAmbiguityRecord;
        let submissionAttempted = false;
        try {
          ambiguity = await requestPreparedAmbiguity(submittedOwner, identity);
        } catch {
          return {
            kind: "retry",
            message: "The wallet sequence and protected swap values could not be verified. Try again after Aptos recovers.",
          };
        }
        if (!persistCashAmbiguity(window.localStorage, ambiguity)) {
          return { kind: "storage-unavailable" };
        }
        if (
          activeOwnerRef.current !== submittedOwnerContext
          || activeNetworkChainIdRef.current !== 1
        ) {
          if (!clearCashAmbiguity(window.localStorage, ambiguity)) {
            return { kind: "ambiguous", ambiguity: loadCashAmbiguity(window.localStorage, submittedOwner) };
          }
          return { kind: "retry", message: "Your wallet changed. Review the latest swap amount again." };
        }

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
          const rawTransaction = validateSignedCashRawTransaction(
            RawTransaction.deserialize(deserializer),
            ambiguity,
          );
          deserializer.assertFinished();
          const transaction = new SimpleTransaction(rawTransaction);
          const submission = { transaction, senderAuthenticator: signed.authenticator };
          const expectedHash = generateUserTransactionHash(submission);
          if (
            activeOwnerRef.current !== submittedOwnerContext
            || activeNetworkChainIdRef.current !== 1
          ) return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          submissionAttempted = true;
          const response = await submitTransaction(submission);
          const hash = (response as { hash?: unknown }).hash;
          if (!isAptosTransactionHash(hash) || hash.toLowerCase() !== expectedHash.toLowerCase()) {
            return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          }
          const pending = pendingSwapFromAmbiguity(hash, ambiguity);
          if (!persistPendingSwap(pending)) {
            return { kind: "ambiguous", ambiguity: { status: "valid", record: ambiguity } };
          }
          return { kind: "submitted-swap", pending };
        } catch (cause) {
          if (!submissionAttempted && wasRejectedByWallet(cause)) {
            if (!clearCashAmbiguity(window.localStorage, ambiguity)) {
              return { kind: "ambiguous", ambiguity: loadCashAmbiguity(window.localStorage, submittedOwner) };
            }
            throw cause;
          }
          const preserved = persistCashAmbiguity(window.localStorage, ambiguity);
          const loaded = loadCashAmbiguity(window.localStorage, submittedOwner);
          return {
            kind: "ambiguous",
            ambiguity: preserved && loaded.status === "valid"
              ? loaded
              : {
                  status: "quarantined",
                  reason: "The CASH swap safety record could not be reverified after the wallet response.",
                },
          };
        }
      });

      const ownerStillActive = activeOwnerRef.current === submittedOwnerContext;
      if (!result) {
        if (ownerStillActive) {
          setTransactionError("Another CASH wallet request is open. Finish it before trying again.");
          setFlowScreen("form");
          setReviewSnapshot(null);
        }
        return;
      }
      if (result.kind === "swap-pending") {
        if (ownerStillActive) adoptPersistedSwap(result.pending);
        await confirmSubmittedSwap(
          result.pending.hash,
          result.pending.receipt,
          result.pending.owner,
          result.pending.contractAddress,
          result.pending.ambiguity,
        );
        return;
      }
      if (result.kind === "migration-pending") {
        if (ownerStillActive) adoptPersistedMigration(result.pending);
        await confirmSubmittedMigration(
          result.pending.hash,
          result.pending.owner,
          result.pending.ambiguity,
        );
        return;
      }
      if (result.kind === "ambiguous") {
        if (!ownerStillActive) return;
        if (result.ambiguity.status === "valid") {
          setSubmissionAmbiguity(result.ambiguity.record);
          setAmbiguityQuarantineReason("");
          setSubmissionOutcomeUnknown(result.ambiguity.record.identity.operation === "swap");
          setMigrationOutcomeUnknown(result.ambiguity.record.identity.operation === "migration");
        } else {
          setSubmissionAmbiguity(null);
          setAmbiguityQuarantineReason(
            result.ambiguity.status === "quarantined"
              ? result.ambiguity.reason
              : "A CASH wallet safety record changed while it was checked.",
          );
          setSubmissionOutcomeUnknown(true);
          setMigrationOutcomeUnknown(false);
        }
        setTransactionError(
          "A previous CASH wallet request has an unresolved outcome. Check its Aptos status before continuing.",
        );
        setFlowScreen("form");
        setReviewSnapshot(null);
        return;
      }
      if (result.kind === "storage-unavailable") {
        if (!ownerStillActive) return;
        setTransactionError("Safe wallet request storage is unavailable. Enable site storage before swapping.");
        setFlowScreen("form");
        setReviewSnapshot(null);
        return;
      }
      if (result.kind === "retry") {
        if (ownerStillActive) {
          setTransactionError(result.message);
          setFlowScreen("form");
          setReviewSnapshot(null);
        }
        return;
      }

      if (result.kind !== "submitted-swap") return;
      if (ownerStillActive) adoptPersistedSwap(result.pending);
      await confirmSubmittedSwap(
        result.pending.hash,
        result.pending.receipt,
        result.pending.owner,
        result.pending.contractAddress,
        result.pending.ambiguity,
      );
    } catch (cause) {
      if (activeOwnerRef.current === submittedOwnerContext) {
        const loaded = loadCashAmbiguity(window.localStorage, submittedOwner);
        setSubmissionAmbiguity(loaded.status === "valid" ? loaded.record : null);
        setAmbiguityQuarantineReason(loaded.status === "quarantined" ? loaded.reason : "");
        setSubmissionOutcomeUnknown(!wasRejectedByWallet(cause) && loaded.status !== "none");
        setTransactionError(friendlyTransactionError(cause));
        setFlowScreen("form");
        setReviewSnapshot(null);
      }
    } finally {
      if (activeOwnerRef.current === submittedOwnerContext) setSubmitStage("idle");
    }
  }, [
    account,
    activeQuote,
    adoptPersistedMigration,
    adoptPersistedSwap,
    amount,
    book.contractAddress,
    bookReady,
    buyQuote,
    connected,
    confirmSubmittedMigration,
    confirmSubmittedSwap,
    highImpactAcknowledged,
    ownerAddress,
    quoteNeedsReview,
    quoteSignature,
    quoteStale,
    sellQuote,
    signTransaction,
    submitTransaction,
    sufficientLiquidity,
    wrongNetwork,
  ]);

  const highPriceImpact = (activeQuote?.priceImpactPct ?? 0) > HIGH_PRICE_IMPACT_PCT;
  const missingPriceReference = Boolean(activeQuote && !activeQuote.referencePriceAvailable);
  const reviewPriceChanged = Boolean(
    reviewSnapshot
    && (reviewSnapshot.signature !== quoteSignature || reviewSnapshot.inputKey !== quoteInputKey),
  );
  const transactionScreenVisible = submitStage !== "idle"
    || Boolean(pendingHash)
    || Boolean(successHash && receipt);

  useEffect(() => {
    const screenKey = transactionScreenVisible
      ? successHash && receipt ? "success" : "pending"
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
  }, [flowScreen, receipt, successHash, transactionScreenVisible]);

  const openReview = useCallback(() => {
    if (!activeQuote || !quoteSignature) return;
    setReviewSnapshot({
      inputKey: quoteInputKey,
      receiveAmount: outputAmount,
      signature: quoteSignature,
    });
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("review");
  }, [activeQuote, outputAmount, quoteInputKey, quoteSignature]);

  const acceptReviewQuote = useCallback(() => {
    if (!activeQuote || !quoteSignature) return;
    setReviewSnapshot({
      inputKey: quoteInputKey,
      receiveAmount: outputAmount,
      signature: quoteSignature,
    });
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
  }, [activeQuote, outputAmount, quoteInputKey, quoteSignature]);

  const closeReview = useCallback(() => {
    setFlowScreen("form");
    setReviewSnapshot(null);
    setHighImpactAcknowledged(false);
  }, []);

  const startAnotherSwap = useCallback(() => {
    setAmount("");
    setSuccessHash("");
    setFailedHash("");
    setReceipt(null);
    setTransactionError("");
    setVerificationIssue("");
    setSubmissionOutcomeUnknown(false);
    setQuoteNeedsReview(false);
    setHighImpactAcknowledged(false);
    setFlowScreen("form");
    setReviewSnapshot(null);
    quoteSnapshotRef.current = null;
  }, []);

  const cta = (() => {
    if (migrationStage === "wallet") {
      return { label: "Confirm CASH migration", disabled: true, action: "none" as const };
    }
    if (migrationStage === "chain" || migrationHash) {
      return { label: "CASH migration pending", disabled: true, action: "none" as const };
    }
    if (submitStage === "wallet") return { label: "Confirm in wallet", disabled: true, action: "none" as const };
    if (submitStage === "chain") return { label: "Confirming on Aptos", disabled: true, action: "none" as const };
    if (pendingHash) return { label: "Check pending swap", disabled: false, action: "check" as const };
    if (ambiguityQuarantineReason) {
      return { label: "Wallet safety review required", disabled: true, action: "none" as const };
    }
    if (migrationOutcomeUnknown) {
      return {
        label: ambiguityChecking ? "Checking Aptos" : "Check migration status",
        disabled: ambiguityChecking,
        action: "recover" as const,
      };
    }
    if (submissionOutcomeUnknown) {
      return {
        label: ambiguityChecking ? "Checking Aptos" : "Check swap status",
        disabled: ambiguityChecking,
        action: "recover" as const,
      };
    }
    if (effectiveLoading) return { label: "Loading orderbook", disabled: true, action: "none" as const };
    if (!bookReady) return { label: "Orderbook not live yet", disabled: true, action: "none" as const };
    if (!hasLiquidity) {
      return {
        label: direction === "buy" ? "No CASH available to buy" : "No CASH buy orders yet",
        disabled: true,
        action: "none" as const,
      };
    }
    if (quoteStale) return { label: "Refresh quote", disabled: false, action: "refresh" as const };
    if (wrongNetwork) return { label: "Switch to Aptos mainnet", disabled: true, action: "none" as const };
    if (!effectiveConnected) return { label: "Connect wallet", disabled: false, action: "connect" as const };
    if (needsGas) return { label: "APT required for gas", disabled: true, action: "none" as const };
    if (!amount || !Number.isFinite(inputAmount) || inputAmount <= 0) {
      return { label: "Enter an amount", disabled: true, action: "none" as const };
    }
    if (belowMinimum) return { label: "Amount below 10,000 CASH minimum", disabled: true, action: "none" as const };
    if (insufficientBalance) return { label: `Insufficient ${fromSymbol} balance`, disabled: true, action: "none" as const };
    if (executionLimitReached) {
      return { label: "Use a smaller swap", disabled: true, action: "none" as const };
    }
    if (minimumBuyUnavailable) return { label: "Less than 10,000 CASH available", disabled: true, action: "none" as const };
    if (!activeQuote) return { label: "Fetching quote", disabled: true, action: "none" as const };
    if (!sufficientLiquidity) return { label: "Insufficient orderbook liquidity", disabled: true, action: "none" as const };
    if (quoteNeedsReview) return { label: "Review new amount", disabled: false, action: "review" as const };
    if (missingPriceReference && !highImpactAcknowledged) {
      return {
        label: "Review one-sided market",
        disabled: false,
        action: "impact" as const,
      };
    }
    if (highPriceImpact && !highImpactAcknowledged) {
      return {
        label: `Review ${activeQuote!.priceImpactPct.toFixed(2)}% price impact`,
        disabled: false,
        action: "impact" as const,
      };
    }
    return { label: "Review swap", disabled: false, action: "swap" as const };
  })();

  const handlePrimaryAction = useCallback(async () => {
    if (cta.disabled) return;
    if (cta.action === "refresh") {
      void fetchDepth(undefined, true);
      return;
    }
    if (cta.action === "connect") {
      setWalletOpen(true);
      return;
    }
    if (cta.action === "recover") {
      await resolveCashAmbiguity();
      return;
    }
    if (
      cta.action === "check"
      && pendingHash
      && pendingOwner
      && pendingContractAddress
      && pendingReceipt
      && pendingAmbiguity
    ) {
      void confirmSubmittedSwap(
        pendingHash,
        pendingReceipt,
        pendingOwner,
        pendingContractAddress,
        pendingAmbiguity,
      );
      return;
    }
    if (cta.action === "review") {
      openReview();
      return;
    }
    if (cta.action === "impact") {
      setDetailsOpen(true);
      openReview();
      return;
    }
    if (cta.action === "swap") openReview();
  }, [
    confirmSubmittedSwap,
    cta.action,
    cta.disabled,
    fetchDepth,
    openReview,
    pendingHash,
    pendingAmbiguity,
    pendingContractAddress,
    pendingOwner,
    pendingReceipt,
    resolveCashAmbiguity,
  ]);

  const effectivePrice = activeQuote?.effectivePrice ?? 0;
  const priceImpact = activeQuote?.priceImpactPct ?? 0;
  const spread = activeQuote?.spreadPct ?? 0;
  const minimumReceived = buyQuote?.minCashAmount ?? sellQuote?.minUsdcAmount ?? 0;
  const quoteSummary = effectivePrice > 0
    ? `1 CASH = ${formatPrice(effectivePrice)} USDC`
    : "Enter an amount to see price details";
  const outputDisplay = outputAmount > 0
    ? formatAmount(outputAmount, toSymbol === "CASH" ? 0 : 6)
    : "0";
  const fromUsdEquivalent = direction === "buy" && inputAmount > 0
    ? buyQuote?.maxUsdcAmount ?? inputAmount
    : sellQuote?.usdcAmount ?? 0;
  const toUsdEquivalent = direction === "sell"
    ? outputAmount
    : buyQuote ? buyQuote.cashAmount * buyQuote.effectivePrice : 0;
  const bookNotConfigured = /not configured|deployment/i.test(book.message ?? "");
  const interactionLocked = submitStage !== "idle"
    || migrationStage !== "idle"
    || Boolean(pendingHash)
    || Boolean(migrationHash)
    || submissionOutcomeUnknown
    || migrationOutcomeUnknown;
  const legacyCashNeedsMigration = direction === "sell"
    && (walletBalances.legacyCash ?? 0) > 0;
  const migrationButtonLabel = migrationOutcomeUnknown
    ? ambiguityChecking ? "Checking Aptos" : "Check migration status"
    : ambiguityQuarantineReason || submissionOutcomeUnknown
      ? "Wallet safety review required"
    : migrationStage === "wallet"
    ? "Confirm in wallet"
    : migrationStage === "chain"
      ? "Confirming on Aptos"
      : migrationHash
        ? "Check migration"
        : wrongNetwork
          ? "Switch to mainnet"
          : needsGas
            ? "APT required"
            : "Migrate CASH";
  const migrationButtonDisabled = migrationStage !== "idle"
    || ambiguityChecking
    || Boolean(ambiguityQuarantineReason)
    || submissionOutcomeUnknown
    || (!migrationOutcomeUnknown && !migrationHash && (wrongNetwork || needsGas));
  const buyCapAdjusted = Boolean(
    buyQuote
    && inputAmount - buyQuote.maxUsdcAmount >= 0.000001,
  );

  let notice: {
    tone: "info" | "warning" | "error";
    title: string;
    body?: string;
    transactionHash?: string;
  } | null = null;
  if (ambiguityQuarantineReason) {
    notice = {
      tone: "error",
      title: "Wallet safety record needs review",
      body: `${ambiguityQuarantineReason} New CASH transactions stay locked.`,
    };
  } else if (migrationOutcomeUnknown) {
    notice = {
      tone: "error",
      title: "CASH migration outcome is still unknown",
      body: "Check Aptos status. The app will recover the exact transaction or unlock only after chain evidence proves that it cannot execute.",
    };
  } else if (migrationHash && migrationVerificationIssue) {
    notice = {
      tone: "error",
      title: "CASH migration needs review",
      body: migrationVerificationIssue,
      transactionHash: migrationHash,
    };
  } else if (migrationHash && migrationDelayed) {
    notice = {
      tone: "warning",
      title: "CASH migration submitted. Confirmation is delayed.",
      body: "We’re still checking Aptos. Do not submit another migration until this one resolves.",
      transactionHash: migrationHash,
    };
  } else if (migrationSuccessHash) {
    notice = {
      tone: "info",
      title: "CASH is ready to trade",
      body: "Your legacy CASH moved into the fungible-asset balance used by the orderbook.",
      transactionHash: migrationSuccessHash,
    };
  } else if (pendingHash && confirmationDelayed) {
    notice = {
      tone: "warning",
      title: "Swap submitted. Confirmation is delayed.",
      body: "We’re still checking Aptos. Do not submit another swap until this one resolves.",
      transactionHash: pendingHash,
    };
  } else if (submissionOutcomeUnknown) {
    notice = {
      tone: "error",
      title: "Swap outcome is still unknown",
      body: "Check Aptos status. The app will recover the exact transaction or unlock only after chain evidence proves that it cannot execute.",
    };
  } else if (transactionError) {
    notice = { tone: "error", title: transactionError, transactionHash: failedHash || undefined };
  } else if (!effectiveLoading && !bookReady) {
    notice = bookNotConfigured
      ? {
          tone: "info",
          title: "CASH/USDC isn’t live yet",
          body: "Swapping unlocks after the reviewed orderbook deployment is connected.",
        }
      : {
          tone: "warning",
          title: "Live quotes are unavailable",
          body: "The orderbook could not be refreshed. Your wallet has not been touched.",
        };
  } else if (quoteNeedsReview) {
    notice = {
      tone: "warning",
      title: "Price moved. Review the new amount.",
      body: direction === "buy"
        ? "The rate or maximum USDC spend changed. Review the updated quote before continuing."
        : "The rate or minimum USDC received changed. Review the updated quote before continuing.",
    };
  } else if (executionLimitReached) {
    notice = {
      tone: "info",
      title: "This amount is too large for one safe swap",
      body: `Try a smaller amount. Each transaction is limited to the first ${activeExecution?.nodeBudget ?? 16} raw orders so fragmented liquidity cannot exhaust Aptos gas.`,
    };
  } else if (missingPriceReference && !highImpactAcknowledged) {
    notice = {
      tone: "warning",
      title: "No two-sided price reference",
      body: direction === "buy"
        ? "The book has no bids to establish a midpoint. Check the rate before continuing."
        : "The book has no asks to establish a midpoint. Check the rate before continuing.",
    };
  } else if (highPriceImpact && !highImpactAcknowledged) {
    notice = {
      tone: "warning",
      title: `${priceImpact.toFixed(2)}% price impact`,
      body: "This order crosses several price levels. Review the execution details before continuing.",
    };
  }

  const noticeStyles = notice?.tone === "error"
    ? "border-danger/25 bg-danger/[0.07] text-foreground"
    : notice?.tone === "warning"
      ? "border-warning/25 bg-warning/[0.07] text-foreground"
      : "border-card-border bg-card text-foreground-secondary";
  const noticeIconStyles = notice?.tone === "error"
    ? "text-danger"
    : notice?.tone === "warning"
      ? "text-warning"
      : "text-foreground-secondary";
  const inputId = isPreview ? `swap-pay-${previewState}` : "swap-pay";
  const inputIssueId = `${inputId}-issue`;
  const inputIssue = insufficientBalance
    ? `Insufficient ${fromSymbol} balance`
    : belowMinimum
      ? "Minimum order is 10,000 CASH"
      : executionLimitReached
        ? "Use a smaller amount for one safe swap"
      : "";
  const detailsPanelId = isPreview ? `swap-price-details-${previewState}` : "swap-price-details";
  const SwapHeading = marketLayout ? "h2" : "h1";

  const swapForm = (
    <section
      aria-label="Swap CASH and USDC"
      className={cn(
        "w-full rounded-[var(--radius)] bg-background-secondary p-2",
        !marketLayout && "border border-card-border",
        previewState === "hover" && "border-border-strong",
        previewState === "focus-visible" && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        previewState === "active" && "scale-[0.995]",
        previewState === "disabled" && "opacity-55",
      )}
    >
      <div className="flex h-14 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <SwapHeading className="font-display text-base font-semibold text-foreground">Swap</SwapHeading>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "min-h-11 shrink-0 rounded-full border border-card-border bg-card px-2.5 text-[11px] font-medium text-foreground-secondary outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8",
                  PRESSABLE_CONTROL,
                )}
                aria-label={`${SLIPPAGE_LABEL} maximum price movement. Open details.`}
              >
                {SLIPPAGE_LABEL}
              </button>
            </PopoverTrigger>
            <PopoverContent aria-label="Maximum price movement" align="start" className="w-[260px] p-3">
              <p className="text-[13px] font-semibold text-foreground">Maximum price movement</p>
              <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">
                Your transaction will revert if execution moves more than 0.5% beyond the reviewed quote. This launch setting is fixed.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex shrink-0 items-center">
          <span className="sr-only" role="status" aria-live="polite">
            {effectiveLoading ? "Checking orderbook" : bookReady ? "Orderbook ready" : null}
          </span>
          {(!bookReady || quoteStale) && (
            <button
              type="button"
              onClick={() => void fetchDepth(undefined, true)}
              disabled={refreshing || effectiveLoading || interactionLocked || isPreview}
              className={cn(
                "grid size-11 place-items-center rounded-[var(--radius-sm)] text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                PRESSABLE_CONTROL,
              )}
              aria-label="Refresh CASH orderbook quote"
              title="Refresh quote"
            >
              <RotateCcw
                aria-hidden="true"
                strokeWidth={3}
                className={cn("size-5", (refreshing || effectiveLoading) && "animate-spin motion-reduce:animate-none")}
              />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
      {transactionScreenVisible ? (
        <SwapFlowScreen key="transaction" ref={transactionScreenRef} reducedMotion={Boolean(reduceMotion)}>
          <CashSwapTransactionState
            confirmationDelayed={confirmationDelayed}
            onCheck={() => {
              if (
                pendingHash
                && pendingOwner
                && pendingContractAddress
                && pendingReceipt
                && pendingAmbiguity
              ) {
                void confirmSubmittedSwap(
                  pendingHash,
                  pendingReceipt,
                  pendingOwner,
                  pendingContractAddress,
                  pendingAmbiguity,
                );
              }
            }}
            onNewSwap={startAnotherSwap}
            pendingHash={pendingHash}
            receipt={receipt}
            stage={submitStage}
            successHash={successHash}
            verificationIssue={verificationIssue}
          />
        </SwapFlowScreen>
      ) : flowScreen === "review" && activeQuote && reviewSnapshot ? (
        <SwapFlowScreen key="review" ref={reviewScreenRef} reducedMotion={Boolean(reduceMotion)}>
          <CashSwapReview
            busy={submitStage !== "idle"}
            confirmDisabled={reviewPriceChanged || quoteStale || quoteNeedsReview || !bookReady || !sufficientLiquidity}
            effectivePrice={effectivePrice}
            fromSymbol={fromSymbol}
            highRiskAcknowledged={highImpactAcknowledged}
            maximumSpend={buyQuote?.maxUsdcAmount}
            minimumReceived={minimumReceived}
            oneSided={missingPriceReference}
            onAcceptQuote={acceptReviewQuote}
            onBack={closeReview}
            onConfirm={() => void submit(reviewSnapshot.signature)}
            onHighRiskAcknowledgedChange={setHighImpactAcknowledged}
            payAmount={buyQuote?.usdcSpent ?? sellQuote?.cashAmount ?? 0}
            previousReceiveAmount={reviewSnapshot.receiveAmount}
            priceChanged={reviewPriceChanged}
            priceImpact={priceImpact}
            receiveAmount={outputAmount}
            spread={spread}
            toSymbol={toSymbol}
          />
        </SwapFlowScreen>
      ) : (
        <SwapFlowScreen key="form" reducedMotion={Boolean(reduceMotion)}>

      <div
        className="flex min-h-[152px] flex-col rounded-[var(--radius)] border border-transparent bg-background-tertiary p-4 transition-colors duration-150 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-ring motion-reduce:transition-none"
        data-testid="swap-input-pay"
      >
        <div className="flex h-4 items-center justify-between gap-3 text-[13px] leading-4 text-muted-foreground">
          <label htmlFor={inputId}>You pay</label>
          {effectiveConnected && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {balanceLoading
                ? "Checking balance"
                : balanceError
                  ? balanceError
                  : fromBalance === null
                    ? "Balance —"
                    : (
                        <>
                          Balance <span className="font-mono tabular-nums text-foreground-secondary">{formatWalletBalance(fromBalance, fromSymbol)}</span>
                        </>
                      )}
            </span>
          )}
        </div>
        <div className="flex min-h-[68px] flex-1 items-center gap-3">
          <input
            ref={amountInputRef}
            id={inputId}
            value={amount}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "" || /^(?:\d+\.?\d{0,6}|\.\d{1,6})$/.test(next)) setAmount(next);
              setTransactionError("");
              setSuccessHash("");
              setFailedHash("");
              setReceipt(null);
              setQuoteNeedsReview(false);
              setHighImpactAcknowledged(false);
              setFlowScreen("form");
              setReviewSnapshot(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handlePrimaryAction();
              }
            }}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0"
            disabled={interactionLocked || previewState === "disabled"}
            aria-invalid={insufficientBalance || belowMinimum || executionLimitReached || undefined}
            aria-describedby={inputIssue ? inputIssueId : undefined}
            aria-errormessage={inputIssue ? inputIssueId : undefined}
            className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed disabled:opacity-55 min-[380px]:text-3xl"
          />
          {inputIssue && <span id={inputIssueId} className="sr-only">{inputIssue}</span>}
          <SwapAssetButton
            ref={payAssetButtonRef}
            symbol={fromSymbol}
            iconSrc={fromSymbol === "CASH" ? "/tokens/cash.png" : "/tokens/usdc.png"}
            onSelect={onPayAssetSelect ? () => onPayAssetSelect(fromSymbol) : undefined}
            disabled={assetSelectionDisabled || interactionLocked || previewState === "disabled"}
            ariaLabel={`Choose pay asset, currently ${fromSymbol}`}
            expanded={assetSelectorSide === "pay"}
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-2 text-[11px] leading-4 sm:min-h-8">
          <span className={cn(
            "min-w-0 truncate text-muted-foreground",
            effectiveConnected && fromBalance !== null && fromBalance > 0 && "hidden",
          )}>
            {direction === "sell" && fromUsdEquivalent > 0
              ? `≈ $${formatAmount(fromUsdEquivalent, 2)}`
              : alignmentAdjusted
                ? `Uses ${formatAmount(sellQuote!.cashAmount, 0)} CASH`
                : buyCapAdjusted
                  ? `Spend up to ${formatAmount(buyQuote!.maxUsdcAmount, 6)} USDC`
                  : ""}
          </span>
          {effectiveConnected && fromBalance !== null && fromBalance > 0 && (
            <div role="group" className="ml-auto grid w-full max-w-[212px] min-w-0 flex-1 grid-cols-4 gap-0.5" aria-label={`Use a percentage of your ${fromSymbol} balance`}>
              {[25, 50, 75].map((percent) => (
                <button
                  key={percent}
                  type="button"
                  onClick={() => setBalanceFraction(percent / 100)}
                  disabled={interactionLocked || balanceLoading}
                  className={cn(
                    "min-h-11 rounded-[var(--radius-sm)] px-2 text-[11px] font-semibold text-foreground-secondary outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 sm:min-h-8",
                    PRESSABLE_CONTROL,
                  )}
                  aria-label={`Use ${percent}% of ${fromSymbol} balance`}
                >
                  {percent}%
                </button>
              ))}
              <button
                type="button"
                onClick={setMaximum}
                disabled={interactionLocked || balanceLoading}
                className={cn(
                  "min-h-11 rounded-[var(--radius-sm)] px-2 text-[11px] font-semibold text-accent outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45 sm:min-h-8",
                  PRESSABLE_CONTROL,
                )}
                aria-label={`Use maximum ${fromSymbol} balance`}
              >
                Max
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 -my-[18px] flex justify-center">
        <button
          type="button"
          onClick={reverse}
          disabled={interactionLocked}
          className={cn(
            "grid size-11 place-items-center rounded-[var(--radius-sm)] border-4 border-background-secondary bg-background-elevated text-muted-foreground outline-none hover:bg-card-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            PRESSABLE_CONTROL,
          )}
          aria-label={`Switch to ${direction === "buy" ? "selling CASH" : "buying CASH"}`}
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

      <div
        className="flex min-h-[152px] flex-col rounded-[var(--radius)] border border-transparent bg-background-tertiary p-4"
        data-testid="swap-input-receive"
      >
        <div className="flex h-4 items-center justify-between gap-3 text-[13px] leading-4 text-muted-foreground">
          <span>You receive</span>
          {effectiveConnected && (
            <span className="truncate text-[11px]">
              {balanceLoading
                ? "Checking balance"
                : toBalance === null
                  ? "Balance —"
                  : (
                      <>
                        Balance <span className="font-mono tabular-nums text-foreground-secondary">{formatWalletBalance(toBalance, toSymbol)}</span>
                      </>
                    )}
            </span>
          )}
        </div>
        <div className="flex min-h-[68px] flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <SwapQuoteAmount
              announcement={activeQuote ? `Estimated receive ${outputDisplay} ${toSymbol}` : ""}
              display={outputDisplay}
              className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xl font-medium leading-none tracking-[-0.03em] tabular-nums text-foreground min-[380px]:text-3xl"
            />
          </div>
          <SwapAssetButton
            ref={receiveAssetButtonRef}
            symbol={toSymbol}
            iconSrc={toSymbol === "CASH" ? "/tokens/cash.png" : "/tokens/usdc.png"}
            onSelect={onReceiveAssetSelect ? () => onReceiveAssetSelect(toSymbol) : undefined}
            disabled={assetSelectionDisabled || interactionLocked || previewState === "disabled"}
            ariaLabel={`Choose receive asset, currently ${toSymbol}`}
            expanded={assetSelectorSide === "receive"}
          />
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 text-[11px] leading-4 text-muted-foreground sm:min-h-8">
          <span className="truncate">
            {toUsdEquivalent > 0 ? `≈ $${formatAmount(toUsdEquivalent, 2)}` : ""}
          </span>
          {belowMinimum && (
            <span className="shrink-0 text-warning">Minimum 10,000 CASH</span>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {legacyCashNeedsMigration && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, transform: "translate3d(0, 4px, 0)" }}
            animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
            exit={reduceMotion ? undefined : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] }}
            role="status"
            className="mx-1 mt-3 flex flex-col gap-3 rounded-[var(--radius-sm)] border border-card-border bg-card p-3 min-[420px]:flex-row min-[420px]:items-center"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <TokenIcon symbol="CASH" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-4 text-foreground">
                  {formatWalletBalance(walletBalances.legacyCash ?? 0, "CASH")} legacy CASH
                </p>
                <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">
                  Move it into your tradable CASH balance. This does not sell or transfer your tokens.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void migrateLegacyCash()}
              disabled={migrationButtonDisabled}
              aria-busy={migrationStage !== "idle"}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong bg-background-elevated px-3 text-[13px] font-semibold text-foreground outline-none hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55",
                PRESSABLE_CONTROL,
              )}
            >
              {migrationStage !== "idle" && (
                <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
              )}
              {migrationButtonLabel}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {notice && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, transform: "translate3d(0, 4px, 0)" }}
            animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
            exit={reduceMotion ? undefined : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] }}
            role={notice.tone === "error" ? "alert" : "status"}
            className={cn("mx-1 mt-3 flex gap-2.5 rounded-[var(--radius-sm)] border p-3", noticeStyles)}
          >
            {notice.tone === "error"
              ? <CircleAlert aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", noticeIconStyles)} />
              : <Info aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", noticeIconStyles)} />}
            <div className="min-w-0">
              <p className="text-pretty text-[13px] font-semibold leading-4">{notice.title}</p>
              {notice.body && (
                <p className="mt-1 text-pretty text-[11px] leading-4 text-foreground-secondary">{notice.body}</p>
              )}
              {notice.transactionHash && (
                <a
                  href={`https://explorer.aptoslabs.com/txn/${notice.transactionHash}?network=mainnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex min-h-6 items-center gap-1 text-[11px] font-semibold underline decoration-current/40 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View on Aptos
                  <ExternalLink aria-hidden="true" className="size-3" />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={handlePrimaryAction}
        disabled={cta.disabled || previewState === "disabled"}
        aria-busy={submitStage !== "idle" || effectiveLoading}
        className={cn(
          BUTTON_PRIMARY,
          "mt-3 w-full gap-2 disabled:bg-background-elevated disabled:text-muted-foreground disabled:opacity-100",
          previewState === "hover" && "brightness-95",
          previewState === "focus-visible" && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          previewState === "active" && "scale-[0.98]",
        )}
      >
        {(submitStage !== "idle" || effectiveLoading) && (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        )}
        {cta.label}
      </button>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className={cn(
          "mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-card-border bg-background px-3 text-left text-[13px] text-muted-foreground outline-none hover:border-border-strong hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-ring",
          PRESSABLE_CONTROL,
        )}
        aria-expanded={detailsOpen}
        aria-controls={detailsPanelId}
      >
        <span className="min-w-0 font-mono tabular-nums">{quoteSummary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {quoteAgeSeconds !== null && bookReady && quoteStale && (
            <span className="text-[11px] text-warning">Stale</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 transition-transform duration-150 motion-reduce:transition-none",
              detailsOpen && "rotate-180",
            )}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {detailsOpen && (
          <motion.div
            id={detailsPanelId}
            initial={reduceMotion ? false : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
            animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
            exit={reduceMotion ? undefined : { opacity: 0, transform: "translate3d(0, -4px, 0)" }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] }}
            className="mx-1 mb-1 mt-2 space-y-2 rounded-[var(--radius-sm)] border border-card-border bg-card p-3"
          >
            <DetailRow label="Route" value="Direct CASH orderbook" valueClassName="text-accent" />
            <DetailRow
              label="Price impact"
              value={activeQuote
                ? missingPriceReference ? "No midpoint" : `${priceImpact.toFixed(3)}%`
                : "—"}
              valueClassName={missingPriceReference || priceImpact > 1 ? "text-warning" : undefined}
            />
            <DetailRow
              label="Bid / ask spread"
              value={activeQuote
                ? missingPriceReference ? "One-sided book" : `${spread.toFixed(3)}%`
                : "—"}
              valueClassName={missingPriceReference || spread > 2 ? "text-warning" : undefined}
            />
            <DetailRow
              label="Minimum received"
              value={minimumReceived > 0
                ? `${formatAmount(minimumReceived, toSymbol === "CASH" ? 0 : 6)} ${toSymbol}`
                : "—"}
            />
            {buyQuote && (
              <DetailRow
                label="Maximum spend"
                value={`${formatAmount(buyQuote.maxUsdcAmount, 6)} USDC`}
              />
            )}
            <DetailRow
              label="Max price movement"
              value={`${(CASH_SWAP_SLIPPAGE_BPS / 100).toFixed(1)}%`}
            />
            <div className="border-t border-card-border pt-2 text-pretty text-[11px] leading-4 text-muted-foreground">
              Settles directly to your Aptos wallet. APT is required for network gas.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        </SwapFlowScreen>
      )}
      </AnimatePresence>

      <WalletSelector open={walletOpen} onClose={() => setWalletOpen(false)} preferredChain="Aptos" />
    </section>
  );

  if (!marketLayout) return swapForm;

  return (
    <SwapMarketLayout
      orderBookProps={{
        marketName: "CASH/USDC",
        currentPrice: orderbookCurrentPrice,
        controlledData: controlledOrderbookData,
      }}
    >
      {swapForm}
    </SwapMarketLayout>
  );
}
