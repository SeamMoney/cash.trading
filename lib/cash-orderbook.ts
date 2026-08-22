export const CASH_METADATA_ADDRESS =
  "0xc692943f7b340f02191c5de8dac2f827e0b66b3ed2206206a3526bcb0cae6e40";
export const CASH_LEGACY_COIN_TYPE =
  "0x61ed8b048636516b4eaf4c74250fa4f9440d9c3e163d96aeb863fe658a4bdc67::CASH::CASH";
export const USDC_METADATA_ADDRESS =
  "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";

export const CASH_ORDERBOOK_PAIR_ID = 0;
export const CASH_DECIMALS = 6;
export const USDC_DECIMALS = 6;
export const CASH_PRICE_DECIMALS = 12;
export const CASH_LOT_SIZE = 1_000;
export const CASH_MIN_ORDER_SIZE = 10_000;
export const CASH_SWAP_SLIPPAGE_BPS = 50;

const U64_MAX = (1n << 64n) - 1n;
const BPS_DENOMINATOR = 10_000n;
const CASH_SCALE = 10n ** BigInt(CASH_DECIMALS);
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);
const PRICE_SCALE = 10n ** BigInt(CASH_PRICE_DECIMALS);
const CASH_LOT_ATOMIC = BigInt(CASH_LOT_SIZE) * CASH_SCALE;
const CASH_MIN_ORDER_ATOMIC = BigInt(CASH_MIN_ORDER_SIZE) * CASH_SCALE;

export interface CashDepthLevel {
  price: number;
  quantity: number;
  total?: number;
}

export interface CashOrderbookDepth {
  bids: CashDepthLevel[];
  asks: CashDepthLevel[];
}

export interface CashBuyQuote {
  cashAmount: number;
  cashAmountAtomic: string;
  minCashAmount: number;
  minCashAmountAtomic: string;
  usdcSpent: number;
  usdcSpentAtomic: string;
  maxUsdcAmount: number;
  maxUsdcAmountAtomic: string;
  bestAsk: number;
  effectivePrice: number;
  priceImpactPct: number;
  spreadPct: number;
  referencePriceAvailable: boolean;
  sufficientLiquidity: boolean;
}

export interface CashSellQuote {
  cashAmount: number;
  cashAmountAtomic: string;
  usdcAmount: number;
  usdcAmountAtomic: string;
  minUsdcAmount: number;
  minUsdcAmountAtomic: string;
  bestBid: number;
  effectivePrice: number;
  priceImpactPct: number;
  spreadPct: number;
  referencePriceAvailable: boolean;
  sufficientLiquidity: boolean;
}

function decimalText(value: number | string, maximumFractionDigits: number) {
  if (typeof value === "string") return value.trim();
  if (!Number.isFinite(value)) throw new Error("Amount must be finite");
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits,
  });
}

function parseAtomic(
  value: number | string,
  decimals: number,
  fieldName: string,
): bigint {
  const text = decimalText(value, decimals);
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`${fieldName} must be a positive decimal amount`);
  }
  const whole = match[1] || "0";
  const fraction = match[2] || "";
  if (fraction.length > decimals) {
    throw new Error(`${fieldName} supports at most ${decimals} decimal places`);
  }
  const scale = 10n ** BigInt(decimals);
  const paddedFraction = fraction.padEnd(decimals, "0");
  const atomic = BigInt(whole) * scale + BigInt(paddedFraction || "0");
  if (atomic > U64_MAX) throw new Error(`${fieldName} exceeds the Aptos u64 limit`);
  return atomic;
}

export function parseTokenAmountToAtomic(
  value: number | string,
  decimals: number,
  fieldName = "amount",
) {
  return parseAtomic(value, decimals, fieldName).toString();
}

function atomicToNumber(value: bigint, scale: bigint) {
  return Number(value) / Number(scale);
}

function floorToCashLot(value: bigint) {
  return (value / CASH_LOT_ATOMIC) * CASH_LOT_ATOMIC;
}

function quoteAtomic(priceAtomic: bigint, cashAtomic: bigint) {
  return (priceAtomic * cashAtomic) / PRICE_SCALE;
}

function slippageFloor(value: bigint, slippageBps: number) {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error("slippageBps must be a whole number between 0 and 9,999");
  }
  return (value * BigInt(10_000 - slippageBps)) / BPS_DENOMINATOR;
}

function slippageCeil(value: bigint, slippageBps: number) {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error("slippageBps must be a whole number between 0 and 9,999");
  }
  const numerator = value * BigInt(10_000 + slippageBps);
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

function levelAtomic(level: CashDepthLevel) {
  try {
    return {
      price: parseAtomic(level.price, CASH_PRICE_DECIMALS, "price"),
      quantity: parseAtomic(level.quantity, CASH_DECIMALS, "quantity"),
    };
  } catch {
    return null;
  }
}

export function quoteCashBuy(
  usdcInput: number | string,
  depth: CashOrderbookDepth,
  slippageBps = CASH_SWAP_SLIPPAGE_BPS,
): CashBuyQuote | null {
  let maxUsdcAtomic: bigint;
  try {
    maxUsdcAtomic = parseAtomic(usdcInput, USDC_DECIMALS, "USDC amount");
  } catch {
    return null;
  }
  if (maxUsdcAtomic <= 0n) return null;

  const asks = [...depth.asks]
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((a, b) => a.price - b.price);
  if (asks.length === 0) return null;

  let remainingUsdc = maxUsdcAtomic;
  let rawCashAtomic = 0n;

  for (const level of asks) {
    if (remainingUsdc <= 0n) break;
    const atomic = levelAtomic(level);
    if (!atomic) continue;
    const levelCost = quoteAtomic(atomic.price, atomic.quantity);
    if (levelCost <= remainingUsdc) {
      rawCashAtomic += atomic.quantity;
      remainingUsdc -= levelCost;
      continue;
    }
    const affordableCash = (remainingUsdc * PRICE_SCALE) / atomic.price;
    rawCashAtomic += affordableCash < atomic.quantity ? affordableCash : atomic.quantity;
    remainingUsdc = 0n;
  }
  const inputCovered = remainingUsdc <= 0n;

  const cashAmountAtomic = floorToCashLot(rawCashAtomic);
  if (cashAmountAtomic < CASH_MIN_ORDER_ATOMIC) return null;

  // Re-walk the book for the exact lot-aligned quantity sent to Move. Each
  // level uses the same integer floor as settlement.move.
  let remainingCash = cashAmountAtomic;
  let usdcSpentAtomic = 0n;
  for (const level of asks) {
    if (remainingCash <= 0n) break;
    const atomic = levelAtomic(level);
    if (!atomic) continue;
    const fill = remainingCash < atomic.quantity ? remainingCash : atomic.quantity;
    usdcSpentAtomic += quoteAtomic(atomic.price, fill);
    remainingCash -= fill;
  }

  const filledCashAtomic = cashAmountAtomic - remainingCash;
  const cashAmount = atomicToNumber(cashAmountAtomic, CASH_SCALE);
  const usdcSpent = atomicToNumber(usdcSpentAtomic, USDC_SCALE);
  const filledCash = atomicToNumber(filledCashAtomic, CASH_SCALE);
  const bestAsk = asks[0].price;
  const bestBid = [...depth.bids]
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((a, b) => b.price - a.price)[0]?.price ?? 0;
  const midpoint = bestBid > 0 ? (bestAsk + bestBid) / 2 : bestAsk;
  const effectivePrice = filledCash > 0 ? usdcSpent / filledCash : 0;
  // A wallet buy has two independent Move bounds: max quote and min base. If
  // both receive 0.5% tolerance, their ratio can permit almost 1% worse unit
  // execution. Matching is not budget-aware, so protect the full quoted base
  // quantity and put the entire 0.5% allowance in the quote cap. A thinner
  // book therefore reverts instead of silently returning fewer CASH.
  const minCashAmountAtomic = cashAmountAtomic;
  const protectedQuoteCap = slippageCeil(usdcSpentAtomic, slippageBps);
  const maxUsdcAmountAtomic = protectedQuoteCap < maxUsdcAtomic
    ? protectedQuoteCap
    : maxUsdcAtomic;

  return {
    cashAmount,
    cashAmountAtomic: cashAmountAtomic.toString(),
    minCashAmount: atomicToNumber(minCashAmountAtomic, CASH_SCALE),
    minCashAmountAtomic: minCashAmountAtomic.toString(),
    usdcSpent,
    usdcSpentAtomic: usdcSpentAtomic.toString(),
    maxUsdcAmount: atomicToNumber(maxUsdcAmountAtomic, USDC_SCALE),
    maxUsdcAmountAtomic: maxUsdcAmountAtomic.toString(),
    bestAsk,
    effectivePrice,
    priceImpactPct: midpoint > 0
      ? Math.max(0, ((effectivePrice / midpoint) - 1) * 100)
      : 0,
    spreadPct: midpoint > 0 && bestBid > 0
      ? Math.max(0, ((bestAsk - bestBid) / midpoint) * 100)
      : 0,
    referencePriceAvailable: bestBid > 0,
    sufficientLiquidity: inputCovered && remainingCash <= 0n,
  };
}

export function minimumCashBuyCost(depth: CashOrderbookDepth): number | null {
  const asks = [...depth.asks]
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((a, b) => a.price - b.price);
  let remainingCash = CASH_MIN_ORDER_ATOMIC;
  let cost = 0n;
  for (const level of asks) {
    if (remainingCash <= 0n) break;
    const atomic = levelAtomic(level);
    if (!atomic) continue;
    const fill = remainingCash < atomic.quantity ? remainingCash : atomic.quantity;
    cost += quoteAtomic(atomic.price, fill);
    remainingCash -= fill;
  }
  return remainingCash > 0n ? null : atomicToNumber(cost, USDC_SCALE);
}

export function quoteCashSell(
  cashInput: number | string,
  depth: CashOrderbookDepth,
  slippageBps = CASH_SWAP_SLIPPAGE_BPS,
): CashSellQuote | null {
  let inputCashAtomic: bigint;
  try {
    inputCashAtomic = parseAtomic(cashInput, CASH_DECIMALS, "CASH amount");
  } catch {
    return null;
  }
  const cashAmountAtomic = floorToCashLot(inputCashAtomic);
  if (cashAmountAtomic < CASH_MIN_ORDER_ATOMIC) return null;

  const bids = [...depth.bids]
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((a, b) => b.price - a.price);
  if (bids.length === 0) return null;

  let remainingCash = cashAmountAtomic;
  let usdcAmountAtomic = 0n;
  for (const level of bids) {
    if (remainingCash <= 0n) break;
    const atomic = levelAtomic(level);
    if (!atomic) continue;
    const fill = remainingCash < atomic.quantity ? remainingCash : atomic.quantity;
    usdcAmountAtomic += quoteAtomic(atomic.price, fill);
    remainingCash -= fill;
  }

  const filledCashAtomic = cashAmountAtomic - remainingCash;
  const cashAmount = atomicToNumber(cashAmountAtomic, CASH_SCALE);
  const usdcAmount = atomicToNumber(usdcAmountAtomic, USDC_SCALE);
  const filledCash = atomicToNumber(filledCashAtomic, CASH_SCALE);
  const bestBid = bids[0].price;
  const bestAsk = [...depth.asks]
    .filter((level) => level.price > 0 && level.quantity > 0)
    .sort((a, b) => a.price - b.price)[0]?.price ?? 0;
  const midpoint = bestAsk > 0 ? (bestAsk + bestBid) / 2 : bestBid;
  const effectivePrice = filledCash > 0 ? usdcAmount / filledCash : 0;
  const minUsdcAmountAtomic = slippageFloor(usdcAmountAtomic, slippageBps);

  return {
    cashAmount,
    cashAmountAtomic: cashAmountAtomic.toString(),
    usdcAmount,
    usdcAmountAtomic: usdcAmountAtomic.toString(),
    minUsdcAmount: atomicToNumber(minUsdcAmountAtomic, USDC_SCALE),
    minUsdcAmountAtomic: minUsdcAmountAtomic.toString(),
    bestBid,
    effectivePrice,
    priceImpactPct: midpoint > 0
      ? Math.max(0, (1 - effectivePrice / midpoint) * 100)
      : 0,
    spreadPct: midpoint > 0 && bestAsk > 0
      ? Math.max(0, ((bestAsk - bestBid) / midpoint) * 100)
      : 0,
    referencePriceAvailable: bestAsk > 0,
    sufficientLiquidity: remainingCash <= 0n,
  };
}

function validatedContractAddress(value: string) {
  const contractAddress = value.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(contractAddress)) {
    throw new Error("CASH orderbook contract address is invalid");
  }
  return contractAddress;
}

export function buildCashBuyPayload(args: {
  contractAddress: string;
  quote: CashBuyQuote;
}) {
  const maxQuoteAtomic = BigInt(args.quote.maxUsdcAmountAtomic);
  const baseQuantityAtomic = BigInt(args.quote.cashAmountAtomic);
  const minimumBaseAtomic = BigInt(args.quote.minCashAmountAtomic);
  const reviewedSpendAtomic = BigInt(args.quote.usdcSpentAtomic);
  if (maxQuoteAtomic <= 0n || maxQuoteAtomic > U64_MAX) {
    throw new Error("Protected USDC cap is invalid");
  }
  if (
    baseQuantityAtomic <= 0n
    || minimumBaseAtomic !== baseQuantityAtomic
    || maxQuoteAtomic > slippageCeil(reviewedSpendAtomic, CASH_SWAP_SLIPPAGE_BPS)
  ) {
    throw new Error("CASH buy protection does not enforce the reviewed 0.5% price bound");
  }

  return {
    function: `${validatedContractAddress(args.contractAddress)}::order_placement::buy_from_wallet` as `${string}::${string}::${string}`,
    functionArguments: [
      CASH_ORDERBOOK_PAIR_ID,
      USDC_METADATA_ADDRESS,
      CASH_METADATA_ADDRESS,
      maxQuoteAtomic.toString(),
      baseQuantityAtomic.toString(),
      minimumBaseAtomic.toString(),
    ],
  };
}

export function buildCashSellPayload(args: {
  contractAddress: string;
  quote: CashSellQuote;
}) {
  return {
    function: `${validatedContractAddress(args.contractAddress)}::order_placement::sell_from_wallet` as `${string}::${string}::${string}`,
    functionArguments: [
      CASH_ORDERBOOK_PAIR_ID,
      USDC_METADATA_ADDRESS,
      CASH_METADATA_ADDRESS,
      args.quote.cashAmountAtomic,
      args.quote.minUsdcAmountAtomic,
    ],
  };
}

/** Move a wallet's legacy CASH CoinStore balance into its paired primary FA store. */
export function buildCashMigrationPayload() {
  return {
    function: "0x1::coin::migrate_to_fungible_store" as `${string}::${string}::${string}`,
    typeArguments: [CASH_LEGACY_COIN_TYPE],
    functionArguments: [],
  };
}
