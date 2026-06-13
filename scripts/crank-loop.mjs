#!/usr/bin/env node
/**
 * Permissionless crank loop for trustless strategy vaults.
 *
 * Submits `strategy_vault::tick_oracle(sv_addr, ts)` for every configured
 * vault on an interval. The contract reads Decibel's mark price on-chain, so
 * this loop contributes only gas + a timestamp — it cannot influence trades.
 *
 * Designed for the fly.io worker box (see infra/fly/), replacing serverless
 * cron wake-ups with a reliable always-on cadence.
 *
 * Env:
 *   CRANK_KEY          ed25519 private key paying gas (testnet deployer)
 *   CRANK_PKG          strategy package (default: live 0x44bccd… deployment)
 *   CRANK_VAULTS       comma-separated sv addresses (default: live SMA 3/5 vault)
 *   CRANK_INTERVAL_S   seconds between sweeps (default 60)
 *   APTOS_NETWORK_URL  fullnode (default testnet)
 *   DRY_RUN=1          build but don't submit; one sweep then exit
 *
 * Run: node scripts/crank-loop.mjs
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";

const PKG = process.env.CRANK_PKG ?? "0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3";
const VAULTS = (process.env.CRANK_VAULTS ?? "0x97ac8825850adadfc1a6c0792e25ca08e46a5123ffe693615f26e74551c7bc69")
  .split(",").map((s) => s.trim()).filter(Boolean);
const INTERVAL_S = Number(process.env.CRANK_INTERVAL_S ?? 60);
const DRY_RUN = process.env.DRY_RUN === "1";

const keyRaw = (process.env.CRANK_KEY ?? "").trim();
if (!keyRaw && !DRY_RUN) {
  console.error("[crank] CRANK_KEY is required (testnet gas payer)");
  process.exit(1);
}

const aptos = new Aptos(new AptosConfig({
  network: Network.TESTNET,
  ...(process.env.APTOS_NETWORK_URL ? { fullnode: process.env.APTOS_NETWORK_URL } : {}),
}));
const signer = keyRaw
  ? Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(PrivateKey.formatPrivateKey(keyRaw, PrivateKeyVariants.Ed25519)),
    })
  : null;

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

let consecutiveFailures = 0;

async function crankOne(svAddr) {
  const ts = Math.floor(Date.now() / 1000);
  const transaction = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data: {
      function: `${PKG}::strategy_vault::tick_oracle`,
      functionArguments: [svAddr, String(ts)],
    },
  });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction });
  const result = await aptos.waitForTransaction({ transactionHash: pending.hash });
  const traded = (result.events ?? []).filter((e) => e.type.includes("VaultTraded"));
  return { hash: pending.hash, success: result.success, traded: traded.length };
}

async function sweep() {
  let ok = 0, failed = 0, trades = 0;
  for (const sv of VAULTS) {
    if (DRY_RUN) {
      console.log(`[crank] DRY RUN would crank ${sv.slice(0, 12)}…`);
      ok++;
      continue;
    }
    try {
      const r = await crankOne(sv);
      ok++;
      trades += r.traded;
      if (r.traded > 0) {
        console.log(`[crank] FLIP ${sv.slice(0, 12)}… tx=${r.hash.slice(0, 14)} traded=${r.traded}`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      // Paused vaults / non-flip aborts are expected operational states.
      console.error(`[crank] ${sv.slice(0, 12)}… failed: ${msg.slice(0, 160)}`);
    }
  }
  consecutiveFailures = failed === VAULTS.length && VAULTS.length > 0 ? consecutiveFailures + 1 : 0;
  console.log(`[crank] sweep ok=${ok} failed=${failed} flips=${trades}`);
}

console.log(`[crank] starting (vaults=${VAULTS.length}, interval=${INTERVAL_S}s, dryRun=${DRY_RUN})`);
for (;;) {
  await sweep();
  if (DRY_RUN || stopping) break;
  // Back off when everything is failing (fullnode outage / empty gas).
  const delay = INTERVAL_S * Math.min(2 ** consecutiveFailures, 16);
  await new Promise((r) => setTimeout(r, delay * 1000));
  if (stopping) break;
}
console.log("[crank] stopped");
