/**
 * Swaps in flight.
 *
 *   GET    ?creator=0x…   — this creator's pending swaps
 *   POST                  — record/replace one (upsert by Decibel vault)
 *   DELETE ?vault=0x…     — abandon one
 *
 * The chain records the notice schedule on the replacement strategy, but not which strategy it
 * replaces — that pairing is the creator's intent and has to live somewhere. It was in
 * localStorage, which meant clearing browser data mid-swap stranded the countdown with no
 * obvious way to finish. Nothing here is authoritative: timing always comes from
 * `sealed_vault::swap_status`, and a lost row costs the creator convenience, not funds.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { prisma } from "@/lib/prisma";
import { isHexAddress, sealedNetwork, sealedRegistryAvailable } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-pending-swap-read", 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: NO_STORE });
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json({ ok: true, swaps: [] }, { status: 200, headers: NO_STORE });
  }
  const creator = request.nextUrl.searchParams.get("creator");
  if (!creator || !isHexAddress(creator)) {
    return NextResponse.json({ error: "creator required" }, { status: 400, headers: NO_STORE });
  }
  const swaps = await prisma.sealedPendingSwap
    .findMany({
      where: { creatorAddr: { equals: creator, mode: "insensitive" }, network: sealedNetwork() },
    })
    .catch(() => []);
  return NextResponse.json({ ok: true, swaps }, { status: 200, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-pending-swap-write", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: NO_STORE });
  }
  if (!sealedRegistryAvailable()) {
    return NextResponse.json({ error: "registry unavailable" }, { status: 503, headers: NO_STORE });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  for (const k of ["decibelVaultAddr", "creatorAddr", "fromStrategyAddr", "toStrategyAddr"]) {
    if (!isHexAddress(body[k])) {
      return NextResponse.json({ error: `${k} must be an address` }, { status: 400, headers: NO_STORE });
    }
  }
  // Authorization. There is no wallet-signature auth on API routes in this app, so we verify
  // the claim server-side instead: both strategies named here must already be registered as
  // belonging to the address claiming them. Without this, anyone could write a swap record
  // against someone else's vault — the chain would still refuse to act on it, but the owner's
  // Manage tab would show a swap they never started.
  const owned = await prisma.sealedVault
    .findMany({
      where: {
        strategyVaultAddr: { in: [body.fromStrategyAddr as string, body.toStrategyAddr as string] },
        creatorAddr: { equals: body.creatorAddr as string, mode: "insensitive" },
      },
      select: { strategyVaultAddr: true, decibelVaultAddr: true },
    })
    .catch(() => []);
  // The replacement strategy is registered only after this call in some flows, so require the
  // OUTGOING one — which always exists — and check it belongs to the named vault.
  const from = owned.find(
    (o) => o.strategyVaultAddr.toLowerCase() === String(body.fromStrategyAddr).toLowerCase(),
  );
  if (!from) {
    return NextResponse.json(
      { error: "the strategy being replaced is not registered to this creator" },
      { status: 403, headers: NO_STORE },
    );
  }
  if (from.decibelVaultAddr.toLowerCase() !== String(body.decibelVaultAddr).toLowerCase()) {
    return NextResponse.json(
      { error: "that strategy does not belong to the named vault" },
      { status: 403, headers: NO_STORE },
    );
  }

  const data = {
    decibelVaultAddr: body.decibelVaultAddr as string,
    network: sealedNetwork(),
    creatorAddr: body.creatorAddr as string,
    fromStrategyAddr: body.fromStrategyAddr as string,
    toStrategyAddr: body.toStrategyAddr as string,
    toLabel: typeof body.toLabel === "string" ? body.toLabel.slice(0, 80) : "New strategy",
    // The catalog id, not the display label. The handover step re-derives the replacement's
    // commitment from it so the registry row it writes matches what is sealed on chain — and a
    // reload mid-swap must not lose that, which is the whole reason this table exists.
    toStrategyId: typeof body.toStrategyId === "string" ? body.toStrategyId.slice(0, 80) : null,
    vaultName: typeof body.vaultName === "string" ? body.vaultName.slice(0, 80) : "Vault",
    announced: body.announced === true,
  };
  try {
    // One in-flight swap per vault: starting a second replaces the first, which is what the
    // UI's "cancel and pick a different one" does.
    const row = await prisma.sealedPendingSwap.upsert({
      where: { decibelVaultAddr: data.decibelVaultAddr },
      create: data,
      update: data,
    });
    return NextResponse.json({ ok: true, swap: row }, { status: 200, headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "write failed" }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-pending-swap-write", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: NO_STORE });
  }
  const vault = request.nextUrl.searchParams.get("vault");
  const creator = request.nextUrl.searchParams.get("creator");
  if (!vault || !isHexAddress(vault)) {
    return NextResponse.json({ error: "vault required" }, { status: 400, headers: NO_STORE });
  }
  if (!creator || !isHexAddress(creator)) {
    return NextResponse.json({ error: "creator required" }, { status: 400, headers: NO_STORE });
  }
  // Scope the delete to the claimed creator. Addresses are public, so this is not
  // authentication — it stops accidents and casual tampering, not a determined griefer. The
  // blast radius is a stale UI card: the swap itself lives on-chain and is unaffected.
  // Proper wallet-signature auth is tracked in docs/DEPLOY-SEALED.md.
  await prisma.sealedPendingSwap
    .deleteMany({
      where: {
        decibelVaultAddr: vault,
        creatorAddr: { equals: creator, mode: "insensitive" },
      },
    })
    .catch(() => undefined);
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
