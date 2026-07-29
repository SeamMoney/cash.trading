/**
 * Self-test for lib/sealed-attestor.ts — the BCS layout and digest chain that
 * must agree byte-for-byte with `cash_strategy::sealed_vault`.
 *
 * A BCS mismatch between TS and Move is the classic way this kind of system
 * fails silently in production (every signature simply fails to verify, or
 * worse, a field is bound that shouldn't be). This file pins the layout, and
 * prints a fixture that `sealed_vault_tests.move` hardcodes so the same bytes
 * are verified inside the Move VM.
 *
 *   pnpm exec tsx scripts/sealed-attestor-selftest.ts
 */
import { Ed25519PrivateKey, Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";
import {
  ATTESTATION_DOMAIN,
  SIGNAL_BUY,
  SIGNAL_SELL,
  computeProgramCommitment,
  foldDigest,
  genesisDigest,
  serializeAttestation,
  signAttestation,
  toHex,
  verifyTraceReplay,
  type Signal,
} from "../lib/sealed-attestor";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

// Deterministic key so the printed fixture is stable across runs.
const PRIV_HEX = "0x" + "11".repeat(32);
const priv = new Ed25519PrivateKey(PRIV_HEX);
const pub = priv.publicKey() as Ed25519PublicKey;

const SV = "0x" + "cd".repeat(32);
const COMMITMENT = computeProgramCommitment({
  canonicalPine: '//@version=5\nstrategy("Fixture")\nf = ta.ema(close, 9)\n',
  emittedMove: "module 0xCAFE::indicator { }",
  manifestJson: '{"transpiler":"v3.1.0"}',
});
const CHAIN_ID = 2; // testnet

function verify(pubkey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  return new Ed25519PublicKey(pubkey).verifySignature({
    message: msg,
    signature: new Ed25519Signature(sig),
  });
}

function main() {
  console.log("\n1. digest chain");
  const g = genesisDigest();
  check("genesis digest is 32 bytes", g.length === 32, g.length);
  check(
    "genesis digest is sha3_256(domain)",
    toHex(g) === toHex(genesisDigest()) && ATTESTATION_DOMAIN === "cash.trading/sealed-vault/v1",
  );
  const d1 = foldDigest(g, 1000n, 7000000000000n);
  const d2 = foldDigest(d1, 1060n, 7010000000000n);
  check("fold produces 32 bytes", d1.length === 32 && d2.length === 32);
  check("fold is order-dependent", toHex(d1) !== toHex(d2));
  check(
    "fold is deterministic",
    toHex(foldDigest(g, 1000n, 7000000000000n)) === toHex(d1),
  );
  check(
    "different price → different digest",
    toHex(foldDigest(g, 1000n, 7000000000001n)) !== toHex(d1),
  );
  check(
    "different bar_ts → different digest",
    toHex(foldDigest(g, 1001n, 7000000000000n)) !== toHex(d1),
  );

  console.log("\n2. attestation serialization + signing");
  const att = {
    chainId: CHAIN_ID,
    strategyVault: SV,
    programCommitment: COMMITMENT,
    seq: 0n,
    inputDigest: g,
    signal: SIGNAL_BUY as Signal,
  };
  const msg = serializeAttestation(att);
  const sig = signAttestation(priv, att);
  check("signature verifies", verify(pub.toUint8Array(), msg, sig));
  check("signature is 64 bytes", sig.length === 64, sig.length);

  // Every field must be bound — flipping any one must invalidate the signature.
  const mut = <K extends keyof typeof att>(k: K, v: (typeof att)[K]) =>
    verify(pub.toUint8Array(), serializeAttestation({ ...att, [k]: v }), sig);
  check("signal is bound", !mut("signal", SIGNAL_SELL as Signal));
  check("seq is bound", !mut("seq", 1n));
  check("strategy_vault is bound", !mut("strategyVault", "0x" + "ab".repeat(32)));
  check("chain_id is bound", !mut("chainId", 1));
  check("input_digest is bound", !mut("inputDigest", d1));
  check(
    "program_commitment is bound",
    !mut("programCommitment", foldDigest(g, 7n, 7n)),
  );

  console.log("\n3. input validation");
  let threw = false;
  try {
    serializeAttestation({ ...att, programCommitment: new Uint8Array(31) });
  } catch {
    threw = true;
  }
  check("rejects a non-32-byte commitment", threw);
  threw = false;
  try {
    serializeAttestation({ ...att, inputDigest: new Uint8Array(33) });
  } catch {
    threw = true;
  }
  check("rejects a non-32-byte digest", threw);

  console.log("\n4. trace replay (delayed reveal)");
  // Build an honest 4-bar trace from a trivial "program": buy when price rises.
  const prices = [7000000000000n, 7010000000000n, 6990000000000n, 7020000000000n];
  const signalFor = (closes: bigint[]): Signal => {
    if (closes.length < 2) return 0;
    return closes[closes.length - 1] > closes[closes.length - 2] ? SIGNAL_BUY : SIGNAL_SELL;
  };

  let digest = genesisDigest();
  const closes: bigint[] = [];
  const trace = prices.map((price, i) => {
    const barTs = BigInt(1000 + i * 60);
    const signal = signalFor(closes);
    const s = signAttestation(priv, {
      chainId: CHAIN_ID,
      strategyVault: SV,
      programCommitment: COMMITMENT,
      seq: BigInt(i),
      inputDigest: digest,
      signal,
    });
    digest = foldDigest(digest, barTs, price);
    closes.push(price);
    return { barTs, price, signal, signature: s };
  });

  const honest = verifyTraceReplay({
    chainId: CHAIN_ID,
    strategyVault: SV,
    programCommitment: COMMITMENT,
    attestorPublicKey: pub.toUint8Array(),
    trace,
    signalFor,
    verifySignature: verify,
  });
  check("honest trace replays clean", honest.ok, honest.divergences);

  // Tamper: the attestor deviated from the committed program on bar 2.
  const tampered = trace.map((b, i) =>
    i === 2 ? { ...b, signal: (b.signal === SIGNAL_BUY ? SIGNAL_SELL : SIGNAL_BUY) as Signal } : b,
  );
  const caught = verifyTraceReplay({
    chainId: CHAIN_ID,
    strategyVault: SV,
    programCommitment: COMMITMENT,
    attestorPublicKey: pub.toUint8Array(),
    trace: tampered,
    signalFor,
    verifySignature: verify,
  });
  check("tampered signal is caught", !caught.ok && caught.divergences.some((d) => d.seq === 2));
  check(
    "tamper is attributable (signature no longer matches the signed signal)",
    caught.divergences.some((d) => d.reason.includes("signature")),
    caught.divergences,
  );

  console.log("\n5. Move test fixture (paste into sealed_vault_tests.move)");
  console.log(`    pubkey     = x"${toHex(pub.toUint8Array()).slice(2)}";`);
  console.log(`    commitment = x"${toHex(COMMITMENT).slice(2)}";`);
  console.log(`    digest     = x"${toHex(g).slice(2)}";`);
  console.log(`    signature  = x"${toHex(sig).slice(2)}";`);
  console.log(`    sv_addr    = @0x${SV.slice(2)};`);
  console.log(`    chain_id   = ${CHAIN_ID}; seq = 0; signal = ${SIGNAL_BUY};`);
  console.log(`    message    = x"${toHex(msg).slice(2)}";`);

  console.log(
    failures === 0 ? "\nAll sealed-attestor checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
