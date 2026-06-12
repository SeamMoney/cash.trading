/**
 * Transpiler V3 — Universal PineScript → Move v2 compiler
 *
 * Unlike V2 (which pattern-matches to known TA functions), V3 compiles
 * EVERY PineScript statement to its Move equivalent. Handles custom
 * functions, loops, var state, pivot detection, and complex conditionals.
 *
 * Pipeline: PineScript → Extended Parser → Statement-Centric IR → Move Codegen
 */

import { parsePine, exprToString } from "./pine-parser";
import type { Expr, ParsedPine, Stmt, TACallInfo } from "./pine-parser";
import { astToIndicatorIR, type IndicatorIR, type IRFuncDef } from "./pine-ir";
import { generateMoveModule, generateStrategyVaultModule } from "./move-codegen";

// ─── Result type ─────────────────────────────────────────────────────────────

export interface TranspileV3Result {
  moveSource: string;
  moveToml: string;
  moduleName: string;
  ir: IndicatorIR;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  errors: string[];
  strippedVisuals: string[];
  customFunctions: string[];
  varStateFields: string[];
  historyBuffers: Array<{ name: string; historyDepth: number }>;
  needsOHLC: boolean;
  estimatedGasPerBar: number;
  ast: ParsedPine;
  inputs: ParsedPine["inputs"];
  taCalls: TACallInfo[];
  buyCondition: string;
  sellCondition: string;
  // Visual config for chart rendering (from pine-visual.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visualConfig?: any;
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

// ─── Gas estimation ──────────────────────────────────────────────────────────

function estimateGas(ir: IndicatorIR): number {
  let gas = 5000; // base cost (buffer management, state reads)

  for (const op of ir.taOps) {
    switch (op.kind) {
      case "sma": gas += 3000; break;
      case "ema": gas += 5000; break;
      case "rsi": gas += 8000; break;
      case "macd": gas += 12000; break;
      case "bb": gas += 10000; break;
      case "stoch": gas += 8000; break;
      case "supertrend": gas += 6000; break;
      case "if": gas += 500; break;
      case "while": case "for": gas += 2000 * ((op as { maxIters?: number }).maxIters ?? 50); break;
      default: gas += 1000;
    }
  }

  // Custom functions add overhead
  const funcDefs = ir.funcDefs ?? [];
  gas += funcDefs.length * 2000;

  return gas;
}

// ─── Confidence scoring ──────────────────────────────────────────────────────

function scoreConfidence(ast: ParsedPine, ir: IndicatorIR): {
  confidence: TranspileV3Result["confidence"];
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check for unsupported constructs
  if (ast.detectedPattern === "unknown" || ast.detectedPattern === "custom") {
    warnings.push("Pattern not auto-detected. Signal logic uses fallback crossover.");
  }
  if (ast.taCalls.length === 0) {
    warnings.push("No TA function calls detected.");
  }
  errors.push(...collectUnsupportedSyntaxErrors(ast));
  // Silently infer signals when no explicit strategy.entry() found

  // Visual stripping info
  const visuals = ir.visualsStripped ?? [];
  if (visuals.length > 0) {
    warnings.push(`Stripped ${visuals.length} visual-only calls (${[...new Set(visuals)].join(", ")}).`);
  }

  // OHLC detection
  if (ir.needsOHLC) {
    warnings.push("Indicator uses OHLC data. Generated module needs push_ohlcv_price.");
  }

  // Gas warning
  const gas = estimateGas(ir);
  if (gas > 150000) {
    warnings.push(`Estimated gas (${gas.toLocaleString()}) is near the limit. May need optimization.`);
  }

  // Loop depth check (Move max is 5)
  let maxDepth = 0;
  function checkDepth(ops: typeof ir.taOps, depth: number) {
    if (depth > maxDepth) maxDepth = depth;
    for (const op of ops) {
      if (op.kind === "if") {
        checkDepth(op.then, depth + 1);
        if (op.els) checkDepth(op.els, depth + 1);
      }
      if (op.kind === "while" || op.kind === "for") {
        checkDepth(op.body, depth + 1);
      }
    }
  }
  checkDepth(ir.taOps, 0);
  if (maxDepth > 4) {
    errors.push(`Loop nesting depth (${maxDepth}) exceeds Move VM limit of 5.`);
  }

  const hasErrors = errors.length > 0;
  const confidence: TranspileV3Result["confidence"] = hasErrors
    ? "low"
    : warnings.length <= 1
      ? "high"
      : warnings.length <= 3
        ? "medium"
        : "low";

  return { confidence, warnings, errors };
}

function collectUnsupportedSyntaxErrors(ast: ParsedPine): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const add = (message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      errors.push(message);
    }
  };

  function walkExpr(expr: Expr | undefined): void {
    if (!expr) return;
    switch (expr.k) {
      case "binop":
        if (expr.op === "index") {
          add("Unsupported PineScript: dynamic history indexing like series[expr] cannot be lowered to Move; use a numeric literal offset such as close[1].");
        }
        walkExpr(expr.l);
        walkExpr(expr.r);
        break;
      case "unop":
        walkExpr(expr.e);
        break;
      case "ternary":
        walkExpr(expr.cond);
        walkExpr(expr.yes);
        walkExpr(expr.no);
        break;
      case "call":
        expr.args.forEach(walkExpr);
        Object.values(expr.kw).forEach(walkExpr);
        break;
    }
  }

  function walkStmt(stmt: Stmt): void {
    switch (stmt.k) {
      case "assign":
        walkExpr(stmt.value);
        break;
      case "if":
        walkExpr(stmt.cond);
        stmt.then.forEach(walkStmt);
        stmt.els?.forEach(walkStmt);
        break;
      case "for":
        walkExpr(stmt.start);
        walkExpr(stmt.end);
        walkExpr(stmt.step);
        stmt.body.forEach(walkStmt);
        break;
      case "while":
        walkExpr(stmt.cond);
        stmt.body.forEach(walkStmt);
        break;
      case "funcdef":
        stmt.body.forEach(walkStmt);
        break;
      case "visual":
        stmt.args.forEach(walkExpr);
        Object.values(stmt.kw).forEach(walkExpr);
        break;
      case "expr":
        walkExpr(stmt.e);
        break;
    }
  }

  ast.statements.forEach(walkStmt);
  return errors;
}

// ─── Main transpile function ─────────────────────────────────────────────────

export interface TranspileV3Options {
  /** "vault" emits the indicator PLUS the trustless Decibel strategy-vault
   *  pattern in one module (tick_oracle, NAV sizing, delegated orders). */
  target?: "indicator" | "vault";
  /** Decibel perp-market Object address (required for target:"vault"). */
  marketAddr?: string;
}

export function transpileV3(
  pineScript: string,
  creatorAddr = "0xcreator",
  options: TranspileV3Options = {},
): TranspileV3Result {
  // 1. Parse
  const ast = parsePine(pineScript);

  // 2. Transform to IR
  const ir = astToIndicatorIR(ast, creatorAddr);

  // 3. Generate Move source
  let moveSource =
    options.target === "vault" && options.marketAddr
      ? generateStrategyVaultModule(ir, { marketAddr: options.marketAddr })
      : generateMoveModule(ir);

  // 4. Generate Move.toml
  const moveToml = generateMoveToml(ir.moduleName, creatorAddr);

  // 5. Score confidence
  const { confidence, warnings, errors } = scoreConfidence(ast, ir);
  if (errors.length > 0) {
    moveSource = renderRejectedMoveSource(errors);
  }

  // 6. Extract visual config for chart rendering
  let visualConfig: TranspileV3Result["visualConfig"] = null;
  try {
    // Dynamic import to avoid hard dependency on pine-visual.ts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { extractVisualConfig } = require("./pine-visual");
    visualConfig = extractVisualConfig(ast);
  } catch {
    // pine-visual.ts not available yet — skip
  }

  // 7. Collect metadata
  const funcDefs = ir.funcDefs ?? [];
  const varFields = ir.varFields ?? [];
  const visuals = ir.visualsStripped ?? [];
  const gas = estimateGas(ir);

  return {
    moveSource,
    moveToml,
    moduleName: ir.moduleName,
    ir,
    confidence,
    warnings,
    errors,
    strippedVisuals: visuals,
    customFunctions: funcDefs.map((f: IRFuncDef) => f.name),
    varStateFields: varFields.map((v: { name: string }) => v.name),
    historyBuffers: varFields.filter((v: { historyDepth: number }) => v.historyDepth > 0),
    needsOHLC: ir.needsOHLC ?? false,
    estimatedGasPerBar: gas,
    ast,
    inputs: ast.inputs,
    taCalls: ast.taCalls,
    buyCondition: ast.buyExpr ? exprToString(ast.buyExpr) : "(inferred)",
    sellCondition: ast.sellExpr ? exprToString(ast.sellExpr) : "(inferred)",
    visualConfig,
  };
}

function renderRejectedMoveSource(errors: string[]): string {
  return [
    "// PineScript-to-Move transpilation rejected.",
    "// Fix the unsupported syntax below and try again.",
    ...errors.map(error => `// - ${error}`),
    "",
  ].join("\n");
}
