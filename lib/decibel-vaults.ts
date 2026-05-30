import { AccountAddress, MoveString, createObjectAddress } from "@aptos-labs/ts-sdk";

import {
  getActiveNetwork,
  getDecibelCollateralMetadata,
  getDecibelPackage,
  USDC_DECIMALS,
  type DecibelNetwork,
} from "@/lib/decibel";
import { BOT_OPERATOR } from "@/lib/decibel-client";

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
  const network = args.network ?? getActiveNetwork();
  const packageAddress = getDecibelPackage(network);
  const contributionAsset = stringOrDefault(
    args.contributionAsset,
    getDecibelCollateralMetadata(network)
  );
  const subaccount = resolveSubaccount(args.subaccount, args.owner, network);
  const amountRaw = parseHumanOrRawAmount({
    human: args.initialFunding ?? args.amount ?? "0",
    raw: args.initialFundingRaw ?? args.amountRaw,
    fieldName: "initialFunding",
    allowZero: true,
  });

  const vaultName = requireNonEmptyString(args.vaultName ?? args.name, "vaultName");
  const vaultShareSymbol = requireNonEmptyString(
    args.vaultShareSymbol ?? args.shareSymbol,
    "vaultShareSymbol"
  );
  const vaultDescription = stringOrDefault(
    args.vaultDescription ?? args.description,
    ""
  );
  const vaultSocialLinks = parseStringArray(
    args.vaultSocialLinks ?? args.socialLinks,
    "vaultSocialLinks"
  );
  const vaultShareIconUri = stringOrDefault(
    args.vaultShareIconUri ?? args.shareIconUri,
    ""
  );
  const vaultShareProjectUri = stringOrDefault(
    args.vaultShareProjectUri ?? args.shareProjectUri,
    ""
  );
  const feeBps = parseNonNegativeInteger(args.feeBps ?? 0, "feeBps");
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
  const network = args.network ?? getActiveNetwork();
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
  const network = args.network ?? getActiveNetwork();
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
  const network = args.network ?? getActiveNetwork();
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
  const network = args.network ?? getActiveNetwork();
  const packageAddress = getDecibelPackage(network);
  const vaultAddress = requireAddress(args.vaultAddress ?? args.vault, "vaultAddress");
  const delegate = requireAddress(
    args.delegate ?? args.accountToDelegateTo ?? BOT_OPERATOR,
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
  const address = requireNonEmptyString(value, fieldName);
  try {
    AccountAddress.fromString(address);
  } catch {
    throw new Error(`${fieldName} must be a valid Aptos address`);
  }
  return address;
}

function requireNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function stringOrDefault(value: unknown, fallback: string) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new Error("expected string value");
  return value.trim();
}

function parseStringArray(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== "string") {
        throw new Error(`${fieldName}[${index}] must be a string`);
      }
      return item.trim();
    });
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  throw new Error(`${fieldName} must be an array of strings`);
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
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return assertU64(BigInt(text), fieldName).toString();
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
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error(`${fieldName} must be a raw integer`);
  const amount = assertU64(BigInt(text), fieldName);
  if (!allowZero && amount <= 0n) throw new Error(`${fieldName} must be positive`);
  return amount.toString();
}

function parseHumanFixed6(value: unknown, fieldName: string, allowZero: boolean) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${fieldName} must be a number`);
  }
  const text = String(value).trim();
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
