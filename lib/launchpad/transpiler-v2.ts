/**
 * Transpiler V2 — PineScript → standalone Move module
 *
 * Unlike V1 (which maps to factory parameters), V2 generates a complete
 * Move module per indicator that can be compiled and deployed as its own package.
 *
 * Pipeline: PineScript → ParsedPine → IndicatorIR → Move source + Move.toml
 */

import { parsePine, exprToString } from "./pine-parser";
import type { ParsedPine, TACallInfo } from "./pine-parser";
import { astToIndicatorIR, type IndicatorIR } from "./pine-ir";
import { generateMoveModule } from "./move-codegen";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface TranspileV2Result {
  /** Complete Move v2 module source */
  moveSource: string;
  /** Move.toml package manifest */
  moveToml: string;
  /** Module name (snake_case) */
  moduleName: string;
  /** The IR for debugging/display */
  ir: IndicatorIR;
  /** Human-readable pattern label */
  patternLabel: string;
  /** Confidence that the transpilation is correct */
  confidence: "high" | "medium" | "low";
  /** Warnings generated during transpilation */
  warnings: string[];
  /** PineScript inputs detected */
  inputs: ParsedPine["inputs"];
  /** TA function calls found */
  taCalls: TACallInfo[];
  /** Buy condition (display string) */
  buyCondition: string;
  /** Sell condition (display string) */
  sellCondition: string;
  /** Raw AST for further analysis */
  ast: ParsedPine;
}

// ─── Move.toml generator ─────────────────────────────────────────────────────

function generateMoveToml(packageName: string, creatorAddr: string): string {
  return `[package]
name = "${packageName}"
version = "0.1.0"

[addresses]
${packageName} = "${creatorAddr}"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-framework", rev = "mainnet" }
AptosStdlib = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-stdlib", rev = "mainnet" }
MoveStdlib = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/move-stdlib", rev = "mainnet" }
`;
}

// ─── Main transpile function ─────────────────────────────────────────────────

export function transpileV2(
  pineScript: string,
  creatorAddr = "0xcreator",
): TranspileV2Result {
  // 1. Parse PineScript
  const ast = parsePine(pineScript);

  // 2. Transform to IR
  const ir = astToIndicatorIR(ast, creatorAddr);

  // 3. Generate Move source
  const moveSource = generateMoveModule(ir);

  // 4. Generate Move.toml
  const moveToml = generateMoveToml(ir.moduleName, creatorAddr);

  // 5. Compute confidence
  let confidence: TranspileV2Result["confidence"] = "high";
  const warnings: string[] = [];

  if (ast.detectedPattern === "unknown" || ast.detectedPattern === "custom") {
    confidence = "low";
    warnings.push("Could not auto-detect indicator pattern. Generated module uses SMA crossover as fallback.");
  } else if (ast.detectedPattern === "stoch" || ast.detectedPattern === "cci" || ast.detectedPattern === "williams") {
    confidence = "medium";
    warnings.push(`${ast.detectedPattern.toUpperCase()} is approximated on-chain.`);
  }
  if (ast.taCalls.length === 0) {
    confidence = "low";
    warnings.push("No TA function calls detected in the PineScript.");
  }
  // Silently infer signals when no explicit strategy.entry() found

  // 6. Build result
  return {
    moveSource,
    moveToml,
    moduleName: ir.moduleName,
    ir,
    patternLabel: ir.description,
    confidence,
    warnings,
    inputs: ast.inputs,
    taCalls: ast.taCalls,
    buyCondition: ast.buyExpr ? exprToString(ast.buyExpr) : "(inferred from crossover)",
    sellCondition: ast.sellExpr ? exprToString(ast.sellExpr) : "(inferred from crossover)",
    ast,
  };
}
