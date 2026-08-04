/**
 * Encrypted source custody — the properties that make managed attestation safe to offer.
 *
 *   pnpm exec tsx scripts/sealed-source-vault-selftest.ts
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Set before importing: the module reads the key lazily per call, but making the ordering
// explicit keeps this honest if that ever changes.
process.env.SEALED_SOURCE_KEY = randomBytes(32).toString("hex");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  encryptSource,
  decryptSource,
  sourceVaultAvailable,
  secretMatches,
} = require("../lib/sealed-source-vault") as typeof import("../lib/sealed-source-vault");

const VAULT_A = "0x" + "11".repeat(32);
const VAULT_B = "0x" + "22".repeat(32);
const PINE = '//@version=5\nstrategy("secret")\nif (close > 1)\n    strategy.entry("L", strategy.long)\n';

assert.ok(sourceVaultAvailable(), "a 32-byte key must enable the vault");

// Round-trip.
const blob = encryptSource(PINE, VAULT_A);
assert.equal(decryptSource(blob, VAULT_A), PINE, "round-trip must be exact");

// The ciphertext must not leak the source.
assert.ok(!blob.ciphertext.includes("strategy"), "ciphertext must not contain plaintext");
assert.ok(
  !Buffer.from(blob.ciphertext, "base64").toString("utf8").includes("secret"),
  "decoded ciphertext must not contain plaintext",
);

// Nonces must never repeat — GCM is catastrophically broken by nonce reuse.
const ivs = new Set(Array.from({ length: 200 }, () => encryptSource(PINE, VAULT_A).iv));
assert.equal(ivs.size, 200, "every encryption must use a fresh nonce");

// A ciphertext lifted into another vault's row must NOT decrypt: the vault address is bound
// in as AAD, so a database-level row swap cannot hand one creator another's strategy.
assert.throws(() => decryptSource(blob, VAULT_B), "must reject a ciphertext from another vault");

// Tampering must fail closed rather than returning garbage.
const flipped = Buffer.from(blob.ciphertext, "base64");
flipped[0] ^= 0xff;
assert.throws(
  () => decryptSource({ ...blob, ciphertext: flipped.toString("base64") }, VAULT_A),
  "a tampered ciphertext must fail the auth tag",
);
assert.throws(
  () => decryptSource({ ...blob, tag: Buffer.alloc(16).toString("base64") }, VAULT_A),
  "a forged tag must be rejected",
);

// A different key must not decrypt.
const oldKey = process.env.SEALED_SOURCE_KEY;
process.env.SEALED_SOURCE_KEY = randomBytes(32).toString("hex");
assert.throws(() => decryptSource(blob, VAULT_A), "a rotated key must not decrypt old rows");
process.env.SEALED_SOURCE_KEY = oldKey;
assert.equal(decryptSource(blob, VAULT_A), PINE, "restoring the key must restore access");

// Misconfiguration must disable the feature, never silently weaken it.
process.env.SEALED_SOURCE_KEY = "00ff";
assert.ok(!sourceVaultAvailable(), "a short key must disable managed attestation");
assert.throws(() => encryptSource(PINE, VAULT_A), "a short key must refuse to encrypt");
process.env.SEALED_SOURCE_KEY = oldKey;

// Bearer comparison is length-safe and constant-time.
assert.ok(secretMatches("abc", "abc"));
assert.ok(!secretMatches("abc", "abcd"));
assert.ok(!secretMatches(null, "abc"));
assert.ok(!secretMatches("", "abc"));

console.log("sealed source vault: passed");
