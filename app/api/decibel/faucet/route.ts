import { NextRequest, NextResponse } from "next/server";
import {
  type DecibelNetwork,
  getDecibelPackage,
  getReadDex,
  USDC_DECIMALS,
} from "@/lib/decibel";

/**
 * POST /api/decibel/faucet
 * Build a Decibel testnet USDC restricted-mint payload for the connected
 * wallet to sign. This mints Decibel's collateral token, not the app-wide
 * Aave/testnet USDC token used by /api/faucet.
 *
 * Body: { amount?: string } where amount is raw USDC units.
 */
function getBodyNetwork(value: unknown): DecibelNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const network = getBodyNetwork(body.network);
    if (network === "mainnet") {
      return NextResponse.json(
        { error: "Decibel USDC faucet is testnet-only" },
        { status: 403 },
      );
    }

    const amount = String(body.amount ?? "1000000000"); // 1,000 USDC
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      return NextResponse.json(
        { error: "amount must be a positive raw integer" },
        { status: 400 },
      );
    }

    const pkg = getDecibelPackage("testnet");
    return NextResponse.json({
      payload: {
        function: `${pkg}::usdc::restricted_mint`,
        typeArguments: [],
        functionArguments: [amount],
      },
      token: "USDC",
      amount,
      decimals: USDC_DECIMALS,
      formatted: (Number(amount) / 10 ** USDC_DECIMALS).toLocaleString(),
      note: "This mints Decibel testnet USDC collateral to the signing wallet.",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build Decibel faucet tx";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const network = req.nextUrl.searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";
  if (network === "mainnet") {
    return NextResponse.json({
      enabled: false,
      reason: "Decibel USDC faucet is testnet-only",
    });
  }

  try {
    const dex = getReadDex("testnet");
    const [remaining, resetAt] = await Promise.all([
      dex.mintsRemaining().catch(() => null),
      dex.getTriggerResetMintTs().catch(() => null),
    ]);
    return NextResponse.json({
      enabled: true,
      remaining,
      resetAt,
      token: "USDC",
      decimals: USDC_DECIMALS,
    });
  } catch {
    return NextResponse.json({
      enabled: true,
      remaining: null,
      resetAt: null,
      token: "USDC",
      decimals: USDC_DECIMALS,
    });
  }
}
