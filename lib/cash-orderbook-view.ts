import {
  CASH_DECIMALS,
  CASH_LOT_SIZE,
  CASH_ORDERBOOK_PAIR_ID,
  CASH_PRICE_DECIMALS,
  parseTokenAmountToAtomic,
  type CashOrderbookDepth,
} from "@/lib/cash-orderbook";

const EXPECTED_TICK_SIZE_ATOMIC = 10_000n;
const EXPECTED_LOT_SIZE_ATOMIC = BigInt(CASH_LOT_SIZE) * 10n ** BigInt(CASH_DECIMALS);
const MAX_ORDERS_PER_SIDE = 500;
const MAX_VIEW_PAGE_SIZE = 100;
const EXPECTED_MATCH_ORDER_NODES = 16;
const U64_MAX = (1n << 64n) - 1n;

function isValidAptosAddress(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

function normalizedAddress(value: string) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function isValidDepthSide(value: unknown, descending: boolean) {
  if (!Array.isArray(value) || value.length > MAX_ORDERS_PER_SIDE) return false;
  let previousPrice: bigint | null = null;
  for (const level of value) {
    if (!level || typeof level !== "object") return false;
    const { price, quantity, total } = level as Record<string, unknown>;
    if (
      typeof price !== "number"
      || typeof quantity !== "number"
      || !Number.isFinite(price)
      || !Number.isFinite(quantity)
      || price <= 0
      || quantity <= 0
      || (total !== undefined && (
        typeof total !== "number" || !Number.isFinite(total) || total < 0
      ))
    ) return false;

    let priceAtomic: bigint;
    let quantityAtomic: bigint;
    try {
      priceAtomic = BigInt(parseTokenAmountToAtomic(price, CASH_PRICE_DECIMALS, "price"));
      quantityAtomic = BigInt(parseTokenAmountToAtomic(quantity, CASH_DECIMALS, "quantity"));
    } catch {
      return false;
    }
    if (
      priceAtomic <= 0n
      || quantityAtomic <= 0n
      || priceAtomic % EXPECTED_TICK_SIZE_ATOMIC !== 0n
      || quantityAtomic % EXPECTED_LOT_SIZE_ATOMIC !== 0n
    ) return false;
    if (
      previousPrice !== null
      && (descending ? priceAtomic >= previousPrice : priceAtomic <= previousPrice)
    ) return false;
    previousPrice = priceAtomic;
  }
  return true;
}

export function validatedCashOrderbookDepth(value: unknown): CashOrderbookDepth | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CashOrderbookDepth>;
  if (!isValidDepthSide(candidate.bids, true) || !isValidDepthSide(candidate.asks, false)) {
    return null;
  }
  const bestBid = candidate.bids?.[0]?.price;
  const bestAsk = candidate.asks?.[0]?.price;
  if (bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk) return null;
  return candidate as CashOrderbookDepth;
}

function parseU64(value: unknown, fieldName: string) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) throw new Error(`${fieldName} is malformed`);
  const parsed = BigInt(text);
  if (parsed > U64_MAX) throw new Error(`${fieldName} exceeds u64`);
  return parsed;
}

export interface CashOrderbookSidePage {
  cursorOrderId: string;
  cursorPrice: string;
  cursorTimestamp: string;
  hasMore: boolean;
  orders: unknown[];
}

export function parseCashOrderbookSidePage(result: unknown[]): CashOrderbookSidePage {
  if (result.length !== 5 || !Array.isArray(result[0]) || result[0].length > MAX_VIEW_PAGE_SIZE) {
    throw new Error("The paginated orderbook view returned malformed data");
  }
  if (typeof result[1] !== "boolean") {
    throw new Error("The paginated orderbook view returned a malformed continuation flag");
  }
  const cursorPrice = parseU64(result[2], "orderbook cursor price").toString();
  const cursorTimestamp = parseU64(result[3], "orderbook cursor timestamp").toString();
  const cursorOrderId = parseU64(result[4], "orderbook cursor order id").toString();
  return {
    orders: result[0],
    hasMore: result[1],
    cursorPrice,
    cursorTimestamp,
    cursorOrderId,
  };
}

export interface CashExecutableOrderbookSide {
  hasMoreRawNodes: boolean;
  orders: unknown[];
  scannedNodes: number;
}

export function parseCashExecutableOrderbookSide(
  result: unknown[],
): CashExecutableOrderbookSide {
  if (
    result.length !== 3
    || !Array.isArray(result[0])
    || result[0].length > EXPECTED_MATCH_ORDER_NODES
    || typeof result[2] !== "boolean"
  ) {
    throw new Error("The executable orderbook view returned malformed data");
  }
  const scanned = parseU64(result[1], "executable orderbook scanned nodes");
  if (
    scanned > BigInt(EXPECTED_MATCH_ORDER_NODES)
    || BigInt(result[0].length) > scanned
    || (result[2] && scanned !== BigInt(EXPECTED_MATCH_ORDER_NODES))
  ) {
    throw new Error("The executable orderbook view exceeded the audited node budget");
  }
  return {
    orders: result[0],
    scannedNodes: Number(scanned),
    hasMoreRawNodes: result[2],
  };
}

function atomicToExactNumber(value: bigint, decimals: number, fieldName: string) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  try {
    return BigInt(parseTokenAmountToAtomic(parsed, decimals, fieldName)) === value
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function aggregateOnChainOrders(value: unknown, isBid: boolean, excludedOwner: string) {
  if (!Array.isArray(value) || value.length > MAX_ORDERS_PER_SIDE) {
    throw new Error("The on-chain orderbook is too large for a safe retail quote");
  }
  const levels = new Map<string, { price: bigint; quantity: bigint }>();
  for (const rawOrder of value) {
    if (!rawOrder || typeof rawOrder !== "object") {
      throw new Error("The on-chain orderbook returned a malformed order");
    }
    const order = rawOrder as Record<string, unknown>;
    const pairId = parseU64(order.pair_id, "pair id");
    const price = parseU64(order.price, "order price");
    const originalQuantity = parseU64(order.original_quantity, "original quantity");
    const remainingQuantity = parseU64(order.remaining_quantity, "remaining quantity");
    const orderType = parseU64(order.order_type, "order type");
    if (
      pairId !== BigInt(CASH_ORDERBOOK_PAIR_ID)
      || order.is_bid !== isBid
      || !isValidAptosAddress(order.owner)
      || (orderType !== 0n && orderType !== 3n)
      || price <= 0n
      || remainingQuantity <= 0n
      || remainingQuantity > originalQuantity
      || price % EXPECTED_TICK_SIZE_ATOMIC !== 0n
      || remainingQuantity % EXPECTED_LOT_SIZE_ATOMIC !== 0n
    ) {
      throw new Error("An on-chain order violates the audited CASH/USDC market rules");
    }
    if (excludedOwner && normalizedAddress(order.owner as string) === excludedOwner) continue;
    const key = price.toString();
    const existing = levels.get(key);
    const quantity = ((existing?.quantity ?? 0n) + remainingQuantity) > U64_MAX
      ? U64_MAX - U64_MAX % EXPECTED_LOT_SIZE_ATOMIC
      : (existing?.quantity ?? 0n) + remainingQuantity;
    levels.set(key, { price, quantity });
  }

  const sorted = [...levels.values()].sort((a, b) => {
    if (a.price === b.price) return 0;
    if (isBid) return a.price > b.price ? -1 : 1;
    return a.price < b.price ? -1 : 1;
  });
  let cumulative = 0;
  return sorted.flatMap((level) => {
    const price = atomicToExactNumber(level.price, CASH_PRICE_DECIMALS, "price");
    const quantity = atomicToExactNumber(level.quantity, CASH_DECIMALS, "quantity");
    // A legal far-tail order that cannot round-trip through the retail quote
    // number model must not halt the entire market. Omitting it is fail-safe:
    // the client can only underestimate available liquidity.
    if (price === null || quantity === null) return [];
    cumulative += quantity;
    return [{ price, quantity, total: cumulative }];
  });
}

export function depthFromCashOrderbookOrders(
  bids: unknown[],
  asks: unknown[],
  ownerToExclude = "",
): CashOrderbookDepth {
  if (ownerToExclude && !isValidAptosAddress(ownerToExclude)) {
    throw new Error("The excluded owner is not a valid Aptos address");
  }
  const excludedOwner = ownerToExclude ? normalizedAddress(ownerToExclude) : "";
  const depth = {
    bids: aggregateOnChainOrders(bids, true, excludedOwner),
    asks: aggregateOnChainOrders(asks, false, excludedOwner),
  };
  const validated = validatedCashOrderbookDepth(depth);
  if (!validated) throw new Error("The on-chain orderbook failed depth validation");
  return validated;
}

export function depthFromCashOrderbookView(
  result: unknown[],
  ownerToExclude = "",
): CashOrderbookDepth {
  if (result.length !== 2) throw new Error("The on-chain orderbook view returned malformed data");
  if (!Array.isArray(result[0]) || !Array.isArray(result[1])) {
    throw new Error("The on-chain orderbook view returned malformed data");
  }
  return depthFromCashOrderbookOrders(result[0], result[1], ownerToExclude);
}
