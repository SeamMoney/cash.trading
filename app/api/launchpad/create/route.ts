import { NextRequest, NextResponse } from "next/server";
import { transpile } from "@/lib/launchpad/transpiler";
import { checkApiRateLimit } from "@/lib/api-rate-limit";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";

export const runtime = "nodejs";
export const maxDuration = 15;

const APTOS_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const SUPPORTED_ASSETS = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "APT/USD"]);
const MAX_BODY_BYTES = 120_000;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

type CreateRequest = {
  pineScript?: unknown;
  creatorAddr?: unknown;
  name?: unknown;
  symbol?: unknown;
  description?: unknown;
  assets?: unknown;
};

/**
 * POST /api/launchpad/create
 * Upload PineScript + creator address → transpile to Move module
 * Returns the generated Move source code for deployment.
 */
export async function POST(req: NextRequest) {
  const rate = checkApiRateLimit(req, "launchpad-create", 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rate.retryAfterS ?? 60) },
      },
    );
  }

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
    let body: CreateRequest;
    try {
      body = JSON.parse(rawBody) as CreateRequest;
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const { pineScript, creatorAddr, name, symbol, description, assets } = body;

    if (
      typeof pineScript !== "string" || pineScript.length < 20 || pineScript.length > 100_000 ||
      typeof creatorAddr !== "string" || !APTOS_ADDRESS_RE.test(creatorAddr) ||
      !isValidAptosAddress(creatorAddr) ||
      typeof name !== "string" || name.trim().length < 1 || name.trim().length > 64 ||
      typeof symbol !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(symbol) ||
      (description !== undefined && (typeof description !== "string" || description.length > 500)) ||
      !Array.isArray(assets) || assets.length < 1 || assets.length > 4 ||
      !assets.every((asset) => typeof asset === "string" && SUPPORTED_ASSETS.has(asset))
    ) {
      return NextResponse.json(
        { error: "Invalid strategy deployment request" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const normalizedCreator = normalizeAptosAddress(creatorAddr, "creatorAddr");

    // 1. Transpile PineScript → Move config + rich AST
    const result = transpile(pineScript, normalizedCreator);

    const indicator = {
      creator: normalizedCreator,
      name: name.trim(),
      symbol,
      description: description || "",
      assets,
      params: [result.shortPeriod, result.longPeriod, result.thirdPeriod],
      indicatorType: result.indicatorType,
    };

    return NextResponse.json({
      success: true,
      indicatorAddr: null,
      moveSource: result.moveSource,
      transpile: {
        indicatorType: result.indicatorType,
        shortPeriod: result.shortPeriod,
        longPeriod: result.longPeriod,
        thirdPeriod: result.thirdPeriod,
        patternLabel: result.patternLabel,
        detectedPattern: result.detectedPattern,
        confidence: result.confidence,
        warnings: result.warnings,
        taFunctions: result.taFunctions,
        buyCondition: result.buyCondition,
        sellCondition: result.sellCondition,
      },
      indicator,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("Launchpad transpilation failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "PineScript could not be transpiled" },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }
}
