import { NextRequest, NextResponse } from "next/server";
import {
  type DecibelNetwork,
  DECIBEL_PACKAGE,
  isValidAptosAddress,
  MAINNET_DECIBEL_PACKAGE,
  resolveDecibelNetwork,
} from "@/lib/decibel";
import { getFastSubaccounts } from "@/lib/decibel-chain";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

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
  return resolveDecibelNetwork(value);
}

export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-create-subaccount", 30, 60_000);
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
    if (body.network !== undefined && body.network !== "testnet" && body.network !== "mainnet") {
      return NextResponse.json(
        { error: "network must be testnet or mainnet" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const net = getRequestNetwork(body.network);
    const owner = typeof body.owner === "string" ? body.owner : null;
    if (body.owner !== undefined && !isValidAptosAddress(owner)) {
      return NextResponse.json(
        { error: "owner must be a valid Aptos address" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (owner) {
      const existing = await getFastSubaccounts(owner, net).catch(() => []);
      if (existing.length > 0) {
        return NextResponse.json(
          {
            error: "Decibel trading account already exists.",
            subaccounts: existing,
          },
          { status: 409, headers: NO_STORE_HEADERS }
        );
      }
    }

    const pkg = net === "mainnet" ? MAINNET_DECIBEL_PACKAGE : DECIBEL_PACKAGE;

    const payload = {
      function: `${pkg}::dex_accounts_entry::create_new_subaccount`,
      typeArguments: [],
      functionArguments: [],
    };

    return NextResponse.json(
      { payload, network: net },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build create-subaccount tx";
    console.error("[decibel-create-subaccount] build failed:", message);
    return NextResponse.json(
      { error: "Could not prepare the Decibel account transaction" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
