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
import { encryptSource, sourceVaultAvailable } from "@/lib/sealed-source-vault";
import {
  MAX_PINE_BYTES,
  findSealedMarket,
  isHex32,
  isHexAddress,
  listSealedVaults,
  sealedRegistryAvailable,
  toPublicSealedVault,
  truncateDisplayName,
  verifyRevealedProgram,
} from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

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

  // The allowlist, in order. Order is load-bearing — an action's `market_idx` addresses the
  // on-chain list positionally, so a resolved-but-reordered list would eventually place a real
  // order on the wrong book. Unknown names are rejected rather than dropped for the same
  // reason: dropping one shifts every index after it.
  const allowlist: string[] = [];
  if (Array.isArray(body.markets)) {
    for (const n of body.markets) {
      const m = findSealedMarket(typeof n === "string" ? n : "");
      if (!m) {
        return NextResponse.json(
          { error: `unknown market in allowlist: ${String(n)}` },
          { status: 400, headers: NO_STORE },
        );
      }
      if (allowlist.includes(m.name)) {
        return NextResponse.json(
          { error: `market ${m.name} listed twice in the allowlist` },
          { status: 400, headers: NO_STORE },
        );
      }
      allowlist.push(m.name);
    }
  }
  if (allowlist.length === 0) allowlist.push(market.name);
  // Derived from the allowlist rather than trusted from the body: a record claiming
  // "portfolio" with one market would send the cron down a tick path the vault's module does
  // not implement.
  const vaultKind = allowlist.length > 1 ? "portfolio" : "single";

  const sealed = body.sealed === true;
  const data = {
    strategyVaultAddr: body.strategyVaultAddr as string,
    packageAddress: body.packageAddress as string,
    network: typeof body.network === "string" ? body.network : "testnet",
    creatorAddr: body.creatorAddr as string,
    decibelVaultAddr: body.decibelVaultAddr as string,
    marketAddr: market.addr,
    marketName: market.name,
    vaultKind,
    marketNames: allowlist.length > 1 ? allowlist.join(",") : null,
    programCommitment: (body.programCommitment as string).toLowerCase(),
    attestorPubkey: (body.attestorPubkey as string).toLowerCase(),
    enclaveMeasurement:
      typeof body.enclaveMeasurement === "string" ? body.enclaveMeasurement : null,
    name,
    description:
      typeof body.description === "string" ? truncateDisplayName(body.description, 500, 1500) : null,
    pctBps: Number(body.pctBps ?? 1000),
    maxLeverageX100: Number(body.maxLeverageX100 ?? 200),
    minBarIntervalS: Number(body.minBarIntervalS ?? 60),
    manifestJson: body.manifestJson,
    createTxHash: typeof body.createTxHash === "string" ? body.createTxHash : null,
    sealTxHash: typeof body.sealTxHash === "string" ? body.sealTxHash : null,
    sealedAt: sealed ? new Date() : null,
    revealedPine,
    revealedAt: revealedPine ? new Date() : null,
    ...managed,
  };

  try {
    const row = await prisma.sealedVault.upsert({
      where: { strategyVaultAddr: data.strategyVaultAddr },
      create: data,
      // Re-registering (e.g. after the seal step) updates the lifecycle fields.
      // The commitment and attestor key are immutable on-chain, so leave them.
      update: {
        name: data.name,
        description: data.description,
        sealTxHash: data.sealTxHash ?? undefined,
        sealedAt: sealed ? new Date() : undefined,
        enclaveMeasurement: data.enclaveMeasurement ?? undefined,
        // A reveal is one-way: once published the source stays published, and a later
        // re-registration without it must not silently un-reveal the vault.
        revealedPine: revealedPine ?? undefined,
        revealedAt: revealedPine ? new Date() : undefined,
        // Re-registering with a source re-arms managed attestation; without one, leave the
        // existing arrangement alone rather than silently switching a live vault off.
        ...(managed.managedAttestation ? managed : {}),
      },
    });
    return NextResponse.json(
      { ok: true, vault: toPublicSealedVault(row) },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    console.error("[sealed/vaults] upsert failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "registry write failed" }, { status: 503, headers: NO_STORE });
  }
}
