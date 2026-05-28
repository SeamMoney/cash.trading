import { NextRequest, NextResponse } from "next/server";
import { buildDecibelCollateralPayload } from "@/lib/decibel";

/**
 * POST /api/decibel/deposit
 * Build a Decibel collateral deposit payload for the client to sign.
 *
 * Body: { subaccount: string, amount: string }
 *   - amount in raw USDC units (6 decimals)
 */
export async function POST(req: NextRequest) {
  try {
    const { subaccount, amount } = await req.json();

    if (!subaccount || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: subaccount, amount" },
        { status: 400 }
      );
    }

    const payload = buildDecibelCollateralPayload({
      action: "deposit",
      subaccount,
      amount,
    });

    return NextResponse.json({ payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build deposit tx";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
