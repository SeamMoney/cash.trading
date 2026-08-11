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
import {
  parseManifestMarketAddress,
  requestedLeverageX100,
  requestedPctBps,
} from "../lib/portfolio-tick";
import { parsePortfolioCommittedTrace } from "../lib/committed-price-trace";
import {
  decodeMoveU8Vector,
  normalizePortfolioAddress,
  parsePortfolioBounds,
  parsePortfolioMarketAddresses,
  parsePortfolioPositions,
} from "../lib/portfolio-chain-state";

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

console.log("\n7. Strategy-requested sizing");
{
  // Only the explicit percent-of-equity form is honoured. A bare `qty` is a CONTRACT count in
  // PineScript, and reading it as a percentage would silently mis-size every strategy using
  // the default — 10 contracts becoming 10% of NAV, or 500 contracts becoming a rejected 500%.
  assert.equal(requestedPctBps(`strategy("x", overlay=true)\n`), null);
  assert.equal(
    requestedPctBps(`strategy("x", overlay=true, default_qty_value=25)\n`),
    null,
    "a qty value without percent_of_equity was read as a percentage",
  );
  assert.equal(
    requestedPctBps(
      `strategy("x", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=25)\n`,
    ),
    2500,
  );
  assert.equal(
    requestedPctBps(
      `strategy("x", default_qty_type=strategy.percent_of_equity, default_qty_value=7.5)\n`,
    ),
    750,
  );
  // Out-of-range values fall back rather than clamping: a script asking for 400% of equity has
  // a bug, and quietly turning it into the cap would hide it.
  assert.equal(
    requestedPctBps(
      `strategy("x", default_qty_type=strategy.percent_of_equity, default_qty_value=400)\n`,
    ),
    null,
  );
  console.log("  ok   percent_of_equity honoured, bare qty and out-of-range values ignored");

  // Leverage comes from margin_long / margin_short — real TradingView parameters that mean
  // exactly this, so a script written for TradingView carries its leverage across unchanged.
  assert.equal(requestedLeverageX100(`strategy("x", overlay=true)\n`), null);
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=50, margin_short=50)\n`), 200);
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=25)\n`), 400);
  // The SMALLER margin wins: it is the more levered side, and a per-leg cap has to bound the
  // worst case rather than the average of the two.
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=50, margin_short=20)\n`), 500);
  // 0% is infinite leverage and >100% is nonsense. Both fall back rather than being clamped,
  // so a script with a bug surfaces instead of quietly becoming the vault cap.
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=0)\n`), null);
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=150)\n`), null);
  // 100% margin is 1x — unlevered, but a legitimate instruction, not a fallback.
  assert.equal(requestedLeverageX100(`strategy("x", margin_long=100)\n`), 100);
  console.log("  ok   margin_long/short read as leverage, smaller side wins, bad values ignored");
}

console.log("\n8. Committed portfolio trace decoding");
{
  const retained = parsePortfolioCommittedTrace(
    [
      ["100000000", "200000000", "300000000", "400000000"],
      ["100", "160"],
      "2",
    ],
    5n,
    2,
  );
  assert.deepEqual(retained.closesByMarket, [[1, 3], [2, 4]]);
  assert.deepEqual(retained.timestamps, [100n, 160n]);
  assert.throws(
    () => parsePortfolioCommittedTrace([["1", "2"], ["1"], "2"], 1n, 3),
    /width is 2, expected 3/,
  );
  assert.throws(
    () => parsePortfolioCommittedTrace([["1"], ["1"], "2"], 1n, 2),
    /1 prices for 1 rows × 2 markets/,
  );
  assert.throws(
    () => parsePortfolioCommittedTrace([["1", "2", "3", "4"], ["9", "8"], "2"], 2n, 2),
    /increase strictly/,
  );
  assert.throws(
    () => parsePortfolioCommittedTrace([["1", "2"], ["1"], "2"], 0n, 2),
    /sequence-zero vault must have an empty trace/,
  );
  console.log("  ok   reconstructs rows by frozen market index and rejects malformed traces");
}

console.log("\n9. Strict portfolio chain-state decoding");
{
  assert.deepEqual(
    parsePortfolioBounds(["2000", "300", "800", "3", "60", "100", "4"]),
    { maxPctBps: 2000, maxLeverageX100: 300, maxPositions: 3, marketCount: 4 },
  );
  assert.throws(
    () => parsePortfolioBounds(["2000", "300", "800", "5", "60", "100", "4"]),
    /maximum positions exceeds/,
  );
  assert.throws(
    () => parsePortfolioBounds(["2000", "300", "800", "3", "60", "100", "9007199254740992"]),
    /cannot be represented exactly/,
  );

  const addresses = parsePortfolioMarketAddresses([["0x1", "0x02"]]);
  assert.equal(addresses[0], normalizePortfolioAddress("0x0001", "fixture address"));
  assert.equal(addresses[1], normalizePortfolioAddress("0x2", "fixture address"));
  assert.throws(() => parsePortfolioMarketAddresses([["not-an-address"]]), /Aptos address/);

  assert.deepEqual(decodeMoveU8Vector("0x0002"), [0, 2]);
  assert.deepEqual(decodeMoveU8Vector([0, 2]), [0, 2]);
  assert.throws(() => decodeMoveU8Vector("0x0"), /even-length/);
  assert.throws(() => decodeMoveU8Vector([256]), /0 through 255/);

  assert.equal(parseManifestMarketAddress('{"marketAddr":"0x1"}'), "0x1");
  assert.throws(() => parseManifestMarketAddress("{}"), /valid Aptos marketAddr/);
  assert.throws(() => parseManifestMarketAddress("not json"), /not valid JSON/);

  const positions = parsePortfolioPositions(
    ["0x0002", [true, false], ["5", "7"], ["3", "4"], ["2", "1"]],
    { marketCount: 4, maxPositions: 3, seq: 5n },
  );
  assert.deepEqual([...positions.held.entries()], [[0, true], [2, false]]);
  const afterClose = parsePortfolioPositions(
    ["0x00", [true], ["5"], ["3"], ["2"]],
    { marketCount: 4, maxPositions: 3, seq: 5n },
  );
  assert.notEqual(afterClose.fingerprint, positions.fingerprint);
  assert.throws(
    () => parsePortfolioPositions(
      ["0x0002", [true], ["5", "7"], ["3", "4"], ["2", "1"]],
      { marketCount: 4, maxPositions: 3, seq: 5n },
    ),
    /different lengths/,
  );
  assert.throws(
    () => parsePortfolioPositions(
      ["0x0000", [true, false], ["5", "7"], ["3", "4"], ["2", "1"]],
      { marketCount: 4, maxPositions: 3, seq: 5n },
    ),
    /duplicate position/,
  );
  assert.throws(
    () => parsePortfolioPositions(
      ["0x04", [true], ["5"], ["3"], ["2"]],
      { marketCount: 4, maxPositions: 3, seq: 5n },
    ),
    /out-of-range/,
  );
  assert.throws(
    () => parsePortfolioPositions(
      ["0x00", [true], ["5"], ["3"], ["1"]],
      { marketCount: 4, maxPositions: 3, seq: 5n },
    ),
    /inconsistent bars-held/,
  );
  console.log("  ok   exact allowlist addresses, u8 vectors, bounds, and positions fail closed");
}

console.log("\n10. Move test fixture (paste into portfolio_vault_tests.move)");
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
