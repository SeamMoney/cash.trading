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

  // In production: read from Aptos view function
  // bonding_curve::get_curve_state(address) → (apt_reserves, fa_reserves, virtual_apt, is_graduated, total_raised, sims_funded)
  // bonding_curve::get_price(address) → price_scaled

  // For now, return mock structure showing the expected shape
  return NextResponse.json({
    address,
    aptReserves: 0,
    faReserves: 1_000_000_000_000,
    virtualApt: 5_000_000_000,
    isGraduated: false,
    totalRaised: 0,
    simsFunded: 0,
    currentPrice: 0.00005, // APT per token
    marketCap: 50, // APT
    // Price history would come from indexer events
    priceHistory: [],
  });
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

    // Build Move entry function payload
    if (action === "buy") {
      return NextResponse.json({
        payload: {
          function: `${process.env.LAUNCHPAD_PACKAGE || "0x1"}::bonding_curve::buy`,
          type_arguments: [],
          arguments: [curveAddr, amount.toString(), (minOut || "0").toString()],
        },
        description: `Buy indicator tokens with ${amount} octas APT`,
      });
    }

    if (action === "sell") {
      return NextResponse.json({
        payload: {
          function: `${process.env.LAUNCHPAD_PACKAGE || "0x1"}::bonding_curve::sell`,
          type_arguments: [],
          arguments: [curveAddr, amount.toString(), (minOut || "0").toString()],
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
