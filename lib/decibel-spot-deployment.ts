import { createHash } from "node:crypto";

import { normalizeDecibelSpotAddress } from "@/lib/decibel-spot";

export const DECIBEL_SPOT_DEPLOYMENT_ACCOUNT =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";

export const DECIBEL_SPOT_CHAIN_ID = "1";

const APTOS_MAINNET_FULLNODE_BASE = "https://api.mainnet.aptoslabs.com/v1";
const PACKAGE_REGISTRY_TYPE = "0x1::code::PackageRegistry";
const DEPLOYMENT_CACHE_MS = 3_000;
const DEPLOYMENT_MAX_AGE_MS = 30_000;
const DEPLOYMENT_TIMEOUT_MS = 4_500;
const MAX_REGISTRY_BYTES = 1_000_000;
const MAX_MODULE_BYTES = 400_000;
/**
 * Module bytecode cannot change without a package publish, and a publish always
 * bumps that package's upgrade number and source digest. So the ABI re-read is
 * driven by the observed package signature; the periodic re-read is only a
 * backstop against a stale in-process cache.
 */
const ABI_REVALIDATE_MS = 600_000;
const FINGERPRINT_VERSION = "decibel-spot-abi/1";

/**
 * The Move visibility values an Aptos module ABI can report.
 */
const MOVE_VISIBILITIES = new Set(["private", "public", "friend"]);

export interface ReviewedDecibelSpotPackage {
  /** Package name in `0x1::code::PackageRegistry`. */
  name: string;
  /**
   * Hard gate. `1` is `compatible`. A package that drops to an arbitrary
   * upgrade policy can replace our execution path without a compatible ABI, so
   * a policy change is never treated as drift.
   */
  upgradePolicy: string;
  /**
   * Hard gate. The modules the spot path actually binds to. These must exist in
   * this package, and their pinned ABI facts are part of the fingerprint.
   */
  boundModules: readonly string[];
  /**
   * Metadata only — never a gate. This is what a human last reviewed, so drift
   * can be reported with both the reviewed and the observed values.
   */
  lastReviewed: {
    reviewedOn: string;
    upgradeNumber: string;
    digest: string;
    modules: readonly string[];
  };
}

/**
 * Every upgradeable package in the direct-wallet Decibel spot execution path.
 *
 * Decibel upgrades these packages on their own cadence — four of them moved
 * inside 48 hours on 2026-08-19/20 — and a routine upstream upgrade must not
 * take our venue offline. What protects the user is the ABI we submit against,
 * not the upgrade counter, so the counter and the source digest are recorded as
 * "last reviewed" metadata and reported as drift, while presence, upgrade
 * policy, the bound modules, and the ABI fingerprint stay hard fail-closed.
 */
export const REVIEWED_DECIBEL_SPOT_PACKAGES = [
  {
    name: "aptos_market",
    upgradePolicy: "1",
    // The matching engine underneath the book. We bind to no module in it
    // directly, so only its presence and upgrade policy are gated.
    boundModules: [],
    lastReviewed: {
      reviewedOn: "2026-08-21",
      upgradeNumber: "32",
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
  },
  {
    name: "decibel_accounts",
    upgradePolicy: "1",
    boundModules: ["dex_accounts_spot_entry"],
    lastReviewed: {
      reviewedOn: "2026-08-21",
      upgradeNumber: "29",
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
  },
  {
    name: "decibel_spot_dex",
    upgradePolicy: "1",
    boundModules: ["spot_market", "spot_market_config"],
    lastReviewed: {
      reviewedOn: "2026-08-21",
      upgradeNumber: "3",
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
  },
  {
    name: "decibel_trade_tracking",
    upgradePolicy: "1",
    boundModules: ["unified_fees_config"],
    lastReviewed: {
      reviewedOn: "2026-08-21",
      upgradeNumber: "5",
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
  },
] as const satisfies readonly ReviewedDecibelSpotPackage[];

export interface ReviewedDecibelSpotAbiFunction {
  package: string;
  module: string;
  name: string;
  visibility: string;
  isEntry: boolean;
  isView: boolean;
  genericTypeParams: number;
  /** `{deployment}` expands to the normalized Decibel deployment address. */
  params: readonly string[];
  returns: readonly string[];
}

/**
 * The exact ABI surface a cash.trading spot quote and submission depends on.
 *
 * - `place_spot_order` is the entry function the user's wallet signs. Argument
 *   order, argument types, generic arity and entry-ness are the difference
 *   between a correct IOC order and a silently mis-encoded one.
 * - the `spot_market_config` getters are where the reviewed lot size, tick size
 *   and minimum size in `lib/decibel-spot.ts` come from.
 * - `view_spot_tier_taker_fees` is read live on every quote.
 *
 * Read from mainnet on 2026-08-21 at upgrade 32/29/3/5.
 */
export const REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS = [
  {
    package: "decibel_accounts",
    module: "dex_accounts_spot_entry",
    name: "place_spot_order",
    visibility: "private",
    isEntry: true,
    isView: false,
    genericTypeParams: 0,
    params: [
      "&signer",
      "0x1::object::Object<{deployment}::spot_market::SpotMarket>",
      "u64",
      "u64",
      "bool",
      "u8",
      "0x1::option::Option<address>",
      "0x1::option::Option<u64>",
    ],
    returns: [],
  },
  {
    package: "decibel_spot_dex",
    module: "spot_market_config",
    name: "get_lot_size",
    visibility: "friend",
    isEntry: false,
    isView: true,
    genericTypeParams: 0,
    params: ["address"],
    returns: ["u64"],
  },
  {
    package: "decibel_spot_dex",
    module: "spot_market_config",
    name: "get_tick_size",
    visibility: "friend",
    isEntry: false,
    isView: true,
    genericTypeParams: 0,
    params: ["address"],
    returns: ["u64"],
  },
  {
    package: "decibel_spot_dex",
    module: "spot_market_config",
    name: "get_min_size",
    visibility: "friend",
    isEntry: false,
    isView: true,
    genericTypeParams: 0,
    params: ["address"],
    returns: ["u64"],
  },
  {
    package: "decibel_trade_tracking",
    module: "unified_fees_config",
    name: "view_spot_tier_taker_fees",
    visibility: "friend",
    isEntry: false,
    isView: true,
    genericTypeParams: 0,
    params: [],
    returns: ["vector<u64>"],
  },
] as const satisfies readonly ReviewedDecibelSpotAbiFunction[];

/** Module ABIs that must be read from chain to build the fingerprint. */
export const REQUIRED_DECIBEL_SPOT_ABI_MODULES = [
  ...new Set(REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS.map((entry) => entry.module)),
].sort();

export interface ObservedDecibelSpotAbiFunction {
  id: string;
  visibility: string;
  isEntry: boolean;
  isView: boolean;
  genericTypeParams: number;
  params: readonly string[];
  returns: readonly string[];
}

export interface ObservedDecibelSpotPackage {
  name: string;
  upgradeNumber: string;
  upgradePolicy: string;
  digest: string;
  modules: readonly string[];
}

export interface DecibelSpotUpgradeDrift {
  package: string;
  reviewedOn: string;
  reviewedUpgradeNumber: string;
  observedUpgradeNumber: string;
  reviewedDigest: string;
  observedDigest: string;
  addedModules: readonly string[];
  removedModules: readonly string[];
}

export interface DecibelSpotDeploymentEvaluation {
  abiFingerprint: string;
  drift: readonly DecibelSpotUpgradeDrift[];
  observedPackages: readonly ObservedDecibelSpotPackage[];
  packageSignature: string;
  upgradeDrift: boolean;
}

export interface DecibelSpotDeploymentAttestation extends DecibelSpotDeploymentEvaluation {
  accountAddress: string;
  expiresAtMs: number;
  ledgerTimestampMs: number;
  ledgerVersion: string;
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
let abiCache: { fingerprint: string; signature: string; verifiedAtMs: number } | null = null;
let warnedDriftSignature: string | null = null;

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

function asRecord(value: unknown, fieldName: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} is malformed`);
  }
  return value as Record<string, unknown>;
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

/**
 * Normalizes Aptos addresses embedded in a Move type string so a short-form and
 * a long-form rendering of the same type produce the same fingerprint.
 */
export function canonicalizeMoveType(value: unknown, fieldName: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new Error(`${fieldName} is malformed`);
  }
  return value.replace(
    /0x[0-9a-fA-F]{1,64}/g,
    (address) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`,
  );
}

function expectedFunctionSignature(
  entry: ReviewedDecibelSpotAbiFunction,
  deploymentAccount: string,
): ObservedDecibelSpotAbiFunction {
  const expand = (type: string, fieldName: string) =>
    canonicalizeMoveType(type.replaceAll("{deployment}", deploymentAccount), fieldName);
  return {
    id: `${entry.module}::${entry.name}`,
    visibility: entry.visibility,
    isEntry: entry.isEntry,
    isView: entry.isView,
    genericTypeParams: entry.genericTypeParams,
    params: entry.params.map((type, index) => expand(type, `${entry.name} param ${index}`)),
    returns: entry.returns.map((type, index) => expand(type, `${entry.name} return ${index}`)),
  };
}

function sameSignature(
  actual: ObservedDecibelSpotAbiFunction,
  expected: ObservedDecibelSpotAbiFunction,
) {
  return actual.visibility === expected.visibility
    && actual.isEntry === expected.isEntry
    && actual.isView === expected.isView
    && actual.genericTypeParams === expected.genericTypeParams
    && JSON.stringify(actual.params) === JSON.stringify(expected.params)
    && JSON.stringify(actual.returns) === JSON.stringify(expected.returns);
}

/**
 * The fail-closed pin: a digest over exactly the on-chain facts a cash.trading
 * spot order depends on. Version numbers and source digests are deliberately
 * not inputs.
 */
export function computeDecibelSpotAbiFingerprint(input: {
  account: string;
  chainId: string;
  functions: readonly ObservedDecibelSpotAbiFunction[];
  moduleBindings: readonly { package: string; modules: readonly string[] }[];
}) {
  const canonical = JSON.stringify({
    version: FINGERPRINT_VERSION,
    chainId: input.chainId,
    account: input.account,
    modules: [...input.moduleBindings]
      .map((entry) => [entry.package, [...entry.modules].sort()] as const)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
    functions: [...input.functions]
      .map((entry) => [
        entry.id,
        entry.visibility,
        entry.isEntry,
        entry.isView,
        entry.genericTypeParams,
        entry.params,
        entry.returns,
      ] as const)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const DEPLOYMENT_ACCOUNT_LONG = normalizeDecibelSpotAddress(DECIBEL_SPOT_DEPLOYMENT_ACCOUNT);

const REVIEWED_MODULE_BINDINGS = REVIEWED_DECIBEL_SPOT_PACKAGES.map((entry) => ({
  package: entry.name,
  modules: [...entry.boundModules].sort(),
}));

/**
 * The pinned fingerprint. Derived from the reviewed tables above so there is no
 * second copy of the truth to drift; the self-test anchors the literal value.
 */
export const REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT = computeDecibelSpotAbiFingerprint({
  account: DEPLOYMENT_ACCOUNT_LONG,
  chainId: DECIBEL_SPOT_CHAIN_ID,
  functions: REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS.map((entry) =>
    expectedFunctionSignature(entry, DEPLOYMENT_ACCOUNT_LONG),
  ),
  moduleBindings: REVIEWED_MODULE_BINDINGS,
});

/**
 * Fail-closed on everything a user's order depends on structurally: the four
 * packages exist exactly once, still carry the reviewed upgrade policy, and
 * still contain the modules we bind to. Upgrade numbers, source digests and the
 * rest of each package's module inventory are read, not gated.
 */
export function validateDecibelSpotPackageRegistry(value: unknown): ObservedDecibelSpotPackage[] {
  const registry = asRecord(value, "Decibel package registry");
  const packages = (registry as { data?: { packages?: unknown } }).data?.packages;
  if (!Array.isArray(packages)) throw new Error("Decibel package registry is missing packages");
  const byName = new Map<string, PackageMetadata>();
  for (const raw of packages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const metadata = raw as PackageMetadata;
    if (typeof metadata.name !== "string") continue;
    if (byName.has(metadata.name)) {
      throw new Error("Decibel package registry contains duplicate package names");
    }
    byName.set(metadata.name, metadata);
  }

  return REVIEWED_DECIBEL_SPOT_PACKAGES.map((reviewed) => {
    const actual = byName.get(reviewed.name);
    if (!actual) throw new Error(`Reviewed Decibel package ${reviewed.name} is missing`);
    const modules = packageModules(actual.modules, reviewed.name);
    const upgradePolicy = exactUnsigned(
      actual.upgrade_policy?.policy,
      `${reviewed.name} upgrade policy`,
    );
    if (upgradePolicy !== reviewed.upgradePolicy) {
      throw new Error(
        `Reviewed Decibel package ${reviewed.name} changed upgrade policy to ${upgradePolicy}`,
      );
    }
    for (const bound of reviewed.boundModules) {
      if (!modules.includes(bound)) {
        throw new Error(`Reviewed Decibel module ${reviewed.name}::${bound} is missing`);
      }
    }
    return {
      name: reviewed.name,
      upgradeNumber: exactUnsigned(actual.upgrade_number, `${reviewed.name} upgrade number`),
      upgradePolicy,
      digest: exactDigest(actual.source_digest, `${reviewed.name} source digest`),
      modules,
    } satisfies ObservedDecibelSpotPackage;
  });
}

export function decibelSpotPackageSignature(packages: readonly ObservedDecibelSpotPackage[]) {
  return packages
    .map((entry) => `${entry.name}:${entry.upgradeNumber}:${entry.digest}:${entry.modules.join(",")}`)
    .join("|");
}

export function diffDecibelSpotUpgrades(packages: readonly ObservedDecibelSpotPackage[]) {
  const drift: DecibelSpotUpgradeDrift[] = [];
  for (const observed of packages) {
    const reviewed = REVIEWED_DECIBEL_SPOT_PACKAGES.find((entry) => entry.name === observed.name);
    if (!reviewed) continue;
    const reviewedModules = new Set<string>(reviewed.lastReviewed.modules);
    const observedModules = new Set(observed.modules);
    const addedModules = observed.modules.filter((name) => !reviewedModules.has(name));
    const removedModules = [...reviewedModules].filter((name) => !observedModules.has(name)).sort();
    if (
      observed.upgradeNumber === reviewed.lastReviewed.upgradeNumber
      && observed.digest === reviewed.lastReviewed.digest
      && addedModules.length === 0
      && removedModules.length === 0
    ) {
      continue;
    }
    drift.push({
      package: observed.name,
      reviewedOn: reviewed.lastReviewed.reviewedOn,
      reviewedUpgradeNumber: reviewed.lastReviewed.upgradeNumber,
      observedUpgradeNumber: observed.upgradeNumber,
      reviewedDigest: reviewed.lastReviewed.digest,
      observedDigest: observed.digest,
      addedModules,
      removedModules,
    });
  }
  return drift;
}

/**
 * Reads the live module ABIs and returns exactly the reviewed function
 * signatures, throwing a precise error when one is missing or has changed.
 */
export function validateDecibelSpotModuleAbis(
  modules: Record<string, unknown>,
): ObservedDecibelSpotAbiFunction[] {
  const observed: ObservedDecibelSpotAbiFunction[] = [];
  for (const moduleName of REQUIRED_DECIBEL_SPOT_ABI_MODULES) {
    const payload = asRecord(modules[moduleName], `Decibel module ${moduleName}`);
    const abi = asRecord(payload.abi, `Decibel module ${moduleName} ABI`);
    if (normalizeDecibelSpotAddress(abi.address, `${moduleName} ABI address`) !== DEPLOYMENT_ACCOUNT_LONG) {
      throw new Error(`Decibel module ${moduleName} ABI is from another account`);
    }
    if (abi.name !== moduleName) {
      throw new Error(`Decibel module ${moduleName} ABI reports another module name`);
    }
    if (!Array.isArray(abi.exposed_functions)) {
      throw new Error(`Decibel module ${moduleName} ABI is missing exposed functions`);
    }

    for (const reviewed of REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS) {
      if (reviewed.module !== moduleName) continue;
      const matches = abi.exposed_functions.filter(
        (entry) => asRecord(entry, `${moduleName} function`).name === reviewed.name,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Decibel ABI function ${moduleName}::${reviewed.name} is ${matches.length === 0 ? "missing" : "ambiguous"}`,
        );
      }
      const found = asRecord(matches[0], `${moduleName}::${reviewed.name}`);
      const visibility = typeof found.visibility === "string" ? found.visibility : "";
      if (!MOVE_VISIBILITIES.has(visibility)) {
        throw new Error(`Decibel ABI function ${moduleName}::${reviewed.name} visibility is malformed`);
      }
      if (typeof found.is_entry !== "boolean" || typeof found.is_view !== "boolean") {
        throw new Error(`Decibel ABI function ${moduleName}::${reviewed.name} flags are malformed`);
      }
      if (!Array.isArray(found.generic_type_params) || !Array.isArray(found.params) || !Array.isArray(found.return)) {
        throw new Error(`Decibel ABI function ${moduleName}::${reviewed.name} signature is malformed`);
      }
      const actual: ObservedDecibelSpotAbiFunction = {
        id: `${moduleName}::${reviewed.name}`,
        visibility,
        isEntry: found.is_entry,
        isView: found.is_view,
        genericTypeParams: found.generic_type_params.length,
        params: found.params.map((type, index) =>
          canonicalizeMoveType(type, `${moduleName}::${reviewed.name} param ${index}`),
        ),
        returns: found.return.map((type, index) =>
          canonicalizeMoveType(type, `${moduleName}::${reviewed.name} return ${index}`),
        ),
      };
      if (!sameSignature(actual, expectedFunctionSignature(reviewed, DEPLOYMENT_ACCOUNT_LONG))) {
        throw new Error(`Decibel ABI function ${moduleName}::${reviewed.name} changed`);
      }
      observed.push(actual);
    }
  }
  return observed;
}

/**
 * Fail-closed on the ABI fingerprint; warn-and-continue on version drift.
 */
export function evaluateDecibelSpotDeployment(args: {
  chainId: string;
  modules: Record<string, unknown>;
  registry: unknown;
}): DecibelSpotDeploymentEvaluation {
  if (args.chainId !== DECIBEL_SPOT_CHAIN_ID) {
    throw new Error("Decibel deployment proof is not from Aptos mainnet");
  }
  const observedPackages = validateDecibelSpotPackageRegistry(args.registry);
  const functions = validateDecibelSpotModuleAbis(args.modules);
  const abiFingerprint = computeDecibelSpotAbiFingerprint({
    account: DEPLOYMENT_ACCOUNT_LONG,
    chainId: args.chainId,
    functions,
    moduleBindings: REVIEWED_MODULE_BINDINGS,
  });
  if (abiFingerprint !== REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT) {
    throw new Error(
      `Decibel spot ABI fingerprint changed (expected ${REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT}, observed ${abiFingerprint})`,
    );
  }
  const drift = diffDecibelSpotUpgrades(observedPackages);
  return {
    abiFingerprint,
    drift,
    observedPackages,
    packageSignature: decibelSpotPackageSignature(observedPackages),
    upgradeDrift: drift.length > 0,
  };
}

function ledgerProof(headers: Headers, nowMs: number) {
  if (headers.get("x-aptos-chain-id") !== DECIBEL_SPOT_CHAIN_ID) {
    throw new Error("Decibel deployment proof is not from Aptos mainnet");
  }
  const ledgerVersion = headers.get("x-aptos-ledger-version") ?? "";
  const ledgerTimestampUsec = headers.get("x-aptos-ledger-timestampusec") ?? "";
  if (!/^\d+$/.test(ledgerVersion) || !/^\d+$/.test(ledgerTimestampUsec)) {
    throw new Error("Decibel deployment ledger proof is malformed");
  }
  const ledgerTimestampMs = Number(BigInt(ledgerTimestampUsec) / 1_000n);
  if (
    !Number.isSafeInteger(ledgerTimestampMs)
    || ledgerTimestampMs > nowMs + 5_000
    || nowMs - ledgerTimestampMs > DEPLOYMENT_MAX_AGE_MS
  ) {
    throw new Error("Decibel deployment ledger proof is stale");
  }
  return { ledgerTimestampMs, ledgerVersion };
}

async function fetchDeploymentJson(args: { apiKey?: string; label: string; maxBytes: number; path: string }) {
  const response = await fetch(`${APTOS_MAINNET_FULLNODE_BASE}${args.path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(DEPLOYMENT_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
      "X-Aptos-Client": "cash-trading/decibel-spot-attestation",
    },
  });
  if (!response.ok) throw new Error(`${args.label} returned ${response.status}`);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new Error(`${args.label} did not return JSON`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > args.maxBytes) {
    throw new Error(`${args.label} exceeded the size bound`);
  }
  try {
    return { headers: response.headers, value: JSON.parse(text) as unknown };
  } catch {
    throw new Error(`${args.label} returned malformed JSON`);
  }
}

async function fetchDecibelSpotModuleAbis(apiKey: string | undefined, nowMs: number) {
  const entries = await Promise.all(
    REQUIRED_DECIBEL_SPOT_ABI_MODULES.map(async (moduleName) => {
      const response = await fetchDeploymentJson({
        apiKey,
        label: `Decibel module ${moduleName}`,
        maxBytes: MAX_MODULE_BYTES,
        path: `/accounts/${DECIBEL_SPOT_DEPLOYMENT_ACCOUNT}/module/${moduleName}`,
      });
      ledgerProof(response.headers, nowMs);
      return [moduleName, response.value] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, unknown>;
}

function reportUpgradeDrift(evaluation: DecibelSpotDeploymentEvaluation) {
  if (!evaluation.upgradeDrift) {
    warnedDriftSignature = null;
    return;
  }
  if (warnedDriftSignature === evaluation.packageSignature) return;
  warnedDriftSignature = evaluation.packageSignature;
  console.warn(
    "[decibel-spot] upgrade drift with an unchanged ABI fingerprint — venue stays ready, re-review the pins:",
    JSON.stringify({ abiFingerprint: evaluation.abiFingerprint, drift: evaluation.drift }),
  );
}

async function fetchDeploymentAttestation(apiKey?: string) {
  const registryResponse = await fetchDeploymentJson({
    apiKey,
    label: "Decibel package registry",
    maxBytes: MAX_REGISTRY_BYTES,
    path: `/accounts/${DECIBEL_SPOT_DEPLOYMENT_ACCOUNT}/resource/${encodeURIComponent(PACKAGE_REGISTRY_TYPE)}`,
  });
  const nowMs = Date.now();
  const proof = ledgerProof(registryResponse.headers, nowMs);
  const observedPackages = validateDecibelSpotPackageRegistry(registryResponse.value);
  const packageSignature = decibelSpotPackageSignature(observedPackages);

  // Module bytecode cannot move without moving this signature, so the ABI read
  // only repeats when the packages actually changed (or the cache aged out).
  const cachedAbi = abiCache;
  let abiFingerprint: string;
  if (
    cachedAbi
    && cachedAbi.signature === packageSignature
    && nowMs - cachedAbi.verifiedAtMs < ABI_REVALIDATE_MS
  ) {
    abiFingerprint = cachedAbi.fingerprint;
    if (abiFingerprint !== REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT) {
      throw new Error("Decibel spot ABI fingerprint changed");
    }
  } else {
    const modules = await fetchDecibelSpotModuleAbis(apiKey, nowMs);
    abiFingerprint = evaluateDecibelSpotDeployment({
      chainId: DECIBEL_SPOT_CHAIN_ID,
      modules,
      registry: registryResponse.value,
    }).abiFingerprint;
    abiCache = { fingerprint: abiFingerprint, signature: packageSignature, verifiedAtMs: nowMs };
  }

  const drift = diffDecibelSpotUpgrades(observedPackages);
  const evaluation: DecibelSpotDeploymentEvaluation = {
    abiFingerprint,
    drift,
    observedPackages,
    packageSignature,
    upgradeDrift: drift.length > 0,
  };
  reportUpgradeDrift(evaluation);
  return {
    ...evaluation,
    accountAddress: DEPLOYMENT_ACCOUNT_LONG,
    expiresAtMs: nowMs + DEPLOYMENT_CACHE_MS,
    ledgerTimestampMs: proof.ledgerTimestampMs,
    ledgerVersion: proof.ledgerVersion,
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
  abiCache = null;
  warnedDriftSignature = null;
}
