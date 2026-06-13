#!/usr/bin/env node
/**
 * Permissionless crank loop for trustless strategy vaults.
 *
 * Each sweep cranks `<pkg>::<module>::tick_oracle(sv_addr, now)` for every
 * known vault. The contract reads Decibel's mark price on-chain, so this loop
 * contributes only gas + a timestamp — it cannot influence trades.
 *
 * Vault sources, merged + deduped per sweep:
 *   1. The legacy hand-written vault (CRANK_PKG / CRANK_VAULTS, module
 *      "strategy_vault").
 *   2. EVERY rail-deployed vault in the StrategyArtifact registry — rows with
 *      both strategyVaultAddr and packageAddress set, module "indicator"
 *      (rail packages bundle the strategy as `<pkg>::indicator`). This is what
 *      makes a vault anyone deploys start trading automatically.
 *
 * Designed for the fly.io worker box (see infra/fly/), replacing serverless
 * cron wake-ups with a reliable always-on cadence.
 *
 * Env:
 *   CRANK_KEY          ed25519 private key paying gas (testnet deployer)
 *   CRANK_PKG          legacy strategy package (default 0x44bccd…)
 *   CRANK_VAULTS       comma-separated legacy sv addresses (default live SMA 3/5)
 *   DATABASE_URL       Postgres — registry source for rail-deployed vaults
 *   CRANK_INTERVAL_S   seconds between sweeps (default 60)
 *   APTOS_NETWORK_URL  fullnode (default testnet)
 *   DRY_RUN=1          build but don't submit; one sweep then exit
 *
 * Run: node scripts/crank-loop.mjs
 */

import { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";

const LEGACY_PKG = process.env.CRANK_PKG ?? "0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3";
const LEGACY_VAULTS = (process.env.CRANK_VAULTS ?? "0x97ac8825850adadfc1a6c0792e25ca08e46a5123ffe693615f26e74551c7bc69")
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
let sweepCount = 0;

// ── Gas self-monitoring ──────────────────────────────────────────────────────
// The crank pays gas itself; if it drains, every tick fails silently. On
// testnet we top up from the faucet automatically so the worker is
// zero-maintenance. (Disabled on mainnet — there is no faucet; alert instead.)
const MIN_GAS_OCTAS = 20_000_000;        // 0.2 APT (~200 cranks)
const REFUEL_TARGET_OCTAS = 100_000_000; // top up toward 1 APT
const GAS_CHECK_EVERY = 30;              // sweeps (~30 min at 60s)
const IS_TESTNET = (process.env.APTOS_NETWORK_URL ?? "testnet").includes("testnet")
  || !process.env.APTOS_NETWORK_URL;

async function checkGas() {
  if (!signer) return;
  let bal = 0;
  try {
    bal = await aptos.getAccountAPTAmount({ accountAddress: signer.accountAddress });
  } catch {
    return; // transient; try again next check
  }
  console.log(`[crank] gas: ${(bal / 1e8).toFixed(4)} APT`);
  if (bal >= MIN_GAS_OCTAS) return;
  if (!IS_TESTNET) {
    console.error(`[crank] LOW GAS ${(bal / 1e8).toFixed(4)} APT and no faucet on mainnet — fund ${signer.accountAddress.toStringLong()}`);
    return;
  }
  try {
    await aptos.fundAccount({ accountAddress: signer.accountAddress, amount: REFUEL_TARGET_OCTAS });
    console.log(`[crank] refueled from testnet faucet`);
  } catch (err) {
    console.error(`[crank] faucet refuel failed: ${(err.message || err).slice(0, 120)}`);
  }
}

// ── Registry ───────────────────────────────────────────────────────────────
// One pooled pg client, lazily created. Registry failures never break the
// loop — we fall back to the legacy vault list.
let pgClient = null;
async function getRegistryVaults() {
  if (!process.env.DATABASE_URL) return [];
  try {
    if (!pgClient) {
      const { default: pg } = await import("pg");
      pgClient = new pg.Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      await pgClient.connect();
    }
    const { rows } = await pgClient.query(
      `SELECT "strategyVaultAddr", "packageAddress" FROM "StrategyArtifact"
       WHERE "strategyVaultAddr" IS NOT NULL AND "packageAddress" IS NOT NULL`,
    );
    return rows.map((r) => ({
      svAddr: r.strategyVaultAddr,
      pkg: r.packageAddress,
      module: "indicator",
    }));
  } catch (err) {
    console.error(`[crank] registry query failed (using legacy list): ${(err.message || err).slice(0, 120)}`);
    return [];
  }
}

function buildVaultList(registry) {
  const byKey = new Map();
  for (const sv of LEGACY_VAULTS) {
    byKey.set(`${LEGACY_PKG}:${sv}`, { svAddr: sv, pkg: LEGACY_PKG, module: "strategy_vault" });
  }
  for (const v of registry) {
    byKey.set(`${v.pkg}:${v.svAddr}`, v);
  }
  return [...byKey.values()];
}

async function crankOne(v) {
  const ts = Math.floor(Date.now() / 1000);
  const transaction = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data: {
      function: `${v.pkg}::${v.module}::tick_oracle`,
      functionArguments: [v.svAddr, String(ts)],
    },
  });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction });
  const result = await aptos.waitForTransaction({ transactionHash: pending.hash });
  const traded = (result.events ?? []).filter((e) => e.type.includes("VaultTraded"));
  return { hash: pending.hash, success: result.success, traded: traded.length };
}

async function sweep() {
  const vaults = buildVaultList(await getRegistryVaults());
  let ok = 0, failed = 0, trades = 0;
  for (const v of vaults) {
    if (DRY_RUN) {
      console.log(`[crank] DRY RUN would crank ${v.pkg.slice(0, 10)}…::${v.module} ${v.svAddr.slice(0, 12)}…`);
      ok++;
      continue;
    }
    try {
      const r = await crankOne(v);
      ok++;
      trades += r.traded;
      if (r.traded > 0) {
        console.log(`[crank] FLIP ${v.svAddr.slice(0, 12)}… (${v.module}) tx=${r.hash.slice(0, 14)} traded=${r.traded}`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      // Paused vaults / non-flip aborts are expected operational states.
      console.error(`[crank] ${v.svAddr.slice(0, 12)}… (${v.module}) failed: ${msg.slice(0, 160)}`);
    }
  }
  consecutiveFailures = failed === vaults.length && vaults.length > 0 ? consecutiveFailures + 1 : 0;
  console.log(`[crank] sweep vaults=${vaults.length} ok=${ok} failed=${failed} flips=${trades}`);
}

async function shutdown() {
  if (pgClient) await pgClient.end().catch(() => {});
}

console.log(`[crank] starting (legacy=${LEGACY_VAULTS.length}, registry=${process.env.DATABASE_URL ? "on" : "off"}, interval=${INTERVAL_S}s, dryRun=${DRY_RUN})`);
if (!DRY_RUN) await checkGas();
for (;;) {
  await sweep();
  if (DRY_RUN || stopping) break;
  if (++sweepCount % GAS_CHECK_EVERY === 0) await checkGas();
  // Back off when everything is failing (fullnode outage / empty gas).
  const delay = INTERVAL_S * Math.min(2 ** consecutiveFailures, 16);
  await new Promise((r) => setTimeout(r, delay * 1000));
  if (stopping) break;
}
await shutdown();
console.log("[crank] stopped");
