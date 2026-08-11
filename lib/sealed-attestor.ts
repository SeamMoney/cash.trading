/**
 * Sealed-vault attestor — the off-chain half of docs/SEALED-INDICATOR.md.
 *
 * The attestor runs the committed strategy and signs one trit per bar. Its
 * entire authority is that trit: the market, size, price and execution are
 * enforced on-chain by `cash_strategy::sealed_vault`. The issuance timestamp is
 * signed and expires on-chain, so the permissionless cranker cannot turn a
 * signal into an option it exercises later.
 *
 * The BCS layout below MUST match `sealed_vault::Attestation` field-for-field.
 * `scripts/sealed-attestor-selftest.ts` pins it, and the Move test
 * `typescript_bcs_attestation_verifies_in_move` verifies a signature produced
 * here inside the VM — the same cross-check that protects the CASH voucher.
 */
import { createHash } from "node:crypto";
import {
  Account,
  AccountAddress,
  Ed25519PrivateKey,
  Serializer,
} from "@aptos-labs/ts-sdk";

/** Node's sha3-256 matches Move's `std::hash::sha3_256` byte-for-byte.
 *  Same helper the artifact hasher uses (lib/strategy-artifacts.ts:21). */
function sha3(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha3-256").update(bytes).digest());
}

/** Must equal ATTESTATION_DOMAIN in sealed_vault.move. */
export const ATTESTATION_DOMAIN = "cash.trading/sealed-vault/v2";

export const SIGNAL_NEUTRAL = 0;
export const SIGNAL_BUY = 1;
export const SIGNAL_SELL = 2;
export type Signal = 0 | 1 | 2;

export interface Attestation {
  chainId: number;
  /** The SealedVault object address. */
  strategyVault: string;
  /** 32 bytes — sha3_256(pine || 0x00 || move || 0x00 || manifest). */
  programCommitment: Uint8Array;
  /** Current on-chain seq. Strictly monotonic; the chain rejects any other value. */
  seq: bigint;
  /** 32 bytes — the on-chain digest of the series through the PREVIOUS bar. */
  inputDigest: Uint8Array;
  /** Attestation issuance time in Unix seconds. Bound and freshness-checked on-chain. */
  barTs: bigint;
  signal: Signal;
}

/** BCS layout mirroring `sealed_vault::Attestation` field order exactly. */
export function serializeAttestation(a: Attestation): Uint8Array {
  if (a.programCommitment.length !== 32) {
    throw new Error(`programCommitment must be 32 bytes, got ${a.programCommitment.length}`);
  }
  if (a.inputDigest.length !== 32) {
    throw new Error(`inputDigest must be 32 bytes, got ${a.inputDigest.length}`);
  }
  const s = new Serializer();
  s.serializeBytes(new TextEncoder().encode(ATTESTATION_DOMAIN)); // domain
  s.serializeU8(a.chainId); // chain_id
  AccountAddress.fromString(a.strategyVault).serialize(s); // strategy_vault
  s.serializeBytes(a.programCommitment); // program_commitment
  s.serializeU64(a.seq); // seq
  s.serializeBytes(a.inputDigest); // input_digest
  s.serializeU64(a.barTs); // bar_ts
  s.serializeU8(a.signal); // signal
  return s.toUint8Array();
}

export function signAttestation(privateKey: Ed25519PrivateKey, a: Attestation): Uint8Array {
  return privateKey.sign(serializeAttestation(a)).toUint8Array();
}

/**
 * Rolling input digest: `sha3_256(prev || bcs(bar_ts) || bcs(price))`.
 * Mirrors `sealed_vault::fold_digest`. Lets a verifier recompute the whole
 * committed history from the public trace without touching the chain.
 */
export function foldDigest(prev: Uint8Array, barTs: bigint, price: bigint): Uint8Array {
  const ts = new Serializer();
  ts.serializeU64(barTs);
  const px = new Serializer();
  px.serializeU64(price);
  const tsBytes = ts.toUint8Array();
  const pxBytes = px.toUint8Array();

  const buf = new Uint8Array(prev.length + tsBytes.length + pxBytes.length);
  buf.set(prev, 0);
  buf.set(tsBytes, prev.length);
  buf.set(pxBytes, prev.length + tsBytes.length);
  return sha3(buf);
}

/** Genesis digest — `sha3_256(ATTESTATION_DOMAIN)`, matching create_sealed_vault. */
export function genesisDigest(): Uint8Array {
  return sha3(new TextEncoder().encode(ATTESTATION_DOMAIN));
}

/**
 * Program commitment. Identical formula to docs/SHELBY-PIN.md so the sealed
 * path and the (public) verify path agree on what a strategy's identity is.
 */
export function computeProgramCommitment(args: {
  canonicalPine: string;
  emittedMove: string;
  manifestJson: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const parts = [
    enc.encode(args.canonicalPine),
    new Uint8Array([0]),
    enc.encode(args.emittedMove),
    new Uint8Array([0]),
    enc.encode(args.manifestJson),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha3(buf);
}

export function toHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`invalid hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode a Move `vector<u8>` that must be exactly one sha3-256 digest.
 *
 * Aptos view clients may expose byte vectors as `0x` hex, a byte array, or a Uint8Array.
 * Canonicalizing at the view boundary prevents malformed bytes from being string-coerced or
 * silently converted to zero before an attestation is signed.
 */
export function parseMoveBytes32Hex(value: unknown, label: string): string {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    bytes = fromHex(value);
  } else if (value instanceof Uint8Array) {
    bytes = value;
  } else if (Array.isArray(value)) {
    if (
      value.some(
        (byte) => typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255,
      )
    ) {
      throw new Error(`${label} must contain only bytes`);
    }
    bytes = Uint8Array.from(value as number[]);
  } else {
    throw new Error(`${label} must be a byte vector`);
  }
  if (bytes.length !== 32) {
    throw new Error(`${label} must be 32 bytes, got ${bytes.length}`);
  }
  return toHex(bytes);
}

/** Loads the attestor key. Holds NO funds and NO trading authority — losing it
 *  stops the vault trading, it does not put deposits at risk. */
export function loadAttestorAccount(): Account | null {
  const raw = process.env.SEALED_ATTESTOR_PRIVATE_KEY;
  if (!raw) return null;
  try {
    const key = new Ed25519PrivateKey(raw);
    return Account.fromPrivateKey({ privateKey: key });
  } catch {
    return null;
  }
}

/** Entry-function payload for `sealed_vault::tick_attested`. */
export function buildTickAttestedPayload(args: {
  packageAddress: string;
  strategyVault: string;
  barTs: bigint;
  signal: Signal;
  signature: Uint8Array;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::tick_attested` as const,
    typeArguments: [] as string[],
    functionArguments: [
      args.strategyVault,
      args.barTs.toString(),
      args.signal,
      // A `vector<u8>` MUST be a byte array, not a hex string. The Aptos SDK encodes a JS
      // string argument as its UTF-8 bytes, so "0x…" (66 chars) reaches Move as 66 bytes and
      // every length assert fails. `number[]` is unambiguous and survives JSON, which a
      // Uint8Array does not — these payloads cross an HTTP boundary to the browser.
      Array.from(args.signature),
    ],
  };
}

/**
 * Replay verification for a delayed reveal (docs/SEALED-INDICATOR.md §6).
 *
 * Given the public price trace and the signal the attestor produced for each
 * bar, recompute the digest chain and confirm every signature. Any divergence
 * is provable against the curator's own key. `signalFor` is the revealed
 * program, applied to the prefix of the series the attestor saw.
 */
export function verifyTraceReplay(args: {
  chainId: number;
  strategyVault: string;
  programCommitment: Uint8Array;
  attestorPublicKey: Uint8Array;
  /** Bars in chain order, as recorded on-chain. */
  trace: Array<{ barTs: bigint; price: bigint; signal: Signal; signature: Uint8Array }>;
  /** The revealed program: prefix of prices (through the previous bar) → signal. */
  signalFor: (closes: bigint[]) => Signal;
  verifySignature: (pubkey: Uint8Array, message: Uint8Array, sig: Uint8Array) => boolean;
}): { ok: boolean; divergences: Array<{ seq: number; reason: string }> } {
  const divergences: Array<{ seq: number; reason: string }> = [];
  let digest = genesisDigest();
  const closes: bigint[] = [];

  args.trace.forEach((bar, i) => {
    const seq = i; // seq at signing time is the pre-increment value
    const message = serializeAttestation({
      chainId: args.chainId,
      strategyVault: args.strategyVault,
      programCommitment: args.programCommitment,
      seq: BigInt(seq),
      inputDigest: digest,
      barTs: bar.barTs,
      signal: bar.signal,
    });

    if (!args.verifySignature(args.attestorPublicKey, message, bar.signature)) {
      divergences.push({ seq, reason: "signature does not verify" });
    }

    const expected = args.signalFor(closes);
    if (expected !== bar.signal) {
      divergences.push({
        seq,
        reason: `revealed program says ${expected}, attestor signed ${bar.signal}`,
      });
    }

    digest = foldDigest(digest, bar.barTs, bar.price);
    closes.push(bar.price);
  });

  return { ok: divergences.length === 0, divergences };
}
