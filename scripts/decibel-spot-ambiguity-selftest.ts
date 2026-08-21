import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AccountAddress,
  ChainId,
  Deserializer,
  EntryFunction,
  EntryFunctionBytes,
  RawTransaction,
  TransactionPayloadEntryFunction,
} from "@aptos-labs/ts-sdk";

import {
  DECIBEL_SPOT_AMBIGUITY_EXPIRATION_GRACE_MS,
  DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION,
  DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX,
  DECIBEL_SPOT_MAINNET_CHAIN_ID,
  DECIBEL_SPOT_REQUESTED_EXPIRATION_SECONDS,
  classifyDecibelSpotAmbiguityRecovery,
  clearDecibelSpotAmbiguity,
  createDecibelSpotAmbiguityRecord,
  decibelSpotAmbiguityStorageKey,
  decibelSpotQuarantineStorageKey,
  decibelSpotWalletLockName,
  loadDecibelSpotAmbiguity,
  makeDecibelSpotExactOrderIdentity,
  normalizeDecibelSpotOwnerKey,
  persistDecibelSpotAmbiguity,
  quarantineDecibelSpotStorageEntry,
  validateDecibelSpotAccountObservation,
  validateDecibelSpotAmbiguityRecord,
  validateDecibelSpotAmbiguityRecovery,
  validateSignedDecibelSpotRawTransaction,
  type DecibelSpotAccountObservation,
  type DecibelSpotStorage,
} from "../lib/decibel-spot-ambiguity";
import { DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION } from "../lib/decibel-spot";
import type { DecibelSpotOrderIdentity } from "../lib/decibel-spot-confirmation";
import {
  hasCashWalletOperationEvidence,
  hasDecibelSpotWalletOperationEvidence,
} from "../lib/wallet-operation-guard";

const NOW_MS = 1_787_041_200_000;
const OWNER = "0xbeef";
const NORMALIZED_OWNER = `0x${"0".repeat(60)}beef`;
const MARKET = "0x8bdea2abfe7bd637079b5c678ce682d7334e89cb8eae24d97cf9e37bd84c8628";
const HASH = `0x${"ab".repeat(32)}`;

const identity: DecibelSpotOrderIdentity = {
  ownerAddress: OWNER,
  marketAddress: MARKET,
  priceAtomic: "529000",
  sizeAtomic: "1000000000",
  isBid: true,
};

const observation = validateDecibelSpotAccountObservation({
  account: { sequence_number: "17", authentication_key: NORMALIZED_OWNER },
  chainId: "1",
  ledgerVersion: "6803125791",
  ledgerTimestampUsec: `${NOW_MS}000`,
  nowMs: NOW_MS,
});

assert.deepEqual(observation, {
  chainId: 1,
  sequenceNumber: "17",
  ledgerVersion: "6803125791",
  ledgerTimestampUsec: `${NOW_MS}000`,
  ledgerTimestampMs: NOW_MS,
});
assert.throws(
  () => validateDecibelSpotAccountObservation({
    account: { sequence_number: "17" },
    chainId: "2",
    ledgerVersion: "1",
    ledgerTimestampUsec: `${NOW_MS}000`,
    nowMs: NOW_MS,
  }),
  /mainnet/,
);
assert.throws(
  () => validateDecibelSpotAccountObservation({
    account: { sequence_number: "17" },
    chainId: "1",
    ledgerVersion: "1",
    ledgerTimestampUsec: `${NOW_MS - 31_000}000`,
    nowMs: NOW_MS,
  }),
  /stale/,
);

const ambiguity = createDecibelSpotAmbiguityRecord({ identity, observation });
assert.equal(ambiguity.schemaVersion, DECIBEL_SPOT_AMBIGUITY_SCHEMA_VERSION);
assert.equal(ambiguity.chainId, DECIBEL_SPOT_MAINNET_CHAIN_ID);
assert.equal(ambiguity.ownerAddress, NORMALIZED_OWNER);
assert.equal(ambiguity.identity.ownerAddress, NORMALIZED_OWNER);
assert.equal(ambiguity.identity.entryFunction, DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION);
assert.equal(ambiguity.identity.timeInForce, 2);
assert.equal(ambiguity.identity.builderCode, null);
assert.equal(ambiguity.identity.builderFee, null);
assert.equal(ambiguity.preSignSequenceNumber, "17");
assert.equal(ambiguity.createdAt, NOW_MS);
assert.equal(
  ambiguity.requestedExpirationTimestampSecs,
  Math.floor(NOW_MS / 1_000) + DECIBEL_SPOT_REQUESTED_EXPIRATION_SECONDS,
);
assert.equal(
  ambiguity.retrySafeAfterMs,
  ambiguity.requestedExpirationTimestampSecs * 1_000
    + DECIBEL_SPOT_AMBIGUITY_EXPIRATION_GRACE_MS,
);

for (const mutation of [
  (value: Record<string, unknown>) => { value.chainId = 2; },
  (value: Record<string, unknown>) => { value.ownerAddress = "0xdead"; },
  (value: Record<string, unknown>) => { value.preSignSequenceNumber = "017"; },
  (value: Record<string, unknown>) => { value.createdAt = NOW_MS + 1; },
  (value: Record<string, unknown>) => { value.retrySafeAfterMs = NOW_MS; },
  (value: Record<string, unknown>) => { value.extra = true; },
] as const) {
  const malformed = structuredClone(ambiguity) as unknown as Record<string, unknown>;
  mutation(malformed);
  assert.throws(() => validateDecibelSpotAmbiguityRecord(malformed));
}

for (const mutation of [
  (value: Record<string, unknown>) => { value.entryFunction = "0x1::coin::transfer"; },
  (value: Record<string, unknown>) => { value.timeInForce = 0; },
  (value: Record<string, unknown>) => { value.builderCode = OWNER; },
  (value: Record<string, unknown>) => { value.builderFee = "10"; },
  (value: Record<string, unknown>) => { value.priceAtomic = "529001"; },
  (value: Record<string, unknown>) => { value.sizeAtomic = "999999999"; },
] as const) {
  const malformed = structuredClone(ambiguity);
  mutation(malformed.identity as unknown as Record<string, unknown>);
  assert.throws(() => validateDecibelSpotAmbiguityRecord(malformed));
}

const reviewedTransaction = {
  type: "user_transaction",
  hash: HASH,
  version: "6803125792",
  success: true,
  sender: OWNER,
  sequence_number: "17",
  payload: {
    type: "entry_function_payload",
    function: DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION,
    type_arguments: [],
    arguments: [
      { inner: MARKET },
      identity.priceAtomic,
      identity.sizeAtomic,
      identity.isBid,
      2,
      { vec: [] },
      { vec: [] },
    ],
  },
};

function atChainTime(ledgerTimestampMs: number, sequenceNumber = "17"): DecibelSpotAccountObservation {
  return {
    ...observation,
    sequenceNumber,
    ledgerVersion: "6803125793",
    ledgerTimestampMs,
    ledgerTimestampUsec: `${ledgerTimestampMs}000`,
  };
}

const submitted = classifyDecibelSpotAmbiguityRecovery({
  ambiguity,
  observation: atChainTime(NOW_MS + 1_000, "18"),
  candidateTransaction: reviewedTransaction,
});
assert.deepEqual(submitted, { status: "submitted", hash: HASH, sequenceNumber: "17" });
assert.deepEqual(validateDecibelSpotAmbiguityRecovery(submitted, ambiguity), submitted);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: { ...reviewedTransaction, version: ambiguity.preSignLedgerVersion },
  }),
  {
    status: "blocked",
    reason: "upstream-transaction-mismatch",
    sequenceNumber: "18",
  },
  "a candidate at or before the pre-sign watermark cannot prove consumption",
);

const sequenceConsumed = classifyDecibelSpotAmbiguityRecovery({
  ambiguity,
  observation: atChainTime(NOW_MS + 1_000, "18"),
  candidateTransaction: {
    ...reviewedTransaction,
    hash: `0x${"cd".repeat(32)}`,
    payload: { ...reviewedTransaction.payload, arguments: [{ inner: MARKET }, "530000", "1000000000", true, 2, { vec: [] }, { vec: [] }] },
  },
});
assert.deepEqual(sequenceConsumed, {
  status: "safe-to-retry",
  reason: "sequence-consumed",
  sequenceNumber: "17",
});

const stillBlocked = classifyDecibelSpotAmbiguityRecovery({
  ambiguity,
  observation: atChainTime(ambiguity.retrySafeAfterMs - 1),
  candidateTransaction: null,
});
assert.deepEqual(stillBlocked, {
  status: "blocked",
  reason: "sequence-unchanged",
  sequenceNumber: "17",
  retryAfterMs: 1,
});
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(ambiguity.retrySafeAfterMs),
    candidateTransaction: null,
  }),
  {
    status: "safe-to-retry",
    reason: "expiration-grace-elapsed",
    sequenceNumber: "17",
  },
);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: {
      type: "user_transaction",
      sender: OWNER,
      sequence_number: "17",
    },
  }),
  {
    status: "blocked",
    reason: "upstream-transaction-mismatch",
    sequenceNumber: "18",
  },
  "a malformed candidate must never prove that a sequence was consumed",
);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: { ...reviewedTransaction, payload: {} },
  }),
  {
    status: "blocked",
    reason: "upstream-transaction-mismatch",
    sequenceNumber: "18",
  },
  "an unrecognized payload shape must not be used as proof of a different transaction",
);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: null,
  }),
  {
    status: "blocked",
    reason: "committed-transaction-proof-missing",
    sequenceNumber: "18",
  },
);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation: atChainTime(NOW_MS + 1_000, "16"),
    candidateTransaction: null,
  }),
  {
    status: "blocked",
    reason: "account-state-regressed",
    sequenceNumber: "16",
  },
);
assert.deepEqual(
  classifyDecibelSpotAmbiguityRecovery({
    ambiguity,
    observation,
    candidateTransaction: { ...reviewedTransaction, sequence_number: "18" },
  }),
  {
    status: "blocked",
    reason: "upstream-transaction-mismatch",
    sequenceNumber: "17",
  },
);
assert.throws(
  () => validateDecibelSpotAmbiguityRecovery(
    { status: "safe-to-retry", reason: "sequence-consumed", sequenceNumber: "18" },
    ambiguity,
  ),
  /another sequence/,
);

function u64Bytes(value: string) {
  let remaining = BigInt(value);
  return Uint8Array.from({ length: 8 }, () => {
    const byte = Number(remaining & 0xffn);
    remaining >>= 8n;
    return byte;
  });
}

function argument(bytes: Uint8Array) {
  return EntryFunctionBytes.deserialize(new Deserializer(bytes), bytes.length);
}

function signedRaw(overrides: {
  sequence?: bigint;
  expiration?: bigint;
  maxGasAmount?: bigint;
  gasUnitPrice?: bigint;
  marketBytes?: Uint8Array;
} = {}) {
  const [packageAddress, moduleName, functionName] = DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION.split("::");
  const marketBytes = overrides.marketBytes
    ?? Uint8Array.from(MARKET.slice(2).match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  const entry = EntryFunction.build(
    `${packageAddress}::${moduleName}`,
    functionName,
    [],
    [
      argument(marketBytes),
      argument(u64Bytes(identity.priceAtomic)),
      argument(u64Bytes(identity.sizeAtomic)),
      argument(Uint8Array.of(1)),
      argument(Uint8Array.of(2)),
      argument(Uint8Array.of(0)),
      argument(Uint8Array.of(0)),
    ],
  );
  return new RawTransaction(
    AccountAddress.fromString(NORMALIZED_OWNER),
    overrides.sequence ?? 17n,
    new TransactionPayloadEntryFunction(entry),
    overrides.maxGasAmount ?? 200_000n,
    overrides.gasUnitPrice ?? 100n,
    overrides.expiration ?? BigInt(ambiguity.requestedExpirationTimestampSecs),
    new ChainId(1),
  );
}

assert.equal(validateSignedDecibelSpotRawTransaction(signedRaw(), ambiguity).sequence_number, 17n);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(signedRaw({ sequence: 18n }), ambiguity),
  /sequence/,
);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(signedRaw({ expiration: 1n }), ambiguity),
  /expiration/,
);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(signedRaw({ maxGasAmount: 2_000_001n }), ambiguity),
  /gas limit/,
);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(signedRaw({ gasUnitPrice: 10_001n }), ambiguity),
  /gas limit/,
);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(
    signedRaw({ maxGasAmount: 1_000_000n, gasUnitPrice: 51n }),
    ambiguity,
  ),
  /gas limit/,
);
assert.throws(
  () => validateSignedDecibelSpotRawTransaction(
    signedRaw({ marketBytes: Uint8Array.from({ length: 32 }, () => 1) }),
    ambiguity,
  ),
  /arguments/,
);

class MemoryStorage implements DecibelSpotStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
assert.equal(normalizeDecibelSpotOwnerKey(OWNER), NORMALIZED_OWNER);
assert.equal(
  decibelSpotWalletLockName(OWNER),
  decibelSpotWalletLockName(NORMALIZED_OWNER),
  "short and long addresses must share one wallet lock",
);
assert.equal(persistDecibelSpotAmbiguity(storage, ambiguity), true);
assert.equal(
  storage.values.has(decibelSpotAmbiguityStorageKey(NORMALIZED_OWNER)),
  true,
  "ambiguity storage keys must use the normalized long address",
);
assert.deepEqual(loadDecibelSpotAmbiguity(storage, OWNER), { status: "valid", record: ambiguity });
assert.equal(clearDecibelSpotAmbiguity(storage, ambiguity), true);
assert.deepEqual(loadDecibelSpotAmbiguity(storage, OWNER), { status: "none" });
assert.equal(clearDecibelSpotAmbiguity(storage, ambiguity), false, "clearing is compare-and-delete, not blind deletion");

const malformedKey = decibelSpotAmbiguityStorageKey(OWNER);
storage.setItem(malformedKey, JSON.stringify({ ...ambiguity, chainId: 2 }));
const malformedLoad = loadDecibelSpotAmbiguity(storage, OWNER);
assert.equal(malformedLoad.status, "quarantined");
assert.equal(storage.getItem(malformedKey), null, "malformed active evidence must leave the active slot");
assert.notEqual(storage.getItem(decibelSpotQuarantineStorageKey(OWNER)), null, "malformed evidence must be preserved in quarantine first");

const failedStorage = new MemoryStorage();
const malformedPendingKey = "cash:decibel-spot-pending:v2:bad";
failedStorage.setItem(malformedPendingKey, "bad pending");
failedStorage.failWrites = true;
assert.equal(quarantineDecibelSpotStorageEntry({
  storage: failedStorage,
  owner: OWNER,
  sourceKey: malformedPendingKey,
  raw: "bad pending",
  reason: "test",
}), false);
assert.equal(
  failedStorage.getItem(malformedPendingKey),
  "bad pending",
  "a failed quarantine write must leave the source evidence in place",
);

class ConcurrentReplacementStorage extends MemoryStorage {
  constructor(
    private readonly sourceKey: string,
    private readonly quarantineKey: string,
    private readonly replacement: string,
  ) {
    super();
  }

  override setItem(key: string, value: string) {
    super.setItem(key, value);
    if (key === this.quarantineKey) this.values.set(this.sourceKey, this.replacement);
  }
}

const concurrentSourceKey = decibelSpotAmbiguityStorageKey(OWNER);
const concurrentReplacement = JSON.stringify(ambiguity);
const concurrentStorage = new ConcurrentReplacementStorage(
  concurrentSourceKey,
  decibelSpotQuarantineStorageKey(OWNER),
  concurrentReplacement,
);
concurrentStorage.setItem(concurrentSourceKey, "old malformed evidence");
assert.equal(quarantineDecibelSpotStorageEntry({
  storage: concurrentStorage,
  owner: OWNER,
  sourceKey: concurrentSourceKey,
  raw: "old malformed evidence",
  reason: "test concurrent replacement",
}), false);
assert.equal(
  concurrentStorage.getItem(concurrentSourceKey),
  concurrentReplacement,
  "quarantine must not delete a newer record written by another tab",
);
assert.notEqual(
  concurrentStorage.getItem(decibelSpotQuarantineStorageKey(OWNER)),
  null,
  "the captured old evidence must still be preserved in quarantine",
);

const legacyStorage = new MemoryStorage();
const legacyKey = `${DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${NORMALIZED_OWNER}`;
legacyStorage.setItem(legacyKey, JSON.stringify({ owner: OWNER, marketAddress: MARKET, createdAt: NOW_MS }));
assert.equal(loadDecibelSpotAmbiguity(legacyStorage, OWNER).status, "quarantined");
assert.equal(legacyStorage.getItem(legacyKey), null);
assert.notEqual(legacyStorage.getItem(decibelSpotQuarantineStorageKey(OWNER)), null);

const crossVenueStorage = new MemoryStorage();
assert.equal(hasCashWalletOperationEvidence(crossVenueStorage, OWNER), false);
assert.equal(hasDecibelSpotWalletOperationEvidence(crossVenueStorage, OWNER), false);
crossVenueStorage.setItem(`cash:pending-spot-swap:v1:${NORMALIZED_OWNER}`, "pending");
assert.equal(hasCashWalletOperationEvidence(crossVenueStorage, OWNER), true);
crossVenueStorage.values.clear();
crossVenueStorage.setItem(`cash:decibel-spot-pending:v2:${NORMALIZED_OWNER}`, "pending");
assert.equal(hasDecibelSpotWalletOperationEvidence(crossVenueStorage, OWNER), true);

class UnreadableStorage implements DecibelSpotStorage {
  getItem(_key: string): string | null { throw new Error("storage unavailable"); }
  setItem(_key: string, _value: string): void { throw new Error("storage unavailable"); }
  removeItem(_key: string): void { throw new Error("storage unavailable"); }
}
assert.equal(hasCashWalletOperationEvidence(new UnreadableStorage(), OWNER), true);
assert.equal(hasDecibelSpotWalletOperationEvidence(new UnreadableStorage(), OWNER), true);

assert.deepEqual(
  makeDecibelSpotExactOrderIdentity(identity),
  ambiguity.identity,
  "the durable identity must include every fixed entry-function argument",
);

const routeSource = readFileSync("app/api/decibel/spot/recovery/route.ts", "utf8");
assert.match(routeSource, /Cache-Control.*no-store/);
assert.match(routeSource, /accounts\/\$\{encodeURIComponent\(args\.ownerAddress\)\}/);
assert.match(routeSource, /transactions\?start=\$\{encodeURIComponent\(args\.sequenceNumber\)\}&limit=1/);
assert.match(routeSource, /classifyDecibelSpotAmbiguityRecovery/);
assert.match(routeSource, /DECIBEL_NETWORK === "mainnet"/);

const componentSource = readFileSync("components/trade/DecibelSpotSwap.tsx", "utf8");
assert.match(componentSource, /let submissionAttempted = false;/);
assert.match(componentSource, /submissionAttempted = true;\s*const response = await submitTransaction/);
assert.match(componentSource, /if \(!submissionAttempted && wasRejectedByWallet\(error\)\)/);

console.log("Decibel spot ambiguity self-test passed");
