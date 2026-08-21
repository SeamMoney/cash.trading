import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cashLaunchManifestSha256,
  EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256,
  launchCapital,
  MAINNET_CASH_USDC_RELEASE_ID,
  moduleFingerprint,
  normalizeLaunchAddress,
  validateCashLaunchManifest,
  validateCashSmokeProofPlan,
  verifyAdmin,
  verifyAssetMetadata,
  verifyExactSeededBook,
  verifyFrontendConfig,
  verifyIndexerHealth,
  verifyMarket,
  verifyMarketBootstrap,
  verifyMarketExecutionPolicy,
  verifyMoveManifest,
  verifyPackage,
  verifyPublicDepth,
  verifyPublicTrades,
  verifySafeLiveBook,
  verifySmokeTransaction,
  verifyWalletFunding,
  type DeployedModule,
  type PackageMetadata,
  type RawOrder,
} from "../lib/cash-orderbook-launch";
import {
  MAX_MAINNET_LEDGER_AGE_MS,
  aptosAuthenticatedFetch,
  externalFetch,
  parseFreshMainnetLedgerProof,
  pinnedAptosStateUrl,
  validateMainnetFullnodeUrl,
  verifyVersionAgainstLedgerProof,
} from "./cash-orderbook-launch-preflight";

const manifestFixture = JSON.parse(readFileSync(
  resolve(process.cwd(), "../cash-orderbook/launch/mainnet-cash-usdc.json"),
  "utf8",
)) as unknown;
const manifest = validateCashLaunchManifest(manifestFixture);
const contract = "0xcafe";
const lp = "0xbeef";
const indexerHealthUrl = "https://indexer.cash.trading/health";
const fullnodeUrl = "https://api.mainnet.aptoslabs.com/v1";

assert.deepEqual(launchCapital(manifest), {
  bidAtomic: 249_923_160n,
  askAtomic: 600_000_000_000_000n,
});
assert.equal(manifest.release.id, MAINNET_CASH_USDC_RELEASE_ID);
assert.equal(manifest.release.canonicalSha256, EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256);
assert.equal(cashLaunchManifestSha256(manifestFixture), EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256);

const changedAddress = structuredClone(manifestFixture) as Record<string, Record<string, Record<string, unknown>>>;
changedAddress.assets.cash.metadataAddress = "0x1";
assert.throws(() => validateCashLaunchManifest(changedAddress), /CASH metadata/);
const changedLadder = structuredClone(manifestFixture) as Record<string, Record<string, unknown>>;
changedLadder.liquidity.askPricesAtomic = [
  "13070000", "13080000", "13090000", "13100000", "13120000",
  "13130000", "13140000", "13160000", "13170000", "13190000",
];
assert.throws(() => validateCashLaunchManifest(changedLadder), /Ask ladder/);
const extraField = structuredClone(manifestFixture) as Record<string, unknown>;
extraField.unreviewed = true;
assert.throws(() => validateCashLaunchManifest(extraField), /SHA-256 mismatch/);

assert.doesNotThrow(() => verifyMoveManifest(`
[package]
name = "cash_orderbook"
upgrade_policy = "immutable"
[dependencies.AptosFramework]
rev = "08e31be6a8676fd4afd7250967656fc4249eed8c"
`));
assert.throws(
  () => verifyMoveManifest('[package]\nupgrade_policy = "compatible"\n'),
  /immutable/,
);

const modules: DeployedModule[] = manifest.package.modules.map((name, index) => ({
  name,
  bytecode: `0x${(index + 1).toString(16).padStart(2, "0")}`,
}));
const fingerprint = moduleFingerprint(modules, manifest.package.modules);
const packageMetadata: PackageMetadata = {
  name: "cash_orderbook",
  upgrade_policy: { policy: "2" },
  upgrade_number: "0",
  modules: manifest.package.modules.map((name) => ({ name })),
};
assert.equal(verifyPackage(manifest, [packageMetadata], modules, fingerprint), fingerprint);
assert.throws(
  () => verifyPackage(
    manifest,
    [{ ...packageMetadata, upgrade_policy: { policy: "1" } }],
    modules,
    fingerprint,
  ),
  /immutable/,
);

assert.doesNotThrow(() => verifyAssetMetadata(manifest.assets.cash, {
  name: "CASH",
  symbol: "CASH",
  decimals: 6,
}));
assert.throws(
  () => verifyAssetMetadata(manifest.assets.usdc, { name: "USD Coin", symbol: "USDC", decimals: 6 }),
  /USDC metadata/,
);

const marketInfo = [
  manifest.assets.cash.metadataAddress,
  manifest.assets.usdc.metadataAddress,
  manifest.market.lotSizeAtomic,
  manifest.market.tickSizeAtomic,
  manifest.market.minimumSizeAtomic,
  "0",
  "6",
];
assert.doesNotThrow(() => verifyMarket(manifest, marketInfo, ["0", "0"], [true]));
assert.throws(() => verifyMarket(manifest, marketInfo, ["0", "1"], [true]), /fees/);
const pausedMarketInfo = [...marketInfo];
pausedMarketInfo[5] = "1";
assert.doesNotThrow(() => verifyMarket(manifest, pausedMarketInfo, ["0", "0"], [false], false));
const pendingBootstrap = [
  true,
  lp,
  manifest.liquidity.bidPricesAtomic,
  Array.from({ length: manifest.liquidity.levelsPerSide }, () => manifest.liquidity.bidQuantityPerLevelAtomic),
  manifest.liquidity.askPricesAtomic,
  Array.from({ length: manifest.liquidity.levelsPerSide }, () => manifest.liquidity.askQuantityPerLevelAtomic),
];
assert.doesNotThrow(() => verifyMarketBootstrap(manifest, lp, pendingBootstrap, true));
assert.throws(
  () => verifyMarketBootstrap(manifest, lp, [
    ...pendingBootstrap.slice(0, 2),
    [...manifest.liquidity.bidPricesAtomic].reverse(),
    ...pendingBootstrap.slice(3),
  ], true),
  /sealed LP ladder/,
);
assert.doesNotThrow(() => verifyMarketBootstrap(manifest, lp, [false, "0x0", [], [], [], []], false));
assert.throws(() => verifyMarketBootstrap(manifest, lp, pendingBootstrap, false), /still pending/);
assert.doesNotThrow(() => verifyMarketExecutionPolicy(lp, [lp], ["16"]));
assert.throws(() => verifyMarketExecutionPolicy(lp, ["0x1234"], ["16"]), /designated maker/);
assert.throws(() => verifyMarketExecutionPolicy(lp, [lp], ["17"]), /16-node/);
assert.doesNotThrow(() => verifyAdmin("0xabcd", ["0xabcd"], [false, "0x0"]));
assert.throws(() => verifyAdmin("0xabcd", ["0xabcd"], [true, "0xabcd"]), /handoff/);

const walletBalances = {
  externalCashAtomic: "600000000000000",
  externalUsdcAtomic: "250000000",
  aptAtomic: "50000000",
  internalCashAvailableAtomic: "600000000000000",
  internalCashLockedAtomic: "0",
  internalUsdcAvailableAtomic: "250000000",
  internalUsdcLockedAtomic: "0",
};
assert.doesNotThrow(() => verifyWalletFunding(manifest, walletBalances, "wallet"));
assert.doesNotThrow(() => verifyWalletFunding(manifest, walletBalances, "orderbook"));
assert.throws(
  () => verifyWalletFunding(manifest, {
    ...walletBalances,
    internalUsdcAvailableAtomic: "250000001",
  }, "orderbook"),
  /exactly match/,
  "a duplicated or oversized deposit must fail the activation gate",
);
assert.throws(
  () => verifyWalletFunding(manifest, { ...walletBalances, aptAtomic: "49999999" }, "wallet"),
  /gas threshold/,
);
assert.throws(
  () => verifyWalletFunding(manifest, { ...walletBalances, externalUsdcAtomic: "249999999" }, "wallet"),
  /reviewed 250000000 atomic USDC deposit/,
);

function launchOrder(price: string, isBid: boolean, index: number): RawOrder {
  const quantity = isBid
    ? manifest.liquidity.bidQuantityPerLevelAtomic
    : manifest.liquidity.askQuantityPerLevelAtomic;
  return {
    order_id: String(index),
    owner: lp,
    price,
    original_quantity: quantity,
    remaining_quantity: quantity,
    is_bid: isBid,
    order_type: "3",
    pair_id: "0",
    locked_quote: isBid
      ? ((BigInt(price) * BigInt(quantity)) / 1_000_000_000_000n).toString()
      : "0",
  };
}

const book = [
  manifest.liquidity.bidPricesAtomic.map((price, index) => launchOrder(price, true, index)),
  manifest.liquidity.askPricesAtomic.map((price, index) => launchOrder(price, false, index + 10)),
];
assert.doesNotThrow(() => verifyExactSeededBook(manifest, lp, book));
assert.doesNotThrow(() => verifySafeLiveBook(manifest, book));
const wrongOwnerBook = structuredClone(book);
(wrongOwnerBook[0][0] as RawOrder).owner = "0x1234";
assert.throws(() => verifyExactSeededBook(manifest, lp, wrongOwnerBook), /reviewed LP ladder/);
const crossedBook = structuredClone(book);
(crossedBook[0][0] as RawOrder).price = manifest.liquidity.askPricesAtomic[0];
assert.throws(() => verifySafeLiveBook(manifest, crossedBook), /crossed/);

assert.doesNotThrow(() => verifyFrontendConfig(contract, contract, lp, fingerprint, {
  CASH_ORDERBOOK_CONTRACT_ADDRESS: contract,
  CASH_ORDERBOOK_ADMIN_ADDRESS: contract,
  CASH_ORDERBOOK_LP_ADDRESS: lp,
  CASH_ORDERBOOK_AUDITED_MODULES_SHA256: fingerprint,
  CASH_ORDERBOOK_API_URL: "https://indexer.cash.trading",
  APTOS_NODE_URL_MAINNET: "https://api.mainnet.aptoslabs.com/v1",
  CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN: "",
  NEXT_PUBLIC_DECIBEL_NETWORK: "mainnet",
  DECIBEL_NETWORK: "mainnet",
}, indexerHealthUrl, fullnodeUrl, ""));
assert.throws(() => verifyFrontendConfig(contract, contract, lp, fingerprint, {
  CASH_ORDERBOOK_CONTRACT_ADDRESS: contract,
  CASH_ORDERBOOK_ADMIN_ADDRESS: contract,
  CASH_ORDERBOOK_LP_ADDRESS: lp,
  CASH_ORDERBOOK_AUDITED_MODULES_SHA256: fingerprint,
  CASH_ORDERBOOK_API_URL: "https://indexer.cash.trading",
  APTOS_NODE_URL_MAINNET: "https://api.mainnet.aptoslabs.com/v1",
  CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN: "",
  NEXT_PUBLIC_DECIBEL_NETWORK: "mainnet",
  DECIBEL_NETWORK: "mainnet",
  CASH_ORDERBOOK_DEV_UNSAFE_SKIP_VERIFY: "1",
}, indexerHealthUrl, fullnodeUrl, ""), /Unsafe development/);
assert.throws(() => verifyFrontendConfig(contract, contract, lp, fingerprint, {
  CASH_ORDERBOOK_CONTRACT_ADDRESS: contract,
  CASH_ORDERBOOK_ADMIN_ADDRESS: contract,
  CASH_ORDERBOOK_LP_ADDRESS: lp,
  CASH_ORDERBOOK_AUDITED_MODULES_SHA256: fingerprint,
  CASH_ORDERBOOK_API_URL: "https://indexer.cash.trading",
  APTOS_NODE_URL_MAINNET: "https://api.mainnet.aptoslabs.com/v1",
  CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN: "",
  NEXT_PUBLIC_DECIBEL_NETWORK: "testnet",
  DECIBEL_NETWORK: "mainnet",
}, indexerHealthUrl, fullnodeUrl, ""), /mainnet/);
assert.throws(() => verifyFrontendConfig(contract, contract, lp, fingerprint, {
  CASH_ORDERBOOK_CONTRACT_ADDRESS: contract,
  CASH_ORDERBOOK_ADMIN_ADDRESS: contract,
  CASH_ORDERBOOK_LP_ADDRESS: lp,
  CASH_ORDERBOOK_AUDITED_MODULES_SHA256: fingerprint,
  CASH_ORDERBOOK_API_URL: "https://wrong-indexer.cash.trading",
  APTOS_NODE_URL_MAINNET: "https://api.mainnet.aptoslabs.com/v1",
  CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN: "",
  NEXT_PUBLIC_DECIBEL_NETWORK: "mainnet",
  DECIBEL_NETWORK: "mainnet",
}, indexerHealthUrl, fullnodeUrl, ""), /does not match/);

assert.throws(() => verifyFrontendConfig(contract, contract, lp, fingerprint, {
  CASH_ORDERBOOK_CONTRACT_ADDRESS: contract,
  CASH_ORDERBOOK_ADMIN_ADDRESS: contract,
  CASH_ORDERBOOK_LP_ADDRESS: lp,
  CASH_ORDERBOOK_AUDITED_MODULES_SHA256: fingerprint,
  CASH_ORDERBOOK_API_URL: "https://indexer.cash.trading",
  APTOS_NODE_URL_MAINNET: "https://rpc.example.com/v1",
  CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN: "https://rpc.example.com",
  NEXT_PUBLIC_DECIBEL_NETWORK: "mainnet",
  DECIBEL_NETWORK: "mainnet",
}, indexerHealthUrl, fullnodeUrl, ""), /does not match the reviewed/);

assert.doesNotThrow(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: true,
  lastSuccessfulPollLedgerVersion: "998000",
}, contract, 1_000_000n));
assert.doesNotThrow(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: true,
  lastSuccessfulPollLedgerVersion: "1000001",
}, contract, 1_000_000n));
assert.throws(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: false,
  lastSuccessfulPollLedgerVersion: "1000000",
}, contract, 1_000_000n), /authoritative/);
assert.throws(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: true,
  lastSuccessfulPollLedgerVersion: "1002001",
}, contract, 1_000_000n), /recent/);
assert.throws(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: true,
  lastSuccessfulPollLedgerVersion: "997999",
}, contract, 1_000_000n), /recent/);
assert.throws(() => verifyIndexerHealth({
  status: "ok",
  network: "mainnet",
  contractAddress: contract,
  uptime: 120,
  authoritativeReplayComplete: true,
  lastSuccessfulPollLedgerVersion: "1",
}, contract, 1_000_000n), /recent/);

assert.doesNotThrow(() => verifyPublicDepth({
  ready: true,
  verified: true,
  source: "aptos-executable-prefix-view",
  pairId: 0,
  makerFeeBps: 0,
  takerFeeBps: 0,
  contractAddress: contract,
  depthTruncated: false,
  excludedOwner: null,
  ledgerVersion: "1000000",
  depth: { bids: [{ price: 1 }], asks: [{ price: 2 }] },
  execution: {
    nodeBudget: 16,
    bids: { scannedNodes: 10, hasMoreRawNodes: false },
    asks: { scannedNodes: 10, hasMoreRawNodes: false },
  },
}, contract, manifest));
assert.throws(() => verifyPublicDepth({
  ready: true,
  verified: true,
  source: "aptos-executable-prefix-view",
  pairId: 0,
  makerFeeBps: 0,
  takerFeeBps: 0,
  contractAddress: contract,
  depthTruncated: true,
  excludedOwner: null,
  ledgerVersion: "1000000",
  depth: { bids: [{ price: 1 }], asks: [{ price: 2 }] },
  execution: {
    nodeBudget: 16,
    bids: { scannedNodes: 16, hasMoreRawNodes: true },
    asks: { scannedNodes: 10, hasMoreRawNodes: false },
  },
}, contract, manifest), /attested/);

const publicTrades = {
  ready: true,
  network: "mainnet",
  contractAddress: contract,
  indexedLedgerVersion: "1000000",
  trades: [{
    id: "999900:4",
    txRef: "999900",
    price: 0.00001307,
    size: 10_000,
    side: "buy",
    timestamp: 1_787_030_000_000,
  }, {
    id: "999901:4",
    txRef: "999901",
    price: 0.00001293,
    size: 10_000,
    side: "sell",
    timestamp: 1_787_030_001_000,
  }],
};
assert.doesNotThrow(() => verifyPublicTrades(publicTrades, contract));
assert.doesNotThrow(() => verifyPublicTrades(publicTrades, contract, "999900"));
assert.doesNotThrow(() => verifyPublicTrades(publicTrades, contract, "999900", "buy"));
assert.doesNotThrow(() => verifyPublicTrades(publicTrades, contract, "999901", "sell"));
assert.throws(() => verifyPublicTrades(publicTrades, contract, "999900", "sell"), /smoke sell/);
assert.throws(
  () => verifyPublicTrades({
    ...publicTrades,
    trades: [{ ...publicTrades.trades[0], id: "ephemeral-1", txRef: undefined }],
  }, contract),
  /unstable/,
);
assert.throws(() => verifyPublicTrades(publicTrades, contract, "999902"), /not indexed/);

const smokeSender = "0x123";
const buyHash = `0x${"1".repeat(64)}`;
const sellHash = `0x${"2".repeat(64)}`;
const smokeProofFixture = {
  schemaVersion: 1,
  sender: smokeSender,
  buy: {
    transactionHash: buyHash,
    maxQuoteAtomic: "131354",
    baseQuantityAtomic: manifest.market.minimumSizeAtomic,
    minBaseAtomic: manifest.market.minimumSizeAtomic,
    filledBaseAtomic: manifest.market.minimumSizeAtomic,
    filledQuoteAtomic: "130700",
  },
  sell: {
    transactionHash: sellHash,
    baseAmountAtomic: manifest.market.minimumSizeAtomic,
    minQuoteAtomic: "128653",
    filledBaseAtomic: manifest.market.minimumSizeAtomic,
    filledQuoteAtomic: "129300",
  },
} as const;
const smokeProof = validateCashSmokeProofPlan(smokeProofFixture, manifest);
assert.equal(smokeProof.sender, normalizeLaunchAddress(smokeSender));
assert.throws(() => validateCashSmokeProofPlan({
  ...smokeProofFixture,
  sell: { ...smokeProofFixture.sell, transactionHash: buyHash },
}, manifest), /hashes must be distinct/);
assert.throws(() => validateCashSmokeProofPlan({
  ...smokeProofFixture,
  buy: { ...smokeProofFixture.buy, filledBaseAtomic: "9999999999" },
}, manifest), /fully fill/);
assert.throws(() => validateCashSmokeProofPlan({
  ...smokeProofFixture,
  unreviewed: true,
}, manifest), /unexpected fields/);

function smokeTransaction(direction: "buy" | "sell") {
  const isBuy = direction === "buy";
  return {
    type: "user_transaction",
    hash: isBuy ? buyHash : sellHash,
    version: isBuy ? "999900" : "999901",
    sender: smokeSender,
    success: true,
    vm_status: "Executed successfully",
    payload: {
      type: "entry_function_payload",
      function: `${contract}::order_placement::${isBuy ? "buy_from_wallet" : "sell_from_wallet"}`,
      type_arguments: [],
      arguments: isBuy
        ? [
            "0",
            manifest.assets.usdc.metadataAddress,
            manifest.assets.cash.metadataAddress,
            smokeProof.buy.maxQuoteAtomic,
            smokeProof.buy.baseQuantityAtomic,
            smokeProof.buy.minBaseAtomic,
          ]
        : [
            "0",
            manifest.assets.usdc.metadataAddress,
            manifest.assets.cash.metadataAddress,
            smokeProof.sell.baseAmountAtomic,
            smokeProof.sell.minQuoteAtomic,
          ],
    },
    events: isBuy
      ? [
          {
            type: `${contract}::settlement::TradeEvent`,
            data: {
              pair_id: "0",
              taker_order_id: "10",
              maker_order_id: "11",
              price: "13070000",
              quantity: "5000000000",
              quote_amount: "65350",
              buyer: smokeSender,
              seller: lp,
              taker_is_bid: true,
            },
          },
          {
            type: `${contract}::settlement::TradeEvent`,
            data: {
              pair_id: "0",
              taker_order_id: "10",
              maker_order_id: "12",
              price: "13070000",
              quantity: "5000000000",
              quote_amount: "65350",
              buyer: smokeSender,
              seller: lp,
              taker_is_bid: true,
            },
          },
        ]
      : [{
          type: `${contract}::settlement::TradeEvent`,
          data: {
            pair_id: "0",
            taker_order_id: "13",
            maker_order_id: "14",
            price: "12930000",
            quantity: "10000000000",
            quote_amount: "129300",
            buyer: lp,
            seller: smokeSender,
            taker_is_bid: false,
          },
        }],
  };
}

const buySmokeTransaction = smokeTransaction("buy");
const sellSmokeTransaction = smokeTransaction("sell");
assert.deepEqual(
  verifySmokeTransaction(buySmokeTransaction, contract, manifest, smokeProof, "buy"),
  {
    transactionHash: buyHash,
    version: "999900",
    direction: "buy",
    filledBaseAtomic: "10000000000",
    filledQuoteAtomic: "130700",
  },
);
assert.doesNotThrow(() => (
  verifySmokeTransaction(sellSmokeTransaction, contract, manifest, smokeProof, "sell")
));
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  hash: sellHash,
}, contract, manifest, smokeProof, "buy"), /identity/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  sender: "0x456",
}, contract, manifest, smokeProof, "buy"), /identity/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  payload: { ...buySmokeTransaction.payload, function: `${contract}::order_placement::sell_from_wallet` },
}, contract, manifest, smokeProof, "buy"), /entry function/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  payload: {
    ...buySmokeTransaction.payload,
    arguments: [...buySmokeTransaction.payload.arguments.slice(0, -1), "9999999999"],
  },
}, contract, manifest, smokeProof, "buy"), /payload arguments/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  events: buySmokeTransaction.events.map((event) => ({
    ...event,
    data: { ...event.data, taker_is_bid: false },
  })),
}, contract, manifest, smokeProof, "buy"), /taker and side/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  events: buySmokeTransaction.events.map((event) => ({
    ...event,
    data: { ...event.data, buyer: "0x456" },
  })),
}, contract, manifest, smokeProof, "buy"), /taker and side/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  events: buySmokeTransaction.events.map((event, index) => ({
    ...event,
    data: index === 0
      ? { ...event.data, quantity: "4000000000", quote_amount: "52280" }
      : event.data,
  })),
}, contract, manifest, smokeProof, "buy"), /fill amounts/);
assert.throws(() => verifySmokeTransaction({
  ...buySmokeTransaction,
  success: false,
  vm_status: "Move abort",
}, contract, manifest, smokeProof, "buy"), /failed/);

assert.equal(validateMainnetFullnodeUrl(fullnodeUrl), fullnodeUrl);
assert.throws(
  () => validateMainnetFullnodeUrl("http://api.mainnet.aptoslabs.com/v1"),
  /HTTPS/,
);
assert.throws(
  () => validateMainnetFullnodeUrl("https://fullnode.invalid/v1"),
  /trusted-fullnode-origin/,
);
assert.equal(
  validateMainnetFullnodeUrl("https://node.example/v1", "https://node.example"),
  "https://node.example/v1",
);

const proofNowMs = 1_800_000_000_000;
const ledgerProof = parseFreshMainnetLedgerProof({
  chain_id: "1",
  ledger_version: "1000000",
  ledger_timestamp: String(BigInt(proofNowMs) * 1_000n - 2_000_000n),
}, 1, proofNowMs);
assert.throws(() => parseFreshMainnetLedgerProof({
  chain_id: "1",
  ledger_version: "1000000",
  ledger_timestamp: String(
    BigInt(proofNowMs) * 1_000n - BigInt(MAX_MAINNET_LEDGER_AGE_MS + 1) * 1_000n,
  ),
}, 1, proofNowMs), /stale/);
assert.throws(() => parseFreshMainnetLedgerProof({
  chain_id: "2",
  ledger_version: "1000000",
  ledger_timestamp: String(BigInt(proofNowMs) * 1_000n),
}, 1, proofNowMs), /mainnet chain 1/);

const pinnedViewUrl = new URL(pinnedAptosStateUrl(fullnodeUrl, "", "/view", ledgerProof));
assert.equal(pinnedViewUrl.searchParams.get("ledger_version"), ledgerProof.version.toString());
assert.throws(
  () => pinnedAptosStateUrl(fullnodeUrl, "", "/view?ledger_version=999999", ledgerProof),
  /outside the pinned launch snapshot/,
);
assert.throws(
  () => pinnedAptosStateUrl(
    fullnodeUrl,
    "",
    "/view?ledger_version=1000000&ledger_version=1000000",
    ledgerProof,
  ),
  /outside the pinned launch snapshot/,
);
assert.doesNotThrow(() => verifyVersionAgainstLedgerProof(
  { ledgerVersion: "998000" },
  "ledgerVersion",
  "Public depth endpoint",
  ledgerProof,
));
assert.throws(() => verifyVersionAgainstLedgerProof(
  { ledgerVersion: "997999" },
  "ledgerVersion",
  "Public depth endpoint",
  ledgerProof,
), /pinned Aptos mainnet ledger snapshot/);

async function verifyCredentialIsolation(): Promise<void> {
  const priorApiKey = process.env.APTOS_API_KEY;
  const priorMainnetApiKey = process.env.APTOS_API_KEY_MAINNET;
  const priorCustomApiKey = process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY;
  const originalFetch = globalThis.fetch;
  const observedRequests: Array<{ url: string; authorization: string | null }> = [];
  process.env.APTOS_API_KEY_MAINNET = "launch-preflight-secret";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedRequests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await externalFetch("https://cash.trading/swap", {
      headers: { Authorization: "Bearer launch-preflight-secret" },
    });
    await externalFetch("https://indexer.cash.trading/health");
    await externalFetch("https://api.mainnet.aptoslabs.com/decibel/api/v1/markets");
    await aptosAuthenticatedFetch(fullnodeUrl, "", `${fullnodeUrl}/`);
    delete process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY;
    await aptosAuthenticatedFetch(
      "https://rpc.example.com/v1",
      "https://rpc.example.com",
      "https://rpc.example.com/v1/",
    );
    process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY = "custom-rpc-secret";
    await aptosAuthenticatedFetch(
      "https://rpc.example.com/v1",
      "https://rpc.example.com",
      "https://rpc.example.com/v1/",
    );
    assert.deepEqual(observedRequests, [
      { url: "https://cash.trading/swap", authorization: null },
      { url: "https://indexer.cash.trading/health", authorization: null },
      {
        url: "https://api.mainnet.aptoslabs.com/decibel/api/v1/markets",
        authorization: null,
      },
      { url: "https://api.mainnet.aptoslabs.com/v1/", authorization: "Bearer launch-preflight-secret" },
      { url: "https://rpc.example.com/v1/", authorization: null },
      { url: "https://rpc.example.com/v1/", authorization: "Bearer custom-rpc-secret" },
    ]);
    await assert.rejects(
      aptosAuthenticatedFetch(fullnodeUrl, "", "https://cash.trading/api/cash-orderbook/depth"),
      /outside the trusted fullnode/,
    );
    await assert.rejects(
      aptosAuthenticatedFetch(
        fullnodeUrl,
        "",
        "https://api.mainnet.aptoslabs.com/decibel/api/v1/markets",
      ),
      /outside the trusted fullnode/,
    );
    assert.equal(observedRequests.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorApiKey === undefined) delete process.env.APTOS_API_KEY;
    else process.env.APTOS_API_KEY = priorApiKey;
    if (priorMainnetApiKey === undefined) delete process.env.APTOS_API_KEY_MAINNET;
    else process.env.APTOS_API_KEY_MAINNET = priorMainnetApiKey;
    if (priorCustomApiKey === undefined) delete process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY;
    else process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY = priorCustomApiKey;
  }
}

verifyCredentialIsolation()
  .then(() => console.log("CASH orderbook launch preflight checks passed."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
