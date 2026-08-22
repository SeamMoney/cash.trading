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
  parseTypeTag,
} from "@aptos-labs/ts-sdk";

import {
  CASH_LEGACY_COIN_TYPE,
  CASH_METADATA_ADDRESS,
  USDC_METADATA_ADDRESS,
} from "../lib/cash-orderbook";
import {
  CASH_AMBIGUITY_EXPIRATION_GRACE_MS,
  CASH_AMBIGUITY_REQUESTED_EXPIRATION_SECONDS,
  CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX,
  cashAmbiguityQuarantineStorageKey,
  cashAmbiguityStorageKey,
  cashWalletLockName,
  classifyCashAmbiguityRecovery,
  clearCashAmbiguity,
  createCashAmbiguityRecord,
  loadCashAmbiguity,
  makeCashMigrationAmbiguityIdentity,
  makeCashSwapAmbiguityIdentity,
  normalizeCashAmbiguityOwner,
  persistCashAmbiguity,
  validateCashAccountObservation,
  validateCashAmbiguityRecord,
  validateCashAmbiguityRecovery,
  validateSignedCashRawTransaction,
  type CashAccountObservation,
  type CashAmbiguityRecord,
  type CashAmbiguityStorage,
  type CashSwapAmbiguityIdentity,
} from "../lib/cash-orderbook-ambiguity";

const OWNER = "0xbeef";
const NORMALIZED_OWNER = normalizeCashAmbiguityOwner(OWNER);
const CONTRACT = "0xcafe";
const NORMALIZED_CONTRACT = normalizeCashAmbiguityOwner(CONTRACT);
const NOW_MS = 1_787_030_000_000;
const HASH = `0x${"ab".repeat(32)}`;

const observation = validateCashAccountObservation({
  account: { sequence_number: "17" },
  chainId: "1",
  ledgerVersion: "500",
  ledgerTimestampUsec: String(BigInt(NOW_MS) * 1_000n),
  nowMs: NOW_MS,
});

const buyIdentity = makeCashSwapAmbiguityIdentity({
  ownerAddress: OWNER,
  direction: "buy",
  contractAddress: CONTRACT,
  cashAmountAtomic: "1912000000000",
  expectedQuoteAmountAtomic: "24989840",
  maximumQuoteAmountAtomic: "25000000",
  minimumOutputAmountAtomic: "1912000000000",
});
const sellIdentity = makeCashSwapAmbiguityIdentity({
  ownerAddress: OWNER,
  direction: "sell",
  contractAddress: CONTRACT,
  cashAmountAtomic: "10000000000",
  expectedQuoteAmountAtomic: "129300",
  maximumQuoteAmountAtomic: null,
  minimumOutputAmountAtomic: "128653",
});
const migrationIdentity = makeCashMigrationAmbiguityIdentity(OWNER);

assert.equal(buyIdentity.ownerAddress, NORMALIZED_OWNER);
assert.equal(buyIdentity.contractAddress, NORMALIZED_CONTRACT);
assert.equal(buyIdentity.entryFunction, `${NORMALIZED_CONTRACT}::order_placement::buy_from_wallet`);
assert.throws(
  () => makeCashSwapAmbiguityIdentity({
    ownerAddress: OWNER,
    direction: "buy",
    contractAddress: CONTRACT,
    cashAmountAtomic: "10000000000",
    expectedQuoteAmountAtomic: "101",
    maximumQuoteAmountAtomic: "100",
    minimumOutputAmountAtomic: "10000000000",
  }),
  /0\.5% limit/,
  "expected buy spend must not exceed the signed cap",
);
assert.throws(
  () => makeCashSwapAmbiguityIdentity({
    ownerAddress: OWNER,
    direction: "buy",
    contractAddress: CONTRACT,
    cashAmountAtomic: "10000000000",
    expectedQuoteAmountAtomic: "130700",
    maximumQuoteAmountAtomic: "131355",
    minimumOutputAmountAtomic: "10000000000",
  }),
  /0\.5% limit/,
  "buy cap must never exceed the reviewed 0.5% ceiling",
);
assert.throws(
  () => makeCashSwapAmbiguityIdentity({
    ownerAddress: OWNER,
    direction: "buy",
    contractAddress: CONTRACT,
    cashAmountAtomic: "10000000000",
    expectedQuoteAmountAtomic: "130700",
    maximumQuoteAmountAtomic: "131354",
    minimumOutputAmountAtomic: "9999999000",
  }),
  /0\.5% limit/,
  "buy minimum output must preserve the full reviewed lot quantity",
);
assert.throws(
  () => makeCashSwapAmbiguityIdentity({
    ownerAddress: OWNER,
    direction: "sell",
    contractAddress: CONTRACT,
    cashAmountAtomic: "10000000000",
    expectedQuoteAmountAtomic: "129300",
    maximumQuoteAmountAtomic: null,
    minimumOutputAmountAtomic: "128652",
  }),
  /0\.5% limit/,
  "sell minimum output must stay within the reviewed 0.5% floor",
);
assert.throws(
  () => makeCashSwapAmbiguityIdentity({
    ownerAddress: OWNER,
    direction: "sell",
    contractAddress: CONTRACT,
    cashAmountAtomic: "10000000001",
    expectedQuoteAmountAtomic: "129300",
    maximumQuoteAmountAtomic: null,
    minimumOutputAmountAtomic: "128653",
  }),
  /aligned/,
  "CASH economics must remain lot-aligned",
);

function ambiguityFor(identity: typeof buyIdentity | typeof sellIdentity | typeof migrationIdentity) {
  return createCashAmbiguityRecord({ identity, observation });
}

const buyAmbiguity = ambiguityFor(buyIdentity);
const sellAmbiguity = ambiguityFor(sellIdentity);
const migrationAmbiguity = ambiguityFor(migrationIdentity);
assert.equal(
  buyAmbiguity.requestedExpirationTimestampSecs,
  Math.floor(NOW_MS / 1_000) + CASH_AMBIGUITY_REQUESTED_EXPIRATION_SECONDS,
);
assert.equal(
  buyAmbiguity.retrySafeAfterMs,
  buyAmbiguity.requestedExpirationTimestampSecs * 1_000 + CASH_AMBIGUITY_EXPIRATION_GRACE_MS,
);
assert.deepEqual(validateCashAmbiguityRecord(buyAmbiguity, OWNER), buyAmbiguity);
assert.throws(
  () => validateCashAmbiguityRecord({ ...buyAmbiguity, ownerAddress: "0xdead" }),
  /owner/,
);

function restPayload(identity: CashSwapAmbiguityIdentity) {
  return {
    type: "entry_function_payload",
    function: identity.entryFunction,
    type_arguments: [],
    arguments: identity.direction === "buy"
      ? [
          "0",
          USDC_METADATA_ADDRESS,
          CASH_METADATA_ADDRESS,
          identity.maximumQuoteAmountAtomic,
          identity.cashAmountAtomic,
          identity.minimumOutputAmountAtomic,
        ]
      : [
          "0",
          USDC_METADATA_ADDRESS,
          CASH_METADATA_ADDRESS,
          identity.cashAmountAtomic,
          identity.minimumOutputAmountAtomic,
        ],
  };
}

function candidateFor(ambiguity: CashAmbiguityRecord) {
  const identity = ambiguity.identity;
  return {
    type: "user_transaction",
    hash: HASH,
    sender: OWNER,
    sequence_number: ambiguity.preSignSequenceNumber,
    version: "501",
    success: true,
    expiration_timestamp_secs: String(ambiguity.requestedExpirationTimestampSecs),
    payload: identity.operation === "swap"
      ? restPayload(identity)
      : {
          type: "entry_function_payload",
          function: "0x1::coin::migrate_to_fungible_store",
          type_arguments: [CASH_LEGACY_COIN_TYPE],
          arguments: [],
        },
  };
}

function atChainTime(
  ledgerTimestampMs: number,
  sequenceNumber = "18",
  ledgerVersion = "502",
): CashAccountObservation {
  return {
    chainId: 1,
    sequenceNumber,
    ledgerVersion,
    ledgerTimestampUsec: String(BigInt(ledgerTimestampMs) * 1_000n),
    ledgerTimestampMs,
  };
}

for (const ambiguity of [buyAmbiguity, sellAmbiguity, migrationAmbiguity]) {
  assert.deepEqual(
    classifyCashAmbiguityRecovery({
      ambiguity,
      observation: atChainTime(NOW_MS + 1_000),
      candidateTransaction: candidateFor(ambiguity),
    }),
    { status: "submitted", hash: HASH, sequenceNumber: "17" },
    `${ambiguity.identity.operation} must recover only its exact transaction hash`,
  );
}
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: { ...candidateFor(buyAmbiguity), success: false },
  }),
  { status: "submitted", hash: HASH, sequenceNumber: "17" },
  "an exact failed transaction must be adopted for terminal confirmation before unlocking",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000, "18"),
    candidateTransaction: {
      ...candidateFor(buyAmbiguity),
      expiration_timestamp_secs: String(buyAmbiguity.requestedExpirationTimestampSecs + 1),
    },
  }),
  { status: "submitted", hash: HASH, sequenceNumber: "17" },
  "matching owner and economics must be adopted even if a wallet broadcast a mutated expiration",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000, "17"),
    candidateTransaction: candidateFor(buyAmbiguity),
  }),
  { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: "17" },
  "a candidate is not adopted until the later account watermark contains its consumed sequence",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS - 1, "18"),
    candidateTransaction: candidateFor(buyAmbiguity),
  }),
  { status: "blocked", reason: "account-state-regressed", sequenceNumber: "18" },
  "a regressed chain timestamp must block even when a candidate otherwise matches",
);

assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000),
    candidateTransaction: {
      ...candidateFor(buyAmbiguity),
      payload: restPayload(sellIdentity),
    },
  }),
  { status: "safe-to-retry", reason: "sequence-consumed", sequenceNumber: "17" },
  "a proven different transaction at the reserved sequence releases the guard",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000),
    candidateTransaction: {
      ...candidateFor(buyAmbiguity),
      payload: {
        ...restPayload(buyIdentity),
        arguments: [...restPayload(buyIdentity).arguments.slice(0, 5), "1904000000000"],
      },
    },
  }),
  { status: "safe-to-retry", reason: "sequence-consumed", sequenceNumber: "17" },
  "near-matching economics must never be adopted as the reviewed swap",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000),
    candidateTransaction: { ...candidateFor(buyAmbiguity), hash: "0x1234" },
  }),
  { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: "18" },
  "non-canonical hashes cannot prove sequence consumption",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000),
    candidateTransaction: { ...candidateFor(buyAmbiguity), payload: {} },
  }),
  { status: "blocked", reason: "upstream-transaction-mismatch", sequenceNumber: "18" },
  "malformed candidates cannot release the guard",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000),
    candidateTransaction: null,
  }),
  { status: "blocked", reason: "committed-transaction-proof-missing", sequenceNumber: "18" },
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS + 1_000, "17"),
    candidateTransaction: null,
  }),
  {
    status: "blocked",
    reason: "sequence-unchanged",
    sequenceNumber: "17",
    retryAfterMs: buyAmbiguity.retrySafeAfterMs - (NOW_MS + 1_000),
  },
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(buyAmbiguity.retrySafeAfterMs, "17"),
    candidateTransaction: null,
  }),
  { status: "safe-to-retry", reason: "expiration-grace-elapsed", sequenceNumber: "17" },
  "an unchanged sequence releases only after the exact expiration and grace window",
);
assert.deepEqual(
  classifyCashAmbiguityRecovery({
    ambiguity: buyAmbiguity,
    observation: atChainTime(NOW_MS - 1_000, "16", "499"),
    candidateTransaction: null,
  }),
  { status: "blocked", reason: "account-state-regressed", sequenceNumber: "16" },
);
assert.throws(
  () => validateCashAmbiguityRecovery(
    { status: "submitted", hash: HASH, sequenceNumber: "18" },
    buyAmbiguity,
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

function addressBytes(value: string) {
  const normalized = normalizeCashAmbiguityOwner(value).slice(2);
  return Uint8Array.from(normalized.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function argument(bytes: Uint8Array) {
  return EntryFunctionBytes.deserialize(new Deserializer(bytes), bytes.length);
}

function rawFor(
  ambiguity: CashAmbiguityRecord,
  overrides: {
    sequence?: bigint;
    expiration?: bigint;
    lastArgument?: string;
    maxGasAmount?: bigint;
    gasUnitPrice?: bigint;
    migrationArgument?: boolean;
  } = {},
) {
  const identity = ambiguity.identity;
  const [packageAddress, moduleName, functionName] = identity.entryFunction.split("::");
  const typeArguments = identity.operation === "migration" ? [parseTypeTag(identity.legacyCoinType)] : [];
  let args: EntryFunctionBytes[] = overrides.migrationArgument ? [argument(u64Bytes("1"))] : [];
  if (identity.operation === "swap") {
    const last = overrides.lastArgument ?? identity.minimumOutputAmountAtomic;
    args = identity.direction === "buy"
      ? [
          argument(u64Bytes("0")),
          argument(addressBytes(identity.quoteMetadataAddress)),
          argument(addressBytes(identity.baseMetadataAddress)),
          argument(u64Bytes(identity.maximumQuoteAmountAtomic!)),
          argument(u64Bytes(identity.cashAmountAtomic)),
          argument(u64Bytes(last)),
        ]
      : [
          argument(u64Bytes("0")),
          argument(addressBytes(identity.quoteMetadataAddress)),
          argument(addressBytes(identity.baseMetadataAddress)),
          argument(u64Bytes(identity.cashAmountAtomic)),
          argument(u64Bytes(last)),
        ];
  }
  const entry = EntryFunction.build(`${packageAddress}::${moduleName}`, functionName, typeArguments, args);
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

for (const ambiguity of [buyAmbiguity, sellAmbiguity, migrationAmbiguity]) {
  assert.equal(validateSignedCashRawTransaction(rawFor(ambiguity), ambiguity).sequence_number, 17n);
}
assert.throws(
  () => validateSignedCashRawTransaction(rawFor(buyAmbiguity, { sequence: 18n }), buyAmbiguity),
  /sequence/,
);
assert.throws(
  () => validateSignedCashRawTransaction(rawFor(buyAmbiguity, { expiration: 1n }), buyAmbiguity),
  /expiration/,
);
assert.throws(
  () => validateSignedCashRawTransaction(rawFor(sellAmbiguity, { lastArgument: "128654" }), sellAmbiguity),
  /economics/,
);
assert.throws(
  () => validateSignedCashRawTransaction(
    rawFor(buyAmbiguity, { maxGasAmount: 2_000_000n, gasUnitPrice: 100n }),
    buyAmbiguity,
  ),
  /gas limit/,
  "a wallet-supplied theoretical gas charge above the cap must not be submitted",
);
assert.throws(
  () => validateSignedCashRawTransaction(
    rawFor(migrationAmbiguity, { migrationArgument: true }),
    migrationAmbiguity,
  ),
  /migration/,
  "legacy migration must remain a zero-argument transaction",
);

class MemoryStorage implements CashAmbiguityStorage {
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
assert.equal(cashWalletLockName(OWNER), cashWalletLockName(NORMALIZED_OWNER));
assert.equal(persistCashAmbiguity(storage, buyAmbiguity), true);
assert.equal(storage.values.has(cashAmbiguityStorageKey(OWNER)), true);
assert.deepEqual(loadCashAmbiguity(storage, OWNER), { status: "valid", record: buyAmbiguity });

const replacement = sellAmbiguity;
storage.setItem(cashAmbiguityStorageKey(OWNER), JSON.stringify(replacement));
assert.equal(
  clearCashAmbiguity(storage, buyAmbiguity),
  false,
  "compare-and-delete must preserve a newer cross-tab operation",
);
assert.deepEqual(loadCashAmbiguity(storage, OWNER), { status: "valid", record: replacement });
assert.equal(clearCashAmbiguity(storage, replacement), true);

storage.setItem(cashAmbiguityStorageKey(OWNER), JSON.stringify({ ...buyAmbiguity, chainId: 2 }));
const malformed = loadCashAmbiguity(storage, OWNER);
assert.equal(malformed.status, "quarantined");
assert.equal(storage.getItem(cashAmbiguityStorageKey(OWNER)), null);
assert.notEqual(storage.getItem(cashAmbiguityQuarantineStorageKey(OWNER)), null);

const legacyStorage = new MemoryStorage();
legacyStorage.setItem(
  `${CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${OWNER}:swap`,
  JSON.stringify({ owner: OWNER, operation: "swap", createdAt: NOW_MS }),
);
assert.equal(loadCashAmbiguity(legacyStorage, OWNER).status, "quarantined");
assert.notEqual(legacyStorage.getItem(cashAmbiguityQuarantineStorageKey(OWNER)), null);

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

const racedSourceKey = cashAmbiguityStorageKey(OWNER);
const racedQuarantineKey = cashAmbiguityQuarantineStorageKey(OWNER);
const racedReplacement = JSON.stringify(sellAmbiguity);
const racedStorage = new ConcurrentReplacementStorage(
  racedSourceKey,
  racedQuarantineKey,
  racedReplacement,
);
racedStorage.setItem(racedSourceKey, "malformed");
assert.equal(loadCashAmbiguity(racedStorage, OWNER).status, "quarantined");
assert.equal(
  racedStorage.getItem(racedSourceKey),
  racedReplacement,
  "quarantine must not delete a cross-tab replacement written during compare-and-remove",
);

const routeSource = readFileSync("app/api/cash-orderbook/recovery/route.ts", "utf8");
assert.match(routeSource, /Cache-Control.*no-store/);
assert.match(routeSource, /accounts\/\$\{encodeURIComponent\(args\.ownerAddress\)\}/);
assert.match(routeSource, /transactions\?start=\$\{encodeURIComponent\(args\.sequenceNumber\)\}&limit=1/);
assert.match(routeSource, /classifyCashAmbiguityRecovery/);
assert.match(routeSource, /DECIBEL_NETWORK === "mainnet"/);
assert.ok(
  routeSource.indexOf("const candidateTransaction = await fetchCandidateTransaction")
    < routeSource.indexOf("const observation = await fetchAccountObservation", routeSource.indexOf("const candidateTransaction")),
  "the route must fetch the candidate before the later account watermark",
);

const swapSource = readFileSync("components/trade/CashSpotSwap.tsx", "utf8");
assert.doesNotMatch(swapSource, /I checked wallet activity|acknowledgeWalletAmbiguity/);
assert.match(swapSource, /expireTimestamp: ambiguity\.requestedExpirationTimestampSecs/);
assert.match(swapSource, /expirationTimestamp: ambiguity\.requestedExpirationTimestampSecs/);
assert.match(swapSource, /validateSignedCashRawTransaction/);
assert.match(swapSource, /generateUserTransactionHash/);

console.log("CASH wallet ambiguity recovery checks passed.");
