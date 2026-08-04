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

  const sealed = body.sealed === true;
  const data = {
    strategyVaultAddr: body.strategyVaultAddr as string,
    packageAddress: body.packageAddress as string,
    network: typeof body.network === "string" ? body.network : "testnet",
    creatorAddr: body.creatorAddr as string,
    decibelVaultAddr: body.decibelVaultAddr as string,
    marketAddr: market.addr,
    marketName: market.name,
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
