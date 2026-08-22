import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isAptosTransactionHash } from "../lib/cash-orderbook-confirmation";
import {
  classifyDecibelSpotTransaction,
  isExpectedDecibelSpotTransaction,
  parseDecibelSpotTransactionEvents,
  SPOT_ORDER_FUNCTION,
  type DecibelSpotOrderIdentity,
} from "../lib/decibel-spot-confirmation";
import { MAINNET_DECIBEL_PACKAGE } from "../lib/decibel-client";

const OWNER = "0xbeef";
const OTHER_OWNER = "0xdead";
const EXPECTED_MAINNET_PACKAGE =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";
const MARKET = "0x8bdea2abfe7bd637079b5c678ce682d7334e89cb8eae24d97cf9e37bd84c8628";
const OTHER_MARKET = "0xa8d796ad0e4f2d96f133db0ff0528a770cdacce1d8421dc42754806db4d3d2e7";
const METADATA = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";

const expected: DecibelSpotOrderIdentity = {
  ownerAddress: OWNER,
  marketAddress: MARKET,
  priceAtomic: "529000",
  sizeAtomic: "1000000000",
  isBid: true,
};

const reviewedTransaction = {
  sender: OWNER,
  success: true,
  vm_status: "Executed successfully",
  payload: {
    function: SPOT_ORDER_FUNCTION,
    type_arguments: [],
    arguments: [
      { inner: MARKET },
      expected.priceAtomic,
      expected.sizeAtomic,
      expected.isBid,
      2,
      { vec: [] },
      { vec: [] },
    ],
  },
  events: [] as unknown[],
};

function withArgument(index: number, value: unknown) {
  const args = [...reviewedTransaction.payload.arguments];
  args[index] = value as never;
  return {
    ...reviewedTransaction,
    payload: { ...reviewedTransaction.payload, arguments: args },
  };
}

function tradeData(overrides: Record<string, unknown> = {}) {
  return {
    market: MARKET,
    taker: OWNER,
    maker: "0xcafe",
    taker_order_id: "101",
    maker_order_id: "202",
    is_taker_bid: true,
    price: "528900",
    size: "400000000",
    quote_amount: "2115600",
    base_fee: "280000",
    quote_fee: "0",
    ...overrides,
  };
}

function tradeEvent(data: unknown) {
  return {
    type: `${MAINNET_DECIBEL_PACKAGE}::spot_clearinghouse::SpotTradeEvent`,
    data,
  };
}

function pendingEvent(data: unknown) {
  return {
    type: `${MAINNET_DECIBEL_PACKAGE}::spot_pending_cbs_queue::SpotOrderPendingCbsEvent`,
    data,
  };
}

assert.equal(
  MAINNET_DECIBEL_PACKAGE,
  EXPECTED_MAINNET_PACKAGE,
  "the reviewed Decibel mainnet package must not drift silently",
);
assert.equal(
  SPOT_ORDER_FUNCTION,
  `${EXPECTED_MAINNET_PACKAGE}::dex_accounts_spot_entry::place_spot_order`,
  "confirmation must bind the audited mainnet direct-wallet entry function",
);
assert.equal(isAptosTransactionHash(`0x${"ab".repeat(32)}`), true);
assert.equal(isAptosTransactionHash(`0x${"ab".repeat(31)}`), false);
assert.equal(isAptosTransactionHash("ab".repeat(32)), false);

assert.equal(
  isExpectedDecibelSpotTransaction(reviewedTransaction, expected),
  true,
  "the exact sender, package, entry, arguments, IOC code, and empty builder options must verify",
);
assert.equal(
  isExpectedDecibelSpotTransaction({ ...reviewedTransaction, sender: OTHER_OWNER }, expected),
  false,
  "another sender must not verify",
);
assert.equal(
  isExpectedDecibelSpotTransaction({
    ...reviewedTransaction,
    payload: {
      ...reviewedTransaction.payload,
      function: `${MAINNET_DECIBEL_PACKAGE}::dex_accounts_spot_entry::place_spot_bulk_order`,
    },
  }, expected),
  false,
  "another entry function must not verify",
);
assert.equal(isExpectedDecibelSpotTransaction(withArgument(0, { inner: OTHER_MARKET }), expected), false);
assert.equal(isExpectedDecibelSpotTransaction(withArgument(1, "529100"), expected), false);
assert.equal(isExpectedDecibelSpotTransaction(withArgument(2, "999999999"), expected), false);
assert.equal(isExpectedDecibelSpotTransaction(withArgument(3, false), expected), false);
assert.equal(isExpectedDecibelSpotTransaction(withArgument(4, 0), expected), false);
assert.equal(
  isExpectedDecibelSpotTransaction(withArgument(5, { vec: [OWNER] }), expected),
  false,
  "an attributed builder must not verify before that path is reviewed",
);
assert.equal(
  isExpectedDecibelSpotTransaction(withArgument(6, { vec: ["10"] }), expected),
  false,
  "a builder fee must not verify before that path is reviewed",
);
assert.equal(
  isExpectedDecibelSpotTransaction(withArgument(5, null), expected),
  false,
  "a confirmed transaction must contain the canonical empty Move option",
);
assert.equal(
  isExpectedDecibelSpotTransaction({
    ...reviewedTransaction,
    payload: { ...reviewedTransaction.payload, type_arguments: ["0x1::aptos_coin::AptosCoin"] },
  }, expected),
  false,
  "spot order confirmation requires no type arguments",
);

const failedWrongTransaction = {
  ...reviewedTransaction,
  sender: OTHER_OWNER,
  success: false,
  vm_status: "Move abort",
};
assert.equal(
  classifyDecibelSpotTransaction(failedWrongTransaction, expected).status,
  "unverified",
  "identity validation must happen before a failed transaction is classified",
);
assert.deepEqual(
  classifyDecibelSpotTransaction({
    ...reviewedTransaction,
    success: false,
    vm_status: "Move abort in 0x50::spot",
  }, expected),
  { status: "failed", vmStatus: "Move abort in 0x50::spot" },
);

const multiFillTransaction = {
  ...reviewedTransaction,
  events: [
    tradeEvent({ __variant__: "V1", ...tradeData() }),
    tradeEvent({
      V1: tradeData({
        maker: "0xf00d",
        taker_order_id: "102",
        maker_order_id: "203",
        price: "528800",
        size: "600000000",
        quote_amount: "3172800",
        base_fee: "420000",
        quote_fee: "7",
      }),
    }),
    tradeEvent({ __variant__: "V1", ...tradeData({ taker: OTHER_OWNER }) }),
    tradeEvent({ __variant__: "V1", ...tradeData({ market: OTHER_MARKET }) }),
    tradeEvent({ __variant__: "V1", ...tradeData({ is_taker_bid: false }) }),
  ],
};
assert.deepEqual(
  parseDecibelSpotTransactionEvents(multiFillTransaction, expected),
  {
    status: "parsed",
    execution: {
      sizeAtomic: "1000000000",
      quoteAmountAtomic: "5288400",
      baseFeeAtomic: "700000",
      quoteFeeAtomic: "7",
    },
    pending: null,
  },
  "only matching taker, market, and side fills must be summed, including both fee assets",
);
assert.deepEqual(
  classifyDecibelSpotTransaction(multiFillTransaction, expected),
  {
    status: "filled",
    execution: {
      sizeAtomic: "1000000000",
      quoteAmountAtomic: "5288400",
      baseFeeAtomic: "700000",
      quoteFeeAtomic: "7",
    },
  },
);

const fieldsWrapperTransaction = {
  ...reviewedTransaction,
  events: [tradeEvent({
    variant: "V1",
    fields: tradeData({ size: "1000000000", quote_amount: "5289000" }),
  })],
};
assert.equal(
  classifyDecibelSpotTransaction(fieldsWrapperTransaction, expected).status,
  "filled",
  "the common variant/fields wrapper must parse",
);

assert.deepEqual(
  classifyDecibelSpotTransaction(reviewedTransaction, expected),
  { status: "no-fill" },
  "a successful exact IOC with no fill or pending event is a terminal no-fill",
);

const queuedTransaction = {
  ...reviewedTransaction,
  events: [pendingEvent({
    __variant__: "V1",
    order_id: "301",
    withdraw_request_id: "401",
    subaccount_addr: OWNER,
    market: MARKET,
    price: expected.priceAtomic,
    orig_size: expected.sizeAtomic,
    is_bid: expected.isBid,
    metadata: METADATA,
    pfs_balance: "5000000",
    created_at: "1787040000",
  })],
};
assert.deepEqual(
  classifyDecibelSpotTransaction(queuedTransaction, expected),
  {
    status: "pending",
    pending: {
      orderId: "301",
      withdrawRequestId: "401",
      pfsBalanceAtomic: "5000000",
      createdAt: "1787040000",
    },
  },
  "a matching CBS queue event must remain durable pending instead of becoming no-fill",
);

const malformedTrade = {
  ...reviewedTransaction,
  events: [tradeEvent({ __variant__: "V1", ...tradeData({ quote_fee: undefined }) })],
};
assert.equal(
  classifyDecibelSpotTransaction(malformedTrade, expected).status,
  "unverified",
  "a malformed matching event must fail closed",
);
assert.equal(
  classifyDecibelSpotTransaction({
    ...reviewedTransaction,
    events: [tradeEvent({ __variant__: "V2", ...tradeData() })],
  }, expected).status,
  "unverified",
  "an unknown event enum variant must fail closed",
);
assert.deepEqual(
  classifyDecibelSpotTransaction({
    ...reviewedTransaction,
    events: [{
      type: `0xdead::spot_clearinghouse::SpotTradeEvent`,
      data: { __variant__: "V1", ...tradeData() },
    }],
  }, expected),
  { status: "no-fill" },
  "same-named events from another package must not count as fills",
);

const confirmationSource = readFileSync("lib/decibel-spot-confirmation.ts", "utf8");
assert.match(
  confirmationSource,
  /if \(!isAptosTransactionHash\(transactionHash\)\)/,
  "confirmation must apply the exact shared Aptos hash guard before a mainnet request",
);
assert.match(
  confirmationSource,
  /waitForTransaction\(\{[\s\S]*?options:\s*\{\s*checkSuccess:\s*false\s*\}/,
  "confirmation must retrieve failed transactions for identity-first classification",
);

console.log("Decibel spot confirmation identity and event checks passed.");
