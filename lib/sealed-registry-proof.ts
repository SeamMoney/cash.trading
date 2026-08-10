import { decodeMoveU8Vector } from "@/lib/launchpad/move-view";
import {
  normalizeAddress,
  type SealedMarket,
} from "@/lib/sealed-vaults";

export type SealedVaultKind = "single" | "portfolio";

export interface SealedRegistrationClaim {
  network: "testnet" | "mainnet";
  packageAddress: string;
  strategyVaultAddr: string;
  creatorAddr: string;
  decibelVaultAddr: string;
  programCommitment: string;
  attestorPubkey: string;
  vaultKind: SealedVaultKind;
  markets: SealedMarket[];
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
}

export interface VerifiedSealedRegistration {
  strategyVaultAddr: string;
  packageAddress: string;
  creatorAddr: string;
  decibelVaultAddr: string;
  programCommitment: string;
  attestorPubkey: string;
  enclaveMeasurement: string | null;
  sealed: true;
}

export class SealedRegistryProofError extends Error {
  constructor(
    message: string,
    readonly status: 422 | 503 = 422,
  ) {
    super(message);
    this.name = "SealedRegistryProofError";
  }
}

type MoveResource = { type?: unknown; data?: unknown };
type FetchLike = typeof fetch;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SealedRegistryProofError(`${field} is missing from the on-chain resource`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, field: string): string {
  if (typeof value === "string") {
    const normalized = normalizeAddress(value);
    if (normalized) return normalized;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrapped = value as Record<string, unknown>;
    for (const key of ["inner", "address", "object", "account_address"]) {
      if (wrapped[key] !== undefined) {
        const normalized = normalizeAddress(wrapped[key]);
        if (normalized) return normalized;
      }
    }
  }
  throw new SealedRegistryProofError(`${field} is not an Aptos address`);
}

function bytesHex(value: unknown, field: string): string {
  try {
    return `0x${Buffer.from(decodeMoveU8Vector(value, field)).toString("hex")}`;
  } catch {
    throw new SealedRegistryProofError(`${field} is not a Move byte vector`);
  }
}

function unsigned(value: unknown, field: string): bigint {
  if (
    (typeof value !== "string" || !/^\d+$/.test(value)) &&
    (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new SealedRegistryProofError(`${field} is not an unsigned integer`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new SealedRegistryProofError(`${field} is not an unsigned integer`);
  }
}

function sameAddress(actual: unknown, expected: string, field: string) {
  const normalizedExpected = address(expected, `claimed ${field}`);
  const normalizedActual = address(actual, `on-chain ${field}`);
  if (normalizedActual !== normalizedExpected) {
    throw new SealedRegistryProofError(`${field} does not match the on-chain vault`);
  }
}

function sameBytes(actual: unknown, expected: string, field: string) {
  if (bytesHex(actual, `on-chain ${field}`) !== expected.toLowerCase()) {
    throw new SealedRegistryProofError(`${field} does not match the on-chain vault`);
  }
}

function sameUnsigned(actual: unknown, expected: string | number, field: string) {
  if (unsigned(actual, `on-chain ${field}`) !== BigInt(expected)) {
    throw new SealedRegistryProofError(`${field} does not match the on-chain vault`);
  }
}

function verifyMarketSpec(
  value: unknown,
  expected: SealedMarket,
  label: string,
) {
  const spec = record(value, label);
  sameAddress(spec.market, expected.addr, `${label} address`);
  sameUnsigned(spec.size_decimals_pow, expected.sizeDecimalsPow, `${label} size decimals`);
  sameUnsigned(spec.lot_size, expected.lotSize, `${label} lot size`);
  sameUnsigned(spec.min_size, expected.minSize, `${label} minimum size`);
  sameUnsigned(spec.ticker_size, expected.tickerSize, `${label} ticker size`);
}

/**
 * Verify the immutable fields the registry and executor depend on against the Move resource.
 * This function is intentionally pure so spoofing regressions can be tested without a node.
 */
export function verifySealedVaultResource(
  claim: SealedRegistrationClaim,
  resource: MoveResource,
): VerifiedSealedRegistration {
  const data = record(resource.data, "sealed vault data");

  sameAddress(data.creator, claim.creatorAddr, "creator");
  sameAddress(data.decibel_vault_addr, claim.decibelVaultAddr, "Decibel vault");
  sameBytes(data.program_commitment, claim.programCommitment, "program commitment");
  sameBytes(data.attestor_pubkey, claim.attestorPubkey, "attestor public key");
  if (data.sealed !== true) {
    throw new SealedRegistryProofError("the on-chain strategy is not sealed");
  }

  sameUnsigned(
    data[claim.vaultKind === "portfolio" ? "max_pct_bps" : "pct_bps"],
    claim.pctBps,
    "order-size limit",
  );
  sameUnsigned(data.max_leverage_x100, claim.maxLeverageX100, "leverage limit");
  sameUnsigned(data.min_bar_interval_s, claim.minBarIntervalS, "bar interval");

  if (claim.vaultKind === "single") {
    if (claim.markets.length !== 1) {
      throw new SealedRegistryProofError("a single-market vault must claim exactly one market");
    }
    verifyMarketSpec(
      {
        market: data.market,
        size_decimals_pow: data.size_decimals_pow,
        lot_size: data.lot_size,
        min_size: data.min_size,
        ticker_size: data.ticker_size,
      },
      claim.markets[0],
      "market",
    );
  } else {
    if (!Array.isArray(data.markets) || data.markets.length !== claim.markets.length) {
      throw new SealedRegistryProofError("market allowlist does not match the on-chain vault");
    }
    data.markets.forEach((market, index) => {
      verifyMarketSpec(market, claim.markets[index], `market ${index + 1}`);
    });
  }

  const enclaveHex = bytesHex(data.enclave_measurement, "on-chain enclave measurement");
  return {
    strategyVaultAddr: address(claim.strategyVaultAddr, "strategy vault"),
    packageAddress: address(claim.packageAddress, "package"),
    creatorAddr: address(data.creator, "on-chain creator"),
    decibelVaultAddr: address(data.decibel_vault_addr, "on-chain Decibel vault"),
    programCommitment: bytesHex(data.program_commitment, "on-chain program commitment"),
    attestorPubkey: bytesHex(data.attestor_pubkey, "on-chain attestor public key"),
    enclaveMeasurement: enclaveHex === "0x" ? null : enclaveHex,
    sealed: true,
  };
}

function fullnodeUrl(network: "testnet" | "mainnet"): string {
  const configured =
    network === "mainnet"
      ? process.env.APTOS_MAINNET_FULLNODE_URL
      : process.env.APTOS_TESTNET_FULLNODE_URL;
  return (configured || `https://api.${network}.aptoslabs.com/v1`).replace(/\/$/, "");
}

/** Read the exact resource type implied by the allowlist, then verify every registry claim. */
export async function proveSealedVaultRegistration(
  claim: SealedRegistrationClaim,
  options?: { fetchImpl?: FetchLike; fullnodeBaseUrl?: string },
): Promise<VerifiedSealedRegistration> {
  const moduleName = claim.vaultKind === "portfolio" ? "portfolio_vault" : "sealed_vault";
  const structName = claim.vaultKind === "portfolio" ? "PortfolioVault" : "SealedVault";
  const resourceType = `${claim.packageAddress}::${moduleName}::${structName}`;
  const base = (options?.fullnodeBaseUrl || fullnodeUrl(claim.network)).replace(/\/$/, "");
  const url = `${base}/accounts/${claim.strategyVaultAddr}/resource/${encodeURIComponent(resourceType)}`;

  let response: Response;
  try {
    response = await (options?.fetchImpl ?? fetch)(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SealedRegistryProofError("Aptos fullnode is unavailable", 503);
  }
  if (response.status === 404) {
    throw new SealedRegistryProofError("sealed strategy resource was not found on-chain");
  }
  if (!response.ok) {
    throw new SealedRegistryProofError(
      `Aptos fullnode rejected the resource lookup (${response.status})`,
      503,
    );
  }

  let resource: MoveResource;
  try {
    resource = (await response.json()) as MoveResource;
  } catch {
    throw new SealedRegistryProofError("Aptos fullnode returned malformed resource data", 503);
  }
  return verifySealedVaultResource(claim, resource);
}
