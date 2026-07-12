import { AccountAddress, MoveString, createObjectAddress } from "@aptos-labs/ts-sdk";

import {
  getActiveNetwork,
  getDecibelCollateralMetadata,
  getDecibelPackage,
  normalizeAptosAddress,
  USDC_DECIMALS,
  type DecibelNetwork,
} from "@/lib/decibel";

export type DecibelVaultPayloadKind =
  | "create"
  | "activate"
  | "deposit"
  | "withdraw"
  | "delegate";

export type DecibelVaultEntryPayload = {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
};

export interface DecibelVaultPayloadResult {
  payload: DecibelVaultEntryPayload;
  network: DecibelNetwork;
  packageAddress: string;
  kind: DecibelVaultPayloadKind;
  decimals?: number;
  amountRaw?: string;
  sharesRaw?: string;
  contributionAsset?: string;
  delegate?: string;
}

export interface CreateDecibelVaultArgs {
  owner?: unknown;
  subaccount?: unknown;
  contributionAsset?: unknown;
  vaultName?: unknown;
  name?: unknown;
  vaultDescription?: unknown;
  description?: unknown;
  vaultSocialLinks?: unknown;
  socialLinks?: unknown;
  vaultShareSymbol?: unknown;
  shareSymbol?: unknown;
  vaultShareIconUri?: unknown;
  shareIconUri?: unknown;
  vaultShareProjectUri?: unknown;
  shareProjectUri?: unknown;
  feeBps?: unknown;
  feeIntervalS?: unknown;
  contributionLockupDurationS?: unknown;
  amount?: unknown;
  initialFunding?: unknown;
  amountRaw?: unknown;
  initialFundingRaw?: unknown;
  acceptsContributions?: unknown;
  delegateToCreator?: unknown;
  network?: DecibelNetwork;
}

export interface VaultAddressArgs {
  vaultAddress?: unknown;
  vault?: unknown;
  network?: DecibelNetwork;
}

export interface VaultSubaccountAmountArgs extends VaultAddressArgs {
  owner?: unknown;
  subaccount?: unknown;
  amount?: unknown;
  amountUsdc?: unknown;
  amountRaw?: unknown;
}

export interface WithdrawDecibelVaultArgs extends VaultAddressArgs {
  owner?: unknown;
  subaccount?: unknown;
  shares?: unknown;
  shareAmount?: unknown;
  sharesRaw?: unknown;
}

export interface DelegateDecibelVaultArgs extends VaultAddressArgs {
  delegate?: unknown;
  accountToDelegateTo?: unknown;
  expirationTimestampSecs?: unknown;
}

const MAX_U64 = 18_446_744_073_709_551_615n;

export function buildCreateDecibelVaultPayload(
  args: CreateDecibelVaultArgs
): DecibelVaultPayloadResult {
  const network = resolveVaultNetwork(args.network);
  const packageAddress = getDecibelPackage(network);
  const contributionAsset = args.contributionAsset === undefined
    ? getDecibelCollateralMetadata(network)
    : requireAddress(args.contributionAsset, "contributionAsset");
  const subaccount = resolveSubaccount(args.subaccount, args.owner, network);
  const amountRaw = parseHumanOrRawAmount({
    human: args.initialFunding ?? args.amount ?? "0",
    raw: args.initialFundingRaw ?? args.amountRaw,
    fieldName: "initialFunding",
    allowZero: true,
  });

  const vaultName = requireBoundedString(
    args.vaultName ?? args.name,
    "vaultName",
    64,
  );
  const vaultShareSymbol = requireBoundedString(
    args.vaultShareSymbol ?? args.shareSymbol,
    "vaultShareSymbol",
    16,
  );
  const vaultDescription = boundedStringOrDefault(
    args.vaultDescription ?? args.description,
    "",
    "vaultDescription",
    2_000,
  );
  const vaultSocialLinks = parseStringArray(
    args.vaultSocialLinks ?? args.socialLinks,
    "vaultSocialLinks"
  );
  const vaultShareIconUri = boundedStringOrDefault(
    args.vaultShareIconUri ?? args.shareIconUri,
    "",
    "vaultShareIconUri",
    2_048,
  );
  const vaultShareProjectUri = boundedStringOrDefault(
    args.vaultShareProjectUri ?? args.shareProjectUri,
    "",
    "vaultShareProjectUri",
    2_048,
  );
  const feeBps = parseBasisPoints(args.feeBps ?? 0, "feeBps");
  const feeIntervalS = parseNonNegativeInteger(
    args.feeIntervalS ?? 0,
    "feeIntervalS"
  );
  const contributionLockupDurationS = parseNonNegativeInteger(
    args.contributionLockupDurationS ?? 0,
    "contributionLockupDurationS"
  );
  const acceptsContributions = parseBoolean(
    args.acceptsContributions ?? false,
    "acceptsContributions"
  );
  const delegateToCreator = parseBoolean(
    args.delegateToCreator ?? false,
    "delegateToCreator"
  );

  return {
    payload: {
      function: `${packageAddress}::vault_api::create_and_fund_vault`,
      typeArguments: [],
      functionArguments: [
        subaccount,
        contributionAsset,
        vaultName,
        vaultDescription,
        vaultSocialLinks,
        vaultShareSymbol,
        vaultShareIconUri,
        vaultShareProjectUri,
        feeBps,
        feeIntervalS,
        contributionLockupDurationS,
        amountRaw,
        acceptsContributions,
        delegateToCreator,
      ],
    },
    network,
    packageAddress,
    kind: "create",
    decimals: USDC_DECIMALS,
    amountRaw,
    contributionAsset,
  };
}

export function buildActivateDecibelVaultPayload(
  args: VaultAddressArgs
): DecibelVaultPayloadResult {
  const network = resolveVaultNetwork(args.network);
  const packageAddress = getDecibelPackage(network);
  const vaultAddress = requireAddress(args.vaultAddress ?? args.vault, "vaultAddress");

  return {
    payload: {
      function: `${packageAddress}::vault_api::activate_vault`,
      typeArguments: [],
      functionArguments: [vaultAddress],
    },
    network,
    packageAddress,
    kind: "activate",
  };
}

export function buildDepositDecibelVaultPayload(
  args: VaultSubaccountAmountArgs
): DecibelVaultPayloadResult {
  const network = resolveVaultNetwork(args.network);
  const packageAddress = getDecibelPackage(network);
  const contributionAsset = getDecibelCollateralMetadata(network);
  const subaccount = resolveSubaccount(args.subaccount, args.owner, network);
  const vaultAddress = requireAddress(args.vaultAddress ?? args.vault, "vaultAddress");
  const amountRaw = parseHumanOrRawAmount({
    human: args.amountUsdc ?? args.amount,
    raw: args.amountRaw,
    fieldName: "amount",
  });

  return {
    payload: {
      function: `${packageAddress}::dex_accounts_entry::contribute_to_vault`,
      typeArguments: [],
      functionArguments: [subaccount, vaultAddress, contributionAsset, amountRaw],
    },
    network,
    packageAddress,
    kind: "deposit",
    decimals: USDC_DECIMALS,
    amountRaw,
    contributionAsset,
  };
}

export function buildWithdrawDecibelVaultPayload(
  args: WithdrawDecibelVaultArgs
): DecibelVaultPayloadResult {
  const network = resolveVaultNetwork(args.network);
  const packageAddress = getDecibelPackage(network);
  const subaccount = resolveSubaccount(args.subaccount, args.owner, network);
  const vaultAddress = requireAddress(args.vaultAddress ?? args.vault, "vaultAddress");
  const sharesRaw = parseHumanOrRawAmount({
    human: args.shareAmount ?? args.shares,
    raw: args.sharesRaw,
    fieldName: "shares",
  });

  return {
    payload: {
      function: `${packageAddress}::dex_accounts_entry::redeem_from_vault`,
      typeArguments: [],
      functionArguments: [subaccount, vaultAddress, sharesRaw],
    },
    network,
    packageAddress,
    kind: "withdraw",
    decimals: USDC_DECIMALS,
    sharesRaw,
  };
}

export function buildDelegateDecibelVaultPayload(
  args: DelegateDecibelVaultArgs
): DecibelVaultPayloadResult {
  const network = resolveVaultNetwork(args.network);
  const packageAddress = getDecibelPackage(network);
  const vaultAddress = requireAddress(args.vaultAddress ?? args.vault, "vaultAddress");
  const delegate = requireAddress(
    args.delegate ?? args.accountToDelegateTo,
    "delegate"
  );
  const expirationTimestampSecs =
    args.expirationTimestampSecs === undefined ||
    args.expirationTimestampSecs === null ||
    args.expirationTimestampSecs === ""
      ? null
      : parseNonNegativeInteger(
          args.expirationTimestampSecs,
          "expirationTimestampSecs"
        );

  return {
    payload: {
      function: `${packageAddress}::vault_admin_api::delegate_dex_actions_to`,
      typeArguments: [],
      functionArguments: [vaultAddress, delegate, expirationTimestampSecs],
    },
    network,
    packageAddress,
    kind: "delegate",
    delegate,
  };
}

function resolveSubaccount(
  subaccount: unknown,
  owner: unknown,
  network: DecibelNetwork
) {
  if (subaccount !== undefined && subaccount !== null && subaccount !== "") {
    return requireAddress(subaccount, "subaccount");
  }
  const ownerAddress = requireAddress(owner, "owner");
  return derivePrimarySubaccountAddress(ownerAddress, network);
}

function resolveVaultNetwork(value: unknown): DecibelNetwork {
  if (value === undefined || value === null) return getActiveNetwork();
  if (value === "testnet" || value === "mainnet") return value;
  throw new Error("network must be testnet or mainnet");
}

function derivePrimarySubaccountAddress(owner: string, network: DecibelNetwork) {
  const packageAddress = AccountAddress.fromString(getDecibelPackage(network));
  const deriver = createObjectAddress(
    packageAddress,
    new TextEncoder().encode("GlobalSubaccountManager")
  );
  const seedBytes = new Uint8Array([
    ...AccountAddress.fromString(owner).toUint8Array(),
    ...new MoveString("primary_subaccount").bcsToBytes(),
  ]);
  return createObjectAddress(
    deriver,
    seedBytes
  ).toString();
}

function requireAddress(value: unknown, fieldName: string) {
  return normalizeAptosAddress(value, fieldName);
}

function requireBoundedString(
  value: unknown,
  fieldName: string,
  maxLength: number,
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function boundedStringOrDefault(
  value: unknown,
  fallback: string,
  fieldName: string,
  maxLength: number,
) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

function parseStringArray(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return [];
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : null;
  if (!items) throw new Error(`${fieldName} must be an array of strings`);
  if (items.length > 8) throw new Error(`${fieldName} must contain at most 8 links`);
  return items
    .map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`${fieldName}[${index}] must be a string`);
      }
      const trimmed = item.trim();
      if (trimmed.length > 2_048) {
        throw new Error(`${fieldName}[${index}] must be at most 2048 characters`);
      }
      return trimmed;
    })
    .filter(Boolean);
}

function parseBoolean(value: unknown, fieldName: string) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${fieldName} must be a boolean`);
}

function parseNonNegativeInteger(value: unknown, fieldName: string) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  const canonical = text.replace(/^0+(?=\d)/, "");
  if (canonical.length > 20) throw new Error(`${fieldName} must fit in u64`);
  return assertU64(BigInt(canonical), fieldName).toString();
}

function parseBasisPoints(value: unknown, fieldName: string) {
  const bps = parseNonNegativeInteger(value, fieldName);
  if (BigInt(bps) > 10_000n) {
    throw new Error(`${fieldName} must be between 0 and 10000`);
  }
  return bps;
}

function parseHumanOrRawAmount({
  human,
  raw,
  fieldName,
  allowZero = false,
}: {
  human: unknown;
  raw?: unknown;
  fieldName: string;
  allowZero?: boolean;
}) {
  if (raw !== undefined && raw !== null && raw !== "") {
    return parseRawU64(raw, `${fieldName}Raw`, allowZero);
  }
  if (human === undefined || human === null || human === "") {
    throw new Error(`${fieldName} is required`);
  }
  return parseHumanFixed6(human, fieldName, allowZero);
}

function parseRawU64(value: unknown, fieldName: string, allowZero: boolean) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`${fieldName} must be a raw integer`);
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(`${fieldName} must be a safe integer`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error(`${fieldName} must be a raw integer`);
  const canonical = text.replace(/^0+(?=\d)/, "");
  if (canonical.length > 20) throw new Error(`${fieldName} must fit in u64`);
  const amount = assertU64(BigInt(canonical), fieldName);
  if (!allowZero && amount <= 0n) throw new Error(`${fieldName} must be positive`);
  return amount.toString();
}

function parseHumanFixed6(value: unknown, fieldName: string, allowZero: boolean) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${fieldName} must be a number`);
  }
  const text = String(value).trim();
  if (text.length > 32) throw new Error(`${fieldName} must fit in u64`);
  if (!/^\d+(\.\d{1,6})?$/.test(text)) {
    throw new Error(`${fieldName} must be a positive decimal with up to 6 decimals`);
  }
  const [whole, fraction = ""] = text.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  assertU64(raw, fieldName);
  if (!allowZero && raw <= 0n) throw new Error(`${fieldName} must be positive`);
  return raw.toString();
}

function assertU64(value: bigint, fieldName: string) {
  if (value < 0n || value > MAX_U64) {
    throw new Error(`${fieldName} must fit in u64`);
  }
  return value;
}
