import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  Account,
  type Aptos,
  type InputEntryFunctionData,
} from "@aptos-labs/ts-sdk";
import rewardConfig from "../config/cash-rewards.json";
import {
  CASH_REWARDS_ISSUER_KEY_PATH,
  CASH_REWARDS_MANAGER_KEY_PATH,
  CASH_REWARDS_MODULE,
  createCashRewardsMainnetClient,
  inspectCashRewardsMainnet,
  normalizeCashRewardsHex,
  readCashRewardsPrivateKey,
  type CashRewardsContractCheck,
} from "../lib/cash-rewards-mainnet";

const PACKAGE_DIR = resolve("contracts/cash-rewards");
const LOCAL_MODULE_PATH = resolve(
  "contracts/cash-rewards/build/CashRewards/bytecode_modules/cash_rewards.mv",
);
const STATE_DIR = resolve(".cash-rewards");
const STATE_PATH = resolve(STATE_DIR, "mainnet-deploy.json");
const MAINNET_URL = "https://api.mainnet.aptoslabs.com/v1";
const TEST_ADDRESS = "0xCA54";
const EXECUTION_CONFIRMATION =
  "PUBLISH_AND_INITIALIZE_CASH_REWARDS_ON_APTOS_MAINNET";

type DeploymentState = {
  network: "mainnet";
  managerAddress: string;
  publishTransaction?: string;
  initializeTransaction?: string;
  verifiedAt?: string;
};

function executionRequested(argv: string[]) {
  const supported = new Set(["--", "--execute", "plan"]);
  const unknown = argv.slice(2).filter((argument) => !supported.has(argument));
  if (unknown.length > 0) {
    throw new Error(`unknown argument: ${unknown.join(" ")}`);
  }
  return argv.includes("--execute");
}

function assertConfiguredValues() {
  assert.equal(
    rewardConfig.network,
    "mainnet",
    "config/cash-rewards.json must target mainnet",
  );
  const epochDuration = BigInt(rewardConfig.epochDurationSeconds);
  const epochCap = BigInt(rewardConfig.maxEpochEmissionAtomic);
  const walletCap = BigInt(rewardConfig.maxWalletEpochAtomic);
  assert.ok(epochDuration > 0n, "epoch duration must be positive");
  assert.ok(epochCap > 0n, "global epoch cap must be positive");
  assert.ok(
    walletCap > 0n && walletCap <= epochCap,
    "wallet cap must be positive and no larger than the global cap",
  );
  assert.equal(
    normalizeCashRewardsHex(rewardConfig.issuerPublicKey).length,
    64,
    "issuer public key must contain exactly 32 bytes",
  );
}

function assertPrivateFile(path: string) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing; no mainnet transaction can be prepared`);
  }
  const permissions = statSync(path).mode & 0o777;
  if ((permissions & 0o077) !== 0) {
    throw new Error(
      `${path} must not be readable or writable by group/other users (use mode 0600)`,
    );
  }
}

function aptosEnvironment() {
  const nodeApiKey = (
    process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY
  )
    ?.replace(/\r?\n/g, "")
    .trim();
  return {
    ...process.env,
    ...(nodeApiKey ? { NODE_API_KEY: nodeApiKey } : {}),
  };
}

function runAptos(args: string[], options?: { print?: boolean }) {
  try {
    const output = execFileSync(process.env.APTOS_BIN || "aptos", args, {
      cwd: resolve("."),
      encoding: "utf8",
      env: aptosEnvironment(),
      maxBuffer: 10 * 1024 * 1024,
    });
    if (options?.print !== false && output.trim()) {
      console.log(output.trim());
    }
    return output;
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const stdout = failure.stdout?.trim();
    const stderr = failure.stderr?.trim();
    throw new Error(
      [
        `aptos ${args.slice(0, 2).join(" ")} failed`,
        stdout,
        stderr,
        failure.message,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function validatePackage() {
  console.log("\n[1/4] Running Move safety tests at the fixture address…");
  runAptos([
    "move",
    "test",
    "--package-dir",
    PACKAGE_DIR,
    "--named-addresses",
    `cash_rewards=${TEST_ADDRESS}`,
  ]);

  // Compile the exact production address last. The test build uses 0xCA54
  // because the voucher fixture binds the module publisher into its signature.
  console.log("\n[2/4] Compiling the exact production package…");
  runAptos([
    "move",
    "compile",
    "--package-dir",
    PACKAGE_DIR,
    "--named-addresses",
    `cash_rewards=${rewardConfig.managerAddress}`,
    "--included-artifacts",
    "sparse",
  ]);
}

async function assertPublishedBytecodeMatches(aptos: Aptos) {
  const module = await aptos.getAccountModule({
    accountAddress: rewardConfig.managerAddress,
    moduleName: "cash_rewards",
  });
  const onChain = normalizeCashRewardsHex(module.bytecode);
  const local = readFileSync(LOCAL_MODULE_PATH).toString("hex").toLowerCase();
  assert.equal(
    onChain,
    local,
    "the published cash_rewards bytecode does not match this repository; refusing to initialize or overwrite state",
  );
}

function assertContractMatches(contract: CashRewardsContractCheck) {
  assert.equal(contract.initialized, true, "cash_rewards is not initialized");
  assert.equal(
    contract.issuerMatches,
    true,
    "on-chain issuer public key differs from config/cash-rewards.json",
  );
  assert.equal(
    contract.epochDurationMatches,
    true,
    "on-chain epoch duration differs from config/cash-rewards.json",
  );
  assert.equal(
    contract.epochCapMatches,
    true,
    "on-chain global epoch cap differs from config/cash-rewards.json",
  );
  assert.equal(
    contract.walletCapMatches,
    true,
    "on-chain wallet epoch cap differs from config/cash-rewards.json",
  );
}

function parseTransactionHash(output: string) {
  return output.match(/"transaction_hash"\s*:\s*"(0x[0-9a-fA-F]+)"/)?.[1];
}

function explorer(transactionHash: string) {
  return `https://explorer.aptoslabs.com/txn/${transactionHash}?network=mainnet`;
}

function readDeploymentState(): DeploymentState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as DeploymentState;
    if (
      parsed.network !== "mainnet" ||
      parsed.managerAddress.toLowerCase() !==
        rewardConfig.managerAddress.toLowerCase()
    ) {
      throw new Error("saved CASH rewards deployment state targets a different network or manager");
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    return {
      network: "mainnet",
      managerAddress: rewardConfig.managerAddress,
    };
  }
}

function saveDeploymentState(state: DeploymentState) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(STATE_PATH, 0o600);
}

function issuerPublicKeyBytes() {
  const value = normalizeCashRewardsHex(rewardConfig.issuerPublicKey);
  return Array.from(Buffer.from(value, "hex"));
}

async function initializeContract(aptos: Aptos, manager: Account) {
  const data: InputEntryFunctionData = {
    function:
      `${CASH_REWARDS_MODULE}::initialize` as `${string}::${string}::${string}`,
    typeArguments: [rewardConfig.cashCoinType],
    functionArguments: [
      issuerPublicKeyBytes(),
      String(rewardConfig.epochDurationSeconds),
      rewardConfig.maxEpochEmissionAtomic,
      rewardConfig.maxWalletEpochAtomic,
    ],
  };
  const transaction = await aptos.transaction.build.simple({
    sender: manager.accountAddress,
    data,
  });
  const [simulation] = await aptos.transaction.simulate.simple({
    signerPublicKey: manager.publicKey,
    transaction,
  });
  if (!simulation.success) {
    throw new Error(
      `cash_rewards initialization simulation failed: ${simulation.vm_status}`,
    );
  }
  const pending = await aptos.signAndSubmitTransaction({
    signer: manager,
    transaction,
  });
  const committed = await aptos.waitForTransaction({
    transactionHash: pending.hash,
  });
  if (!committed.success) {
    throw new Error(
      `cash_rewards initialization reverted: ${committed.vm_status} (${explorer(pending.hash)})`,
    );
  }
  return pending.hash;
}

async function main() {
  const execute = executionRequested(process.argv);
  assertConfiguredValues();
  assertPrivateFile(CASH_REWARDS_MANAGER_KEY_PATH);
  assertPrivateFile(CASH_REWARDS_ISSUER_KEY_PATH);

  console.log(`CASH rewards mainnet deployment — ${execute ? "EXECUTE" : "PLAN"}`);
  console.log(`manager ${rewardConfig.managerAddress}`);
  console.log("private key material will not be printed or passed on the command line");

  validatePackage();

  const aptos = createCashRewardsMainnetClient();
  let inspection = await inspectCashRewardsMainnet(aptos);
  if (!inspection.managerKey.present || !inspection.managerKey.matches) {
    throw new Error("the offline manager key does not control the configured manager address");
  }
  if (!inspection.issuerKey.present || !inspection.issuerKey.matches) {
    throw new Error("the offline issuer key does not match the configured public key");
  }
  if (inspection.published) {
    await assertPublishedBytecodeMatches(aptos);
  }
  if (inspection.contract.initialized) {
    assertContractMatches(inspection.contract);
  }

  console.log("\n[3/4] Current mainnet state");
  console.log(
    `manager APT       ${(Number(inspection.managerAccount.aptOctas) / 100_000_000).toFixed(8)}`,
  );
  console.log(`module published  ${inspection.published ? "yes" : "no"}`);
  console.log(
    `initialized       ${inspection.contract.initialized ? "yes" : "no"}`,
  );
  if (inspection.contract.initialized) {
    console.log(`claims paused     ${inspection.contract.paused ? "yes" : "no"}`);
  }

  const mutationsNeeded =
    !inspection.published || !inspection.contract.initialized;
  if (!execute) {
    console.log("\n[4/4] Read-only plan complete");
    if (!mutationsNeeded) {
      console.log("No publish or initialize transaction is needed.");
    } else if (inspection.managerAccount.aptOctas === 0n) {
      console.log(
        "Blocked only on gas: fund the public manager address with a small APT balance, then run the guarded execute command.",
      );
    } else {
      console.log("The manager is funded and the guarded execute command can finish deployment.");
    }
    console.log(
      `CASH_REWARDS_MAINNET_CONFIRM=${EXECUTION_CONFIRMATION} pnpm cash-rewards:mainnet -- --execute`,
    );
    return;
  }

  if (process.env.CASH_REWARDS_MAINNET_CONFIRM !== EXECUTION_CONFIRMATION) {
    throw new Error(
      `execution requires CASH_REWARDS_MAINNET_CONFIRM=${EXECUTION_CONFIRMATION}`,
    );
  }
  if (mutationsNeeded && inspection.managerAccount.aptOctas === 0n) {
    throw new Error(
      "manager has no APT for gas; no mainnet transaction was submitted",
    );
  }

  const managerPrivateKey = readCashRewardsPrivateKey(
    CASH_REWARDS_MANAGER_KEY_PATH,
  );
  assert.ok(managerPrivateKey, "manager key disappeared after validation");
  const manager = Account.fromPrivateKey({ privateKey: managerPrivateKey });
  const state = readDeploymentState();

  if (!inspection.published) {
    console.log("\nPublishing cash_rewards to Aptos mainnet…");
    const output = runAptos(
      [
        "move",
        "publish",
        "--package-dir",
        PACKAGE_DIR,
        "--named-addresses",
        `cash_rewards=${rewardConfig.managerAddress}`,
        "--included-artifacts",
        "sparse",
        "--private-key-file",
        CASH_REWARDS_MANAGER_KEY_PATH,
        "--url",
        MAINNET_URL,
        "--assume-yes",
      ],
      { print: false },
    );
    const publishTransaction = parseTransactionHash(output);
    if (!publishTransaction) {
      throw new Error(
        "Aptos CLI returned without a transaction hash; refusing to assume publication succeeded",
      );
    }
    const committed = await aptos.waitForTransaction({
      transactionHash: publishTransaction,
    });
    if (!committed.success) {
      throw new Error(
        `cash_rewards publication reverted: ${committed.vm_status} (${explorer(publishTransaction)})`,
      );
    }
    state.publishTransaction = publishTransaction;
    saveDeploymentState(state);
    console.log(`published ${explorer(publishTransaction)}`);

    inspection = await inspectCashRewardsMainnet(aptos);
    assert.equal(inspection.published, true, "module was not readable after publication");
    await assertPublishedBytecodeMatches(aptos);
  } else {
    console.log("\nPublication already matches this repository; skipping publish.");
  }

  if (!inspection.contract.initialized) {
    console.log("Initializing with claims paused…");
    const initializeTransaction = await initializeContract(aptos, manager);
    state.initializeTransaction = initializeTransaction;
    saveDeploymentState(state);
    console.log(`initialized ${explorer(initializeTransaction)}`);
  } else {
    console.log("Initialization already matches config; skipping initialize.");
  }

  inspection = await inspectCashRewardsMainnet(aptos);
  await assertPublishedBytecodeMatches(aptos);
  assertContractMatches(inspection.contract);
  assert.equal(
    inspection.contract.paused,
    true,
    "a newly deployed reward contract must remain paused until the CASH canary passes",
  );
  state.verifiedAt = new Date().toISOString();
  saveDeploymentState(state);

  console.log("\n[4/4] DEPLOYED AND VERIFIED");
  console.log("Claims remain paused. No CASH was funded and no reward claim was enabled.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CASH rewards mainnet deployment failed: ${message}`);
  process.exitCode = 1;
});
