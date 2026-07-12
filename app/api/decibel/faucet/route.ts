import { NextRequest, NextResponse } from "next/server";
import {
  type DecibelNetwork,
  getDecibelPackage,
  getReadDex,
  normalizePositiveU64,
  resolveDecibelNetwork,
  USDC_DECIMALS,
} from "@/lib/decibel";
import { checkApiRateLimit } from "@/lib/api-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function formatRawUsdc(amount: string): string {
  const padded = amount.padStart(USDC_DECIMALS + 1, "0");
  const whole = padded.slice(0, -USDC_DECIMALS).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-USDC_DECIMALS).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * POST /api/decibel/faucet
 * Build a Decibel testnet USDC restricted-mint payload for the connected
 * wallet to sign. This mints Decibel's collateral token, not the app-wide
 * Aave/testnet USDC token used by /api/faucet.
 *
 * Body: { amount?: string } where amount is raw USDC units.
 */
function getBodyNetwork(value: unknown): DecibelNetwork {
  return resolveDecibelNetwork(value);
}

export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-faucet-build", 20, 60_000);
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
    const network = getBodyNetwork(body.network);
    if (network === "mainnet") {
      return NextResponse.json(
        { error: "Decibel USDC faucet is testnet-only" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    let amount: string;
    try {
      amount = normalizePositiveU64(body.amount ?? "1000000000", "amount");
    } catch (error) {
      const message = error instanceof Error ? error.message : "amount is invalid";
      return NextResponse.json(
        { error: message },
        { status: 400, headers: NO_STORE_HEADERS },
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
      formatted: formatRawUsdc(amount),
      note: "This mints Decibel testnet USDC collateral to the signing wallet.",
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build Decibel faucet tx";
    console.error("[decibel-faucet] build failed:", message);
    return NextResponse.json(
      { error: "Could not prepare the Decibel faucet transaction" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "decibel-faucet-status", 60, 60_000);
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

  const rawNetwork = req.nextUrl.searchParams.get("network");
  if (rawNetwork !== null && rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
    return NextResponse.json(
      { error: "network must be testnet or mainnet" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const network = resolveDecibelNetwork(rawNetwork);
  if (network === "mainnet") {
    return NextResponse.json(
      {
        enabled: false,
        reason: "Decibel USDC faucet is testnet-only",
      },
      { headers: NO_STORE_HEADERS },
    );
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
    }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json({
      enabled: true,
      remaining: null,
      resetAt: null,
      token: "USDC",
      decimals: USDC_DECIMALS,
    }, { headers: NO_STORE_HEADERS });
  }
}
