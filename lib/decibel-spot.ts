import {
  MAINNET_DECIBEL_PACKAGE,
  MAINNET_USDC_METADATA,
} from "@/lib/decibel-client";

/**
 * Decibel spot integration primitives.
 *
 * Sources checked against mainnet on 2026-08-20 (lot sizes re-read from
 * spot_market_config::get_lot_size after Decibel decreased both on 2026-08-19):
 * - https://docs.decibel.trade/developer-hub/on-chain/order-management/place-spot-order
 * - https://docs.decibel.trade/api-reference/market-data/get-all-available-markets
 * - https://docs.decibel.trade/api-reference/market-data/get-orderbook-depth
 * - https://docs.decibel.trade/api-reference/user/get-apiv1orders
 * - https://docs.decibel.trade/api-reference/account/get-user-trade-history
 * - the live mainnet `dex_accounts_spot_entry` module ABI
 * - the live mainnet `spot_pending_cbs_queue` module ABI
 *
 * The allowlist is deliberately exact. A new market or a parameter change must
 * be reviewed before this module will create a wallet-signable payload for it.
 */

export const DECIBEL_SPOT_MAX_SLIPPAGE_BPS = 50 as const;
export const DECIBEL_SPOT_IOC_TIF = 2 as const;
export const DECIBEL_SPOT_MAX_BOOK_DEPTH = 50 as const;
export const DECIBEL_SPOT_DEFAULT_MAX_AGE_MS = 15_000 as const;
export const DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS = 15_000 as const;
export const DECIBEL_SPOT_MAX_SETTLEMENT_FILLS = 200 as const;
export const DECIBEL_SPOT_FEE_RATE_DENOMINATOR = "1000000" as const;
// A fee above 1% is treated as an unreviewed protocol change and disables quotes.
export const DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW = 10_000n;
export const DECIBEL_MAINNET_APT_METADATA = longAddress("0xa");
export const DECIBEL_MAINNET_APT_DECIMALS = 8 as const;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const BPS_SCALE = 10_000n;
const APTOS_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export type DecibelSpotSide = "buy" | "sell";

export type PinnedDecibelSpotMarket = {
  marketAddress: string;
  marketName: "BTC/USDC" | "APT/USDC";
  baseAssetAddress: string;
  quoteAssetAddress: string;
  baseDecimals: number;
  quoteDecimals: number;
  tickSizeRaw: string;
  lotSizeRaw: string;
  minSizeRaw: string;
  minPriceRaw: string;
  maxPriceRaw: string;
};

function longAddress(value: string) {
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function normalizeDecibelSpotAddress(value: unknown, fieldName = "address") {
  if (typeof value !== "string" || !APTOS_ADDRESS_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a valid Aptos address`);
  }
  return longAddress(value);
}

export const DECIBEL_MAINNET_SPOT_MARKETS = [
  {
    marketAddress: longAddress(
      "0xa8d796ad0e4f2d96f133db0ff0528a770cdacce1d8421dc42754806db4d3d2e7",
    ),
    marketName: "BTC/USDC",
    baseAssetAddress: longAddress(
      "0x0b0b819dcf8d9517ed14195a95adfae6a49bfdb49de33a532ca0aa7ee588e8e0",
    ),
    quoteAssetAddress: longAddress(MAINNET_USDC_METADATA),
    baseDecimals: 8,
    quoteDecimals: 6,
    tickSizeRaw: "1000000",
    lotSizeRaw: "100",
    minSizeRaw: "2000",
    minPriceRaw: "100000000",
    maxPriceRaw: "10000000000000",
  },
  {
    marketAddress: longAddress(
      "0x8bdea2abfe7bd637079b5c678ce682d7334e89cb8eae24d97cf9e37bd84c8628",
    ),
    marketName: "APT/USDC",
    baseAssetAddress: longAddress("0xa"),
    quoteAssetAddress: longAddress(MAINNET_USDC_METADATA),
    baseDecimals: 8,
    quoteDecimals: 6,
    tickSizeRaw: "100",
    lotSizeRaw: "1000000",
    minSizeRaw: "1000000000",
    minPriceRaw: "100",
    maxPriceRaw: "100000000000",
  },
] as const satisfies readonly PinnedDecibelSpotMarket[];

export type ValidatedDecibelSpotMarket = PinnedDecibelSpotMarket & {
  assetType: "spot";
  mode: "Open";
  contextTimestampMs: number;
  mid: string | null;
};

export type ValidatedDecibelSpotLevel = {
  price: string;
  size: string;
  priceRaw: string;
  sizeRaw: string;
};

export type ValidatedDecibelSpotSnapshot = {
  network: "mainnet";
  packageAddress: string;
  market: ValidatedDecibelSpotMarket;
  snapshotTimestampMs: number;
  expiresAtMs: number;
  timestampSource: "orderbook" | "spot-context";
  orderbookTimestampMs: number | null;
  fee: ValidatedDecibelSpotFee;
  depth: number;
  bids: ValidatedDecibelSpotLevel[];
  asks: ValidatedDecibelSpotLevel[];
};

export type ValidatedDecibelSpotFee = {
  maxTakerFeeRateRaw: string;
  rateDenominator: typeof DECIBEL_SPOT_FEE_RATE_DENOMINATOR;
  ledgerVersion: string;
  ledgerTimestampMs: number;
  expiresAtMs: number;
};

export type ValidatedDecibelPrimaryStoreBalance = {
  metadataAddress: string;
  atomic: string;
  decimals: number;
  source: "primary_fungible_store";
  ledgerVersion: string;
  ledgerTimestampMs: number;
  expiresAtMs: number;
};

export type ValidatedDecibelSpotBalances = {
  network: "mainnet";
  ownerAddress: string;
  marketAddress: string;
  marketName: PinnedDecibelSpotMarket["marketName"];
  base: ValidatedDecibelPrimaryStoreBalance;
  quote: ValidatedDecibelPrimaryStoreBalance;
  gas: ValidatedDecibelPrimaryStoreBalance;
  readAtMs: number;
  expiresAtMs: number;
  cbsIncluded: false;
};

export type DecibelSpotMarketsResponse = {
  ready: true;
  resource: "markets";
  network: "mainnet";
  markets: ValidatedDecibelSpotMarket[];
  fetchedAt: number;
};

export type DecibelSpotOrderbookResponse = {
  ready: true;
  resource: "orderbook";
  snapshot: ValidatedDecibelSpotSnapshot;
  fetchedAt: number;
};

export type DecibelSpotBalanceAmount = {
  atomic: string;
  decimals: number;
  symbol: string;
};

export type DecibelSpotBalancesResponse = {
  ready: true;
  resource: "balances";
  owner: string;
  marketAddress: string;
  balances: {
    base: DecibelSpotBalanceAmount;
    quote: DecibelSpotBalanceAmount;
    apt: DecibelSpotBalanceAmount;
  };
  fetchedAt: number;
};

export type DecibelSpotSettlementLookup = {
  ownerAddress: string;
  marketAddress: string;
  orderId: string;
  expectedOrder?: {
    priceAtomic: string;
    sizeAtomic: string;
    isBid: boolean;
  };
};

export type ValidatedDecibelSpotLedgerInfo = {
  ledgerVersion: string;
  ledgerTimestampMs: number;
  expiresAtMs: number;
};

export type DecibelSpotOrderStatus =
  | "Acknowledged"
  | "Open"
  | "SizeReduced"
  | "Filled"
  | "Cancelled"
  | "Rejected";

export type ValidatedDecibelSpotOrderStatus = {
  assetType: "spot";
  ownerAddress: string;
  marketAddress: string;
  orderId: string;
  status: DecibelSpotOrderStatus;
  timeInForce: "IOC";
  isBid: boolean;
  priceAtomic: string;
  limitPriceAtomic: string;
  sizeAtomic: string;
  remainingSizeAtomic: string;
  sizeDeltaAtomic: string | null;
  cancellationReason: string;
  details: string;
  transactionVersion: string;
  transactionTimestampMs: number;
};

export type ValidatedDecibelSpotTerminalOrderProof = {
  assetType: "spot";
  ownerAddress: string;
  marketAddress: string;
  orderId: string;
  terminalOrderStatus: "Filled" | "Cancelled" | "Rejected";
  sizeAtomic: string;
  remainingSizeAtomic: string;
  sizeDeltaAtomic: string;
  transactionVersion: string;
  transactionTimestampMs: number;
};

export type DecibelSpotSettlementExecution = {
  sizeAtomic: string;
  quoteAmountAtomic: string;
  baseFeeAtomic: string;
  quoteFeeAtomic: string;
  fillCount: number;
};

export type ValidatedDecibelSpotTradeHistory = {
  complete: boolean;
  reportedTotalCount: number | null;
  execution: DecibelSpotSettlementExecution | null;
  latestTransactionVersion: string | null;
  latestTransactionTimestampMs: number | null;
  sourceReadAtMs: number;
};

export type DecibelSpotSettlement =
  | {
      status: "pending";
      reason: "order-processing";
      order: ValidatedDecibelSpotOrderStatus;
    }
  | {
      status: "unverified";
      reason:
        | "awaiting-order-history"
        | "terminal-proof-awaiting"
        | "fills-awaiting-history"
        | "incomplete-fill-history"
        | "conflicting-state";
      order: ValidatedDecibelSpotOrderStatus | null;
    }
  | {
      status: "filled";
      terminalOrderStatus: "Filled" | "Cancelled";
      order: ValidatedDecibelSpotOrderStatus;
      execution: DecibelSpotSettlementExecution;
    }
  | {
      status: "no-fill";
      terminalOrderStatus: "Cancelled" | "Rejected";
      order: ValidatedDecibelSpotOrderStatus;
    };

export type DecibelSpotSettlementResponse = {
  ready: true;
  resource: "settlement";
  network: "mainnet";
  owner: string;
  marketAddress: string;
  orderId: string;
  settlement: DecibelSpotSettlement;
  ledgerVersion: string;
  ledgerTimestampMs: number;
  fetchedAt: number;
  expiresAt: number;
};

export type DecibelSpotErrorResponse = {
  ready: false;
  message: string;
};

export type DecibelSpotQuote = {
  kind: "exact-input";
  side: DecibelSpotSide;
  market: ValidatedDecibelSpotMarket;
  snapshotTimestampMs: number;
  expiresAtMs: number;
  requestedInputAtomic: string;
  orderSizeRaw: string;
  limitPriceRaw: string;
  expectedBaseAmountRaw: string;
  expectedQuoteAmountRaw: string;
  estimatedInputUsedAtomic: string;
  estimatedGrossOutputAtomic: string;
  estimatedNetOutputAtomic: string;
  estimatedMaxProtocolFeeAtomic: string;
  minimumNetOutputAtFullFillAtomic: string;
  maximumProtocolFeeAtFullFillAtomic: string;
  maximumInputEscrowAtomic: string;
  uncommittedInputAtomic: string;
  unspentInputAtQuotedBookAtomic: string;
  worstQuotedPriceRaw: string;
  maxSlippageBps: typeof DECIBEL_SPOT_MAX_SLIPPAGE_BPS;
  timeInForce: "ImmediateOrCancel";
  timeInForceCode: typeof DECIBEL_SPOT_IOC_TIF;
  partialFillPossible: true;
  unfilledSizeCancels: true;
  minimumOutputAtomic: "0";
  protocolFeeIncluded: true;
  protocolFeeAssetAddress: string;
  maxSpotTakerFeeRateRaw: string;
  spotFeeRateDenominator: typeof DECIBEL_SPOT_FEE_RATE_DENOMINATOR;
};

export type DecibelSpotEntryPayload = {
  function: `${string}::dex_accounts_spot_entry::place_spot_order`;
  typeArguments: [];
  functionArguments: [string, string, string, boolean, 2, null, null];
};

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value;
}

function requireExactString(value: unknown, expected: string, fieldName: string) {
  if (value !== expected) throw new Error(`${fieldName} did not match the reviewed mainnet value`);
}

function requireExactBoolean(value: unknown, expected: boolean, fieldName: string) {
  if (value !== expected) throw new Error(`${fieldName} did not match the reviewed mainnet value`);
}

function parseUnsignedInteger(
  value: unknown,
  fieldName: string,
  options: { allowZero?: boolean; max?: bigint } = {},
) {
  let text: string;
  if (typeof value === "bigint") {
    text = value.toString();
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${fieldName} must be a safe unsigned integer`);
    }
    text = String(value);
  } else if (typeof value === "string") {
    text = value;
  } else {
    throw new Error(`${fieldName} must be an unsigned integer`);
  }

  if (!UNSIGNED_INTEGER_PATTERN.test(text)) {
    throw new Error(`${fieldName} must be an unsigned integer`);
  }
  const parsed = BigInt(text);
  const max = options.max ?? U64_MAX;
  if ((!options.allowZero && parsed === 0n) || parsed > max) {
    throw new Error(`${fieldName} is outside the supported unsigned integer range`);
  }
  return parsed;
}

function requireExactU64(value: unknown, expected: string, fieldName: string) {
  if (parseUnsignedInteger(value, fieldName, { allowZero: true }).toString() !== expected) {
    throw new Error(`${fieldName} did not match the reviewed mainnet value`);
  }
}

function requireExactSmallInteger(value: unknown, expected: number, fieldName: string) {
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw new Error(`${fieldName} did not match the reviewed mainnet value`);
  }
}

function requireExactZero(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value !== 0) {
    throw new Error(`${fieldName} must be zero for a spot market`);
  }
}

function requireNow(nowMs: number) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("nowMs must be a unix timestamp");
}

function requireMaxAge(maxAgeMs: number) {
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 60_000) {
    throw new Error("maxAgeMs must be between 1 and 60000");
  }
}

function parseFreshTimestamp(value: unknown, fieldName: string, nowMs: number, maxAgeMs: number) {
  const raw = parseUnsignedInteger(value, fieldName, {
    max: BigInt(Number.MAX_SAFE_INTEGER),
  });
  const timestamp = Number(raw);
  if (timestamp > nowMs + 2_000) throw new Error(`${fieldName} is in the future`);
  if (nowMs - timestamp > maxAgeMs) throw new Error(`${fieldName} is stale`);
  return timestamp;
}

function parseBookTimestamp(value: unknown, nowMs: number, maxAgeMs: number) {
  const raw = parseUnsignedInteger(value, "orderbook.timestamp", {
    allowZero: true,
    max: BigInt(Number.MAX_SAFE_INTEGER),
  });
  if (raw === 0n) return null;
  return parseFreshTimestamp(raw, "orderbook.timestamp", nowMs, maxAgeMs);
}

export function validateDecibelSpotTakerFeeView(args: {
  value: unknown;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotFee {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_DEFAULT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  if (args.chainId !== "1" && args.chainId !== 1) {
    throw new Error("Decibel spot fee view was not read from Aptos mainnet");
  }
  const outer = asArray(args.value, "spot taker fee view");
  if (outer.length !== 1) throw new Error("spot taker fee view must return one vector");
  const tiers = asArray(outer[0], "spot taker fee tiers");
  if (tiers.length < 1 || tiers.length > 32) {
    throw new Error("spot taker fee tier count is out of bounds");
  }
  const rates = tiers.map((value, index) =>
    parseUnsignedInteger(value, `spot taker fee tier ${index}`, { allowZero: true }),
  );
  const maxTakerFee = rates.reduce((highest, rate) => (rate > highest ? rate : highest), 0n);
  if (maxTakerFee === 0n || maxTakerFee > DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW) {
    throw new Error("highest spot taker fee is zero or above the reviewed safety bound");
  }
  const ledgerVersion = parseUnsignedInteger(args.ledgerVersion, "fee ledger version");
  const ledgerTimestampUsec = parseUnsignedInteger(
    args.ledgerTimestampUsec,
    "fee ledger timestamp",
    { max: BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 999n },
  );
  const ledgerTimestampMs = Number(ledgerTimestampUsec / 1_000n);
  parseFreshTimestamp(ledgerTimestampMs, "fee ledger timestamp", nowMs, maxAgeMs);
  return {
    maxTakerFeeRateRaw: maxTakerFee.toString(),
    rateDenominator: DECIBEL_SPOT_FEE_RATE_DENOMINATOR,
    ledgerVersion: ledgerVersion.toString(),
    ledgerTimestampMs,
    expiresAtMs: ledgerTimestampMs + maxAgeMs,
  };
}

export function validateDecibelPrimaryStoreBalanceView(args: {
  value: unknown;
  metadataAddress: unknown;
  decimals: number;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelPrimaryStoreBalance {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_DEFAULT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  requireDecimals(args.decimals, "balance decimals");
  if (args.chainId !== "1" && args.chainId !== 1) {
    throw new Error("primary-store balance was not read from Aptos mainnet");
  }
  const values = asArray(args.value, "primary-store balance view");
  if (values.length !== 1) throw new Error("primary-store balance view must return one value");
  const atomic = parseUnsignedInteger(values[0], "primary-store balance", { allowZero: true });
  const ledgerVersion = parseUnsignedInteger(args.ledgerVersion, "balance ledger version");
  const ledgerTimestampUsec = parseUnsignedInteger(
    args.ledgerTimestampUsec,
    "balance ledger timestamp",
    { max: BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 999n },
  );
  const ledgerTimestampMs = Number(ledgerTimestampUsec / 1_000n);
  parseFreshTimestamp(ledgerTimestampMs, "balance ledger timestamp", nowMs, maxAgeMs);
  return {
    metadataAddress: normalizeDecibelSpotAddress(args.metadataAddress, "balance metadata"),
    atomic: atomic.toString(),
    decimals: args.decimals,
    source: "primary_fungible_store",
    ledgerVersion: ledgerVersion.toString(),
    ledgerTimestampMs,
    expiresAtMs: ledgerTimestampMs + maxAgeMs,
  };
}

export function assembleDecibelSpotBalances(args: {
  ownerAddress: unknown;
  market: PinnedDecibelSpotMarket;
  base: ValidatedDecibelPrimaryStoreBalance;
  quote: ValidatedDecibelPrimaryStoreBalance;
  gas: ValidatedDecibelPrimaryStoreBalance;
}): ValidatedDecibelSpotBalances {
  const market = resolvePinnedDecibelSpotMarket(args.market.marketAddress);
  const expected = [
    [args.base, market.baseAssetAddress, market.baseDecimals, "base"],
    [args.quote, market.quoteAssetAddress, market.quoteDecimals, "quote"],
    [args.gas, DECIBEL_MAINNET_APT_METADATA, DECIBEL_MAINNET_APT_DECIMALS, "gas"],
  ] as const;
  for (const [balance, metadata, decimals, name] of expected) {
    if (balance.metadataAddress !== metadata || balance.decimals !== decimals) {
      throw new Error(`${name} primary-store balance identity did not match the pinned asset`);
    }
  }
  const readAtMs = Math.min(
    args.base.ledgerTimestampMs,
    args.quote.ledgerTimestampMs,
    args.gas.ledgerTimestampMs,
  );
  const expiresAtMs = Math.min(
    args.base.expiresAtMs,
    args.quote.expiresAtMs,
    args.gas.expiresAtMs,
  );
  return {
    network: "mainnet",
    ownerAddress: normalizeDecibelSpotAddress(args.ownerAddress, "owner"),
    marketAddress: market.marketAddress,
    marketName: market.marketName,
    base: args.base,
    quote: args.quote,
    gas: args.gas,
    readAtMs,
    expiresAtMs,
    cbsIncluded: false,
  };
}

function decimalText(value: unknown, fieldName: string, allowNull = false): string | null {
  if (allowNull && value === null) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`${fieldName} must be a decimal value${allowNull ? " or null" : ""}`);
  }
  const text = String(value);
  if (!DECIMAL_PATTERN.test(text)) throw new Error(`${fieldName} must be a plain decimal value`);
  return text;
}

function requireDecimals(value: number, fieldName: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 18) {
    throw new Error(`${fieldName} must be between 0 and 18`);
  }
  return value;
}

function decimalToAtomic(value: unknown, decimals: number, fieldName: string) {
  requireDecimals(decimals, "decimals");
  const text = decimalText(value, fieldName);
  if (text === null) throw new Error(`${fieldName} is required`);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) throw new Error(`${fieldName} must be a plain decimal value`);
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`${fieldName} has more than ${decimals} decimal places`);
  }
  const raw = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw > U64_MAX) throw new Error(`${fieldName} exceeds u64`);
  return raw;
}

/** Parse a plain user-entered decimal without ever passing through Number. */
export function parseDecibelSpotAmountInput(
  value: string,
  decimals: number,
  fieldName = "amount",
) {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a decimal string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${fieldName} is required`);
  return decimalToAtomic(trimmed, requireDecimals(decimals, "decimals"), fieldName).toString();
}

/**
 * Format an atomic amount without floating point. Extra precision is
 * truncated, so protected/minimum amounts are never displayed above reality.
 */
export function formatDecibelSpotAtomic(
  value: string | bigint,
  decimals: number,
  maxDisplayDecimals = decimals,
) {
  requireDecimals(decimals, "decimals");
  if (
    !Number.isSafeInteger(maxDisplayDecimals) ||
    maxDisplayDecimals < 0 ||
    maxDisplayDecimals > decimals
  ) {
    throw new Error("maxDisplayDecimals must be between 0 and decimals");
  }
  const atomic = parseUnsignedInteger(value, "atomic amount", { allowZero: true });
  if (decimals === 0) return atomic.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, "0");
  const visibleFraction = fraction.slice(0, maxDisplayDecimals).replace(/0+$/, "");
  return visibleFraction.length > 0 ? `${whole}.${visibleFraction}` : whole.toString();
}

function canonicalDecimal(value: unknown, fieldName: string) {
  const text = decimalText(value, fieldName, true);
  if (text === null) return null;
  if (!/[1-9]/.test(text)) {
    throw new Error(`${fieldName} must be positive or null`);
  }
  return text;
}

function validateMarketRow(raw: unknown, expected: PinnedDecibelSpotMarket) {
  const row = asRecord(raw, `market ${expected.marketName}`);
  requireExactString(row.asset_type, "spot", `${expected.marketName}.asset_type`);
  requireExactString(row.market_name, expected.marketName, `${expected.marketName}.market_name`);
  if (
    normalizeDecibelSpotAddress(row.market_addr, `${expected.marketName}.market_addr`) !==
    expected.marketAddress
  ) {
    throw new Error(`${expected.marketName}.market_addr did not match the reviewed mainnet value`);
  }
  requireExactString(row.mode, "Open", `${expected.marketName}.mode`);
  requireExactSmallInteger(row.sz_decimals, expected.baseDecimals, `${expected.marketName}.sz_decimals`);
  requireExactSmallInteger(row.px_decimals, expected.quoteDecimals, `${expected.marketName}.px_decimals`);
  requireExactU64(row.tick_size, expected.tickSizeRaw, `${expected.marketName}.tick_size`);
  requireExactU64(row.lot_size, expected.lotSizeRaw, `${expected.marketName}.lot_size`);
  requireExactU64(row.min_size, expected.minSizeRaw, `${expected.marketName}.min_size`);
  requireExactU64(row.min_price, expected.minPriceRaw, `${expected.marketName}.min_price`);
  requireExactU64(row.max_price, expected.maxPriceRaw, `${expected.marketName}.max_price`);
  requireExactSmallInteger(row.max_leverage, 0, `${expected.marketName}.max_leverage`);
  requireExactZero(row.max_open_interest, `${expected.marketName}.max_open_interest`);
  requireExactSmallInteger(
    row.unrealized_pnl_haircut_bps,
    0,
    `${expected.marketName}.unrealized_pnl_haircut_bps`,
  );
  requireExactString(row.category, "", `${expected.marketName}.category`);
  requireExactBoolean(row.is_isolated_only, false, `${expected.marketName}.is_isolated_only`);
}

function validateContextRow(
  raw: unknown,
  expected: PinnedDecibelSpotMarket,
  nowMs: number,
  maxAgeMs: number,
) {
  const row = asRecord(raw, `spot context ${expected.marketName}`);
  if (
    normalizeDecibelSpotAddress(row.market_addr, `${expected.marketName}.context.market_addr`) !==
    expected.marketAddress
  ) {
    throw new Error(`${expected.marketName} context market address did not match`);
  }
  requireExactString(row.name, expected.marketName, `${expected.marketName}.context.name`);
  requireExactString(
    row.ticker_id,
    expected.marketName.replace("/", "-"),
    `${expected.marketName}.context.ticker_id`,
  );
  if (
    normalizeDecibelSpotAddress(row.base_asset_addr, `${expected.marketName}.base_asset_addr`) !==
    expected.baseAssetAddress
  ) {
    throw new Error(`${expected.marketName} base asset address did not match`);
  }
  if (
    normalizeDecibelSpotAddress(row.quote_asset_addr, `${expected.marketName}.quote_asset_addr`) !==
    expected.quoteAssetAddress
  ) {
    throw new Error(`${expected.marketName} quote asset address did not match`);
  }
  requireExactSmallInteger(row.base_decimals, expected.baseDecimals, `${expected.marketName}.base_decimals`);
  requireExactSmallInteger(
    row.quote_decimals,
    expected.quoteDecimals,
    `${expected.marketName}.quote_decimals`,
  );
  if (!("mid" in row)) throw new Error(`${expected.marketName}.context.mid is missing`);
  return {
    contextTimestampMs: parseFreshTimestamp(
      row.timestamp_unix_ms,
      `${expected.marketName}.context.timestamp_unix_ms`,
      nowMs,
      maxAgeMs,
    ),
    mid: canonicalDecimal(row.mid, `${expected.marketName}.context.mid`),
  };
}

function findUniqueRow(
  rows: unknown[],
  expected: PinnedDecibelSpotMarket,
  kind: "market" | "context",
) {
  const candidates = rows.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const row = raw as Record<string, unknown>;
    const name = kind === "market" ? row.market_name : row.name;
    if (name === expected.marketName) return true;
    const address = row.market_addr;
    return typeof address === "string" && APTOS_ADDRESS_PATTERN.test(address)
      ? longAddress(address) === expected.marketAddress
      : false;
  });
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one ${kind} row for ${expected.marketName}`);
  }
  return candidates[0];
}

export function validateDecibelMainnetSpotMarkets(args: {
  markets: unknown;
  contexts: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotMarket[] {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_DEFAULT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  const marketRows = asArray(args.markets, "markets");
  const contextRows = asArray(args.contexts, "spot contexts");

  return DECIBEL_MAINNET_SPOT_MARKETS.map((expected) => {
    validateMarketRow(findUniqueRow(marketRows, expected, "market"), expected);
    const context = validateContextRow(
      findUniqueRow(contextRows, expected, "context"),
      expected,
      nowMs,
      maxAgeMs,
    );
    return {
      ...expected,
      assetType: "spot" as const,
      mode: "Open" as const,
      ...context,
    };
  });
}

export function resolvePinnedDecibelSpotMarket(value: unknown) {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    throw new Error("market must be a reviewed Decibel spot name or address");
  }
  const normalized = APTOS_ADDRESS_PATTERN.test(value) ? longAddress(value) : null;
  const market = DECIBEL_MAINNET_SPOT_MARKETS.find(
    (candidate) => candidate.marketName === value || candidate.marketAddress === normalized,
  );
  if (!market) throw new Error("market is not a reviewed Decibel mainnet spot market");
  return market;
}

function boundedString(value: unknown, fieldName: string, maxLength = 256) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${fieldName} must be a bounded string`);
  }
  return value;
}

export function normalizeDecibelSpotOrderId(value: unknown) {
  return parseUnsignedInteger(value, "spot order ID", {
    allowZero: true,
    max: U128_MAX,
  }).toString();
}

export function validateDecibelSpotSettlementLookup(args: {
  ownerAddress: unknown;
  market: unknown;
  orderId: unknown;
  expectedOrder?: {
    priceAtomic: unknown;
    sizeAtomic: unknown;
    isBid: unknown;
  };
}): DecibelSpotSettlementLookup {
  const ownerAddress = normalizeDecibelSpotAddress(args.ownerAddress, "settlement owner");
  const market = resolvePinnedDecibelSpotMarket(args.market);
  const orderId = normalizeDecibelSpotOrderId(args.orderId);
  if (!args.expectedOrder) {
    return { ownerAddress, marketAddress: market.marketAddress, orderId };
  }
  const price = parseUnsignedInteger(args.expectedOrder.priceAtomic, "expected spot order price");
  const size = parseUnsignedInteger(args.expectedOrder.sizeAtomic, "expected spot order size");
  if (typeof args.expectedOrder.isBid !== "boolean") {
    throw new Error("expected spot order side must be boolean");
  }
  if (
    price < BigInt(market.minPriceRaw)
    || price > BigInt(market.maxPriceRaw)
    || price % BigInt(market.tickSizeRaw) !== 0n
  ) {
    throw new Error("expected spot order price is outside the pinned tick or bounds");
  }
  if (size < BigInt(market.minSizeRaw) || size % BigInt(market.lotSizeRaw) !== 0n) {
    throw new Error("expected spot order size is outside the pinned lot or minimum");
  }
  return {
    ownerAddress,
    marketAddress: market.marketAddress,
    orderId,
    expectedOrder: {
      priceAtomic: price.toString(),
      sizeAtomic: size.toString(),
      isBid: args.expectedOrder.isBid,
    },
  };
}

export function validateDecibelSpotLedgerInfo(args: {
  value: unknown;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotLedgerInfo {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  const response = asRecord(args.value, "Aptos ledger info");
  if (
    (response.chain_id !== 1 && response.chain_id !== "1")
    || (args.chainId !== 1 && args.chainId !== "1")
  ) {
    throw new Error("spot settlement ledger info was not from Aptos mainnet");
  }
  const bodyVersion = parseUnsignedInteger(
    response.ledger_version,
    "settlement ledger info version",
  );
  const headerVersion = parseUnsignedInteger(
    args.ledgerVersion,
    "settlement ledger header version",
  );
  const maximumTimestampUsec = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 999n;
  const bodyTimestampUsec = parseUnsignedInteger(
    response.ledger_timestamp,
    "settlement ledger info timestamp",
    { max: maximumTimestampUsec },
  );
  const headerTimestampUsec = parseUnsignedInteger(
    args.ledgerTimestampUsec,
    "settlement ledger header timestamp",
    { max: maximumTimestampUsec },
  );
  if (bodyVersion !== headerVersion || bodyTimestampUsec !== headerTimestampUsec) {
    throw new Error("spot settlement ledger body and headers conflicted");
  }
  const ledgerTimestampMs = Number(bodyTimestampUsec / 1_000n);
  parseFreshTimestamp(
    ledgerTimestampMs,
    "spot settlement ledger timestamp",
    nowMs,
    maxAgeMs,
  );
  return {
    ledgerVersion: bodyVersion.toString(),
    ledgerTimestampMs,
    expiresAtMs: ledgerTimestampMs + maxAgeMs,
  };
}

export function validateDecibelSpotSourceDate(
  value: unknown,
  nowMs = Date.now(),
  maxAgeMs = DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS,
) {
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  if (typeof value !== "string" || value.length > 64) {
    throw new Error("Decibel spot settlement source date is missing");
  }
  const timestampMs = Date.parse(value);
  if (!Number.isSafeInteger(timestampMs) || new Date(timestampMs).toUTCString() !== value) {
    throw new Error("Decibel spot settlement source date is malformed");
  }
  parseFreshTimestamp(timestampMs, "Decibel spot settlement source date", nowMs, maxAgeMs);
  return timestampMs;
}

const SPOT_ORDER_STATUSES = new Set<DecibelSpotOrderStatus>([
  "Acknowledged",
  "Open",
  "SizeReduced",
  "Filled",
  "Cancelled",
  "Rejected",
]);

const SPOT_CANCELLATION_REASONS = new Set([
  "",
  "PostOnlyViolation",
  "IOCViolation",
  "PositionUpdateViolation",
  "ReduceOnlyViolation",
  "ClearinghouseSettleViolation",
  "MaxFillLimitViolation",
  "DuplicateClientOrderIdViolation",
  "OrderPreCancelled",
  "PlaceMakerOrderViolation",
  "DeadMansSwitchExpired",
  "DisallowedSelfTrading",
  "OrderCancelledByUser",
  "OrderCancelledBySystem",
  "OrderCancelledBySystemDueToError",
  "ClearinghouseStoppedMatching",
]);

export function validateDecibelSpotOrderStatusResponse(args: {
  value: unknown;
  lookup: DecibelSpotSettlementLookup;
  sourceReadAtMs: number;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotOrderStatus {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  parseFreshTimestamp(args.sourceReadAtMs, "spot order status read", nowMs, maxAgeMs);
  const lookup = validateDecibelSpotSettlementLookup({
    ownerAddress: args.lookup.ownerAddress,
    market: args.lookup.marketAddress,
    orderId: args.lookup.orderId,
    expectedOrder: args.lookup.expectedOrder,
  });
  const market = resolvePinnedDecibelSpotMarket(lookup.marketAddress);
  const response = asRecord(args.value, "spot order status response");
  const order = asRecord(response.order, "spot order status response.order");
  const status = boundedString(order.status, "spot order status", 32) as DecibelSpotOrderStatus;
  if (!SPOT_ORDER_STATUSES.has(status) || response.status !== status) {
    throw new Error("spot order status was unknown or conflicted with its wrapper");
  }
  requireExactString(order.asset_type, "spot", "spot order asset_type");
  requireExactString(order.parent, "", "spot order parent");
  requireExactString(order.client_order_id, "", "spot order client_order_id");
  requireExactString(order.order_type, "", "spot order order_type");
  requireExactString(order.trigger_condition, "", "spot order trigger_condition");
  requireExactString(order.time_in_force, "IOC", "spot order time_in_force");
  requireExactBoolean(order.is_reduce_only, false, "spot order is_reduce_only");
  requireExactBoolean(order.is_tpsl, false, "spot order is_tpsl");
  if (
    order.tp_trigger_price !== null
    || order.tp_limit_price !== null
    || order.sl_trigger_price !== null
    || order.sl_limit_price !== null
  ) {
    throw new Error("spot IOC order unexpectedly contained perp TP/SL fields");
  }
  const marketAddress = normalizeDecibelSpotAddress(order.market, "spot order market");
  const orderId = normalizeDecibelSpotOrderId(order.order_id);
  if (marketAddress !== lookup.marketAddress || orderId !== lookup.orderId) {
    throw new Error("spot order market or order ID did not match the requested order");
  }
  if (typeof order.is_buy !== "boolean") throw new Error("spot order side must be boolean");
  const isBid = order.is_buy;
  requireExactString(
    order.order_direction,
    isBid ? "Buy" : "Sell",
    "spot order direction",
  );
  const price = decimalToAtomic(order.price, market.quoteDecimals, "spot order price");
  const size = decimalToAtomic(order.orig_size, market.baseDecimals, "spot order size");
  const remaining = decimalToAtomic(
    order.remaining_size,
    market.baseDecimals,
    "spot order remaining size",
  );
  const sizeDelta = order.size_delta === null
    ? null
    : decimalToAtomic(order.size_delta, market.baseDecimals, "spot order size delta");
  if (
    price < BigInt(market.minPriceRaw)
    || price > BigInt(market.maxPriceRaw)
    || price % BigInt(market.tickSizeRaw) !== 0n
  ) {
    throw new Error("spot order price is outside the pinned tick or bounds");
  }
  if (
    size < BigInt(market.minSizeRaw)
    || size % BigInt(market.lotSizeRaw) !== 0n
    || remaining > size
    || remaining % BigInt(market.lotSizeRaw) !== 0n
    || (sizeDelta !== null && (sizeDelta > size || sizeDelta % BigInt(market.lotSizeRaw) !== 0n))
  ) {
    throw new Error("spot order sizes are outside the pinned lot or bounds");
  }
  const limitPrice = lookup.expectedOrder
    ? BigInt(lookup.expectedOrder.priceAtomic)
    : price;
  if (lookup.expectedOrder) {
    if (
      size.toString() !== lookup.expectedOrder.sizeAtomic
      || isBid !== lookup.expectedOrder.isBid
      || (status === "Filled"
        ? (isBid ? price > limitPrice : price < limitPrice)
        : price !== limitPrice)
    ) {
      throw new Error("spot order status did not match the original transaction identity");
    }
  }
  const cancellationReason = boundedString(
    order.cancellation_reason,
    "spot order cancellation reason",
    96,
  );
  if (!SPOT_CANCELLATION_REASONS.has(cancellationReason)) {
    throw new Error("spot order cancellation reason was not in the reviewed on-chain enum");
  }
  const details = boundedString(order.details, "spot order details", 512);
  if (response.details !== details) {
    throw new Error("spot order details conflicted with its wrapper");
  }
  const transactionVersion = parseUnsignedInteger(
    order.transaction_version,
    "spot order transaction version",
  );
  const transactionTimestampMs = Number(parseUnsignedInteger(
    order.unix_ms,
    "spot order transaction timestamp",
    { max: BigInt(Number.MAX_SAFE_INTEGER) },
  ));
  if (transactionTimestampMs > nowMs + 2_000) {
    throw new Error("spot order transaction timestamp is in the future");
  }
  return {
    assetType: "spot",
    ownerAddress: lookup.ownerAddress,
    marketAddress,
    orderId,
    status,
    timeInForce: "IOC",
    isBid,
    priceAtomic: price.toString(),
    limitPriceAtomic: limitPrice.toString(),
    sizeAtomic: size.toString(),
    remainingSizeAtomic: remaining.toString(),
    sizeDeltaAtomic: sizeDelta?.toString() ?? null,
    cancellationReason,
    details,
    transactionVersion: transactionVersion.toString(),
    transactionTimestampMs,
  };
}

function moveOptionItems(value: unknown, fieldName: string) {
  const option = asRecord(value, fieldName);
  if (Object.keys(option).length !== 1) {
    throw new Error(`${fieldName} was not an exact Move option`);
  }
  return asArray(option.vec, `${fieldName}.vec`);
}

export function validateDecibelSpotTerminalTransaction(args: {
  value: unknown;
  order: ValidatedDecibelSpotOrderStatus;
  chainId: unknown;
  ledgerVersion: unknown;
  ledgerTimestampUsec: unknown;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotTerminalOrderProof {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  if (
    args.order.status !== "Filled"
    && args.order.status !== "Cancelled"
    && args.order.status !== "Rejected"
  ) {
    throw new Error("spot terminal transaction requires a terminal order record");
  }
  if (args.chainId !== "1" && args.chainId !== 1) {
    throw new Error("spot terminal transaction was not read from Aptos mainnet");
  }
  const responseLedgerVersion = parseUnsignedInteger(
    args.ledgerVersion,
    "spot terminal transaction ledger version",
  );
  const maximumTimestampUsec = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 999n;
  const responseLedgerTimestampUsec = parseUnsignedInteger(
    args.ledgerTimestampUsec,
    "spot terminal transaction ledger timestamp",
    { max: maximumTimestampUsec },
  );
  parseFreshTimestamp(
    Number(responseLedgerTimestampUsec / 1_000n),
    "spot terminal transaction ledger timestamp",
    nowMs,
    maxAgeMs,
  );

  const transaction = asRecord(args.value, "spot terminal transaction");
  requireExactBoolean(transaction.success, true, "spot terminal transaction success");
  requireExactString(
    transaction.vm_status,
    "Executed successfully",
    "spot terminal transaction vm_status",
  );
  const transactionVersion = parseUnsignedInteger(
    transaction.version,
    "spot terminal transaction version",
  );
  if (
    transactionVersion.toString() !== args.order.transactionVersion
    || transactionVersion > responseLedgerVersion
  ) {
    throw new Error("spot terminal transaction version did not match the order record");
  }
  const transactionTimestampUsec = parseUnsignedInteger(
    transaction.timestamp,
    "spot terminal transaction timestamp",
    { max: maximumTimestampUsec },
  );
  const transactionTimestampMs = Number(transactionTimestampUsec / 1_000n);
  if (transactionTimestampMs !== args.order.transactionTimestampMs) {
    throw new Error("spot terminal transaction timestamp did not match the order record");
  }

  const expectedEventType = `${DECIBEL_MAINNET_SPOT_PACKAGE}::market_types::OrderEvent`;
  const expectedStatus = {
    Filled: "FILLED",
    Cancelled: "CANCELLED",
    Rejected: "REJECTED",
  }[args.order.status];
  const matches: Record<string, unknown>[] = [];
  for (const [index, rawEvent] of asArray(transaction.events, "spot terminal events").entries()) {
    const event = asRecord(rawEvent, `spot terminal event ${index}`);
    if (event.type !== expectedEventType) continue;
    const data = asRecord(event.data, `spot terminal OrderEvent ${index}`);
    const status = asRecord(data.status, `spot terminal OrderEvent ${index}.status`);
    if (
      normalizeDecibelSpotOrderId(data.order_id) === args.order.orderId
      && normalizeDecibelSpotAddress(data.market, `spot terminal OrderEvent ${index}.market`)
        === args.order.marketAddress
      && normalizeDecibelSpotAddress(data.user, `spot terminal OrderEvent ${index}.user`)
        === args.order.ownerAddress
      && status.__variant__ === expectedStatus
    ) {
      matches.push(data);
    }
  }
  if (matches.length !== 1) {
    throw new Error("spot terminal transaction did not contain one exact owner-bound OrderEvent");
  }

  const event = matches[0];
  requireExactString(event.__variant__, "V1", "spot terminal OrderEvent version");
  requireExactBoolean(event.is_bid, args.order.isBid, "spot terminal OrderEvent side");
  normalizeDecibelSpotAddress(event.parent, "spot terminal OrderEvent parent");
  requireExactString(event.details, args.order.details, "spot terminal OrderEvent details");
  requireExactString(event.metadata_bytes, "0x", "spot terminal OrderEvent metadata");
  const timeInForce = asRecord(event.time_in_force, "spot terminal OrderEvent time_in_force");
  requireExactString(timeInForce.__variant__, "IOC", "spot terminal OrderEvent time_in_force");
  if (
    moveOptionItems(event.client_order_id, "spot terminal OrderEvent client_order_id").length !== 0
    || moveOptionItems(event.trigger_condition, "spot terminal OrderEvent trigger_condition").length !== 0
  ) {
    throw new Error("spot terminal OrderEvent unexpectedly contained perp order fields");
  }
  const cancellation = moveOptionItems(
    event.cancellation_reason,
    "spot terminal OrderEvent cancellation_reason",
  );
  if (args.order.cancellationReason === "") {
    if (cancellation.length !== 0) {
      throw new Error("spot terminal OrderEvent cancellation reason conflicted with order history");
    }
  } else {
    if (cancellation.length !== 1) {
      throw new Error("spot terminal OrderEvent cancellation reason was missing");
    }
    const reason = asRecord(cancellation[0], "spot terminal OrderEvent cancellation reason");
    requireExactString(
      reason.__variant__,
      args.order.cancellationReason,
      "spot terminal OrderEvent cancellation reason",
    );
  }
  const exactAtomicFields = [
    [event.price, args.order.priceAtomic, "price"],
    [event.orig_size, args.order.sizeAtomic, "orig_size"],
    [event.remaining_size, args.order.remainingSizeAtomic, "remaining_size"],
  ] as const;
  if (args.order.sizeDeltaAtomic === null) {
    throw new Error("terminal spot order record did not contain a size delta");
  }
  for (const [value, expected, name] of [
    ...exactAtomicFields,
    [event.size_delta, args.order.sizeDeltaAtomic, "size_delta"] as const,
  ]) {
    if (
      parseUnsignedInteger(value, `spot terminal OrderEvent ${name}`, { allowZero: true })
        .toString() !== expected
    ) {
      throw new Error(`spot terminal OrderEvent ${name} conflicted with order history`);
    }
  }
  return {
    assetType: "spot",
    ownerAddress: args.order.ownerAddress,
    marketAddress: args.order.marketAddress,
    orderId: args.order.orderId,
    terminalOrderStatus: args.order.status,
    sizeAtomic: args.order.sizeAtomic,
    remainingSizeAtomic: args.order.remainingSizeAtomic,
    sizeDeltaAtomic: args.order.sizeDeltaAtomic,
    transactionVersion: transactionVersion.toString(),
    transactionTimestampMs,
  };
}

export function validateDecibelSpotTradeHistory(args: {
  value: unknown;
  order: ValidatedDecibelSpotOrderStatus;
  sourceReadAtMs: number;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotTradeHistory {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  parseFreshTimestamp(args.sourceReadAtMs, "spot fill history read", nowMs, maxAgeMs);
  const market = resolvePinnedDecibelSpotMarket(args.order.marketAddress);
  const response = asRecord(args.value, "spot trade history response");
  const rows = asArray(response.items, "spot trade history items");
  if (rows.length > DECIBEL_SPOT_MAX_SETTLEMENT_FILLS) {
    throw new Error("spot trade history exceeded the bounded fill count");
  }
  let reportedTotalCount: number | null = null;
  if (response.total_count !== null && response.total_count !== undefined) {
    if (
      typeof response.total_count !== "number"
      || !Number.isSafeInteger(response.total_count)
      || response.total_count < 0
    ) {
      throw new Error("spot trade history total_count was invalid");
    }
    reportedTotalCount = response.total_count;
  }
  let size = 0n;
  let quoteAmount = 0n;
  let baseFee = 0n;
  let quoteFee = 0n;
  let latestVersion: string | null = null;
  let latestTimestampMs: number | null = null;
  const tradeIds = new Set<string>();
  const orderVersion = BigInt(args.order.transactionVersion);
  const orderSize = BigInt(args.order.sizeAtomic);
  const orderPrice = BigInt(args.order.limitPriceAtomic);
  const baseScale = 10n ** BigInt(market.baseDecimals);
  const expectedFeeAsset = args.order.isBid
    ? market.baseAssetAddress
    : market.quoteAssetAddress;

  rows.forEach((raw, index) => {
    const row = asRecord(raw, `spot trade history item ${index}`);
    requireExactString(row.asset_type, "spot", `spot trade ${index} asset_type`);
    if (
      normalizeDecibelSpotAddress(row.account, `spot trade ${index} account`)
        !== args.order.ownerAddress
      || normalizeDecibelSpotAddress(row.market, `spot trade ${index} market`)
        !== args.order.marketAddress
      || normalizeDecibelSpotOrderId(row.order_id) !== args.order.orderId
    ) {
      throw new Error(`spot trade ${index} identity did not match the requested order`);
    }
    requireExactString(row.client_order_id, "", `spot trade ${index} client_order_id`);
    requireExactString(row.source, "OrderFill", `spot trade ${index} source`);
    requireExactString(
      row.action,
      args.order.isBid ? "Buy" : "Sell",
      `spot trade ${index} action`,
    );
    requireExactBoolean(row.is_profit, false, `spot trade ${index} is_profit`);
    requireExactBoolean(row.is_rebate, false, `spot trade ${index} is_rebate`);
    requireExactZero(row.realized_pnl_amount, `spot trade ${index} realized_pnl_amount`);
    requireExactZero(row.realized_funding_amount, `spot trade ${index} realized_funding_amount`);
    normalizeDecibelSpotAddress(
      row.counter_party_account,
      `spot trade ${index} counter_party_account`,
    );
    const tradeId = parseUnsignedInteger(row.trade_id, `spot trade ${index} trade_id`, {
      allowZero: true,
      max: U128_MAX,
    }).toString();
    if (tradeIds.has(tradeId)) throw new Error("spot trade history contained a duplicate fill");
    tradeIds.add(tradeId);
    const tradeSize = decimalToAtomic(row.size, market.baseDecimals, `spot trade ${index} size`);
    const tradePrice = decimalToAtomic(row.price, market.quoteDecimals, `spot trade ${index} price`);
    if (
      tradeSize === 0n
      || tradeSize % BigInt(market.lotSizeRaw) !== 0n
      || tradePrice < BigInt(market.minPriceRaw)
      || tradePrice > BigInt(market.maxPriceRaw)
      || tradePrice % BigInt(market.tickSizeRaw) !== 0n
      || (args.order.isBid ? tradePrice > orderPrice : tradePrice < orderPrice)
    ) {
      throw new Error(`spot trade ${index} violated the requested IOC limit or increments`);
    }
    const tradeQuote = quoteCost(
      tradePrice,
      tradeSize,
      baseScale,
      `spot trade ${index} quote amount`,
    );
    if (
      normalizeDecibelSpotAddress(row.fee_asset, `spot trade ${index} fee_asset`)
        !== expectedFeeAsset
    ) {
      throw new Error(`spot trade ${index} fee asset did not match the received asset`);
    }
    const feeDecimals = args.order.isBid ? market.baseDecimals : market.quoteDecimals;
    const fee = decimalToAtomic(row.fee_amount, feeDecimals, `spot trade ${index} fee`);
    const received = args.order.isBid ? tradeSize : tradeQuote;
    const maximumReviewedFee = ceilDiv(
      received * DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW,
      BigInt(DECIBEL_SPOT_FEE_RATE_DENOMINATOR),
    );
    if (fee > maximumReviewedFee || fee > received) {
      throw new Error(`spot trade ${index} fee exceeded the reviewed bound`);
    }
    const transactionVersion = parseUnsignedInteger(
      row.transaction_version,
      `spot trade ${index} transaction version`,
    );
    const transactionTimestampMs = Number(parseUnsignedInteger(
      row.transaction_unix_ms,
      `spot trade ${index} transaction timestamp`,
      { max: BigInt(Number.MAX_SAFE_INTEGER) },
    ));
    if (
      transactionVersion > orderVersion
      || transactionTimestampMs > args.order.transactionTimestampMs
      || transactionTimestampMs > nowMs + 2_000
    ) {
      throw new Error(`spot trade ${index} occurred after the terminal order record`);
    }
    size = requireU64Result(size + tradeSize, "settlement filled size");
    quoteAmount = requireU64Result(
      quoteAmount + tradeQuote,
      "settlement filled quote amount",
    );
    if (args.order.isBid) baseFee = requireU64Result(baseFee + fee, "settlement base fee");
    else quoteFee = requireU64Result(quoteFee + fee, "settlement quote fee");
    if (latestVersion === null || transactionVersion > BigInt(latestVersion)) {
      latestVersion = transactionVersion.toString();
    }
    if (latestTimestampMs === null || transactionTimestampMs > latestTimestampMs) {
      latestTimestampMs = transactionTimestampMs;
    }
  });
  if (size > orderSize) throw new Error("spot settlement fills exceeded the original order size");
  const complete = reportedTotalCount !== null
    && reportedTotalCount === rows.length
    && reportedTotalCount <= DECIBEL_SPOT_MAX_SETTLEMENT_FILLS;
  return {
    complete,
    reportedTotalCount,
    execution: rows.length === 0
      ? null
      : {
          sizeAtomic: size.toString(),
          quoteAmountAtomic: quoteAmount.toString(),
          baseFeeAtomic: baseFee.toString(),
          quoteFeeAtomic: quoteFee.toString(),
          fillCount: rows.length,
        },
    latestTransactionVersion: latestVersion,
    latestTransactionTimestampMs: latestTimestampMs,
    sourceReadAtMs: args.sourceReadAtMs,
  };
}

export function classifyDecibelSpotSettlement(args: {
  order: ValidatedDecibelSpotOrderStatus | null;
  terminalProof: ValidatedDecibelSpotTerminalOrderProof | null;
  trades: ValidatedDecibelSpotTradeHistory | null;
}): DecibelSpotSettlement {
  if (!args.order) {
    if (args.terminalProof) throw new Error("spot terminal proof was missing its order record");
    return { status: "unverified", reason: "awaiting-order-history", order: null };
  }
  if (
    args.order.status === "Acknowledged"
    || args.order.status === "Open"
    || args.order.status === "SizeReduced"
  ) {
    if (args.terminalProof) throw new Error("nonterminal spot order had a terminal proof");
    return { status: "pending", reason: "order-processing", order: args.order };
  }
  if (!args.terminalProof) {
    return { status: "unverified", reason: "terminal-proof-awaiting", order: args.order };
  }
  if (
    args.terminalProof.assetType !== "spot"
    || args.terminalProof.ownerAddress !== args.order.ownerAddress
    || args.terminalProof.marketAddress !== args.order.marketAddress
    || args.terminalProof.orderId !== args.order.orderId
    || args.terminalProof.terminalOrderStatus !== args.order.status
    || args.terminalProof.sizeAtomic !== args.order.sizeAtomic
    || args.terminalProof.remainingSizeAtomic !== args.order.remainingSizeAtomic
    || args.terminalProof.sizeDeltaAtomic !== args.order.sizeDeltaAtomic
    || args.terminalProof.transactionVersion !== args.order.transactionVersion
    || args.terminalProof.transactionTimestampMs !== args.order.transactionTimestampMs
  ) {
    throw new Error("spot terminal proof conflicted with its order record");
  }
  if (!args.trades) {
    return { status: "unverified", reason: "fills-awaiting-history", order: args.order };
  }
  if (!args.trades.complete) {
    return { status: "unverified", reason: "incomplete-fill-history", order: args.order };
  }
  const execution = args.trades.execution;
  if (execution) {
    if (args.order.status === "Rejected") {
      return { status: "unverified", reason: "conflicting-state", order: args.order };
    }
    if (
      args.order.status === "Filled"
      && execution.sizeAtomic !== args.order.sizeAtomic
    ) {
      return { status: "unverified", reason: "incomplete-fill-history", order: args.order };
    }
    if (
      args.order.status === "Cancelled"
      && (
        args.order.sizeDeltaAtomic === null
        || BigInt(execution.sizeAtomic) + BigInt(args.order.sizeDeltaAtomic)
          !== BigInt(args.order.sizeAtomic)
      )
    ) {
      return { status: "unverified", reason: "conflicting-state", order: args.order };
    }
    return {
      status: "filled",
      terminalOrderStatus: args.order.status,
      order: args.order,
      execution,
    };
  }
  if (args.order.status === "Filled") {
    return { status: "unverified", reason: "fills-awaiting-history", order: args.order };
  }
  if (
    args.order.remainingSizeAtomic !== "0"
    || args.order.sizeDeltaAtomic === null
    || args.order.sizeDeltaAtomic !== args.order.sizeAtomic
  ) {
    return { status: "unverified", reason: "fills-awaiting-history", order: args.order };
  }
  return {
    status: "no-fill",
    terminalOrderStatus: args.order.status,
    order: args.order,
  };
}

function validateNormalizedSettlementOrder(
  value: unknown,
  lookup: DecibelSpotSettlementLookup,
  nowMs: number,
): ValidatedDecibelSpotOrderStatus {
  const order = asRecord(value, "spot settlement order");
  requireExactString(order.assetType, "spot", "spot settlement order assetType");
  requireExactString(order.timeInForce, "IOC", "spot settlement order timeInForce");
  const ownerAddress = normalizeDecibelSpotAddress(
    order.ownerAddress,
    "spot settlement order owner",
  );
  const marketAddress = normalizeDecibelSpotAddress(
    order.marketAddress,
    "spot settlement order market",
  );
  const orderId = normalizeDecibelSpotOrderId(order.orderId);
  if (
    ownerAddress !== lookup.ownerAddress
    || marketAddress !== lookup.marketAddress
    || orderId !== lookup.orderId
  ) {
    throw new Error("spot settlement response order identity did not match the lookup");
  }
  const status = boundedString(
    order.status,
    "spot settlement order status",
    32,
  ) as DecibelSpotOrderStatus;
  if (!SPOT_ORDER_STATUSES.has(status)) throw new Error("spot settlement order status is unknown");
  if (typeof order.isBid !== "boolean") throw new Error("spot settlement order side is invalid");
  const price = parseUnsignedInteger(order.priceAtomic, "spot settlement order price");
  const limitPrice = parseUnsignedInteger(
    order.limitPriceAtomic,
    "spot settlement order limit price",
  );
  const size = parseUnsignedInteger(order.sizeAtomic, "spot settlement order size");
  const remaining = parseUnsignedInteger(
    order.remainingSizeAtomic,
    "spot settlement order remaining size",
    { allowZero: true },
  );
  const sizeDelta = order.sizeDeltaAtomic === null
    ? null
    : parseUnsignedInteger(order.sizeDeltaAtomic, "spot settlement order size delta", {
        allowZero: true,
      });
  const market = resolvePinnedDecibelSpotMarket(marketAddress);
  if (
    price < BigInt(market.minPriceRaw)
    || price > BigInt(market.maxPriceRaw)
    || price % BigInt(market.tickSizeRaw) !== 0n
    || limitPrice < BigInt(market.minPriceRaw)
    || limitPrice > BigInt(market.maxPriceRaw)
    || limitPrice % BigInt(market.tickSizeRaw) !== 0n
    || size < BigInt(market.minSizeRaw)
    || size % BigInt(market.lotSizeRaw) !== 0n
    || remaining > size
    || remaining % BigInt(market.lotSizeRaw) !== 0n
    || (sizeDelta !== null && (sizeDelta > size || sizeDelta % BigInt(market.lotSizeRaw) !== 0n))
  ) {
    throw new Error("spot settlement response order increments were invalid");
  }
  if (
    (status === "Filled"
      ? (order.isBid ? price > limitPrice : price < limitPrice)
      : price !== limitPrice)
    || (lookup.expectedOrder
      && (
        lookup.expectedOrder.priceAtomic !== limitPrice.toString()
        || lookup.expectedOrder.sizeAtomic !== size.toString()
        || lookup.expectedOrder.isBid !== order.isBid
      ))
  ) {
    throw new Error("spot settlement response did not match the original order identity");
  }
  const cancellationReason = boundedString(
    order.cancellationReason,
    "spot settlement order cancellation reason",
    96,
  );
  if (!SPOT_CANCELLATION_REASONS.has(cancellationReason)) {
    throw new Error("spot settlement order cancellation reason is unknown");
  }
  const details = boundedString(order.details, "spot settlement order details", 512);
  const transactionVersion = parseUnsignedInteger(
    order.transactionVersion,
    "spot settlement order transaction version",
  );
  const transactionTimestampMs = Number(parseUnsignedInteger(
    order.transactionTimestampMs,
    "spot settlement order transaction timestamp",
    { max: BigInt(Number.MAX_SAFE_INTEGER) },
  ));
  if (transactionTimestampMs > nowMs + 2_000) {
    throw new Error("spot settlement order transaction timestamp is in the future");
  }
  return {
    assetType: "spot",
    ownerAddress,
    marketAddress,
    orderId,
    status,
    timeInForce: "IOC",
    isBid: order.isBid,
    priceAtomic: price.toString(),
    limitPriceAtomic: limitPrice.toString(),
    sizeAtomic: size.toString(),
    remainingSizeAtomic: remaining.toString(),
    sizeDeltaAtomic: sizeDelta?.toString() ?? null,
    cancellationReason,
    details,
    transactionVersion: transactionVersion.toString(),
    transactionTimestampMs,
  };
}

function validateNormalizedSettlementExecution(
  value: unknown,
  order: ValidatedDecibelSpotOrderStatus,
): DecibelSpotSettlementExecution {
  const execution = asRecord(value, "spot settlement execution");
  const size = parseUnsignedInteger(execution.sizeAtomic, "spot settlement filled size");
  const quoteAmount = parseUnsignedInteger(
    execution.quoteAmountAtomic,
    "spot settlement quote amount",
  );
  const baseFee = parseUnsignedInteger(execution.baseFeeAtomic, "spot settlement base fee", {
    allowZero: true,
  });
  const quoteFee = parseUnsignedInteger(
    execution.quoteFeeAtomic,
    "spot settlement quote fee",
    { allowZero: true },
  );
  if (
    typeof execution.fillCount !== "number"
    || !Number.isSafeInteger(execution.fillCount)
    || execution.fillCount < 1
    || execution.fillCount > DECIBEL_SPOT_MAX_SETTLEMENT_FILLS
    || size > BigInt(order.sizeAtomic)
    || (order.isBid ? quoteFee !== 0n : baseFee !== 0n)
    || baseFee > size
    || quoteFee > quoteAmount
  ) {
    throw new Error("spot settlement execution was outside reviewed bounds");
  }
  return {
    sizeAtomic: size.toString(),
    quoteAmountAtomic: quoteAmount.toString(),
    baseFeeAtomic: baseFee.toString(),
    quoteFeeAtomic: quoteFee.toString(),
    fillCount: execution.fillCount,
  };
}

export function validateDecibelSpotSettlementResponse(args: {
  value: unknown;
  lookup: DecibelSpotSettlementLookup;
  nowMs?: number;
  maxAgeMs?: number;
}): DecibelSpotSettlementResponse {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_SETTLEMENT_MAX_AGE_MS;
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  const lookup = validateDecibelSpotSettlementLookup({
    ownerAddress: args.lookup.ownerAddress,
    market: args.lookup.marketAddress,
    orderId: args.lookup.orderId,
    expectedOrder: args.lookup.expectedOrder,
  });
  const response = asRecord(args.value, "spot settlement response");
  requireExactBoolean(response.ready, true, "spot settlement ready");
  requireExactString(response.resource, "settlement", "spot settlement resource");
  requireExactString(response.network, "mainnet", "spot settlement network");
  if (
    normalizeDecibelSpotAddress(response.owner, "spot settlement owner") !== lookup.ownerAddress
    || normalizeDecibelSpotAddress(response.marketAddress, "spot settlement market")
      !== lookup.marketAddress
    || normalizeDecibelSpotOrderId(response.orderId) !== lookup.orderId
  ) {
    throw new Error("spot settlement response identity did not match the lookup");
  }
  const ledgerVersion = parseUnsignedInteger(response.ledgerVersion, "spot settlement ledger version");
  const ledgerTimestampMs = parseFreshTimestamp(
    response.ledgerTimestampMs,
    "spot settlement ledger timestamp",
    nowMs,
    maxAgeMs,
  );
  const fetchedAt = parseFreshTimestamp(
    response.fetchedAt,
    "spot settlement fetchedAt",
    nowMs,
    maxAgeMs,
  );
  const expiresAt = Number(parseUnsignedInteger(
    response.expiresAt,
    "spot settlement expiresAt",
    { max: BigInt(Number.MAX_SAFE_INTEGER) },
  ));
  if (
    expiresAt < nowMs
    || expiresAt > ledgerTimestampMs + maxAgeMs
    || expiresAt > fetchedAt + maxAgeMs
  ) {
    throw new Error("spot settlement response is expired or has an invalid freshness bound");
  }
  const rawSettlement = asRecord(response.settlement, "spot settlement");
  const status = rawSettlement.status;
  let settlement: DecibelSpotSettlement;
  if (status === "pending") {
    if (rawSettlement.reason !== "order-processing") {
      throw new Error("spot settlement pending reason is unknown");
    }
    const order = validateNormalizedSettlementOrder(rawSettlement.order, lookup, nowMs);
    settlement = { status, reason: rawSettlement.reason, order };
  } else if (status === "unverified") {
    const reasons = new Set([
      "awaiting-order-history",
      "terminal-proof-awaiting",
      "fills-awaiting-history",
      "incomplete-fill-history",
      "conflicting-state",
    ]);
    if (!reasons.has(String(rawSettlement.reason))) {
      throw new Error("spot settlement unverified reason is unknown");
    }
    const order = rawSettlement.order === null
      ? null
      : validateNormalizedSettlementOrder(rawSettlement.order, lookup, nowMs);
    if (
      (rawSettlement.reason === "awaiting-order-history" && order !== null)
      || (rawSettlement.reason !== "awaiting-order-history" && order === null)
    ) {
      throw new Error("spot settlement unverified state was missing its order record");
    }
    settlement = {
      status,
      reason: rawSettlement.reason as Extract<DecibelSpotSettlement, { status: "unverified" }>["reason"],
      order,
    };
  } else if (status === "filled") {
    const order = validateNormalizedSettlementOrder(rawSettlement.order, lookup, nowMs);
    if (
      (rawSettlement.terminalOrderStatus !== "Filled"
        && rawSettlement.terminalOrderStatus !== "Cancelled")
      || order.status !== rawSettlement.terminalOrderStatus
    ) {
      throw new Error("spot settlement fill terminal status conflicted with its order");
    }
    const execution = validateNormalizedSettlementExecution(rawSettlement.execution, order);
    if (order.status === "Filled" && execution.sizeAtomic !== order.sizeAtomic) {
      throw new Error("filled spot settlement did not account for the full order size");
    }
    settlement = {
      status,
      terminalOrderStatus: rawSettlement.terminalOrderStatus,
      order,
      execution,
    };
  } else if (status === "no-fill") {
    const order = validateNormalizedSettlementOrder(rawSettlement.order, lookup, nowMs);
    if (
      (rawSettlement.terminalOrderStatus !== "Cancelled"
        && rawSettlement.terminalOrderStatus !== "Rejected")
      || order.status !== rawSettlement.terminalOrderStatus
    ) {
      throw new Error("spot no-fill terminal status conflicted with its order");
    }
    settlement = {
      status,
      terminalOrderStatus: rawSettlement.terminalOrderStatus,
      order,
    };
  } else {
    throw new Error("spot settlement status is unknown");
  }
  return {
    ready: true,
    resource: "settlement",
    network: "mainnet",
    owner: lookup.ownerAddress,
    marketAddress: lookup.marketAddress,
    orderId: lookup.orderId,
    settlement,
    ledgerVersion: ledgerVersion.toString(),
    ledgerTimestampMs,
    fetchedAt,
    expiresAt,
  };
}

function validateDepth(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > DECIBEL_SPOT_MAX_BOOK_DEPTH) {
    throw new Error(`depth must be between 1 and ${DECIBEL_SPOT_MAX_BOOK_DEPTH}`);
  }
  return value;
}

function validateLevels(
  raw: unknown,
  side: "bids" | "asks",
  market: ValidatedDecibelSpotMarket,
) {
  const levels = asArray(raw, `orderbook.${side}`);
  if (levels.length > DECIBEL_SPOT_MAX_BOOK_DEPTH) {
    throw new Error(`orderbook.${side} exceeds the bounded depth`);
  }
  const tick = BigInt(market.tickSizeRaw);
  const lot = BigInt(market.lotSizeRaw);
  const minPrice = BigInt(market.minPriceRaw);
  const maxPrice = BigInt(market.maxPriceRaw);
  let prior: bigint | null = null;

  return levels.map((rawLevel, index): ValidatedDecibelSpotLevel => {
    if (!Array.isArray(rawLevel) || rawLevel.length !== 2) {
      throw new Error(`orderbook.${side}[${index}] must be a price/size pair`);
    }
    const priceText = decimalText(rawLevel[0], `orderbook.${side}[${index}].price`);
    const sizeText = decimalText(rawLevel[1], `orderbook.${side}[${index}].size`);
    if (priceText === null || sizeText === null) throw new Error("orderbook level is incomplete");
    const priceRaw = decimalToAtomic(priceText, market.quoteDecimals, `${side}[${index}].price`);
    const sizeRaw = decimalToAtomic(sizeText, market.baseDecimals, `${side}[${index}].size`);
    if (priceRaw === 0n || priceRaw < minPrice || priceRaw > maxPrice || priceRaw % tick !== 0n) {
      throw new Error(`orderbook.${side}[${index}] price is outside the reviewed tick/bounds`);
    }
    if (sizeRaw === 0n || sizeRaw % lot !== 0n) {
      throw new Error(`orderbook.${side}[${index}] size is not a positive lot multiple`);
    }
    if (
      prior !== null &&
      ((side === "bids" && priceRaw >= prior) || (side === "asks" && priceRaw <= prior))
    ) {
      throw new Error(`orderbook.${side} is not strictly price sorted`);
    }
    prior = priceRaw;
    return {
      price: priceText,
      size: sizeText,
      priceRaw: priceRaw.toString(),
      sizeRaw: sizeRaw.toString(),
    };
  });
}

function deriveOrderbookMid(
  market: ValidatedDecibelSpotMarket,
  bids: ValidatedDecibelSpotLevel[],
  asks: ValidatedDecibelSpotLevel[],
) {
  if (bids.length === 0 || asks.length === 0) {
    return null;
  }
  const bestBid = BigInt(bids[0].priceRaw);
  const bestAsk = BigInt(asks[0].priceRaw);
  if (bestBid >= bestAsk) throw new Error("Decibel spot orderbook is crossed");
  // Decibel publishes the market context and the orderbook through separate
  // moving endpoints. An exact comparison races whenever either endpoint
  // advances between reads. The validated best bid/ask are the executable
  // source of truth, so derive the reference midpoint from that same snapshot.
  const exactMidAtExtraDecimal = (bestBid + bestAsk) * 5n;
  return formatDecibelSpotAtomic(
    exactMidAtExtraDecimal,
    market.quoteDecimals + 1,
    market.quoteDecimals + 1,
  );
}

export function validateDecibelSpotOrderbook(args: {
  market: ValidatedDecibelSpotMarket;
  fee: ValidatedDecibelSpotFee;
  orderbook: unknown;
  depth?: number;
  nowMs?: number;
  maxAgeMs?: number;
}): ValidatedDecibelSpotSnapshot {
  const nowMs = args.nowMs ?? Date.now();
  const maxAgeMs = args.maxAgeMs ?? DECIBEL_SPOT_DEFAULT_MAX_AGE_MS;
  const depth = validateDepth(args.depth ?? 25);
  requireNow(nowMs);
  requireMaxAge(maxAgeMs);
  const expected = resolvePinnedDecibelSpotMarket(args.market.marketAddress);
  if (args.market.marketName !== expected.marketName || args.market.mode !== "Open") {
    throw new Error("market identity is not a reviewed open Decibel spot market");
  }
  const book = asRecord(args.orderbook, "orderbook");
  if (
    normalizeDecibelSpotAddress(book.ticker_id, "orderbook.ticker_id") !==
    expected.marketAddress
  ) {
    throw new Error("orderbook ticker_id did not match the selected spot market");
  }
  const bids = validateLevels(book.bids, "bids", args.market);
  const asks = validateLevels(book.asks, "asks", args.market);
  const orderbookMid = deriveOrderbookMid(args.market, bids, asks);
  const orderbookTimestampMs = parseBookTimestamp(book.timestamp, nowMs, maxAgeMs);
  const snapshotTimestampMs = orderbookTimestampMs ?? args.market.contextTimestampMs;
  if (nowMs - snapshotTimestampMs > maxAgeMs) throw new Error("Decibel spot orderbook is stale");
  if (
    args.fee.rateDenominator !== DECIBEL_SPOT_FEE_RATE_DENOMINATOR ||
    nowMs > args.fee.expiresAtMs
  ) {
    throw new Error("Decibel spot taker fee snapshot is stale or invalid");
  }
  const feeRate = parseUnsignedInteger(args.fee.maxTakerFeeRateRaw, "spot taker fee", {
    allowZero: true,
  });
  if (feeRate === 0n || feeRate > DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW) {
    throw new Error("Decibel spot taker fee is outside the reviewed safety bound");
  }

  return {
    network: "mainnet",
    packageAddress: longAddress(MAINNET_DECIBEL_PACKAGE),
    market: {
      ...args.market,
      mid: orderbookMid,
      contextTimestampMs: snapshotTimestampMs,
    },
    snapshotTimestampMs,
    expiresAtMs: Math.min(snapshotTimestampMs + maxAgeMs, args.fee.expiresAtMs),
    timestampSource: orderbookTimestampMs === null ? "spot-context" : "orderbook",
    orderbookTimestampMs,
    fee: args.fee,
    depth,
    bids: bids.slice(0, depth),
    asks: asks.slice(0, depth),
  };
}

function ceilDiv(value: bigint, divisor: bigint) {
  return (value + divisor - 1n) / divisor;
}

function alignDown(value: bigint, increment: bigint) {
  return value - (value % increment);
}

function alignUp(value: bigint, increment: bigint) {
  return ceilDiv(value, increment) * increment;
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function requireU64Result(value: bigint, fieldName: string) {
  if (value < 0n || value > U64_MAX) throw new Error(`${fieldName} exceeds u64`);
  return value;
}

function quoteCost(priceRaw: bigint, sizeRaw: bigint, baseScale: bigint, fieldName: string) {
  const product = priceRaw * sizeRaw;
  if (product % baseScale !== 0n) {
    throw new Error(`${fieldName} cannot be represented exactly in quote atomic units`);
  }
  return requireU64Result(product / baseScale, fieldName);
}

function assertQuoteSnapshot(snapshot: ValidatedDecibelSpotSnapshot, nowMs: number) {
  requireNow(nowMs);
  if (snapshot.network !== "mainnet" || snapshot.packageAddress !== longAddress(MAINNET_DECIBEL_PACKAGE)) {
    throw new Error("snapshot is not from the reviewed Decibel mainnet deployment");
  }
  const expected = resolvePinnedDecibelSpotMarket(snapshot.market.marketAddress);
  const exactFields: Array<keyof PinnedDecibelSpotMarket> = [
    "marketAddress",
    "marketName",
    "baseAssetAddress",
    "quoteAssetAddress",
    "baseDecimals",
    "quoteDecimals",
    "tickSizeRaw",
    "lotSizeRaw",
    "minSizeRaw",
    "minPriceRaw",
    "maxPriceRaw",
  ];
  for (const field of exactFields) {
    if (snapshot.market[field] !== expected[field]) throw new Error(`snapshot market ${field} changed`);
  }
  if (snapshot.market.assetType !== "spot" || snapshot.market.mode !== "Open") {
    throw new Error("snapshot market is not open spot");
  }
  if (
    !Number.isSafeInteger(snapshot.snapshotTimestampMs) ||
    !Number.isSafeInteger(snapshot.expiresAtMs) ||
    snapshot.snapshotTimestampMs > nowMs + 2_000 ||
    nowMs - snapshot.snapshotTimestampMs > DECIBEL_SPOT_DEFAULT_MAX_AGE_MS ||
    snapshot.expiresAtMs > snapshot.snapshotTimestampMs + DECIBEL_SPOT_DEFAULT_MAX_AGE_MS ||
    nowMs > snapshot.expiresAtMs
  ) {
    throw new Error("Decibel spot quote snapshot is stale");
  }
  if (
    snapshot.fee?.rateDenominator !== DECIBEL_SPOT_FEE_RATE_DENOMINATOR ||
    !Number.isSafeInteger(snapshot.fee.ledgerTimestampMs) ||
    !Number.isSafeInteger(snapshot.fee.expiresAtMs) ||
    snapshot.fee.ledgerTimestampMs > nowMs + 2_000 ||
    nowMs - snapshot.fee.ledgerTimestampMs > DECIBEL_SPOT_DEFAULT_MAX_AGE_MS ||
    snapshot.fee.expiresAtMs >
      snapshot.fee.ledgerTimestampMs + DECIBEL_SPOT_DEFAULT_MAX_AGE_MS ||
    snapshot.expiresAtMs > snapshot.fee.expiresAtMs ||
    nowMs > snapshot.fee.expiresAtMs
  ) {
    throw new Error("Decibel spot fee snapshot is stale or malformed");
  }
  const feeRate = parseUnsignedInteger(
    snapshot.fee.maxTakerFeeRateRaw,
    "snapshot spot taker fee",
    { allowZero: true },
  );
  if (feeRate === 0n || feeRate > DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW) {
    throw new Error("snapshot spot taker fee is outside the reviewed safety bound");
  }
  parseUnsignedInteger(snapshot.fee.ledgerVersion, "snapshot fee ledger version");
  if (
    snapshot.bids.length > DECIBEL_SPOT_MAX_BOOK_DEPTH ||
    snapshot.asks.length > DECIBEL_SPOT_MAX_BOOK_DEPTH
  ) {
    throw new Error("snapshot depth is unbounded");
  }
}

function readQuoteLevels(
  levels: ValidatedDecibelSpotLevel[],
  side: "bids" | "asks",
  market: ValidatedDecibelSpotMarket,
) {
  const tick = BigInt(market.tickSizeRaw);
  const lot = BigInt(market.lotSizeRaw);
  const minPrice = BigInt(market.minPriceRaw);
  const maxPrice = BigInt(market.maxPriceRaw);
  let prior: bigint | null = null;
  return levels.map((level, index) => {
    const price = parseUnsignedInteger(level.priceRaw, `${side}[${index}].priceRaw`);
    const size = parseUnsignedInteger(level.sizeRaw, `${side}[${index}].sizeRaw`);
    if (price < minPrice || price > maxPrice || price % tick !== 0n) {
      throw new Error(`${side}[${index}] price is invalid`);
    }
    if (size % lot !== 0n) throw new Error(`${side}[${index}] size is invalid`);
    if (
      prior !== null &&
      ((side === "bids" && price >= prior) || (side === "asks" && price <= prior))
    ) {
      throw new Error(`${side} are not strictly sorted`);
    }
    prior = price;
    return { price, size };
  });
}

function walkExactBase(
  levels: Array<{ price: bigint; size: bigint }>,
  requestedBase: bigint,
  baseScale: bigint,
) {
  let remaining = requestedBase;
  let quote = 0n;
  let worstPrice = 0n;
  for (const level of levels) {
    if (remaining === 0n) break;
    const fill = minBigInt(level.size, remaining);
    quote = requireU64Result(
      quote + quoteCost(level.price, fill, baseScale, "expected quote amount"),
      "expected quote amount",
    );
    remaining -= fill;
    worstPrice = level.price;
  }
  if (remaining !== 0n) throw new Error("Insufficient Decibel spot orderbook depth");
  return { base: requestedBase, quote, worstPrice };
}

function walkBuyBudget(
  asks: Array<{ price: bigint; size: bigint }>,
  budget: bigint,
  lot: bigint,
  baseScale: bigint,
) {
  let remaining = budget;
  let base = 0n;
  let quote = 0n;
  let worstPrice = 0n;
  let exhausted = true;

  for (const level of asks) {
    const affordable = alignDown((remaining * baseScale) / level.price, lot);
    const fill = minBigInt(level.size, affordable);
    if (fill > 0n) {
      const cost = quoteCost(level.price, fill, baseScale, "expected quote amount");
      base += fill;
      quote = requireU64Result(quote + cost, "expected quote amount");
      remaining -= cost;
      worstPrice = level.price;
    }
    if (fill < level.size) {
      exhausted = false;
      break;
    }
  }

  if (base === 0n) throw new Error("Input is too small for one Decibel spot lot");
  if (exhausted) {
    const last = asks.at(-1);
    if (!last) throw new Error("Decibel spot orderbook has no asks");
    const oneLotCost = quoteCost(last.price, lot, baseScale, "one-lot quote amount");
    if (remaining >= oneLotCost) throw new Error("Insufficient Decibel spot orderbook depth");
  }
  return { base, quote, remaining, worstPrice };
}

function chooseProtectedBuyOrder(args: {
  asks: Array<{ price: bigint; size: bigint }>;
  desiredBase: bigint;
  budget: bigint;
  tick: bigint;
  lot: bigint;
  baseScale: bigint;
}) {
  let cumulativeBase = 0n;
  let chosen: { size: bigint; limitPrice: bigint; worstPrice: bigint } | null = null;
  for (const level of args.asks) {
    const priorCumulativeBase = cumulativeBase;
    cumulativeBase += level.size;
    const desiredThroughLevel = minBigInt(args.desiredBase, cumulativeBase);
    const limitPrice = protectedPrice(level.price, args.tick, "buy");
    const collateralSafeSize = alignDown(
      (args.budget * args.baseScale) / limitPrice,
      args.lot,
    );
    const candidateSize = minBigInt(desiredThroughLevel, collateralSafeSize);
    // The candidate only uses this level's limit when it actually reaches it.
    if (candidateSize > priorCumulativeBase) {
      chosen = { size: candidateSize, limitPrice, worstPrice: level.price };
    }
    if (args.desiredBase <= cumulativeBase) break;
  }
  if (!chosen) throw new Error("Input cannot collateralize one protected Decibel spot lot");
  return chosen;
}

function protectedPrice(
  worstPrice: bigint,
  tick: bigint,
  side: DecibelSpotSide,
) {
  if (side === "buy") {
    // Round inward so tick alignment can never widen the promised 0.5% cap.
    return alignDown(
      (worstPrice * (BPS_SCALE + BigInt(DECIBEL_SPOT_MAX_SLIPPAGE_BPS))) / BPS_SCALE,
      tick,
    );
  }
  return alignUp(
    ceilDiv(
      worstPrice * (BPS_SCALE - BigInt(DECIBEL_SPOT_MAX_SLIPPAGE_BPS)),
      BPS_SCALE,
    ),
    tick,
  );
}

function conservativeReceivedAfterFee(gross: bigint, feeRateRaw: bigint) {
  const denominator = BigInt(DECIBEL_SPOT_FEE_RATE_DENOMINATOR);
  const fee = ceilDiv(gross * feeRateRaw, denominator);
  if (fee > gross) throw new Error("Decibel spot fee exceeds received amount");
  return { fee, net: gross - fee };
}

export function quoteDecibelSpotExactInput(args: {
  snapshot: ValidatedDecibelSpotSnapshot;
  side: DecibelSpotSide;
  inputAtomic: string | bigint;
  nowMs?: number;
}): DecibelSpotQuote {
  const nowMs = args.nowMs ?? Date.now();
  assertQuoteSnapshot(args.snapshot, nowMs);
  if (args.side !== "buy" && args.side !== "sell") throw new Error("side must be buy or sell");
  const input = parseUnsignedInteger(args.inputAtomic, "inputAtomic");
  const market = args.snapshot.market;
  const lot = BigInt(market.lotSizeRaw);
  const minSize = BigInt(market.minSizeRaw);
  const tick = BigInt(market.tickSizeRaw);
  const minPrice = BigInt(market.minPriceRaw);
  const maxPrice = BigInt(market.maxPriceRaw);
  const baseScale = 10n ** BigInt(market.baseDecimals);
  const bids = readQuoteLevels(args.snapshot.bids, "bids", market);
  const asks = readQuoteLevels(args.snapshot.asks, "asks", market);
  if (bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price) {
    throw new Error("Decibel spot quote snapshot is crossed");
  }

  let orderSize: bigint;
  let expectedBase: bigint;
  let expectedQuote: bigint;
  let maximumInputEscrow: bigint;
  let uncommittedInput: bigint;
  let unspentAtBook: bigint;
  let worstPrice: bigint;
  let limitPrice: bigint;

  if (args.side === "buy") {
    if (asks.length === 0) throw new Error("Decibel spot orderbook has no asks");
    const budgetWalk = walkBuyBudget(asks, input, lot, baseScale);
    if (budgetWalk.base < minSize) throw new Error("Input is below the Decibel spot minimum order size");
    const protectedOrder = chooseProtectedBuyOrder({
      asks,
      desiredBase: budgetWalk.base,
      budget: input,
      tick,
      lot,
      baseScale,
    });
    worstPrice = protectedOrder.worstPrice;
    limitPrice = protectedOrder.limitPrice;
    if (limitPrice < worstPrice || limitPrice < minPrice || limitPrice > maxPrice) {
      throw new Error("Protected buy price is outside the reviewed market bounds");
    }
    orderSize = protectedOrder.size;
    if (orderSize < minSize) {
      throw new Error("Input cannot collateralize the minimum order at the protected price");
    }
    const fill = walkExactBase(asks, orderSize, baseScale);
    expectedBase = fill.base;
    expectedQuote = fill.quote;
    worstPrice = fill.worstPrice;
    maximumInputEscrow = requireU64Result(
      ceilDiv(limitPrice * orderSize, baseScale),
      "maximum input escrow",
    );
    if (maximumInputEscrow > input) throw new Error("Protected buy escrow exceeds exact input");
    uncommittedInput = input - maximumInputEscrow;
    unspentAtBook = input - expectedQuote;
  } else {
    if (bids.length === 0) throw new Error("Decibel spot orderbook has no bids");
    orderSize = alignDown(input, lot);
    if (orderSize < minSize) throw new Error("Input is below the Decibel spot minimum order size");
    const fill = walkExactBase(bids, orderSize, baseScale);
    expectedBase = fill.base;
    expectedQuote = fill.quote;
    worstPrice = fill.worstPrice;
    limitPrice = protectedPrice(worstPrice, tick, "sell");
    if (limitPrice > worstPrice || limitPrice < minPrice || limitPrice > maxPrice) {
      throw new Error("Protected sell price is outside the reviewed market bounds");
    }
    maximumInputEscrow = orderSize;
    uncommittedInput = input - orderSize;
    unspentAtBook = uncommittedInput;
  }

  requireU64Result(orderSize, "order size");
  requireU64Result(limitPrice, "limit price");
  requireU64Result(expectedBase, "expected base amount");
  requireU64Result(expectedQuote, "expected quote amount");
  const isBuy = args.side === "buy";
  const feeRate = parseUnsignedInteger(
    args.snapshot.fee.maxTakerFeeRateRaw,
    "spot taker fee",
    { allowZero: true },
  );
  const estimatedGrossOutput = isBuy ? expectedBase : expectedQuote;
  const minimumGrossOutputAtFullFill = isBuy
    ? orderSize
    : quoteCost(limitPrice, orderSize, baseScale, "minimum full-fill proceeds");
  const estimatedAfterFee = conservativeReceivedAfterFee(estimatedGrossOutput, feeRate);
  const minimumAfterFee = conservativeReceivedAfterFee(minimumGrossOutputAtFullFill, feeRate);
  return {
    kind: "exact-input",
    side: args.side,
    market,
    snapshotTimestampMs: args.snapshot.snapshotTimestampMs,
    expiresAtMs: args.snapshot.expiresAtMs,
    requestedInputAtomic: input.toString(),
    orderSizeRaw: orderSize.toString(),
    limitPriceRaw: limitPrice.toString(),
    expectedBaseAmountRaw: expectedBase.toString(),
    expectedQuoteAmountRaw: expectedQuote.toString(),
    estimatedInputUsedAtomic: (isBuy ? expectedQuote : expectedBase).toString(),
    estimatedGrossOutputAtomic: estimatedGrossOutput.toString(),
    estimatedNetOutputAtomic: estimatedAfterFee.net.toString(),
    estimatedMaxProtocolFeeAtomic: estimatedAfterFee.fee.toString(),
    minimumNetOutputAtFullFillAtomic: minimumAfterFee.net.toString(),
    maximumProtocolFeeAtFullFillAtomic: minimumAfterFee.fee.toString(),
    maximumInputEscrowAtomic: maximumInputEscrow.toString(),
    uncommittedInputAtomic: uncommittedInput.toString(),
    unspentInputAtQuotedBookAtomic: unspentAtBook.toString(),
    worstQuotedPriceRaw: worstPrice.toString(),
    maxSlippageBps: DECIBEL_SPOT_MAX_SLIPPAGE_BPS,
    timeInForce: "ImmediateOrCancel",
    timeInForceCode: DECIBEL_SPOT_IOC_TIF,
    partialFillPossible: true,
    unfilledSizeCancels: true,
    minimumOutputAtomic: "0",
    protocolFeeIncluded: true,
    protocolFeeAssetAddress: isBuy ? market.baseAssetAddress : market.quoteAssetAddress,
    maxSpotTakerFeeRateRaw: feeRate.toString(),
    spotFeeRateDenominator: DECIBEL_SPOT_FEE_RATE_DENOMINATOR,
  };
}

export function buildDecibelSpotIocPayload(
  quote: DecibelSpotQuote,
  nowMs = Date.now(),
): DecibelSpotEntryPayload {
  requireNow(nowMs);
  if (
    quote.kind !== "exact-input" ||
    (quote.side !== "buy" && quote.side !== "sell") ||
    quote.maxSlippageBps !== DECIBEL_SPOT_MAX_SLIPPAGE_BPS ||
    quote.timeInForceCode !== DECIBEL_SPOT_IOC_TIF ||
    quote.spotFeeRateDenominator !== DECIBEL_SPOT_FEE_RATE_DENOMINATOR ||
    !Number.isSafeInteger(quote.snapshotTimestampMs) ||
    !Number.isSafeInteger(quote.expiresAtMs) ||
    quote.expiresAtMs > quote.snapshotTimestampMs + DECIBEL_SPOT_DEFAULT_MAX_AGE_MS ||
    nowMs > quote.expiresAtMs
  ) {
    throw new Error("quote does not use the reviewed Decibel IOC policy");
  }
  const feeRate = parseUnsignedInteger(quote.maxSpotTakerFeeRateRaw, "quote spot taker fee", {
    allowZero: true,
  });
  if (feeRate === 0n || feeRate > DECIBEL_SPOT_MAX_SUPPORTED_TAKER_FEE_RAW) {
    throw new Error("quote spot taker fee is outside the reviewed safety bound");
  }
  const market = resolvePinnedDecibelSpotMarket(quote.market.marketAddress);
  if (quote.market.marketName !== market.marketName || quote.market.mode !== "Open") {
    throw new Error("quote market is not a reviewed open Decibel spot market");
  }
  const price = parseUnsignedInteger(quote.limitPriceRaw, "limitPriceRaw");
  const size = parseUnsignedInteger(quote.orderSizeRaw, "orderSizeRaw");
  const tick = BigInt(market.tickSizeRaw);
  const lot = BigInt(market.lotSizeRaw);
  if (
    price % tick !== 0n ||
    price < BigInt(market.minPriceRaw) ||
    price > BigInt(market.maxPriceRaw)
  ) {
    throw new Error("limit price is not aligned to the reviewed Decibel market");
  }
  if (size % lot !== 0n || size < BigInt(market.minSizeRaw)) {
    throw new Error("order size is not aligned to the reviewed Decibel market");
  }

  return {
    function: `${longAddress(MAINNET_DECIBEL_PACKAGE)}::dex_accounts_spot_entry::place_spot_order`,
    typeArguments: [],
    functionArguments: [
      market.marketAddress,
      price.toString(),
      size.toString(),
      quote.side === "buy",
      DECIBEL_SPOT_IOC_TIF,
      null,
      null,
    ],
  };
}

export const DECIBEL_MAINNET_SPOT_PACKAGE = longAddress(MAINNET_DECIBEL_PACKAGE);
export const DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION =
  `${DECIBEL_MAINNET_SPOT_PACKAGE}::dex_accounts_spot_entry::place_spot_order` as const;
