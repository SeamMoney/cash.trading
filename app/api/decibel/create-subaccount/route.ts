import { NextRequest, NextResponse } from "next/server";
import {
  type DecibelNetwork,
  DECIBEL_PACKAGE,
  MAINNET_DECIBEL_PACKAGE,
} from "@/lib/decibel";
import { getFastSubaccounts } from "@/lib/decibel-chain";

/**
 * POST /api/decibel/create-subaccount
 * Build a Decibel subaccount creation payload for the client to sign.
 *
 * Body: { owner?: "0x..." }
 *
 * `owner` is optional for old callers, but current UI sends it so the API can
 * refuse duplicate account creation before opening a wallet signature prompt.
 */
function getRequestNetwork(value: unknown): DecibelNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const net = getRequestNetwork(body.network);
    const owner = typeof body.owner === "string" ? body.owner : null;
    if (owner) {
      const existing = await getFastSubaccounts(owner, net).catch(() => []);
      if (existing.length > 0) {
        return NextResponse.json(
          {
            error: "Decibel trading account already exists.",
            subaccounts: existing,
          },
          { status: 409 }
        );
      }
    }

    const pkg = net === "mainnet" ? MAINNET_DECIBEL_PACKAGE : DECIBEL_PACKAGE;

    const payload = {
      function: `${pkg}::dex_accounts_entry::create_new_subaccount`,
      typeArguments: [],
      functionArguments: [],
    };

    return NextResponse.json({ payload, network: net });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build create-subaccount tx";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
