/**
 * Sealed-vault server library — registry access, payload builders and the
 * commitment pipeline shared by every /api/sealed/* route.
 *
 * Design rule enforced here: the Pine source NEVER reaches the database or any
 * response body unless the creator explicitly reveals it. A sealed vault's
 * value is that the strategy stays private; the commitment is its public
 * identity. See docs/SEALED-INDICATOR.md.
 */
import { AccountAddress } from "@aptos-labs/ts-sdk";

import { prisma } from "@/lib/prisma";
import { transpileV3, TRANSPILER_VERSION } from "@/lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { computeProgramCommitment, toHex } from "@/lib/sealed-attestor";
import { buildManifest, canonicalizePine } from "@/lib/sealed-presets";

export const MAX_PINE_BYTES = 32 * 1024;

export interface SealedMarket {
  name: string;
  addr: string;
  sizeDecimalsPow: string;
  lotSize: string;
  minSize: string;
}

/**
 * Perp markets a sealed vault can bind to, with the real engine params, per
 * network. These replace the hardcoded BTC/USD constants in strategy_vault.move
 * — the sealed module takes them as creation args so a vault on any market
 * sizes and lots correctly.
 *
 * Values are AUTHORITATIVE, read from perp_engine views on 2026-07-30
 * (market_lot_size / market_min_size / market_sz_decimals on each network's
 * current Decibel package). The previous entry carried the OLD testnet
 * package's market (lot=10, min=100000, szDecimals=8) — on the current package
 * BTC/USD is lot=10000, min=20000, szDecimals=9, so every order built from the
 * stale numbers would have aborted on lot mismatch or mis-sized by 10x.
 * Re-verify with `pnpm sealed:e2e verify-markets` after any Decibel redeploy.
 */
export const SEALED_MARKETS_BY_NETWORK: Record<"testnet" | "mainnet", SealedMarket[]> = {
  testnet: [
    {
      name: "BTC/USD",
      addr: "0x161b7b3f58327d057ee5824de0c1a4fc4fa3d121b847c138e921a255768a0dca",
      sizeDecimalsPow: "1000000000", // 10^9
      lotSize: "10000",
      minSize: "20000",
    },
  ],
  mainnet: [
    {
      name: "BTC/USD",
      addr: "0x5e0e16f34adfb4b316f8d532d68acbfa206826feaaa418d3938046bdc2044861",
      sizeDecimalsPow: "100000000", // 10^8
      lotSize: "1000",
      minSize: "2000",
    },
  ],
};

export const SEALED_MARKETS: SealedMarket[] =
  SEALED_MARKETS_BY_NETWORK[
    (process.env.NEXT_PUBLIC_DECIBEL_NETWORK ?? process.env.DECIBEL_NETWORK) === "mainnet"
      ? "mainnet"
      : "testnet"
  ];

export function findSealedMarket(nameOrAddr: string): SealedMarket | null {
  const q = nameOrAddr.toLowerCase();
  return (
    SEALED_MARKETS.find((m) => m.name.toLowerCase() === q || m.addr.toLowerCase() === q) ?? null
  );
}

/** Accepts long-form and short-form (leading-zero-stripped) addresses. SDK v5's
 *  AccountAddress.fromString rejects short form outright, which turned a pasted
 *  "0xCAFE"-style address into a confusing "invalid address" error. */
export function normalizeAddress(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^0x([0-9a-fA-F]{1,64})$/.exec(v.trim());
  if (!m) return null;
  try {
    return AccountAddress.fromString("0x" + m[1].padStart(64, "0")).toString();
  } catch {
    return null;
  }
}

export function isHexAddress(v: unknown): v is string {
  return normalizeAddress(v) !== null;
}

export function isHex32(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

// ── Commitment pipeline ──────────────────────────────────────────────────────

export interface CommitResult {
  ok: true;
  commitment: string;
  manifestJson: string;
  moduleName: string;
  warmupBars: number;
  bufferCapacity: number;
  /** Transpiler warnings — safe to show, they describe form not content. */
  warnings: string[];
}

export interface CommitFailure {
  ok: false;
  status: number;
  error: string;
  errors?: string[];
}

/**
 * Transpile → validate → commit. Returns ONLY the hash and public metadata; the
 * Pine and the emitted Move stay in memory and are never returned or persisted.
 *
 * Rejects when the transpiler errors, or when the evaluator can't execute the
 * resulting IR — an attestor that can't reproduce its own signals must never be
 * allowed to commit to a program.
 */
export function commitProgram(args: {
  pine: string;
  marketAddr: string;
}): CommitResult | CommitFailure {
  const pine = canonicalizePine(args.pine);
  if (Buffer.byteLength(pine, "utf8") > MAX_PINE_BYTES) {
    return { ok: false, status: 413, error: `PineScript exceeds ${MAX_PINE_BYTES / 1024}KB cap` };
  }
  if (!pine.trim()) {
    return { ok: false, status: 400, error: "pineScript is empty" };
  }

  let transpiled: ReturnType<typeof transpileV3>;
  try {
    transpiled = transpileV3(pine, undefined, { target: "vault", marketAddr: args.marketAddr });
  } catch (err) {
    return {
      ok: false,
      status: 422,
      error: err instanceof Error ? err.message : "transpile failed",
    };
  }
  if (transpiled.errors?.length) {
    return {
      ok: false,
      status: 422,
      error: "Strategy cannot be committed — the transpiler rejected it.",
      errors: transpiled.errors,
    };
  }

  const runner = createStrategyRunner(transpiled.ir);
  if (runner.unsupported.size > 0) {
    return {
      ok: false,
      status: 422,
      error:
        "Strategy uses operations the attestor cannot evaluate, so it could not reproduce its own signals.",
      errors: [...runner.unsupported],
    };
  }

  const manifestJson = buildManifest({
    transpilerVersion: TRANSPILER_VERSION,
    moduleName: transpiled.moduleName,
    marketAddr: args.marketAddr,
  });
  const commitment = computeProgramCommitment({
    canonicalPine: pine,
    emittedMove: transpiled.moveSource,
    manifestJson,
  });

  return {
    ok: true,
    commitment: toHex(commitment),
    manifestJson,
    moduleName: transpiled.moduleName,
    warmupBars: transpiled.ir.warmupMinBars,
    bufferCapacity: transpiled.ir.bufferCapacity,
    warnings: transpiled.warnings ?? [],
  };
}

/** Recompute a commitment from a revealed Pine + manifest and compare. */
export function verifyRevealedProgram(args: {
  pine: string;
  manifestJson: string;
  marketAddr: string;
  expectedCommitment: string;
}): { matches: boolean; recomputed: string; errors?: string[] } {
  const pine = canonicalizePine(args.pine);
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr: args.marketAddr });
  if (t.errors?.length) return { matches: false, recomputed: "", errors: t.errors };
  const recomputed = toHex(
    computeProgramCommitment({
      canonicalPine: pine,
      emittedMove: t.moveSource,
      manifestJson: args.manifestJson,
    }),
  );
  return {
    matches: recomputed.toLowerCase() === args.expectedCommitment.toLowerCase(),
    recomputed,
  };
}

// ── Payload builders (wallet-signed; the server never holds a user key) ──────

export function buildCreateSealedVaultPayload(args: {
  packageAddress: string;
  programCommitment: string;
  attestorPubkey: string;
  decibelVaultAddr: string;
  market: SealedMarket;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  traceCapacity: number;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::create_sealed_vault`,
    typeArguments: [] as string[],
    functionArguments: [
      args.programCommitment,
      args.attestorPubkey,
      args.decibelVaultAddr,
      args.market.addr,
      args.market.sizeDecimalsPow,
      args.market.lotSize,
      args.market.minSize,
      String(args.pctBps),
      String(args.maxLeverageX100),
      String(args.minBarIntervalS),
      String(args.traceCapacity),
    ],
  };
}

export function buildSealPayload(args: {
  packageAddress: string;
  strategyVaultAddr: string;
  enclaveMeasurement?: string;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::seal`,
    typeArguments: [] as string[],
    functionArguments: [args.strategyVaultAddr, args.enclaveMeasurement ?? "0x"],
  };
}

export function buildSetPausedPayload(args: {
  packageAddress: string;
  strategyVaultAddr: string;
  paused: boolean;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::set_paused`,
    typeArguments: [] as string[],
    functionArguments: [args.strategyVaultAddr, args.paused],
  };
}

/** The Decibel delegation the VAULT ADMIN must sign. Mirrors lib/decibel-vaults. */
export function buildDelegateInstruction(args: {
  decibelPackage: string;
  decibelVaultAddr: string;
  strategyVaultAddr: string;
  expirySecs: number;
}) {
  return {
    function: `${args.decibelPackage}::vault_admin_api::delegate_dex_actions_to`,
    typeArguments: [] as string[],
    functionArguments: [
      args.decibelVaultAddr,
      args.strategyVaultAddr,
      String(args.expirySecs),
    ],
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** Public shape — never includes the Pine unless it has been revealed. */
export interface PublicSealedVault {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  creatorAddr: string;
  decibelVaultAddr: string;
  marketAddr: string;
  marketName: string | null;
  programCommitment: string;
  attestorPubkey: string;
  enclaveMeasurement: string | null;
  name: string;
  description: string | null;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  sealedAt: string | null;
  paused: boolean;
  revealed: boolean;
  revealedAt: string | null;
  createdAt: string;
  /** Tier-1 unless an enclave measurement is bound. Drives the UI trust badge. */
  attestationTier: "bare" | "tee";
}

type SealedVaultRow = {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  creatorAddr: string;
  decibelVaultAddr: string;
  marketAddr: string;
  marketName: string | null;
  programCommitment: string;
  attestorPubkey: string;
  enclaveMeasurement: string | null;
  name: string;
  description: string | null;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  sealedAt: Date | null;
  paused: boolean;
  revealedPine: string | null;
  revealedAt: Date | null;
  createdAt: Date;
};

export function toPublicSealedVault(row: SealedVaultRow): PublicSealedVault {
  const hasEnclave = Boolean(row.enclaveMeasurement && row.enclaveMeasurement !== "0x");
  return {
    strategyVaultAddr: row.strategyVaultAddr,
    packageAddress: row.packageAddress,
    network: row.network,
    creatorAddr: row.creatorAddr,
    decibelVaultAddr: row.decibelVaultAddr,
    marketAddr: row.marketAddr,
    marketName: row.marketName,
    programCommitment: row.programCommitment,
    attestorPubkey: row.attestorPubkey,
    enclaveMeasurement: hasEnclave ? row.enclaveMeasurement : null,
    name: row.name,
    description: row.description,
    pctBps: row.pctBps,
    maxLeverageX100: row.maxLeverageX100,
    minBarIntervalS: row.minBarIntervalS,
    sealedAt: row.sealedAt ? row.sealedAt.toISOString() : null,
    paused: row.paused,
    revealed: Boolean(row.revealedPine),
    revealedAt: row.revealedAt ? row.revealedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    attestationTier: hasEnclave ? "tee" : "bare",
  };
}

export function sealedRegistryAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function listSealedVaults(network: string): Promise<PublicSealedVault[]> {
  const rows = await prisma.sealedVault.findMany({
    where: { network },
    orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map(toPublicSealedVault);
}

export async function getSealedVault(addr: string): Promise<PublicSealedVault | null> {
  const row = await prisma.sealedVault.findUnique({ where: { strategyVaultAddr: addr } });
  return row ? toPublicSealedVault(row) : null;
}

export const SEALED_PACKAGE =
  process.env.SEALED_VAULT_PACKAGE ?? process.env.NEXT_PUBLIC_SEALED_VAULT_PACKAGE ?? "";

/** Current Decibel package per network — verified against live PackageRegistry
 *  2026-07-30. All five functions the sealed module calls have identical public
 *  visibility on both, and order_book_types resolves at 0x5 on both. */
export const DECIBEL_PACKAGE_BY_NETWORK: Record<"testnet" | "mainnet", string> = {
  testnet: "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f",
  mainnet: "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06",
};

export const DECIBEL_VAULT_PACKAGE =
  process.env.DECIBEL_VAULT_PACKAGE ??
  DECIBEL_PACKAGE_BY_NETWORK[
    (process.env.NEXT_PUBLIC_DECIBEL_NETWORK ?? process.env.DECIBEL_NETWORK) === "mainnet"
      ? "mainnet"
      : "testnet"
  ];
