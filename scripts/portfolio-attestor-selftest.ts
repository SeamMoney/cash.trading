/**
 * Cross-language checks for the portfolio attestor.
 *
 *   pnpm test:portfolio
 *
 * The layout of `PortfolioAttestation` and `Action` has to agree byte-for-byte between
 * TypeScript and Move. If it drifts, nothing fails loudly in either language — the signature
 * simply stops verifying, and the symptom in production is every tick aborting with
 * E_INVALID_SIGNATURE on a vault that looks correctly configured. This prints the fixtures for
 * `portfolio_vault_tests.move`, which then verifies a signature produced HERE inside the VM.
 *
 * Regenerate the two together: the key is deterministic, so the fixtures are stable.
 */
import assert from "node:assert/strict";
import { Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

import {
  PORTFOLIO_ATTESTATION_DOMAIN,
  SIDE_CLOSE,
  SIDE_LONG,
  SIDE_SHORT,
  actionsDigest,
  actionsToEntryArgs,
  foldPortfolioDigest,
  portfolioGenesisDigest,
  serializePortfolioAttestation,
  signPortfolioAttestation,
  validateActions,
  type Action,
} from "../lib/portfolio-attestor";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// Deterministic key — fixtures must be reproducible or the Move test cannot pin them.
const key = new Ed25519PrivateKey(new Uint8Array(32).fill(7));
const pubkey = key.publicKey().toUint8Array();

const SV = "0x" + "cd".repeat(32);
const CHAIN_ID = 2;
const commitment = new Uint8Array(32).fill(0x26);
const genesis = portfolioGenesisDigest();

const actions: Action[] = [
  { marketIdx: 0, side: SIDE_LONG, pctBps: 1500, leverageX100: 200 },
  { marketIdx: 2, side: SIDE_SHORT, pctBps: 800, leverageX100: 150 },
  { marketIdx: 3, side: SIDE_CLOSE, pctBps: 0, leverageX100: 0 },
];

console.log("\n1. Domain separation");
assert.notEqual(PORTFOLIO_ATTESTATION_DOMAIN, "cash.trading/sealed-vault/v1");
console.log(`  ok   domain is "${PORTFOLIO_ATTESTATION_DOMAIN}", distinct from the single-market one`);

console.log("\n2. Action digest");
const digest = actionsDigest(actions);
assert.equal(digest.length, 32);
// Order matters: the digest binds a sequence, not a set. Two attestors that agree on the
// actions but disagree on their order must not produce the same signature, because the
// contract applies them in order and an open-then-close differs from a close-then-open.
const reordered = actionsDigest([actions[1], actions[0], actions[2]]);
assert.notEqual(hex(digest), hex(reordered), "action digest is order-independent");
console.log(`  ok   digest ${hex(digest).slice(0, 16)}… and reordering changes it`);

// An empty vector is legal — it is how a strategy says "no change this bar" — and must still
// produce a well-defined digest rather than hashing nothing.
const empty = actionsDigest([]);
assert.equal(empty.length, 32);
assert.notEqual(hex(empty), hex(digest));
console.log(`  ok   empty action vector digests to ${hex(empty).slice(0, 16)}…`);

console.log("\n3. Attestation layout");
const message = serializePortfolioAttestation({
  chainId: CHAIN_ID,
  strategyVault: SV,
  programCommitment: commitment,
  seq: 0n,
  inputDigest: genesis,
  actions,
});
const signature = signPortfolioAttestation(key, {
  chainId: CHAIN_ID,
  strategyVault: SV,
  programCommitment: commitment,
  seq: 0n,
  inputDigest: genesis,
  actions,
});
assert.equal(signature.length, 64);
console.log(`  ok   message is ${message.length} bytes, signature verifies as 64`);

// Each field must actually be bound. A field that is serialized but not covered would let an
// attacker vary it freely under a signature issued for a different value.
for (const [name, mutate] of [
  ["seq", (a: Parameters<typeof serializePortfolioAttestation>[0]) => ({ ...a, seq: 1n })],
  ["strategyVault", (a: Parameters<typeof serializePortfolioAttestation>[0]) => ({ ...a, strategyVault: "0x" + "ab".repeat(32) })],
  ["actions", (a: Parameters<typeof serializePortfolioAttestation>[0]) => ({ ...a, actions: [actions[0]] })],
  ["inputDigest", (a: Parameters<typeof serializePortfolioAttestation>[0]) => ({ ...a, inputDigest: new Uint8Array(32).fill(1) })],
] as const) {
  const base = {
    chainId: CHAIN_ID, strategyVault: SV, programCommitment: commitment,
    seq: 0n, inputDigest: genesis, actions,
  };
  const other = serializePortfolioAttestation(mutate(base));
  assert.notEqual(hex(message), hex(other), `${name} is not bound by the signature`);
  console.log(`  ok   ${name} changes the signed bytes`);
}

console.log("\n4. Client-side bound checks");
const bounds = { marketCount: 4, maxPctBps: 2000, maxLeverageX100: 300, maxPositions: 3 };
assert.deepEqual(validateActions(actions, bounds), []);
assert.ok(
  validateActions([{ marketIdx: 9, side: SIDE_LONG, pctBps: 100, leverageX100: 100 }], bounds).length > 0,
  "an out-of-range market index was accepted",
);
assert.ok(
  validateActions(
    [
      { marketIdx: 1, side: SIDE_LONG, pctBps: 100, leverageX100: 100 },
      { marketIdx: 1, side: SIDE_SHORT, pctBps: 100, leverageX100: 100 },
    ],
    bounds,
  ).some((p) => p.includes("duplicate")),
  "a duplicated market in one bar was accepted — that is the pyramiding path",
);
assert.ok(
  validateActions([{ marketIdx: 0, side: SIDE_LONG, pctBps: 9999, leverageX100: 100 }], bounds).length > 0,
  "pctBps above the vault cap was accepted",
);
assert.ok(
  validateActions([{ marketIdx: 0, side: SIDE_LONG, pctBps: 100, leverageX100: 9999 }], bounds).length > 0,
  "leverage above the vault cap was accepted",
);
// A close action carries no size or leverage, so those fields must not be validated for it —
// otherwise a strategy could never emit a flatten instruction.
assert.deepEqual(
  validateActions([{ marketIdx: 0, side: SIDE_CLOSE, pctBps: 0, leverageX100: 0 }], bounds),
  [],
);
console.log("  ok   range, duplicate, cap and close-action rules all hold");

console.log("\n5. Entry-argument packing");
const args = actionsToEntryArgs(actions);
assert.deepEqual(args.marketIdxs, [0, 2, 3]);
assert.deepEqual(args.sides, [SIDE_LONG, SIDE_SHORT, SIDE_CLOSE]);
assert.deepEqual(args.pctBpsList, [1500, 800, 0]);
assert.deepEqual(args.leverageList, [200, 150, 0]);
console.log("  ok   parallel vectors preserve action order");

console.log("\n6. Multi-market digest fold");
const prices = [7_000_000_000_000n, 350_000_000_000n, 20_000_000_000n, 900_000_000n];
const folded = foldPortfolioDigest(genesis, 1000n, prices);
assert.equal(folded.length, 32);
// The whole row is committed, so changing any single market's price changes the digest.
for (let i = 0; i < prices.length; i++) {
  const bumped = [...prices];
  bumped[i] += 1n;
  assert.notEqual(
    hex(folded),
    hex(foldPortfolioDigest(genesis, 1000n, bumped)),
    `market ${i}'s price is not committed by the fold`,
  );
}
console.log(`  ok   fold ${hex(folded).slice(0, 16)}… commits every market's price`);

console.log("\n7. Move test fixture (paste into portfolio_vault_tests.move)");
console.log(`    pubkey         = x"${hex(pubkey)}";`);
console.log(`    commitment     = x"${hex(commitment)}";`);
console.log(`    genesis        = x"${hex(genesis)}";`);
console.log(`    actions_digest = x"${hex(digest)}";`);
console.log(`    signature      = x"${hex(signature)}";`);
console.log(`    message        = x"${hex(message)}";`);
console.log(`    fold           = x"${hex(folded)}";`);
console.log(`    sv_addr        = @${SV};  chain_id = ${CHAIN_ID}; seq = 0;`);

console.log("\nAll portfolio-attestor checks passed.");
export {};
