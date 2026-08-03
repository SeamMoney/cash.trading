/**
 * Sealed-vault server library — registry access, payload builders and the
 * commitment pipeline shared by every /api/sealed/* route.
 *
 * Design rule enforced here: the Pine source NEVER reaches the database or any
 * response body unless the creator explicitly reveals it. A sealed vault's
 * value is that the strategy stays private; the commitment is its public
 * identity. See docs/SEALED-INDICATOR.md.
 */
import { AccountAddress, MoveString, createObjectAddress } from "@aptos-labs/ts-sdk";
import { PLATFORM_LAUNCH } from "./vault-economics";

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
  /** Engine price grid (px units, 1e6). Order prices must be multiples. */
  tickerSize: string;
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
      tickerSize: "1000000",
    },
  ],
  mainnet: [
    {
      name: "BTC/USD",
      addr: "0x5e0e16f34adfb4b316f8d532d68acbfa206826feaaa418d3938046bdc2044861",
      sizeDecimalsPow: "100000000", // 10^8
      lotSize: "1000",
      minSize: "2000",
      tickerSize: "100000",
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

/**
 * Truncate a display name without splitting a character.
 *
 * `String.prototype.slice` cuts on UTF-16 code units, so slicing an emoji name mid-character
 * leaves a lone surrogate — which `TextEncoder` then turns into U+FFFD, and the vault ends up
 * named "🚀🚀�" on chain, permanently. Emoji names are otherwise fully supported: Move's
 * `String` is just UTF-8 bytes, and a vault titled "🚀 Moon Bot 📈" round-trips byte-for-byte
 * (verified on testnet).
 *
 * Truncation is by code point and also respects a byte budget, since Move length limits are
 * in bytes and an emoji costs four of them.
 */
export function truncateDisplayName(raw: string, maxUnits = 64, maxBytes = 120): string {
  const trimmed = raw.trim();
  if (trimmed.length <= maxUnits && new TextEncoder().encode(trimmed).length <= maxBytes) {
    return trimmed;
  }
  let out = "";
  let bytes = 0;
  for (const ch of trimmed) {
    const chBytes = new TextEncoder().encode(ch).length;
    if (out.length + ch.length > maxUnits || bytes + chBytes > maxBytes) break;
    out += ch;
    bytes += chBytes;
  }
  return out.trim();
}

/**
 * A share symbol Decibel will accept, derived from the name so nobody has to invent one.
 *
 * Decibel's symbol field is alphanumeric in practice, so emoji and non-Latin names strip to
 * nothing. Rather than give every such vault the same fallback, mix in a short hash of the
 * full name so "🚀" and "📈" don't both become "sSEAL".
 */
export function deriveShareSymbol(name: string): string {
  const alnum = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (alnum) return `s${alnum}`;
  let h = 0;
  for (const cp of name) h = (h * 31 + (cp.codePointAt(0) ?? 0)) >>> 0;
  return `sV${h.toString(36).toUpperCase().slice(0, 6)}`;
}

/** Hex string -> plain number array, the only `vector<u8>` encoding that is unambiguous to
 *  the Aptos SDK *and* JSON-serializable across the API boundary. Accepts "0x" as empty. */
export function hexToBytes(hex: string): number[] {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const b = Number.parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(b)) throw new Error(`invalid hex: ${hex}`);
    out.push(b);
  }
  return out;
}

export function buildCreateSealedVaultPayload(args: {
  packageAddress: string;
  programCommitment: string;
  attestorPubkey: string;
  decibelVaultAddr: string;
  market: SealedMarket;
  pctBps: number;
  maxLeverageX100: number;
  minBarIntervalS: number;
  slippageBps: number;
  traceCapacity: number;
  /** Tier-2 TEE measurement, or "0x" for tier-1 bare-key attestation. */
  enclaveMeasurement?: string;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::create_sealed_vault`,
    typeArguments: [] as string[],
    functionArguments: [
      // `vector<u8>` args must be byte arrays. The SDK encodes a JS string as UTF-8, so a
      // "0x…" hex string arrives as 66 bytes and trips E_BAD_COMMITMENT / E_BAD_PUBKEY.
      // `number[]` is unambiguous and, unlike Uint8Array, survives the JSON hop to the client.
      hexToBytes(args.programCommitment),
      hexToBytes(args.attestorPubkey),
      args.decibelVaultAddr,
      args.market.addr,
      args.market.sizeDecimalsPow,
      args.market.lotSize,
      args.market.minSize,
      args.market.tickerSize,
      String(args.pctBps),
      String(args.maxLeverageX100),
      String(args.minBarIntervalS),
      String(args.slippageBps),
      String(args.traceCapacity),
      // Sealed at birth — there is no separate seal() call. See sealed_vault.move.
      hexToBytes(args.enclaveMeasurement ?? "0x"),
    ],
  };
}

/**
 * Live platform terms, straight from the contract.
 *
 * The launch fee and builder fee are admin-settable on chain, so quoting them from a constant
 * would let the UI display a price that is no longer the price. Falls back to the deployment
 * defaults only when the module is unpublished or unconfigured.
 */
export async function readPlatformTerms(network?: "testnet" | "mainnet"): Promise<{
  launchFeeUsdc: number;
  treasury: string | null;
  builderAddr: string | null;
  builderFeeBps: number;
  onChain: boolean;
}> {
  const net = network ?? sealedNetwork();
  const fallback = {
    launchFeeUsdc: PLATFORM_LAUNCH.launchFeeUsdc,
    treasury: null,
    builderAddr: null,
    builderFeeBps: PLATFORM_LAUNCH.builderFeeBps,
    onChain: false,
  };
  if (!SEALED_PACKAGE) return fallback;
  try {
    const url =
      net === "mainnet"
        ? "https://api.mainnet.aptoslabs.com/v1/view"
        : "https://api.testnet.aptoslabs.com/v1/view";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        function: `${SEALED_PACKAGE}::sealed_vault::platform_terms`,
        type_arguments: [],
        arguments: [],
      }),
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const [feeUnits, treasury, builderAddr, builderFeeBps] = (await res.json()) as [
      string, string, string, string,
    ];
    return {
      launchFeeUsdc: Number(feeUnits) / 1e6,
      treasury,
      builderAddr,
      builderFeeBps: Number(builderFeeBps),
      onChain: true,
    };
  } catch {
    return fallback;
  }
}

/** Is this Decibel vault already licensed — i.e. is swapping its algo free? */
export async function isVaultLicensed(
  decibelVaultAddr: string,
  network?: "testnet" | "mainnet",
): Promise<boolean> {
  if (!SEALED_PACKAGE) return false;
  const net = network ?? sealedNetwork();
  try {
    const url =
      net === "mainnet"
        ? "https://api.mainnet.aptoslabs.com/v1/view"
        : "https://api.testnet.aptoslabs.com/v1/view";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        function: `${SEALED_PACKAGE}::sealed_vault::is_licensed`,
        type_arguments: [],
        arguments: [decibelVaultAddr],
      }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    return ((await res.json()) as [boolean])[0] === true;
  } catch {
    return false;
  }
}

/** Publicly schedule a replacement strategy, starting the depositor-notice clock. */
export function buildAnnounceSwapPayload(args: {
  packageAddress: string;
  strategyVaultAddr: string;
}) {
  return {
    function: `${args.packageAddress}::sealed_vault::announce_swap`,
    typeArguments: [] as string[],
    functionArguments: [args.strategyVaultAddr],
  };
}

export interface SwapStatus {
  isSwap: boolean;
  announcedAt: number;
  tradableAt: number;
  expiresAt: number;
  needsNotice: boolean;
}

/** Where a replacement strategy stands against its notice period. */
export async function readSwapStatus(
  strategyVaultAddr: string,
  network?: "testnet" | "mainnet",
): Promise<SwapStatus | null> {
  if (!SEALED_PACKAGE) return null;
  const net = network ?? sealedNetwork();
  try {
    const url =
      net === "mainnet"
        ? "https://api.mainnet.aptoslabs.com/v1/view"
        : "https://api.testnet.aptoslabs.com/v1/view";
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        function: `${SEALED_PACKAGE}::sealed_vault::swap_status`,
        type_arguments: [],
        arguments: [strategyVaultAddr],
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const [isSwap, announcedAt, tradableAt, expiresAt, needsNotice] = (await res.json()) as [
      boolean, string, string, string, boolean,
    ];
    return {
      isSwap,
      announcedAt: Number(announcedAt),
      tradableAt: Number(tradableAt),
      expiresAt: Number(expiresAt),
      needsNotice,
    };
  } catch {
    return null;
  }
}

/** Revoke a strategy's trading rights. Step one of a swap. */
export function buildRevokeDelegationPayload(args: {
  decibelPackage: string;
  decibelVaultAddr: string;
  strategyVaultAddrs: string[];
}) {
  return {
    function: `${args.decibelPackage}::vault_admin_api::revoke_dex_actions_delegation`,
    typeArguments: [] as string[],
    functionArguments: [args.decibelVaultAddr, args.strategyVaultAddrs],
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

/**
 * Both Decibel-side payloads (vault creation and delegation) are built by the audited
 * builders in lib/decibel-vaults.ts, not re-derived here. Those already validate addresses,
 * bound every string, parse the funding amount and resolve the subaccount, and they are
 * covered by `pnpm test:reliability`. A second implementation of the same two entry calls is
 * exactly how the arg lists drift apart.
 */

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

export function sealedNetwork(): "testnet" | "mainnet" {
  return (process.env.NEXT_PUBLIC_DECIBEL_NETWORK ?? process.env.DECIBEL_NETWORK) === "mainnet"
    ? "mainnet"
    : "testnet";
}

export const DECIBEL_VAULT_PACKAGE =
  process.env.DECIBEL_VAULT_PACKAGE ?? DECIBEL_PACKAGE_BY_NETWORK[sealedNetwork()];

/** USDC fungible-asset metadata object per network — the vault's contribution asset. */
export const USDC_METADATA_BY_NETWORK: Record<"testnet" | "mainnet", string> = {
  testnet: "0x5428acf5c112826d0c74ae1cd2de9030f53d1d01235e6c2621d967bf914ee1c8",
  mainnet: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
};

/**
 * The caller's primary Decibel subaccount address, derived rather than queried.
 *
 * Decibel creates it as a named object under a `GlobalSubaccountManager` deriver, so the
 * address is a pure function of (package, owner). Deriving means the launch flow needs no
 * view call and works even before the subaccount exists on chain — we can show the user what
 * their address *will* be and check its balance in one shot.
 * Mirrors `derivePrimarySubaccountAddress` in lib/decibel-chain.ts.
 */
export function derivePrimarySubaccount(owner: string, network?: "testnet" | "mainnet"): string {
  const pkg = AccountAddress.fromString(DECIBEL_PACKAGE_BY_NETWORK[network ?? sealedNetwork()]);
  const deriver = createObjectAddress(pkg, new TextEncoder().encode("GlobalSubaccountManager"));
  const seed = new Uint8Array([
    ...AccountAddress.fromString(owner).toUint8Array(),
    ...new MoveString("primary_subaccount").bcsToBytes(),
  ]);
  return createObjectAddress(deriver, seed).toString();
}
