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
  const data = {
    decibelVaultAddr: body.decibelVaultAddr as string,
    network: sealedNetwork(),
    creatorAddr: body.creatorAddr as string,
    fromStrategyAddr: body.fromStrategyAddr as string,
    toStrategyAddr: body.toStrategyAddr as string,
    toLabel: typeof body.toLabel === "string" ? body.toLabel.slice(0, 80) : "New strategy",
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
  if (!vault || !isHexAddress(vault)) {
    return NextResponse.json({ error: "vault required" }, { status: 400, headers: NO_STORE });
  }
  await prisma.sealedPendingSwap
    .delete({ where: { decibelVaultAddr: vault } })
    .catch(() => undefined);
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
