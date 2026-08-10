import { getDecibelPackage, type DecibelNetwork } from "@/lib/decibel";

type MoveEvent = {
  type?: unknown;
  data?: unknown;
};

export type DecibelBuilderFillReceipt = {
  network: DecibelNetwork;
  eventKey: string;
  transactionHash: string;
  transactionVersion: string;
  eventIndex: number;
  transactionUnixMs: string | null;
  account: string;
  marketAddress: string;
  fillId: string;
  orderId: string | null;
  clientOrderId: string | null;
  isTaker: boolean;
  side: string | null;
  source: string | null;
  priceRaw: string;
  sizeRaw: string;
  feeRaw: string | null;
  builderAddress: string;
  builderFeeRaw: string;
  builderFeeChainUnits: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function moveOption(value: unknown): unknown[] {
  const vec = record(value)?.vec;
  return Array.isArray(vec) ? vec : [];
}

function integerString(value: unknown, options?: { positive?: boolean }): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const text = String(value);
  if (!/^-?\d+$/.test(text)) return null;
  try {
    const parsed = BigInt(text);
    if (options?.positive && parsed <= 0n) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const result = String(value).trim();
  return result ? result : null;
}

function address(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate || !/^0x[0-9a-fA-F]{1,64}$/.test(candidate)) return null;
  return `0x${candidate.slice(2).toLowerCase().padStart(64, "0")}`;
}

function objectAddress(value: unknown): string | null {
  return address(record(value)?.inner ?? value);
}

function variant(value: unknown): string | null {
  const name = record(value)?.__variant__;
  return text(name ?? value);
}

function boolean(value: unknown): boolean {
  return value === true || value === "true";
}

function transactionTimestampMs(transaction: Record<string, unknown>): string | null {
  const explicitMs = integerString(transaction.transaction_unix_ms);
  if (explicitMs !== null) return explicitMs;

  const raw = integerString(transaction.timestamp);
  if (raw === null) return null;
  const timestamp = BigInt(raw);
  // Aptos fullnode transaction timestamps are microseconds. Keep the parser tolerant of a
  // fixture or future API that has already converted the value to milliseconds.
  return (timestamp > 10_000_000_000_000n ? timestamp / 1_000n : timestamp).toString();
}

function eventTypeMatches(value: unknown, network: DecibelNetwork): boolean {
  const type = text(value);
  if (!type) return false;
  const parts = type.split("::");
  if (parts.length !== 3) return false;
  return (
    address(parts[0]) === address(getDecibelPackage(network)) &&
    parts[1] === "perp_positions" &&
    parts[2] === "TradeEvent"
  );
}

/**
 * Extract builder revenue from a confirmed Aptos receipt.
 *
 * This intentionally ignores the fee requested in an order payload. A requested fee is not
 * revenue: the order can fail, miss, partially fill, or round to a different on-chain amount.
 * The matching `builder_or_referrer_fees` distribution inside Decibel's `TradeEvent` is the
 * authoritative amount actually credited to the builder.
 */
export function extractDecibelBuilderFills(args: {
  transaction: unknown;
  network: DecibelNetwork;
  expectedAccount?: string;
  expectedBuilderAddress?: string;
}): DecibelBuilderFillReceipt[] {
  const transaction = record(args.transaction);
  if (!transaction || !boolean(transaction.success)) return [];

  const transactionVersion = integerString(transaction.version);
  const transactionHash = text(transaction.hash);
  const events = transaction.events;
  if (!transactionVersion || !transactionHash || !Array.isArray(events)) return [];

  const expectedAccount = args.expectedAccount ? address(args.expectedAccount) : null;
  const expectedBuilder = args.expectedBuilderAddress
    ? address(args.expectedBuilderAddress)
    : null;
  if (args.expectedAccount && !expectedAccount) return [];
  if (args.expectedBuilderAddress && !expectedBuilder) return [];

  const transactionUnixMs = transactionTimestampMs(transaction);
  const fills: DecibelBuilderFillReceipt[] = [];

  events.forEach((rawEvent, eventIndex) => {
    const event = record(rawEvent) as MoveEvent | null;
    if (!event || !eventTypeMatches(event.type, args.network)) return;
    const data = record(event.data);
    if (!data) return;

    const account = address(data.account);
    const marketAddress = objectAddress(data.market);
    const priceRaw = integerString(data.price, { positive: true });
    const sizeRaw = integerString(data.size, { positive: true });
    const fillId = integerString(data.fill_id) ?? text(data.fill_id);
    if (!account || !marketAddress || !priceRaw || !sizeRaw || !fillId) return;
    if (expectedAccount && account !== expectedAccount) return;

    const builderCode = record(moveOption(data.builder_code)[0]);
    const builderAddress = address(builderCode?.builder ?? builderCode?.address);
    const builderFeeChainUnits = integerString(builderCode?.fees ?? builderCode?.fee, {
      positive: true,
    });
    if (!builderAddress || !builderFeeChainUnits) return;
    if (expectedBuilder && builderAddress !== expectedBuilder) return;

    const distribution = record(data.fee_distribution);
    const distributed = moveOption(distribution?.builder_or_referrer_fees)
      .map(record)
      .find((item) =>
        address(item?.address ?? item?.builder ?? item?.recipient) === builderAddress,
      );
    const builderFeeRaw = integerString(distributed?.fees ?? distributed?.fee, {
      positive: true,
    });
    if (!builderFeeRaw) return;

    fills.push({
      network: args.network,
      eventKey: `${transactionVersion}:${eventIndex}`,
      transactionHash,
      transactionVersion,
      eventIndex,
      transactionUnixMs,
      account,
      marketAddress,
      fillId,
      orderId: integerString(data.order_id) ?? text(data.order_id),
      clientOrderId: integerString(data.client_order_id) ?? text(data.client_order_id),
      isTaker: boolean(data.is_taker),
      side: variant(data.action),
      source: variant(data.source),
      priceRaw,
      sizeRaw,
      feeRaw: integerString(data.fee),
      builderAddress,
      builderFeeRaw,
      builderFeeChainUnits,
    });
  });

  return fills;
}
