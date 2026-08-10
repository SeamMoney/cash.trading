import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import {
  Account,
  AccountAddress,
  Aptos,
  AptosApiError,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
  PrivateKey,
  PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";
import rewardConfig from "../config/cash-rewards.json";

const MANAGER_KEY_PATH = ".cash-rewards/manager.key";
const ISSUER_KEY_PATH = ".cash-rewards/issuer.key";
const MODULE_NAME = "cash_rewards";
const MODULE = `${rewardConfig.managerAddress}::${MODULE_NAME}`;
const OCTAS_PER_APT = 100_000_000;

type LocalKeyCheck = {
  present: boolean;
  matches: boolean;
};

type ContractCheck = {
  initialized: boolean;
  paused: boolean | null;
  issuerMatches: boolean | null;
  epochDurationMatches: boolean | null;
  epochCapMatches: boolean | null;
  walletCapMatches: boolean | null;
  vaultBalanceAtomic: string | null;
};

function normalizeHex(value: string) {
  return value.replace(/^0x/i, "").toLowerCase();
}

function normalizeAddress(value: string) {
  return AccountAddress.fromString(value).toStringLong().toLowerCase();
}

function moveBytesToHex(value: unknown): string {
  if (typeof value === "string") return normalizeHex(value);
  if (!Array.isArray(value)) return "";
  return value
    .map((byte) => Number(byte).toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function readPrivateKey(path: string): Ed25519PrivateKey | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8")
    .replace(/^ed25519-priv-/i, "")
    .replace(/\r?\n/g, "")
    .trim();
  return raw
    ? new Ed25519PrivateKey(
        PrivateKey.formatPrivateKey(raw, PrivateKeyVariants.Ed25519),
      )
    : null;
}

function checkManagerKey(): LocalKeyCheck {
  const privateKey = readPrivateKey(MANAGER_KEY_PATH);
  if (!privateKey) return { present: false, matches: false };
  const account = Account.fromPrivateKey({ privateKey });
  return {
    present: true,
    matches:
      normalizeAddress(account.accountAddress.toString()) ===
      normalizeAddress(rewardConfig.managerAddress),
  };
}

function checkIssuerKey(): LocalKeyCheck {
  const privateKey = readPrivateKey(ISSUER_KEY_PATH);
  if (!privateKey) return { present: false, matches: false };
  return {
    present: true,
    matches:
      normalizeHex(privateKey.publicKey().toString()) ===
      normalizeHex(rewardConfig.issuerPublicKey),
  };
}

function client() {
  const apiKey = (process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY)
    ?.replace(/\r?\n/g, "")
    .trim();
  return new Aptos(
    new AptosConfig({
      network: Network.MAINNET,
      clientConfig: apiKey ? { API_KEY: apiKey } : undefined,
    }),
  );
}

function isNotFound(error: unknown) {
  return error instanceof AptosApiError && error.status === 404;
}

async function readAccount(aptos: Aptos) {
  try {
    await aptos.getAccountInfo({ accountAddress: rewardConfig.managerAddress });
    const octas = await aptos.getAccountAPTAmount({
      accountAddress: rewardConfig.managerAddress,
    });
    return { exists: true, aptOctas: BigInt(octas) };
  } catch (error) {
    if (isNotFound(error)) return { exists: false, aptOctas: 0n };
    throw error;
  }
}

async function moduleIsPublished(aptos: Aptos) {
  try {
    await aptos.getAccountModule({
      accountAddress: rewardConfig.managerAddress,
      moduleName: MODULE_NAME,
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readContract(aptos: Aptos, published: boolean): Promise<ContractCheck> {
  if (!published) {
    return {
      initialized: false,
      paused: null,
      issuerMatches: null,
      epochDurationMatches: null,
      epochCapMatches: null,
      walletCapMatches: null,
      vaultBalanceAtomic: null,
    };
  }

  try {
    const state = (await aptos.view({
      payload: {
        function: `${MODULE}::get_state` as `${string}::${string}::${string}`,
        typeArguments: [rewardConfig.cashCoinType],
        functionArguments: [],
      },
    })) as unknown[];
    if (state.length < 7) throw new Error("get_state returned an incomplete result");
    return {
      initialized: true,
      issuerMatches:
        moveBytesToHex(state[1]) === normalizeHex(rewardConfig.issuerPublicKey),
      paused: state[2] === true || state[2] === "true",
      epochDurationMatches:
        BigInt(String(state[3])) === BigInt(rewardConfig.epochDurationSeconds),
      epochCapMatches:
        BigInt(String(state[4])) === BigInt(rewardConfig.maxEpochEmissionAtomic),
      walletCapMatches:
        BigInt(String(state[5])) === BigInt(rewardConfig.maxWalletEpochAtomic),
      vaultBalanceAtomic: String(state[6]),
    };
  } catch (error) {
    if (error instanceof AptosApiError && error.status < 500) {
      return {
        initialized: false,
        paused: null,
        issuerMatches: null,
        epochDurationMatches: null,
        epochCapMatches: null,
        walletCapMatches: null,
        vaultBalanceAtomic: null,
      };
    }
    throw error;
  }
}

function status(value: boolean) {
  return value ? "ok" : "missing";
}

async function main() {
  if (rewardConfig.network !== "mainnet") {
    throw new Error("config/cash-rewards.json is not configured for mainnet");
  }

  const aptos = client();
  const managerKey = checkManagerKey();
  const issuerKey = checkIssuerKey();
  const managerAccount = await readAccount(aptos);
  const published = managerAccount.exists && (await moduleIsPublished(aptos));
  const contract = await readContract(aptos, published);
  const blockers: string[] = [];

  if (!managerKey.present) blockers.push(`offline manager key is missing at ${MANAGER_KEY_PATH}`);
  else if (!managerKey.matches) blockers.push("offline manager key does not control the configured manager address");
  if (!issuerKey.present) blockers.push(`issuer key is missing at ${ISSUER_KEY_PATH}`);
  else if (!issuerKey.matches) blockers.push("issuer key does not match the configured public key");
  if (!managerAccount.exists || managerAccount.aptOctas === 0n) {
    blockers.push("manager address needs a small mainnet APT balance for publication and initialization gas");
  }
  if (!published) blockers.push("cash_rewards module is not published on mainnet");
  else if (!contract.initialized) blockers.push("cash_rewards module is published but not initialized");
  if (contract.initialized) {
    if (!contract.issuerMatches) blockers.push("on-chain issuer public key does not match config");
    if (!contract.epochDurationMatches) blockers.push("on-chain epoch duration does not match config");
    if (!contract.epochCapMatches) blockers.push("on-chain global epoch cap does not match config");
    if (!contract.walletCapMatches) blockers.push("on-chain wallet epoch cap does not match config");
    if (contract.vaultBalanceAtomic === "0") blockers.push("reward vault has no CASH canary funding");
    if (contract.paused) blockers.push("claims are paused pending a mainnet canary claim");
  }

  console.log("CASH rewards mainnet readiness\n");
  console.log(`manager key        ${status(managerKey.present && managerKey.matches)}`);
  console.log(`issuer key         ${status(issuerKey.present && issuerKey.matches)}`);
  console.log(`manager account    ${managerAccount.exists ? "exists" : "not created"}`);
  console.log(`manager APT        ${(Number(managerAccount.aptOctas) / OCTAS_PER_APT).toFixed(8)}`);
  console.log(`module published   ${published ? "yes" : "no"}`);
  console.log(`contract initialized ${contract.initialized ? "yes" : "no"}`);
  if (contract.initialized) {
    console.log(`claims paused      ${contract.paused ? "yes" : "no"}`);
    console.log(`issuer matches     ${contract.issuerMatches ? "yes" : "no"}`);
    console.log(`epoch config       ${
      contract.epochDurationMatches && contract.epochCapMatches && contract.walletCapMatches
        ? "matches"
        : "mismatch"
    }`);
    console.log(`vault CASH atomic  ${contract.vaultBalanceAtomic}`);
  }

  if (blockers.length === 0) {
    console.log("\nREADY: all local and on-chain launch checks passed.");
    return;
  }

  console.log("\nBLOCKED:");
  blockers.forEach((blocker, index) => console.log(`${index + 1}. ${blocker}`));
  process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CASH rewards readiness check failed: ${message}`);
  process.exitCode = 1;
});
