/**
 * Portfolio-vault attestor — the off-chain half of `cash_strategy::portfolio_vault`.
 *
 * Where `lib/sealed-attestor.ts` signs one trit, this signs a bounded action vector: for each
 * market the strategy wants to touch, a side, a share of NAV and a leverage. Everything else is
 * still reconstructed from chain state, so the widening is exactly and only those four numbers
 * per market, each of which the contract clamps against a bound frozen at vault creation.
 *
 * The signed message carries a DIGEST of the actions rather than the actions themselves. That
 * keeps it fixed-size regardless of how many markets a strategy touches, and the contract
 * recomputes the digest from the action vector actually submitted — so a cranker cannot pair a
 * signature with a different action list than the one it was issued over.
 *
 * The BCS layouts below MUST match `portfolio_vault::PortfolioAttestation` and
 * `portfolio_vault::Action` field-for-field. `scripts/portfolio-attestor-selftest.ts` pins them
 * and emits a Move test fixture that verifies a signature produced here inside the VM.
 */
import { createHash } from "node:crypto";
import { AccountAddress, Ed25519PrivateKey, Serializer } from "@aptos-labs/ts-sdk";

function sha3(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha3-256").update(bytes).digest());
}

/** Must equal ATTESTATION_DOMAIN in portfolio_vault.move. Distinct from the single-market
 *  domain so a signature for one can never be replayed against the other. */
export const PORTFOLIO_ATTESTATION_DOMAIN = "cash.trading/portfolio-vault/v1";

export const SIDE_CLOSE = 0;
export const SIDE_LONG = 1;
export const SIDE_SHORT = 2;
export type Side = 0 | 1 | 2;

export interface Action {
  /** Index into the vault's frozen market allowlist. */
  marketIdx: number;
  side: Side;
  /** Share of NAV in bps. Ignored by the contract for SIDE_CLOSE. */
  pctBps: number;
  /** Leverage ×100. Ignored by the contract for SIDE_CLOSE. */
  leverageX100: number;
}

export interface PortfolioAttestation {
  chainId: number;
  strategyVault: string;
  programCommitment: Uint8Array;
  seq: bigint;
  inputDigest: Uint8Array;
  actions: Action[];
}

/** BCS layout mirroring `portfolio_vault::Action` field order exactly. */
function serializeAction(s: Serializer, a: Action): void {
  s.serializeU8(a.marketIdx);
  s.serializeU8(a.side);
  s.serializeU16(a.pctBps);
  s.serializeU16(a.leverageX100);
}

/**
 * `sha3_256(bcs(vector<Action>))` — the value the contract recomputes and binds.
 *
 * BCS encodes a vector as a ULEB128 length followed by the elements, which is what
 * `serializeU32AsUleb128` emits here. Getting that prefix wrong is the classic way for two
 * implementations of "the same" digest to differ only for vectors of length ≥ 128.
 */
export function actionsDigest(actions: Action[]): Uint8Array {
  const s = new Serializer();
  s.serializeU32AsUleb128(actions.length);
  for (const a of actions) serializeAction(s, a);
  return sha3(s.toUint8Array());
}

/** BCS layout mirroring `portfolio_vault::PortfolioAttestation` field order exactly. */
export function serializePortfolioAttestation(a: PortfolioAttestation): Uint8Array {
  if (a.programCommitment.length !== 32) {
    throw new Error(`programCommitment must be 32 bytes, got ${a.programCommitment.length}`);
  }
  if (a.inputDigest.length !== 32) {
    throw new Error(`inputDigest must be 32 bytes, got ${a.inputDigest.length}`);
  }
  const s = new Serializer();
  s.serializeBytes(new TextEncoder().encode(PORTFOLIO_ATTESTATION_DOMAIN)); // domain
  s.serializeU8(a.chainId); // chain_id
  AccountAddress.fromString(a.strategyVault).serialize(s); // strategy_vault
  s.serializeBytes(a.programCommitment); // program_commitment
  s.serializeU64(a.seq); // seq
  s.serializeBytes(a.inputDigest); // input_digest
  s.serializeBytes(actionsDigest(a.actions)); // actions_digest
  return s.toUint8Array();
}

export function signPortfolioAttestation(
  privateKey: Ed25519PrivateKey,
  a: PortfolioAttestation,
): Uint8Array {
  return privateKey.sign(serializePortfolioAttestation(a)).toUint8Array();
}

/**
 * Rolling input digest: `sha3_256(prev || bcs(bar_ts) || bcs(prices))`.
 *
 * `prices` is the whole row — one 1e8-scaled price per allowlisted market, in allowlist order.
 * Mirrors `portfolio_vault::fold_digest`. A digest over one market would not commit to the
 * inputs a multi-market strategy was actually defined over, which is the entire point of
 * keeping the trace.
 */
export function foldPortfolioDigest(
  prev: Uint8Array,
  barTs: bigint,
  prices: bigint[],
): Uint8Array {
  const ts = new Serializer();
  ts.serializeU64(barTs);
  const px = new Serializer();
  px.serializeU32AsUleb128(prices.length);
  for (const p of prices) px.serializeU64(p);

  const tsBytes = ts.toUint8Array();
  const pxBytes = px.toUint8Array();
  const buf = new Uint8Array(prev.length + tsBytes.length + pxBytes.length);
  buf.set(prev, 0);
  buf.set(tsBytes, prev.length);
  buf.set(pxBytes, prev.length + tsBytes.length);
  return sha3(buf);
}

/** Genesis digest — `sha3_256(PORTFOLIO_ATTESTATION_DOMAIN)`. */
export function portfolioGenesisDigest(): Uint8Array {
  return sha3(new TextEncoder().encode(PORTFOLIO_ATTESTATION_DOMAIN));
}

/**
 * Client-side validation of an action vector against a vault's published bounds.
 *
 * The contract enforces all of this and will abort — this exists so an attestor discovers it
 * produced an illegal vector BEFORE spending a signature and a transaction on it, and so the
 * error names the offending field instead of arriving as an abort code. Returns the problems,
 * empty when the vector is acceptable.
 */
export function validateActions(
  actions: Action[],
  bounds: {
    marketCount: number;
    maxPctBps: number;
    maxLeverageX100: number;
    maxPositions: number;
  },
): string[] {
  const problems: string[] = [];
  if (actions.length > bounds.marketCount) {
    problems.push(
      `${actions.length} actions for ${bounds.marketCount} markets — at most one per market`,
    );
  }
  const seen = new Set<number>();
  for (const [i, a] of actions.entries()) {
    const at = `action ${i} (market ${a.marketIdx})`;
    if (!Number.isInteger(a.marketIdx) || a.marketIdx < 0 || a.marketIdx >= bounds.marketCount) {
      problems.push(`${at}: market index out of range 0..${bounds.marketCount - 1}`);
    }
    if (seen.has(a.marketIdx)) problems.push(`${at}: duplicate market in one bar`);
    seen.add(a.marketIdx);
    if (a.side !== SIDE_CLOSE && a.side !== SIDE_LONG && a.side !== SIDE_SHORT) {
      problems.push(`${at}: side must be 0 (close), 1 (long) or 2 (short)`);
    }
    if (a.side === SIDE_CLOSE) continue;
    if (!Number.isInteger(a.pctBps) || a.pctBps <= 0 || a.pctBps > bounds.maxPctBps) {
      problems.push(`${at}: pctBps ${a.pctBps} outside 1..${bounds.maxPctBps}`);
    }
    if (
      !Number.isInteger(a.leverageX100)
      || a.leverageX100 < 100
      || a.leverageX100 > bounds.maxLeverageX100
    ) {
      problems.push(`${at}: leverageX100 ${a.leverageX100} outside 100..${bounds.maxLeverageX100}`);
    }
    // u16 fields. A value above 65535 would silently wrap in serialization and sign a
    // completely different action than the one the caller intended.
    if (a.pctBps > 0xffff || a.leverageX100 > 0xffff) {
      problems.push(`${at}: pctBps and leverageX100 must fit in u16`);
    }
  }
  return problems;
}

/** The four parallel vectors `tick_attested` takes, since Move entry functions cannot
 *  accept user-defined structs. Order must match the vector the digest was computed over. */
export function actionsToEntryArgs(actions: Action[]): {
  marketIdxs: number[];
  sides: number[];
  pctBpsList: number[];
  leverageList: number[];
} {
  return {
    marketIdxs: actions.map((a) => a.marketIdx),
    sides: actions.map((a) => a.side),
    pctBpsList: actions.map((a) => a.pctBps),
    leverageList: actions.map((a) => a.leverageX100),
  };
}
