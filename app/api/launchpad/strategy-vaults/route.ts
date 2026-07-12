import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function databaseUnavailable() {
  if (process.env.DATABASE_URL) return null;
  return NextResponse.json(
    { unavailable: true, reason: "database_not_configured" },
    { status: 503 },
  );
}

function clampAllocationPct(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 5;
  return Math.min(100, Math.max(0.1, n));
}

export async function GET(req: Request) {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  const url = new URL(req.url);
  const owner = url.searchParams.get("owner");
  const indicator = url.searchParams.get("indicator");
  const status = url.searchParams.get("status");

  try {
    const strategyVaults = await prisma.strategyVault.findMany({
      where: {
        ...(owner ? { ownerWallet: owner } : {}),
        ...(indicator ? { indicatorAddr: indicator } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        decisions: {
          orderBy: { observedAt: "desc" },
          take: 5,
        },
        executions: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ strategyVaults });
  } catch (error) {
    console.error("[strategy-vaults] GET failed:", error);
    return NextResponse.json({ error: "Failed to load strategy vaults" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  try {
    const body = await req.json() as {
      indicatorAddr?: string;
      ownerWallet?: string;
      marketName?: string;
      allocationPct?: number;
      vaultAddr?: string | null;
      decibelSubaccount?: string | null;
      status?: string;
    };

    if (!body.indicatorAddr || !body.ownerWallet || !body.marketName) {
      return NextResponse.json(
        { error: "indicatorAddr, ownerWallet, and marketName are required" },
        { status: 400 },
      );
    }

    const vaultAddr = body.vaultAddr || undefined;
    const decibelSubaccount = body.decibelSubaccount || vaultAddr || undefined;

    const strategyVault = await prisma.strategyVault.upsert({
      where: {
        indicatorAddr_ownerWallet: {
          indicatorAddr: body.indicatorAddr,
          ownerWallet: body.ownerWallet,
        },
      },
      create: {
        indicatorAddr: body.indicatorAddr,
        ownerWallet: body.ownerWallet,
        marketName: body.marketName,
        allocationPct: clampAllocationPct(body.allocationPct),
        vaultAddr,
        decibelSubaccount,
        status: body.status ?? "ACTIVE",
      },
      update: {
        marketName: body.marketName,
        allocationPct: clampAllocationPct(body.allocationPct),
        vaultAddr,
        decibelSubaccount,
        status: body.status ?? "ACTIVE",
      },
    });

    return NextResponse.json({ success: true, strategyVault });
  } catch (error) {
    console.error("[strategy-vaults] POST failed:", error);
    return NextResponse.json({ error: "Failed to save strategy vault" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const unavailable = databaseUnavailable();
  if (unavailable) return unavailable;

  try {
    const body = await req.json() as {
      id?: string;
      indicatorAddr?: string;
      ownerWallet?: string;
      marketName?: string;
      allocationPct?: number;
      vaultAddr?: string | null;
      decibelSubaccount?: string | null;
      status?: string;
    };

    const where = body.id
      ? { id: body.id }
      : body.indicatorAddr && body.ownerWallet
        ? {
            indicatorAddr_ownerWallet: {
              indicatorAddr: body.indicatorAddr,
              ownerWallet: body.ownerWallet,
            },
          }
        : null;

    if (!where) {
      return NextResponse.json(
        { error: "id or indicatorAddr + ownerWallet is required" },
        { status: 400 },
      );
    }

    const vaultAddr = body.vaultAddr === null ? null : body.vaultAddr;
    const decibelSubaccount =
      body.decibelSubaccount === null
        ? null
        : body.decibelSubaccount ?? body.vaultAddr ?? undefined;

    const strategyVault = await prisma.strategyVault.update({
      where,
      data: {
        ...(body.marketName ? { marketName: body.marketName } : {}),
        ...(body.allocationPct !== undefined
          ? { allocationPct: clampAllocationPct(body.allocationPct) }
          : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.vaultAddr !== undefined ? { vaultAddr } : {}),
        ...(body.decibelSubaccount !== undefined || body.vaultAddr !== undefined
          ? { decibelSubaccount }
          : {}),
      },
    });

    return NextResponse.json({ success: true, strategyVault });
  } catch (error) {
    console.error("[strategy-vaults] PATCH failed:", error);
    return NextResponse.json({ error: "Failed to update strategy vault" }, { status: 500 });
  }
}
