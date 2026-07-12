import { NextRequest, NextResponse } from "next/server";
import {
  getDecibelCollateralMetadata,
  isValidAptosAddress,
  normalizeAptosAddress,
  normalizePositiveU64,
  resolveDecibelNetwork,
  type DecibelNetwork,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function getRequestNetwork(value: unknown): DecibelNetwork {
  return resolveDecibelNetwork(value);
}

/**
 * POST /api/decibel/transfer-usdc
 * Build a wallet-signed USDC transfer payload. Used after withdrawing Decibel
 * collateral to the owner wallet when the final destination is another address.
 */
export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-transfer-usdc-build", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rate.retryAfterS ?? 60),
        },
      },
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "A valid JSON object is required" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const { recipient, amount, network: rawNetwork } = body;
    if (!recipient || amount === undefined || amount === null) {
      return NextResponse.json(
        { error: "Missing required fields: recipient, amount" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    if (
      !isValidAptosAddress(recipient) ||
      (rawNetwork !== undefined && rawNetwork !== "testnet" && rawNetwork !== "mainnet")
    ) {
      return NextResponse.json(
        { error: "recipient or network is invalid" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let amountRaw: string;
    try {
      amountRaw = normalizePositiveU64(amount, "amount");
    } catch (error) {
      const message = error instanceof Error ? error.message : "amount is invalid";
      return NextResponse.json(
        { error: message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const network = getRequestNetwork(rawNetwork);
    const payload = {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [
        getDecibelCollateralMetadata(network),
        normalizeAptosAddress(recipient, "recipient"),
        amountRaw,
      ],
    };

    return NextResponse.json(
      { payload, network },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build USDC transfer tx";
    console.error("[decibel-transfer-usdc] build failed:", message);
    return NextResponse.json(
      { error: "Could not prepare the USDC transfer transaction" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
