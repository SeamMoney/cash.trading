import assert from "node:assert/strict";

import {
  buildCashBuyPayload,
  buildCashMigrationPayload,
  buildCashSellPayload,
  CASH_LEGACY_COIN_TYPE,
  minimumCashBuyCost,
  parseTokenAmountToAtomic,
  quoteCashBuy,
  quoteCashSell,
  type CashOrderbookDepth,
} from "../lib/cash-orderbook";
import {
  depthFromCashOrderbookView,
  parseCashExecutableOrderbookSide,
  parseCashOrderbookSidePage,
  validatedCashOrderbookDepth,
} from "../lib/cash-orderbook-view";
import {
  isExpectedCashMigrationTransaction,
  isExpectedCashSwapTransaction,
  parseCashSwapExecution,
} from "../lib/cash-orderbook-confirmation";

const CONTRACT_ADDRESS = "0xcafe";
const OWNER = "0xbeef";
const depth: CashOrderbookDepth = {
  bids: [
    { price: 0.00001293, quantity: 1_941_000 },
    { price: 0.00001288, quantity: 8_400_000 },
  ],
  asks: [
    { price: 0.00001307, quantity: 12_000_000 },
    { price: 0.00001312, quantity: 48_000_000 },
  ],
};

assert.equal(
  parseTokenAmountToAtomic("250.000001", 6, "USDC amount"),
  "250000001",
  "decimal strings must convert to exact atomic values",
);

const confirmedMigration = {
  sender: OWNER,
  payload: {
    arguments: [],
    function: "0x1::coin::migrate_to_fungible_store",
    type_arguments: [CASH_LEGACY_COIN_TYPE],
  },
};
assert.equal(
  isExpectedCashMigrationTransaction(confirmedMigration, OWNER),
  true,
  "migration confirmation must bind the exact owner, entry function, and legacy CASH type",
);
assert.equal(
  isExpectedCashMigrationTransaction({ ...confirmedMigration, sender: "0xdead" }, OWNER),
  false,
  "another wallet's successful transaction must not confirm migration",
);
assert.equal(
  isExpectedCashMigrationTransaction({
    ...confirmedMigration,
    payload: { ...confirmedMigration.payload, type_arguments: ["0x1::aptos_coin::AptosCoin"] },
  }, OWNER),
  false,
  "another coin migration must not confirm legacy CASH",
);
assert.equal(
  isExpectedCashMigrationTransaction({
    ...confirmedMigration,
    payload: { ...confirmedMigration.payload, arguments: ["unexpected"] },
  }, OWNER),
  false,
  "a migration payload with value arguments must not confirm legacy CASH",
);

const buy = quoteCashBuy("25", depth);
assert.ok(buy, "$25 must produce a buy quote against the fixture book");
assert.equal(buy.cashAmount, 1_912_000, "buy quantity must align down to the 1,000 CASH lot");
assert.equal(buy.cashAmountAtomic, "1912000000000");
assert.equal(buy.usdcSpentAtomic, "24989840");
assert.equal(
  buy.minCashAmountAtomic,
  buy.cashAmountAtomic,
  "buy protection must require the full reviewed CASH amount",
);

const buyPayload = buildCashBuyPayload({
  contractAddress: CONTRACT_ADDRESS,
  quote: buy,
});
assert.deepEqual(
  buyPayload.functionArguments.slice(3),
  [buy.maxUsdcAmountAtomic, "1912000000000", "1912000000000"],
  "the wallet buy must combine its protected quote cap with exact reviewed output",
);
assert.ok(BigInt(buy.maxUsdcAmountAtomic) <= 25_000_000n);
assert.ok(
  (buy.maxUsdcAmount / buy.minCashAmount) / buy.effectivePrice <= 1.0050001,
  "combined buy bounds must never permit more than 0.5% worse unit execution",
);

const sell = quoteCashSell("10500", depth);
assert.ok(sell, "10,500 CASH must produce a lot-aligned sell quote");
assert.equal(sell.cashAmount, 10_000, "sell input must visibly align to the lot size");
assert.equal(sell.cashAmountAtomic, "10000000000");
assert.equal(sell.usdcAmountAtomic, "129300");
assert.equal(sell.minUsdcAmountAtomic, "128653");

const sellPayload = buildCashSellPayload({
  contractAddress: CONTRACT_ADDRESS,
  quote: sell,
});
assert.deepEqual(
  sellPayload.functionArguments.slice(3),
  ["10000000000", "128653"],
  "the wallet sell must use the aligned amount and protected minimum",
);

assert.deepEqual(
  buildCashMigrationPayload(),
  {
    function: "0x1::coin::migrate_to_fungible_store",
    typeArguments: [CASH_LEGACY_COIN_TYPE],
    functionArguments: [],
  },
  "legacy CASH migration must call the Aptos framework's paired-asset migration entry",
);

assert.equal(quoteCashSell("9999.999999", depth), null, "sub-minimum sells must be rejected");
assert.equal(quoteCashBuy("0.01", depth), null, "sub-minimum buys must be rejected");
assert.equal(minimumCashBuyCost(depth), 0.1307, "minimum buy cost must walk the actual asks");

const minimumBuy = quoteCashBuy("0.1307", depth);
assert.ok(minimumBuy);
assert.equal(minimumBuy.cashAmount, 10_000);
assert.equal(
  minimumBuy.minCashAmount,
  10_000,
  "one-lot buys must never present 0.5% protection while permitting a 10% shortfall",
);
assert.ok(
  minimumBuy.priceImpactPct > 0.5 && minimumBuy.priceImpactPct < 0.6,
  "buy price impact must be measured against the bid/ask midpoint",
);
assert.ok(
  minimumBuy.spreadPct > 1 && minimumBuy.spreadPct < 1.1,
  "the quote must expose the full bid/ask spread",
);
assert.equal(minimumBuy.referencePriceAvailable, true);

const roundedBuy = quoteCashBuy("0.14", depth);
assert.ok(roundedBuy);
assert.equal(roundedBuy.usdcSpentAtomic, "130700");
assert.equal(roundedBuy.maxUsdcAmountAtomic, "131354");
assert.equal(roundedBuy.minCashAmountAtomic, roundedBuy.cashAmountAtomic);
assert.ok(
  BigInt(roundedBuy.maxUsdcAmountAtomic) < 140_000n,
  "lot rounding must not turn unused input into hidden price tolerance",
);

const doubleToleranceRegression = quoteCashBuy("2.627069", {
  bids: depth.bids,
  asks: [{ price: 0.00001307, quantity: 1_000_000 }],
});
assert.ok(doubleToleranceRegression);
assert.equal(
  doubleToleranceRegression.minCashAmountAtomic,
  doubleToleranceRegression.cashAmountAtomic,
  "buy-side output and spend tolerances must not compound toward a 1% loss",
);
assert.ok(
  (doubleToleranceRegression.maxUsdcAmount / doubleToleranceRegression.minCashAmount)
    / doubleToleranceRegression.effectivePrice <= 1.0050001,
  "the exact 200-lot regression must enforce the displayed 0.5% effective-price cap",
);

const oneSidedBuy = quoteCashBuy("0.1307", { bids: [], asks: depth.asks });
assert.ok(oneSidedBuy);
assert.equal(
  oneSidedBuy.referencePriceAvailable,
  false,
  "a one-sided book must require review instead of presenting zero-impact confidence",
);

const shallowBuy = quoteCashBuy("250", {
  bids: depth.bids,
  asks: [{ price: 0.00001307, quantity: 10_000 }],
});
assert.ok(shallowBuy);
assert.equal(shallowBuy.sufficientLiquidity, false);
assert.equal(shallowBuy.cashAmount, 10_000, "quotes cannot exceed displayed book liquidity");
assert.equal(
  minimumCashBuyCost({ bids: depth.bids, asks: [{ price: 0.00001307, quantity: 9_000 }] }),
  null,
  "the UI must distinguish a book that cannot satisfy the minimum order",
);
assert.doesNotThrow(
  () => quoteCashBuy("250", {
    bids: depth.bids,
    asks: [{ price: Number.MAX_VALUE, quantity: 10_000 }],
  }),
  "oversized finite levels must be ignored instead of crashing quote rendering",
);

const onChainDepth = depthFromCashOrderbookView([
  [
    {
      order_id: "1",
      owner: "0x1",
      price: "12930000",
      original_quantity: "20000000000",
      remaining_quantity: "12000000000",
      is_bid: true,
      order_type: "0",
      timestamp: "1",
      pair_id: "0",
      locked_quote: "0",
    },
    {
      order_id: "2",
      owner: "0x2",
      price: "12930000",
      original_quantity: "10000000000",
      remaining_quantity: "10000000000",
      is_bid: true,
      order_type: "3",
      timestamp: "2",
      pair_id: "0",
      locked_quote: "0",
    },
  ],
  [
    {
      order_id: "3",
      owner: "0x3",
      price: "13070000",
      original_quantity: "30000000000",
      remaining_quantity: "30000000000",
      is_bid: false,
      order_type: "0",
      timestamp: "3",
      pair_id: "0",
      locked_quote: "0",
    },
  ],
]);
assert.deepEqual(onChainDepth.bids, [
  { price: 0.00001293, quantity: 22_000, total: 22_000 },
]);
assert.deepEqual(onChainDepth.asks, [
  { price: 0.00001307, quantity: 30_000, total: 30_000 },
]);
assert.deepEqual(
  parseCashOrderbookSidePage([[], true, "12930000", "2", "2"]),
  {
    orders: [],
    hasMore: true,
    cursorPrice: "12930000",
    cursorTimestamp: "2",
    cursorOrderId: "2",
  },
  "empty owner-filtered pages must preserve a usable continuation cursor",
);
assert.throws(
  () => parseCashOrderbookSidePage([new Array(101).fill({}), false, "0", "0", "0"]),
  /malformed/,
  "a view page larger than the audited ABI cap must fail closed",
);
assert.deepEqual(
  parseCashExecutableOrderbookSide([[{ order_id: "1" }], "16", true]),
  { orders: [{ order_id: "1" }], scannedNodes: 16, hasMoreRawNodes: true },
  "the executable view must preserve raw-node exhaustion metadata",
);
assert.throws(
  () => parseCashExecutableOrderbookSide([new Array(17).fill({}), "16", false]),
  /malformed/,
  "the client must reject more orders than the audited matcher can inspect",
);
assert.throws(
  () => parseCashExecutableOrderbookSide([[], "15", true]),
  /node budget/,
  "has-more is only valid after the complete 16-node prefix was scanned",
);
assert.doesNotThrow(
  () => depthFromCashOrderbookView([[], [{
    order_id: "4",
    owner: "0x4",
    price: "9007199254750000",
    original_quantity: "10000000000",
    remaining_quantity: "10000000000",
    is_bid: false,
    order_type: "0",
    timestamp: "4",
    pair_id: "0",
    locked_quote: "0",
  }]]),
  "a legal tick-aligned far-tail order must not pause quotes for the whole market",
);
assert.deepEqual(
  depthFromCashOrderbookView([
    [
      {
        order_id: "1",
        owner: "0x1",
        price: "12930000",
        original_quantity: "20000000000",
        remaining_quantity: "12000000000",
        is_bid: true,
        order_type: "0",
        timestamp: "1",
        pair_id: "0",
        locked_quote: "0",
      },
      {
        order_id: "2",
        owner: "0x2",
        price: "12930000",
        original_quantity: "10000000000",
        remaining_quantity: "10000000000",
        is_bid: true,
        order_type: "3",
        timestamp: "2",
        pair_id: "0",
        locked_quote: "0",
      },
    ],
    [],
  ], "0x1").bids,
  [{ price: 0.00001293, quantity: 10_000, total: 10_000 }],
  "the quote must exclude maker liquidity owned by the connected taker wallet",
);
assert.equal(
  validatedCashOrderbookDepth({
    bids: [{ price: 0.00001307, quantity: 10_000 }],
    asks: [{ price: 0.00001293, quantity: 10_000 }],
  }),
  null,
  "crossed books must never reach the swap quote path",
);

const confirmedBuy = {
  sender: OWNER,
  payload: {
    arguments: buyPayload.functionArguments,
    function: `${CONTRACT_ADDRESS}::order_placement::buy_from_wallet`,
    type_arguments: [],
  },
  events: [
    {
      type: `${CONTRACT_ADDRESS}::settlement::TradeEvent`,
      data: {
        pair_id: "0",
        buyer: OWNER,
        seller: "0x1",
        taker_is_bid: true,
        quantity: "10000000000",
        quote_amount: "130700",
      },
    },
    {
      type: `${CONTRACT_ADDRESS}::settlement::TradeEvent`,
      data: {
        pair_id: "0",
        buyer: OWNER,
        seller: "0x2",
        taker_is_bid: true,
        quantity: "20000000000",
        quote_amount: "262400",
      },
    },
    {
      type: `${CONTRACT_ADDRESS}::fees::FeeCollected`,
      data: {
        trader: OWNER,
        is_maker_fee: false,
        amount: "17",
      },
    },
  ],
};
assert.equal(
  isExpectedCashSwapTransaction(confirmedBuy, OWNER, "buy", CONTRACT_ADDRESS),
  true,
  "swap confirmation must bind the owner, contract, entry, pair, assets, and positive arguments",
);
assert.equal(
  isExpectedCashSwapTransaction(
    confirmedBuy,
    OWNER,
    "buy",
    CONTRACT_ADDRESS,
    buyPayload.functionArguments.map(String),
  ),
  true,
  "pending confirmation must bind every reviewed swap argument",
);
assert.equal(
  isExpectedCashSwapTransaction(
    confirmedBuy,
    OWNER,
    "buy",
    CONTRACT_ADDRESS,
    [...buyPayload.functionArguments.slice(0, 5).map(String), "1904000000000"],
  ),
  false,
  "a transaction with different protected economics must not confirm",
);
assert.equal(
  isExpectedCashSwapTransaction({ ...confirmedBuy, sender: "0xdead" }, OWNER, "buy", CONTRACT_ADDRESS),
  false,
  "another sender's transaction must not confirm a swap",
);
assert.equal(
  isExpectedCashSwapTransaction({
    ...confirmedBuy,
    payload: { ...confirmedBuy.payload, function: `${CONTRACT_ADDRESS}::order_placement::sell_from_wallet` },
  }, OWNER, "buy", CONTRACT_ADDRESS),
  false,
  "the opposite swap direction must not confirm",
);
assert.equal(
  isExpectedCashSwapTransaction({
    ...confirmedBuy,
    payload: {
      ...confirmedBuy.payload,
      arguments: [1, ...confirmedBuy.payload.arguments.slice(1)],
    },
  }, OWNER, "buy", CONTRACT_ADDRESS),
  false,
  "another market pair must not confirm",
);
assert.equal(
  isExpectedCashSwapTransaction({
    ...confirmedBuy,
    payload: {
      ...confirmedBuy.payload,
      arguments: [
        confirmedBuy.payload.arguments[0],
        "0xdead",
        ...confirmedBuy.payload.arguments.slice(2),
      ],
    },
  }, OWNER, "buy", CONTRACT_ADDRESS),
  false,
  "different market assets must not confirm",
);
assert.equal(
  isExpectedCashSwapTransaction({
    ...confirmedBuy,
    payload: {
      ...confirmedBuy.payload,
      arguments: [...confirmedBuy.payload.arguments.slice(0, 3), "0", ...confirmedBuy.payload.arguments.slice(4)],
    },
  }, OWNER, "buy", CONTRACT_ADDRESS),
  false,
  "nonpositive swap arguments must not confirm",
);
assert.deepEqual(
  parseCashSwapExecution(confirmedBuy, OWNER, "buy", CONTRACT_ADDRESS),
  {
    baseAmountAtomic: "30000000000",
    quoteAmountAtomic: "393100",
    takerFeeAtomic: "17",
  },
  "confirmed receipts must sum only this wallet's exact CASH contract fills",
);
assert.equal(
  parseCashSwapExecution(confirmedBuy, OWNER, "buy", "0xdead"),
  null,
  "a similarly named entry function from another package must not verify",
);
assert.equal(
  parseCashSwapExecution({
    ...confirmedBuy,
    sender: "0xdead",
  }, OWNER, "buy", CONTRACT_ADDRESS),
  null,
  "a receipt from another sender must not verify",
);
assert.equal(
  parseCashSwapExecution({
    ...confirmedBuy,
    events: [{
      ...confirmedBuy.events[0],
      type: `0xdead::settlement::TradeEvent`,
    }],
  }, OWNER, "buy", CONTRACT_ADDRESS),
  null,
  "a same-named event emitted by another package must not verify",
);

console.log("CASH orderbook quote and payload checks passed.");
