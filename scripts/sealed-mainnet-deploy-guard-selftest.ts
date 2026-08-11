import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const deployScript = readFileSync("scripts/sealed-e2e-deploy.ts", "utf8");

assert.match(
  deployScript,
  /PUBLISH_COMPATIBLE_SEALED_VAULTS_ON_APTOS_MAINNET/,
  "compatible mainnet publishing must require an unmistakable confirmation",
);
assert.match(
  deployScript,
  /MAINNET_UPGRADE_POLICY\s*=\s*["']compatible["']/,
  "mainnet must explicitly use the strongest policy allowed by its compatible Decibel dependencies",
);
assert.match(
  deployScript,
  /function applyMainnetUpgradePolicy\(/,
  "mainnet preflight and publish must share one explicit policy rewrite",
);
assert.equal(
  deployScript.match(/applyMainnetUpgradePolicy\(toml\)/g)?.length,
  2,
  "both preflight and publish must force the same policy",
);
assert.doesNotMatch(
  deployScript,
  /upgrade_policy = [\\"']immutable[\\"']/,
  "mainnet must not retry the dependency-incompatible immutable policy",
);
assert.match(
  deployScript,
  /SPEND_250_USDC_ON_MAINNET_SEALED_E2E/,
  "a funded mainnet E2E run must require a separate spending confirmation",
);
assert.match(deployScript, /flags\["confirm-mainnet"\]/);
assert.match(deployScript, /flags\["confirm-funded-e2e"\]/);

const runStart = deployScript.indexOf("async function run() {");
const guardCall = deployScript.indexOf("assertMainnetExecutionConfirmed();", runStart);
const stateLoad = deployScript.indexOf("const state = loadState();", runStart);
const keyLoad = deployScript.indexOf("loadOrCreateKey(", runStart);
assert.ok(runStart >= 0 && guardCall > runStart, "run() must call the mainnet guard");
assert.ok(
  guardCall < stateLoad && guardCall < keyLoad,
  "the mainnet guard must run before state or key material is loaded or created",
);

assert.match(deployScript, /--private-key-file/);
assert.doesNotMatch(
  deployScript,
  /["']--private-key["']/,
  "private key material must never be placed in the process argument list",
);

const freshPublishReserve = deployScript.match(
  /MIN_FRESH_PUBLISH_GAS_OCTAS\s*=\s*([\d_]+)n/,
);
assert.ok(freshPublishReserve, "the fresh-publish gas reserve must be explicit");
assert.ok(
  BigInt(freshPublishReserve[1].replaceAll("_", "")) >= 250_000_000n,
  "a fresh publish must reserve at least 2.5 APT for Aptos max-gas validation",
);
assert.match(
  deployScript,
  /state\.packageAddress\s*\?\s*MIN_RESUME_GAS_OCTAS\s*:\s*MIN_FRESH_PUBLISH_GAS_OCTAS/,
  "resumed post-publish runs must use the lower setup reserve",
);

const recoveryDefinition = deployScript.indexOf("async function recoverExactPublishedPackage(");
const recoveryCall = deployScript.indexOf("await recoverExactPublishedPackage(", runStart);
const fundingRead = deployScript.indexOf("const bal = await balanceOctas(", runStart);
const recoveryVerification = deployScript.indexOf(
  "await assertPublishedPackageMatches(packageDir, packageAddress, published);",
  recoveryDefinition,
);
const recoveryStateWrite = deployScript.indexOf(
  "state.packageAddress = state.deployerAddr;",
  recoveryCall,
);
assert.ok(recoveryDefinition >= 0, "the deployer must define crash-safe package recovery");
assert.ok(
  recoveryCall > runStart && recoveryCall < fundingRead,
  "an unrecorded package must be recovered before choosing the funding reserve",
);
assert.ok(
  recoveryVerification > recoveryDefinition && recoveryVerification < recoveryCall,
  "recovery must require exact on-chain bytecode verification",
);
assert.ok(
  recoveryStateWrite > recoveryCall && recoveryStateWrite < fundingRead,
  "the recovered package address must only be persisted after successful recovery",
);
assert.match(
  deployScript,
  /if \(network !== ["']testnet["']\)[\s\S]{0,300}--test-signal is forbidden outside testnet/,
  "synthetic execution signals must be rejected before they can reach mainnet",
);
const testSignalParse = deployScript.indexOf("const testSignal = parseTestSignal();");
assert.ok(testSignalParse >= 0 && testSignalParse < runStart);

assert.doesNotMatch(
  deployScript,
  /msg\.includes\(["']11["']\)/,
  "unrelated Move aborts must never be mistaken for E_BAR_TOO_SOON",
);
assert.match(
  deployScript,
  /while \(submitted < count\)/,
  "a rate-limited tick must be retried until the requested number are submitted",
);
assert.match(
  deployScript,
  /retrying the same tick/,
  "the retry path must state that a rate-limited tick was not consumed",
);

const executionVerifier = deployScript.indexOf("async function verifyDirectionalExecutionProbe(");
const liveMessage = deployScript.indexOf("LIVE. Add to .env / Vercel:");
assert.ok(executionVerifier >= 0, "the E2E must define a directional execution verifier");
assert.match(
  deployScript,
  /if \(testSignal === 1 \|\| testSignal === 2\)[\s\S]{0,400}verifyDirectionalExecutionProbe/,
  "a directional test run must verify execution before reporting LIVE",
);
assert.ok(
  deployScript.indexOf("await verifyDirectionalExecutionProbe(state, executionTick);") < liveMessage,
  "execution proof must complete before the script reports LIVE",
);
assert.match(deployScript, /::market_types::OrderEvent/);
assert.match(deployScript, /::sealed_vault::VaultTraded/);
assert.match(deployScript, /AttestedTick reported traded=false/);
assert.match(deployScript, /::perp_engine::list_positions/);
assert.match(deployScript, /::sealed_vault::get_builder_terms/);
assert.match(
  deployScript,
  /platformTerms\[3\][\s\S]{0,160}builderTerms\[1\]/,
  "execution proof must require zero builder fee in both platform and vault snapshots",
);
assert.match(
  deployScript,
  /verify-execution is testnet-only; no state or key material was loaded/,
  "the standalone execution verifier must reject mainnet before loading state",
);

const preflightStart = deployScript.indexOf("async function preflightMainnet() {");
const preflightEnd = deployScript.indexOf("async function verifyMarkets()", preflightStart);
assert.ok(preflightStart >= 0 && preflightEnd > preflightStart, "mainnet preflight must exist");
const preflightBody = deployScript.slice(preflightStart, preflightEnd);
assert.match(preflightBody, /network !== ["']mainnet["']/);
assert.match(preflightBody, /no key was loaded and no transaction was submitted/);
assert.doesNotMatch(preflightBody, /loadState\(/, "preflight must not read deployment state");
assert.doesNotMatch(preflightBody, /loadOrCreateKey\(/, "preflight must not load or create keys");
assert.doesNotMatch(preflightBody, /saveState\(/, "preflight must not mutate deployment state");
assert.doesNotMatch(preflightBody, /submit\(/, "preflight must not submit a transaction");
assert.doesNotMatch(
  preflightBody,
  /signAndSubmitTransaction/,
  "preflight must not expose a signing path",
);
assert.match(
  deployScript,
  /cmd === ["']preflight-mainnet["'][\s\S]{0,80}preflightMainnet\(\)/,
  "the keyless preflight must be exposed as a command",
);

console.log("sealed-vault guarded mainnet deployment self-test passed");
