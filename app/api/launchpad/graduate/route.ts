import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Graduation is not deployed: there is no production bonding-curve package,
 * threshold verifier, or atomic Decibel vault handoff yet. Fail honestly
 * instead of returning placeholder transactions that cannot be signed.
 */
export async function POST() {
  return NextResponse.json(
    {
      unavailable: true,
      reason: "launchpad_graduation_not_deployed",
      error: "Automated strategy graduation is not deployed.",
    },
    { status: 501 },
  );
}
