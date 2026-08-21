import { normalizeDecibelSpotAddress } from "@/lib/decibel-spot";

export const DECIBEL_SPOT_DEPLOYMENT_ACCOUNT =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";

const APTOS_MAINNET_FULLNODE_BASE = "https://api.mainnet.aptoslabs.com/v1";
const PACKAGE_REGISTRY_TYPE = "0x1::code::PackageRegistry";
const DEPLOYMENT_CACHE_MS = 3_000;
const DEPLOYMENT_MAX_AGE_MS = 30_000;
const DEPLOYMENT_TIMEOUT_MS = 4_500;
const MAX_REGISTRY_BYTES = 1_000_000;

interface ReviewedPackage {
  digest: string;
  modules: readonly string[];
  name: string;
  upgradeNumber: string;
  upgradePolicy: string;
}

/**
 * Every upgradeable package in the direct-wallet Decibel spot execution path.
 * Any Decibel upgrade must be reviewed and these pins intentionally updated
 * before cash.trading will quote or submit another spot order.
 */
export const REVIEWED_DECIBEL_SPOT_PACKAGES = [
  {
    name: "aptos_market",
    upgradeNumber: "32",
    upgradePolicy: "1",
    digest: "9CAAAC918B853E8FC47E7D9BC22A2C8902D27ADBF813BB623DCCC3E6A11EE648",
    modules: [
      "bulk_order_book",
      "bulk_order_utils",
      "dead_mans_switch_tracker",
      "market_bulk_order",
      "market_clearinghouse_order_info",
      "market_types",
      "order_book",
      "order_book_utils",
      "order_id_generation",
      "order_operations",
      "order_placement",
      "pending_order_book_index",
      "pre_cancellation_tracker",
      "price_time_index",
      "single_order_book",
    ],
  },
  {
    name: "decibel_accounts",
    upgradeNumber: "29",
    upgradePolicy: "1",
    digest: "14F71F1F5AAB878412EF7610964F75939AB5AE44004A7BA4FE4487BFB2B8151E",
    modules: [
      "dex_accounts",
      "dex_accounts_config",
      "dex_accounts_entry",
      "dex_accounts_spot_admin",
      "dex_accounts_spot_entry",
      "dex_accounts_spot_extension",
      "dex_accounts_vault_extension",
      "spot_deposit_routing",
    ],
  },
  {
    name: "decibel_spot_dex",
    upgradeNumber: "3",
    upgradePolicy: "1",
    digest: "402795D2525B502A27491FBC276C8B6C95BA96FF654A1561DC8108C165476FF2",
    modules: [
      "spot_access_control",
      "spot_account_info",
      "spot_admin_apis",
      "spot_builder_code_registry",
      "spot_clearinghouse",
      "spot_engine",
      "spot_engine_types",
      "spot_fees_config",
      "spot_fees_manager",
      "spot_fees_treasury",
      "spot_global_config",
      "spot_market",
      "spot_market_config",
      "spot_market_escrow",
      "spot_order_escrow",
      "spot_order_public_api",
      "spot_order_read_apis",
      "spot_order_restricted_api",
      "spot_pending_cbs_queue",
      "spot_withdrawal_callback",
      "spot_work_unit_utils",
      "trading_volume_activation",
    ],
  },
  {
    name: "decibel_trade_tracking",
    upgradeNumber: "5",
    upgradePolicy: "1",
    digest: "826045EFC1580F84A1A30EE9B3B03160341F1F21346E0290B89F3E3D04C7A999",
    modules: [
      "decibel_trading_time",
      "trading_volume_admin_api",
      "trading_volume_read_api",
      "trading_volume_restricted_api",
      "trading_volume_tracker",
      "unified_fees_config",
    ],
  },
] as const satisfies readonly ReviewedPackage[];

export interface DecibelSpotDeploymentAttestation {
  accountAddress: string;
  expiresAtMs: number;
  ledgerTimestampMs: number;
  ledgerVersion: string;
  packageSignature: string;
  verifiedAtMs: number;
}

interface PackageMetadata {
  modules?: Array<{ name?: unknown }>;
  name?: unknown;
  source_digest?: unknown;
  upgrade_number?: unknown;
  upgrade_policy?: { policy?: unknown };
}

let deploymentCache: DecibelSpotDeploymentAttestation | null = null;
let deploymentInFlight: Promise<DecibelSpotDeploymentAttestation> | null = null;

function exactUnsigned(value: unknown, fieldName: string) {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
  if (!/^\d+$/.test(text)) throw new Error(`${fieldName} is malformed`);
  return text;
}

function exactDigest(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !/^[0-9A-Fa-f]{64}$/.test(value)) {
    throw new Error(`${fieldName} is malformed`);
  }
  return value.toUpperCase();
}

function packageModules(value: unknown, packageName: string) {
  if (!Array.isArray(value)) throw new Error(`${packageName} module metadata is missing`);
  const names = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${packageName} module metadata is malformed`);
    }
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || !/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new Error(`${packageName} module name is malformed`);
    }
    return name;
  }).sort();
  if (new Set(names).size !== names.length) {
    throw new Error(`${packageName} contains duplicate module metadata`);
  }
  return names;
}

export function validateDecibelSpotPackageRegistry(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Decibel package registry is malformed");
  }
  const packages = (value as { data?: { packages?: unknown } }).data?.packages;
  if (!Array.isArray(packages)) throw new Error("Decibel package registry is missing packages");
  const byName = new Map<string, PackageMetadata>();
  for (const raw of packages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const metadata = raw as PackageMetadata;
    if (typeof metadata.name !== "string") continue;
    if (byName.has(metadata.name)) throw new Error("Decibel package registry contains duplicate package names");
    byName.set(metadata.name, metadata);
  }

  for (const reviewed of REVIEWED_DECIBEL_SPOT_PACKAGES) {
    const actual = byName.get(reviewed.name);
    if (!actual) throw new Error(`Reviewed Decibel package ${reviewed.name} is missing`);
    const actualModules = packageModules(actual.modules, reviewed.name);
    const expectedModules = [...reviewed.modules].sort();
    if (
      exactUnsigned(actual.upgrade_number, `${reviewed.name} upgrade number`) !== reviewed.upgradeNumber
      || exactUnsigned(actual.upgrade_policy?.policy, `${reviewed.name} upgrade policy`) !== reviewed.upgradePolicy
      || exactDigest(actual.source_digest, `${reviewed.name} source digest`) !== reviewed.digest
      || JSON.stringify(actualModules) !== JSON.stringify(expectedModules)
    ) {
      throw new Error(`Reviewed Decibel package ${reviewed.name} changed`);
    }
  }

  return REVIEWED_DECIBEL_SPOT_PACKAGES
    .map((entry) => `${entry.name}:${entry.upgradeNumber}:${entry.digest}`)
    .join("|");
}

function ledgerProof(headers: Headers, nowMs: number) {
  if (headers.get("x-aptos-chain-id") !== "1") {
    throw new Error("Decibel package registry is not from Aptos mainnet");
  }
  const ledgerVersion = headers.get("x-aptos-ledger-version") ?? "";
  const ledgerTimestampUsec = headers.get("x-aptos-ledger-timestampusec") ?? "";
  if (!/^\d+$/.test(ledgerVersion) || !/^\d+$/.test(ledgerTimestampUsec)) {
    throw new Error("Decibel package registry ledger proof is malformed");
  }
  const ledgerTimestampMs = Number(BigInt(ledgerTimestampUsec) / 1_000n);
  if (
    !Number.isSafeInteger(ledgerTimestampMs)
    || ledgerTimestampMs > nowMs + 5_000
    || nowMs - ledgerTimestampMs > DEPLOYMENT_MAX_AGE_MS
  ) {
    throw new Error("Decibel package registry ledger proof is stale");
  }
  return { ledgerTimestampMs, ledgerVersion };
}

async function fetchDeploymentAttestation(apiKey?: string) {
  const response = await fetch(
    `${APTOS_MAINNET_FULLNODE_BASE}/accounts/${DECIBEL_SPOT_DEPLOYMENT_ACCOUNT}/resource/${encodeURIComponent(PACKAGE_REGISTRY_TYPE)}`,
    {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(DEPLOYMENT_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "X-Aptos-Client": "cash-trading/decibel-spot-attestation",
      },
    },
  );
  if (!response.ok) throw new Error(`Decibel package registry returned ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new Error("Decibel package registry did not return JSON");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REGISTRY_BYTES) {
    throw new Error("Decibel package registry exceeded the size bound");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Decibel package registry returned malformed JSON");
  }
  const nowMs = Date.now();
  const proof = ledgerProof(response.headers, nowMs);
  const packageSignature = validateDecibelSpotPackageRegistry(value);
  return {
    accountAddress: normalizeDecibelSpotAddress(DECIBEL_SPOT_DEPLOYMENT_ACCOUNT),
    expiresAtMs: nowMs + DEPLOYMENT_CACHE_MS,
    ledgerTimestampMs: proof.ledgerTimestampMs,
    ledgerVersion: proof.ledgerVersion,
    packageSignature,
    verifiedAtMs: nowMs,
  } satisfies DecibelSpotDeploymentAttestation;
}

export async function verifyDecibelSpotDeployment(apiKey?: string) {
  const nowMs = Date.now();
  if (deploymentCache && deploymentCache.expiresAtMs > nowMs) return deploymentCache;
  if (deploymentInFlight) return deploymentInFlight;
  deploymentInFlight = fetchDeploymentAttestation(apiKey)
    .then((attestation) => {
      deploymentCache = attestation;
      return attestation;
    })
    .finally(() => {
      deploymentInFlight = null;
    });
  return deploymentInFlight;
}

export function clearDecibelSpotDeploymentCacheForTests() {
  deploymentCache = null;
  deploymentInFlight = null;
}
