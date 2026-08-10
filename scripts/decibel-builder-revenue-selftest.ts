import assert from "node:assert/strict";

import { extractDecibelBuilderFills } from "@/lib/decibel-builder-receipt";
import { getDecibelPackage } from "@/lib/decibel";

const network = "mainnet" as const;
const packageAddress = getDecibelPackage(network);
const expectedAccount = "0xabc";
const builder = "0x3";

function tradeEvent(args: {
  account: string;
  builder?: string;
  builderFeeRaw?: string;
  fillId: string;
}) {
  return {
    type: `${packageAddress}::perp_positions::TradeEvent`,
    data: {
      account: args.account,
      action: { __variant__: "OpenLong" },
      builder_code: args.builder
        ? { vec: [{ builder: args.builder, fees: "100" }] }
        : { vec: [] },
      client_order_id: "42",
      fee: "5000",
      fee_distribution: {
        __variant__: "RegularTrade_V1",
        builder_or_referrer_fees:
          args.builder && args.builderFeeRaw
            ? { vec: [{ address: args.builder, fees: args.builderFeeRaw }] }
            : { vec: [] },
        position_fee_delta: "5000",
        treasury_fee_delta: "-5000",
      },
      fill_id: args.fillId,
      is_taker: true,
      market: { inner: "0xcafe" },
      order_id: "91",
      price: "6490012345678",
      size: "25000000",
      source: { __variant__: "Limit" },
    },
  };
}

const receipt = {
  success: true,
  hash: "0xfeed",
  version: "12345",
  // Aptos fullnode timestamps are microseconds.
  timestamp: "1786300000123456",
  events: [
    { type: "0x1::coin::WithdrawEvent", data: {} },
    tradeEvent({ account: "0xdef", builder, builderFeeRaw: "999", fillId: "6" }),
    tradeEvent({ account: expectedAccount, builder, builderFeeRaw: "1234", fillId: "7" }),
    tradeEvent({ account: expectedAccount, fillId: "8" }),
  ],
};

const fills = extractDecibelBuilderFills({
  transaction: receipt,
  network,
  expectedAccount,
  expectedBuilderAddress: builder,
});

assert.equal(fills.length, 1, "only the expected account's credited builder fill is revenue");
assert.equal(fills[0].eventKey, "12345:2");
assert.equal(fills[0].transactionHash, "0xfeed");
assert.equal(fills[0].transactionUnixMs, "1786300000123");
assert.equal(fills[0].account, `0x${"abc".padStart(64, "0")}`);
assert.equal(fills[0].marketAddress, `0x${"cafe".padStart(64, "0")}`);
assert.equal(fills[0].builderAddress, `0x${"3".padStart(64, "0")}`);
assert.equal(fills[0].builderFeeRaw, "1234");
assert.equal(fills[0].builderFeeChainUnits, "100");
assert.equal(fills[0].priceRaw, "6490012345678");
assert.equal(fills[0].sizeRaw, "25000000");
assert.equal(fills[0].side, "OpenLong");
assert.equal(fills[0].source, "Limit");

assert.deepEqual(
  extractDecibelBuilderFills({ transaction: { ...receipt, success: false }, network }),
  [],
  "failed transactions never create revenue",
);
assert.deepEqual(
  extractDecibelBuilderFills({
    transaction: receipt,
    network,
    expectedAccount,
    expectedBuilderAddress: "0x4",
  }),
  [],
  "a different builder cannot be attributed to us",
);

console.log("decibel builder revenue self-test passed");
