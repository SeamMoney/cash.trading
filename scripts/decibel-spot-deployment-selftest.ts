import assert from "node:assert/strict";

import {
  DECIBEL_SPOT_CHAIN_ID,
  DECIBEL_SPOT_DEPLOYMENT_ACCOUNT,
  REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT,
  REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS,
  REVIEWED_DECIBEL_SPOT_PACKAGES,
  diffDecibelSpotUpgrades,
  evaluateDecibelSpotDeployment,
  validateDecibelSpotPackageRegistry,
} from "../lib/decibel-spot-deployment";

/**
 * Independent anchors. These are deliberately literal: they must be re-derived
 * from mainnet by a human, not copied from the module under test.
 */
const EXPECTED_ABI_FINGERPRINT =
  "4ee5d55a9b483ccbb023c63985ad73cb4644c8484665759f16a75508754d9393";
const EXPECTED_ACCOUNT_ENTRY_DIGEST =
  "14F71F1F5AAB878412EF7610964F75939AB5AE44004A7BA4FE4487BFB2B8151E";

assert.equal(
  REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT,
  EXPECTED_ABI_FINGERPRINT,
  "the reviewed ABI fingerprint is the fail-closed pin and must not move silently",
);
assert.equal(
  REVIEWED_DECIBEL_SPOT_PACKAGES.find((entry) => entry.name === "decibel_accounts")
    ?.lastReviewed.digest,
  EXPECTED_ACCOUNT_ENTRY_DIGEST,
  "the wallet entry package's last-reviewed digest must remain independently anchored",
);

const LONG_ACCOUNT = `0x${DECIBEL_SPOT_DEPLOYMENT_ACCOUNT.slice(2).padStart(64, "0")}`;

type RegistryPackage = {
  modules: Array<{ name: string }>;
  name: string;
  source_digest: string;
  upgrade_number: string;
  upgrade_policy: { policy: number };
};

function registry(): { data: { packages: RegistryPackage[] } } {
  return {
    data: {
      packages: REVIEWED_DECIBEL_SPOT_PACKAGES.map((entry) => ({
        name: entry.name,
        upgrade_number: entry.lastReviewed.upgradeNumber,
        upgrade_policy: { policy: Number(entry.upgradePolicy) },
        source_digest: entry.lastReviewed.digest.toLowerCase(),
        modules: entry.lastReviewed.modules.map((name) => ({ name })),
      })),
    },
  };
}

type AbiFunction = {
  generic_type_params: Array<{ constraints: string[] }>;
  is_entry: boolean;
  is_view: boolean;
  name: string;
  params: string[];
  return: string[];
  visibility: string;
};

function modules(): Record<string, { abi: { address: string; exposed_functions: AbiFunction[]; friends: string[]; name: string; structs: [] }; bytecode: string }> {
  const byModule = new Map<string, AbiFunction[]>();
  for (const entry of REVIEWED_DECIBEL_SPOT_ABI_FUNCTIONS) {
    const expand = (type: string) => type.replaceAll("{deployment}", LONG_ACCOUNT);
    const list = byModule.get(entry.module) ?? [];
    list.push({
      name: entry.name,
      visibility: entry.visibility,
      is_entry: entry.isEntry,
      is_view: entry.isView,
      generic_type_params: Array.from({ length: entry.genericTypeParams }, () => ({ constraints: [] })),
      params: entry.params.map(expand),
      return: entry.returns.map(expand),
    });
    byModule.set(entry.module, list);
  }
  return Object.fromEntries(
    [...byModule].map(([name, exposed]) => [
      name,
      {
        bytecode: "0xa11ceb0b",
        abi: { address: LONG_ACCOUNT, name, friends: [], exposed_functions: exposed, structs: [] as [] },
      },
    ]),
  );
}

function evaluate(overrides: {
  chainId?: string;
  modules?: ReturnType<typeof modules>;
  registry?: unknown;
} = {}) {
  return evaluateDecibelSpotDeployment({
    chainId: overrides.chainId ?? DECIBEL_SPOT_CHAIN_ID,
    modules: overrides.modules ?? modules(),
    registry: overrides.registry ?? registry(),
  });
}

function findPackage(value: { data: { packages: RegistryPackage[] } }, name: string) {
  const found = value.data.packages.find((entry) => entry.name === name);
  assert.ok(found, `${name} must exist in the fixture`);
  return found;
}

function findAbiFunction(value: ReturnType<typeof modules>, module: string, name: string) {
  const found = value[module]?.abi.exposed_functions.find((entry) => entry.name === name);
  assert.ok(found, `${module}::${name} must exist in the fixture`);
  return found;
}

// 1. The reviewed deployment is ready, with no drift.
const reviewed = evaluate();
assert.equal(reviewed.abiFingerprint, REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT);
assert.equal(reviewed.upgradeDrift, false, "the reviewed deployment must not report drift");
assert.deepEqual(reviewed.drift, []);
assert.equal(reviewed.observedPackages.length, REVIEWED_DECIBEL_SPOT_PACKAGES.length);
assert.match(reviewed.packageSignature, /decibel_spot_dex:3:402795D2/);

// 2. THE OUTAGE CASE. Decibel bumps upgrade numbers, source digests and even
// adds a module, but the ABI we submit against is untouched: the venue stays
// ready and the drift is reported, not fail-closed.
const upgraded = registry();
const upgradedAccounts = findPackage(upgraded, "decibel_accounts");
upgradedAccounts.upgrade_number = "31";
upgradedAccounts.source_digest = "a".repeat(64);
const upgradedSpot = findPackage(upgraded, "decibel_spot_dex");
upgradedSpot.upgrade_number = "5";
upgradedSpot.source_digest = "b".repeat(64);
upgradedSpot.modules.push({ name: "spot_new_upstream_module" });

const drifted = evaluate({ registry: upgraded });
assert.equal(drifted.upgradeDrift, true, "an upgrade with an unchanged ABI must report drift");
assert.equal(
  drifted.abiFingerprint,
  REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT,
  "an upgrade number is not an input to the ABI fingerprint",
);
assert.equal(drifted.drift.length, 2, "only the two upgraded packages may report drift");
const accountsDrift = drifted.drift.find((entry) => entry.package === "decibel_accounts");
assert.ok(accountsDrift);
assert.equal(accountsDrift.reviewedUpgradeNumber, "29");
assert.equal(accountsDrift.observedUpgradeNumber, "31");
assert.equal(accountsDrift.reviewedDigest, EXPECTED_ACCOUNT_ENTRY_DIGEST);
assert.equal(accountsDrift.observedDigest, "A".repeat(64));
const spotDrift = drifted.drift.find((entry) => entry.package === "decibel_spot_dex");
assert.ok(spotDrift);
assert.deepEqual(spotDrift.addedModules, ["spot_new_upstream_module"]);
assert.deepEqual(spotDrift.removedModules, []);
assert.equal(spotDrift.observedUpgradeNumber, "5");

// The same drift is observable without the ABI read, for reporting.
assert.equal(diffDecibelSpotUpgrades(validateDecibelSpotPackageRegistry(upgraded)).length, 2);

// A new upstream function in a module we bind to is additive, not a break.
const extendedModules = modules();
extendedModules.spot_market_config.abi.exposed_functions.push({
  name: "get_new_upstream_knob",
  visibility: "friend",
  is_entry: false,
  is_view: true,
  generic_type_params: [],
  params: ["address"],
  return: ["u64"],
});
assert.equal(evaluate({ modules: extendedModules }).abiFingerprint, REVIEWED_DECIBEL_SPOT_ABI_FINGERPRINT);

// 3. THE FAIL-CLOSED CASE. The ABI we submit against changed: hard stop, even
// though every upgrade number and digest still matches the reviewed pins.
const reorderedEntry = modules();
const placeSpotOrder = findAbiFunction(reorderedEntry, "dex_accounts_spot_entry", "place_spot_order");
placeSpotOrder.params = [
  "&signer",
  `0x1::object::Object<${LONG_ACCOUNT}::spot_market::SpotMarket>`,
  "u64",
  "u64",
  "u8",
  "bool",
  "0x1::option::Option<address>",
  "0x1::option::Option<u64>",
];
assert.throws(
  () => evaluate({ modules: reorderedEntry }),
  /dex_accounts_spot_entry::place_spot_order changed/,
  "a swapped side/time-in-force argument must fail closed",
);

const extraArgument = modules();
findAbiFunction(extraArgument, "dex_accounts_spot_entry", "place_spot_order").params.push("u64");
assert.throws(() => evaluate({ modules: extraArgument }), /place_spot_order changed/);

const generifiedEntry = modules();
findAbiFunction(generifiedEntry, "dex_accounts_spot_entry", "place_spot_order")
  .generic_type_params.push({ constraints: [] });
assert.throws(() => evaluate({ modules: generifiedEntry }), /place_spot_order changed/);

const nonEntry = modules();
findAbiFunction(nonEntry, "dex_accounts_spot_entry", "place_spot_order").is_entry = false;
assert.throws(() => evaluate({ modules: nonEntry }), /place_spot_order changed/);

const renamedView = modules();
renamedView.spot_market_config.abi.exposed_functions =
  renamedView.spot_market_config.abi.exposed_functions.filter(
    (entry) => entry.name !== "get_lot_size",
  );
assert.throws(
  () => evaluate({ modules: renamedView }),
  /spot_market_config::get_lot_size is missing/,
  "a removed quote-path config reader must fail closed",
);

const retypedFeeView = modules();
findAbiFunction(retypedFeeView, "unified_fees_config", "view_spot_tier_taker_fees").return = ["u64"];
assert.throws(() => evaluate({ modules: retypedFeeView }), /view_spot_tier_taker_fees changed/);

const foreignModule = modules();
foreignModule.spot_market_config.abi.address = `0x${"1".repeat(64)}`;
assert.throws(() => evaluate({ modules: foreignModule }), /is from another account/);

const missingModule = modules();
delete (foreignModule as Record<string, unknown>).unified_fees_config;
delete (missingModule as Record<string, unknown>).unified_fees_config;
assert.throws(() => evaluate({ modules: missingModule }), /unified_fees_config is malformed/);

// 4. Structural registry gates stay hard.
const droppedPolicy = registry();
findPackage(droppedPolicy, "decibel_spot_dex").upgrade_policy = { policy: 0 };
assert.throws(
  () => evaluate({ registry: droppedPolicy }),
  /decibel_spot_dex changed upgrade policy to 0/,
);

const droppedBoundModule = registry();
const boundHost = findPackage(droppedBoundModule, "decibel_accounts");
boundHost.modules = boundHost.modules.filter((entry) => entry.name !== "dex_accounts_spot_entry");
assert.throws(
  () => evaluate({ registry: droppedBoundModule }),
  /decibel_accounts::dex_accounts_spot_entry is missing/,
);

const missingPackage = registry();
missingPackage.data.packages = missingPackage.data.packages.filter(
  (entry) => entry.name !== "aptos_market",
);
assert.throws(() => evaluate({ registry: missingPackage }), /aptos_market is missing/);

const duplicatePackage = registry();
duplicatePackage.data.packages.push({ ...duplicatePackage.data.packages[0] });
assert.throws(() => evaluate({ registry: duplicatePackage }), /duplicate package names/);

const malformedDigest = registry();
findPackage(malformedDigest, "aptos_market").source_digest = "not-a-digest";
assert.throws(() => evaluate({ registry: malformedDigest }), /source digest is malformed/);

assert.throws(() => evaluate({ chainId: "2" }), /not from Aptos mainnet/);
assert.throws(() => evaluate({ registry: { data: {} } }), /missing packages/);

console.log("Decibel spot deployment self-test passed");
