/**
 * Transpiler V3 — verified PineScript subset → Move v2 compiler
 *
 * Unlike V2 (which pattern-matches to known TA functions), V3 lowers parsed
 * statements into a shared IR. Source-level compatibility checks reject any
 * syntax the parser, Move emitter, and sealed evaluator cannot all reproduce.
 * Richer scripts may still be rendered as previews, but are never presented
 * as executable vault programs unless the entire execution path is supported.
 *
 * Pipeline: PineScript → Extended Parser → Statement-Centric IR → Move Codegen
 */

import { parsePine, exprToString } from "./pine-parser";
import type { Expr, ParsedPine, Stmt, TACallInfo } from "./pine-parser";
import {
  astToIndicatorIR,
  TA_FABRICATED,
  TA_REQUIRES_OHLC,
  TA_SILENT_SUBSTITUTIONS,
  type IndicatorIR,
  type IRFuncDef,
} from "./pine-ir";
import {
  analyzeBoundedDynamicHistoryIndex,
  MAX_ON_CHAIN_HISTORY_OFFSET,
} from "./pine-history";
import { collectPineExecutionCompatibilityErrors } from "./pine-compatibility";
import { generateMoveModule, generateStrategyVaultModule } from "./move-codegen";

/** Pinned emitter version recorded in StrategyArtifact rows; bump on any codegen change. */
export const TRANSPILER_VERSION = "v3.3.0";

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

function scoreConfidence(
  ast: ParsedPine,
  ir: IndicatorIR,
  opts?: TranspileV3Options,
  sourceErrors: string[] = [],
): {
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
  errors.push(...sourceErrors);
  errors.push(...collectUnsupportedSyntaxErrors(ast));
  errors.push(...(ast.parseErrors ?? []));
  // Malformed TA-call arguments are hard rejects — never silently defaulted.
  errors.push(...(ast.argErrors ?? []));
  // A surviving generic call has no implementation shared by Move and the
  // committed evaluator. Reject every one, not just ta_* calls.
  errors.push(...collectUnevaluableCallErrors(ir));
  // Same family: state.<field> references the struct never declares, and
  // custom functions whose body lowered to nothing but must return a value.
  errors.push(...collectUndeclaredFieldErrors(ir));
  errors.push(...collectEmptyFuncBodyErrors(ir));

  // No strategy logic was recovered at all, so the IR's buy/sell conditions were
  // INVENTED (a price-vs-previous-price momentum rule). The old launchpad target
  // tolerates that as a warning. A sealed vault cannot: the creator's commitment
  // would bind a program they never wrote, the chart would show one strategy and
  // the vault would trade another, and nothing anywhere would say so. Hard reject.
  if (ir.fabricatedSignal) {
    const message =
      "No strategy logic was found in this script — no strategy.entry() and no "
      + "recognised pattern. A vault built from it would trade a substituted rule, "
      + "not yours.";
    if (opts?.target === "vault") errors.push(message);
    else warnings.push(message);
  }

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

  // Composite price sources need OHLC/volume data the on-chain feed doesn't
  // carry (close-only). Unless the user assigned their own variable with the
  // same name, these would silently become undeclared state fields.
  const COMPOSITE_SOURCES = new Set(["hlc3", "hl2", "ohlc4", "hlcc4", "volume"]);

  /** Bare OHLC components. These used to silently alias `close`
   *  (pine-ir.ts convertExpr), which made `ta.highest(high, 20)` compute the
   *  highest CLOSE while the derived `hlc3` was a hard reject — the composite
   *  blocked, its raw components faked. Now both are rejected. */
  const OHLC_COMPONENTS = new Set(["open", "high", "low"]);

  function walkExpr(expr: Expr | undefined): void {
    if (!expr) return;
    switch (expr.k) {
      case "id":
        if (COMPOSITE_SOURCES.has(expr.name) && ast.assignments[expr.name] === undefined) {
          add(`Unsupported source \`${expr.name}\`: the on-chain price feed is close-only, so OHLC/volume composites can't be computed. Rewrite the expression in terms of \`close\`.`);
        }
        if (OHLC_COMPONENTS.has(expr.name) && ast.assignments[expr.name] === undefined) {
          add(`Unsupported source \`${expr.name}\`: the on-chain price trace records one mark price per bar, so open/high/low don't exist. Rewrite in terms of \`close\`.`);
        }
        break;
      case "hist":
        if (!Number.isInteger(expr.offset) || expr.offset < 0) {
          add(`Unsupported history offset \`${expr.name}[${expr.offset}]\`: offsets must be non-negative integers.`);
        } else if (expr.offset > MAX_ON_CHAIN_HISTORY_OFFSET) {
          add(`Unsupported history offset \`${expr.name}[${expr.offset}]\`: the on-chain limit is ${MAX_ON_CHAIN_HISTORY_OFFSET} bars.`);
        } else if (OHLC_COMPONENTS.has(expr.name) && ast.assignments[expr.name] === undefined) {
          add(`Unsupported source \`${expr.name}[${expr.offset}]\`: the on-chain price trace records one mark price per bar, so open/high/low don't exist. Rewrite in terms of \`close\`.`);
        } else if (expr.name !== "close" && expr.offset >= 2) {
          add(`\`${expr.name}[${expr.offset}]\` needs a per-series history buffer, which isn't implemented — only one-deep history (\`${expr.name}[1]\`) is available for named series. Offsets ≥ 2 are supported on \`close\` only.`);
        }
        break;
      case "binop":
        if (expr.op === "index") {
          const analysis = analyzeBoundedDynamicHistoryIndex(expr, ast.inputs);
          if (!analysis.ok) {
            add(`Unsupported PineScript history lookup: ${analysis.reason}. Use a literal such as \`close[1]\`, or a bounded input such as \`n = input.int(3, minval=0, maxval=50)\` followed by \`close[n]\`.`);
          }
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
      case "call": {
        const sub = expr.ns === "ta" ? TA_SILENT_SUBSTITUTIONS[expr.fn] : undefined;
        if (sub) {
          add(`\`ta.${expr.fn}\` is not implemented on-chain. It used to compile silently to \`ta.${sub.was}\` — a different indicator — so a published vault would have traded a strategy you never wrote. Rejected instead (${sub.why}). Rewrite using a supported ta.* function.`);
        }
        const ohlc = expr.ns === "ta" ? TA_REQUIRES_OHLC[expr.fn] : undefined;
        if (ohlc) {
          add(`\`ta.${expr.fn}\` can't be computed from the on-chain price trace, which records one mark price per bar. ${ohlc}. Rejected rather than emitting a fabricated stand-in.`);
        }
        const fabricated = expr.ns === "ta" ? TA_FABRICATED[expr.fn] : undefined;
        if (fabricated) {
          add(`\`ta.${expr.fn}\` transpiles but does not work: ${fabricated}. A vault built from it would commit, cost you the launch fee, and then never trade. Rejected rather than shipping a bot that silently does nothing.`);
        }
        expr.args.forEach(walkExpr);
        Object.values(expr.kw).forEach(walkExpr);
        break;
      }
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

/** Find generic IR calls that cannot be reproduced by the sealed evaluator.
 * First-class supported helpers lower to dedicated IR nodes; any call that
 * survives here is therefore outside the executable subset. */
function collectUnevaluableCallErrors(ir: IndicatorIR): string[] {
  const errors = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "call" && typeof n.fn === "string") {
      if (n.fn.startsWith("ta_")) {
        const pineFn = n.fn.slice(3);
        errors.add(
          `ta.${pineFn} used inline inside a larger expression — it has no on-chain inline form. Assign it to its own variable on one line (e.g. \`x = ta.${pineFn}(...)\`), then use \`x\`. Note: on-chain TA helpers operate on the close-price series; computed-series sources aren't supported.`,
        );
      } else {
        errors.add(
          `Function call \`${n.fn.replaceAll("_", ".")}()\` is preview-only. `
          + "It has no implementation shared by the generated Move module and the sealed signal evaluator, so it cannot be committed yet.",
        );
      }
    }
    Object.values(n).forEach(walk);
  };
  walk(ir.taOps);
  walk(ir.signalLogic);
  walk(ir.funcDefs ?? []);
  return [...errors];
}

/** Struct fields the codegen always emits on IndicatorState, mirrored from
 *  move-codegen's generateStruct. Keep in sync. */
const ALWAYS_DECLARED_FIELDS = new Set([
  "keeper", "owner",
  "last_signal", "last_signal_time", "total_signals", "total_prices_pushed",
  "last_price", "in_position", "entry_price", "realized_gain_bps", "realized_loss_bps",
]);

/** field_ref nodes compile to `state.<field>` — if the field is neither a
 *  declared IR state field nor a standard struct field, the Move can never
 *  compile ("field not declared in struct IndicatorState"). */
function collectUndeclaredFieldErrors(ir: IndicatorIR): string[] {
  const declared = new Set<string>(ALWAYS_DECLARED_FIELDS);
  for (const f of ir.stateFields) declared.add(f.name);
  for (const v of ir.varFields ?? []) declared.add(v.name);
  const errors = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "field_ref" && typeof n.field === "string" && !declared.has(n.field)) {
      errors.add(
        `\`${n.field}\` is read as strategy state but nothing computes it — its source construct isn't supported on-chain, so the generated module would reference an undeclared field. Remove it or derive it from supported ta.* calls.`,
      );
    }
    Object.values(n).forEach(walk);
  };
  walk(ir.taOps);
  walk(ir.signalLogic);
  walk(ir.funcDefs ?? []);
  return [...errors];
}

/** A custom function whose body lowered to zero statements but declares a
 *  return type emits `fun f(...): u64 { }` — a guaranteed compile failure
 *  ("cannot return nothing"). */
function collectEmptyFuncBodyErrors(ir: IndicatorIR): string[] {
  const errors: string[] = [];
  for (const f of ir.funcDefs ?? []) {
    if (f.body.length === 0 && f.returnType && f.returnType !== "void" && f.returnType !== "()") {
      errors.push(
        `Custom function \`${f.name}\` uses constructs that can't be lowered to Move — its body compiled to nothing but it must return ${f.returnType}. Inline the logic or restrict it to supported ta.*/math.* operations.`,
      );
    }
  }
  return errors;
}

// ─── Main transpile function ─────────────────────────────────────────────────

export interface TranspileV3Options {
  /** "vault" emits the indicator PLUS the trustless Decibel strategy-vault
   *  pattern in one module (tick_oracle, NAV sizing, delegated orders). */
  target?: "indicator" | "vault";
  /** Decibel perp-market Object address (required for target:"vault"). */
  marketAddr?: string;
  /** Per-market engine constraints for NAV sizing (see StrategyVaultOpts). */
  lotSize?: number;
  minSize?: number;
  szDecimalsPow?: string;
}

export function transpileV3(
  pineScript: string,
  creatorAddr = "0xcreator",
  options: TranspileV3Options = {},
): TranspileV3Result {
  const sourceErrors = collectPineExecutionCompatibilityErrors(pineScript);

  // 1. Parse
  const ast = parsePine(pineScript);

  // 2. Transform to IR
  const ir = astToIndicatorIR(ast, creatorAddr);

  // 3. Generate Move source
  let moveSource =
    options.target === "vault" && options.marketAddr
      ? generateStrategyVaultModule(ir, {
          marketAddr: options.marketAddr,
          lotSize: options.lotSize,
          minSize: options.minSize,
          szDecimalsPow: options.szDecimalsPow,
        })
      : generateMoveModule(ir);

  // 4. Generate Move.toml
  const moveToml = generateMoveToml(ir.moduleName, creatorAddr);

  // 5. Score confidence
  const { confidence, warnings, errors } = scoreConfidence(ast, ir, options, sourceErrors);
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
