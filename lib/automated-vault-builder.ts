import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import {
  DECIBEL_BUILDER_CHAIN_UNITS_PER_BPS,
  getAptosFullnodeApiKey,
  normalizeAptosAddress,
  type DecibelNetwork,
} from "@/lib/decibel";

/**
 * The Decibel package the sealed-vault Move package is compiled against.
 *
 * Testnet deliberately differs from the app's older general-trading package. Looking up a
 * Decibel vault through that older package returns `resource_not_found`, which would make every
 * paid legacy-vault preflight fail before it reached the approval check.
 */
export const AUTOMATED_VAULT_DECIBEL_PACKAGE_BY_NETWORK: Record<DecibelNetwork, string> = {
  testnet: "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f",
  mainnet: "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06",
};

export type AutomatedVaultModule = "sealed_vault" | "portfolio_vault";

type StrategyVaultResource = {
  builder_addr?: unknown;
  builder_fee_bps?: unknown;
  decibel_vault_addr?: unknown;
};

type DecibelVaultResource = {
  portfolio?: {
    dex_primary_subaccount?: unknown;
  };
};

export type AutomatedVaultBuilderPreflight = {
  builderAddress: string;
  builderFeeBps: number;
  decibelVaultAddress: string;
  decibelSubaccount: string | null;
  approvedChainUnits: number | null;
  requiredChainUnits: number;
};

/** A permanent compatibility failure, as opposed to a fullnode read that may be retried. */
export class AutomatedVaultBuilderCompatibilityError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "AutomatedVaultBuilderCompatibilityError";
  }
}

/**
 * The app's authenticated Aptos client, shared by scheduled ticks and deployment probes.
 * Mainnet's hosted node expects `API_KEY`; testnet expects a bearer header.
 */
export function createAuthenticatedAptosForNetwork(network: DecibelNetwork): Aptos {
  const apiKey = getAptosFullnodeApiKey(network);
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

function parseSafeU64(value: unknown, label: string): number {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!/^\d+$/.test(raw)) {
    throw new AutomatedVaultBuilderCompatibilityError(`${label} is not an unsigned integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AutomatedVaultBuilderCompatibilityError(`${label} is outside JavaScript's safe range`);
  }
  return parsed;
}

function readMoveOptionU64(value: unknown): number | null {
  const vec = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? (value as { vec?: unknown }).vec
      : null;
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return parseSafeU64(vec[0], "approved builder fee");
}

function strategyResourceName(moduleName: AutomatedVaultModule): string {
  return moduleName === "sealed_vault" ? "SealedVault" : "PortfolioVault";
}

/**
 * Refuse a paid automated order unless Decibel has approved the fee for the identity that
 * actually submits it: the Decibel vault's primary trading subaccount.
 *
 * Direct cash.trading orders are different. Their user-owned subaccount can approve the app's
 * normal builder fee and they do not pass through this check. New automated vault packages
 * freeze `builder_fee_bps` at zero, so they return after the first resource read. This exact
 * approval lookup exists for older packages that may still contain a positive fee.
 */
export async function assertAutomatedVaultBuilderCompatible(args: {
  aptos: Aptos;
  network: DecibelNetwork;
  packageAddress: string;
  strategyVaultAddress: string;
  moduleName: AutomatedVaultModule;
  expectedDecibelSubaccount?: string;
  /** Exact dependency used by deploy probes; normal ticks use the network map above. */
  decibelPackageAddress?: string;
}): Promise<AutomatedVaultBuilderPreflight> {
  const packageAddress = normalizeAptosAddress(args.packageAddress, "strategy package");
  const strategyVaultAddress = normalizeAptosAddress(
    args.strategyVaultAddress,
    "strategy vault",
  );
  const resource = await args.aptos.getAccountResource<StrategyVaultResource>({
    accountAddress: strategyVaultAddress,
    resourceType: `${packageAddress}::${args.moduleName}::${strategyResourceName(args.moduleName)}`,
  });

  const builderAddress = normalizeAptosAddress(resource.builder_addr, "vault builder address");
  const builderFeeBps = parseSafeU64(resource.builder_fee_bps, "vault builder fee");
  const decibelVaultAddress = normalizeAptosAddress(
    resource.decibel_vault_addr,
    "Decibel vault address",
  );
  const requiredChainUnits =
    builderFeeBps * DECIBEL_BUILDER_CHAIN_UNITS_PER_BPS;

  if (builderFeeBps === 0) {
    return {
      builderAddress,
      builderFeeBps,
      decibelVaultAddress,
      decibelSubaccount: null,
      approvedChainUnits: null,
      requiredChainUnits,
    };
  }

  const decibelPackage = normalizeAptosAddress(
    args.decibelPackageAddress ?? AUTOMATED_VAULT_DECIBEL_PACKAGE_BY_NETWORK[args.network],
    "automated-vault Decibel package",
  );
  const vault = await args.aptos.getAccountResource<DecibelVaultResource>({
    accountAddress: decibelVaultAddress,
    resourceType: `${decibelPackage}::vault::Vault`,
  });
  const decibelSubaccount = normalizeAptosAddress(
    vault.portfolio?.dex_primary_subaccount,
    "Decibel vault primary subaccount",
  );

  if (args.expectedDecibelSubaccount) {
    const expected = normalizeAptosAddress(
      args.expectedDecibelSubaccount,
      "expected Decibel subaccount",
    );
    if (expected !== decibelSubaccount) {
      throw new AutomatedVaultBuilderCompatibilityError(
        `registry subaccount ${expected} does not match the Decibel vault's actual primary `
          + `subaccount ${decibelSubaccount}; refusing to sign an order whose fills would be `
          + "attributed to the wrong account",
      );
    }
  }

  const approval = (await args.aptos.view({
    payload: {
      function: `${decibelPackage}::builder_code_registry::get_approved_max_fee`,
      functionArguments: [decibelSubaccount, builderAddress],
    },
  })) as unknown[];
  const approvedChainUnits = readMoveOptionU64(approval[0]);

  if (approvedChainUnits === null || approvedChainUnits < requiredChainUnits) {
    const approved = approvedChainUnits === null
      ? "no builder approval"
      : `${approvedChainUnits} chain units`;
    throw new AutomatedVaultBuilderCompatibilityError(
      `legacy automated vault charges ${builderFeeBps} bp, but its actual Decibel trading `
        + `subaccount ${decibelSubaccount} has ${approved} for builder ${builderAddress}; `
        + `it needs at least ${requiredChainUnits}. Approval on the strategy object or on a `
        + "direct user's account does not cover delegated vault orders. Redeploy with the "
        + "automated builder fee set to zero, or wait for a Decibel vault-admin approval API.",
    );
  }

  return {
    builderAddress,
    builderFeeBps,
    decibelVaultAddress,
    decibelSubaccount,
    approvedChainUnits,
    requiredChainUnits,
  };
}
