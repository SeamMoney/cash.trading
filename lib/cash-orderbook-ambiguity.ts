import {
  EntryFunctionBytes,
  TransactionPayloadEntryFunction,
  parseTypeTag,
  type RawTransaction,
} from "@aptos-labs/ts-sdk";

import {
  CASH_DECIMALS,
  CASH_LEGACY_COIN_TYPE,
  CASH_LOT_SIZE,
  CASH_METADATA_ADDRESS,
  CASH_MIN_ORDER_SIZE,
  CASH_ORDERBOOK_PAIR_ID,
  USDC_METADATA_ADDRESS,
} from "./cash-orderbook";
import { isAptosTransactionHash } from "./cash-orderbook-confirmation";
import { normalizeAptosAddressText } from "./aptos-server-lite";

const U64_MAX = (1n << 64n) - 1n;
const UNSIGNED_INTEGER = /^(0|[1-9]\d*)$/;
const CASH_LOT_ATOMIC = BigInt(CASH_LOT_SIZE) * 10n ** BigInt(CASH_DECIMALS);
const CASH_MIN_ORDER_ATOMIC = BigInt(CASH_MIN_ORDER_SIZE) * 10n ** BigInt(CASH_DECIMALS);
const CASH_MAX_SLIPPAGE_BPS = 50n;
const BPS_DENOMINATOR = 10_000n;

function slippageCeil(value: bigint) {
  return (value * (BPS_DENOMINATOR + CASH_MAX_SLIPPAGE_BPS) + BPS_DENOMINATOR - 1n)
    / BPS_DENOMINATOR;
}

function slippageFloor(value: bigint) {
  return (value * (BPS_DENOMINATOR - CASH_MAX_SLIPPAGE_BPS)) / BPS_DENOMINATOR;
}

export const CASH_AMBIGUITY_MAINNET_CHAIN_ID = 1 as const;
export const CASH_AMBIGUITY_SCHEMA_VERSION = 2 as const;
export const CASH_AMBIGUITY_REQUESTED_EXPIRATION_SECONDS = 120 as const;
export const CASH_AMBIGUITY_EXPIRATION_GRACE_MS = 60 * 60 * 1_000;
export const CASH_AMBIGUITY_ACCOUNT_OBSERVATION_MAX_AGE_MS = 30_000;
export const CASH_AMBIGUITY_MAX_GAS_AMOUNT = 2_000_000n;
export const CASH_AMBIGUITY_MAX_GAS_UNIT_PRICE = 10_000n;
export const CASH_AMBIGUITY_MAX_GAS_COST_OCTAS = 50_000_000n;

export const CASH_AMBIGUITY_STORAGE_PREFIX = "cash:wallet-operation-unknown:v2";
export const CASH_AMBIGUITY_QUARANTINE_STORAGE_PREFIX = "cash:wallet-operation-quarantine:v1";
export const CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX = "cash:wallet-operation-unknown:v1";
export const CASH_LEGACY_PENDING_SWAP_STORAGE_PREFIX = "cash:pending-spot-swap:v1";
export const CASH_LEGACY_PENDING_MIGRATION_STORAGE_PREFIX = "cash:pending-legacy-migration:v1";

export type CashSwapAmbiguityIdentity = {
  operation: "swap";
  ownerAddress: string;
  direction: "buy" | "sell";
  contractAddress: string;
  entryFunction: string;
  pairId: typeof CASH_ORDERBOOK_PAIR_ID;
  quoteMetadataAddress: string;
  baseMetadataAddress: string;
  cashAmountAtomic: string;
  expectedQuoteAmountAtomic: string;
  maximumQuoteAmountAtomic: string | null;
  minimumOutputAmountAtomic: string;
};

export type CashMigrationAmbiguityIdentity = {
  operation: "migration";
  ownerAddress: string;
  entryFunction: string;
  legacyCoinType: string;
  migrationMode: "entire-legacy-balance";
};

export type CashAmbiguityIdentity =
  | CashSwapAmbiguityIdentity
  | CashMigrationAmbiguityIdentity;

export type CashAmbiguityRecord = {
  schemaVersion: typeof CASH_AMBIGUITY_SCHEMA_VERSION;
  chainId: typeof CASH_AMBIGUITY_MAINNET_CHAIN_ID;
  ownerAddress: string;
  identity: CashAmbiguityIdentity;
  preSignSequenceNumber: string;
  preSignLedgerVersion: string;
  preSignLedgerTimestampUsec: string;
  createdAt: number;
  requestedExpirationTimestampSecs: number;
  retrySafeAfterMs: number;
};

export type CashAccountObservation = {
  chainId: typeof CASH_AMBIGUITY_MAINNET_CHAIN_ID;
  sequenceNumber: string;
  ledgerVersion: string;
  ledgerTimestampUsec: string;
  ledgerTimestampMs: number;
};

export type CashAmbiguityRecovery =
  | { status: "submitted"; hash: string; sequenceNumber: string }
  | {
      status: "safe-to-retry";
      reason: "sequence-consumed" | "expiration-grace-elapsed";
      sequenceNumber: string;
    }
  | {
      status: "blocked";
      reason:
        | "sequence-unchanged"
        | "account-state-regressed"
        | "committed-transaction-proof-missing"
        | "upstream-transaction-mismatch";
      sequenceNumber: string;
      retryAfterMs?: number;
    };

export type CashAmbiguityStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CashStoredAmbiguity =
  | { status: "none" }
  | { status: "valid"; record: CashAmbiguityRecord }
  | { status: "quarantined"; reason: string };

export type CashAmbiguityPrepareResponse = {
  ready: true;
  action: "prepare";
  ambiguity: CashAmbiguityRecord;
};

export type CashAmbiguityResolveResponse = {
  ready: true;
  action: "resolve";
  recovery: CashAmbiguityRecovery;
  checkedAt: number;
};

export type CashAmbiguityErrorResponse = { ready: false; message: string };

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], fieldName: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${fieldName} fields did not match the reviewed schema`);
  }
}

function unsignedU64(value: unknown, fieldName: string, allowZero = true) {
  if (typeof value !== "string" || !UNSIGNED_INTEGER.test(value)) {
    throw new Error(`${fieldName} must be a canonical unsigned integer`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX || (!allowZero && parsed === 0n)) {
    throw new Error(`${fieldName} is outside its reviewed range`);
  }
  return parsed;
}

function safeTimestamp(value: unknown, fieldName: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return Number(value);
}

function normalizeEntryFunction(value: unknown, fieldName: string) {
  const [address, moduleName, functionName, ...extra] = String(value ?? "").split("::");
  if (extra.length > 0 || !moduleName || !functionName) {
    throw new Error(`${fieldName} was invalid`);
  }
  return `${normalizeAptosAddressText(address, fieldName)}::${moduleName}::${functionName}`;
}

function normalizeTypeTag(value: unknown, fieldName: string) {
  const [address, moduleName, structName, ...extra] = String(value ?? "").split("::");
  if (extra.length > 0 || !moduleName || !structName) {
    throw new Error(`${fieldName} was invalid`);
  }
  return `${normalizeAptosAddressText(address, fieldName)}::${moduleName}::${structName}`;
}

export function normalizeCashAmbiguityOwner(owner: string) {
  return normalizeAptosAddressText(owner, "wallet owner");
}

export function normalizeCashAmbiguityIdentity(value: unknown): CashAmbiguityIdentity {
  const raw = asRecord(value, "CASH transaction identity");
  if (raw.operation === "migration") {
    exactKeys(raw, [
      "operation",
      "ownerAddress",
      "entryFunction",
      "legacyCoinType",
      "migrationMode",
    ], "CASH migration identity");
    const ownerAddress = normalizeCashAmbiguityOwner(String(raw.ownerAddress ?? ""));
    const entryFunction = normalizeEntryFunction(raw.entryFunction, "migration entry function");
    if (entryFunction !== normalizeEntryFunction("0x1::coin::migrate_to_fungible_store", "migration entry function")) {
      throw new Error("migration entry function was not the reviewed Aptos function");
    }
    const legacyCoinType = normalizeTypeTag(raw.legacyCoinType, "legacy CASH type");
    if (legacyCoinType !== normalizeTypeTag(CASH_LEGACY_COIN_TYPE, "legacy CASH type")) {
      throw new Error("migration type was not legacy CASH");
    }
    if (raw.migrationMode !== "entire-legacy-balance") {
      throw new Error("migration economics were not recognized");
    }
    return {
      operation: "migration",
      ownerAddress,
      entryFunction,
      legacyCoinType,
      migrationMode: "entire-legacy-balance",
    };
  }

  if (raw.operation !== "swap") throw new Error("CASH transaction operation was invalid");
  exactKeys(raw, [
    "operation",
    "ownerAddress",
    "direction",
    "contractAddress",
    "entryFunction",
    "pairId",
    "quoteMetadataAddress",
    "baseMetadataAddress",
    "cashAmountAtomic",
    "expectedQuoteAmountAtomic",
    "maximumQuoteAmountAtomic",
    "minimumOutputAmountAtomic",
  ], "CASH swap identity");
  const ownerAddress = normalizeCashAmbiguityOwner(String(raw.ownerAddress ?? ""));
  const contractAddress = normalizeAptosAddressText(raw.contractAddress, "CASH contract address");
  if (raw.direction !== "buy" && raw.direction !== "sell") {
    throw new Error("CASH swap direction was invalid");
  }
  const direction = raw.direction;
  const entryFunction = normalizeEntryFunction(raw.entryFunction, "CASH swap entry function");
  const expectedEntry = `${contractAddress}::order_placement::${direction === "buy" ? "buy_from_wallet" : "sell_from_wallet"}`;
  if (entryFunction !== expectedEntry) throw new Error("CASH swap entry function was not reviewed");
  if (raw.pairId !== CASH_ORDERBOOK_PAIR_ID) throw new Error("CASH swap pair was invalid");
  const quoteMetadataAddress = normalizeAptosAddressText(raw.quoteMetadataAddress, "quote metadata");
  const baseMetadataAddress = normalizeAptosAddressText(raw.baseMetadataAddress, "base metadata");
  if (
    quoteMetadataAddress !== normalizeAptosAddressText(USDC_METADATA_ADDRESS)
    || baseMetadataAddress !== normalizeAptosAddressText(CASH_METADATA_ADDRESS)
  ) throw new Error("CASH swap assets were invalid");
  const cashAmount = unsignedU64(raw.cashAmountAtomic, "CASH amount", false);
  const expectedQuote = unsignedU64(raw.expectedQuoteAmountAtomic, "expected USDC amount", false);
  const minimumOutput = unsignedU64(raw.minimumOutputAmountAtomic, "minimum output", false);
  if (cashAmount < CASH_MIN_ORDER_ATOMIC || cashAmount % CASH_LOT_ATOMIC !== 0n) {
    throw new Error("CASH amount was not aligned to the reviewed lot and minimum");
  }
  let maximumQuoteAmountAtomic: string | null = null;
  if (direction === "buy") {
    const maximumQuote = unsignedU64(raw.maximumQuoteAmountAtomic, "maximum USDC amount", false);
    if (
      expectedQuote > maximumQuote
      || maximumQuote > slippageCeil(expectedQuote)
      || minimumOutput !== cashAmount
    ) {
      throw new Error("CASH buy economics exceeded the reviewed 0.5% limit");
    }
    maximumQuoteAmountAtomic = maximumQuote.toString();
  } else {
    if (
      raw.maximumQuoteAmountAtomic !== null
      || minimumOutput > expectedQuote
      || minimumOutput < slippageFloor(expectedQuote)
    ) {
      throw new Error("CASH sell economics exceeded the reviewed 0.5% limit");
    }
  }
  return {
    operation: "swap",
    ownerAddress,
    direction,
    contractAddress,
    entryFunction,
    pairId: CASH_ORDERBOOK_PAIR_ID,
    quoteMetadataAddress,
    baseMetadataAddress,
    cashAmountAtomic: cashAmount.toString(),
    expectedQuoteAmountAtomic: expectedQuote.toString(),
    maximumQuoteAmountAtomic,
    minimumOutputAmountAtomic: minimumOutput.toString(),
  };
}

export function makeCashSwapAmbiguityIdentity(args: {
  ownerAddress: string;
  direction: "buy" | "sell";
  contractAddress: string;
  cashAmountAtomic: string;
  expectedQuoteAmountAtomic: string;
  maximumQuoteAmountAtomic: string | null;
  minimumOutputAmountAtomic: string;
}): CashSwapAmbiguityIdentity {
  const contractAddress = normalizeAptosAddressText(args.contractAddress, "CASH contract address");
  return normalizeCashAmbiguityIdentity({
    operation: "swap",
    ownerAddress: args.ownerAddress,
    direction: args.direction,
    contractAddress,
    entryFunction: `${contractAddress}::order_placement::${args.direction === "buy" ? "buy_from_wallet" : "sell_from_wallet"}`,
    pairId: CASH_ORDERBOOK_PAIR_ID,
    quoteMetadataAddress: USDC_METADATA_ADDRESS,
    baseMetadataAddress: CASH_METADATA_ADDRESS,
    cashAmountAtomic: args.cashAmountAtomic,
    expectedQuoteAmountAtomic: args.expectedQuoteAmountAtomic,
    maximumQuoteAmountAtomic: args.maximumQuoteAmountAtomic,
    minimumOutputAmountAtomic: args.minimumOutputAmountAtomic,
  }) as CashSwapAmbiguityIdentity;
}

export function makeCashMigrationAmbiguityIdentity(ownerAddress: string): CashMigrationAmbiguityIdentity {
  return normalizeCashAmbiguityIdentity({
    operation: "migration",
    ownerAddress,
    entryFunction: "0x1::coin::migrate_to_fungible_store",
    legacyCoinType: CASH_LEGACY_COIN_TYPE,
    migrationMode: "entire-legacy-balance",
  }) as CashMigrationAmbiguityIdentity;
}

export function cashSwapFunctionArguments(identity: CashSwapAmbiguityIdentity) {
  const normalized = normalizeCashAmbiguityIdentity(identity);
  if (normalized.operation !== "swap") throw new Error("CASH swap identity was required");
  return normalized.direction === "buy"
    ? [
        String(normalized.pairId),
        normalized.quoteMetadataAddress,
        normalized.baseMetadataAddress,
        normalized.maximumQuoteAmountAtomic!,
        normalized.cashAmountAtomic,
        normalized.minimumOutputAmountAtomic,
      ]
    : [
        String(normalized.pairId),
        normalized.quoteMetadataAddress,
        normalized.baseMetadataAddress,
        normalized.cashAmountAtomic,
        normalized.minimumOutputAmountAtomic,
      ];
}

export function validateCashAccountObservation(args: {
  account: unknown;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): CashAccountObservation {
  const account = asRecord(args.account, "account");
  if (String(args.chainId) !== String(CASH_AMBIGUITY_MAINNET_CHAIN_ID)) {
    throw new Error("account observation was not from Aptos mainnet");
  }
  const sequenceNumber = unsignedU64(account.sequence_number, "account sequence number").toString();
  const ledgerVersion = unsignedU64(args.ledgerVersion, "ledger version").toString();
  const ledgerTimestampUsec = unsignedU64(args.ledgerTimestampUsec, "ledger timestamp").toString();
  const ledgerTimestampMs = Number(BigInt(ledgerTimestampUsec) / 1_000n);
  if (!Number.isSafeInteger(ledgerTimestampMs)) throw new Error("ledger timestamp exceeded the safe range");
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? CASH_AMBIGUITY_ACCOUNT_OBSERVATION_MAX_AGE_MS;
  if (ledgerTimestampMs > nowMs + maxAgeMs || ledgerTimestampMs < nowMs - maxAgeMs) {
    throw new Error("account observation ledger timestamp was stale");
  }
  return {
    chainId: CASH_AMBIGUITY_MAINNET_CHAIN_ID,
    sequenceNumber,
    ledgerVersion,
    ledgerTimestampUsec,
    ledgerTimestampMs,
  };
}

export function createCashAmbiguityRecord(args: {
  identity: CashAmbiguityIdentity;
  observation: CashAccountObservation;
}): CashAmbiguityRecord {
  if (args.observation.chainId !== CASH_AMBIGUITY_MAINNET_CHAIN_ID) {
    throw new Error("ambiguity record requires Aptos mainnet");
  }
  const identity = normalizeCashAmbiguityIdentity(args.identity);
  const createdAt = args.observation.ledgerTimestampMs;
  const requestedExpirationTimestampSecs = Math.floor(createdAt / 1_000)
    + CASH_AMBIGUITY_REQUESTED_EXPIRATION_SECONDS;
  return validateCashAmbiguityRecord({
    schemaVersion: CASH_AMBIGUITY_SCHEMA_VERSION,
    chainId: CASH_AMBIGUITY_MAINNET_CHAIN_ID,
    ownerAddress: identity.ownerAddress,
    identity,
    preSignSequenceNumber: args.observation.sequenceNumber,
    preSignLedgerVersion: args.observation.ledgerVersion,
    preSignLedgerTimestampUsec: args.observation.ledgerTimestampUsec,
    createdAt,
    requestedExpirationTimestampSecs,
    retrySafeAfterMs: requestedExpirationTimestampSecs * 1_000
      + CASH_AMBIGUITY_EXPIRATION_GRACE_MS,
  });
}

export function validateCashAmbiguityRecord(value: unknown, expectedOwner?: string): CashAmbiguityRecord {
  const raw = asRecord(value, "CASH ambiguity record");
  exactKeys(raw, [
    "schemaVersion",
    "chainId",
    "ownerAddress",
    "identity",
    "preSignSequenceNumber",
    "preSignLedgerVersion",
    "preSignLedgerTimestampUsec",
    "createdAt",
    "requestedExpirationTimestampSecs",
    "retrySafeAfterMs",
  ], "CASH ambiguity record");
  if (raw.schemaVersion !== CASH_AMBIGUITY_SCHEMA_VERSION) throw new Error("CASH ambiguity schema was not recognized");
  if (raw.chainId !== CASH_AMBIGUITY_MAINNET_CHAIN_ID) throw new Error("CASH ambiguity record was not for mainnet");
  const ownerAddress = normalizeCashAmbiguityOwner(String(raw.ownerAddress ?? ""));
  const identity = normalizeCashAmbiguityIdentity(raw.identity);
  if (identity.ownerAddress !== ownerAddress) throw new Error("CASH ambiguity owner did not match its transaction");
  if (expectedOwner && normalizeCashAmbiguityOwner(expectedOwner) !== ownerAddress) {
    throw new Error("CASH ambiguity owner did not match the connected wallet");
  }
  const preSignSequenceNumber = unsignedU64(raw.preSignSequenceNumber, "pre-sign sequence number").toString();
  const preSignLedgerVersion = unsignedU64(raw.preSignLedgerVersion, "pre-sign ledger version").toString();
  const preSignLedgerTimestampUsec = unsignedU64(raw.preSignLedgerTimestampUsec, "pre-sign ledger timestamp").toString();
  const createdAt = safeTimestamp(raw.createdAt, "ambiguity createdAt");
  const requestedExpirationTimestampSecs = safeTimestamp(raw.requestedExpirationTimestampSecs, "requested expiration");
  const retrySafeAfterMs = safeTimestamp(raw.retrySafeAfterMs, "retry-safe timestamp");
  if (createdAt !== Number(BigInt(preSignLedgerTimestampUsec) / 1_000n)) {
    throw new Error("ambiguity creation time did not match its chain watermark");
  }
  if (requestedExpirationTimestampSecs !== Math.floor(createdAt / 1_000) + CASH_AMBIGUITY_REQUESTED_EXPIRATION_SECONDS) {
    throw new Error("ambiguity expiration did not match the reviewed policy");
  }
  if (retrySafeAfterMs !== requestedExpirationTimestampSecs * 1_000 + CASH_AMBIGUITY_EXPIRATION_GRACE_MS) {
    throw new Error("ambiguity retry time did not match the reviewed policy");
  }
  return {
    schemaVersion: CASH_AMBIGUITY_SCHEMA_VERSION,
    chainId: CASH_AMBIGUITY_MAINNET_CHAIN_ID,
    ownerAddress,
    identity,
    preSignSequenceNumber,
    preSignLedgerVersion,
    preSignLedgerTimestampUsec,
    createdAt,
    requestedExpirationTimestampSecs,
    retrySafeAfterMs,
  };
}

function exactRestPayloadMatches(transaction: Record<string, unknown>, identity: CashAmbiguityIdentity) {
  const payload = transaction.payload && typeof transaction.payload === "object" && !Array.isArray(transaction.payload)
    ? transaction.payload as Record<string, unknown>
    : null;
  if (
    !payload
    || payload.type !== "entry_function_payload"
    || normalizeEntryFunction(payload.function, "candidate entry function") !== identity.entryFunction
    || !Array.isArray(payload.type_arguments)
    || !Array.isArray(payload.arguments)
  ) return false;
  const typeArguments = payload.type_arguments;
  const argumentsList = payload.arguments;
  if (identity.operation === "migration") {
    return argumentsList.length === 0
      && typeArguments.length === 1
      && normalizeTypeTag(typeArguments[0], "candidate migration type") === identity.legacyCoinType;
  }
  if (typeArguments.length !== 0) return false;
  const expectedArguments = cashSwapFunctionArguments(identity);
  if (argumentsList.length !== expectedArguments.length) return false;
  return expectedArguments.every((expected, index) => (
    index === 1 || index === 2
      ? normalizeAptosAddressText(argumentsList[index], "candidate asset") === expected
      : String(argumentsList[index]) === expected
  ));
}

export function isExpectedCashAmbiguityTransaction(
  transaction: unknown,
  identity: CashAmbiguityIdentity,
) {
  try {
    const expected = normalizeCashAmbiguityIdentity(identity);
    const candidate = asRecord(transaction, "candidate transaction");
    return normalizeCashAmbiguityOwner(String(candidate.sender ?? "")) === expected.ownerAddress
      && exactRestPayloadMatches(candidate, expected);
  } catch {
    return false;
  }
}

export function classifyCashAmbiguityRecovery(args: {
  ambiguity: CashAmbiguityRecord;
  observation: CashAccountObservation;
  candidateTransaction: unknown | null;
}): CashAmbiguityRecovery {
  const ambiguity = validateCashAmbiguityRecord(args.ambiguity);
  if (args.observation.chainId !== CASH_AMBIGUITY_MAINNET_CHAIN_ID) throw new Error("recovery observation was not from mainnet");
  const observedSequence = unsignedU64(args.observation.sequenceNumber, "observed sequence number");
  const observedLedgerVersion = unsignedU64(args.observation.ledgerVersion, "observed ledger version");
  const observedTimestampUsec = unsignedU64(args.observation.ledgerTimestampUsec, "observed ledger timestamp");
  if (!Number.isSafeInteger(args.observation.ledgerTimestampMs) || Number(observedTimestampUsec / 1_000n) !== args.observation.ledgerTimestampMs) {
    throw new Error("recovery observation chain time was malformed");
  }
  const preSignSequence = BigInt(ambiguity.preSignSequenceNumber);

  if (
    observedSequence < preSignSequence
    || observedLedgerVersion < BigInt(ambiguity.preSignLedgerVersion)
    || observedTimestampUsec < BigInt(ambiguity.preSignLedgerTimestampUsec)
  ) {
    return {
      status: "blocked",
      reason: "account-state-regressed",
      sequenceNumber: args.observation.sequenceNumber,
    };
  }

  if (args.candidateTransaction !== null) {
    let candidate: Record<string, unknown>;
    let candidateSender: string;
    let candidateSequence: string;
    let candidateVersion: bigint;
    try {
      candidate = asRecord(args.candidateTransaction, "candidate transaction");
      candidateSender = normalizeCashAmbiguityOwner(String(candidate.sender ?? ""));
      candidateSequence = unsignedU64(candidate.sequence_number, "candidate sequence number").toString();
      candidateVersion = unsignedU64(candidate.version, "candidate transaction version");
      unsignedU64(candidate.expiration_timestamp_secs, "candidate expiration");
    } catch {
      return { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: args.observation.sequenceNumber };
    }
    const payload = candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
      ? candidate.payload as Record<string, unknown>
      : null;
    let canonicalEntryFunction = false;
    let canonicalTypeArguments = false;
    try {
      normalizeEntryFunction(payload?.function, "candidate entry function");
      canonicalEntryFunction = true;
      canonicalTypeArguments = Array.isArray(payload?.type_arguments)
        && payload.type_arguments.every((value) => {
          if (typeof value !== "string") return false;
          parseTypeTag(value);
          return true;
        });
    } catch {
      canonicalEntryFunction = false;
      canonicalTypeArguments = false;
    }
    if (
      candidate.type !== "user_transaction"
      || candidateSender !== ambiguity.ownerAddress
      || candidateSequence !== ambiguity.preSignSequenceNumber
      || !isAptosTransactionHash(candidate.hash)
      || typeof candidate.success !== "boolean"
      || !payload
      || payload.type !== "entry_function_payload"
      || typeof payload.function !== "string"
      || !Array.isArray(payload.type_arguments)
      || !Array.isArray(payload.arguments)
      || !canonicalEntryFunction
      || !canonicalTypeArguments
      || candidateVersion <= BigInt(ambiguity.preSignLedgerVersion)
      || candidateVersion > observedLedgerVersion
    ) {
      return { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: args.observation.sequenceNumber };
    }
    if (isExpectedCashAmbiguityTransaction(candidate, ambiguity.identity)) {
      if (observedSequence <= preSignSequence) {
        return {
          status: "blocked",
          reason: "upstream-transaction-mismatch",
          sequenceNumber: args.observation.sequenceNumber,
        };
      }
      return { status: "submitted", hash: candidate.hash, sequenceNumber: candidateSequence };
    }
    if (observedSequence <= preSignSequence) {
      return { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: args.observation.sequenceNumber };
    }
    return { status: "safe-to-retry", reason: "sequence-consumed", sequenceNumber: candidateSequence };
  }

  if (observedSequence > preSignSequence) {
    return { status: "blocked", reason: "committed-transaction-proof-missing", sequenceNumber: args.observation.sequenceNumber };
  }
  if (args.observation.ledgerTimestampMs >= ambiguity.retrySafeAfterMs) {
    return { status: "safe-to-retry", reason: "expiration-grace-elapsed", sequenceNumber: args.observation.sequenceNumber };
  }
  return {
    status: "blocked",
    reason: "sequence-unchanged",
    sequenceNumber: args.observation.sequenceNumber,
    retryAfterMs: ambiguity.retrySafeAfterMs - args.observation.ledgerTimestampMs,
  };
}

export function validateCashAmbiguityRecovery(value: unknown, expected: CashAmbiguityRecord): CashAmbiguityRecovery {
  const ambiguity = validateCashAmbiguityRecord(expected);
  const raw = asRecord(value, "CASH ambiguity recovery");
  if (raw.status === "submitted") {
    exactKeys(raw, ["status", "hash", "sequenceNumber"], "submitted recovery");
    if (!isAptosTransactionHash(raw.hash)) throw new Error("recovered transaction hash was invalid");
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    if (sequenceNumber !== ambiguity.preSignSequenceNumber) throw new Error("recovered transaction used another sequence");
    return { status: "submitted", hash: raw.hash, sequenceNumber };
  }
  if (raw.status === "safe-to-retry") {
    exactKeys(raw, ["status", "reason", "sequenceNumber"], "safe recovery");
    if (raw.reason !== "sequence-consumed" && raw.reason !== "expiration-grace-elapsed") {
      throw new Error("safe recovery reason was invalid");
    }
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    if (sequenceNumber !== ambiguity.preSignSequenceNumber) throw new Error("safe recovery proof used another sequence");
    return { status: "safe-to-retry", reason: raw.reason, sequenceNumber };
  }
  if (raw.status === "blocked") {
    const reasons = [
      "sequence-unchanged",
      "account-state-regressed",
      "committed-transaction-proof-missing",
      "upstream-transaction-mismatch",
    ] as const;
    if (!reasons.includes(raw.reason as typeof reasons[number])) throw new Error("blocked recovery reason was invalid");
    exactKeys(raw, raw.retryAfterMs === undefined
      ? ["status", "reason", "sequenceNumber"]
      : ["status", "reason", "sequenceNumber", "retryAfterMs"], "blocked recovery");
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    const retryAfterMs = raw.retryAfterMs === undefined ? undefined : safeTimestamp(raw.retryAfterMs, "recovery delay");
    return {
      status: "blocked",
      reason: raw.reason as typeof reasons[number],
      sequenceNumber,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  throw new Error("CASH ambiguity recovery status was invalid");
}

function u64LittleEndian(value: string) {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function addressBytes(address: string) {
  const normalized = normalizeAptosAddressText(address).slice(2);
  return Uint8Array.from(normalized.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function equalBytes(actual: Uint8Array, expected: Uint8Array) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function validateSignedCashRawTransaction(transaction: RawTransaction, expected: CashAmbiguityRecord) {
  const ambiguity = validateCashAmbiguityRecord(expected);
  if (normalizeCashAmbiguityOwner(transaction.sender.toStringLong()) !== ambiguity.ownerAddress) {
    throw new Error("signed CASH transaction sender did not match the reviewed wallet");
  }
  if (transaction.sequence_number.toString() !== ambiguity.preSignSequenceNumber) {
    throw new Error("signed CASH transaction sequence did not match the pre-sign watermark");
  }
  if (transaction.chain_id.chainId !== CASH_AMBIGUITY_MAINNET_CHAIN_ID) {
    throw new Error("signed CASH transaction was not for Aptos mainnet");
  }
  if (transaction.expiration_timestamp_secs.toString() !== String(ambiguity.requestedExpirationTimestampSecs)) {
    throw new Error("signed CASH transaction expiration did not match the reviewed safety window");
  }
  if (
    transaction.max_gas_amount > CASH_AMBIGUITY_MAX_GAS_AMOUNT
    || transaction.gas_unit_price > CASH_AMBIGUITY_MAX_GAS_UNIT_PRICE
    || transaction.max_gas_amount * transaction.gas_unit_price > CASH_AMBIGUITY_MAX_GAS_COST_OCTAS
  ) {
    throw new Error("signed CASH transaction gas limit exceeded the reviewed safety bound");
  }
  if (!(transaction.payload instanceof TransactionPayloadEntryFunction)) {
    throw new Error("signed CASH transaction did not contain the reviewed entry function");
  }
  const entry = transaction.payload.entryFunction;
  const [packageAddress, moduleName, functionName] = ambiguity.identity.entryFunction.split("::");
  if (
    entry.module_name.address.toStringLong() !== packageAddress
    || entry.module_name.name.identifier !== moduleName
    || entry.function_name.identifier !== functionName
  ) throw new Error("signed CASH transaction entry function did not match the reviewed request");

  if (ambiguity.identity.operation === "migration") {
    if (
      entry.args.length !== 0
      || entry.type_args.length !== 1
      || normalizeTypeTag(entry.type_args[0].toString(), "signed migration type") !== ambiguity.identity.legacyCoinType
    ) throw new Error("signed CASH migration did not match the reviewed transaction");
    return transaction;
  }

  if (entry.type_args.length !== 0) throw new Error("signed CASH swap included unexpected type arguments");
  const actualArgs = entry.args.map((argument) => {
    if (!(argument instanceof EntryFunctionBytes)) throw new Error("signed CASH transaction used an unexpected argument encoding");
    return argument.value.value;
  });
  const identity = ambiguity.identity;
  const expectedArgs = identity.direction === "buy"
    ? [
        u64LittleEndian(String(identity.pairId)),
        addressBytes(identity.quoteMetadataAddress),
        addressBytes(identity.baseMetadataAddress),
        u64LittleEndian(identity.maximumQuoteAmountAtomic!),
        u64LittleEndian(identity.cashAmountAtomic),
        u64LittleEndian(identity.minimumOutputAmountAtomic),
      ]
    : [
        u64LittleEndian(String(identity.pairId)),
        addressBytes(identity.quoteMetadataAddress),
        addressBytes(identity.baseMetadataAddress),
        u64LittleEndian(identity.cashAmountAtomic),
        u64LittleEndian(identity.minimumOutputAmountAtomic),
      ];
  if (
    actualArgs.length !== expectedArgs.length
    || actualArgs.some((argument, index) => !equalBytes(argument, expectedArgs[index]))
  ) throw new Error("signed CASH transaction arguments did not match the reviewed economics");
  return transaction;
}

export function cashAmbiguityStorageKey(owner: string) {
  return `${CASH_AMBIGUITY_STORAGE_PREFIX}:${normalizeCashAmbiguityOwner(owner)}`;
}

export function cashAmbiguityQuarantineStorageKey(owner: string) {
  return `${CASH_AMBIGUITY_QUARANTINE_STORAGE_PREFIX}:${normalizeCashAmbiguityOwner(owner)}`;
}

export function cashWalletLockName(owner: string) {
  return `cash:wallet-operation:${normalizeCashAmbiguityOwner(owner)}`;
}

function quarantineStorageValue(
  storage: CashAmbiguityStorage,
  owner: string,
  sourceKey: string,
  raw: string,
  reason: string,
) {
  const quarantineKey = cashAmbiguityQuarantineStorageKey(owner);
  const quarantine = JSON.stringify({
    schemaVersion: 1,
    ownerAddress: normalizeCashAmbiguityOwner(owner),
    sourceKey,
    raw: raw.slice(0, 20_000),
    reason,
    quarantinedAt: Date.now(),
  });
  storage.setItem(quarantineKey, quarantine);
  if (storage.getItem(quarantineKey) !== quarantine || storage.getItem(sourceKey) !== raw) return false;
  storage.removeItem(sourceKey);
  return storage.getItem(sourceKey) === null;
}

export function persistCashAmbiguity(storage: CashAmbiguityStorage, record: CashAmbiguityRecord) {
  try {
    const normalized = validateCashAmbiguityRecord(record);
    const raw = JSON.stringify(normalized);
    const key = cashAmbiguityStorageKey(normalized.ownerAddress);
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch {
    return false;
  }
}

export function loadCashAmbiguity(storage: CashAmbiguityStorage, owner: string): CashStoredAmbiguity {
  const originalOwner = owner;
  const normalizedOwner = normalizeCashAmbiguityOwner(owner);
  try {
    if (storage.getItem(cashAmbiguityQuarantineStorageKey(normalizedOwner)) !== null) {
      return { status: "quarantined", reason: "A stored CASH wallet safety record needs manual review." };
    }
    const key = cashAmbiguityStorageKey(normalizedOwner);
    const raw = storage.getItem(key);
    if (raw) {
      try {
        return { status: "valid", record: validateCashAmbiguityRecord(JSON.parse(raw), normalizedOwner) };
      } catch {
        const quarantined = quarantineStorageValue(storage, normalizedOwner, key, raw, "Malformed CASH ambiguity record");
        return {
          status: "quarantined",
          reason: quarantined
            ? "A malformed CASH wallet safety record was quarantined."
            : "A malformed CASH wallet safety record could not be quarantined.",
        };
      }
    }

    const ownerKeys = [originalOwner.toLowerCase(), normalizedOwner];
    const legacyPrefixes = [
      `${CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX}`,
      `${CASH_LEGACY_PENDING_SWAP_STORAGE_PREFIX}`,
      `${CASH_LEGACY_PENDING_MIGRATION_STORAGE_PREFIX}`,
    ];
    const legacyKeys = legacyPrefixes.flatMap((prefix) => (
      prefix === CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX
        ? ownerKeys.flatMap((ownerKey) => [`${prefix}:${ownerKey}:swap`, `${prefix}:${ownerKey}:migration`])
        : ownerKeys.map((ownerKey) => `${prefix}:${ownerKey}`)
    ));
    const legacyKey = legacyKeys.find((candidate, index) => legacyKeys.indexOf(candidate) === index && storage.getItem(candidate) !== null);
    if (!legacyKey) return { status: "none" };
    const legacyRaw = storage.getItem(legacyKey) ?? "unreadable";
    const quarantined = quarantineStorageValue(
      storage,
      normalizedOwner,
      legacyKey,
      legacyRaw,
      "Legacy CASH wallet record lacked exact sequence and expiration evidence",
    );
    return {
      status: "quarantined",
      reason: quarantined
        ? "A legacy CASH wallet safety record was quarantined."
        : "A legacy CASH wallet safety record could not be quarantined.",
    };
  } catch {
    return { status: "quarantined", reason: "Browser storage could not be verified." };
  }
}

export function clearCashAmbiguity(storage: CashAmbiguityStorage, expected: CashAmbiguityRecord) {
  try {
    const normalized = validateCashAmbiguityRecord(expected);
    const key = cashAmbiguityStorageKey(normalized.ownerAddress);
    const raw = storage.getItem(key);
    if (!raw) return false;
    const current = validateCashAmbiguityRecord(JSON.parse(raw), normalized.ownerAddress);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}
