import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/launchpad/curve?address=0x...
 * Get bonding curve state + price history for an indicator.
 *
 * POST /api/launchpad/curve
 * Build a buy/sell transaction payload for the bonding curve.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");

  if (!address) {
    return NextResponse.json({ error: "Missing address param" }, { status: 400 });
  }

  return NextResponse.json(
    { unavailable: true, reason: "bonding_curve_not_deployed", address },
    { status: 501 },
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, curveAddr, amount, minOut, signerAddr } = body;

    if (!action || !curveAddr || !amount || !signerAddr) {
      return NextResponse.json(
        { error: "Missing fields: action, curveAddr, amount, signerAddr" },
        { status: 400 },
      );
    }

    const launchpadPackage = process.env.LAUNCHPAD_PACKAGE;
    if (!launchpadPackage) {
      return NextResponse.json(
        { unavailable: true, reason: "bonding_curve_not_deployed" },
        { status: 501 },
      );
    }

    // Build Move entry function payload
    if (action === "buy") {
      return NextResponse.json({
        payload: {
          function: `${launchpadPackage}::bonding_curve::buy`,
          typeArguments: [],
          functionArguments: [curveAddr, amount.toString(), (minOut || "0").toString()],
        },
        description: `Buy indicator tokens with ${amount} octas APT`,
      });
    }

    if (action === "sell") {
      return NextResponse.json({
        payload: {
          function: `${launchpadPackage}::bonding_curve::sell`,
          typeArguments: [],
          functionArguments: [curveAddr, amount.toString(), (minOut || "0").toString()],
        },
        description: `Sell ${amount} indicator tokens for APT`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build tx";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
