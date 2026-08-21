import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import { isAptosTransactionHash } from "./cash-orderbook-confirmation";
import { MAINNET_DECIBEL_PACKAGE } from "./decibel-client";

const mainnetAptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const SPOT_ORDER_FUNCTION =
  `${MAINNET_DECIBEL_PACKAGE}::dex_accounts_spot_entry::place_spot_order` as const;
const SPOT_TRADE_EVENT =
  `${MAINNET_DECIBEL_PACKAGE}::spot_clearinghouse::SpotTradeEvent` as const;
const SPOT_PENDING_EVENT =
  `${MAINNET_DECIBEL_PACKAGE}::spot_pending_cbs_queue::SpotOrderPendingCbsEvent` as const;

export type DecibelSpotOrderIdentity = {
  ownerAddress: string;
  marketAddress: string;
  priceAtomic: string;
  sizeAtomic: string;
  isBid: boolean;
};

export type DecibelSpotExecution = {
  sizeAtomic: string;
  quoteAmountAtomic: string;
  baseFeeAtomic: string;
  quoteFeeAtomic: string;
};

export type DecibelSpotPendingOrder = {
  orderId: string;
  withdrawRequestId: string;
  pfsBalanceAtomic: string;
  createdAt: string;
};

export type DecibelSpotParsedEvents =
  | {
      status: "parsed";
      execution: DecibelSpotExecution | null;
      pending: DecibelSpotPendingOrder | null;
    }
  | { status: "malformed"; reason: string };

export type DecibelSpotConfirmation =
  | { status: "filled"; execution: DecibelSpotExecution }
  | { status: "pending"; pending: DecibelSpotPendingOrder }
  | { status: "no-fill" }
  | { status: "failed"; vmStatus: string }
  | { status: "unverified"; reason: string };

type NormalizedIdentity = {
  ownerAddress: string;
  marketAddress: string;
  priceAtomic: bigint;
  sizeAtomic: bigint;
  isBid: boolean;
};

type ParsedTradeEvent = {
  marketAddress: string;
  takerAddress: string;
  isTakerBid: boolean;
  priceAtomic: bigint;
  sizeAtomic: bigint;
  quoteAmountAtomic: bigint;
  baseFeeAtomic: bigint;
  quoteFeeAtomic: bigint;
};

type ParsedPendingEvent = {
  ownerAddress: string;
  marketAddress: string;
  priceAtomic: bigint;
  sizeAtomic: bigint;
  isBid: boolean;
  orderId: bigint;
  withdrawRequestId: bigint;
  pfsBalanceAtomic: bigint;
  createdAt: bigint;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedAddress(value: unknown) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) return "";
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function objectAddress(value: unknown) {
  const direct = normalizedAddress(value);
  if (direct) return direct;
  const record = asRecord(value);
  if (!record || Object.keys(record).length !== 1) return "";
  return normalizedAddress(record.inner);
}

function unsignedInteger(
  value: unknown,
  max: bigint,
  allowZero: boolean,
): bigint | null {
  let text: string;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    text = String(value);
  } else if (typeof value === "string") {
    text = value;
  } else {
    return null;
  }
  if (!UNSIGNED_INTEGER_PATTERN.test(text)) return null;
  const parsed = BigInt(text);
  if (parsed > max || (!allowZero && parsed === 0n)) return null;
  return parsed;
}

function normalizedIdentity(
  expected: DecibelSpotOrderIdentity,
): NormalizedIdentity | null {
  const ownerAddress = normalizedAddress(expected.ownerAddress);
  const marketAddress = normalizedAddress(expected.marketAddress);
  const priceAtomic = unsignedInteger(expected.priceAtomic, U64_MAX, false);
  const sizeAtomic = unsignedInteger(expected.sizeAtomic, U64_MAX, false);
  if (
    !ownerAddress
    || !marketAddress
    || priceAtomic === null
    || sizeAtomic === null
    || typeof expected.isBid !== "boolean"
  ) return null;
  return { ownerAddress, marketAddress, priceAtomic, sizeAtomic, isBid: expected.isBid };
}

function isEmptyMoveOption(value: unknown) {
  const record = asRecord(value);
  return record !== null
    && Object.keys(record).length === 1
    && Array.isArray(record.vec)
    && record.vec.length === 0;
}

function isEventType(value: unknown, expected: string) {
  if (typeof value !== "string") return false;
  const [address, moduleName, eventName, ...extra] = value.split("::");
  const [expectedAddress, expectedModule, expectedEvent] = expected.split("::");
  return extra.length === 0
    && normalizedAddress(address) === normalizedAddress(expectedAddress)
    && moduleName === expectedModule
    && eventName === expectedEvent;
}

/**
 * Aptos REST currently emits Move enum events as direct fields with
 * `__variant__: "V1"`. The SDK and indexers have also used V1/value-style
 * wrappers, so those exact wrappers are accepted without accepting another
 * enum variant.
 */
function v1EventData(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;

  if ("__variant__" in record) {
    if (record.__variant__ !== "V1") return null;
    const wrapped = [record.value, record.fields, record.data]
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    if (wrapped.length > 1) return null;
    return wrapped[0] ?? record;
  }

  if ("V1" in record) {
    return Object.keys(record).length === 1 ? asRecord(record.V1) : null;
  }

  if ("variant" in record) {
    if (record.variant !== "V1") return null;
    const wrapped = [record.value, record.fields, record.data]
      .map(asRecord)
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    return wrapped.length === 1 ? wrapped[0] : null;
  }

  return record;
}

function parseTradeEvent(value: unknown): ParsedTradeEvent | null {
  const data = v1EventData(value);
  if (!data) return null;
  const marketAddress = objectAddress(data.market);
  const takerAddress = normalizedAddress(data.taker);
  const makerAddress = normalizedAddress(data.maker);
  const takerOrderId = unsignedInteger(data.taker_order_id, U128_MAX, true);
  const makerOrderId = unsignedInteger(data.maker_order_id, U128_MAX, true);
  const priceAtomic = unsignedInteger(data.price, U64_MAX, false);
  const sizeAtomic = unsignedInteger(data.size, U64_MAX, false);
  const quoteAmountAtomic = unsignedInteger(data.quote_amount, U64_MAX, false);
  const baseFeeAtomic = unsignedInteger(data.base_fee, U64_MAX, true);
  const quoteFeeAtomic = unsignedInteger(data.quote_fee, U64_MAX, true);
  if (
    !marketAddress
    || !takerAddress
    || !makerAddress
    || takerOrderId === null
    || makerOrderId === null
    || typeof data.is_taker_bid !== "boolean"
    || priceAtomic === null
    || sizeAtomic === null
    || quoteAmountAtomic === null
    || baseFeeAtomic === null
    || quoteFeeAtomic === null
    || baseFeeAtomic > sizeAtomic
    || quoteFeeAtomic > quoteAmountAtomic
  ) return null;
  return {
    marketAddress,
    takerAddress,
    isTakerBid: data.is_taker_bid,
    priceAtomic,
    sizeAtomic,
    quoteAmountAtomic,
    baseFeeAtomic,
    quoteFeeAtomic,
  };
}

function parsePendingEvent(value: unknown): ParsedPendingEvent | null {
  const data = v1EventData(value);
  if (!data) return null;
  const ownerAddress = normalizedAddress(data.subaccount_addr);
  const marketAddress = objectAddress(data.market);
  const metadataAddress = objectAddress(data.metadata);
  const orderId = unsignedInteger(data.order_id, U128_MAX, true);
  const withdrawRequestId = unsignedInteger(data.withdraw_request_id, U128_MAX, true);
  const priceAtomic = unsignedInteger(data.price, U64_MAX, false);
  const sizeAtomic = unsignedInteger(data.orig_size, U64_MAX, false);
  const pfsBalanceAtomic = unsignedInteger(data.pfs_balance, U64_MAX, true);
  const createdAt = unsignedInteger(data.created_at, U64_MAX, false);
  if (
    !ownerAddress
    || !marketAddress
    || !metadataAddress
    || orderId === null
    || withdrawRequestId === null
    || priceAtomic === null
    || sizeAtomic === null
    || typeof data.is_bid !== "boolean"
    || pfsBalanceAtomic === null
    || createdAt === null
  ) return null;
  return {
    ownerAddress,
    marketAddress,
    priceAtomic,
    sizeAtomic,
    isBid: data.is_bid,
    orderId,
    withdrawRequestId,
    pfsBalanceAtomic,
    createdAt,
  };
}

export function isExpectedDecibelSpotTransaction(
  transaction: unknown,
  expected: DecibelSpotOrderIdentity,
) {
  const identity = normalizedIdentity(expected);
  if (!identity) return false;
  const response = transaction as {
    payload?: { arguments?: unknown; function?: unknown; type_arguments?: unknown };
    sender?: unknown;
  };
  if (normalizedAddress(response.sender) !== identity.ownerAddress) return false;

  const [address, moduleName, entryName, ...extra] = String(
    response.payload?.function ?? "",
  ).split("::");
  if (
    extra.length > 0
    || normalizedAddress(address) !== normalizedAddress(MAINNET_DECIBEL_PACKAGE)
    || moduleName !== "dex_accounts_spot_entry"
    || entryName !== "place_spot_order"
  ) return false;

  if (
    !Array.isArray(response.payload?.type_arguments)
    || response.payload.type_arguments.length !== 0
  ) return false;
  const args = response.payload.arguments;
  if (!Array.isArray(args) || args.length !== 7) return false;
  return objectAddress(args[0]) === identity.marketAddress
    && unsignedInteger(args[1], U64_MAX, false) === identity.priceAtomic
    && unsignedInteger(args[2], U64_MAX, false) === identity.sizeAtomic
    && args[3] === identity.isBid
    && args[4] === 2
    && isEmptyMoveOption(args[5])
    && isEmptyMoveOption(args[6]);
}

export function parseDecibelSpotTransactionEvents(
  transaction: unknown,
  expected: DecibelSpotOrderIdentity,
): DecibelSpotParsedEvents {
  const identity = normalizedIdentity(expected);
  if (!identity || !isExpectedDecibelSpotTransaction(transaction, expected)) {
    return { status: "malformed", reason: "Transaction identity did not match the reviewed spot order" };
  }
  const events = (transaction as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return { status: "malformed", reason: "Confirmed transaction did not contain an Aptos event list" };
  }

  let sizeAtomic = 0n;
  let quoteAmountAtomic = 0n;
  let baseFeeAtomic = 0n;
  let quoteFeeAtomic = 0n;
  let fillCount = 0;
  let pending: DecibelSpotPendingOrder | null = null;

  for (const rawEvent of events) {
    const event = asRecord(rawEvent);
    if (!event) continue;

    if (isEventType(event.type, SPOT_TRADE_EVENT)) {
      const trade = parseTradeEvent(event.data);
      if (!trade) {
        return { status: "malformed", reason: "SpotTradeEvent V1 was malformed" };
      }
      if (
        trade.takerAddress !== identity.ownerAddress
        || trade.marketAddress !== identity.marketAddress
        || trade.isTakerBid !== identity.isBid
      ) continue;
      if (
        (identity.isBid && trade.priceAtomic > identity.priceAtomic)
        || (!identity.isBid && trade.priceAtomic < identity.priceAtomic)
      ) {
        return { status: "malformed", reason: "SpotTradeEvent price violated the reviewed limit" };
      }
      sizeAtomic += trade.sizeAtomic;
      quoteAmountAtomic += trade.quoteAmountAtomic;
      baseFeeAtomic += trade.baseFeeAtomic;
      quoteFeeAtomic += trade.quoteFeeAtomic;
      fillCount += 1;
      continue;
    }

    if (isEventType(event.type, SPOT_PENDING_EVENT)) {
      const queued = parsePendingEvent(event.data);
      if (!queued) {
        return { status: "malformed", reason: "SpotOrderPendingCbsEvent V1 was malformed" };
      }
      if (
        queued.ownerAddress !== identity.ownerAddress
        || queued.marketAddress !== identity.marketAddress
        || queued.priceAtomic !== identity.priceAtomic
        || queued.sizeAtomic !== identity.sizeAtomic
        || queued.isBid !== identity.isBid
      ) continue;
      if (pending) {
        return { status: "malformed", reason: "Confirmed spot order contained multiple matching CBS queue events" };
      }
      pending = {
        orderId: queued.orderId.toString(),
        withdrawRequestId: queued.withdrawRequestId.toString(),
        pfsBalanceAtomic: queued.pfsBalanceAtomic.toString(),
        createdAt: queued.createdAt.toString(),
      };
    }
  }

  if (
    sizeAtomic > identity.sizeAtomic
    || quoteAmountAtomic > U64_MAX
    || baseFeeAtomic > U64_MAX
    || quoteFeeAtomic > U64_MAX
  ) {
    return { status: "malformed", reason: "Confirmed spot fill totals exceeded reviewed bounds" };
  }

  return {
    status: "parsed",
    execution: fillCount > 0
      ? {
          sizeAtomic: sizeAtomic.toString(),
          quoteAmountAtomic: quoteAmountAtomic.toString(),
          baseFeeAtomic: baseFeeAtomic.toString(),
          quoteFeeAtomic: quoteFeeAtomic.toString(),
        }
      : null,
    pending,
  };
}

export function classifyDecibelSpotTransaction(
  transaction: unknown,
  expected: DecibelSpotOrderIdentity,
): DecibelSpotConfirmation {
  if (!isExpectedDecibelSpotTransaction(transaction, expected)) {
    return {
      status: "unverified",
      reason: "The confirmed transaction was not this wallet's reviewed Decibel spot IOC order",
    };
  }

  const response = transaction as { success?: unknown; vm_status?: unknown };
  if (response.success === false) {
    return {
      status: "failed",
      vmStatus: typeof response.vm_status === "string" && response.vm_status
        ? response.vm_status
        : "Decibel spot order failed on Aptos",
    };
  }
  if (response.success !== true) {
    return {
      status: "unverified",
      reason: "The confirmed Decibel spot transaction did not include a valid success status",
    };
  }

  const parsed = parseDecibelSpotTransactionEvents(transaction, expected);
  if (parsed.status === "malformed") {
    return { status: "unverified", reason: parsed.reason };
  }
  if (parsed.pending) return { status: "pending", pending: parsed.pending };
  if (parsed.execution) return { status: "filled", execution: parsed.execution };
  return { status: "no-fill" };
}

export async function confirmDecibelSpotTransaction(
  transactionHash: string,
  expected: DecibelSpotOrderIdentity,
): Promise<DecibelSpotConfirmation> {
  if (!isAptosTransactionHash(transactionHash)) {
    throw new Error("Invalid Aptos transaction hash");
  }
  const transaction = await mainnetAptos.waitForTransaction({
    transactionHash,
    options: { checkSuccess: false },
  });
  return classifyDecibelSpotTransaction(transaction, expected);
}

export { SPOT_ORDER_FUNCTION };
