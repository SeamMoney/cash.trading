import assert from "node:assert/strict";

import {
  REVIEWED_DECIBEL_SPOT_PACKAGES,
  validateDecibelSpotPackageRegistry,
} from "../lib/decibel-spot-deployment";

const EXPECTED_ACCOUNT_ENTRY_DIGEST =
  "14F71F1F5AAB878412EF7610964F75939AB5AE44004A7BA4FE4487BFB2B8151E";
assert.equal(
  REVIEWED_DECIBEL_SPOT_PACKAGES.find((entry) => entry.name === "decibel_accounts")?.digest,
  EXPECTED_ACCOUNT_ENTRY_DIGEST,
  "the wallet entry package pin must remain independently anchored",
);

function registry() {
  return {
    data: {
      packages: REVIEWED_DECIBEL_SPOT_PACKAGES.map((entry) => ({
        name: entry.name,
        upgrade_number: entry.upgradeNumber,
        upgrade_policy: { policy: Number(entry.upgradePolicy) },
        source_digest: entry.digest.toLowerCase(),
        modules: entry.modules.map((name) => ({ name })),
      })),
    },
  };
}

const signature = validateDecibelSpotPackageRegistry(registry());
assert.match(signature, /decibel_accounts:29:/);
assert.match(signature, /decibel_spot_dex:3:/);

const changedDigest = registry();
changedDigest.data.packages[2].source_digest = "0".repeat(64);
assert.throws(
  () => validateDecibelSpotPackageRegistry(changedDigest),
  /decibel_spot_dex changed/,
);

const changedUpgrade = registry();
(changedUpgrade.data.packages[1] as { upgrade_number: string }).upgrade_number = "28";
assert.throws(
  () => validateDecibelSpotPackageRegistry(changedUpgrade),
  /decibel_accounts changed/,
);

const missingModule = registry();
missingModule.data.packages[0].modules.pop();
assert.throws(
  () => validateDecibelSpotPackageRegistry(missingModule),
  /aptos_market changed/,
);

const duplicatePackage = registry();
duplicatePackage.data.packages.push({ ...duplicatePackage.data.packages[0] });
assert.throws(
  () => validateDecibelSpotPackageRegistry(duplicatePackage),
  /duplicate package names/,
);

console.log("Decibel spot deployment self-test passed");
