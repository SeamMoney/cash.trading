import { AccountAddress } from "@aptos-labs/ts-sdk";
import { NextRequest, NextResponse } from "next/server";
import { getDecibelCollateralMetadata, type DecibelNetwork } from "@/lib/decibel";

function getRequestNetwork(value: unknown): DecibelNetwork {
  return value === "mainnet" ? "mainnet" : "testnet";
}

function normalizeAddress(address: string) {
  return AccountAddress.from(address).toStringLong();
}

function normalizeAmount(amount: unknown) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error("amount must be a positive raw USDC integer");
  }
  return String(value);
}

/**
 * POST /api/decibel/transfer-usdc
 * Build a wallet-signed USDC transfer payload. Used after withdrawing Decibel
 * collateral to the owner wallet when the final destination is another address.
 */
export async function POST(req: NextRequest) {
  try {
    const { recipient, amount, network: rawNetwork } = await req.json();
    if (!recipient || !amount) {
      return NextResponse.json(
        { error: "Missing required fields: recipient, amount" },
        { status: 400 },
      );
    }

    const network = getRequestNetwork(rawNetwork);
    const payload = {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [
        getDecibelCollateralMetadata(network),
        normalizeAddress(String(recipient)),
        normalizeAmount(amount),
      ],
    };

    return NextResponse.json({ payload });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build USDC transfer tx";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
