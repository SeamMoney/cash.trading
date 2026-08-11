/**
 * Adversarial test of the swap notice period, on testnet.
 *
 * The scenario the gate exists to stop: a creator builds a record with strategy A, outside
 * money arrives, and they swap to strategy B instantly. Each case below is run against the
 * live contract — none of it is simulated.
 */
import { readFileSync } from "node:fs";
import {
  Account, Aptos, AptosConfig, Ed25519PrivateKey, Network, PrivateKey, PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";
import { transpileV3, TRANSPILER_VERSION } from "../lib/launchpad/transpiler-v3";
import { SEALED_PRESETS, buildManifest, canonicalizePine } from "../lib/sealed-presets";
import {
  computeProgramCommitment, fromHex, signAttestation, toHex, type Signal,
} from "../lib/sealed-attestor";
import { SEALED_MARKETS_BY_NETWORK } from "../lib/sealed-vaults";

const PKG = "0xacc35ae1a8a692d2070e0f6f4b7e0969752789300e055f6973f0ec8287f1740c";
const DECIBEL = "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f";
const USDC = "0x5428acf5c112826d0c74ae1cd2de9030f53d1d01235e6c2621d967bf914ee1c8";
const VAULT = "0x9d38c0b64b59d496ebc1e9e56f213775ec5bfd4186307b83dda9194e26cf5d71";
const OLD_SV = "0xfcfd1a8621340dff8f3d4d9bae55ec78d55dc174661cc79a2d7ecb1721ea65d6";
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

const key = (f: string) => new Ed25519PrivateKey(PrivateKey.formatPrivateKey(readFileSync(f, "utf8").trim(), PrivateKeyVariants.Ed25519));
const creator = Account.fromPrivateKey({ privateKey: key(".sealed-e2e-testnet/deployer.key") });
const attestor = Account.fromPrivateKey({ privateKey: key(".sealed-e2e-testnet/attestor.key") });

async function send(signer: Account, fn: string, args: unknown[]) {
  const txn = await aptos.transaction.build.simple({ sender: signer.accountAddress,
    data: { function: fn as `${string}::${string}::${string}`, typeArguments: [], functionArguments: args as never } });
  const p = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
  const d = await aptos.waitForTransaction({ transactionHash: p.hash, options: { checkSuccess: false } });
  return { ok: d.success, status: d.vm_status ?? "", d };
}
const view = async (fn: string, args: unknown[]) =>
  aptos.view({ payload: { function: fn as `${string}::${string}::${string}`, functionArguments: args as never } });

/** Build a valid attestation for a strategy and submit a tick. */
async function tick(sv: string, signal: Signal) {
  const [commitment, seq, digest] = (await view(
    `${PKG}::sealed_vault::get_attestation_context`, [sv],
  )) as [string, string, string];
  const barTs = BigInt(Math.floor(Date.now() / 1000));
  const sig = signAttestation(attestor.privateKey, {
    chainId: 2,
    strategyVault: sv,
    programCommitment: fromHex(commitment),
    seq: BigInt(seq),
    inputDigest: fromHex(digest),
    barTs,
    signal,
  });
  return send(creator, `${PKG}::sealed_vault::tick_attested`, [
    sv, String(barTs), signal, Array.from(sig),
  ]);
}

async function newStrategy(preset: "ema" | "rsi") {
  const m = SEALED_MARKETS_BY_NETWORK.testnet[0];
  const pine = canonicalizePine(SEALED_PRESETS[preset]);
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr: m.addr });
  const manifestJson = buildManifest({ transpilerVersion: TRANSPILER_VERSION, moduleName: t.moduleName, marketAddr: m.addr });
  const commitment = toHex(computeProgramCommitment({ canonicalPine: pine, emittedMove: t.moveSource, manifestJson }));
  const r = await send(creator, `${PKG}::sealed_vault::create_sealed_vault`, [
    fromHex(commitment), fromHex("0x15280777bb6e97a0651b71c360db5db196434adcba77da2f712b27a8654e33f0"),
    VAULT, m.addr, m.sizeDecimalsPow, m.lotSize, m.minSize, m.tickerSize,
    "1000", "200", "30", "30", "500", new Uint8Array(),
  ]);
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
  for (const e of (r.d as unknown as { events: Array<{ type: string; data: Record<string,string> }> }).events)
    if (e.type.endsWith("::sealed_vault::SealedVaultCreated")) return e.data.strategy_vault;
  throw new Error("no create event");
}

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) fails++;
};

async function main() {
  console.log("\n1. Swap while the creator is ALONE in the vault (no outside money)");
  const swapA = await newStrategy("rsi");
  const st1 = await view(`${PKG}::sealed_vault::swap_status`, [swapA]) as [boolean, string, string, string, boolean];
  check("is flagged as a swap", st1[0] === true);
  check("needs NO notice while nobody else is in", st1[4] === false);
  await send(creator, `${DECIBEL}::vault_admin_api::revoke_dex_actions_delegation`, [VAULT, [OLD_SV]]);
  await send(creator, `${DECIBEL}::vault_admin_api::delegate_dex_actions_to`, [VAULT, swapA, String(Math.floor(Date.now()/1000)+31536000)]);
  const t1 = await tick(swapA, 0);
  check("trades immediately", t1.ok, t1.status.slice(0, 80));

  console.log("\n2. An OUTSIDE depositor joins, then the creator tries to swap");
  const outsider = Account.generate();
  await send(creator, "0x1::aptos_account::transfer", [outsider.accountAddress.toStringLong(), "500000000"]);
  await send(outsider, `${DECIBEL}::usdc::restricted_mint`, ["200000000"]);
  const oSub = (await view(`${DECIBEL}::dex_accounts::primary_subaccount`, [outsider.accountAddress.toStringLong()])) as [string];
  await send(outsider, `${DECIBEL}::dex_accounts_entry::deposit_to_subaccount_at`, [oSub[0], USDC, "150000000"]);
  const dep = await send(outsider, `${DECIBEL}::dex_accounts_entry::contribute_to_vault`, [oSub[0], VAULT, USDC, "100000000"]);
  check("outside deposit landed", dep.ok, dep.status.slice(0, 90));

  const swapB = await newStrategy("ema");
  const st2 = await view(`${PKG}::sealed_vault::swap_status`, [swapB]) as [boolean, string, string, string, boolean];
  check("now REQUIRES notice", st2[4] === true);
  check("no announcement yet", st2[1] === "0");

  await send(creator, `${DECIBEL}::vault_admin_api::revoke_dex_actions_delegation`, [VAULT, [swapA]]);
  await send(creator, `${DECIBEL}::vault_admin_api::delegate_dex_actions_to`, [VAULT, swapB, String(Math.floor(Date.now()/1000)+31536000)]);
  const t2 = await tick(swapB, 1);
  check("BLOCKED even though fully delegated", !t2.ok && /19|E_SWAP_NOT_ANNOUNCED/.test(t2.status), t2.status.slice(0, 90));

  console.log("\n3. Creator announces, then tries to trade before the notice elapses");
  const ann = await send(creator, `${PKG}::sealed_vault::announce_swap`, [swapB]);
  check("announcement lands", ann.ok, ann.status.slice(0, 80));
  const st3 = await view(`${PKG}::sealed_vault::swap_status`, [swapB]) as [boolean, string, string, string, boolean];
  const wait = Number(st3[2]) - Math.floor(Date.now() / 1000);
  check("tradable_at is ~24h out", wait > 86_000 && wait <= 86_400, `${Math.round(wait / 3600)}h`);
  const t3 = await tick(swapB, 1);
  check("STILL blocked during the notice window", !t3.ok && /20|E_SWAP_NOT_MATURED/.test(t3.status), t3.status.slice(0, 90));

  console.log("\n4. The original strategy is unaffected");
  const st4 = await view(`${PKG}::sealed_vault::swap_status`, [OLD_SV]) as [boolean, string, string, string, boolean];
  check("first strategy is not a swap", st4[0] === false);
  check("first strategy never needs notice", st4[4] === false);

  console.log(fails === 0 ? "\nAll swap-notice invariants hold.\n" : `\n${fails} FAILED\n`);
  process.exit(fails === 0 ? 0 : 1);
}
void main();
