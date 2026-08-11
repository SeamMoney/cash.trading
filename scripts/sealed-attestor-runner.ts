/**
 * Sealed-vault attestor runner — the off-chain half of docs/SEALED-INDICATOR.md.
 *
 * Two modes:
 *
 *   simulate  Runs the ENTIRE flow with no chain writes and no deployed module.
 *             Pulls real prices, runs the committed program, signs each bar,
 *             and verifies every attestation exactly as sealed_vault.move would
 *             — including the digest chain and the seq monotonicity. Use this to
 *             see the system work before anything is published.
 *
 *   live      Reads the real on-chain attestation context, signs, and submits
 *             tick_attested. Requires a published module and a sealed vault.
 *
 * Usage:
 *   pnpm exec tsx scripts/sealed-attestor-runner.ts simulate --pine strategy.pine
 *   pnpm exec tsx scripts/sealed-attestor-runner.ts simulate --preset ema --bars 300
 *   pnpm exec tsx scripts/sealed-attestor-runner.ts live \
 *       --package 0x... --vault 0x... --pine strategy.pine
 *
 * Env (live mode):
 *   SEALED_ATTESTOR_PRIVATE_KEY   ed25519 signing key (no funds, no trading authority)
 *   SEALED_CRANK_PRIVATE_KEY      gas payer for tick_attested (any funded testnet key)
 */
import { readFileSync } from "node:fs";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  Ed25519Signature,
  Network,
} from "@aptos-labs/ts-sdk";

import { transpileV3, TRANSPILER_VERSION } from "../lib/launchpad/transpiler-v3";
import { SEALED_PRESETS, SEALED_PRESET_NAMES, buildManifest, canonicalizePine } from "../lib/sealed-presets";
import { createStrategyRunner } from "../lib/strategy-equivalence";
import { fetchPythCandles } from "../lib/launchpad/pyth";
import {
  buildTickAttestedPayload,
  computeProgramCommitment,
  foldDigest,
  genesisDigest,
  serializeAttestation,
  signAttestation,
  toHex,
  type Signal,
} from "../lib/sealed-attestor";


// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const mode = argv[2];
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1]?.startsWith("--") ? "true" : argv[++i];
      flags[key] = val ?? "true";
    }
  }
  return { mode, flags };
}

const SIGNAL_NAME = ["neutral", "buy", "sell"] as const;
const toTrit = (s: "buy" | "sell" | "neutral"): Signal =>
  s === "buy" ? 1 : s === "sell" ? 2 : 0;

/** 1e8-scaled integer price, matching the on-chain trace. */
const toChainPrice = (usd: number): bigint => BigInt(Math.round(usd * 1e8));

function loadPine(flags: Record<string, string>): string {
  const raw = flags.pine
    ? readFileSync(flags.pine, "utf8")
    : SEALED_PRESETS[flags.preset ?? "ema"];
  if (!raw) throw new Error(`unknown preset (have: ${SEALED_PRESET_NAMES.join(", ")})`);
  return canonicalizePine(raw);
}

/** Transpile + build the committed program. Refuses to proceed on any
 *  transpile error or unsupported op — the attestor must never sign a signal
 *  it cannot stand behind. */
function buildProgram(pine: string, marketAddr: string) {
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr });
  if (t.errors?.length) {
    console.error("\nTranspile failed — refusing to build a commitment:\n");
    for (const e of t.errors) console.error(`  • ${e}`);
    process.exit(1);
  }
  const runner = createStrategyRunner(t.ir);
  if (runner.unsupported.size > 0) {
    console.error(
      `\nStrategy uses ops the evaluator can't execute: ${[...runner.unsupported].join(", ")}`,
    );
    console.error("The attestor would be unable to reproduce its own signals. Refusing.\n");
    process.exit(1);
  }
  const manifest = buildManifest({
    transpilerVersion: TRANSPILER_VERSION,
    moduleName: t.moduleName,
    marketAddr,
  });
  const commitment = computeProgramCommitment({
    canonicalPine: pine,
    emittedMove: t.moveSource,
    manifestJson: manifest,
  });
  return { transpiled: t, runner, commitment, manifest };
}

// ─── Simulate ────────────────────────────────────────────────────────────────

async function simulate(flags: Record<string, string>) {
  const asset = flags.asset ?? "BTC/USD";
  const bars = Number(flags.bars ?? 300);
  const marketAddr = flags.market ?? "0x" + "ab".repeat(32);
  const svAddr = flags.vault ?? "0x" + "cd".repeat(32);
  const chainId = Number(flags["chain-id"] ?? 2);

  const pine = loadPine(flags);
  const { transpiled, runner, commitment } = buildProgram(pine, marketAddr);

  console.log("─".repeat(72));
  console.log("SEALED VAULT — SIMULATION (no chain writes, nothing published)");
  console.log("─".repeat(72));
  console.log(`strategy        ${transpiled.moduleName}`);
  console.log(`commitment      ${toHex(commitment)}`);
  console.log(`warmup bars     ${runner.warmupBars}`);
  console.log(`asset           ${asset}`);

  // Real prices. The point of simulate is that everything except the chain
  // write is real.
  const now = Math.floor(Date.now() / 1000);
  const from = now - bars * 60 * 2;
  const candles = await fetchPythCandles(asset, "1", from, now);
  const series = candles.slice(-bars);
  if (series.length < runner.warmupBars + 10) {
    console.error(`\nOnly ${series.length} bars fetched; need > ${runner.warmupBars + 10}.`);
    process.exit(1);
  }
  console.log(`bars            ${series.length} (real Pyth ${asset} 1m)\n`);

  const attestor = Account.generate();
  const attestorPub = (attestor.publicKey as Ed25519PublicKey).toUint8Array();
  const privKey = attestor.privateKey as Ed25519PrivateKey;
  console.log(`attestor pubkey ${toHex(attestorPub)}\n`);

  // Mirror of the on-chain state machine.
  let digest = genesisDigest();
  let seq = 0n;
  let lastSignal: Signal = 0;
  let inPosition = false;
  let isLong = false;
  let trades = 0;
  const trace: Array<{ barTs: bigint; price: bigint; signal: Signal; signature: Uint8Array }> = [];

  let verifiedBars = 0;
  const flips: string[] = [];

  for (const bar of series) {
    const price = toChainPrice(bar.close);
    const barTs = BigInt(bar.timestamp);

    // 1. Attestor computes the signal from the series through the PREVIOUS bar,
    //    signing against the digest the chain currently holds.
    const signal = toTrit(runner.pushBar(bar.close));
    const att = {
      chainId,
      strategyVault: svAddr,
      programCommitment: commitment,
      seq,
      inputDigest: digest,
      barTs,
      signal,
    };
    const signature = signAttestation(privKey, att);

    // 2. What sealed_vault::tick_attested does, step for step.
    const message = serializeAttestation(att);
    const ok = new Ed25519PublicKey(attestorPub).verifySignature({
      message,
      signature: new Ed25519Signature(signature),
    });
    if (!ok) {
      console.error(`bar ${seq}: SIGNATURE FAILED — this must never happen`);
      process.exit(1);
    }
    verifiedBars++;

    digest = foldDigest(digest, barTs, price);
    seq += 1n;
    trace.push({ barTs, price, signal, signature });

    const wantLong = signal === 1;
    // Mirrors sealed_vault::execute_flip — including the no-pyramiding guard.
    if (signal !== 0 && signal !== lastSignal && !(inPosition && isLong === wantLong)) {
      if (inPosition && isLong !== wantLong) {
        flips.push(
          `  seq ${String(seq).padStart(4)}  close ${isLong ? "LONG" : "SHORT"} @ ${bar.close.toFixed(2)}`,
        );
      }
      flips.push(
        `  seq ${String(seq).padStart(4)}  open  ${wantLong ? "LONG" : "SHORT"} @ ${bar.close.toFixed(2)}  [${SIGNAL_NAME[signal]}]`,
      );
      inPosition = true;
      isLong = wantLong;
      trades++;
    }
    lastSignal = signal;
  }

  console.log("TRADES THE VAULT WOULD HAVE PLACED");
  console.log(flips.length ? flips.join("\n") : "  (no signal flips over this window)");

  console.log("\nFINAL ON-CHAIN STATE (what the module would hold)");
  console.log(`  seq             ${seq}`);
  console.log(`  input_digest    ${toHex(digest)}`);
  console.log(`  trades          ${trades}`);
  console.log(`  in_position     ${inPosition} (${isLong ? "long" : "short"})`);

  // Independent verification — a third party replaying the public trace.
  console.log("\nINDEPENDENT VERIFICATION (replaying the public trace)");
  let replayDigest = genesisDigest();
  let replaySeq = 0n;
  let bad = 0;
  for (const b of trace) {
    const msg = serializeAttestation({
      chainId,
      strategyVault: svAddr,
      programCommitment: commitment,
      seq: replaySeq,
      inputDigest: replayDigest,
      barTs: b.barTs,
      signal: b.signal,
    });
    const good = new Ed25519PublicKey(attestorPub).verifySignature({
      message: msg,
      signature: new Ed25519Signature(b.signature),
    });
    if (!good) bad++;
    replayDigest = foldDigest(replayDigest, b.barTs, b.price);
    replaySeq += 1n;
  }
  console.log(`  bars verified   ${verifiedBars}`);
  console.log(`  replay digest   ${toHex(replayDigest)}`);
  console.log(`  digest matches  ${toHex(replayDigest) === toHex(digest) ? "YES" : "NO"}`);
  console.log(`  bad signatures  ${bad}`);

  // Tamper demonstration — the property that makes this worth building.
  console.log("\nTAMPER CHECK (attestor tries to flip one signal)");
  const victim = trace.findIndex((b) => b.signal !== 0);
  if (victim >= 0) {
    let d = genesisDigest();
    for (let i = 0; i < victim; i++) d = foldDigest(d, trace[i].barTs, trace[i].price);
    const forged = serializeAttestation({
      chainId,
      strategyVault: svAddr,
      programCommitment: commitment,
      seq: BigInt(victim),
      inputDigest: d,
      barTs: trace[victim].barTs,
      signal: (trace[victim].signal === 1 ? 2 : 1) as Signal,
    });
    const accepted = new Ed25519PublicKey(attestorPub).verifySignature({
      message: forged,
      signature: new Ed25519Signature(trace[victim].signature),
    });
    console.log(`  flipped bar     seq ${victim}`);
    console.log(`  chain accepts   ${accepted ? "YES — BROKEN" : "NO — rejected (E_INVALID_SIGNATURE)"}`);
    if (accepted) process.exit(1);
  }

  console.log("\nSimulation complete. Nothing was written to any chain.\n");
}

// ─── Live ────────────────────────────────────────────────────────────────────

async function live(flags: Record<string, string>) {
  const pkg = flags.package;
  const svAddr = flags.vault;
  if (!pkg || !svAddr) {
    console.error("live mode needs --package 0x... and --vault 0x...");
    process.exit(1);
  }
  const network = (flags.network ?? "testnet") as "testnet" | "mainnet";
  const intervalS = Number(flags.interval ?? 60);
  const once = flags.once === "true";

  const attestorKey = process.env.SEALED_ATTESTOR_PRIVATE_KEY;
  const crankKey = process.env.SEALED_CRANK_PRIVATE_KEY;
  if (!attestorKey) {
    console.error("SEALED_ATTESTOR_PRIVATE_KEY is not set.");
    process.exit(1);
  }
  if (!crankKey) {
    console.error("SEALED_CRANK_PRIVATE_KEY is not set (pays gas for tick_attested).");
    process.exit(1);
  }

  const aptos = new Aptos(
    new AptosConfig({ network: network === "mainnet" ? Network.MAINNET : Network.TESTNET }),
  );
  const attestorPriv = new Ed25519PrivateKey(attestorKey);
  const cranker = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(crankKey) });

  const chainId = await aptos.getChainId();
  const marketAddr = flags.market ?? "0x" + "ab".repeat(32);
  const pine = loadPine(flags);
  const { runner, commitment } = buildProgram(pine, marketAddr);

  // Verify the on-chain commitment matches the program we're about to run.
  const [onChainCommitment] = (await aptos.view({
    payload: {
      function: `${pkg}::sealed_vault::get_attestation_context`,
      functionArguments: [svAddr],
    },
  })) as [string, string, string, number, string];

  if (onChainCommitment.toLowerCase() !== toHex(commitment).toLowerCase()) {
    console.error("\nCOMMITMENT MISMATCH — refusing to sign.");
    console.error(`  on-chain  ${onChainCommitment}`);
    console.error(`  local     ${toHex(commitment)}`);
    console.error("The sealed vault was committed to a different program.\n");
    process.exit(1);
  }
  console.log(`commitment verified against chain: ${toHex(commitment)}`);

  // Warm the strategy up on history so the first live signal isn't garbage.
  const asset = flags.asset ?? "BTC/USD";
  const now = Math.floor(Date.now() / 1000);
  const warm = await fetchPythCandles(asset, "1", now - (runner.warmupBars + 50) * 120, now);
  for (const c of warm) runner.pushBar(c.close);
  console.log(`warmed up on ${warm.length} historical bars\n`);

  const tick = async () => {
    const ctx = (await aptos.view({
      payload: {
        function: `${pkg}::sealed_vault::get_attestation_context`,
        functionArguments: [svAddr],
      },
    })) as [string, string, string, number, string];
    const seq = BigInt(ctx[1]);
    const inputDigest = ctx[2];

    const latest = await fetchPythCandles(asset, "1", now - 600, Math.floor(Date.now() / 1000));
    const close = latest[latest.length - 1]?.close;
    if (!close) {
      console.error("no price available; skipping tick");
      return;
    }
    const signal = toTrit(runner.pushBar(close));
    const barTs = BigInt(Math.floor(Date.now() / 1000));

    const signature = signAttestation(attestorPriv, {
      chainId,
      strategyVault: svAddr,
      programCommitment: commitment,
      seq,
      inputDigest: hexToBytes(inputDigest),
      barTs,
      signal,
    });

    const payload = buildTickAttestedPayload({
      packageAddress: pkg,
      strategyVault: svAddr,
      barTs,
      signal,
      signature,
    });

    const txn = await aptos.transaction.build.simple({
      sender: cranker.accountAddress,
      data: payload,
    });
    const committed = await aptos.signAndSubmitTransaction({ signer: cranker, transaction: txn });
    await aptos.waitForTransaction({ transactionHash: committed.hash });
    console.log(
      `[${new Date().toISOString()}] seq=${seq} signal=${SIGNAL_NAME[signal]} px=${close.toFixed(2)} tx=${committed.hash}`,
    );
  };

  if (once) {
    await tick();
    return;
  }
  console.log(`cranking every ${intervalS}s — ctrl-c to stop\n`);
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, intervalS * 1000));
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { mode, flags } = parseArgs(process.argv);
  if (mode === "simulate") return simulate(flags);
  if (mode === "live") return live(flags);
  console.error(
    "usage:\n" +
      "  sealed-attestor-runner.ts simulate [--preset ema|rsi | --pine FILE] [--bars N] [--asset BTC/USD]\n" +
      "  sealed-attestor-runner.ts live --package 0x... --vault 0x... [--pine FILE] [--interval 60] [--once]\n",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
