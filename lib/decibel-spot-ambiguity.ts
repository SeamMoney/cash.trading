import {
  EntryFunctionBytes,
  TransactionPayloadEntryFunction,
  type RawTransaction,
} from "@aptos-labs/ts-sdk";

import { isAptosTransactionHash } from "./cash-orderbook-confirmation";
import {
  isExpectedDecibelSpotTransaction,
  type DecibelSpotOrderIdentity,
} from "./decibel-spot-confirmation";
import {
  DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION,
  DECIBEL_SPOT_IOC_TIF,
  normalizeDecibelSpotAddress,
  resolvePinnedDecibelSpotMarket,
} from "./decibel-spot";

const U64_MAX = (1n << 64n) - 1n;
const UNSIGNED_INTEGER = /^(0|[1-9]\d*)$/;

export const DECIBEL_SPOT_MAINNET_CHAIN_ID = 1 as const;
export const DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION = 2 as const;
export const DECIBEL_SPOT_REQUESTED_EXPIRATION_SECONDS = 120 as const;
// The installed Aptos SDK defaults to a 20-second expiration. We request a
// two-minute expiration and then wait another hour of chain time before an
// unchanged sequence can be treated as unable to execute.
export const DECIBEL_SPOT_AMBIGUITY_EXPIRATION_GRACE_MS = 60 * 60 * 1_000;
export const DECIBEL_SPOT_ACCOUNT_OBSERVATION_MAX_AGE_MS = 30_000;
export const DECIBEL_SPOT_MAX_GAS_AMOUNT = 2_000_000n;
export const DECIBEL_SPOT_MAX_GAS_UNIT_PRICE = 10_000n;
export const DECIBEL_SPOT_MAX_GAS_COST_OCTAS = 50_000_000n;

export const DECIBEL_SPOT_PENDING_STORAGE_PREFIX = "cash:decibel-spot-pending:v2";
export const DECIBEL_SPOT_AMBIGUITY_STORAGE_PREFIX = "cash:decibel-spot-wallet-unknown:v2";
export const DECIBEL_SPOT_QUARANTINE_STORAGE_PREFIX = "cash:decibel-spot-quarantine:v1";
export const DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX = "cash:decibel-spot-pending:v1";
export const DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX = "cash:decibel-spot-wallet-unknown:v1";

export type DecibelSpotExactOrderIdentity = DecibelSpotOrderIdentity & {
  entryFunction: typeof DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION;
  timeInForce: typeof DECIBEL_SPOT_IOC_TIF;
  builderCode: null;
  builderFee: null;
};

export type DecibelSpotAmbiguityRecord = {
  schemaVersion: typeof DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION;
  chainId: typeof DECIBEL_SPOT_MAINNET_CHAIN_ID;
  ownerAddress: string;
  identity: DecibelSpotExactOrderIdentity;
  preSignSequenceNumber: string;
  preSignLedgerVersion: string;
  preSignLedgerTimestampUsec: string;
  createdAt: number;
  requestedExpirationTimestampSecs: number;
  retrySafeAfterMs: number;
};

export type DecibelSpotAccountObservation = {
  chainId: typeof DECIBEL_SPOT_MAINNET_CHAIN_ID;
  sequenceNumber: string;
  ledgerVersion: string;
  ledgerTimestampUsec: string;
  ledgerTimestampMs: number;
};

export type DecibelSpotAmbiguityRecovery =
  | {
      status: "submitted";
      hash: string;
      sequenceNumber: string;
    }
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

export type DecibelSpotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DecibelSpotStoredAmbiguity =
  | { status: "none" }
  | { status: "valid"; record: DecibelSpotAmbiguityRecord }
  | { status: "quarantined"; reason: string };

export type DecibelSpotAmbiguityPrepareResponse = {
  ready: true;
  action: "prepare";
  ambiguity: DecibelSpotAmbiguityRecord;
};

export type DecibelSpotAmbiguityResolveResponse = {
  ready: true;
  action: "resolve";
  recovery: DecibelSpotAmbiguityRecovery;
  checkedAt: number;
};

export type DecibelSpotAmbiguityErrorResponse = {
  ready: false;
  message: string;
};

type PrepareRecordInput = {
  identity: DecibelSpotOrderIdentity;
  observation: DecibelSpotAccountObservation;
};

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

export function normalizeDecibelSpotExactOrderIdentity(
  value: unknown,
): DecibelSpotExactOrderIdentity {
  const raw = asRecord(value, "identity");
  exactKeys(raw, [
    "ownerAddress",
    "marketAddress",
    "priceAtomic",
    "sizeAtomic",
    "isBid",
    "entryFunction",
    "timeInForce",
    "builderCode",
    "builderFee",
  ], "identity");
  const ownerAddress = normalizeDecibelSpotAddress(raw.ownerAddress, "identity.ownerAddress");
  const market = resolvePinnedDecibelSpotMarket(raw.marketAddress);
  const price = unsignedU64(raw.priceAtomic, "identity.priceAtomic", false);
  const size = unsignedU64(raw.sizeAtomic, "identity.sizeAtomic", false);
  if (price < BigInt(market.minPriceRaw) || price > BigInt(market.maxPriceRaw)) {
    throw new Error("identity.priceAtomic is outside the reviewed market range");
  }
  if (price % BigInt(market.tickSizeRaw) !== 0n) {
    throw new Error("identity.priceAtomic is not aligned to the reviewed tick size");
  }
  if (size < BigInt(market.minSizeRaw) || size % BigInt(market.lotSizeRaw) !== 0n) {
    throw new Error("identity.sizeAtomic is not aligned to the reviewed lot size");
  }
  if (typeof raw.isBid !== "boolean") throw new Error("identity.isBid must be a boolean");
  if (raw.entryFunction !== DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION) {
    throw new Error("identity.entryFunction did not match the reviewed Decibel spot entry function");
  }
  if (raw.timeInForce !== DECIBEL_SPOT_IOC_TIF) {
    throw new Error("identity.timeInForce must be immediate-or-cancel");
  }
  if (raw.builderCode !== null || raw.builderFee !== null) {
    throw new Error("identity must not include a builder code or builder fee");
  }
  return {
    ownerAddress,
    marketAddress: market.marketAddress,
    priceAtomic: price.toString(),
    sizeAtomic: size.toString(),
    isBid: raw.isBid,
    entryFunction: DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION,
    timeInForce: DECIBEL_SPOT_IOC_TIF,
    builderCode: null,
    builderFee: null,
  };
}

export function makeDecibelSpotExactOrderIdentity(
  identity: DecibelSpotOrderIdentity,
): DecibelSpotExactOrderIdentity {
  return normalizeDecibelSpotExactOrderIdentity({
    ...identity,
    entryFunction: DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION,
    timeInForce: DECIBEL_SPOT_IOC_TIF,
    builderCode: null,
    builderFee: null,
  });
}

export function validateDecibelSpotAccountObservation(args: {
  account: unknown;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): DecibelSpotAccountObservation {
  const account = asRecord(args.account, "account");
  if (String(args.chainId) !== String(DECIBEL_SPOT_MAINNET_CHAIN_ID)) {
    throw new Error("account observation was not from Aptos mainnet");
  }
  const sequenceNumber = unsignedU64(account.sequence_number, "account.sequence_number").toString();
  const ledgerVersion = unsignedU64(args.ledgerVersion, "ledger version").toString();
  const ledgerTimestampUsec = unsignedU64(args.ledgerTimestampUsec, "ledger timestamp").toString();
  const ledgerTimestampMs = Number(BigInt(ledgerTimestampUsec) / 1_000n);
  if (!Number.isSafeInteger(ledgerTimestampMs)) throw new Error("ledger timestamp exceeded the safe range");
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_ACCOUNT_OBSERVATION_MAX_AGE_MS;
  if (ledgerTimestampMs > nowMs + maxAgeMs || ledgerTimestampMs < nowMs - maxAgeMs) {
    throw new Error("account observation ledger timestamp was stale");
  }
  return {
    chainId: DECIBEL_SPOT_MAINNET_CHAIN_ID,
    sequenceNumber,
    ledgerVersion,
    ledgerTimestampUsec,
    ledgerTimestampMs,
  };
}

export function createDecibelSpotAmbiguityRecord({
  identity,
  observation,
}: PrepareRecordInput): DecibelSpotAmbiguityRecord {
  if (observation.chainId !== DECIBEL_SPOT_MAINNET_CHAIN_ID) {
    throw new Error("ambiguity record requires Aptos mainnet");
  }
  const exactIdentity = makeDecibelSpotExactOrderIdentity(identity);
  const createdAt = observation.ledgerTimestampMs;
  const requestedExpirationTimestampSecs = Math.floor(createdAt / 1_000)
    + DECIBEL_SPOT_REQUESTED_EXPIRATION_SECONDS;
  return validateDecibelSpotAmbiguityRecord({
    schemaVersion: DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION,
    chainId: DECIBEL_SPOT_MAINNET_CHAIN_ID,
    ownerAddress: exactIdentity.ownerAddress,
    identity: exactIdentity,
    preSignSequenceNumber: observation.sequenceNumber,
    preSignLedgerVersion: observation.ledgerVersion,
    preSignLedgerTimestampUsec: observation.ledgerTimestampUsec,
    createdAt,
    requestedExpirationTimestampSecs,
    retrySafeAfterMs:
      requestedExpirationTimestampSecs * 1_000
      + DECIBEL_SPOT_AMBIGUITY_EXPIRATION_GRACE_MS,
  });
}

export function validateDecibelSpotAmbiguityRecord(
  value: unknown,
  expectedOwner?: string,
): DecibelSpotAmbiguityRecord {
  const raw = asRecord(value, "ambiguity record");
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
  ], "ambiguity record");
  if (raw.schemaVersion !== DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION) {
    throw new Error("ambiguity record schema was not recognized");
  }
  if (raw.chainId !== DECIBEL_SPOT_MAINNET_CHAIN_ID) {
    throw new Error("ambiguity record was not for Aptos mainnet");
  }
  const ownerAddress = normalizeDecibelSpotAddress(raw.ownerAddress, "ambiguity owner");
  const identity = normalizeDecibelSpotExactOrderIdentity(raw.identity);
  if (identity.ownerAddress !== ownerAddress) {
    throw new Error("ambiguity owner did not match the exact order identity");
  }
  if (expectedOwner && normalizeDecibelSpotAddress(expectedOwner) !== ownerAddress) {
    throw new Error("ambiguity owner did not match the connected wallet");
  }
  const preSignSequenceNumber = unsignedU64(
    raw.preSignSequenceNumber,
    "pre-sign sequence number",
  ).toString();
  const preSignLedgerVersion = unsignedU64(
    raw.preSignLedgerVersion,
    "pre-sign ledger version",
  ).toString();
  const preSignLedgerTimestampUsec = unsignedU64(
    raw.preSignLedgerTimestampUsec,
    "pre-sign ledger timestamp",
  ).toString();
  const createdAt = safeTimestamp(raw.createdAt, "ambiguity createdAt");
  const requestedExpirationTimestampSecs = safeTimestamp(
    raw.requestedExpirationTimestampSecs,
    "requested expiration",
  );
  const retrySafeAfterMs = safeTimestamp(raw.retrySafeAfterMs, "retry-safe timestamp");
  const ledgerCreatedAt = Number(BigInt(preSignLedgerTimestampUsec) / 1_000n);
  if (createdAt !== ledgerCreatedAt) {
    throw new Error("ambiguity createdAt did not match its chain watermark");
  }
  if (
    requestedExpirationTimestampSecs
      !== Math.floor(createdAt / 1_000) + DECIBEL_SPOT_REQUESTED_EXPIRATION_SECONDS
  ) {
    throw new Error("ambiguity requested expiration did not match the reviewed policy");
  }
  if (
    retrySafeAfterMs
      !== requestedExpirationTimestampSecs * 1_000
        + DECIBEL_SPOT_AMBIGUITY_EXPIRATION_GRACE_MS
  ) {
    throw new Error("ambiguity retry-safe timestamp did not match the reviewed policy");
  }
  return {
    schemaVersion: DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION,
    chainId: DECIBEL_SPOT_MAINNET_CHAIN_ID,
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

export function classifyDecibelSpotAmbiguityRecovery(args: {
  ambiguity: DecibelSpotAmbiguityRecord;
  observation: DecibelSpotAccountObservation;
  candidateTransaction: unknown | null;
}): DecibelSpotAmbiguityRecovery {
  const ambiguity = validateDecibelSpotAmbiguityRecord(args.ambiguity);
  if (args.observation.chainId !== DECIBEL_SPOT_MAINNET_CHAIN_ID) {
    throw new Error("recovery observation was not from Aptos mainnet");
  }
  const observedSequence = unsignedU64(
    args.observation.sequenceNumber,
    "observed sequence number",
  );
  const observedLedgerVersion = unsignedU64(
    args.observation.ledgerVersion,
    "observed ledger version",
  );
  const observedTimestampUsec = unsignedU64(
    args.observation.ledgerTimestampUsec,
    "observed ledger timestamp",
  );
  if (
    !Number.isSafeInteger(args.observation.ledgerTimestampMs)
    || Number(observedTimestampUsec / 1_000n) !== args.observation.ledgerTimestampMs
  ) {
    throw new Error("recovery observation chain time was malformed");
  }
  const preSignSequence = BigInt(ambiguity.preSignSequenceNumber);

  if (args.candidateTransaction !== null) {
    let candidate: Record<string, unknown>;
    let candidateSender: string;
    let candidateSequence: string;
    let candidateVersion: bigint;
    try {
      candidate = asRecord(args.candidateTransaction, "candidate transaction");
      candidateSender = normalizeDecibelSpotAddress(candidate.sender, "candidate sender");
      candidateSequence = unsignedU64(
        candidate.sequence_number,
        "candidate sequence number",
      ).toString();
      candidateVersion = unsignedU64(
        candidate.version,
        "candidate transaction version",
      );
    } catch {
      return {
        status: "blocked",
        reason: "upstream-transaction-mismatch",
        sequenceNumber: args.observation.sequenceNumber,
      };
    }
    const candidatePayload = candidate.payload && typeof candidate.payload === "object"
      && !Array.isArray(candidate.payload)
      ? candidate.payload as Record<string, unknown>
      : null;
    if (
      candidate.type !== "user_transaction"
      || candidateSender !== ambiguity.ownerAddress
      || candidateSequence !== ambiguity.preSignSequenceNumber
      || !isAptosTransactionHash(candidate.hash)
      || typeof candidate.success !== "boolean"
      || !candidatePayload
      || candidatePayload.type !== "entry_function_payload"
      || typeof candidatePayload.function !== "string"
      || !Array.isArray(candidatePayload.type_arguments)
      || !Array.isArray(candidatePayload.arguments)
      || candidateVersion <= BigInt(ambiguity.preSignLedgerVersion)
      || candidateVersion > observedLedgerVersion
    ) {
      return {
        status: "blocked",
        reason: "upstream-transaction-mismatch",
        sequenceNumber: args.observation.sequenceNumber,
      };
    }
    if (isExpectedDecibelSpotTransaction(candidate, ambiguity.identity)) {
      return {
        status: "submitted",
        hash: candidate.hash,
        sequenceNumber: candidateSequence,
      };
    }
    if (observedSequence <= preSignSequence) {
      return {
        status: "blocked",
        reason: "upstream-transaction-mismatch",
        sequenceNumber: args.observation.sequenceNumber,
      };
    }
    return {
      status: "safe-to-retry",
      reason: "sequence-consumed",
      sequenceNumber: candidateSequence,
    };
  }

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
  if (observedSequence > preSignSequence) {
    return {
      status: "blocked",
      reason: "committed-transaction-proof-missing",
      sequenceNumber: args.observation.sequenceNumber,
    };
  }
  if (args.observation.ledgerTimestampMs >= ambiguity.retrySafeAfterMs) {
    return {
      status: "safe-to-retry",
      reason: "expiration-grace-elapsed",
      sequenceNumber: args.observation.sequenceNumber,
    };
  }
  return {
    status: "blocked",
    reason: "sequence-unchanged",
    sequenceNumber: args.observation.sequenceNumber,
    retryAfterMs: ambiguity.retrySafeAfterMs - args.observation.ledgerTimestampMs,
  };
}

export function validateDecibelSpotAmbiguityRecovery(
  value: unknown,
  expected: DecibelSpotAmbiguityRecord,
): DecibelSpotAmbiguityRecovery {
  const ambiguity = validateDecibelSpotAmbiguityRecord(expected);
  const raw = asRecord(value, "ambiguity recovery");
  if (raw.status === "submitted") {
    exactKeys(raw, ["status", "hash", "sequenceNumber"], "submitted recovery");
    if (!isAptosTransactionHash(raw.hash)) throw new Error("recovered transaction hash was invalid");
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    if (sequenceNumber !== ambiguity.preSignSequenceNumber) {
      throw new Error("recovered transaction used another sequence number");
    }
    return { status: "submitted", hash: raw.hash, sequenceNumber };
  }
  if (raw.status === "safe-to-retry") {
    exactKeys(raw, ["status", "reason", "sequenceNumber"], "safe recovery");
    if (raw.reason !== "sequence-consumed" && raw.reason !== "expiration-grace-elapsed") {
      throw new Error("safe recovery reason was invalid");
    }
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    if (sequenceNumber !== ambiguity.preSignSequenceNumber) {
      throw new Error("safe recovery proof used another sequence number");
    }
    return { status: "safe-to-retry", reason: raw.reason, sequenceNumber };
  }
  if (raw.status === "blocked") {
    const allowedReasons = [
      "sequence-unchanged",
      "account-state-regressed",
      "committed-transaction-proof-missing",
      "upstream-transaction-mismatch",
    ] as const;
    if (!allowedReasons.includes(raw.reason as typeof allowedReasons[number])) {
      throw new Error("blocked recovery reason was invalid");
    }
    const allowedKeys = raw.retryAfterMs === undefined
      ? ["status", "reason", "sequenceNumber"]
      : ["status", "reason", "sequenceNumber", "retryAfterMs"];
    exactKeys(raw, allowedKeys, "blocked recovery");
    const sequenceNumber = unsignedU64(raw.sequenceNumber, "recovered sequence number").toString();
    const retryAfterMs = raw.retryAfterMs === undefined
      ? undefined
      : safeTimestamp(raw.retryAfterMs, "recovery retry delay");
    return {
      status: "blocked",
      reason: raw.reason as typeof allowedReasons[number],
      sequenceNumber,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  throw new Error("ambiguity recovery status was invalid");
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

function equalBytes(actual: Uint8Array, expected: Uint8Array) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function hexAddressBytes(address: string) {
  const normalized = normalizeDecibelSpotAddress(address).slice(2);
  return Uint8Array.from(
    normalized.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

/**
 * Verifies the exact raw transaction returned by a wallet before this app
 * submits it. This pins the sequence number and expiration used by ambiguity
 * recovery, and prevents a wallet response from silently changing the order.
 */
export function validateSignedDecibelSpotRawTransaction(
  transaction: RawTransaction,
  expected: DecibelSpotAmbiguityRecord,
) {
  const ambiguity = validateDecibelSpotAmbiguityRecord(expected);
  if (normalizeDecibelSpotAddress(transaction.sender.toStringLong()) !== ambiguity.ownerAddress) {
    throw new Error("signed transaction sender did not match the reviewed wallet");
  }
  if (transaction.sequence_number.toString() !== ambiguity.preSignSequenceNumber) {
    throw new Error("signed transaction sequence did not match the pre-sign watermark");
  }
  if (transaction.chain_id.chainId !== DECIBEL_SPOT_MAINNET_CHAIN_ID) {
    throw new Error("signed transaction was not for Aptos mainnet");
  }
  if (
    transaction.expiration_timestamp_secs.toString()
      !== String(ambiguity.requestedExpirationTimestampSecs)
  ) {
    throw new Error("signed transaction expiration did not match the reviewed safety window");
  }
  if (
    transaction.max_gas_amount > DECIBEL_SPOT_MAX_GAS_AMOUNT
    || transaction.gas_unit_price > DECIBEL_SPOT_MAX_GAS_UNIT_PRICE
    || transaction.max_gas_amount * transaction.gas_unit_price > DECIBEL_SPOT_MAX_GAS_COST_OCTAS
  ) {
    throw new Error("signed transaction gas limit exceeded the reviewed safety bound");
  }
  if (!(transaction.payload instanceof TransactionPayloadEntryFunction)) {
    throw new Error("signed transaction did not contain the reviewed entry function");
  }
  const entry = transaction.payload.entryFunction;
  const [packageAddress, moduleName, functionName] = ambiguity.identity.entryFunction.split("::");
  if (
    entry.module_name.address.toStringLong() !== packageAddress
    || entry.module_name.name.identifier !== moduleName
    || entry.function_name.identifier !== functionName
    || entry.type_args.length !== 0
    || entry.args.length !== 7
  ) {
    throw new Error("signed transaction entry function did not match the reviewed spot order");
  }
  const actualArgs = entry.args.map((argument) => {
    if (!(argument instanceof EntryFunctionBytes)) {
      throw new Error("signed transaction contained an unexpected argument encoding");
    }
    return argument.value.value;
  });
  const expectedArgs = [
    hexAddressBytes(ambiguity.identity.marketAddress),
    u64LittleEndian(ambiguity.identity.priceAtomic),
    u64LittleEndian(ambiguity.identity.sizeAtomic),
    Uint8Array.of(ambiguity.identity.isBid ? 1 : 0),
    Uint8Array.of(DECIBEL_SPOT_IOC_TIF),
    Uint8Array.of(0),
    Uint8Array.of(0),
  ];
  if (actualArgs.some((argument, index) => !equalBytes(argument, expectedArgs[index]))) {
    throw new Error("signed transaction arguments did not match the reviewed spot order");
  }
  return transaction;
}

export function normalizeDecibelSpotOwnerKey(owner: string) {
  return normalizeDecibelSpotAddress(owner, "wallet owner");
}

export function decibelSpotPendingStorageKey(owner: string) {
  return `${DECIBEL_SPOT_PENDING_STORAGE_PREFIX}:${normalizeDecibelSpotOwnerKey(owner)}`;
}

export function decibelSpotAmbiguityStorageKey(owner: string) {
  return `${DECIBEL_SPOT_AMBIGUITY_STORAGE_PREFIX}:${normalizeDecibelSpotOwnerKey(owner)}`;
}

export function decibelSpotQuarantineStorageKey(owner: string) {
  return `${DECIBEL_SPOT_QUARANTINE_STORAGE_PREFIX}:${normalizeDecibelSpotOwnerKey(owner)}`;
}

export function decibelSpotWalletLockName(owner: string) {
  return `cash:wallet-operation:${normalizeDecibelSpotOwnerKey(owner)}`;
}

function quarantineStorageValue(
  storage: DecibelSpotStorage,
  owner: string,
  sourceKey: string,
  raw: string,
  reason: string,
) {
  const quarantineKey = decibelSpotQuarantineStorageKey(owner);
  const quarantine = JSON.stringify({
    schemaVersion: 1,
    ownerAddress: normalizeDecibelSpotOwnerKey(owner),
    sourceKey,
    raw: raw.slice(0, 20_000),
    reason,
    quarantinedAt: Date.now(),
  });
  storage.setItem(quarantineKey, quarantine);
  if (storage.getItem(quarantineKey) !== quarantine) return false;
  if (storage.getItem(sourceKey) !== raw) return false;
  storage.removeItem(sourceKey);
  return storage.getItem(sourceKey) === null;
}

export function quarantineDecibelSpotStorageEntry(args: {
  storage: DecibelSpotStorage;
  owner: string;
  sourceKey: string;
  raw: string;
  reason: string;
}) {
  try {
    return quarantineStorageValue(
      args.storage,
      args.owner,
      args.sourceKey,
      args.raw,
      args.reason,
    );
  } catch {
    return false;
  }
}

export function persistDecibelSpotAmbiguity(
  storage: DecibelSpotStorage,
  record: DecibelSpotAmbiguityRecord,
) {
  try {
    const normalized = validateDecibelSpotAmbiguityRecord(record);
    const raw = JSON.stringify(normalized);
    const key = decibelSpotAmbiguityStorageKey(normalized.ownerAddress);
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch {
    return false;
  }
}

export function loadDecibelSpotAmbiguity(
  storage: DecibelSpotStorage,
  owner: string,
): DecibelSpotStoredAmbiguity {
  const originalOwner = owner;
  const normalizedOwner = normalizeDecibelSpotOwnerKey(owner);
  const quarantineKey = decibelSpotQuarantineStorageKey(normalizedOwner);
  try {
    if (storage.getItem(quarantineKey) !== null) {
      return { status: "quarantined", reason: "A stored wallet safety record was invalid." };
    }
    const key = decibelSpotAmbiguityStorageKey(normalizedOwner);
    const raw = storage.getItem(key);
    if (!raw) {
      const legacyKeys = [
        `${DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${originalOwner.toLowerCase()}`,
        `${DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${normalizedOwner}`,
      ];
      const legacyKey = legacyKeys.find(
        (candidate, index) => legacyKeys.indexOf(candidate) === index
          && storage.getItem(candidate) !== null,
      );
      if (!legacyKey) return { status: "none" };
      const legacyRaw = storage.getItem(legacyKey) ?? "unreadable";
      const quarantined = quarantineStorageValue(
        storage,
        normalizedOwner,
        legacyKey,
        legacyRaw,
        "Legacy ambiguity record did not contain account sequence evidence",
      );
      return {
        status: "quarantined",
        reason: quarantined
          ? "A legacy wallet safety record was quarantined."
          : "A legacy wallet safety record could not be quarantined.",
      };
    }
    try {
      return {
        status: "valid",
        record: validateDecibelSpotAmbiguityRecord(JSON.parse(raw), normalizedOwner),
      };
    } catch {
      const quarantined = quarantineStorageValue(
        storage,
        normalizedOwner,
        key,
        raw,
        "Malformed Decibel spot ambiguity record",
      );
      return {
        status: "quarantined",
        reason: quarantined
          ? "A malformed wallet safety record was quarantined."
          : "A malformed wallet safety record could not be quarantined.",
      };
    }
  } catch {
    return { status: "quarantined", reason: "Browser storage could not be verified." };
  }
}

export function clearDecibelSpotAmbiguity(
  storage: DecibelSpotStorage,
  expected: DecibelSpotAmbiguityRecord,
) {
  try {
    const normalized = validateDecibelSpotAmbiguityRecord(expected);
    const key = decibelSpotAmbiguityStorageKey(normalized.ownerAddress);
    const raw = storage.getItem(key);
    if (!raw) return false;
    const current = validateDecibelSpotAmbiguityRecord(JSON.parse(raw), normalized.ownerAddress);
    if (JSON.stringify(current) !== JSON.stringify(normalized)) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}
