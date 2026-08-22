import { createHash } from "node:crypto";

export interface CashLaunchManifest {
  schemaVersion: number;
  network: "mainnet";
  chainId: number;
  release: {
    id: "cash-usdc-mainnet-v1";
    canonicalSha256: string;
  };
  package: {
    name: string;
    upgradePolicy: number;
    upgradeNumber: number;
    modules: string[];
  };
  assets: {
    cash: LaunchAsset;
    usdc: LaunchAsset;
  };
  market: {
    pairId: number;
    lotSizeAtomic: string;
    tickSizeAtomic: string;
    minimumSizeAtomic: string;
    quoteDecimals: number;
    activeStatus: number;
    makerFeeBps: number;
    takerFeeBps: number;
  };
  liquidity: {
    referencePriceAtomic: string;
    spreadBps: number;
    levelStepBps: number;
    levelsPerSide: number;
    bidQuantityPerLevelAtomic: string;
    askQuantityPerLevelAtomic: string;
    bidPricesAtomic: string[];
    askPricesAtomic: string[];
    maximumBidCapitalAtomic: string;
    minimumLpAptAtomic: string;
  };
}

export interface LaunchAsset {
  metadataAddress: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface DeployedModule {
  name: string;
  bytecode: string;
}

export interface PackageMetadata {
  name: unknown;
  upgrade_policy?: { policy?: unknown } | null;
  upgrade_number?: unknown;
  modules?: Array<{ name?: unknown }> | null;
}

export interface MetadataResource {
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
}

export interface LaunchWalletBalances {
  externalCashAtomic: string;
  externalUsdcAtomic: string;
  aptAtomic: string;
  internalCashAvailableAtomic: string;
  internalCashLockedAtomic: string;
  internalUsdcAvailableAtomic: string;
  internalUsdcLockedAtomic: string;
}

export interface RawOrder {
  order_id?: unknown;
  owner?: unknown;
  price?: unknown;
  original_quantity?: unknown;
  remaining_quantity?: unknown;
  is_bid?: unknown;
  order_type?: unknown;
  pair_id?: unknown;
  locked_quote?: unknown;
}

export interface CashSmokeProofPlan {
  schemaVersion: 1;
  sender: string;
  buy: {
    transactionHash: string;
    maxQuoteAtomic: string;
    baseQuantityAtomic: string;
    minBaseAtomic: string;
    filledBaseAtomic: string;
    filledQuoteAtomic: string;
  };
  sell: {
    transactionHash: string;
    baseAmountAtomic: string;
    minQuoteAtomic: string;
    filledBaseAtomic: string;
    filledQuoteAtomic: string;
  };
}

export interface VerifiedCashSmokeTransaction {
  transactionHash: string;
  version: string;
  direction: "buy" | "sell";
  filledBaseAtomic: string;
  filledQuoteAtomic: string;
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const HASH_PATTERN = /^[0-9a-fA-F]{64}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const UNSIGNED_PATTERN = /^\d+$/;
const U64_MAX = (1n << 64n) - 1n;
const PRICE_SCALE = 1_000_000_000_000n;
const APTOS_MAINNET_ORIGIN = "https://api.mainnet.aptoslabs.com";
export const MAINNET_CASH_USDC_RELEASE_ID = "cash-usdc-mainnet-v1" as const;
export const EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256 =
  "3b24865d6b849822e7d5174c28a9be38019a8c7aec20ea6d08b19475eb2be524";
const EXPECTED_CASH_METADATA_ADDRESS =
  "0xc692943f7b340f02191c5de8dac2f827e0b66b3ed2206206a3526bcb0cae6e40";
const EXPECTED_USDC_METADATA_ADDRESS =
  "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const EXPECTED_MODULES = [
  "accounts",
  "admin",
  "cancel",
  "fees",
  "market",
  "matching",
  "order_placement",
  "settlement",
  "subaccounts",
  "types",
  "views",
] as const;
const EXPECTED_BID_PRICES = [
  "12930000",
  "12920000",
  "12910000",
  "12900000",
  "12880000",
  "12870000",
  "12860000",
  "12840000",
  "12830000",
  "12820000",
] as const;
const EXPECTED_ASK_PRICES = [
  "13070000",
  "13080000",
  "13090000",
  "13100000",
  "13120000",
  "13130000",
  "13140000",
  "13160000",
  "13170000",
  "13180000",
] as const;
export const CASH_INDEXER_MAX_LAG_VERSIONS = 2_000n;

function canonicalLaunchJson(value: unknown): string {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalLaunchJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalLaunchJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Launch manifest contains a non-JSON value.");
}

export function cashLaunchManifestSha256(value: unknown): string {
  const root = asRecord(value, "Launch manifest");
  const release = { ...asRecord(root.release, "Launch release seal") };
  delete release.canonicalSha256;
  return createHash("sha256")
    .update(canonicalLaunchJson({ ...root, release }))
    .digest("hex");
}

function requireExactLaunchValue(value: unknown, expected: unknown, name: string): void {
  if (canonicalLaunchJson(value) !== canonicalLaunchJson(expected)) {
    throw new Error(`${name} does not match the sealed production invariant.`);
  }
}

export function isCashIndexerVersionFresh(
  indexedVersion: bigint,
  ledgerVersion: bigint,
  maximumSkew = CASH_INDEXER_MAX_LAG_VERSIONS,
) {
  if (indexedVersion <= 0n || ledgerVersion <= 0n || maximumSkew < 0n) return false;
  const skew = indexedVersion >= ledgerVersion
    ? indexedVersion - ledgerVersion
    : ledgerVersion - indexedVersion;
  return skew <= maximumSkew;
}

export interface StableCashOrderbookTrade {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
  txRef: string;
}

export function normalizeStableCashOrderbookTrade(
  value: unknown,
): StableCashOrderbookTrade | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const trade = value as Record<string, unknown>;
  const id = typeof trade.id === "string" ? trade.id : "";
  const txRef = typeof trade.txRef === "string" ? trade.txRef : "";
  const idMatch = /^(\d+):(\d+)$/.exec(id);
  if (
    !idMatch
    || !/^\d+$/.test(txRef)
    || idMatch[1] !== txRef
    || typeof trade.price !== "number"
    || !Number.isFinite(trade.price)
    || trade.price <= 0
    || typeof trade.size !== "number"
    || !Number.isFinite(trade.size)
    || trade.size <= 0
    || (trade.side !== "buy" && trade.side !== "sell")
    || typeof trade.timestamp !== "number"
    || !Number.isSafeInteger(trade.timestamp)
    || trade.timestamp <= 0
  ) return null;
  return {
    id,
    price: trade.price,
    size: trade.size,
    side: trade.side,
    timestamp: trade.timestamp,
    txRef,
  };
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function asSafeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return value;
}

export function parseUnsigned(value: unknown, name: string): bigint {
  const text = String(value ?? "");
  if (!UNSIGNED_PATTERN.test(text)) throw new Error(`${name} is malformed.`);
  const parsed = BigInt(text);
  if (parsed > U64_MAX) throw new Error(`${name} exceeds u64.`);
  return parsed;
}

export function normalizeLaunchAddress(value: unknown, name = "Aptos address"): string {
  const text = String(value ?? "");
  if (!ADDRESS_PATTERN.test(text)) throw new Error(`${name} is invalid.`);
  return `0x${BigInt(text).toString(16).padStart(64, "0")}`;
}

function requireExactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${name} contains missing or unexpected fields.`);
  }
}

function normalizeSmokeTransactionHash(value: unknown, name: string): string {
  if (typeof value !== "string" || !TRANSACTION_HASH_PATTERN.test(value)) {
    throw new Error(`${name} must be a full Aptos transaction hash.`);
  }
  return value.toLowerCase();
}

function positiveSmokeAmount(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a canonical positive decimal string.`);
  }
  const parsed = parseUnsigned(value, name);
  return parsed.toString();
}

export function validateCashSmokeProofPlan(
  value: unknown,
  manifest: CashLaunchManifest,
): CashSmokeProofPlan {
  const root = asRecord(value, "Smoke proof");
  requireExactObjectKeys(root, ["schemaVersion", "sender", "buy", "sell"], "Smoke proof");
  if (root.schemaVersion !== 1) throw new Error("Smoke proof schemaVersion must be 1.");
  if (typeof root.sender !== "string") throw new Error("Smoke sender must be an Aptos address string.");

  const sender = normalizeLaunchAddress(root.sender, "smoke sender");
  const buy = asRecord(root.buy, "Smoke buy proof");
  const sell = asRecord(root.sell, "Smoke sell proof");
  requireExactObjectKeys(buy, [
    "transactionHash",
    "maxQuoteAtomic",
    "baseQuantityAtomic",
    "minBaseAtomic",
    "filledBaseAtomic",
    "filledQuoteAtomic",
  ], "Smoke buy proof");
  requireExactObjectKeys(sell, [
    "transactionHash",
    "baseAmountAtomic",
    "minQuoteAtomic",
    "filledBaseAtomic",
    "filledQuoteAtomic",
  ], "Smoke sell proof");

  const normalized: CashSmokeProofPlan = {
    schemaVersion: 1,
    sender,
    buy: {
      transactionHash: normalizeSmokeTransactionHash(
        buy.transactionHash,
        "Smoke buy transaction hash",
      ),
      maxQuoteAtomic: positiveSmokeAmount(buy.maxQuoteAtomic, "smoke buy max quote"),
      baseQuantityAtomic: positiveSmokeAmount(
        buy.baseQuantityAtomic,
        "smoke buy base quantity",
      ),
      minBaseAtomic: positiveSmokeAmount(buy.minBaseAtomic, "smoke buy minimum base"),
      filledBaseAtomic: positiveSmokeAmount(buy.filledBaseAtomic, "smoke buy filled base"),
      filledQuoteAtomic: positiveSmokeAmount(buy.filledQuoteAtomic, "smoke buy filled quote"),
    },
    sell: {
      transactionHash: normalizeSmokeTransactionHash(
        sell.transactionHash,
        "Smoke sell transaction hash",
      ),
      baseAmountAtomic: positiveSmokeAmount(sell.baseAmountAtomic, "smoke sell base amount"),
      minQuoteAtomic: positiveSmokeAmount(sell.minQuoteAtomic, "smoke sell minimum quote"),
      filledBaseAtomic: positiveSmokeAmount(sell.filledBaseAtomic, "smoke sell filled base"),
      filledQuoteAtomic: positiveSmokeAmount(sell.filledQuoteAtomic, "smoke sell filled quote"),
    },
  };

  if (normalized.buy.transactionHash === normalized.sell.transactionHash) {
    throw new Error("Smoke buy and sell transaction hashes must be distinct.");
  }
  const minimum = parseUnsigned(manifest.market.minimumSizeAtomic, "launch minimum size");
  if (
    BigInt(normalized.buy.baseQuantityAtomic) !== minimum
    || normalized.buy.minBaseAtomic !== normalized.buy.baseQuantityAtomic
    || normalized.buy.filledBaseAtomic !== normalized.buy.baseQuantityAtomic
    || BigInt(normalized.buy.filledQuoteAtomic) > BigInt(normalized.buy.maxQuoteAtomic)
  ) {
    throw new Error("Smoke buy must fully fill the exact launch minimum within its reviewed quote cap.");
  }
  if (
    normalized.sell.baseAmountAtomic !== normalized.buy.filledBaseAtomic
    || normalized.sell.filledBaseAtomic !== normalized.sell.baseAmountAtomic
    || BigInt(normalized.sell.filledQuoteAtomic) < BigInt(normalized.sell.minQuoteAtomic)
  ) {
    throw new Error("Smoke sell must fully return the CASH bought by the smoke buy within its reviewed minimum.");
  }
  return normalized;
}

export function launchCapital(manifest: CashLaunchManifest): {
  bidAtomic: bigint;
  askAtomic: bigint;
} {
  const bidQuantity = parseUnsigned(
    manifest.liquidity.bidQuantityPerLevelAtomic,
    "bid quantity per level",
  );
  const askQuantity = parseUnsigned(
    manifest.liquidity.askQuantityPerLevelAtomic,
    "ask quantity per level",
  );
  const bidAtomic = manifest.liquidity.bidPricesAtomic.reduce(
    (sum, price) => sum + (parseUnsigned(price, "bid price") * bidQuantity) / PRICE_SCALE,
    0n,
  );
  return {
    bidAtomic,
    askAtomic: askQuantity * BigInt(manifest.liquidity.levelsPerSide),
  };
}

export function validateCashLaunchManifest(value: unknown): CashLaunchManifest {
  const root = asRecord(value, "Launch manifest");
  if (root.schemaVersion !== 1 || root.network !== "mainnet" || root.chainId !== 1) {
    throw new Error("Launch manifest must target Aptos mainnet with schema version 1.");
  }
  const release = asRecord(root.release, "Launch release seal");
  if (
    release.id !== MAINNET_CASH_USDC_RELEASE_ID
    || release.canonicalSha256 !== EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256
  ) {
    throw new Error("Launch release ID and expected manifest SHA-256 must match the approved release.");
  }
  const packageConfig = asRecord(root.package, "Launch package");
  if (
    packageConfig.name !== "cash_orderbook"
    || packageConfig.upgradePolicy !== 2
    || packageConfig.upgradeNumber !== 0
  ) {
    throw new Error("Launch package must be the immutable cash_orderbook first publish.");
  }
  requireExactLaunchValue(packageConfig.modules, EXPECTED_MODULES, "Launch package modules");
  const assets = asRecord(root.assets, "Launch assets");
  for (const [key, symbol] of [["cash", "CASH"], ["usdc", "USDC"]] as const) {
    const asset = asRecord(assets[key], `${symbol} asset`);
    normalizeLaunchAddress(asset.metadataAddress, `${symbol} metadata address`);
    requireExactLaunchValue(asset, {
      metadataAddress: symbol === "CASH"
        ? EXPECTED_CASH_METADATA_ADDRESS
        : EXPECTED_USDC_METADATA_ADDRESS,
      name: symbol,
      symbol,
      decimals: 6,
    }, `${symbol} metadata`);
  }
  const market = asRecord(root.market, "Launch market");
  if (
    market.pairId !== 0
    || market.quoteDecimals !== 6
    || market.activeStatus !== 0
    || market.makerFeeBps !== 0
    || market.takerFeeBps !== 0
  ) {
    throw new Error("Launch market must be active, fee-free CASH/USDC pair 0.");
  }
  const lot = parseUnsigned(market.lotSizeAtomic, "lot size");
  const tick = parseUnsigned(market.tickSizeAtomic, "tick size");
  const minimum = parseUnsigned(market.minimumSizeAtomic, "minimum size");
  if (lot !== 1_000_000_000n || tick !== 10_000n || minimum !== 10_000_000_000n) {
    throw new Error("Launch lot, tick, and minimum do not match the sealed production invariant.");
  }
  const liquidity = asRecord(root.liquidity, "Launch liquidity");
  const levels = asSafeInteger(liquidity.levelsPerSide, "levelsPerSide");
  const spread = asSafeInteger(liquidity.spreadBps, "spreadBps");
  const step = asSafeInteger(liquidity.levelStepBps, "levelStepBps");
  if (levels !== 10 || spread !== 50 || step !== 10) {
    throw new Error("Launch liquidity settings do not match the sealed 10x10 production ladder.");
  }
  const bidQuantity = parseUnsigned(liquidity.bidQuantityPerLevelAtomic, "bid quantity");
  const askQuantity = parseUnsigned(liquidity.askQuantityPerLevelAtomic, "ask quantity");
  if (bidQuantity !== 1_941_000_000_000n || askQuantity !== 60_000_000_000_000n) {
    throw new Error("Launch quantities do not match the sealed production invariant.");
  }
  for (const [key, descending] of [["bidPricesAtomic", true], ["askPricesAtomic", false]] as const) {
    const values = liquidity[key];
    if (!Array.isArray(values) || values.length !== levels) {
      throw new Error(`${key} must contain exactly ${levels} levels.`);
    }
    let previous: bigint | null = null;
    for (const [index, rawPrice] of values.entries()) {
      const price = parseUnsigned(rawPrice, `${key}[${index}]`);
      if (price <= 0n || price % tick !== 0n) throw new Error(`${key}[${index}] is off tick.`);
      if (previous !== null && (descending ? price >= previous : price <= previous)) {
        throw new Error(`${key} is not strictly sorted.`);
      }
      previous = price;
    }
  }
  requireExactLaunchValue(liquidity.bidPricesAtomic, EXPECTED_BID_PRICES, "Bid ladder");
  requireExactLaunchValue(liquidity.askPricesAtomic, EXPECTED_ASK_PRICES, "Ask ladder");
  const reference = parseUnsigned(liquidity.referencePriceAtomic, "reference price");
  const bestBid = parseUnsigned((liquidity.bidPricesAtomic as unknown[])[0], "best bid");
  const bestAsk = parseUnsigned((liquidity.askPricesAtomic as unknown[])[0], "best ask");
  if (reference !== 13_000_000n || bestBid >= bestAsk) {
    throw new Error("Launch reference price does not match the sealed production invariant.");
  }
  const maxBid = parseUnsigned(liquidity.maximumBidCapitalAtomic, "maximum bid capital");
  if (maxBid !== 250_000_000n || parseUnsigned(liquidity.minimumLpAptAtomic, "minimum LP APT") !== 50_000_000n) {
    throw new Error("Launch capital and APT thresholds do not match the sealed production invariant.");
  }
  const manifest = value as CashLaunchManifest;
  const capital = launchCapital(manifest);
  if (
    capital.bidAtomic !== 249_923_160n
    || capital.askAtomic !== 600_000_000_000_000n
    || capital.bidAtomic > maxBid
  ) {
    throw new Error("Launch capital must be exactly 600M CASH and at most $250 USDC.");
  }
  const digest = cashLaunchManifestSha256(value);
  if (digest !== EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256) {
    throw new Error(
      `Launch manifest SHA-256 mismatch: expected ${EXPECTED_MAINNET_CASH_USDC_MANIFEST_SHA256}, received ${digest}.`,
    );
  }
  return manifest;
}

export function verifyMoveManifest(contents: string): void {
  const packageSection = contents.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  if (!/^\s*upgrade_policy\s*=\s*["']immutable["']\s*$/m.test(packageSection)) {
    throw new Error("Move.toml must set upgrade_policy = \"immutable\" before mainnet publication.");
  }
  const dependencyRevision = contents.match(/^\s*rev\s*=\s*["']([0-9a-f]{40})["']\s*$/m)?.[1];
  if (!dependencyRevision) {
    throw new Error("Move.toml must pin AptosFramework to a full commit hash.");
  }
}

export function moduleFingerprint(modules: DeployedModule[], expectedNames: string[]): string {
  const selected = modules
    .map((module) => ({ name: module.name, bytecode: module.bytecode.toLowerCase() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const expected = [...expectedNames].sort();
  if (
    selected.length !== expected.length
    || selected.some((module, index) => module.name !== expected[index] || !/^0x[0-9a-f]+$/.test(module.bytecode))
  ) {
    throw new Error("Deployed modules do not match the exact production module set.");
  }
  return createHash("sha256")
    .update(selected.map((module) => `${module.name}:${module.bytecode}`).join("\n"))
    .digest("hex");
}

export function verifyPackage(
  manifest: CashLaunchManifest,
  packages: PackageMetadata[],
  modules: DeployedModule[],
  expectedFingerprint: string,
): string {
  if (!HASH_PATTERN.test(expectedFingerprint)) throw new Error("Expected module fingerprint is invalid.");
  const matches = packages.filter((candidate) => candidate.name === manifest.package.name);
  if (matches.length !== 1) throw new Error("cash_orderbook package identity is ambiguous.");
  const metadata = matches[0];
  const names = (metadata.modules ?? []).map((module) => String(module.name ?? "")).sort();
  const expectedNames = [...manifest.package.modules].sort();
  if (
    String(metadata.upgrade_policy?.policy) !== String(manifest.package.upgradePolicy)
    || String(metadata.upgrade_number) !== String(manifest.package.upgradeNumber)
    || JSON.stringify(names) !== JSON.stringify(expectedNames)
  ) {
    throw new Error("On-chain package is not the immutable first-publish production module set.");
  }
  const fingerprint = moduleFingerprint(modules, manifest.package.modules);
  if (fingerprint !== expectedFingerprint.toLowerCase()) {
    throw new Error("On-chain bytecode fingerprint does not match the auditor-approved fingerprint.");
  }
  return fingerprint;
}

export function verifyAssetMetadata(expected: LaunchAsset, actual: MetadataResource): void {
  if (
    actual.name !== expected.name
    || actual.symbol !== expected.symbol
    || Number(actual.decimals) !== expected.decimals
  ) {
    throw new Error(`${expected.symbol} metadata resource does not match the launch manifest.`);
  }
}

export function verifyMarket(
  manifest: CashLaunchManifest,
  marketInfo: unknown[],
  feeInfo: unknown[],
  activeInfo: unknown[],
  expectedActive = true,
): void {
  if (marketInfo.length !== 7) throw new Error("Market 0 returned malformed configuration.");
  const [base, quote, lot, tick, minimum, status, quoteDecimals] = marketInfo;
  const expectedStatus = expectedActive ? manifest.market.activeStatus : 1;
  if (
    normalizeLaunchAddress(base, "market base") !== normalizeLaunchAddress(manifest.assets.cash.metadataAddress)
    || normalizeLaunchAddress(quote, "market quote") !== normalizeLaunchAddress(manifest.assets.usdc.metadataAddress)
    || String(lot) !== manifest.market.lotSizeAtomic
    || String(tick) !== manifest.market.tickSizeAtomic
    || String(minimum) !== manifest.market.minimumSizeAtomic
    || Number(status) !== expectedStatus
    || Number(quoteDecimals) !== manifest.market.quoteDecimals
  ) {
    throw new Error("Market 0 does not match the exact CASH/USDC launch configuration.");
  }
  if (activeInfo.length !== 1 || activeInfo[0] !== expectedActive) {
    throw new Error(
      expectedActive
        ? "CASH/USDC market 0 is not active."
        : "CASH/USDC market 0 must remain paused until atomic bootstrap completes.",
    );
  }
  if (
    feeInfo.length !== 2
    || Number(feeInfo[0]) !== manifest.market.makerFeeBps
    || Number(feeInfo[1]) !== manifest.market.takerFeeBps
  ) {
    throw new Error("CASH/USDC maker and taker fees must both remain zero.");
  }
}

export function verifyMarketBootstrap(
  manifest: CashLaunchManifest,
  lpAddress: string,
  bootstrapInfo: unknown[],
  expectedPending: boolean,
): void {
  if (bootstrapInfo.length !== 6) {
    throw new Error("Market 0 returned malformed bootstrap state.");
  }
  const [pending, owner, rawBidPrices, rawBidQuantities, rawAskPrices, rawAskQuantities] = bootstrapInfo;
  if (!expectedPending) {
    if (
      pending !== false
      || normalizeLaunchAddress(owner, "bootstrap owner") !== normalizeLaunchAddress("0x0")
      || !Array.isArray(rawBidPrices) || rawBidPrices.length !== 0
      || !Array.isArray(rawBidQuantities) || rawBidQuantities.length !== 0
      || !Array.isArray(rawAskPrices) || rawAskPrices.length !== 0
      || !Array.isArray(rawAskQuantities) || rawAskQuantities.length !== 0
    ) {
      throw new Error("Market bootstrap is still pending or was not cleared cleanly.");
    }
    return;
  }

  const expectedBidQuantities = Array.from(
    { length: manifest.liquidity.levelsPerSide },
    () => manifest.liquidity.bidQuantityPerLevelAtomic,
  );
  const expectedAskQuantities = Array.from(
    { length: manifest.liquidity.levelsPerSide },
    () => manifest.liquidity.askQuantityPerLevelAtomic,
  );
  if (
    pending !== true
    || normalizeLaunchAddress(owner, "bootstrap owner") !== normalizeLaunchAddress(lpAddress, "LP address")
    || JSON.stringify(rawBidPrices) !== JSON.stringify(manifest.liquidity.bidPricesAtomic)
    || JSON.stringify(rawBidQuantities) !== JSON.stringify(expectedBidQuantities)
    || JSON.stringify(rawAskPrices) !== JSON.stringify(manifest.liquidity.askPricesAtomic)
    || JSON.stringify(rawAskQuantities) !== JSON.stringify(expectedAskQuantities)
  ) {
    throw new Error("Paused market bootstrap does not match the sealed LP ladder commitment.");
  }
}

export function verifyMarketExecutionPolicy(
  lpAddress: string,
  designatedMakerInfo: unknown[],
  matchNodeBudgetInfo: unknown[],
): void {
  if (
    designatedMakerInfo.length !== 1
    || normalizeLaunchAddress(designatedMakerInfo[0], "designated maker")
      !== normalizeLaunchAddress(lpAddress, "LP address")
  ) {
    throw new Error("Market 0 designated maker does not match the sealed launch LP.");
  }
  if (matchNodeBudgetInfo.length !== 1 || String(matchNodeBudgetInfo[0]) !== "16") {
    throw new Error("Market 0 matching work budget does not match the audited 16-node limit.");
  }
}

export function verifyAdmin(
  expectedAdmin: string,
  adminInfo: unknown[],
  pendingAdminInfo: unknown[],
): void {
  if (adminInfo.length !== 1) throw new Error("Protocol admin view is malformed.");
  const expected = normalizeLaunchAddress(expectedAdmin, "expected admin");
  const actual = normalizeLaunchAddress(adminInfo[0], "on-chain admin");
  if (actual !== expected) throw new Error("On-chain protocol admin does not match the launch input.");
  if (
    pendingAdminInfo.length !== 2
    || pendingAdminInfo[0] !== false
    || normalizeLaunchAddress(pendingAdminInfo[1], "pending admin") !== normalizeLaunchAddress("0x0")
  ) {
    throw new Error("Protocol admin handoff is still pending or malformed.");
  }
}

export function verifyWalletFunding(
  manifest: CashLaunchManifest,
  balances: LaunchWalletBalances,
  location: "wallet" | "orderbook",
): void {
  const capital = launchCapital(manifest);
  const cash = parseUnsigned(
    location === "wallet" ? balances.externalCashAtomic : balances.internalCashAvailableAtomic,
    `${location} CASH balance`,
  );
  const usdc = parseUnsigned(
    location === "wallet" ? balances.externalUsdcAtomic : balances.internalUsdcAvailableAtomic,
    `${location} USDC balance`,
  );
  const requiredUsdc = parseUnsigned(
    manifest.liquidity.maximumBidCapitalAtomic,
    "maximum bid capital",
  );
  const apt = parseUnsigned(balances.aptAtomic, "LP APT balance");
  if (location === "orderbook") {
    if (
      cash !== capital.askAtomic
      || usdc !== requiredUsdc
      || parseUnsigned(balances.internalCashLockedAtomic, "orderbook locked CASH") !== 0n
      || parseUnsigned(balances.internalUsdcLockedAtomic, "orderbook locked USDC") !== 0n
    ) {
      throw new Error("Orderbook deposits must exactly match the reviewed CASH and USDC activation capital with nothing locked.");
    }
  } else {
    if (cash < capital.askAtomic) {
      throw new Error(`${location} needs at least ${capital.askAtomic} atomic CASH for the ask ladder.`);
    }
    if (usdc < requiredUsdc) {
      throw new Error(`${location} needs the reviewed ${requiredUsdc} atomic USDC deposit.`);
    }
  }
  if (apt < parseUnsigned(manifest.liquidity.minimumLpAptAtomic, "minimum LP APT")) {
    throw new Error("LP wallet APT balance is below the launch gas threshold.");
  }
}

function orderValue(order: RawOrder, field: keyof RawOrder, name: string): bigint {
  return parseUnsigned(order[field], name);
}

function verifyCommonOrder(
  manifest: CashLaunchManifest,
  order: RawOrder,
  isBid: boolean,
): { price: bigint; quantity: bigint; orderType: bigint } {
  const price = orderValue(order, "price", "order price");
  const original = orderValue(order, "original_quantity", "original quantity");
  const remaining = orderValue(order, "remaining_quantity", "remaining quantity");
  const orderType = orderValue(order, "order_type", "order type");
  const lot = BigInt(manifest.market.lotSizeAtomic);
  const tick = BigInt(manifest.market.tickSizeAtomic);
  if (
    order.is_bid !== isBid
    || orderValue(order, "pair_id", "order pair") !== BigInt(manifest.market.pairId)
    || (orderType !== 0n && orderType !== 3n)
    || !ADDRESS_PATTERN.test(String(order.owner ?? ""))
    || price <= 0n
    || price % tick !== 0n
    || original <= 0n
    || remaining <= 0n
    || remaining > original
    || remaining % lot !== 0n
  ) {
    throw new Error("On-chain order violates the CASH/USDC launch rules.");
  }
  return { price, quantity: remaining, orderType };
}

export function verifyExactSeededBook(
  manifest: CashLaunchManifest,
  lpAddress: string,
  result: unknown[],
): void {
  if (result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
    throw new Error("Orderbook view is malformed.");
  }
  const owner = normalizeLaunchAddress(lpAddress, "LP address");
  const sides = [
    {
      orders: result[0] as RawOrder[],
      isBid: true,
      expectedPrices: manifest.liquidity.bidPricesAtomic,
      expectedQuantity: BigInt(manifest.liquidity.bidQuantityPerLevelAtomic),
    },
    {
      orders: result[1] as RawOrder[],
      isBid: false,
      expectedPrices: manifest.liquidity.askPricesAtomic,
      expectedQuantity: BigInt(manifest.liquidity.askQuantityPerLevelAtomic),
    },
  ];
  for (const side of sides) {
    if (side.orders.length !== manifest.liquidity.levelsPerSide) {
      throw new Error("Seeded book does not contain the exact number of levels per side.");
    }
    side.orders.forEach((order, index) => {
      const { price, quantity, orderType } = verifyCommonOrder(manifest, order, side.isBid);
      if (
        normalizeLaunchAddress(order.owner, "order owner") !== owner
        || price !== BigInt(side.expectedPrices[index])
        || quantity !== side.expectedQuantity
        || orderType !== 3n
        || orderValue(order, "original_quantity", "original quantity") !== side.expectedQuantity
      ) {
        throw new Error("Seeded order does not match the reviewed LP ladder.");
      }
      const expectedLocked = side.isBid ? (price * side.expectedQuantity) / PRICE_SCALE : 0n;
      if (orderValue(order, "locked_quote", "locked quote") !== expectedLocked) {
        throw new Error("Seeded order collateral does not match the fee-free launch ladder.");
      }
    });
  }
}

export function verifySafeLiveBook(manifest: CashLaunchManifest, result: unknown[]): void {
  if (result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])) {
    throw new Error("Orderbook view is malformed.");
  }
  const bids = result[0] as RawOrder[];
  const asks = result[1] as RawOrder[];
  if (bids.length === 0 || asks.length === 0 || bids.length > 500 || asks.length > 500) {
    throw new Error("Live book must have both sides and stay within the 500-order retail safety cap.");
  }
  let previousBid: bigint | null = null;
  for (const order of bids) {
    const { price } = verifyCommonOrder(manifest, order, true);
    if (previousBid !== null && price > previousBid) throw new Error("Live bids are not sorted.");
    previousBid = price;
  }
  let previousAsk: bigint | null = null;
  for (const order of asks) {
    const { price } = verifyCommonOrder(manifest, order, false);
    if (previousAsk !== null && price < previousAsk) throw new Error("Live asks are not sorted.");
    previousAsk = price;
  }
  const bestBid = orderValue(bids[0], "price", "best bid");
  const bestAsk = orderValue(asks[0], "price", "best ask");
  if (bestBid >= bestAsk) throw new Error("Live CASH/USDC orderbook is crossed.");
}

export function verifyFrontendConfig(
  contractAddress: string,
  adminAddress: string,
  lpAddress: string,
  fingerprint: string,
  config: Record<string, string | undefined>,
  expectedIndexerHealthUrl: string,
  expectedFullnodeUrl: string,
  expectedTrustedFullnodeOrigin: string,
): void {
  if (
    normalizeLaunchAddress(config.CASH_ORDERBOOK_CONTRACT_ADDRESS, "frontend contract")
      !== normalizeLaunchAddress(contractAddress)
    || normalizeLaunchAddress(config.CASH_ORDERBOOK_ADMIN_ADDRESS, "frontend admin")
      !== normalizeLaunchAddress(adminAddress)
    || normalizeLaunchAddress(config.CASH_ORDERBOOK_LP_ADDRESS, "frontend LP")
      !== normalizeLaunchAddress(lpAddress)
    || !HASH_PATTERN.test(config.CASH_ORDERBOOK_AUDITED_MODULES_SHA256 ?? "")
    || config.CASH_ORDERBOOK_AUDITED_MODULES_SHA256?.toLowerCase() !== fingerprint.toLowerCase()
  ) {
    throw new Error("Frontend CASH orderbook environment does not match the attested deployment.");
  }
  if (config.CASH_ORDERBOOK_DEV_UNSAFE_SKIP_VERIFY === "1") {
    throw new Error("Unsafe development verification bypass must be absent in production.");
  }
  if (
    config.NEXT_PUBLIC_DECIBEL_NETWORK !== "mainnet"
    || config.DECIBEL_NETWORK !== "mainnet"
  ) {
    throw new Error("Frontend and server wallet networks must both be pinned to Aptos mainnet.");
  }
  const normalizeOrigin = (value: string, name: string) => {
    if (!value) return "";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be an exact HTTPS origin.`);
    }
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
    ) {
      throw new Error(`${name} must be an exact HTTPS origin.`);
    }
    return url.origin;
  };
  const normalizeFullnode = (raw: string, trustedRaw: string, name: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${name} must be a trusted HTTPS Aptos mainnet URL.`);
    }
    const trusted = normalizeOrigin(trustedRaw, `${name} trusted origin`);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.origin !== APTOS_MAINNET_ORIGIN && url.origin !== trusted)
    ) {
      throw new Error(`${name} must be a trusted HTTPS Aptos mainnet URL.`);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return { base: url.toString().replace(/\/$/, ""), trusted };
  };
  const deployedFullnode = normalizeFullnode(
    config.APTOS_NODE_URL_MAINNET ?? "",
    config.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN ?? "",
    "Frontend fullnode",
  );
  const reviewedFullnode = normalizeFullnode(
    expectedFullnodeUrl,
    expectedTrustedFullnodeOrigin,
    "Reviewed fullnode",
  );
  if (
    deployedFullnode.base !== reviewedFullnode.base
    || deployedFullnode.trusted !== reviewedFullnode.trusted
  ) {
    throw new Error("Frontend Aptos fullnode does not match the reviewed launch endpoint.");
  }
  let apiHealthUrl = "";
  let expectedHealthUrl = "";
  try {
    const apiUrl = new URL(config.CASH_ORDERBOOK_API_URL ?? "");
    const expectedUrl = new URL(expectedIndexerHealthUrl);
    if (apiUrl.protocol !== "https:" || expectedUrl.protocol !== "https:") throw new Error();
    apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/, "")}/health`;
    apiUrl.search = "";
    apiUrl.hash = "";
    expectedUrl.search = "";
    expectedUrl.hash = "";
    apiHealthUrl = apiUrl.toString().replace(/\/$/, "");
    expectedHealthUrl = expectedUrl.toString().replace(/\/$/, "");
  } catch {
    throw new Error("CASH_ORDERBOOK_API_URL must be the HTTPS origin of the reviewed indexer.");
  }
  if (apiHealthUrl !== expectedHealthUrl) {
    throw new Error("Frontend trade-history indexer does not match the reviewed health endpoint.");
  }
}

export function verifyIndexerHealth(
  health: unknown,
  contractAddress: string,
  currentLedgerVersion: bigint,
  maximumLag = CASH_INDEXER_MAX_LAG_VERSIONS,
): void {
  const body = asRecord(health, "Indexer health response");
  if (
    body.status !== "ok"
    || body.network !== "mainnet"
    || normalizeLaunchAddress(body.contractAddress, "indexer contract") !== normalizeLaunchAddress(contractAddress)
    || typeof body.uptime !== "number"
    || body.uptime < 0
  ) {
    throw new Error("Indexer health identity does not match the mainnet deployment.");
  }
  if (body.authoritativeReplayComplete !== true) {
    throw new Error("Indexer has not completed an authoritative mainnet replay.");
  }
  const polled = parseUnsigned(body.lastSuccessfulPollLedgerVersion, "indexer poll ledger version");
  if (!isCashIndexerVersionFresh(polled, currentLedgerVersion, maximumLag)) {
    throw new Error("Indexer has not completed a recent successful mainnet poll.");
  }
}

export function verifyPublicDepth(
  response: unknown,
  contractAddress: string,
  manifest: CashLaunchManifest,
): void {
  const body = asRecord(response, "Public depth response");
  if (
    body.ready !== true
    || body.verified !== true
    || body.source !== "aptos-executable-prefix-view"
    || Number(body.pairId) !== manifest.market.pairId
    || Number(body.makerFeeBps) !== 0
    || Number(body.takerFeeBps) !== 0
    || body.depthTruncated !== false
    || body.excludedOwner !== null
    || !/^\d+$/.test(String(body.ledgerVersion ?? ""))
    || BigInt(String(body.ledgerVersion)) <= 0n
    || normalizeLaunchAddress(body.contractAddress, "public depth contract") !== normalizeLaunchAddress(contractAddress)
  ) {
    throw new Error("Public swap depth endpoint is not serving the attested CASH/USDC deployment.");
  }
  const depth = asRecord(body.depth, "Public depth");
  if (!Array.isArray(depth.bids) || !Array.isArray(depth.asks) || depth.bids.length === 0 || depth.asks.length === 0) {
    throw new Error("Public swap depth endpoint does not expose both sides of the book.");
  }
  const execution = asRecord(body.execution, "Public execution window");
  const executionSideIsExact = (value: unknown) => {
    const side = asRecord(value, "Public execution side");
    return Number(side.scannedNodes) === manifest.liquidity.levelsPerSide
      && side.hasMoreRawNodes === false;
  };
  if (
    Number(execution.nodeBudget) !== 16
    || !executionSideIsExact(execution.bids)
    || !executionSideIsExact(execution.asks)
  ) {
    throw new Error("Public swap depth is not bound to the audited executable order prefix.");
  }
}

export function verifyPublicTrades(
  response: unknown,
  contractAddress: string,
  expectedTransactionVersion?: string,
  expectedSide?: "buy" | "sell",
): void {
  const body = asRecord(response, "Public trades response");
  if (
    body.ready !== true
    || body.network !== "mainnet"
    || normalizeLaunchAddress(body.contractAddress, "public trades contract")
      !== normalizeLaunchAddress(contractAddress)
    || !/^\d+$/.test(String(body.indexedLedgerVersion ?? ""))
    || BigInt(String(body.indexedLedgerVersion)) <= 0n
    || !Array.isArray(body.trades)
    || body.trades.length > 80
  ) {
    throw new Error("Public CASH/USDC trade endpoint is not ready.");
  }

  let expectedFound = expectedTransactionVersion === undefined;
  for (const candidate of body.trades) {
    const trade = normalizeStableCashOrderbookTrade(candidate);
    if (!trade) {
      throw new Error("Public CASH/USDC trade endpoint returned an unstable trade record.");
    }
    if (
      trade.txRef === expectedTransactionVersion
      && (expectedSide === undefined || trade.side === expectedSide)
    ) expectedFound = true;
  }
  if (!expectedFound) {
    throw new Error(
      expectedSide
        ? `Public CASH/USDC trade tape has not indexed the smoke ${expectedSide} fill yet.`
        : "Public CASH/USDC trade tape has not indexed the smoke transaction yet.",
    );
  }
}

export function verifySmokeTransaction(
  transaction: unknown,
  contractAddress: string,
  manifest: CashLaunchManifest,
  proof: CashSmokeProofPlan,
  direction: "buy" | "sell",
): VerifiedCashSmokeTransaction {
  const checkedProof = validateCashSmokeProofPlan(proof, manifest);
  const expected = checkedProof[direction];
  const body = asRecord(transaction, "Smoke transaction");
  if (body.success !== true || body.vm_status !== "Executed successfully") {
    throw new Error(`Smoke transaction failed: ${String(body.vm_status ?? "unknown VM status")}.`);
  }
  if (
    body.type !== "user_transaction"
    || normalizeSmokeTransactionHash(body.hash, "Smoke transaction hash") !== expected.transactionHash
    || normalizeLaunchAddress(body.sender, "smoke transaction sender") !== checkedProof.sender
  ) {
    throw new Error(`Smoke ${direction} transaction identity does not match the reviewed proof.`);
  }
  const version = positiveSmokeAmount(body.version, `smoke ${direction} transaction version`);
  const payload = asRecord(body.payload, `Smoke ${direction} payload`);
  requireExactObjectKeys(
    payload,
    ["type", "function", "type_arguments", "arguments"],
    `Smoke ${direction} payload`,
  );
  const expectedEntry = direction === "buy" ? "buy_from_wallet" : "sell_from_wallet";
  const [payloadAddress, payloadModule, payloadEntry, ...payloadExtra] = String(
    payload.function ?? "",
  ).split("::");
  if (
    payload.type !== "entry_function_payload"
    || payloadExtra.length > 0
    || normalizeLaunchAddress(payloadAddress, "smoke payload address")
      !== normalizeLaunchAddress(contractAddress, "smoke contract address")
    || payloadModule !== "order_placement"
    || payloadEntry !== expectedEntry
    || !Array.isArray(payload.type_arguments)
    || payload.type_arguments.length !== 0
    || !Array.isArray(payload.arguments)
  ) {
    throw new Error(`Smoke ${direction} payload does not call the reviewed CASH/USDC entry function.`);
  }
  const sharedArguments = [
    String(manifest.market.pairId),
    normalizeLaunchAddress(manifest.assets.usdc.metadataAddress),
    normalizeLaunchAddress(manifest.assets.cash.metadataAddress),
  ];
  let expectedArguments: string[];
  if (direction === "buy") {
    expectedArguments = [
      ...sharedArguments,
      checkedProof.buy.maxQuoteAtomic,
      checkedProof.buy.baseQuantityAtomic,
      checkedProof.buy.minBaseAtomic,
    ];
  } else {
    expectedArguments = [
      ...sharedArguments,
      checkedProof.sell.baseAmountAtomic,
      checkedProof.sell.minQuoteAtomic,
    ];
  }
  if (
    payload.arguments.length !== expectedArguments.length
    || payload.arguments.some((argument, index) => {
      if (typeof argument !== "string") return true;
      return index === 1 || index === 2
        ? normalizeLaunchAddress(argument, `smoke ${direction} asset argument`) !== expectedArguments[index]
        : argument !== expectedArguments[index];
    })
  ) {
    throw new Error(`Smoke ${direction} payload arguments do not match the reviewed atomic amounts.`);
  }
  if (!Array.isArray(body.events)) throw new Error("Smoke transaction events are missing.");
  const normalizedContract = normalizeLaunchAddress(contractAddress);
  let fillCount = 0;
  let filledBase = 0n;
  let filledQuote = 0n;
  for (const candidate of body.events) {
    if (!candidate || typeof candidate !== "object") continue;
    const event = candidate as { type?: unknown; data?: unknown };
    const [eventAddress, eventModule, eventName, ...extra] = String(event.type ?? "").split("::");
    let normalizedEventAddress = "";
    try {
      normalizedEventAddress = normalizeLaunchAddress(eventAddress, "smoke event address");
    } catch {
      continue;
    }
    if (
      extra.length > 0
      || eventModule !== "settlement"
      || eventName !== "TradeEvent"
      || normalizedEventAddress !== normalizedContract
    ) {
      continue;
    }
    const data = asRecord(event.data, `Smoke ${direction} TradeEvent`);
    requireExactObjectKeys(data, [
      "taker_order_id",
      "maker_order_id",
      "price",
      "quantity",
      "quote_amount",
      "buyer",
      "seller",
      "pair_id",
      "taker_is_bid",
    ], `Smoke ${direction} TradeEvent`);
    const buyer = normalizeLaunchAddress(data.buyer, "smoke fill buyer");
    const seller = normalizeLaunchAddress(data.seller, "smoke fill seller");
    const expectedTaker = direction === "buy" ? buyer : seller;
    const expectedIsBid = direction === "buy";
    const quantity = parseUnsigned(data.quantity, "smoke fill quantity");
    const quote = parseUnsigned(data.quote_amount, "smoke fill quote");
    const price = parseUnsigned(data.price, "smoke fill price");
    parseUnsigned(data.taker_order_id, "smoke taker order ID");
    parseUnsigned(data.maker_order_id, "smoke maker order ID");
    if (
      parseUnsigned(data.pair_id, "smoke fill pair") !== BigInt(manifest.market.pairId)
      || data.taker_is_bid !== expectedIsBid
      || expectedTaker !== checkedProof.sender
      || buyer === seller
    ) {
      throw new Error(`Smoke ${direction} TradeEvent does not identify the reviewed taker and side.`);
    }
    if (
      quantity <= 0n
      || quote <= 0n
      || price <= 0n
      || quantity % BigInt(manifest.market.lotSizeAtomic) !== 0n
      || price % BigInt(manifest.market.tickSizeAtomic) !== 0n
      || (price * quantity) / PRICE_SCALE !== quote
    ) {
      throw new Error(`Smoke ${direction} TradeEvent contains invalid fill economics.`);
    }
    fillCount += 1;
    filledBase += quantity;
    filledQuote += quote;
  }
  if (fillCount === 0) throw new Error(`Smoke ${direction} transaction has no CASH/USDC TradeEvent fill.`);
  if (
    filledBase.toString() !== expected.filledBaseAtomic
    || filledQuote.toString() !== expected.filledQuoteAtomic
  ) {
    throw new Error(`Smoke ${direction} TradeEvent totals do not match the reviewed fill amounts.`);
  }
  return {
    transactionHash: expected.transactionHash,
    version,
    direction,
    filledBaseAtomic: filledBase.toString(),
    filledQuoteAtomic: filledQuote.toString(),
  };
}

export function atomicToDecimal(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
