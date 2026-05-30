import { NextRequest, NextResponse } from "next/server";

import { getReadDex } from "@/lib/decibel";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      vaultAddress?: string;
      vault?: string;
      owner?: string;
    };
    const vaultAddress = body.vaultAddress ?? body.vault;

    if (!vaultAddress && !body.owner) {
      return NextResponse.json(
        { error: "vaultAddress or owner is required" },
        { status: 400 },
      );
    }

    const dex = getReadDex();
    const [vaults, ownedVaults] = await Promise.all([
      vaultAddress
        ? dex.vaults.getVaults({ address: vaultAddress, limit: 1 })
        : Promise.resolve(null),
      body.owner
        ? dex.vaults.getUserOwnedVaults({ ownerAddr: body.owner, limit: 50 })
        : Promise.resolve(null),
    ]);
    const sharePrice = vaultAddress
      ? await dex.vaults.getVaultSharePrice({ vaultAddress }).catch(() => null)
      : null;

    return NextResponse.json({
      vaultAddress,
      vault: vaults?.items?.[0] ?? null,
      ownedVaults: ownedVaults?.items ?? [],
      sharePrice,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch Decibel vault status";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
