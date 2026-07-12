import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_000;
const U64_MAX = 18_446_744_073_709_551_615n;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

function normalizeU64(value: unknown, field: string, allowZero: boolean): string {
  let decimal: string;
  if (typeof value === "string") decimal = value.trim();
  else if (typeof value === "bigint") decimal = value.toString();
  else if (typeof value === "number" && Number.isSafeInteger(value)) decimal = String(value);
  else throw new Error(`${field} must be an unsigned integer`);
  if (!/^\d+$/.test(decimal)) throw new Error(`${field} must be an unsigned integer`);
  const normalized = BigInt(decimal);
  if ((!allowZero && normalized === 0n) || normalized > U64_MAX) {
    throw new Error(`${field} is outside the u64 range`);
  }
  return normalized.toString();
}

/**
 * GET /api/launchpad/curve?address=0x...
 * Get bonding curve state + price history for an indicator.
 *
 * POST /api/launchpad/curve
 * Build a buy/sell transaction payload for the bonding curve.
 */

export async function GET(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-curve-read", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }
  const url = new URL(req.url);
  const address = url.searchParams.get("address");

  if (!isValidAptosAddress(address)) {
    return NextResponse.json(
      { error: "A valid address param is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      unavailable: true,
      reason: "bonding_curve_not_deployed",
      address: normalizeAptosAddress(address, "address"),
    },
    { status: 501, headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-curve-payload", 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const launchpadPackage = process.env.LAUNCHPAD_PACKAGE;
  if (!launchpadPackage) {
    return NextResponse.json(
      { unavailable: true, reason: "bonding_curve_not_deployed" },
      { status: 501, headers: NO_STORE_HEADERS },
    );
  }
  if (!isValidAptosAddress(launchpadPackage)) {
    return NextResponse.json(
      { unavailable: true, reason: "bonding_curve_configuration_invalid" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const normalizedPackage = normalizeAptosAddress(launchpadPackage, "LAUNCHPAD_PACKAGE");

  try {
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body is too large" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request body is too large" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const { action, curveAddr, amount, minOut, signerAddr } = body;

    if (
      (action !== "buy" && action !== "sell") ||
      !isValidAptosAddress(curveAddr) ||
      !isValidAptosAddress(signerAddr)
    ) {
      return NextResponse.json(
        { error: "action, curveAddr, or signerAddr is invalid" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const normalizedCurve = normalizeAptosAddress(curveAddr, "curveAddr");
    const normalizedAmount = normalizeU64(amount, "amount", false);
    const normalizedMinOut = normalizeU64(minOut ?? "0", "minOut", true);

    // Build Move entry function payload
    if (action === "buy") {
      return NextResponse.json({
        payload: {
          function: `${normalizedPackage}::bonding_curve::buy`,
          typeArguments: [],
          functionArguments: [normalizedCurve, normalizedAmount, normalizedMinOut],
        },
        description: `Buy indicator tokens with ${normalizedAmount} octas APT`,
      }, { headers: NO_STORE_HEADERS });
    }

    return NextResponse.json({
      payload: {
        function: `${normalizedPackage}::bonding_curve::sell`,
        typeArguments: [],
        functionArguments: [normalizedCurve, normalizedAmount, normalizedMinOut],
      },
      description: `Sell ${normalizedAmount} indicator tokens for APT`,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "Request body must be valid JSON"
      : error instanceof Error
        ? error.message
        : "Invalid bonding curve request";
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
  }
}
