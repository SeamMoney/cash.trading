import { NextResponse } from "next/server";
import {
  getActiveDecibelVaults,
  getDecibelVaultFailureReason,
  getLastGoodActiveDecibelVaults,
} from "@/lib/decibel-vault-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VAULT_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
};
const VAULT_ERROR_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
};
const VAULT_UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

// Upstream /vaults regularly takes ~10s on a cold call (verified live: 10.1s,
// 10.0s, then 0.3s from its cache). Keep the last good payload so a slow or
// failed refresh serves stale-but-real data instead of an empty list.
function unavailableVaults(reason: string) {
  const lastGood = getLastGoodActiveDecibelVaults();
  if (lastGood) {
    return NextResponse.json(
      { ...lastGood, stale: true, reason },
      { headers: VAULT_ERROR_CACHE_HEADERS },
    );
  }
  return NextResponse.json(
    { vaults: [], fetchedAt: Date.now(), unavailable: true, reason },
    { status: 502, headers: VAULT_UNAVAILABLE_HEADERS },
  );
}

export async function GET() {
  try {
    return NextResponse.json(
      await getActiveDecibelVaults(),
      { headers: VAULT_CACHE_HEADERS },
    );
  } catch (error) {
    return unavailableVaults(getDecibelVaultFailureReason(error));
  }
}
