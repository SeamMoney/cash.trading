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

export const CASH_REWARDS_MANAGER_KEY_PATH = ".cash-rewards/manager.key";
export const CASH_REWARDS_ISSUER_KEY_PATH = ".cash-rewards/issuer.key";
export const CASH_REWARDS_MODULE_NAME = "cash_rewards";
export const CASH_REWARDS_MODULE =
  `${rewardConfig.managerAddress}::${CASH_REWARDS_MODULE_NAME}`;

export type LocalKeyCheck = {
  present: boolean;
  matches: boolean;
};

export type CashRewardsContractCheck = {
  initialized: boolean;
  paused: boolean | null;
  issuerMatches: boolean | null;
  epochDurationMatches: boolean | null;
  epochCapMatches: boolean | null;
  walletCapMatches: boolean | null;
  vaultBalanceAtomic: string | null;
};

export type CashRewardsMainnetInspection = {
  managerKey: LocalKeyCheck;
  issuerKey: LocalKeyCheck;
  managerAccount: {
    exists: boolean;
    aptOctas: bigint;
  };
  published: boolean;
  contract: CashRewardsContractCheck;
};

export function normalizeCashRewardsHex(value: string) {
  return value.replace(/^0x/i, "").toLowerCase();
}

export function normalizeCashRewardsAddress(value: string) {
  return AccountAddress.fromString(value).toStringLong().toLowerCase();
}

function moveBytesToHex(value: unknown): string {
  if (typeof value === "string") return normalizeCashRewardsHex(value);
  if (!Array.isArray(value)) return "";
  return value
    .map((byte) => Number(byte).toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

export function readCashRewardsPrivateKey(
  path: string,
): Ed25519PrivateKey | null {
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

export function checkCashRewardsManagerKey(): LocalKeyCheck {
  const privateKey = readCashRewardsPrivateKey(
    CASH_REWARDS_MANAGER_KEY_PATH,
  );
  if (!privateKey) return { present: false, matches: false };
  const account = Account.fromPrivateKey({ privateKey });
  return {
    present: true,
    matches:
      normalizeCashRewardsAddress(account.accountAddress.toString()) ===
      normalizeCashRewardsAddress(rewardConfig.managerAddress),
  };
}

export function checkCashRewardsIssuerKey(): LocalKeyCheck {
  const privateKey = readCashRewardsPrivateKey(
    CASH_REWARDS_ISSUER_KEY_PATH,
  );
  if (!privateKey) return { present: false, matches: false };
  return {
    present: true,
    matches:
      normalizeCashRewardsHex(privateKey.publicKey().toString()) ===
      normalizeCashRewardsHex(rewardConfig.issuerPublicKey),
  };
}

export function createCashRewardsMainnetClient() {
  const apiKey = (
    process.env.APTOS_NODE_API_KEY || process.env.GEOMI_API_KEY
  )
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

async function readManagerAccount(aptos: Aptos) {
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
      moduleName: CASH_REWARDS_MODULE_NAME,
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function readContract(
  aptos: Aptos,
  published: boolean,
): Promise<CashRewardsContractCheck> {
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
        function:
          `${CASH_REWARDS_MODULE}::get_state` as `${string}::${string}::${string}`,
        typeArguments: [rewardConfig.cashCoinType],
        functionArguments: [],
      },
    })) as unknown[];
    if (state.length < 7) {
      throw new Error("cash_rewards::get_state returned an incomplete result");
    }
    return {
      initialized: true,
      issuerMatches:
        moveBytesToHex(state[1]) ===
        normalizeCashRewardsHex(rewardConfig.issuerPublicKey),
      paused: state[2] === true || state[2] === "true",
      epochDurationMatches:
        BigInt(String(state[3])) === BigInt(rewardConfig.epochDurationSeconds),
      epochCapMatches:
        BigInt(String(state[4])) ===
        BigInt(rewardConfig.maxEpochEmissionAtomic),
      walletCapMatches:
        BigInt(String(state[5])) ===
        BigInt(rewardConfig.maxWalletEpochAtomic),
      vaultBalanceAtomic: String(state[6]),
    };
  } catch (error) {
    // A published but uninitialized module aborts its get_state view. Transport
    // and fullnode failures still propagate instead of being mislabeled.
    if (error instanceof AptosApiError && error.status >= 400 && error.status < 500) {
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

export async function inspectCashRewardsMainnet(
  aptos = createCashRewardsMainnetClient(),
): Promise<CashRewardsMainnetInspection> {
  if (rewardConfig.network !== "mainnet") {
    throw new Error("config/cash-rewards.json is not configured for mainnet");
  }

  const managerKey = checkCashRewardsManagerKey();
  const issuerKey = checkCashRewardsIssuerKey();
  const managerAccount = await readManagerAccount(aptos);
  const published =
    managerAccount.exists && (await moduleIsPublished(aptos));
  const contract = await readContract(aptos, published);

  return {
    managerKey,
    issuerKey,
    managerAccount,
    published,
    contract,
  };
}

export function cashRewardsReadinessBlockers(
  inspection: CashRewardsMainnetInspection,
) {
  const { managerKey, issuerKey, managerAccount, published, contract } =
    inspection;
  const blockers: string[] = [];

  if (!managerKey.present) {
    blockers.push(
      `offline manager key is missing at ${CASH_REWARDS_MANAGER_KEY_PATH}`,
    );
  } else if (!managerKey.matches) {
    blockers.push(
      "offline manager key does not control the configured manager address",
    );
  }
  if (!issuerKey.present) {
    blockers.push(
      `issuer key is missing at ${CASH_REWARDS_ISSUER_KEY_PATH}`,
    );
  } else if (!issuerKey.matches) {
    blockers.push("issuer key does not match the configured public key");
  }
  if (!managerAccount.exists || managerAccount.aptOctas === 0n) {
    blockers.push(
      "manager address needs a small mainnet APT balance for publication and initialization gas",
    );
  }
  if (!published) {
    blockers.push("cash_rewards module is not published on mainnet");
  } else if (!contract.initialized) {
    blockers.push("cash_rewards module is published but not initialized");
  }
  if (contract.initialized) {
    if (!contract.issuerMatches) {
      blockers.push("on-chain issuer public key does not match config");
    }
    if (!contract.epochDurationMatches) {
      blockers.push("on-chain epoch duration does not match config");
    }
    if (!contract.epochCapMatches) {
      blockers.push("on-chain global epoch cap does not match config");
    }
    if (!contract.walletCapMatches) {
      blockers.push("on-chain wallet epoch cap does not match config");
    }
    if (contract.vaultBalanceAtomic === "0") {
      blockers.push("reward vault has no CASH canary funding");
    }
    if (contract.paused) {
      blockers.push("claims are paused pending a mainnet canary claim");
    }
  }

  return blockers;
}
