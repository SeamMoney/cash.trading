import {
  AccountAddress,
  Aptos,
  AptosApiError,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  Serializer,
} from "@aptos-labs/ts-sdk";
import type { Prisma } from "@prisma/client";
import rewardConfig from "@/config/cash-rewards.json";
import {
  getDecibelTradeHistory,
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
const MAX_TRADE_HISTORY_OFFSET = 10_000;
const REWARD_LEDGER_STATE_VERSION = 1;
const CHECKPOINT_WRITE_RETRIES = 3;
const FEE_REWARD_CASH_PER_USD = rewardConfig.feeRewardCashPerUsd;
const REBATE_REWARD_MULTIPLIER = rewardConfig.rebateRewardMultiplier;
const CAPITAL_HOUR_REWARD_CASH = rewardConfig.capitalHourRewardCash;
const ACTIVE_DAY_REWARD_CASH = rewardConfig.activeDayRewardCash;
const CONSERVATIVE_LEVERAGE = rewardConfig.conservativeLeverage;

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

export type CashRewardLedgerState = {
  version: typeof REWARD_LEDGER_STATE_VERSION;
  epochStartMs: number;
  cursorTimestampMs: number;
  cursorKeys: string[];
  accruedThroughMs: number;
  positions: Record<string, PositionAccumulator>;
  activeDays: string[];
  fills: number;
  feeUsd: number;
  actualVolumeUsd: number;
  capitalDollarHours: number;
  seedTruncated: boolean;
  sourceTruncated: boolean;
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
    capitalHourRewardCash: number;
    activeDayRewardCash: number;
    formulaVersion: number;
    formulaEffectiveEpoch: number;
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
  initialized: boolean;
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

function tradeTimestamp(trade: DecibelTrade): number | null {
  const timestamp = Number(trade.transaction_unix_ms);
  return Number.isFinite(timestamp) && timestamp >= 0 ? Math.trunc(timestamp) : null;
}

function tradeCursorKey(trade: DecibelTrade): string {
  return `${trade.transaction_version}:${trade.trade_id}:${trade.market}:${trade.action}`;
}

function sortAndDedupeTrades(trades: DecibelTrade[]): DecibelTrade[] {
  const deduped = new Map<string, DecibelTrade>();
  for (const trade of trades) {
    const timestamp = tradeTimestamp(trade);
    if (timestamp === null) continue;
    deduped.set(tradeCursorKey(trade), trade);
  }
  return [...deduped.values()].sort((a, b) => {
    const timestampDelta = Number(a.transaction_unix_ms) - Number(b.transaction_unix_ms);
    if (timestampDelta !== 0) return timestampDelta;
    const versionDelta = Number(a.transaction_version) - Number(b.transaction_version);
    if (versionDelta !== 0) return versionDelta;
    const tradeIdDelta = Number(a.trade_id) - Number(b.trade_id);
    if (tradeIdDelta !== 0) return tradeIdDelta;
    return tradeCursorKey(a).localeCompare(tradeCursorKey(b));
  });
}

function positionMapFromRecord(
  positions: Record<string, PositionAccumulator>,
): Map<string, PositionAccumulator> {
  return new Map(
    Object.entries(positions).map(([market, position]) => [market, { ...position }]),
  );
}

function positionRecordFromMap(
  positions: Map<string, PositionAccumulator>,
): Record<string, PositionAccumulator> {
  return Object.fromEntries(
    [...positions.entries()]
      .filter(([, position]) => Number.isFinite(position.size) && Number.isFinite(position.lastPrice))
      .map(([market, position]) => [market, { ...position }]),
  );
}

function applyTradeToPositions(
  positions: Map<string, PositionAccumulator>,
  trade: DecibelTrade,
): { eligible: boolean; size: number; price: number } {
  const market = String(trade.market ?? "").trim().toLowerCase();
  const size = Math.abs(Number(trade.size));
  const price = Math.abs(Number(trade.price));
  const action = normalizedAction(String(trade.action ?? ""));
  if (!market || !Number.isFinite(price) || price <= 0) {
    return { eligible: false, size, price };
  }

  const current = positions.get(market) ?? { size: 0, lastPrice: price };
  if (action.includes("liquidat")) {
    current.size = 0;
    current.lastPrice = price;
    positions.set(market, current);
    return { eligible: false, size, price };
  }
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !["openlong", "openshort", "closelong", "closeshort"].includes(action)
  ) {
    return { eligible: false, size, price };
  }

  current.size += actionDelta(action, size, current.size);
  if (Math.abs(current.size) < 1e-12) current.size = 0;
  current.lastPrice = price;
  positions.set(market, current);
  return { eligible: true, size, price };
}

export function createCashRewardLedgerState(args: {
  epochStartMs: number;
  seedTrades?: DecibelTrade[];
  seedTruncated?: boolean;
}): CashRewardLedgerState {
  if (!Number.isFinite(args.epochStartMs) || args.epochStartMs < 0) {
    throw new Error("Invalid CASH reward epoch boundary");
  }
  const epochStartMs = Math.trunc(args.epochStartMs);
  const positions = new Map<string, PositionAccumulator>();
  for (const trade of sortAndDedupeTrades(args.seedTrades ?? [])) {
    const timestamp = tradeTimestamp(trade);
    if (timestamp === null || timestamp >= epochStartMs) continue;
    applyTradeToPositions(positions, trade);
  }

  return {
    version: REWARD_LEDGER_STATE_VERSION,
    epochStartMs,
    cursorTimestampMs: epochStartMs - 1,
    cursorKeys: [],
    accruedThroughMs: epochStartMs,
    positions: positionRecordFromMap(positions),
    activeDays: [],
    fills: 0,
    feeUsd: 0,
    actualVolumeUsd: 0,
    capitalDollarHours: 0,
    seedTruncated: Boolean(args.seedTruncated),
    sourceTruncated: false,
  };
}

export function advanceCashRewardLedgerState(args: {
  state: CashRewardLedgerState;
  trades: DecibelTrade[];
  throughMs: number;
  sourceTruncated?: boolean;
}): CashRewardLedgerState {
  const state = parseCashRewardLedgerState(args.state, args.state.epochStartMs);
  const throughMs = Math.max(state.epochStartMs, Math.trunc(args.throughMs));
  const positions = positionMapFromRecord(state.positions);
  const activeDays = new Set(state.activeDays);
  let cursorTimestampMs = state.cursorTimestampMs;
  let cursorKeys = new Set(state.cursorKeys);
  let accruedThroughMs = state.accruedThroughMs;
  let fills = state.fills;
  let feeUsd = state.feeUsd;
  let actualVolumeUsd = state.actualVolumeUsd;
  let capitalDollarHours = state.capitalDollarHours;

  for (const trade of sortAndDedupeTrades(args.trades)) {
    const timestamp = tradeTimestamp(trade);
    if (timestamp === null || timestamp < state.epochStartMs || timestamp > throughMs) continue;
    const key = tradeCursorKey(trade);
    if (timestamp < cursorTimestampMs || (timestamp === cursorTimestampMs && cursorKeys.has(key))) {
      continue;
    }

    const boundedTimestamp = clampNumber(timestamp, accruedThroughMs, throughMs);
    capitalDollarHours +=
      capitalBasis(positions) * ((boundedTimestamp - accruedThroughMs) / 3_600_000);
    accruedThroughMs = boundedTimestamp;
    fills += 1;

    const applied = applyTradeToPositions(positions, trade);
    if (applied.eligible) {
      const fee = Math.abs(Number(trade.fee_amount));
      if (Number.isFinite(fee)) {
        feeUsd += fee * (trade.is_rebate ? REBATE_REWARD_MULTIPLIER : 1);
      }
      actualVolumeUsd += applied.size * applied.price;
      activeDays.add(new Date(timestamp).toISOString().slice(0, 10));
    }

    if (timestamp > cursorTimestampMs) {
      cursorTimestampMs = timestamp;
      cursorKeys = new Set([key]);
    } else {
      cursorKeys.add(key);
    }
  }

  return {
    version: REWARD_LEDGER_STATE_VERSION,
    epochStartMs: state.epochStartMs,
    cursorTimestampMs,
    cursorKeys: [...cursorKeys].sort(),
    accruedThroughMs,
    positions: positionRecordFromMap(positions),
    activeDays: [...activeDays].sort(),
    fills,
    feeUsd,
    actualVolumeUsd,
    capitalDollarHours,
    seedTruncated: state.seedTruncated,
    sourceTruncated: Boolean(args.sourceTruncated),
  };
}

export function calculateCashRewardLedgerEntitlement(args: {
  state: CashRewardLedgerState;
  nowMs: number;
  epochEndMs?: number;
  walletCapAtomic?: bigint;
}) {
  const state = parseCashRewardLedgerState(args.state, args.state.epochStartMs);
  const upperBound = args.epochEndMs ?? args.nowMs;
  const effectiveNowMs = clampNumber(
    Math.trunc(args.nowMs),
    state.accruedThroughMs,
    Math.max(state.accruedThroughMs, Math.trunc(upperBound)),
  );
  const positions = positionMapFromRecord(state.positions);
  const currentCapitalBasisUsd = capitalBasis(positions);
  const liveCapitalDollarHours = state.sourceTruncated
    ? 0
    : currentCapitalBasisUsd * ((effectiveNowMs - state.accruedThroughMs) / 3_600_000);
  const capitalDollarHours = state.capitalDollarHours + liveCapitalDollarHours;
  const feeAtomic = cashToAtomic(state.feeUsd * FEE_REWARD_CASH_PER_USD);
  const capitalAtomic = cashToAtomic(capitalDollarHours * CAPITAL_HOUR_REWARD_CASH);
  const activeDayAtomic = cashToAtomic(state.activeDays.length * ACTIVE_DAY_REWARD_CASH);
  const rawAtomic = feeAtomic + capitalAtomic + activeDayAtomic;
  const configuredCap = args.walletCapAtomic ?? BigInt(rewardConfig.maxWalletEpochAtomic);
  const entitlementAtomic = rawAtomic > configuredCap ? configuredCap : rawAtomic;

  return {
    fills: state.fills,
    activeDays: state.activeDays.length,
    feeUsd: state.feeUsd,
    actualVolumeUsd: state.actualVolumeUsd,
    capitalDollarHours,
    currentCapitalBasisUsd,
    feeAtomic,
    capitalAtomic,
    activeDayAtomic,
    entitlementAtomic,
    truncated: state.seedTruncated || state.sourceTruncated,
    sourceTruncated: state.sourceTruncated,
  };
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseCashRewardLedgerState(
  value: unknown,
  expectedEpochStartMs: number,
): CashRewardLedgerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CASH reward checkpoint is malformed");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== REWARD_LEDGER_STATE_VERSION) {
    throw new Error("CASH reward checkpoint version is unsupported");
  }
  const epochStartMs = finiteNonNegative(raw.epochStartMs);
  const cursorTimestampMs = Number(raw.cursorTimestampMs);
  const accruedThroughMs = finiteNonNegative(raw.accruedThroughMs);
  const fills = finiteNonNegative(raw.fills);
  const feeUsd = finiteNonNegative(raw.feeUsd);
  const actualVolumeUsd = finiteNonNegative(raw.actualVolumeUsd);
  const capitalDollarHours = finiteNonNegative(raw.capitalDollarHours);
  if (
    epochStartMs === null ||
    epochStartMs !== expectedEpochStartMs ||
    !Number.isFinite(cursorTimestampMs) ||
    accruedThroughMs === null ||
    accruedThroughMs < epochStartMs ||
    fills === null ||
    !Number.isInteger(fills) ||
    feeUsd === null ||
    actualVolumeUsd === null ||
    capitalDollarHours === null ||
    !Array.isArray(raw.cursorKeys) ||
    !raw.cursorKeys.every((key) => typeof key === "string") ||
    !Array.isArray(raw.activeDays) ||
    !raw.activeDays.every((day) => typeof day === "string") ||
    !raw.positions ||
    typeof raw.positions !== "object" ||
    Array.isArray(raw.positions)
  ) {
    throw new Error("CASH reward checkpoint failed validation");
  }

  const positions: Record<string, PositionAccumulator> = {};
  for (const [market, candidate] of Object.entries(raw.positions as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("CASH reward checkpoint contains an invalid position");
    }
    const position = candidate as Record<string, unknown>;
    const size = Number(position.size);
    const lastPrice = finiteNonNegative(position.lastPrice);
    if (!Number.isFinite(size) || lastPrice === null) {
      throw new Error("CASH reward checkpoint contains an invalid position");
    }
    positions[market] = { size, lastPrice };
  }

  return {
    version: REWARD_LEDGER_STATE_VERSION,
    epochStartMs,
    cursorTimestampMs: Math.trunc(cursorTimestampMs),
    cursorKeys: [...new Set(raw.cursorKeys as string[])].sort(),
    accruedThroughMs,
    positions,
    activeDays: [...new Set(raw.activeDays as string[])].sort(),
    fills,
    feeUsd,
    actualVolumeUsd,
    capitalDollarHours,
    seedTruncated: raw.seedTruncated === true,
    sourceTruncated: raw.sourceTruncated === true,
  };
}

export function calculateCashRewardEntitlement(args: {
  trades: DecibelTrade[];
  nowMs: number;
  epochStartMs: number;
  walletCapAtomic?: bigint;
}) {
  const history = sortAndDedupeTrades(args.trades).filter(
    (trade) => (tradeTimestamp(trade) ?? Number.POSITIVE_INFINITY) <= args.nowMs,
  );
  const trades = history.filter(
    (trade) => (tradeTimestamp(trade) ?? Number.NEGATIVE_INFINITY) >= args.epochStartMs,
  );
  const state = advanceCashRewardLedgerState({
    state: createCashRewardLedgerState({
      epochStartMs: args.epochStartMs,
      seedTrades: history,
    }),
    trades,
    throughMs: args.nowMs,
  });
  const entitlement = calculateCashRewardLedgerEntitlement({
    state,
    nowMs: args.nowMs,
    walletCapAtomic: args.walletCapAtomic,
  });

  return {
    trades,
    activeDays: entitlement.activeDays,
    feeUsd: entitlement.feeUsd,
    actualVolumeUsd: entitlement.actualVolumeUsd,
    capitalDollarHours: entitlement.capitalDollarHours,
    currentCapitalBasisUsd: entitlement.currentCapitalBasisUsd,
    feeAtomic: entitlement.feeAtomic,
    capitalAtomic: entitlement.capitalAtomic,
    activeDayAtomic: entitlement.activeDayAtomic,
    entitlementAtomic: entitlement.entitlementAtomic,
  };
}

async function fetchTradeHistoryWindow(args: {
  subaccount: string,
  network: DecibelNetwork;
  startTimestamp?: number;
  endTimestamp?: number;
  sortDir: "ASC" | "DESC";
  maxRows: number;
}): Promise<DecibelTrade[]> {
  const trades: DecibelTrade[] = [];
  const maxRows = Math.min(Math.max(1, Math.trunc(args.maxRows)), MAX_TRADE_HISTORY_OFFSET);
  for (let offset = 0; offset < maxRows; offset += TRADE_HISTORY_PAGE_SIZE) {
    const page = await getDecibelTradeHistory(args.subaccount, {
      network: args.network,
      limit: TRADE_HISTORY_PAGE_SIZE,
      offset,
      startTimestamp: args.startTimestamp,
      endTimestamp: args.endTimestamp,
      sortDir: args.sortDir,
      strict: true,
    });
    trades.push(...page);
    if (page.length < TRADE_HISTORY_PAGE_SIZE) break;
  }
  return trades.slice(0, maxRows);
}

async function seedCashRewardLedger(
  subaccount: string,
  network: DecibelNetwork,
  epochStartMs: number,
): Promise<CashRewardLedgerState> {
  const seedTrades = await fetchTradeHistoryWindow({
    subaccount,
    network,
    endTimestamp: epochStartMs - 1,
    sortDir: "DESC",
    maxRows: MAX_TRADE_HISTORY,
  });
  return createCashRewardLedgerState({
    epochStartMs,
    seedTrades,
    seedTruncated: seedTrades.length >= MAX_TRADE_HISTORY,
  });
}

async function fetchIncrementalEpochTrades(args: {
  subaccount: string;
  network: DecibelNetwork;
  state: CashRewardLedgerState;
  nowMs: number;
}): Promise<{ trades: DecibelTrade[]; truncated: boolean }> {
  const boundaryKeys = new Set(args.state.cursorKeys);
  const rawLimit = Math.min(
    MAX_TRADE_HISTORY_OFFSET,
    MAX_TRADE_HISTORY + boundaryKeys.size + 1,
  );
  const raw = await fetchTradeHistoryWindow({
    subaccount: args.subaccount,
    network: args.network,
    startTimestamp: Math.max(args.state.epochStartMs, args.state.cursorTimestampMs),
    endTimestamp: args.nowMs,
    sortDir: "ASC",
    maxRows: rawLimit,
  });
  const unseen = sortAndDedupeTrades(raw).filter((trade) => {
    const timestamp = tradeTimestamp(trade);
    if (timestamp === null || timestamp < args.state.cursorTimestampMs) return false;
    return timestamp > args.state.cursorTimestampMs || !boundaryKeys.has(tradeCursorKey(trade));
  });
  return {
    trades: unseen.slice(0, MAX_TRADE_HISTORY),
    truncated: unseen.length > MAX_TRADE_HISTORY || raw.length >= rawLimit,
  };
}

type CashRewardCheckpointResult = {
  state: CashRewardLedgerState;
  earnedAtomic: bigint;
};

function checkpointStateJson(state: CashRewardLedgerState): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
}

function normalizedCheckpointAddress(value: string): string {
  return value.trim().toLowerCase();
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

async function getCashRewardCheckpoint(args: {
  network: DecibelNetwork;
  owner: string;
  subaccount: string;
  epoch: number;
  epochStartMs: number;
  epochEndMs: number;
  nowMs: number;
  walletCapAtomic: bigint;
}): Promise<CashRewardCheckpointResult> {
  const { prisma } = await import("@/lib/prisma");
  const network = args.network;
  const ownerAddress = normalizedCheckpointAddress(args.owner);
  const subaccountAddress = normalizedCheckpointAddress(args.subaccount);
  const checkpointKey = {
    network_ownerAddress_subaccountAddress_epoch: {
      network,
      ownerAddress,
      subaccountAddress,
      epoch: args.epoch,
    },
  };

  for (let attempt = 0; attempt < CHECKPOINT_WRITE_RETRIES; attempt += 1) {
    const existing = await prisma.cashRewardEpochCheckpoint.findUnique({
      where: checkpointKey,
    });
    if (existing && existing.formulaVersion !== rewardConfig.formulaVersion) {
      throw new Error("CASH reward formula changed during an active epoch");
    }

    const currentState = existing
      ? parseCashRewardLedgerState(existing.state, args.epochStartMs)
      : await seedCashRewardLedger(subaccountAddress, network, args.epochStartMs);
    const incremental = await fetchIncrementalEpochTrades({
      subaccount: subaccountAddress,
      network,
      state: currentState,
      nowMs: args.nowMs,
    });
    const nextState = advanceCashRewardLedgerState({
      state: currentState,
      trades: incremental.trades,
      throughMs: args.nowMs,
      sourceTruncated: incremental.truncated,
    });
    // Persist only amounts accrued through the last verified fill. The API can
    // render the open-position stream from this cursor without turning every
    // 15-second refresh into a Neon write.
    const entitlement = calculateCashRewardLedgerEntitlement({
      state: nextState,
      nowMs: nextState.accruedThroughMs,
      epochEndMs: args.epochEndMs,
      walletCapAtomic: args.walletCapAtomic,
    });
    const earnedAtomic =
      existing && existing.earnedAtomic > entitlement.entitlementAtomic
        ? existing.earnedAtomic
        : entitlement.entitlementAtomic;
    const stateChanged = JSON.stringify(currentState) !== JSON.stringify(nextState);
    const earnedChanged = !existing || existing.earnedAtomic !== earnedAtomic;

    if (!existing) {
      try {
        await prisma.cashRewardEpochCheckpoint.create({
          data: {
            network,
            ownerAddress,
            subaccountAddress,
            epoch: args.epoch,
            formulaVersion: rewardConfig.formulaVersion,
            state: checkpointStateJson(nextState),
            earnedAtomic,
            sourceTruncated: nextState.sourceTruncated,
          },
        });
        return { state: nextState, earnedAtomic };
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) continue;
        throw error;
      }
    }

    if (!stateChanged && !earnedChanged) {
      return { state: nextState, earnedAtomic };
    }
    const updated = await prisma.cashRewardEpochCheckpoint.updateMany({
      where: { id: existing.id, revision: existing.revision },
      data: {
        state: checkpointStateJson(nextState),
        earnedAtomic,
        sourceTruncated: nextState.sourceTruncated,
        revision: { increment: 1 },
      },
    });
    if (updated.count === 1) return { state: nextState, earnedAtomic };
  }

  throw new Error("CASH reward checkpoint changed concurrently; retry the request");
}

async function requiredView(
  aptos: Aptos,
  functionName: string,
  typeArguments: string[],
  functionArguments: Array<string | number | boolean | number[]>,
): Promise<unknown[]> {
  return (await aptos.view({
    payload: {
      function: functionName as `${string}::${string}::${string}`,
      typeArguments,
      functionArguments,
    },
  })) as unknown[];
}

function isAptosNotFound(error: unknown): boolean {
  return error instanceof AptosApiError && error.status === 404;
}

async function rewardModuleIsPublished(aptos: Aptos): Promise<boolean> {
  try {
    await aptos.getAccountModule({
      accountAddress: CASH_REWARD_MANAGER_ADDRESS,
      moduleName: "cash_rewards",
    });
    return true;
  } catch (error) {
    if (isAptosNotFound(error)) return false;
    throw error;
  }
}

async function rewardContractIsInitialized(aptos: Aptos): Promise<boolean> {
  try {
    await aptos.getAccountResource({
      accountAddress: CASH_REWARD_MANAGER_ADDRESS,
      resourceType: `${CASH_REWARD_MODULE}::Config` as `${string}::${string}::${string}`,
    });
    return true;
  } catch (error) {
    if (isAptosNotFound(error)) return false;
    throw error;
  }
}

async function readContractState(args: {
  network: DecibelNetwork;
  recipient: string;
  fallbackEpoch: number;
}): Promise<ContractState> {
  const configured = getConfiguredCaps();
  const aptos = getAptos(args.network);
  const [walletBalance, deployed] = await Promise.all([
    aptos.getAccountCoinAmount({
      accountAddress: args.recipient,
      coinType: CASH_COIN_TYPE as `${string}::${string}::${string}`,
    }),
    rewardModuleIsPublished(aptos),
  ]);
  if (!Number.isSafeInteger(walletBalance) || walletBalance < 0) {
    throw new Error("Aptos returned an invalid CASH wallet balance");
  }
  const walletBalanceAtomic = BigInt(walletBalance);

  if (!deployed) {
    return {
      deployed: false,
      initialized: false,
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

  let state: unknown[];
  try {
    state = await requiredView(
      aptos,
      `${CASH_REWARD_MODULE}::get_state`,
      [CASH_COIN_TYPE],
      [],
    );
  } catch (error) {
    const initialized = await rewardContractIsInitialized(aptos);
    if (initialized) throw error;
    return {
      deployed: true,
      initialized: false,
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
  if (state.length < 7) {
    throw new Error("CASH reward contract returned incomplete state");
  }

  const epochDurationSeconds = Number(state[3]);
  if (!Number.isSafeInteger(epochDurationSeconds) || epochDurationSeconds <= 0) {
    throw new Error("CASH reward contract returned an invalid epoch duration");
  }
  const currentEpochResult = await requiredView(
    aptos,
    `${CASH_REWARD_MODULE}::current_epoch`,
    [],
    [],
  );
  if (currentEpochResult.length < 1) {
    throw new Error("CASH reward contract returned an incomplete epoch");
  }
  const currentEpoch = Number(currentEpochResult[0]);
  if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0) {
    throw new Error("CASH reward contract returned an invalid epoch");
  }
  const [claimed, emitted] = await Promise.all([
    requiredView(
      aptos,
      `${CASH_REWARD_MODULE}::claimed_by`,
      [],
      [args.recipient, String(currentEpoch)],
    ),
    requiredView(
      aptos,
      `${CASH_REWARD_MODULE}::emitted_in_epoch`,
      [],
      [String(currentEpoch)],
    ),
  ]);
  if (claimed.length < 1 || emitted.length < 1) {
    throw new Error("CASH reward contract returned incomplete claim accounting");
  }
  const issuerPublicKey = moveBytesToHex(state[1]);

  return {
    deployed: true,
    initialized: true,
    paused: state[2] === true || state[2] === "true",
    vaultAtomic: BigInt(String(state[6])),
    epochEmittedAtomic: BigInt(String(emitted[0])),
    claimedAtomic: BigInt(String(claimed[0])),
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
      label: "Preview · contract not published",
      reason: "The capped reward contract has not been published yet.",
    };
  }
  if (!args.state.initialized) {
    return {
      status: "awaiting_manager_gas",
      label: "Preview · contract not initialized",
      reason: "The capped reward contract is published but has not been initialized.",
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
  const contract = await readContractState({
    network: args.network,
    recipient: args.owner,
    fallbackEpoch,
  });
  const epoch = contract.currentEpoch;
  const epochStartMs = epoch * contract.epochDurationSeconds * 1_000;
  const epochEndMs = epochStartMs + contract.epochDurationSeconds * 1_000;
  const checkpoint = await getCashRewardCheckpoint({
    network: args.network,
    owner: args.owner,
    subaccount: args.subaccount,
    epoch,
    epochStartMs,
    epochEndMs,
    nowMs,
    walletCapAtomic: contract.maxWalletAtomic,
  });
  const eligibility = calculateCashRewardLedgerEntitlement({
    state: checkpoint.state,
    nowMs,
    epochEndMs,
    walletCapAtomic: contract.maxWalletAtomic,
  });
  const calculatedEarnedAtomic =
    checkpoint.earnedAtomic > eligibility.entitlementAtomic
      ? checkpoint.earnedAtomic
      : eligibility.entitlementAtomic;
  const earnedAtomic =
    contract.claimedAtomic > calculatedEarnedAtomic
      ? contract.claimedAtomic
      : calculatedEarnedAtomic;
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
  const active = status.status === "live" && !eligibility.sourceTruncated;
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
  const estimatedCashPerSecond = calculateEstimatedStreamRate(
    eligibility.currentCapitalBasisUsd,
    earnedAtomic,
    contract.maxWalletAtomic,
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    epoch,
    epochStartsAt: new Date(epochStartMs).toISOString(),
    epochEndsAt: new Date(epochEndMs).toISOString(),
    recipient: args.owner,
    verified: {
      fills: eligibility.fills,
      activeDays: eligibility.activeDays,
      feeUsd: eligibility.feeUsd,
      actualVolumeUsd: eligibility.actualVolumeUsd,
      capitalDollarHours: eligibility.capitalDollarHours,
      truncated: eligibility.truncated,
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
      remainingWalletCapCash: atomicToCash(
        earnedAtomic >= contract.maxWalletAtomic ? 0n : contract.maxWalletAtomic - earnedAtomic,
      ),
    },
    config: {
      enabled: active,
      disabledReason: eligibility.sourceTruncated
        ? "Verified Decibel trade history is still catching up; voucher issuance is paused."
        : status.reason,
      network: args.network,
      rewardRateCashPerUsd: FEE_REWARD_CASH_PER_USD,
      capitalHourRewardCash: CAPITAL_HOUR_REWARD_CASH,
      activeDayRewardCash: ACTIVE_DAY_REWARD_CASH,
      formulaVersion: rewardConfig.formulaVersion,
      formulaEffectiveEpoch: rewardConfig.formulaEffectiveEpoch,
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
  currentCapitalBasisUsd: number,
  earnedAtomic: bigint,
  walletCapAtomic: bigint,
): number {
  if (earnedAtomic >= walletCapAtomic) return 0;
  if (!Number.isFinite(currentCapitalBasisUsd) || currentCapitalBasisUsd <= 0) return 0;
  return (currentCapitalBasisUsd * CAPITAL_HOUR_REWARD_CASH) / 3_600;
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
