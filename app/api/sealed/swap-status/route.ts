/**
 * GET /api/sealed/swap-status?addr=0x…
 *
 * Where a replacement strategy stands against its depositor-notice period, read from chain.
 *
 * The UI cannot compute this itself: whether notice is required depends on who currently holds
 * vault shares, which changes every time someone deposits or redeems. A creator who was alone
 * when they started a swap may not be alone by the time they finish it, so the answer has to be
 * re-read rather than cached at the start of the flow.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isHexAddress, readSwapStatus, sealedNetwork } from "@/lib/sealed-vaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-swap-status", 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }
  const addr = request.nextUrl.searchParams.get("addr");
  if (!addr || !isHexAddress(addr)) {
    return NextResponse.json({ error: "addr required" }, { status: 400, headers: NO_STORE });
  }
  const status = await readSwapStatus(addr, sealedNetwork());
  if (!status) {
    return NextResponse.json(
      { error: "could not read swap status — is the sealed module published here?" },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { ok: true, ...status, now: Math.floor(Date.now() / 1000) },
    { status: 200, headers: NO_STORE },
  );
}
