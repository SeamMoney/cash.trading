import { NextResponse } from "next/server";
import { transpile } from "@/lib/launchpad/transpiler";

export const runtime = "nodejs";
export const maxDuration = 15;

const APTOS_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const SUPPORTED_ASSETS = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "APT/USD"]);

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
export async function POST(req: Request) {
  try {
    const body = await req.json() as CreateRequest;
    const { pineScript, creatorAddr, name, symbol, description, assets } = body;

    if (
      typeof pineScript !== "string" || pineScript.length < 20 || pineScript.length > 100_000 ||
      typeof creatorAddr !== "string" || !APTOS_ADDRESS_RE.test(creatorAddr) ||
      typeof name !== "string" || name.trim().length < 1 || name.trim().length > 64 ||
      typeof symbol !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(symbol) ||
      (description !== undefined && (typeof description !== "string" || description.length > 500)) ||
      !Array.isArray(assets) || assets.length < 1 || assets.length > 4 ||
      !assets.every((asset) => typeof asset === "string" && SUPPORTED_ASSETS.has(asset))
    ) {
      return NextResponse.json({ error: "Invalid strategy deployment request" }, { status: 400 });
    }

    // 1. Transpile PineScript → Move config + rich AST
    const result = transpile(pineScript, creatorAddr);

    const indicator = {
      creator: creatorAddr,
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transpilation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
