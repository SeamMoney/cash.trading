/**
 * Encrypted custody of a creator's PineScript, for managed attestation.
 *
 * ## Why this exists, and what it costs
 *
 * A sealed vault only trades when something runs its committed program every bar and signs the
 * resulting signal. That something needs the source. Until now we deliberately never stored it,
 * which meant the only party who *could* run a private strategy's attestor was the creator, on
 * their own machine — so "keep my indicator proprietary and have it auto-trade for me", the
 * whole point of the product, was not actually deliverable.
 *
 * Managed attestation closes that, and it is an honest trade rather than a free win:
 *
 *   - We hold the source encrypted at rest (AES-256-GCM, key from SEALED_SOURCE_KEY, never in
 *     the database). A database dump alone does not reveal any strategy.
 *   - We CAN decrypt it. The key lives in the attestor's environment, so an operator with
 *     production access could read a creator's alpha. There is no cryptographic story that
 *     prevents this at tier 1, and claiming otherwise would be a lie.
 *   - It is opt-in. A creator who declines keeps the old behaviour — nothing is stored and they
 *     run `scripts/sealed-attestor-runner.ts` themselves.
 *
 * The tier-2 upgrade (docs/SEALED-INDICATOR.md §4) removes us from the trust equation: the
 * enclave holds the key, its measurement is bound into the vault at creation, and no operator
 * can extract the source. This module is the bridge to that, not a substitute for it.
 *
 * ## What is NOT protected
 *
 * Nothing here hides trading behaviour. Positions, sizes and timing are public on-chain by
 * design — that is what makes the vault verifiable. A determined observer can infer a great
 * deal about a strategy from its trades regardless of where the source lives.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32;

export interface SealedSourceCiphertext {
  /** Base64 ciphertext. */
  ciphertext: string;
  /** Base64 96-bit nonce. Fresh per encryption — never reused. */
  iv: string;
  /** Base64 GCM auth tag. Detects tampering; decryption fails closed. */
  tag: string;
}

export function sourceVaultAvailable(): boolean {
  return Boolean(readKey(true));
}

function readKey(soft = false): Buffer | null {
  const raw = process.env.SEALED_SOURCE_KEY?.trim();
  if (!raw) {
    if (soft) return null;
    throw new Error("SEALED_SOURCE_KEY is not set — managed attestation is disabled");
  }
  const key = Buffer.from(raw.replace(/^0x/i, ""), "hex");
  if (key.length !== KEY_BYTES) {
    if (soft) return null;
    throw new Error(`SEALED_SOURCE_KEY must be ${KEY_BYTES} bytes of hex (got ${key.length})`);
  }
  return key;
}

/**
 * Encrypt a strategy for storage.
 *
 * `strategyVaultAddr` is bound in as additional authenticated data, so a ciphertext lifted from
 * one row cannot be replayed into another vault's row — decryption for the wrong vault fails
 * rather than silently returning someone else's strategy.
 */
export function encryptSource(
  pineScript: string,
  strategyVaultAddr: string,
): SealedSourceCiphertext {
  const key = readKey()!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(strategyVaultAddr.toLowerCase(), "utf8"));
  const ct = Buffer.concat([cipher.update(pineScript, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decrypt. Throws on a wrong key, a tampered ciphertext, or the wrong vault address. */
export function decryptSource(
  blob: SealedSourceCiphertext,
  strategyVaultAddr: string,
): string {
  const key = readKey()!;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"));
  decipher.setAAD(Buffer.from(strategyVaultAddr.toLowerCase(), "utf8"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time compare for the cron's bearer token. */
export function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
