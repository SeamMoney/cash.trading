import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import rewardConfig from "../config/cash-rewards.json";

const deployScript = readFileSync(
  "scripts/cash-rewards-mainnet-deploy.ts",
  "utf8",
);
const sharedInspection = readFileSync(
  "lib/cash-rewards-mainnet.ts",
  "utf8",
);

assert.equal(rewardConfig.network, "mainnet");
assert.match(
  deployScript,
  /PUBLISH_AND_INITIALIZE_CASH_REWARDS_ON_APTOS_MAINNET/,
  "mainnet mutation must require an unmistakable confirmation",
);
assert.match(deployScript, /argv\.includes\("--execute"\)/);
assert.match(deployScript, /--private-key-file/);
assert.doesNotMatch(
  deployScript,
  /["']--private-key["']/,
  "private key material must never be placed in the process argument list",
);
assert.match(deployScript, /assertPublishedBytecodeMatches/);
assert.match(deployScript, /transaction\.simulate\.simple/);
assert.match(deployScript, /claims remain paused/i);
assert.doesNotMatch(
  deployScript,
  /::set_paused|::fund/,
  "deployment must not fund CASH or enable claims before the canary",
);
assert.match(sharedInspection, /issuerMatches/);
assert.match(sharedInspection, /epochDurationMatches/);
assert.match(sharedInspection, /epochCapMatches/);
assert.match(sharedInspection, /walletCapMatches/);

console.log("cash rewards guarded mainnet deployment self-test passed");
