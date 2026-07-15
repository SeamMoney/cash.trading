import {
  AccountAddress,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  Serializer,
} from "@aptos-labs/ts-sdk";
import rewardConfig from "@/config/cash-rewards.json";
import {
  getDecibelAccountOverview,
  getDecibelTradeHistory,
  type DecibelAccountOverview,
  type DecibelTrade,
} from "@/lib/decibel-api";
import type { DecibelNetwork } from "@/lib/decibel";

export const CASH_COIN_TYPE = rewardConfig.cashCoinType;
export const CASH_DECIMALS = rewardConfig.cashDecimals;
export const CASH_ATOMIC_UNIT = 10 ** CASH_DECIMALS;
export const CASH_REWARD_MANAGER_ADDRESS = rewardConfig.managerAddress;
export const CASH_REWARD_MODULE = `${CASH_REWARD_MANAGER_ADDRESS}::cash_rewards`;

const VOUCHER_VERSION = 1;
const MAINNET_CHAIN_ID = 1;
const TESTNET_CHAIN_ID = 2;
const MAX_TRADE_HISTORY = 1_000;
const TRADE_HISTORY_PAGE_SIZE = 200;
const FEE_REWARD_CASH_PER_USD = 5_000;
const REBATE_REWARD_MULTIPLIER = 1.25;
const CAPITAL_HOUR_REWARD_CASH = 8;
const ACTIVE_DAY_REWARD_CASH = 2_500;
const CONSERVATIVE_LEVERAGE = 40;

type TradeRewardInput = {
  orderHistoryId?: string;
  sourceType?: string;
  sourceId: string;
  userWalletAddress: string;
  userSubaccount?: string | null;
  sourceTxHash?: string | null;
  volumeGenerated?: number;
  market?: string | null;
  strategy?: string | null;
};

type PositionAccumulator = {
  size: number;
  lastPrice: number;
};

export type CashRewardContractStatus =
  | "awaiting_manager_gas"
  | "issuer_not_configured"
  | "issuer_mismatch"
  | "paused"
  | "unfunded"
  | "disabled"
  | "live";

export type CashRewardSnapshot = {
  generatedAt: string;
  epoch: number;
  epochStartsAt: string;
  epochEndsAt: string;
  recipient: string;
  verified: {
    fills: number;
    activeDays: number;
    feeUsd: number;
    actualVolumeUsd: number;
    capitalDollarHours: number;
    truncated: boolean;
  };
  components: {
    feesCash: number;
    capitalHoursCash: number;
    activeDaysCash: number;
  };
  totals: {
    earnedCash: number;
    claimedCash: number;
    claimableCash: number;
    walletBalanceCash: number;
    pendingCash: number;
    sentCash: number;
  };
  stream: {
    estimatedCashPerSecond: number;
    remainingWalletCapCash: number;
  };
  config: {
    enabled: boolean;
    disabledReason?: string;
    network: DecibelNetwork;
    rewardRateCashPerUsd: number;
    walletEpochCapCash: number;
    globalEpochCapCash: number;
    epochDurationSeconds: number;
  };
  contract: {
    status: CashRewardContractStatus;
    statusLabel: string;
    deployed: boolean;
    paused: boolean;
    managerAddress: string;
    vaultBalanceCash: number;
    epochEmittedCash: number;
    issuerMatches: boolean;
  };
  voucher: null | {
    epoch: string;
    cumulativeAmountAtomic: string;
    expiresAtSeconds: string;
    signature: number[];
    function: string;
    typeArguments: string[];
  };
};

type ContractState = {
  deployed: boolean;
  paused: boolean;
  vaultAtomic: bigint;
  epochEmittedAtomic: bigint;
  claimedAtomic: bigint;
  walletBalanceAtomic: bigint;
  maxEpochAtomic: bigint;
  maxWalletAtomic: bigint;
  epochDurationSeconds: number;
  currentEpoch: number;
  issuerPublicKey: string;
  issuerMatches: boolean;
};

export type CashRewardVoucher = {
  chainId: number;
  recipient: string;
  epoch: bigint;
  cumulativeAmountAtomic: bigint;
  expiresAtSeconds: bigint;
};

function atomicToCash(value: bigint): number {
  return Number(value) / CASH_ATOMIC_UNIT;
}

function cashToAtomic(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.floor(value * CASH_ATOMIC_UNIT));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePublicKey(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

function moveBytesToHex(value: unknown): string {
  if (typeof value === "string") return normalizePublicKey(value);
  if (Array.isArray(value)) {
    return value
      .map((byte) => Number(byte).toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();
  }
  return "";
}

function getNodeApiKey(): string | undefined {
  return (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY)
    ?.replace(/\r?\n/g, "")
    .trim();
}

function getAptos(network: DecibelNetwork): Aptos {
  const apiKey = getNodeApiKey();
  return new Aptos(
    new AptosConfig({
      network: network === "mainnet" ? Network.MAINNET : Network.TESTNET,
      clientConfig: apiKey
        ? network === "mainnet"
          ? { API_KEY: apiKey }
          : { HEADERS: { Authorization: `Bearer ${apiKey}` } }
        : undefined,
    }),
  );
}

function getIssuerPrivateKey(): Ed25519PrivateKey | null {
  const raw = process.env.CASH_REWARD_ISSUER_PRIVATE_KEY
    ?.replace(/^ed25519-priv-/i, "")
    .replace(/\r?\n/g, "")
    .trim();
  if (!raw) return null;
  try {
    return new Ed25519PrivateKey(raw);
  } catch {
    return null;
  }
}

function getConfiguredCaps() {
  return {
    epochDurationSeconds: rewardConfig.epochDurationSeconds,
    maxEpochAtomic: BigInt(rewardConfig.maxEpochEmissionAtomic),
    maxWalletAtomic: BigInt(rewardConfig.maxWalletEpochAtomic),
  };
}

function currentEpochAt(nowSeconds: number, durationSeconds: number): number {
  return Math.floor(nowSeconds / durationSeconds);
}

function normalizedAction(action: string) {
  return action.replace(/[^a-z]/gi, "").toLowerCase();
}

function actionDelta(action: string, size: number, currentSize: number): number {
  const normalized = normalizedAction(action);
  if (normalized === "openlong") return size;
  if (normalized === "openshort") return -size;
  if (normalized === "closelong") return -Math.min(size, Math.max(0, currentSize));
  if (normalized === "closeshort") return Math.min(size, Math.max(0, -currentSize));
  return 0;
}

function capitalBasis(positions: Map<string, PositionAccumulator>): number {
  let total = 0;
  for (const position of positions.values()) {
    total += Math.abs(position.size * position.lastPrice) / CONSERVATIVE_LEVERAGE;
  }
  return total;
}

export function calculateCashRewardEntitlement(args: {
  trades: DecibelTrade[];
  nowMs: number;
  epochStartMs: number;
  walletCapAtomic?: bigint;
}) {
  const deduped = new Map<string, DecibelTrade>();
  for (const trade of args.trades) {
    const timestamp = Number(trade.transaction_unix_ms);
    if (!Number.isFinite(timestamp) || timestamp < args.epochStartMs || timestamp > args.nowMs) continue;
    const key = `${trade.transaction_version}:${trade.trade_id}:${trade.market}:${trade.action}`;
    deduped.set(key, trade);
  }

  const trades = [...deduped.values()].sort(
    (a, b) => a.transaction_unix_ms - b.transaction_unix_ms || a.trade_id - b.trade_id,
  );
  const activeDays = new Set<string>();
  const positions = new Map<string, PositionAccumulator>();
  let lastTimestamp = args.epochStartMs;
  let capitalDollarHours = 0;
  let feeUsd = 0;
  let actualVolumeUsd = 0;

  for (const trade of trades) {
    const timestamp = clampNumber(trade.transaction_unix_ms, lastTimestamp, args.nowMs);
    capitalDollarHours += capitalBasis(positions) * ((timestamp - lastTimestamp) / 3_600_000);
    lastTimestamp = timestamp;

    const size = Math.abs(Number(trade.size));
    const price = Math.abs(Number(trade.price));
    if (!Number.isFinite(size) || !Number.isFinite(price) || size <= 0 || price <= 0) continue;

    const market = trade.market.toLowerCase();
    const current = positions.get(market) ?? { size: 0, lastPrice: price };
    const action = normalizedAction(trade.action);
    if (action.includes("liquidat")) {
      current.size = 0;
      current.lastPrice = price;
      positions.set(market, current);
      continue;
    }
    if (!["openlong", "openshort", "closelong", "closeshort"].includes(action)) continue;
    current.size += actionDelta(trade.action, size, current.size);
    if (Math.abs(current.size) < 1e-12) current.size = 0;
    current.lastPrice = price;
    positions.set(market, current);

    const fee = Math.abs(Number(trade.fee_amount));
    if (Number.isFinite(fee)) {
      feeUsd += fee * (trade.is_rebate ? REBATE_REWARD_MULTIPLIER : 1);
    }
    actualVolumeUsd += size * price;
    activeDays.add(new Date(timestamp).toISOString().slice(0, 10));
  }

  capitalDollarHours += capitalBasis(positions) * ((args.nowMs - lastTimestamp) / 3_600_000);

  const feeAtomic = cashToAtomic(feeUsd * FEE_REWARD_CASH_PER_USD);
  const capitalAtomic = cashToAtomic(capitalDollarHours * CAPITAL_HOUR_REWARD_CASH);
  const activeDayAtomic = cashToAtomic(activeDays.size * ACTIVE_DAY_REWARD_CASH);
  const rawAtomic = feeAtomic + capitalAtomic + activeDayAtomic;
  const configuredCap = args.walletCapAtomic ?? BigInt(rewardConfig.maxWalletEpochAtomic);
  const entitlementAtomic = rawAtomic > configuredCap ? configuredCap : rawAtomic;

  return {
    trades,
    activeDays: activeDays.size,
    feeUsd,
    actualVolumeUsd,
    capitalDollarHours,
    feeAtomic,
    capitalAtomic,
    activeDayAtomic,
    entitlementAtomic,
  };
}

async function fetchEpochTrades(
  subaccount: string,
  network: DecibelNetwork,
  epochStartMs: number,
): Promise<{ trades: DecibelTrade[]; truncated: boolean }> {
  const trades: DecibelTrade[] = [];
  for (let offset = 0; offset < MAX_TRADE_HISTORY; offset += TRADE_HISTORY_PAGE_SIZE) {
    const page = await getDecibelTradeHistory(subaccount, {
      network,
      limit: TRADE_HISTORY_PAGE_SIZE,
      offset,
    });
    trades.push(...page);
    if (page.length < TRADE_HISTORY_PAGE_SIZE) break;
    const oldest = Math.min(...page.map((trade) => trade.transaction_unix_ms));
    if (Number.isFinite(oldest) && oldest < epochStartMs) break;
  }
  return { trades, truncated: trades.length >= MAX_TRADE_HISTORY };
}

async function safeView(
  aptos: Aptos,
  functionName: string,
  typeArguments: string[],
  functionArguments: Array<string | number | boolean | number[]>,
): Promise<unknown[] | null> {
  try {
    return (await aptos.view({
      payload: {
        function: functionName as `${string}::${string}::${string}`,
        typeArguments,
        functionArguments,
      },
    })) as unknown[];
  } catch {
    return null;
  }
}

async function readContractState(args: {
  network: DecibelNetwork;
  recipient: string;
  fallbackEpoch: number;
}): Promise<ContractState> {
  const configured = getConfiguredCaps();
  const aptos = getAptos(args.network);
  const walletBalanceResult = await safeView(
    aptos,
    "0x1::coin::balance",
    [CASH_COIN_TYPE],
    [args.recipient],
  );
  const walletBalanceAtomic = BigInt(String(walletBalanceResult?.[0] ?? 0));
  const state = await safeView(
    aptos,
    `${CASH_REWARD_MODULE}::get_state`,
    [CASH_COIN_TYPE],
    [],
  );

  if (!state || state.length < 7) {
    return {
      deployed: false,
      paused: true,
      vaultAtomic: 0n,
      epochEmittedAtomic: 0n,
      claimedAtomic: 0n,
      walletBalanceAtomic,
      maxEpochAtomic: configured.maxEpochAtomic,
      maxWalletAtomic: configured.maxWalletAtomic,
      epochDurationSeconds: configured.epochDurationSeconds,
      currentEpoch: args.fallbackEpoch,
      issuerPublicKey: "",
      issuerMatches: false,
    };
  }

  const epochDurationSeconds = Number(state[3]);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const currentEpoch = currentEpochAt(nowSeconds, epochDurationSeconds);
  const [claimed, emitted] = await Promise.all([
    safeView(aptos, `${CASH_REWARD_MODULE}::claimed_by`, [], [args.recipient, String(currentEpoch)]),
    safeView(aptos, `${CASH_REWARD_MODULE}::emitted_in_epoch`, [], [String(currentEpoch)]),
  ]);
  const issuerPublicKey = moveBytesToHex(state[1]);

  return {
    deployed: true,
    paused: state[2] === true || state[2] === "true",
    vaultAtomic: BigInt(String(state[6])),
    epochEmittedAtomic: BigInt(String(emitted?.[0] ?? 0)),
    claimedAtomic: BigInt(String(claimed?.[0] ?? 0)),
    walletBalanceAtomic,
    maxEpochAtomic: BigInt(String(state[4])),
    maxWalletAtomic: BigInt(String(state[5])),
    epochDurationSeconds,
    currentEpoch,
    issuerPublicKey,
    issuerMatches:
      issuerPublicKey === normalizePublicKey(rewardConfig.issuerPublicKey),
  };
}

export function serializeCashRewardVoucherForAsset(
  voucher: CashRewardVoucher,
  managerAddress: string,
  assetType: string,
): Uint8Array {
  const serializer = new Serializer();
  serializer.serializeU8(VOUCHER_VERSION);
  serializer.serializeU8(voucher.chainId);
  AccountAddress.fromString(managerAddress).serialize(serializer);
  serializer.serializeBytes(new TextEncoder().encode(assetType));
  AccountAddress.fromString(voucher.recipient).serialize(serializer);
  serializer.serializeU64(voucher.epoch);
  serializer.serializeU64(voucher.cumulativeAmountAtomic);
  serializer.serializeU64(voucher.expiresAtSeconds);
  return serializer.toUint8Array();
}

export function serializeCashRewardVoucher(voucher: CashRewardVoucher): Uint8Array {
  return serializeCashRewardVoucherForAsset(
    voucher,
    CASH_REWARD_MANAGER_ADDRESS,
    CASH_COIN_TYPE,
  );
}

function contractStatus(args: {
  state: ContractState;
  issuerConfigured: boolean;
  runtimeIssuerMatches: boolean;
  rewardsEnabled: boolean;
}): { status: CashRewardContractStatus; label: string; reason?: string } {
  if (!args.state.deployed) {
    return {
      status: "awaiting_manager_gas",
      label: "Preview · manager awaiting gas",
      reason: "The capped reward contract has not been published yet.",
    };
  }
  if (!args.issuerConfigured) {
    return {
      status: "issuer_not_configured",
      label: "Preview · issuer offline",
      reason: "The eligibility signer is intentionally offline.",
    };
  }
  if (!args.runtimeIssuerMatches) {
    return {
      status: "issuer_mismatch",
      label: "Paused · runtime issuer mismatch",
      reason: "The configured signing secret does not match the public issuer key.",
    };
  }
  if (!args.state.issuerMatches) {
    return {
      status: "issuer_mismatch",
      label: "Paused · issuer mismatch",
      reason: "The web signer does not match the key protected by the contract.",
    };
  }
  if (args.state.paused) {
    return {
      status: "paused",
      label: "Preview · claims paused",
      reason: "Claims remain paused until the canary claim passes.",
    };
  }
  if (args.state.vaultAtomic === 0n) {
    return {
      status: "unfunded",
      label: "Ready · vault unfunded",
      reason: "The distributor is ready but has not received CASH.",
    };
  }
  if (!args.rewardsEnabled) {
    return {
      status: "disabled",
      label: "Paused by cash.trading",
      reason: "Reward voucher issuance is disabled during launch checks.",
    };
  }
  return { status: "live", label: "Live · on-chain capped" };
}

export async function getCashRewardSnapshot(args: {
  network: DecibelNetwork;
  owner: string;
  subaccount: string;
}): Promise<CashRewardSnapshot> {
  const nowMs = Date.now();
  const configured = getConfiguredCaps();
  const fallbackEpoch = currentEpochAt(Math.floor(nowMs / 1_000), configured.epochDurationSeconds);
  const fallbackEpochStartMs = fallbackEpoch * configured.epochDurationSeconds * 1_000;
  const [contract, tradeResult, overview] = await Promise.all([
    readContractState({ network: args.network, recipient: args.owner, fallbackEpoch }),
    fetchEpochTrades(args.subaccount, args.network, fallbackEpochStartMs),
    getDecibelAccountOverview(args.subaccount, {
      network: args.network,
      volumeWindow: "30d",
      includePerformance: false,
    }),
  ]);

  const epoch = contract.currentEpoch;
  const epochStartMs = epoch * contract.epochDurationSeconds * 1_000;
  const epochEndMs = epochStartMs + contract.epochDurationSeconds * 1_000;
  const eligibility = calculateCashRewardEntitlement({
    trades: tradeResult.trades,
    nowMs,
    epochStartMs,
    walletCapAtomic: contract.maxWalletAtomic,
  });
  const earnedAtomic = eligibility.entitlementAtomic;
  const claimedAtomic = contract.claimedAtomic > earnedAtomic ? earnedAtomic : contract.claimedAtomic;
  const claimableAtomic = earnedAtomic - claimedAtomic;
  const issuer = getIssuerPrivateKey();
  const issuerConfigured = Boolean(issuer);
  const runtimeIssuerMatches = issuer
    ? normalizePublicKey(issuer.publicKey().toString()) ===
      normalizePublicKey(rewardConfig.issuerPublicKey)
    : false;
  const rewardsEnabled = process.env.CASH_REWARDS_ENABLED === "true";
  const status = contractStatus({
    state: contract,
    issuerConfigured,
    runtimeIssuerMatches,
    rewardsEnabled,
  });
  const active = status.status === "live";
  const expiresAtSeconds = BigInt(Math.floor(nowMs / 1_000) + rewardConfig.voucherTtlSeconds);
  const voucher: CashRewardVoucher = {
    chainId: args.network === "mainnet" ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID,
    recipient: args.owner,
    epoch: BigInt(epoch),
    cumulativeAmountAtomic: earnedAtomic,
    expiresAtSeconds,
  };
  const signature =
    active && issuer && claimableAtomic > 0n
      ? Array.from(issuer.sign(serializeCashRewardVoucher(voucher)).toUint8Array())
      : null;
  const estimatedCashPerSecond = calculateEstimatedStreamRate(overview, earnedAtomic, contract.maxWalletAtomic);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    epoch,
    epochStartsAt: new Date(epochStartMs).toISOString(),
    epochEndsAt: new Date(epochEndMs).toISOString(),
    recipient: args.owner,
    verified: {
      fills: eligibility.trades.length,
      activeDays: eligibility.activeDays,
      feeUsd: eligibility.feeUsd,
      actualVolumeUsd: eligibility.actualVolumeUsd,
      capitalDollarHours: eligibility.capitalDollarHours,
      truncated: tradeResult.truncated,
    },
    components: {
      feesCash: atomicToCash(eligibility.feeAtomic),
      capitalHoursCash: atomicToCash(eligibility.capitalAtomic),
      activeDaysCash: atomicToCash(eligibility.activeDayAtomic),
    },
    totals: {
      earnedCash: atomicToCash(earnedAtomic),
      claimedCash: atomicToCash(contract.claimedAtomic),
      claimableCash: atomicToCash(claimableAtomic),
      walletBalanceCash: atomicToCash(contract.walletBalanceAtomic),
      pendingCash: atomicToCash(claimableAtomic),
      sentCash: atomicToCash(contract.claimedAtomic),
    },
    stream: {
      estimatedCashPerSecond,
      remainingWalletCapCash: atomicToCash(contract.maxWalletAtomic - earnedAtomic),
    },
    config: {
      enabled: active,
      disabledReason: status.reason,
      network: args.network,
      rewardRateCashPerUsd: FEE_REWARD_CASH_PER_USD,
      walletEpochCapCash: atomicToCash(contract.maxWalletAtomic),
      globalEpochCapCash: atomicToCash(contract.maxEpochAtomic),
      epochDurationSeconds: contract.epochDurationSeconds,
    },
    contract: {
      status: status.status,
      statusLabel: status.label,
      deployed: contract.deployed,
      paused: contract.paused,
      managerAddress: CASH_REWARD_MANAGER_ADDRESS,
      vaultBalanceCash: atomicToCash(contract.vaultAtomic),
      epochEmittedCash: atomicToCash(contract.epochEmittedAtomic),
      issuerMatches: contract.issuerMatches && runtimeIssuerMatches,
    },
    voucher: signature
      ? {
          epoch: String(epoch),
          cumulativeAmountAtomic: earnedAtomic.toString(),
          expiresAtSeconds: expiresAtSeconds.toString(),
          signature,
          function: `${CASH_REWARD_MODULE}::claim`,
          typeArguments: [CASH_COIN_TYPE],
        }
      : null,
  };
}

function calculateEstimatedStreamRate(
  overview: DecibelAccountOverview | null,
  earnedAtomic: bigint,
  walletCapAtomic: bigint,
): number {
  if (!overview || earnedAtomic >= walletCapAtomic) return 0;
  const margin = Number(overview.total_margin);
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  return (margin * CAPITAL_HOUR_REWARD_CASH) / 3_600;
}

/**
 * Legacy bot hook retained as a no-transfer compatibility shim. Bot activity
 * is now picked up from Decibel's verified trade history by the cumulative
 * claim endpoint; the server never sends tokens directly after a trade.
 */
export async function recordCashRewardForTrade(input: TradeRewardInput) {
  return {
    sourceId: input.sourceId,
    userWalletAddress: input.userWalletAddress,
    userSubaccount: input.userSubaccount ?? null,
    status: "verified_by_decibel_history",
  };
}

export function getCashRewardConfig() {
  const configured = getConfiguredCaps();
  return {
    enabled: process.env.CASH_REWARDS_ENABLED === "true",
    explicitlyDisabled: process.env.CASH_REWARDS_ENABLED !== "true",
    disabledReason:
      process.env.CASH_REWARDS_ENABLED === "true"
        ? undefined
        : "CASH rewards remain in preview until the canary claim passes",
    network: (rewardConfig.network === "mainnet" ? Network.MAINNET : Network.TESTNET),
    rewardRateCashPerUsd: FEE_REWARD_CASH_PER_USD,
    minVolumeUsd: 0,
    maxCashPerTrade: atomicToCash(configured.maxWalletAtomic),
    walletDailyCapCash: atomicToCash(configured.maxWalletAtomic),
    globalDailyCapCash: atomicToCash(configured.maxEpochAtomic),
  };
}

export async function processPendingCashRewards() {
  return [];
}
