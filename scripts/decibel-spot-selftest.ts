import assert from "node:assert/strict";
import {
  DECIBEL_MAINNET_APT_DECIMALS,
  DECIBEL_MAINNET_APT_METADATA,
  DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION,
  DECIBEL_MAINNET_SPOT_MARKETS,
  DECIBEL_MAINNET_SPOT_PACKAGE,
  DECIBEL_SPOT_FEE_RATE_DENOMINATOR,
  DECIBEL_SPOT_IOC_TIF,
  assembleDecibelSpotBalances,
  buildDecibelSpotIocPayload,
  classifyDecibelSpotSettlement,
  formatDecibelSpotAtomic,
  parseDecibelSpotAmountInput,
  quoteDecibelSpotExactInput,
  validateDecibelMainnetSpotMarkets,
  validateDecibelPrimaryStoreBalanceView,
  validateDecibelSpotLedgerInfo,
  validateDecibelSpotOrderbook,
  validateDecibelSpotOrderStatusResponse,
  validateDecibelSpotSettlementLookup,
  validateDecibelSpotSettlementResponse,
  validateDecibelSpotSourceDate,
  validateDecibelSpotTakerFeeView,
  validateDecibelSpotTerminalTransaction,
  validateDecibelSpotTradeHistory,
  type ValidatedDecibelSpotFee,
  type ValidatedDecibelSpotSnapshot,
} from "../lib/decibel-spot";

const NOW_MS = 1_787_040_000_000;
const FRESH_MS = NOW_MS - 250;
const FRESH_USEC = `${FRESH_MS}000`;
const AUDITED_MAINNET_SPOT_ENTRY =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06::dex_accounts_spot_entry::place_spot_order";

function expectThrow(fn: () => unknown, pattern: RegExp) {
  assert.throws(fn, pattern);
}

function marketRows() {
  return DECIBEL_MAINNET_SPOT_MARKETS.map((market) => ({
    asset_type: "spot",
    market_addr: market.marketAddress,
    market_name: market.marketName,
    sz_decimals: market.baseDecimals,
    max_leverage: 0,
    tick_size: Number(market.tickSizeRaw),
    min_size: Number(market.minSizeRaw),
    lot_size: Number(market.lotSizeRaw),
    max_open_interest: 0,
    px_decimals: market.quoteDecimals,
    mode: "Open",
    unrealized_pnl_haircut_bps: 0,
    category: "",
    min_price: Number(market.minPriceRaw),
    max_price: Number(market.maxPriceRaw),
    is_isolated_only: false,
  }));
}

function contextRows() {
  return DECIBEL_MAINNET_SPOT_MARKETS.map((market) => ({
    market_addr: market.marketAddress,
    name: market.marketName,
    ticker_id: market.marketName.replace("/", "-"),
    base_asset_addr: market.baseAssetAddress,
    quote_asset_addr: market.quoteAssetAddress,
    base_decimals: market.baseDecimals,
    quote_decimals: market.quoteDecimals,
    mid: market.marketName === "BTC/USDC" ? 60000 : 0.55,
    timestamp_unix_ms: FRESH_MS,
  }));
}

function validFee(): ValidatedDecibelSpotFee {
  return validateDecibelSpotTakerFeeView({
    value: [["700", "600", "500", "400", "350", "300", "250"]],
    chainId: "1",
    ledgerVersion: "6803125791",
    ledgerTimestampUsec: FRESH_USEC,
    nowMs: NOW_MS,
  });
}

const fee = validFee();
assert.deepEqual(fee, {
  maxTakerFeeRateRaw: "700",
  rateDenominator: "1000000",
  ledgerVersion: "6803125791",
  ledgerTimestampMs: FRESH_MS,
  expiresAtMs: FRESH_MS + 15_000,
});
assert.equal(DECIBEL_SPOT_FEE_RATE_DENOMINATOR, "1000000");
expectThrow(
  () => validateDecibelSpotTakerFeeView({
    value: [["700"]], chainId: "2", ledgerVersion: "1", ledgerTimestampUsec: FRESH_USEC, nowMs: NOW_MS,
  }),
  /mainnet/,
);
expectThrow(
  () => validateDecibelSpotTakerFeeView({
    value: ["700"], chainId: "1", ledgerVersion: "1", ledgerTimestampUsec: FRESH_USEC, nowMs: NOW_MS,
  }),
  /array/,
);
expectThrow(
  () => validateDecibelSpotTakerFeeView({
    value: [["10001"]], chainId: "1", ledgerVersion: "1", ledgerTimestampUsec: FRESH_USEC, nowMs: NOW_MS,
  }),
  /safety bound/,
);
expectThrow(
  () => validateDecibelSpotTakerFeeView({
    value: [["700"]], chainId: "1", ledgerVersion: "1", ledgerTimestampUsec: `${NOW_MS - 20_000}000`, nowMs: NOW_MS,
  }),
  /stale/,
);

const markets = validateDecibelMainnetSpotMarkets({
  markets: marketRows(),
  contexts: contextRows(),
  nowMs: NOW_MS,
});
assert.equal(markets.length, 2);
assert.equal(markets[0].marketName, "BTC/USDC");
assert.equal(markets[0].assetType, "spot");
assert.equal(markets[1].marketName, "APT/USDC");

for (const [field, value] of [
  ["asset_type", "perp"],
  ["mode", "ReduceOnly"],
  ["market_addr", `0x${"1".repeat(64)}`],
  ["sz_decimals", 7],
  ["px_decimals", 8],
  ["tick_size", 1],
  ["lot_size", 1],
  ["min_size", 1],
] as const) {
  const malformed = marketRows();
  (malformed[0] as Record<string, unknown>)[field] = value;
  expectThrow(
    () => validateDecibelMainnetSpotMarkets({ markets: malformed, contexts: contextRows(), nowMs: NOW_MS }),
    /reviewed|Expected exactly one/,
  );
}

{
  const staleContexts = contextRows();
  staleContexts[0].timestamp_unix_ms = NOW_MS - 20_000;
  expectThrow(
    () => validateDecibelMainnetSpotMarkets({ markets: marketRows(), contexts: staleContexts, nowMs: NOW_MS }),
    /stale/,
  );
}

function btcOrderbook() {
  return {
    ticker_id: markets[0].marketAddress,
    timestamp: "0",
    bids: [
      ["59900", "0.01"],
      ["59800", "0.02"],
    ],
    asks: [
      ["60100", "0.01"],
      ["60200", "0.02"],
    ],
  };
}

function aptOrderbook() {
  return {
    ticker_id: markets[1].marketAddress,
    timestamp: "0",
    bids: [["0.5", "100"]],
    asks: [["0.6", "100"]],
  };
}

const btcSnapshot = validateDecibelSpotOrderbook({
  market: markets[0],
  fee,
  orderbook: btcOrderbook(),
  depth: 25,
  nowMs: NOW_MS,
});
assert.equal(btcSnapshot.timestampSource, "spot-context");
assert.equal(btcSnapshot.snapshotTimestampMs, FRESH_MS);
assert.equal(btcSnapshot.bids[0].priceRaw, "59900000000");
assert.equal(btcSnapshot.asks[0].sizeRaw, "1000000");
assert.equal(btcSnapshot.market.mid, "60000");

const aptSnapshot = validateDecibelSpotOrderbook({
  market: markets[1],
  fee,
  orderbook: aptOrderbook(),
  depth: 1,
  nowMs: NOW_MS,
});
assert.equal(aptSnapshot.bids[0].priceRaw, "500000");
assert.equal(aptSnapshot.asks[0].sizeRaw, "10000000000");
assert.equal(aptSnapshot.market.mid, "0.55");

{
  const staleBook = btcOrderbook();
  staleBook.timestamp = String(NOW_MS - 20_000);
  expectThrow(
    () => validateDecibelSpotOrderbook({ market: markets[0], fee, orderbook: staleBook, nowMs: NOW_MS }),
    /stale/,
  );
}

for (const mutate of [
  (book: ReturnType<typeof btcOrderbook>) => { book.ticker_id = `0x${"2".repeat(64)}`; },
  (book: ReturnType<typeof btcOrderbook>) => { book.bids = [["60100", "0.01"]]; },
  (book: ReturnType<typeof btcOrderbook>) => { book.asks = [["60100.000001", "0.01"]]; },
  (book: ReturnType<typeof btcOrderbook>) => { book.asks = [["60100", "0.0000105"]]; },
  (book: ReturnType<typeof btcOrderbook>) => { book.asks = [["60200", "0.01"], ["60100", "0.01"]]; },
] as const) {
  const book = btcOrderbook();
  mutate(book);
  expectThrow(
    () => validateDecibelSpotOrderbook({ market: markets[0], fee, orderbook: book, nowMs: NOW_MS }),
    /ticker|crossed|tick|lot|sorted/,
  );
}

{
  const tooDeep = btcOrderbook();
  tooDeep.bids = Array.from({ length: 51 }, (_, index) => [String(59900 - index), "0.01"]);
  expectThrow(
    () => validateDecibelSpotOrderbook({ market: markets[0], fee, orderbook: tooDeep, nowMs: NOW_MS }),
    /bounded depth/,
  );
}

{
  const mismatchedMid = structuredClone(markets[0]);
  mismatchedMid.mid = "60001";
  const snapshot = validateDecibelSpotOrderbook({
    market: mismatchedMid,
    fee,
    orderbook: btcOrderbook(),
    nowMs: NOW_MS,
  });
  assert.equal(
    snapshot.market.mid,
    "60000",
    "the executable book midpoint must replace a racing context midpoint",
  );
}

{
  const staleTwoSidedContext = structuredClone(markets[0]);
  const oneSidedBook = btcOrderbook();
  oneSidedBook.asks = [];
  const snapshot = validateDecibelSpotOrderbook({
    market: staleTwoSidedContext,
    fee,
    orderbook: oneSidedBook,
    nowMs: NOW_MS,
  });
  assert.equal(
    snapshot.market.mid,
    null,
    "a one-sided executable book must not retain a stale two-sided midpoint",
  );
}

const btcBuy = quoteDecibelSpotExactInput({
  snapshot: btcSnapshot,
  side: "buy",
  inputAtomic: "100000000",
  nowMs: NOW_MS,
});
assert.equal(btcBuy.limitPriceRaw, "60400000000");
assert.equal(btcBuy.orderSizeRaw, "165500");
assert.equal(btcBuy.expectedQuoteAmountRaw, "99465500");
assert.equal(btcBuy.maximumInputEscrowAtomic, "99962000");
assert.equal(btcBuy.uncommittedInputAtomic, "38000");
assert.equal(btcBuy.estimatedGrossOutputAtomic, "165500");
assert.equal(btcBuy.estimatedMaxProtocolFeeAtomic, "116");
assert.equal(btcBuy.estimatedNetOutputAtomic, "165384");
assert.equal(btcBuy.minimumNetOutputAtFullFillAtomic, "165384");
assert.equal(btcBuy.maxSpotTakerFeeRateRaw, "700");
assert.equal(btcBuy.minimumOutputAtomic, "0");
assert.equal(btcBuy.partialFillPossible, true);

const btcSell = quoteDecibelSpotExactInput({
  snapshot: btcSnapshot,
  side: "sell",
  inputAtomic: "200050",
  nowMs: NOW_MS,
});
assert.equal(btcSell.orderSizeRaw, "200000");
assert.equal(btcSell.uncommittedInputAtomic, "50");
assert.equal(btcSell.limitPriceRaw, "59601000000");
assert.equal(btcSell.expectedQuoteAmountRaw, "119800000");
assert.equal(btcSell.estimatedMaxProtocolFeeAtomic, "83860");
assert.equal(btcSell.estimatedNetOutputAtomic, "119716140");
assert.equal(btcSell.maximumProtocolFeeAtFullFillAtomic, "83442");
assert.equal(btcSell.minimumNetOutputAtFullFillAtomic, "119118558");

const aptBuy = quoteDecibelSpotExactInput({
  snapshot: aptSnapshot,
  side: "buy",
  inputAtomic: "12000000",
  nowMs: NOW_MS,
});
assert.equal(aptBuy.limitPriceRaw, "603000");
assert.equal(aptBuy.orderSizeRaw, "1990000000");
assert.equal(aptBuy.expectedQuoteAmountRaw, "11940000");
assert.equal(aptBuy.maximumInputEscrowAtomic, "11999700");

// A deep price gap must not leave a buy limit based on a level the
// collateral-capped order can no longer reach.
{
  const gappedMarket = structuredClone(markets[0]);
  gappedMarket.mid = "100.5";
  const gappedSnapshot = validateDecibelSpotOrderbook({
    market: gappedMarket,
    fee,
    orderbook: {
      ticker_id: gappedMarket.marketAddress,
      timestamp: "0",
      bids: [["100", "1"]],
      asks: [["101", "1"], ["1000", "1"]],
    },
    nowMs: NOW_MS,
  });
  const quote = quoteDecibelSpotExactInput({
    snapshot: gappedSnapshot,
    side: "buy",
    inputAtomic: "150000000",
    nowMs: NOW_MS,
  });
  assert.equal(quote.orderSizeRaw, "100000000");
  assert.equal(quote.worstQuotedPriceRaw, "101000000");
  assert.equal(quote.limitPriceRaw, "101000000");
  assert.equal(quote.maximumInputEscrowAtomic, "101000000");
  assert.equal(quote.uncommittedInputAtomic, "49000000");
}

const payload = buildDecibelSpotIocPayload(btcBuy, NOW_MS);
assert.equal(payload.function, DECIBEL_MAINNET_SPOT_ENTRY_FUNCTION);
assert.equal(payload.function, AUDITED_MAINNET_SPOT_ENTRY);
assert.deepEqual(payload.typeArguments, []);
assert.deepEqual(payload.functionArguments, [
  markets[0].marketAddress,
  "60400000000",
  "165500",
  true,
  DECIBEL_SPOT_IOC_TIF,
  null,
  null,
]);
assert.equal(payload.function.startsWith(DECIBEL_MAINNET_SPOT_PACKAGE), true);

{
  const shallow = structuredClone(btcSnapshot);
  shallow.asks = [{ price: "60100", size: "0.001", priceRaw: "60100000000", sizeRaw: "100000" }];
  expectThrow(
    () => quoteDecibelSpotExactInput({ snapshot: shallow, side: "buy", inputAtomic: "100000000", nowMs: NOW_MS }),
    /Insufficient/,
  );
  shallow.bids = [{ price: "59900", size: "0.001", priceRaw: "59900000000", sizeRaw: "100000" }];
  expectThrow(
    () => quoteDecibelSpotExactInput({ snapshot: shallow, side: "sell", inputAtomic: "200000", nowMs: NOW_MS }),
    /Insufficient/,
  );
}

{
  const stale = structuredClone(btcSnapshot);
  stale.expiresAtMs = NOW_MS - 1;
  expectThrow(
    () => quoteDecibelSpotExactInput({ snapshot: stale, side: "buy", inputAtomic: "100000000", nowMs: NOW_MS }),
    /stale/,
  );
  expectThrow(() => buildDecibelSpotIocPayload(btcBuy, btcBuy.expiresAtMs + 1), /IOC policy/);
}

{
  const malformedFee = structuredClone(btcSnapshot);
  malformedFee.fee.maxTakerFeeRateRaw = "10001";
  expectThrow(
    () => quoteDecibelSpotExactInput({ snapshot: malformedFee, side: "buy", inputAtomic: "100000000", nowMs: NOW_MS }),
    /safety bound/,
  );
}

{
  const overflowing = structuredClone(btcSnapshot) as ValidatedDecibelSpotSnapshot;
  const largestLotAlignedU64 = ((1n << 64n) - 1n) / 1000n * 1000n;
  overflowing.bids = [{
    price: "10000000",
    size: formatDecibelSpotAtomic(largestLotAlignedU64, 8),
    priceRaw: markets[0].maxPriceRaw,
    sizeRaw: largestLotAlignedU64.toString(),
  }];
  overflowing.asks = [];
  expectThrow(
    () => quoteDecibelSpotExactInput({
      snapshot: overflowing,
      side: "sell",
      inputAtomic: largestLotAlignedU64,
      nowMs: NOW_MS,
    }),
    /exceeds u64/,
  );
  expectThrow(
    () => quoteDecibelSpotExactInput({
      snapshot: btcSnapshot,
      side: "buy",
      inputAtomic: "18446744073709551616",
      nowMs: NOW_MS,
    }),
    /range/,
  );
}

assert.equal(parseDecibelSpotAmountInput(" 1.234567 ", 6), "1234567");
assert.equal(parseDecibelSpotAmountInput("0.00001", 8), "1000");
assert.equal(formatDecibelSpotAtomic("123456789", 6), "123.456789");
assert.equal(formatDecibelSpotAtomic("123456789", 6, 2), "123.45");
assert.equal(formatDecibelSpotAtomic("100000000", 8, 8), "1");
assert.equal(formatDecibelSpotAtomic("0", 6), "0");
expectThrow(() => parseDecibelSpotAmountInput("1e3", 6), /plain decimal/);
expectThrow(() => parseDecibelSpotAmountInput("-1", 6), /plain decimal/);
expectThrow(() => parseDecibelSpotAmountInput("0.0000001", 6), /more than 6/);
expectThrow(() => formatDecibelSpotAtomic("1", 6, 7), /maxDisplayDecimals/);

const aptBalance = validateDecibelPrimaryStoreBalanceView({
  value: ["123456789"],
  metadataAddress: DECIBEL_MAINNET_APT_METADATA,
  decimals: DECIBEL_MAINNET_APT_DECIMALS,
  chainId: "1",
  ledgerVersion: "6803125800",
  ledgerTimestampUsec: FRESH_USEC,
  nowMs: NOW_MS,
});
const usdcBalance = validateDecibelPrimaryStoreBalanceView({
  value: ["250000000"],
  metadataAddress: markets[1].quoteAssetAddress,
  decimals: markets[1].quoteDecimals,
  chainId: "1",
  ledgerVersion: "6803125801",
  ledgerTimestampUsec: FRESH_USEC,
  nowMs: NOW_MS,
});
const balances = assembleDecibelSpotBalances({
  ownerAddress: "0x123",
  market: DECIBEL_MAINNET_SPOT_MARKETS[1],
  base: aptBalance,
  quote: usdcBalance,
  gas: aptBalance,
});
assert.equal(balances.ownerAddress, `0x${"123".padStart(64, "0")}`);
assert.equal(balances.base.atomic, "123456789");
assert.equal(balances.quote.atomic, "250000000");
assert.equal(balances.gas.atomic, "123456789");
assert.equal(balances.cbsIncluded, false);
expectThrow(
  () => validateDecibelPrimaryStoreBalanceView({
    value: ["1"], metadataAddress: DECIBEL_MAINNET_APT_METADATA, decimals: 8,
    chainId: "2", ledgerVersion: "1", ledgerTimestampUsec: FRESH_USEC, nowMs: NOW_MS,
  }),
  /mainnet/,
);
expectThrow(
  () => validateDecibelPrimaryStoreBalanceView({
    value: ["18446744073709551616"], metadataAddress: DECIBEL_MAINNET_APT_METADATA, decimals: 8,
    chainId: "1", ledgerVersion: "1", ledgerTimestampUsec: FRESH_USEC, nowMs: NOW_MS,
  }),
  /range/,
);

// CBS settlement recovery is deliberately fail-closed. Decibel's pending-queue
// read functions are public but not Aptos views, so an exact IOC order plus
// complete, account-scoped fill history is required before the UI can unlock.
const settlementOwner = `0x${"123".padStart(64, "0")}`;
const settlementMarket = DECIBEL_MAINNET_SPOT_MARKETS[1];
const settlementOrderId = "170141599249866110150152371761584275456";
const settlementLookup = validateDecibelSpotSettlementLookup({
  ownerAddress: "0x123",
  market: "APT/USDC",
  orderId: settlementOrderId,
  expectedOrder: {
    priceAtomic: "1000000",
    sizeAtomic: "2000000000",
    isBid: false,
  },
});
assert.equal(settlementLookup.ownerAddress, settlementOwner);
assert.equal(settlementLookup.marketAddress, settlementMarket.marketAddress);
assert.equal(settlementLookup.orderId, settlementOrderId);

const settlementLedger = validateDecibelSpotLedgerInfo({
  value: {
    chain_id: 1,
    ledger_version: "6803125901",
    ledger_timestamp: FRESH_USEC,
  },
  chainId: "1",
  ledgerVersion: "6803125901",
  ledgerTimestampUsec: FRESH_USEC,
  nowMs: NOW_MS,
});
assert.equal(settlementLedger.ledgerVersion, "6803125901");
assert.equal(settlementLedger.ledgerTimestampMs, FRESH_MS);
expectThrow(
  () => validateDecibelSpotLedgerInfo({
    value: {
      chain_id: 1,
      ledger_version: "6803125900",
      ledger_timestamp: FRESH_USEC,
    },
    chainId: "1",
    ledgerVersion: "6803125901",
    ledgerTimestampUsec: FRESH_USEC,
    nowMs: NOW_MS,
  }),
  /conflicted/,
);

assert.deepEqual(
  classifyDecibelSpotSettlement({
    order: null,
    terminalProof: null,
    trades: null,
  }),
  { status: "unverified", reason: "awaiting-order-history", order: null },
);
const orderStatusBody = {
  status: "Cancelled",
  details: "",
  order: {
    asset_type: "spot",
    parent: "",
    market: settlementMarket.marketAddress,
    client_order_id: "",
    order_id: settlementOrderId,
    status: "Cancelled",
    order_type: "",
    trigger_condition: "",
    order_direction: "Sell",
    orig_size: 20,
    remaining_size: 0,
    size_delta: 10,
    price: 1,
    is_buy: false,
    is_reduce_only: false,
    details: "",
    is_tpsl: false,
    tp_trigger_price: null,
    tp_limit_price: null,
    sl_trigger_price: null,
    sl_limit_price: null,
    cancellation_reason: "IOCViolation",
    transaction_version: 6803125890,
    unix_ms: NOW_MS - 1_000,
    time_in_force: "IOC",
  },
};
const validatedOrder = validateDecibelSpotOrderStatusResponse({
  value: orderStatusBody,
  lookup: settlementLookup,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(validatedOrder.status, "Cancelled");
assert.equal(validatedOrder.sizeAtomic, "2000000000");

const filledOrderBody = structuredClone(orderStatusBody);
filledOrderBody.status = "Filled";
filledOrderBody.order.status = "Filled";
filledOrderBody.order.price = 1.1;
filledOrderBody.order.size_delta = 20;
filledOrderBody.order.cancellation_reason = "";
const filledOrder = validateDecibelSpotOrderStatusResponse({
  value: filledOrderBody,
  lookup: settlementLookup,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(filledOrder.priceAtomic, "1100000");
assert.equal(filledOrder.limitPriceAtomic, "1000000");

const terminalTransactionBody = {
  type: "user_transaction",
  version: validatedOrder.transactionVersion,
  timestamp: `${validatedOrder.transactionTimestampMs}000`,
  success: true,
  vm_status: "Executed successfully",
  events: [{
    type: `${DECIBEL_MAINNET_SPOT_PACKAGE}::market_types::OrderEvent`,
    data: {
      __variant__: "V1",
      cancellation_reason: { vec: [{ __variant__: "IOCViolation" }] },
      client_order_id: { vec: [] },
      details: "",
      is_bid: false,
      is_taker: false,
      market: settlementMarket.marketAddress,
      metadata_bytes: "0x",
      order_id: settlementOrderId,
      orig_size: "2000000000",
      parent: settlementOwner,
      price: "1000000",
      remaining_size: "0",
      size_delta: "1000000000",
      status: { __variant__: "CANCELLED" },
      time_in_force: { __variant__: "IOC" },
      trigger_condition: { vec: [] },
      user: settlementOwner,
    },
  }],
};
const terminalProof = validateDecibelSpotTerminalTransaction({
  value: terminalTransactionBody,
  order: validatedOrder,
  chainId: "1",
  ledgerVersion: settlementLedger.ledgerVersion,
  ledgerTimestampUsec: FRESH_USEC,
  nowMs: NOW_MS,
});
assert.equal(terminalProof.ownerAddress, settlementOwner);
assert.equal(terminalProof.terminalOrderStatus, "Cancelled");
{
  const malformed = structuredClone(terminalTransactionBody);
  malformed.events[0].data.user = `0x${"999".padStart(64, "0")}`;
  expectThrow(
    () => validateDecibelSpotTerminalTransaction({
      value: malformed,
      order: validatedOrder,
      chainId: "1",
      ledgerVersion: settlementLedger.ledgerVersion,
      ledgerTimestampUsec: FRESH_USEC,
      nowMs: NOW_MS,
    }),
    /owner-bound/,
  );
}

const tradeHistoryBody = {
  items: [{
    asset_type: "spot",
    account: settlementOwner,
    market: settlementMarket.marketAddress,
    action: "Sell",
    source: "OrderFill",
    trade_id: "124410174617874044055485153316",
    size: 10,
    price: 1,
    is_profit: false,
    realized_pnl_amount: 0,
    realized_funding_amount: 0,
    is_rebate: false,
    fee_amount: 0.006,
    fee_asset: settlementMarket.quoteAssetAddress,
    order_id: settlementOrderId,
    client_order_id: "",
    transaction_unix_ms: NOW_MS - 1_500,
    transaction_version: 6803125880,
    counter_party_account: `0x${"456".padStart(64, "0")}`,
  }],
  total_count: 1,
};
const validatedTrades = validateDecibelSpotTradeHistory({
  value: tradeHistoryBody,
  order: validatedOrder,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(validatedTrades.complete, true);
assert.deepEqual(validatedTrades.execution, {
  sizeAtomic: "1000000000",
  quoteAmountAtomic: "10000000",
  baseFeeAtomic: "0",
  quoteFeeAtomic: "6000",
  fillCount: 1,
});
const multiPriceTradeHistory = structuredClone(tradeHistoryBody);
multiPriceTradeHistory.items[0].price = 1.05;
multiPriceTradeHistory.items.push({
  ...multiPriceTradeHistory.items[0],
  trade_id: "124410174617874044055485153317",
  price: 1.15,
  transaction_version: 6803125881,
});
multiPriceTradeHistory.total_count = 2;
const multiPriceTrades = validateDecibelSpotTradeHistory({
  value: multiPriceTradeHistory,
  order: filledOrder,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(multiPriceTrades.complete, true);
assert.deepEqual(multiPriceTrades.execution, {
  sizeAtomic: "2000000000",
  quoteAmountAtomic: "22000000",
  baseFeeAtomic: "0",
  quoteFeeAtomic: "12000",
  fillCount: 2,
});
const partialFillSettlement = classifyDecibelSpotSettlement({
  order: validatedOrder,
  terminalProof,
  trades: validatedTrades,
});
assert.equal(partialFillSettlement.status, "filled");
if (partialFillSettlement.status === "filled") {
  assert.equal(partialFillSettlement.terminalOrderStatus, "Cancelled");
  assert.equal(partialFillSettlement.execution.sizeAtomic, "1000000000");
}

const recentNoFillTrades = validateDecibelSpotTradeHistory({
  value: { items: [], total_count: 0 },
  order: validatedOrder,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(
  classifyDecibelSpotSettlement({
    order: validatedOrder,
    terminalProof,
    trades: recentNoFillTrades,
  }).status,
  "unverified",
);
const zeroFillOrder = {
  ...validatedOrder,
  sizeDeltaAtomic: validatedOrder.sizeAtomic,
};
const zeroFillTransactionBody = structuredClone(terminalTransactionBody);
zeroFillTransactionBody.events[0].data.size_delta = validatedOrder.sizeAtomic;
const zeroFillProof = validateDecibelSpotTerminalTransaction({
  value: zeroFillTransactionBody,
  order: zeroFillOrder,
  chainId: "1",
  ledgerVersion: settlementLedger.ledgerVersion,
  ledgerTimestampUsec: FRESH_USEC,
  nowMs: NOW_MS,
});
const noFillTrades = validateDecibelSpotTradeHistory({
  value: { items: [], total_count: 0 },
  order: zeroFillOrder,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.deepEqual(
  classifyDecibelSpotSettlement({
    order: zeroFillOrder,
    terminalProof: zeroFillProof,
    trades: noFillTrades,
  }).status,
  "no-fill",
);
const incompleteTrades = validateDecibelSpotTradeHistory({
  value: { items: tradeHistoryBody.items },
  order: validatedOrder,
  sourceReadAtMs: FRESH_MS,
  nowMs: NOW_MS,
});
assert.equal(incompleteTrades.complete, false);
assert.equal(
  classifyDecibelSpotSettlement({
    order: validatedOrder,
    terminalProof,
    trades: incompleteTrades,
  }).status,
  "unverified",
);
assert.deepEqual(classifyDecibelSpotSettlement({
  order: { ...validatedOrder, status: "Open" },
  terminalProof: null,
  trades: null,
}), {
  status: "pending",
  reason: "order-processing",
  order: { ...validatedOrder, status: "Open" },
});
assert.deepEqual(classifyDecibelSpotSettlement({
  order: validatedOrder,
  terminalProof: null,
  trades: validatedTrades,
}), {
  status: "unverified",
  reason: "terminal-proof-awaiting",
  order: validatedOrder,
});

for (const [field, value, pattern] of [
  ["asset_type", "perp", /asset_type/],
  ["time_in_force", "GTC", /time_in_force/],
  ["market", DECIBEL_MAINNET_SPOT_MARKETS[0].marketAddress, /market or order ID/],
] as const) {
  const malformed = structuredClone(orderStatusBody);
  (malformed.order as Record<string, unknown>)[field] = value;
  expectThrow(
    () => validateDecibelSpotOrderStatusResponse({
      value: malformed,
      lookup: settlementLookup,
      sourceReadAtMs: FRESH_MS,
      nowMs: NOW_MS,
    }),
    pattern,
  );
}
{
  const malformed = structuredClone(tradeHistoryBody);
  malformed.items[0].account = `0x${"999".padStart(64, "0")}`;
  expectThrow(
    () => validateDecibelSpotTradeHistory({
      value: malformed,
      order: validatedOrder,
      sourceReadAtMs: FRESH_MS,
      nowMs: NOW_MS,
    }),
    /identity/,
  );
}
{
  const malformed = structuredClone(tradeHistoryBody);
  malformed.items[0].price = 0.9;
  expectThrow(
    () => validateDecibelSpotTradeHistory({
      value: malformed,
      order: validatedOrder,
      sourceReadAtMs: FRESH_MS,
      nowMs: NOW_MS,
    }),
    /IOC limit/,
  );
}

const sourceDateMs = validateDecibelSpotSourceDate(
  new Date(FRESH_MS - (FRESH_MS % 1_000)).toUTCString(),
  NOW_MS,
);
assert.equal(sourceDateMs, FRESH_MS - (FRESH_MS % 1_000));
expectThrow(
  () => validateDecibelSpotSourceDate(
    new Date(NOW_MS - 30_000).toUTCString(),
    NOW_MS,
  ),
  /stale/,
);

const settlementResponse = {
  ready: true,
  resource: "settlement",
  network: "mainnet",
  owner: settlementOwner,
  marketAddress: settlementMarket.marketAddress,
  orderId: settlementOrderId,
  settlement: partialFillSettlement,
  ledgerVersion: settlementLedger.ledgerVersion,
  ledgerTimestampMs: settlementLedger.ledgerTimestampMs,
  fetchedAt: NOW_MS - 100,
  expiresAt: FRESH_MS + 15_000,
};
assert.equal(
  validateDecibelSpotSettlementResponse({
    value: settlementResponse,
    lookup: settlementLookup,
    nowMs: NOW_MS,
  }).settlement.status,
  "filled",
);
{
  const malformed = structuredClone(settlementResponse);
  malformed.orderId = "1";
  expectThrow(
    () => validateDecibelSpotSettlementResponse({
      value: malformed,
      lookup: settlementLookup,
      nowMs: NOW_MS,
    }),
    /identity/,
  );
}

console.log("Decibel mainnet spot primitive self-test passed");
