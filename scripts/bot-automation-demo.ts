/**
 * Non-vault automation evidence and current mainnet readiness.
 *
 *   npx tsx scripts/bot-automation-demo.ts
 *
 * This verifies two separate facts without blurring them together:
 * 1. Four immutable Decibel testnet receipts prove that this controlled bot
 *    operator submitted an order, received an OpenLong fill, submitted the
 *    close, and received a CloseLong fill.
 * 2. Fresh mainnet reads plus a zero-submission simulation show how far the
 *    same payload gets against current production state. A simulation is not a
 *    fill and this script never calls signAndSubmitTransaction.
 *
 * Nothing here can spend money: no signAndSubmit, no fund transfer, no faucet.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { MAINNET_CONFIG } from "@/lib/decibel-sdk";
import { MAKER_FEE, TAKER_FEE } from "@/lib/decibel";

const PKG = MAINNET_CONFIG.deployment.package;
const OPERATOR = "0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da";
const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));

const TESTNET_PROOF = {
  network: "testnet",
  market: "BTC/USD",
  sizeDecimals: 8,
  subaccount: "0x715f99951aff850512a320dbffa367ec52b84e145e99c05ea384e21bdf4de10a",
  openSubmission: "0xf2adacb1da10871e04ddee2065b0eaa9364137209bf82e947b12e3d301b0266a",
  openFill: "0x279e9c51b709bcdb8f526d74d607184a96221859e7674bc469556fed68179768",
  closeSubmission: "0x2121f03f84c7282a30d2f56e2798fc81d0f9df507fabe6a13c9b51f30673cfe1",
  closeFill: "0x3086fb6c6276675f20d949e6dcf62913a323db3061ebe778a1540db3566a8eca",
} as const;

type ChainEvent = {
  type: string;
  data: Record<string, unknown>;
};

type UserTransaction = {
  hash: string;
  sender: string;
  success: boolean;
  sequence_number: string;
  vm_status: string;
  payload: {
    function: string;
    arguments: unknown[];
  };
  events: ChainEvent[];
};

const lower = (value: unknown) => String(value ?? "").toLowerCase();
const variant = (value: unknown) =>
  value && typeof value === "object" && "__variant__" in value
    ? String((value as { __variant__: unknown }).__variant__)
    : "";
const objectAddress = (value: unknown) =>
  value && typeof value === "object" && "inner" in value
    ? lower((value as { inner: unknown }).inner)
    : lower(value);
const explorer = (hash: string, network: "testnet" | "mainnet") =>
  `https://explorer.aptoslabs.com/txn/${hash}?network=${network}`;

async function testnetTransaction(hash: string): Promise<UserTransaction> {
  const response = await fetch(`https://api.testnet.aptoslabs.com/v1/transactions/by_hash/${hash}`, {
    cache: "no-store",
  });
  assert.equal(response.ok, true, `testnet receipt ${hash} returned HTTP ${response.status}`);
  return (await response.json()) as UserTransaction;
}

function matchingEvent(
  tx: UserTransaction,
  suffix: "::market_types::OrderEvent" | "::perp_positions::TradeEvent",
  predicate: (data: Record<string, unknown>) => boolean,
) {
  return tx.events.find((event) => event.type.endsWith(suffix) && predicate(event.data));
}

async function verifyTestnetAutomationCycle() {
  const [openSubmission, openFill, closeSubmission, closeFill] = await Promise.all([
    testnetTransaction(TESTNET_PROOF.openSubmission),
    testnetTransaction(TESTNET_PROOF.openFill),
    testnetTransaction(TESTNET_PROOF.closeSubmission),
    testnetTransaction(TESTNET_PROOF.closeFill),
  ]);

  const transactions = [openSubmission, openFill, closeSubmission, closeFill];
  for (const tx of transactions) {
    assert.equal(tx.success, true, `${tx.hash} failed: ${tx.vm_status}`);
    assert.equal(lower(tx.sender), OPERATOR, `${tx.hash} was not submitted by the controlled operator`);
  }
  assert.deepEqual(
    transactions.map((tx) => Number(tx.sequence_number)),
    [14323, 14324, 14325, 14326],
    "the proof receipts are not the expected consecutive operator cycle",
  );

  for (const submission of [openSubmission, closeSubmission]) {
    assert.ok(
      submission.payload.function.endsWith("::dex_accounts_entry::place_order_to_subaccount"),
      `${submission.hash} is not a Decibel delegated order submission`,
    );
    assert.equal(
      objectAddress(submission.payload.arguments[0]),
      TESTNET_PROOF.subaccount,
      `${submission.hash} targeted a different subaccount`,
    );
  }
  assert.equal(openSubmission.payload.arguments[4], true, "open submission was not a bid");
  assert.equal(closeSubmission.payload.arguments[4], false, "close submission was not an ask");

  const openAcknowledgement = matchingEvent(
    openSubmission,
    "::market_types::OrderEvent",
    (data) => lower(data.user) === TESTNET_PROOF.subaccount && variant(data.status) === "ACKNOWLEDGED",
  );
  const closeAcknowledgement = matchingEvent(
    closeSubmission,
    "::market_types::OrderEvent",
    (data) => lower(data.user) === TESTNET_PROOF.subaccount && variant(data.status) === "ACKNOWLEDGED",
  );
  assert.ok(openAcknowledgement, "open order acknowledgement is missing");
  assert.ok(closeAcknowledgement, "close order acknowledgement is missing");

  const openOrderId = String(openAcknowledgement.data.order_id);
  const closeOrderId = String(closeAcknowledgement.data.order_id);
  const openFilledOrder = matchingEvent(
    openFill,
    "::market_types::OrderEvent",
    (data) =>
      String(data.order_id) === openOrderId &&
      lower(data.user) === TESTNET_PROOF.subaccount &&
      variant(data.status) === "FILLED",
  );
  const closeFilledOrder = matchingEvent(
    closeFill,
    "::market_types::OrderEvent",
    (data) =>
      String(data.order_id) === closeOrderId &&
      lower(data.user) === TESTNET_PROOF.subaccount &&
      variant(data.status) === "FILLED",
  );
  assert.ok(openFilledOrder, "the acknowledged open order has no matching FILLED receipt");
  assert.ok(closeFilledOrder, "the acknowledged close order has no matching FILLED receipt");

  const openTrade = matchingEvent(
    openFill,
    "::perp_positions::TradeEvent",
    (data) => lower(data.account) === TESTNET_PROOF.subaccount && variant(data.action) === "OpenLong",
  );
  const closeTrade = matchingEvent(
    closeFill,
    "::perp_positions::TradeEvent",
    (data) => lower(data.account) === TESTNET_PROOF.subaccount && variant(data.action) === "CloseLong",
  );
  assert.ok(openTrade, "OpenLong trade receipt is missing");
  assert.ok(closeTrade, "CloseLong trade receipt is missing");

  return {
    size: Number(openTrade.data.size) / 10 ** TESTNET_PROOF.sizeDecimals,
    openPrice: Number(openTrade.data.price) / 1e6,
    closePrice: Number(closeTrade.data.price) / 1e6,
    openFillId: String(openTrade.data.fill_id),
    closeFillId: String(closeTrade.data.fill_id),
  };
}

const first = <T>(v: unknown): T => (Array.isArray(v) ? (v[0] as T) : (v as T));
const view = (fn: string, args: Array<string | number | boolean>) =>
  aptos.view({ payload: { function: `${PKG}::${fn}` as `${string}::${string}::${string}`, functionArguments: args } });

async function main() {
  const line = () => console.log("─".repeat(66));
  console.log("\n  cash.trading — non-vault automation evidence\n");
  line();

  // ── 1. Immutable execution receipts from the controlled operator ───────
  const proof = await verifyTestnetAutomationCycle();
  console.log("  HISTORICAL EXECUTION RECEIPTS                         TESTNET");
  console.log("  controlled operator ", OPERATOR);
  console.log("  delegated account   ", TESTNET_PROOF.subaccount);
  console.log(`  open fill            OpenLong ${proof.size} BTC @ $${proof.openPrice.toLocaleString()}`);
  console.log(`  close fill           CloseLong ${proof.size} BTC @ $${proof.closePrice.toLocaleString()}`);
  console.log("  open fill id         ", proof.openFillId);
  console.log("  close fill id        ", proof.closeFillId);
  console.log("  order receipt        ", explorer(TESTNET_PROOF.openSubmission, "testnet"));
  console.log("  open fill receipt    ", explorer(TESTNET_PROOF.openFill, "testnet"));
  console.log("  close order receipt  ", explorer(TESTNET_PROOF.closeSubmission, "testnet"));
  console.log("  close fill receipt   ", explorer(TESTNET_PROOF.closeFill, "testnet"));
  console.log("\n  ✅ Verified: signed delegated order → fill → close order → fill.");
  line();

  // ── 2. The automation account, on current mainnet ───────────────────────
  const apt = await aptos.getAccountAPTAmount({ accountAddress: OPERATOR }).catch(() => 0);
  const subaccount = first<string>(await view("dex_accounts::primary_subaccount", [OPERATOR]));
  const collateral = Number(first<string>(await view("perp_engine::get_cross_total_collateral_value", [subaccount])));
  console.log("  operator account   ", OPERATOR);
  console.log("  mainnet gas         ", (apt / 1e8).toFixed(4), "APT");
  console.log("  decibel subaccount ", subaccount);
  console.log("  usdc collateral     ", (collateral / 1e6).toFixed(2), "USDC");
  line();

  // ── 3. Live mainnet market state — the same reads the bot ticks on ───────
  const allMarkets = first<string[]>(await view("perp_engine::list_markets", []));
  const named = await Promise.all(
    allMarkets.map(async (m) => ({ addr: m, name: first<string>(await view("perp_engine::market_name", [m])) })),
  );
  const picked = named.find((m) => m.name === "BTC/USD") ?? named[0];
  const market = picked.addr;
  const name = picked.name;
  const symbol = name.split("/")[0];
  const [markRaw] = (await view("perp_engine::get_mark_and_oracle_price", [market])) as string[];
  const tick = Number(first<string>(await view("perp_engine::market_ticker_size", [market])));
  const lot = Number(first<string>(await view("perp_engine::market_lot_size", [market])));
  const minSize = Number(first<string>(await view("perp_engine::market_min_size", [market])));
  const szDecimals = Number(first<number>(await view("perp_engine::market_sz_decimals", [market])));
  const markPrice = Number(markRaw) / 1e6;
  console.log(`  market              ${name}  (live)`);
  console.log(`  mark price          $${markPrice.toLocaleString()}`);
  console.log(`  tick / lot / min    ${tick} / ${lot} / ${minSize}   szDecimals ${szDecimals}`);
  line();

  // ── 4. The exact order the market-maker strategy builds each tick ────────
  // Reproduces placeMarketMakerOrder: a post-only maker TWAP at the engine's
  // minimum valid clip size.
  const contractSize = Math.max(lot, minSize); // one valid maker clip
  const sizeBase = contractSize / 10 ** szDecimals;
  const notional = sizeBase * markPrice;
  const payload = {
    function: `${PKG}::dex_accounts_entry::place_twap_order_to_subaccount`,
    typeArguments: [] as string[],
    functionArguments: [subaccount, market, contractSize, true, false, 300, 600, undefined, undefined] as unknown[],
  };
  console.log("  planned tick        BUY (maker) — post-only TWAP");
  console.log(`  size                ${sizeBase} ${symbol}   ≈ $${notional.toFixed(2)} notional`);
  console.log(`  entry function      dex_accounts_entry::place_twap_order_to_subaccount`);
  console.log(`  fee economics       maker ${(MAKER_FEE * 100).toFixed(3)}%  vs  taker ${(TAKER_FEE * 100).toFixed(3)}%`);
  console.log(`                      → maker round-trip ${(MAKER_FEE * 2 * 100).toFixed(3)}%; taker round-trip ${(TAKER_FEE * 2 * 100).toFixed(3)}%`);
  line();

  // ── 5. Simulate against mainnet — current chain, zero submission ────────
  const key = (process.env.BOT_OPERATOR_PRIVATE_KEY || "")
    .replace("ed25519-priv-", "").replace(/\\n/g, "").replace(/\n/g, "").trim();
  if (!key) { console.log("  (set BOT_OPERATOR_PRIVATE_KEY to run the on-chain simulation)\n"); return; }
  // The private key is used only to derive the matching public key. Aptos
  // simulation receives that public key; nothing is signed or submitted.
  const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(key) });
  assert.equal(lower(account.accountAddress.toString()), OPERATOR, "BOT_OPERATOR_PRIVATE_KEY does not match OPERATOR");
  const txn = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: payload as Parameters<typeof aptos.transaction.build.simple>[0]["data"],
  });
  const [sim] = await aptos.transaction.simulate.simple({
    signerPublicKey: account.publicKey,
    transaction: txn,
  });

  if (sim.success) {
    console.log("  MAINNET SIMULATION  ✅ VM ACCEPTED — no transaction was submitted");
    console.log(`  gas estimate        ${sim.gas_used} units`);
    console.log("\n  This proves the current payload passes the mainnet VM. It does not");
    console.log("  claim an order was placed or filled. The testnet receipts above are");
    console.log("  the execution proof.\n");
  } else {
    const vm = sim.vm_status || "";
    // 0 collateral: the subaccount was created but never funded, so its trading
    // state (position/margin store) isn't initialized — the deposit initializes
    // it. Either way the blocker is the same: fund it, which is a signed deposit.
    const needsFunding = /INSUFFICIENT|COLLATERAL|MARGIN|BALANCE|OBJECT_DOES_NOT_EXIST/i.test(vm);
    console.log("  MAINNET SIMULATION  reached the VM; the operator account is not trade-ready");
    console.log(`  vm_status           ${vm.replace(/\s+/g, " ").slice(0, 84)}`);
    if (needsFunding) {
      console.log("\n  Current mainnet status:");
      console.log("  • Live market discovery and payload construction completed.");
      console.log(`  • The dedicated operator has ${(apt / 1e8).toFixed(1)} APT for gas but 0 USDC collateral.`);
      console.log("  • Decibel rejected simulation at missing/uninitialized trading state.");
      console.log("  • No mainnet execution or fill is claimed. Funding collateral is a");
      console.log("    separate money-moving action and this proof intentionally does not do it.\n");
    } else {
      throw new Error(`unexpected mainnet simulation failure: ${vm}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
