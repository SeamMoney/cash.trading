import { NextRequest, NextResponse } from "next/server";
import {
  buildDecibelCollateralPayload,
  isValidAptosAddress,
  normalizePositiveU64,
  resolveDecibelNetwork,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

/**
 * POST /api/decibel/deposit
 * Build a Decibel collateral deposit payload for the client to sign.
 *
 * Body: { subaccount: string, amount: string }
 *   - amount in raw USDC units (6 decimals)
 */
export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-deposit-build", 60, 60_000);
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
    const { subaccount, amount, network: rawNetwork } = body;

    if (!subaccount || amount === undefined || amount === null) {
      return NextResponse.json(
        { error: "Missing required fields: subaccount, amount" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (
      !isValidAptosAddress(subaccount) ||
      (rawNetwork !== undefined && rawNetwork !== "testnet" && rawNetwork !== "mainnet")
    ) {
      return NextResponse.json(
        { error: "subaccount or network is invalid" },
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
    const network = resolveDecibelNetwork(rawNetwork);

    const payload = buildDecibelCollateralPayload({
      action: "deposit",
      subaccount,
      amount: amountRaw,
      network,
    });

    return NextResponse.json(
      { payload, network },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build deposit tx";
    console.error("[decibel-deposit] build failed:", message);
    return NextResponse.json(
      { error: "Could not prepare the Decibel deposit transaction" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
