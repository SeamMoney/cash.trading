import { NextResponse } from "next/server";
import { transpile } from "@/lib/launchpad/transpiler";
import { indicatorRegistry } from "../indicators/route";

export const runtime = "nodejs";

/**
 * POST /api/launchpad/create
 * Upload PineScript + creator address → transpile to Move module
 * Returns the generated Move source code for deployment.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { pineScript, creatorAddr, name, symbol, description, assets } = body;

    if (!pineScript || !creatorAddr || !name || !symbol) {
      return NextResponse.json({ error: "Missing required fields: pineScript, creatorAddr, name, symbol" }, { status: 400 });
    }

    // 1. Transpile PineScript → Move config + rich AST
    const result = transpile(pineScript, creatorAddr);

    // 2. Register in the marketplace (simulates on-chain deployment)
    const indicatorAddr = `0x${Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)).join("")}`;

    const newEntry = {
      address: indicatorAddr,
      creator: creatorAddr,
      name,
      symbol,
      description: description || "",
      assets: Array.isArray(assets) ? assets : ["BTC/USD"],
      createdAt: Date.now(),
      curveAddr: indicatorAddr,
      aptReserves: 0,
      totalRaised: 0,
      simsFunded: 0,
      isGraduated: false,
      totalSims: 0,
      meanSharpe: 0,
      profitablePct: 0,
      robustnessScore: 0,
      maxDrawdownBps: 0,
      vaultAddr: null,
      lastSignal: 0,
      lastSignalTime: 0,
      // Use transpiler-derived params in the correct order for the indicator type
      params: [result.shortPeriod, result.longPeriod, result.thirdPeriod],
      indicatorType: result.indicatorType,
    };
    indicatorRegistry.unshift(newEntry);

    return NextResponse.json({
      success: true,
      indicatorAddr,
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
      indicator: newEntry,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transpilation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
