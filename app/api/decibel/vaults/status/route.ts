import { NextRequest, NextResponse } from "next/server";

import { getReadDex, isValidAptosAddress, resolveDecibelNetwork } from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-vault-status", 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      vaultAddress?: string;
      vault?: string;
      owner?: string;
      network?: string;
    };
    const vaultAddress = body.vaultAddress ?? body.vault;

    if (
      (!vaultAddress && !body.owner) ||
      (vaultAddress !== undefined && !isValidAptosAddress(vaultAddress)) ||
      (body.owner !== undefined && !isValidAptosAddress(body.owner))
    ) {
      return NextResponse.json(
        { error: "a valid vaultAddress or owner is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const network = resolveDecibelNetwork(body.network);
    const dex = getReadDex(network);
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
      network,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch Decibel vault status";
    console.error("[decibel-vault-status] lookup failed:", message);
    return NextResponse.json(
      { error: "Decibel vault status is temporarily unavailable" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
