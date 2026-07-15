import assert from "node:assert/strict";
import { Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import {
  calculateCashRewardEntitlement,
  serializeCashRewardVoucher,
  type CashRewardVoucher,
} from "../lib/cash-rewards";
import type { DecibelTrade } from "../lib/decibel-api";

const epochStartMs = Date.UTC(2026, 6, 13, 0, 0, 0);
const nowMs = epochStartMs + 3 * 3_600_000;

function trade(overrides: Partial<DecibelTrade>): DecibelTrade {
  return {
    account: "0x1",
    market: "BTC/USD",
    action: "OpenLong",
    trade_id: 1,
    size: 1,
    price: 100,
    is_profit: false,
    realized_pnl_amount: 0,
    is_funding_positive: false,
    realized_funding_amount: 0,
    is_rebate: false,
    fee_amount: 0.1,
    order_id: "1",
    client_order_id: "1",
    transaction_unix_ms: epochStartMs + 3_600_000,
    transaction_version: 10,
    ...overrides,
  };
}

const open = trade({});
const close = trade({
  action: "CloseLong",
  trade_id: 2,
  order_id: "2",
  transaction_version: 11,
  transaction_unix_ms: epochStartMs + 2 * 3_600_000,
  price: 110,
  is_rebate: true,
});
const liquidation = trade({
  action: "Liquidation",
  trade_id: 3,
  order_id: "3",
  transaction_version: 12,
  transaction_unix_ms: epochStartMs + 2.5 * 3_600_000,
  fee_amount: 100,
});

const result = calculateCashRewardEntitlement({
  trades: [open, open, close, liquidation],
  nowMs,
  epochStartMs,
});

assert.equal(result.trades.length, 3, "duplicate fills must be removed");
assert.equal(result.activeDays, 1, "only eligible fill days count");
assert.equal(result.feeUsd, 0.225, "rebates receive the documented 25% multiplier");
assert.equal(result.actualVolumeUsd, 210, "liquidations never add rewarded volume");
assert.equal(result.capitalDollarHours, 2.5, "capital-time integrates only while the position is open");
assert.equal(result.entitlementAtomic, 3_645_000_000n, "reward components must add deterministically");

const capped = calculateCashRewardEntitlement({
  trades: [open, close],
  nowMs,
  epochStartMs,
  walletCapAtomic: 3_000_000_000n,
});
assert.equal(capped.entitlementAtomic, 3_000_000_000n, "wallet cap must clamp cumulative entitlement");

const privateKey = Ed25519PrivateKey.generate();
const voucher: CashRewardVoucher = {
  chainId: 1,
  recipient: "0x1",
  epoch: 2_950n,
  cumulativeAmountAtomic: 3_645_000_000n,
  expiresAtSeconds: 1_800_000_000n,
};
const message = serializeCashRewardVoucher(voucher);
const signature = privateKey.sign(message);
assert.equal(
  privateKey.publicKey().verifySignature({ message, signature }),
  true,
  "the serialized Move voucher must be signable and verifiable",
);

const tampered = serializeCashRewardVoucher({ ...voucher, cumulativeAmountAtomic: 3_646_000_000n });
assert.equal(
  privateKey.publicKey().verifySignature({ message: tampered, signature }),
  false,
  "the signature must bind the cumulative amount",
);

console.log("CASH rewards self-test passed: eligibility, caps, liquidation exclusion, and vouchers.");
