/**
 * GET  /api/sealed/vaults?network=testnet   — the sealed-vault feed (traders)
 * POST /api/sealed/vaults                   — register a vault after create/seal
 *
 * The registry deliberately stores no PineScript. Registration binds the
 * on-chain object to its display metadata, and every field that matters to a
 * depositor (commitment, attestor key, rule set) is re-read from chain on the
 * detail route rather than trusted from this row.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { prisma } from "@/lib/prisma";
import {
  proveSealedVaultRegistration,
  SealedRegistryProofError,
} from "@/lib/sealed-registry-proof";
import { encryptSource, sourceVaultAvailable } from "@/lib/sealed-source-vault";
import {
  MAX_PINE_BYTES,
  SEALED_PACKAGE,
  findSealedMarket,
  isHex32,
  isHexAddress,
  listSealedVaults,
  normalizeAddress,
  sealedNetwork,
  sealedRegistryAvailable,
  toPublicSealedVault,
  truncateDisplayName,
  verifyRevealedProgram,
} from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_MANIFEST_BYTES = 4 * 1024;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-vaults-read", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json(
      { error: "registry unavailable — DATABASE_URL is not configured", vaults: [] },
      { status: 503, headers: NO_STORE },
    );
  }
  const network = request.nextUrl.searchParams.get("network") ?? "testnet";
  // `creator` scopes the feed to one wallet's vaults — what the Manage tab needs to show a
  // creator which of their bots is live and which can be swapped.
  const creator = request.nextUrl.searchParams.get("creator");
  if (creator && !isHexAddress(creator)) {
    return NextResponse.json({ error: "invalid creator" }, { status: 400, headers: NO_STORE });
  }
  try {
    const vaults = await listSealedVaults(network, creator ?? undefined);
    return NextResponse.json({ ok: true, network, vaults }, { status: 200, headers: NO_STORE });
  } catch (err) {
    console.error("[sealed/vaults] list failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "registry read failed", vaults: [] },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-vaults-write", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json(
      { error: "registry unavailable — DATABASE_URL is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const required = ["strategyVaultAddr", "packageAddress", "creatorAddr", "decibelVaultAddr"];
  for (const key of required) {
    if (!isHexAddress(body[key])) {
      return NextResponse.json(
        { error: `${key} must be a valid address` },
        { status: 400, headers: NO_STORE },
      );
    }
  }
  if (!isHex32(body.programCommitment)) {
    return NextResponse.json(
      { error: "programCommitment must be 32 bytes of hex" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!isHex32(body.attestorPubkey)) {
    return NextResponse.json(
      { error: "attestorPubkey must be a 32-byte ed25519 key" },
      { status: 400, headers: NO_STORE },
    );
  }
  // Same code-point-safe truncation the on-chain name uses, so the registry row and the
  // vault's on-chain title cannot disagree on an emoji boundary.
  const name = typeof body.name === "string" ? truncateDisplayName(body.name) : "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400, headers: NO_STORE });
  }
  const market = findSealedMarket(typeof body.market === "string" ? body.market : "BTC/USD");
  if (!market) {
    return NextResponse.json({ error: "unknown market" }, { status: 400, headers: NO_STORE });
  }
  if (typeof body.manifestJson !== "string" || !body.manifestJson) {
    return NextResponse.json(
      { error: "manifestJson required (needed to verify a later reveal)" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (Buffer.byteLength(body.manifestJson, "utf8") > MAX_MANIFEST_BYTES) {
    return NextResponse.json(
      { error: `manifestJson exceeds ${MAX_MANIFEST_BYTES} bytes` },
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    const manifest = JSON.parse(body.manifestJson) as Record<string, unknown>;
    if (
      !manifest ||
      typeof manifest !== "object" ||
      typeof manifest.transpiler !== "string" ||
      typeof manifest.module !== "string" ||
      normalizeAddress(manifest.marketAddr) !== normalizeAddress(market.addr)
    ) {
      throw new Error("invalid manifest");
    }
  } catch {
    return NextResponse.json(
      { error: "manifestJson is not a valid sealed-program manifest" },
      { status: 400, headers: NO_STORE },
    );
  }
  for (const field of ["createTxHash", "sealTxHash"] as const) {
    if (body[field] !== undefined && body[field] !== null && !TX_HASH.test(String(body[field]))) {
      return NextResponse.json(
        { error: `${field} must be a 32-byte transaction hash` },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  // The registry is an execution allowlist, not a client-authored index. Pin both values to
  // the server configuration so a caller cannot point the cron at an unrelated package or
  // smuggle a testnet object into the mainnet working set.
  const network = sealedNetwork();
  if (body.network !== network) {
    return NextResponse.json(
      { error: `network must match the configured ${network} deployment` },
      { status: 400, headers: NO_STORE },
    );
  }
  const configuredPackage = normalizeAddress(SEALED_PACKAGE);
  if (!configuredPackage) {
    return NextResponse.json(
      { error: "sealed vault module is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }
  const requestedPackage = normalizeAddress(body.packageAddress);
  if (requestedPackage !== configuredPackage) {
    return NextResponse.json(
      { error: "packageAddress does not match the configured sealed-vault package" },
      { status: 400, headers: NO_STORE },
    );
  }

  // The allowlist, in order. Order is load-bearing — an action's `market_idx` addresses the
  // on-chain list positionally, so a resolved-but-reordered list could place a real order on
  // the wrong book.
  const allowlist: Array<NonNullable<ReturnType<typeof findSealedMarket>>> = [];
  if (Array.isArray(body.markets)) {
    for (const n of body.markets) {
      const m = findSealedMarket(typeof n === "string" ? n : "");
      if (!m) {
        return NextResponse.json(
          { error: `unknown market in allowlist: ${String(n)}` },
          { status: 400, headers: NO_STORE },
        );
      }
      if (allowlist.some((listed) => listed.addr === m.addr)) {
        return NextResponse.json(
          { error: `market ${m.name} listed twice in the allowlist` },
          { status: 400, headers: NO_STORE },
        );
      }
      allowlist.push(m);
    }
  }
  if (allowlist.length === 0) allowlist.push(market);
  const vaultKind = allowlist.length > 1 ? "portfolio" : "single";

  const boundedInteger = (
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ): number | null => {
    const parsed = value === undefined || value === null ? fallback : Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const pctBps = boundedInteger(body.pctBps, 1000, 1, 10_000);
  const maxLeverageX100 = boundedInteger(
    body.maxLeverageX100,
    200,
    100,
    2_000,
  );
  const minBarIntervalS = boundedInteger(
    body.minBarIntervalS,
    60,
    1,
    86_400,
  );
  if (pctBps === null || maxLeverageX100 === null || minBarIntervalS === null) {
    return NextResponse.json(
      { error: "vault limits are invalid" },
      { status: 400, headers: NO_STORE },
    );
  }

  // This is the authorization boundary. Nothing is encrypted or written until the immutable
  // creator, vault, commitment, attestor, market list, engine parameters and limits have all
  // been read from the actual Move resource and matched to this request.
  let proof: Awaited<ReturnType<typeof proveSealedVaultRegistration>>;
  try {
    proof = await proveSealedVaultRegistration({
      network,
      packageAddress: configuredPackage,
      strategyVaultAddr: normalizeAddress(body.strategyVaultAddr)!,
      creatorAddr: normalizeAddress(body.creatorAddr)!,
      decibelVaultAddr: normalizeAddress(body.decibelVaultAddr)!,
      programCommitment: (body.programCommitment as string).toLowerCase(),
      attestorPubkey: (body.attestorPubkey as string).toLowerCase(),
      vaultKind,
      markets: allowlist,
      pctBps,
      maxLeverageX100,
      minBarIntervalS,
    });
  } catch (err) {
    if (err instanceof SealedRegistryProofError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status, headers: NO_STORE },
      );
    }
    console.error("[sealed/vaults] chain proof failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "could not verify the sealed strategy on-chain" },
      { status: 503, headers: NO_STORE },
    );
  }

  // A creator who chose "Public" publishes the source at launch. We do NOT take their word
  // for it: the Pine is re-hashed against the manifest and must reproduce the commitment that
  // is about to be written on-chain. Storing an unverified reveal would let a vault display
  // one strategy while executing another — the exact failure the commitment exists to prevent.
  let revealedPine: string | null = null;
  if (typeof body.revealedPine === "string" && body.revealedPine.trim()) {
    if (body.revealedPine.length > MAX_PINE_BYTES) {
      return NextResponse.json(
        { error: `revealed source exceeds ${MAX_PINE_BYTES} bytes` },
        { status: 400, headers: NO_STORE },
      );
    }
    const check = verifyRevealedProgram({
      pine: body.revealedPine,
      manifestJson: body.manifestJson,
      expectedCommitment: body.programCommitment as string,
      marketAddr: market.addr,
    });
    if (!check.matches) {
      return NextResponse.json(
        {
          error:
            "the revealed source does not hash to the vault's commitment — refusing to publish it",
          expected: (body.programCommitment as string).toLowerCase(),
          got: check.recomputed,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    revealedPine = body.revealedPine;
  }

  // Managed attestation: the creator asked us to run their program for them. We store the
  // source encrypted (AES-256-GCM, key in SEALED_SOURCE_KEY, never in this table) and verify
  // it reproduces the vault's commitment first — signing for a program the vault did not
  // commit to is the one thing the attestor must never do.
  let managed: { managedAttestation: boolean; encryptedPine: string | null; encryptedPineIv: string | null; encryptedPineTag: string | null } = {
    managedAttestation: false,
    encryptedPine: null,
    encryptedPineIv: null,
    encryptedPineTag: null,
  };
  if (typeof body.managedPine === "string" && body.managedPine.trim()) {
    if (!sourceVaultAvailable()) {
      return NextResponse.json(
        { error: "managed attestation is unavailable — SEALED_SOURCE_KEY is not configured" },
        { status: 501, headers: NO_STORE },
      );
    }
    if (body.managedPine.length > MAX_PINE_BYTES) {
      return NextResponse.json(
        { error: `strategy source exceeds ${MAX_PINE_BYTES} bytes` },
        { status: 400, headers: NO_STORE },
      );
    }
    const check = verifyRevealedProgram({
      pine: body.managedPine,
      manifestJson: body.manifestJson,
      expectedCommitment: body.programCommitment as string,
      marketAddr: market.addr,
    });
    if (!check.matches) {
      return NextResponse.json(
        {
          error:
            "the source given for managed attestation does not hash to the vault's commitment",
          expected: (body.programCommitment as string).toLowerCase(),
          got: check.recomputed,
        },
        { status: 400, headers: NO_STORE },
      );
    }
    const blob = encryptSource(body.managedPine, body.strategyVaultAddr as string);
    managed = {
      managedAttestation: true,
      encryptedPine: blob.ciphertext,
      encryptedPineIv: blob.iv,
      encryptedPineTag: blob.tag,
    };
  }

  const data = {
    strategyVaultAddr: proof.strategyVaultAddr,
    packageAddress: proof.packageAddress,
    network,
    creatorAddr: proof.creatorAddr,
    decibelVaultAddr: proof.decibelVaultAddr,
    marketAddr: allowlist[0].addr,
    marketName: allowlist[0].name,
    vaultKind,
    marketNames: allowlist.length > 1 ? allowlist.map((listed) => listed.name).join(",") : null,
    programCommitment: proof.programCommitment,
    attestorPubkey: proof.attestorPubkey,
    enclaveMeasurement: proof.enclaveMeasurement,
    name,
    description:
      typeof body.description === "string" ? truncateDisplayName(body.description, 500, 1500) : null,
    pctBps,
    maxLeverageX100,
    minBarIntervalS,
    manifestJson: body.manifestJson,
    createTxHash: typeof body.createTxHash === "string" ? body.createTxHash.toLowerCase() : null,
    sealTxHash: typeof body.sealTxHash === "string" ? body.sealTxHash.toLowerCase() : null,
    sealedAt: new Date(),
    revealedPine,
    revealedAt: revealedPine ? new Date() : null,
    ...managed,
  };

  // A swap registers the replacement and retires its predecessor. Both writes have to land or
  // neither: registering alone leaves two strategies in the cron's working set for one Decibel
  // vault, and retiring alone leaves the vault with no strategy being ticked at all. The chain
  // has already revoked the outgoing delegation by the time this is called, so the retirement
  // is recording a fact, not making a decision.
  // A list, not one address: a Decibel vault can end up with several stale strategies if an
  // earlier swap was abandoned between its create and its handover. The handover revokes all of
  // them in one transaction, so all of them get retired in one write.
  const retires: string[] = [];
  const claimed = Array.isArray(body.retiresStrategyVaultAddrs)
    ? body.retiresStrategyVaultAddrs
    : body.retiresStrategyVaultAddr !== undefined
      ? [body.retiresStrategyVaultAddr]
      : [];
  for (const raw of claimed) {
    if (!isHexAddress(raw)) {
      return NextResponse.json(
        { error: "retiresStrategyVaultAddrs must all be valid addresses" },
        { status: 400, headers: NO_STORE },
      );
    }
    const outgoing = raw as string;
    if (outgoing.toLowerCase() === data.strategyVaultAddr.toLowerCase()) {
      return NextResponse.json(
        { error: "a strategy cannot retire itself" },
        { status: 400, headers: NO_STORE },
      );
    }
    // Same server-side authorization as /api/sealed/pending-swap: there is no wallet-signature
    // auth here, so the claim is checked against what is already registered. Each outgoing
    // strategy must belong to the same creator AND the same Decibel vault — otherwise anyone
    // could silently retire a stranger's live vault by registering a throwaway one.
    const prior = await prisma.sealedVault
      .findUnique({
        where: { strategyVaultAddr: outgoing },
        select: { creatorAddr: true, decibelVaultAddr: true },
      })
      .catch(() => null);
    if (!prior) {
      return NextResponse.json(
        { error: `${outgoing} is not registered, so it cannot be retired` },
        { status: 404, headers: NO_STORE },
      );
    }
    if (prior.creatorAddr.toLowerCase() !== data.creatorAddr.toLowerCase()) {
      return NextResponse.json(
        { error: "a strategy being retired belongs to a different creator" },
        { status: 403, headers: NO_STORE },
      );
    }
    if (prior.decibelVaultAddr.toLowerCase() !== data.decibelVaultAddr.toLowerCase()) {
      return NextResponse.json(
        { error: "a strategy being retired trades a different Decibel vault" },
        { status: 403, headers: NO_STORE },
      );
    }
    if (!retires.includes(outgoing)) retires.push(outgoing);
  }

  try {
    const write = prisma.sealedVault.upsert({
      where: { strategyVaultAddr: data.strategyVaultAddr },
      create: data,
      // Re-registration updates the display and lifecycle fields while refreshing every
      // immutable execution field from the chain proof above.
      update: {
        // These fields are immutable on-chain. Writing the verified values on every
        // registration also repairs any row created before chain-bound registration existed.
        packageAddress: data.packageAddress,
        network: data.network,
        creatorAddr: data.creatorAddr,
        decibelVaultAddr: data.decibelVaultAddr,
        marketAddr: data.marketAddr,
        marketName: data.marketName,
        vaultKind: data.vaultKind,
        marketNames: data.marketNames,
        programCommitment: data.programCommitment,
        attestorPubkey: data.attestorPubkey,
        enclaveMeasurement: data.enclaveMeasurement,
        pctBps: data.pctBps,
        maxLeverageX100: data.maxLeverageX100,
        minBarIntervalS: data.minBarIntervalS,
        manifestJson: data.manifestJson,
        name: data.name,
        description: data.description,
        sealTxHash: data.sealTxHash ?? undefined,
        sealedAt: new Date(),
        // A reveal is one-way: once published the source stays published, and a later
        // re-registration without it must not silently un-reveal the vault.
        revealedPine: revealedPine ?? undefined,
        revealedAt: revealedPine ? new Date() : undefined,
        // Re-registering with a source re-arms managed attestation; without one, leave the
        // existing arrangement alone rather than silently switching a live vault off.
        ...(managed.managedAttestation ? managed : {}),
        // Re-registering a live vault must never resurrect a retired one by omission, and must
        // never retire a live one either — retirement is driven only by the branch below.
      },
    });
    const row =
      retires.length > 0
        ? (
            await prisma.$transaction([
              write,
              prisma.sealedVault.updateMany({
                where: { strategyVaultAddr: { in: retires }, retiredAt: null },
                data: { retiredAt: new Date(), retiredBy: data.strategyVaultAddr },
              }),
            ])
          )[0]
        : await write;
    return NextResponse.json(
      { ok: true, vault: toPublicSealedVault(row), retired: retires },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    console.error("[sealed/vaults] upsert failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "registry write failed" }, { status: 503, headers: NO_STORE });
  }
}
