/**
 * GET /api/sealed/config
 *
 * Everything the launch UI needs so the user doesn't have to type it. The
 * attestor public key in particular is PLATFORM-managed: asking a creator to
 * paste a 32-byte ed25519 key was the single worst piece of UX in the flow, and
 * it isn't even theirs to choose — the attestor is the service that runs their
 * committed program.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { SEALED_MARKETS, SEALED_PACKAGE } from "@/lib/sealed-vaults";
import { SEALED_PRESETS } from "@/lib/sealed-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Defaults a creator never has to think about. Bounds are enforced on-chain. */
export const SEALED_DEFAULTS = {
  pctBps: 1000, // 10% of NAV per order
  maxLeverageX100: 200, // 2x
  minBarIntervalS: 60,
  slippageBps: 30, // 0.30%
  performanceFeeBps: 1000, // 10% profit share, Hyperliquid-customary
  traceCapacity: 500,
} as const;

export async function GET(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-config", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  const attestorPubkey =
    process.env.SEALED_ATTESTOR_PUBLIC_KEY ??
    process.env.NEXT_PUBLIC_SEALED_ATTESTOR_PUBLIC_KEY ??
    null;

  // Say exactly WHICH piece is missing. "Not configured" with no detail is a
  // dead end for whoever has to fix it.
  const missing: string[] = [];
  if (!SEALED_PACKAGE) missing.push("SEALED_VAULT_PACKAGE");
  if (!attestorPubkey) missing.push("SEALED_ATTESTOR_PUBLIC_KEY");

  return NextResponse.json(
    {
      ok: true,
      packageAddress: SEALED_PACKAGE || null,
      attestorPubkey,
      missing,
      // Honest readiness signal — the UI disables deploy and says why.
      ready: Boolean(SEALED_PACKAGE && attestorPubkey),
      network:
        (process.env.NEXT_PUBLIC_DECIBEL_NETWORK ?? process.env.DECIBEL_NETWORK) === "mainnet"
          ? "mainnet"
          : "testnet",
      markets: SEALED_MARKETS.map((m) => ({ name: m.name, addr: m.addr })),
      defaults: SEALED_DEFAULTS,
      presets: Object.keys(SEALED_PRESETS),
    },
    { status: 200, headers: NO_STORE },
  );
}
