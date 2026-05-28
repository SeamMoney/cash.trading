/**
 * PineScript → Move Transpiler
 *
 * Uses the full AST parser (pine-parser.ts) to analyze PineScript and:
 *   1. Detect the indicator pattern (SMA, EMA, RSI, MACD, BB, etc.)
 *   2. Extract input parameters and their defaults
 *   3. Generate a Move module stub that deploys to the on-chain indicator contract
 *   4. Produce a rich ParseResult with UI-friendly metadata
 *
 * On-chain indicator types:
 *   0 = SMA Crossover    (short_period, long_period)
 *   1 = EMA Crossover    (short_period, long_period)
 *   2 = RSI              (rsi_period, oversold=30, overbought=70)
 *   3 = MACD             (fast=12, slow=26, signal=9)
 *   4 = Bollinger Bands  (period=20, multiplier*10=20 → 2.0)
 */

import { parsePine, exprToString, type ParsedPine, type TACallInfo } from "./pine-parser";
import type { TAFunction, TANode, PineAST } from "./types";

// ─── Output Types ─────────────────────────────────────────────────────────────

export interface TranspileResult {
  // Indicator configuration for on-chain deployment
  indicatorType: number;        // 0-4
  shortPeriod: number;
  longPeriod: number;
  thirdPeriod: number;          // signal/d period or multiplier*10

  // Human-readable metadata
  patternLabel: string;         // e.g. "MACD(12,26,9)"
  detectedPattern: ParsedPine["detectedPattern"];
  confidence: "high" | "medium" | "low";
  warnings: string[];

  // Parameters extracted from input.*() calls
  inputs: ParsedPine["inputs"];
  paramDefaults: Record<string, number>;

  // TA functions found in the script
  taCalls: TACallInfo[];
  taFunctions: string[];        // unique list

  // Buy / sell condition strings (for display)
  buyCondition: string;
  sellCondition: string;

  // Generated Move source (informational — actual execution uses the on-chain contract)
  moveSource: string;

  // Raw AST for further analysis
  ast: ParsedPine;
}

// ─── Transpile ────────────────────────────────────────────────────────────────

export function transpile(pineScript: string, creatorAddr = "0xcreator"): TranspileResult {
  const ast = parsePine(pineScript);
  const warnings: string[] = [];

  const { indicatorType, shortPeriod, longPeriod, thirdPeriod, description } = ast.moveConfig;

  // Confidence scoring
  let confidence: TranspileResult["confidence"] = "high";
  if (ast.detectedPattern === "unknown" || ast.detectedPattern === "custom") {
    confidence = "low";
    warnings.push("Could not auto-detect indicator pattern. Defaulting to SMA crossover.");
  } else if (ast.detectedPattern === "stoch" || ast.detectedPattern === "cci" || ast.detectedPattern === "williams") {
    confidence = "medium";
    warnings.push(`${ast.detectedPattern.toUpperCase()} is approximated as ${description} on-chain.`);
  }
  if (ast.taCalls.length === 0) {
    confidence = "low";
    warnings.push("No TA function calls detected. Check the PineScript syntax.");
  }
  // (Silently infer buy/sell when no explicit strategy.entry() found — this is expected for indicator scripts)

  // Validate period constraints
  const validShort  = Math.max(2, Math.min(shortPeriod, 200));
  const validLong   = Math.max(validShort + 1, Math.min(longPeriod, 500));
  const validThird  = Math.max(1, Math.min(thirdPeriod, 50));

  if (validShort !== shortPeriod || validLong !== longPeriod) {
    warnings.push(`Periods clamped to valid range: short=${validShort}, long=${validLong}.`);
  }

  const taFunctions = [...new Set(ast.taCalls.map(t => t.fn))];
  const buyCondition = ast.buyExpr ? exprToString(ast.buyExpr) : (ast.strategyEntries[0]?.condLine || "—");
  const sellCondition = ast.sellExpr ? exprToString(ast.sellExpr) : (ast.strategyCloses[0] ? "close position" : "—");

  const moveSource = generateMoveModule({
    indicatorType, shortPeriod: validShort, longPeriod: validLong,
    thirdPeriod: validThird, creatorAddr, ast,
  });

  return {
    indicatorType,
    shortPeriod: validShort,
    longPeriod: validLong,
    thirdPeriod: validThird,
    patternLabel: description,
    detectedPattern: ast.detectedPattern,
    confidence,
    warnings,
    inputs: ast.inputs,
    paramDefaults: ast.params,
    taCalls: ast.taCalls,
    taFunctions,
    buyCondition,
    sellCondition,
    moveSource,
    ast,
  };
}

// ─── Move Module Generator ────────────────────────────────────────────────────

interface MoveGenOptions {
  indicatorType: number;
  shortPeriod: number;
  longPeriod: number;
  thirdPeriod: number;
  creatorAddr: string;
  ast: ParsedPine;
}

function generateMoveModule(opts: MoveGenOptions): string {
  const { indicatorType, shortPeriod, longPeriod, thirdPeriod } = opts;
  const typeLabel = ["SMA_CROSSOVER", "EMA_CROSSOVER", "RSI", "MACD", "BOLLINGER_BANDS",
    "STOCHASTIC", "SUPERTREND", "DONCHIAN", "KAMA", "ALMA", "T3", "LAGUERRE"][indicatorType] ?? "CUSTOM";

  // Return a note pointing to the actual contract, since the indicator.move
  // contract is a single generic module that handles all types via params.
  // The .move tab will load the real contract source from the filesystem at runtime.
  return `MOVE_CONTRACT_SOURCE:indicator.move:${indicatorType}:${shortPeriod}:${longPeriod}:${thirdPeriod}:${typeLabel}`;
}

// ─── Legacy API (backwards-compatible) ───────────────────────────────────────

/** @deprecated Use transpile() — kept for API route compatibility */
export function parsePineScript(source: string): PineAST {
  const result = parsePine(source);
  const indicators: TANode[] = result.taCalls.map(tc => ({
    func: tc.fn as TAFunction,
    params: tc.periods,
    source: (tc.source === "close" || tc.source === "open" || tc.source === "high" || tc.source === "low" || tc.source === "volume")
      ? tc.source : "close",
  }));
  return {
    indicators,
    buyCondition: result.buyExpr ? exprToString(result.buyExpr) : "false",
    sellCondition: result.sellExpr ? exprToString(result.sellExpr) : "false",
    params: result.params,
  };
}

/** @deprecated Use transpile() — kept for API route compatibility */
export function generateFullMoveModule(pineScript: string, sellerAddr: string): string {
  return transpile(pineScript, sellerAddr).moveSource;
}

/** @deprecated Use transpile() */
export function generateMoveSignalFunction(_ast: PineAST): string {
  return "// Use transpile() from transpiler.ts for full Move generation";
}
