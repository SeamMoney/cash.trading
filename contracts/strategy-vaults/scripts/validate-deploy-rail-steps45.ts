import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey, AccountAddress, createResourceAddress, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import { buildDelegateDecibelVaultPayload } from "../../../lib/decibel-vaults";
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync(new URL("../../../.env", import.meta.url),"utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")), l.slice(l.indexOf("=")+1).trim()]));
const PKG = "0x6718ff4f11622e19de8aee68607c6a0b2ff7e4a8a40b38c393d15e931abbef62";
const MODULE = "ema_cross_9_21";
const VAULT = "0x89394320d351ec94dd47a14e3a60865242b504ed6001e5836f8d0fba0f95ec6e";
const MARKET = "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a";

const config = new AptosConfig({ network: Network.TESTNET, clientConfig: env.GEOMI_API_KEY_TESTNET ? { API_KEY: env.GEOMI_API_KEY_TESTNET } : undefined });
const aptos = new Aptos(config);
const key = PrivateKey.formatPrivateKey(env.EXPOSED_TESTNET_KEY, PrivateKeyVariants.Ed25519);
const signer = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(key) });
console.log("signer:", signer.accountAddress.toString().slice(0, 12) + "…");

const indicatorAddr = createResourceAddress(AccountAddress.from(PKG), MODULE).toString();
console.log("derived indicator:", indicatorAddr);

async function submit(label: string, data: any) {
  const txn = await aptos.transaction.build.simple({ sender: signer.accountAddress, data });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
  const committed = await aptos.waitForTransaction({ transactionHash: pending.hash });
  console.log(`${label}: success=${(committed as any).success} vm_status="${(committed as any).vm_status}" tx=${pending.hash.slice(0,20)}…`);
  return committed as any;
}

async function main() {
// Step 4 — the exact entry the UI signs
const bindTx = await submit("create_strategy_vault", {
  function: `${PKG}::indicator::create_strategy_vault`,
  typeArguments: [],
  functionArguments: [indicatorAddr, VAULT, MARKET, "100000"],
});
const binding = (bindTx.changes ?? []).find((c: any) => c.data?.type?.endsWith("::indicator::StrategyVault"))?.address;
console.log("binding (StrategyVault):", binding);
if (!binding) throw new Error("no StrategyVault in writeset");

// Step 5 — via the SAME builder the UI uses
const { payload } = buildDelegateDecibelVaultPayload({ vaultAddress: VAULT, delegate: binding, network: "testnet" });
console.log("delegate payload fn:", payload.function, "| args:", JSON.stringify(payload.functionArguments));
await submit("delegate_dex_actions_to", {
  function: payload.function,
  typeArguments: payload.typeArguments,
  functionArguments: payload.functionArguments,
});
console.log("STEPS 4-5 VALIDATED on-chain");
}
main().catch(e => { console.error("FAILED:", e?.message ?? e); process.exit(1); });

/*
 * Repro: pnpm exec tsx contracts/strategy-vaults/scripts/validate-deploy-rail-steps45.ts
 * Validates the EXACT transactions the deploy-rail UI signs for steps 4-5
 * (create_strategy_vault + delegate_dex_actions_to via the UI payload builder)
 * against a UI-published package, using the funded testnet deployer key.
 * Last validated 2026-06-12: binding 0x9c69f257e151…, delegate tx 0xca576f31aa3a….
 */
