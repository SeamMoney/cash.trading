/**
 * Sealed-vault launch — every step needed to get one running on testnet.
 *
 * Steps, in order:
 *
 *   commit    Transpile the Pine and print the program commitment. No chain access.
 *   publish   aptos move compile + test + publish (needs the aptos CLI + a funded key).
 *   create    create_sealed_vault → prints the strategy-vault object address R. The vault is
 *             SEALED by this call: the commitment and every rule are frozen at birth, and
 *             there is no second seal step to forget.
 *   delegate  Prints the Decibel payload the VAULT ADMIN must sign to delegate to R. Until
 *             this lands the vault cannot place an order.
 *   status    Reads the on-chain state back.
 *
 * Usage:
 *   pnpm exec tsx scripts/sealed-vault-launch.ts commit  --preset ema
 *   pnpm exec tsx scripts/sealed-vault-launch.ts publish --deployer 0x...
 *   pnpm exec tsx scripts/sealed-vault-launch.ts create  --package 0x... --decibel-vault 0x... --market 0x...
 *   pnpm exec tsx scripts/sealed-vault-launch.ts status  --package 0x... --vault 0x...
 *
 * Env:
 *   SEALED_DEPLOYER_PRIVATE_KEY   publishes the module and creates vaults
 *   SEALED_ATTESTOR_PUBLIC_KEY    ed25519 pubkey the vault commits to (0x + 64 hex)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";

import { transpileV3, TRANSPILER_VERSION } from "../lib/launchpad/transpiler-v3";
import { SEALED_PRESETS, SEALED_PRESET_NAMES, buildManifest, canonicalizePine } from "../lib/sealed-presets";
import { createStrategyRunner } from "../lib/strategy-equivalence";
import { computeProgramCommitment, toHex } from "../lib/sealed-attestor";
import { SEALED_MARKETS_BY_NETWORK } from "../lib/sealed-vaults";

const PKG_DIR = resolve(__dirname, "../contracts/strategy-vaults");


/** Testnet BTC/USD engine params. Replace per market — these are NOT universal. */
/**
 * Market engine params come from the audited table in lib/sealed-vaults.ts, never from
 * constants here. This file previously carried lot=10 / min=100000 / szDec=8 — the OLD
 * testnet package's values. Every order built from them would have aborted on lot mismatch.
 */
function marketParams(flags: Record<string, string>) {
  const network = flags.network === "mainnet" ? "mainnet" : "testnet";
  const byName = flags.market
    ? SEALED_MARKETS_BY_NETWORK[network].find(
        (m) => m.addr.toLowerCase() === flags.market.toLowerCase() || m.name === flags.market,
      )
    : undefined;
  const m = byName ?? SEALED_MARKETS_BY_NETWORK[network][0];
  if (!m) throw new Error(`no sealed market configured for ${network}`);
  return m;
}

function parseArgs(argv: string[]) {
  const step = argv[2];
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1]?.startsWith("--") ? "true" : argv[++i];
      flags[key] = val ?? "true";
    }
  }
  return { step, flags };
}

function loadPine(flags: Record<string, string>): string {
  const raw = flags.pine
    ? readFileSync(flags.pine, "utf8")
    : SEALED_PRESETS[flags.preset ?? "ema"];
  if (!raw) throw new Error(`unknown preset (have: ${SEALED_PRESET_NAMES.join(", ")})`);
  return canonicalizePine(raw);
}

function commitmentFor(flags: Record<string, string>) {
  const marketAddr = flags.market ?? "0x" + "ab".repeat(32);
  const pine = loadPine(flags);
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr });
  if (t.errors?.length) {
    console.error("\nTranspile failed — no commitment can be made:\n");
    for (const e of t.errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  const runner = createStrategyRunner(t.ir);
  if (runner.unsupported.size > 0) {
    console.error(`\nUnsupported ops: ${[...runner.unsupported].join(", ")} — refusing.\n`);
    process.exit(1);
  }
  const manifestJson = buildManifest({
    transpilerVersion: TRANSPILER_VERSION,
    moduleName: t.moduleName,
    marketAddr,
  });
  const commitment = computeProgramCommitment({
    canonicalPine: pine,
    emittedMove: t.moveSource,
    manifestJson,
  });
  return { pine, transpiled: t, commitment, manifestJson, marketAddr };
}

function aptosClient(flags: Record<string, string>) {
  const net = (flags.network ?? "testnet") === "mainnet" ? Network.MAINNET : Network.TESTNET;
  return new Aptos(new AptosConfig({ network: net }));
}

function deployerAccount(): Account {
  const key = process.env.SEALED_DEPLOYER_PRIVATE_KEY;
  if (!key) {
    console.error("SEALED_DEPLOYER_PRIVATE_KEY is not set.");
    process.exit(1);
  }
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(key) });
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function stepCommit(flags: Record<string, string>) {
  const { transpiled, commitment, manifestJson } = commitmentFor(flags);
  console.log("\nPROGRAM COMMITMENT");
  console.log(`  strategy    ${transpiled.moduleName}`);
  console.log(`  manifest    ${manifestJson}`);
  console.log(`  commitment  ${toHex(commitment)}`);
  console.log(`  warmup      ${transpiled.ir.warmupMinBars} bars`);
  console.log("\nThe Pine source never leaves your machine. Only this hash goes on chain.\n");
}

function stepPublish(flags: Record<string, string>) {
  const deployer = flags.deployer ?? deployerAccount().accountAddress.toString();
  const named = `cash_strategy=${deployer}`;
  const url = flags.url ?? "https://api.testnet.aptoslabs.com/v1";

  const run = (args: string[]) => {
    console.log(`\n$ aptos ${args.join(" ")}`);
    try {
      const out = execFileSync("aptos", args, { cwd: PKG_DIR, encoding: "utf8" });
      // The CLI exits 0 on failure with {"Error": ...} on stdout under non-TTY.
      if (out.includes('"Error"')) {
        console.error(out.slice(-3000));
        process.exit(1);
      }
      console.log(out.slice(-2000));
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      console.error(e.stdout ?? e.stderr ?? e.message);
      process.exit(1);
    }
  };

  run(["move", "compile", "--named-addresses", named]);
  run(["move", "test", "--named-addresses", named]);
  run(["move", "publish", "--named-addresses", named, "--url", url, "--assume-yes"]);
  console.log(`\nPublished. Package address = ${deployer}\n`);
}

async function stepCreate(flags: Record<string, string>) {
  const pkg = flags.package;
  const decibelVault = flags["decibel-vault"];
  const market = flags.market;
  if (!pkg || !decibelVault || !market) {
    console.error("create needs --package, --decibel-vault and --market");
    process.exit(1);
  }
  const attestorPub = process.env.SEALED_ATTESTOR_PUBLIC_KEY;
  if (!attestorPub) {
    console.error("SEALED_ATTESTOR_PUBLIC_KEY is not set (0x + 64 hex).");
    process.exit(1);
  }
  const { commitment } = commitmentFor(flags);
  const aptos = aptosClient(flags);
  const deployer = deployerAccount();

  const pctBps = Number(flags["pct-bps"] ?? 1000); // 10% of NAV per order
  const maxLev = Number(flags["max-leverage-x100"] ?? 200); // 2x
  const minBar = Number(flags["min-bar-interval"] ?? 30);
  const traceCap = Number(flags["trace-capacity"] ?? 500);
  const slippageBps = Number(flags["slippage-bps"] ?? 30);
  const measurement = flags["enclave-measurement"] ?? "0x";
  const mp = marketParams(flags);

  const txn = await aptos.transaction.build.simple({
    sender: deployer.accountAddress,
    data: {
      function: `${pkg}::sealed_vault::create_sealed_vault`,
      functionArguments: [
        toHex(commitment),
        attestorPub,
        decibelVault,
        market,
        mp.sizeDecimalsPow,
        mp.lotSize,
        mp.minSize,
        mp.tickerSize,
        pctBps,
        maxLev,
        minBar,
        slippageBps,
        traceCap,
        measurement,
      ],
    },
  });
  const res = await aptos.signAndSubmitTransaction({ signer: deployer, transaction: txn });
  const committed = await aptos.waitForTransaction({ transactionHash: res.hash });

  // The object address is emitted in SealedVaultCreated.
  let sv: string | undefined;
  for (const ev of (committed as { events?: Array<{ type: string; data: Record<string, string> }> }).events ?? []) {
    if (ev.type.endsWith("::sealed_vault::SealedVaultCreated")) sv = ev.data.strategy_vault;
  }
  console.log(`\ntx           ${res.hash}`);
  console.log(`commitment   ${toHex(commitment)}`);
  console.log(`STRATEGY VAULT (delegate to this address): ${sv ?? "(not found in events)"}\n`);
  if (sv) printDelegateInstructions(decibelVault, sv);
}

function printDelegateInstructions(decibelVault: string, sv: string) {
  console.log("The vault is SEALED already — create_sealed_vault freezes it at birth.");
  console.log("It cannot trade until the Decibel vault ADMIN signs this (not the deployer):");
  console.log(`  function: <decibel_pkg>::vault_admin_api::delegate_dex_actions_to`);
  console.log(`  args:     vault=${decibelVault}, to=${sv}, expiry=<unix_secs>`);
  console.log("  Always pass an expiry — an unbounded grant can never be revoked.\n");
}

async function stepStatus(flags: Record<string, string>) {
  const pkg = flags.package;
  const sv = flags.vault;
  if (!pkg || !sv) {
    console.error("status needs --package and --vault");
    process.exit(1);
  }
  const aptos = aptosClient(flags);
  const state = await aptos.view({
    payload: { function: `${pkg}::sealed_vault::get_sealed_state`, functionArguments: [sv] },
  });
  const ctx = await aptos.view({
    payload: { function: `${pkg}::sealed_vault::get_attestation_context`, functionArguments: [sv] },
  });
  const [creator, decibelVault, commitment, attestorPub, measurement, pctBps, maxLev, minBar,
    inPosition, isLong, paused, sealed, trades, seq] = state as unknown[];
  console.log("\nSEALED VAULT STATE");
  console.log(`  creator          ${creator}`);
  console.log(`  decibel vault    ${decibelVault}`);
  console.log(`  commitment       ${commitment}`);
  console.log(`  attestor pubkey  ${attestorPub}`);
  console.log(`  enclave meas.    ${measurement || "(none — tier 1)"}`);
  console.log(`  sizing           ${pctBps} bps of NAV, max ${Number(maxLev) / 100}x`);
  console.log(`  min bar interval ${minBar}s`);
  console.log(`  sealed           ${sealed}`);
  console.log(`  paused           ${paused}`);
  console.log(`  position         ${inPosition ? (isLong ? "LONG" : "SHORT") : "flat"}`);
  console.log(`  trades / seq     ${trades} / ${seq}`);
  console.log(`  input digest     ${(ctx as string[])[2]}\n`);
}

async function main() {
  const { step, flags } = parseArgs(process.argv);
  switch (step) {
    case "commit": return stepCommit(flags);
    case "publish": return stepPublish(flags);
    case "create": return stepCreate(flags);
    case "status": return stepStatus(flags);
    case "delegate": {
      const dv = flags["decibel-vault"];
      const sv = flags.vault;
      if (!dv || !sv) { console.error("delegate needs --decibel-vault and --vault"); process.exit(1); }
      return printDelegateInstructions(dv, sv);
    }
    default:
      console.error(
        "steps: commit | publish | create | delegate | status\n" +
          "see the header of this file for full usage.",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
