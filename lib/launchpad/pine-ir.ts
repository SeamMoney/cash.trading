/**
 * PineScript → Move Intermediate Representation (IR)
 *
 * Bridges the PineScript AST (from pine-parser.ts) to Move code generation.
 * The IR captures everything needed to emit a correct Move module:
 *   - State fields with types and init values
 *   - Ordered TA computation steps
 *   - Signal logic (buy/sell conditions) as typed expression trees
 *   - Buffer sizing and warmup requirements
 *
 * All numeric values in the IR are pre-scaled to 1e8 (Move fixed-point u64).
 */

import type { ParsedPine, Expr, TACallInfo, InputDef } from "./pine-parser";

// ─── Constants ──────────────────────────────────────────────────────────────

const SCALE = 100_000_000; // 1e8 — Move fixed-point scale
const BUFFER_PADDING = 5;  // extra bars beyond max period

// ─── IR Type Definitions ────────────────────────────────────────────────────

export interface IRStateField {
  name: string;           // snake_case Move field name
  moveType: "u64" | "u128" | "bool" | "u8";
  initValue: string;      // Move literal e.g. "0u64"
  comment?: string;
  source: "price_buffer" | "ta_computed" | "user_input" | "signal" | "system";
}

export type IRTAOp =
  | { kind: "sma"; target: string; period: IRValue }
  | { kind: "ema"; target: string; period: IRValue }
  | { kind: "rsi"; target: string; period: IRValue }
  | { kind: "macd"; targetLine: string; targetSignal: string; targetHist: string;
      fast: IRValue; slow: IRValue; signal: IRValue }
  | { kind: "bb"; targetUpper: string; targetLower: string; targetMid: string;
      period: IRValue; multiplier: IRValue }
  | { kind: "stoch"; targetK: string; targetD: string;
      kPeriod: IRValue; dPeriod: IRValue }
  | { kind: "supertrend"; targetDir: string; targetLine: string;
      atrPeriod: IRValue; multiplier: IRValue }
  | { kind: "highest"; target: string; period: IRValue }
  | { kind: "lowest"; target: string; period: IRValue }
  | { kind: "atr"; target: string; period: IRValue }
  | { kind: "crossover"; target: string; seriesA: string; seriesB: string }
  | { kind: "crossunder"; target: string; seriesA: string; seriesB: string }
  | { kind: "assign"; target: string; expr: IRExpr }
  // V3: statement-level nodes for universal transpilation
  | { kind: "if"; cond: IRExpr; then: IRTAOp[]; els?: IRTAOp[] }
  | { kind: "while"; cond: IRExpr; body: IRTAOp[]; maxIters: number }
  | { kind: "for"; varName: string; start: IRExpr; end: IRExpr; step: IRExpr; body: IRTAOp[]; maxIters: number }
  | { kind: "let"; name: string; moveType: string; expr: IRExpr }
  | { kind: "state_update"; field: string; expr: IRExpr }
  | { kind: "noop"; comment?: string };

export type IRStatement = IRTAOp;

export type IRValue =
  | { kind: "literal"; value: number }
  | { kind: "field"; name: string };

export type IRExpr =
  | { kind: "lit_u64"; value: string }
  | { kind: "lit_bool"; value: boolean }
  | { kind: "field_ref"; field: string }
  | { kind: "price" }
  | { kind: "prev_field"; field: string }
  | { kind: "binop"; op: string; left: IRExpr; right: IRExpr }
  | { kind: "unop"; op: string; expr: IRExpr }
  | { kind: "ternary"; cond: IRExpr; yes: IRExpr; no: IRExpr }
  | { kind: "scaled_mul"; left: IRExpr; right: IRExpr; scale: number }
  | { kind: "safe_sub"; left: IRExpr; right: IRExpr }
  | { kind: "call"; fn: string; args: IRExpr[] }
  // V3: extended expressions for universal transpilation
  | { kind: "series_index"; name: string; offset: number }
  | { kind: "div"; left: IRExpr; right: IRExpr }
  | { kind: "abs"; expr: IRExpr }
  | { kind: "max"; left: IRExpr; right: IRExpr }
  | { kind: "min"; left: IRExpr; right: IRExpr }
  | { kind: "neg"; expr: IRExpr }
  | { kind: "na_check"; expr: IRExpr }
  | { kind: "not_na"; expr: IRExpr };

export interface IRSignalLogic {
  buyCondition: IRExpr;
  sellCondition: IRExpr;
}

export interface IRFuncDef {
  name: string;
  params: Array<{ name: string; moveType: string }>;
  returnType: string;
  body: IRTAOp[];
}

export interface IndicatorIR {
  moduleName: string;
  creatorAddr: string;
  stateFields: IRStateField[];
  bufferCapacity: number;
  warmupMinBars: number;
  taOps: IRTAOp[];
  signalLogic: IRSignalLogic;
  neededTAFunctions: string[];  // names like "compute_sma", "compute_ema"
  description: string;
  inputs: Array<{ name: string; default: number; min?: number; max?: number }>;
  // V3: universal transpilation fields
  funcDefs?: IRFuncDef[];
  varFields?: Array<{ name: string; historyDepth: number }>;
  visualsStripped?: string[];
  needsOHLC?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert camelCase or PascalCase to snake_case for Move identifiers */
export function toSnakeCase(s: string): string {
  return s
    // Insert underscore before uppercase letters preceded by lowercase
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    // Insert underscore before uppercase letters followed by lowercase (for runs like "RSIValue")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    // Collapse multiple underscores
    .replace(/_+/g, "_")
    // Strip leading/trailing underscores
    .replace(/^_|_$/g, "");
}

/** Sanitize a string into a valid Move module name */
function toModuleName(s: string): string {
  return toSnakeCase(s)
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^(\d)/, "_$1") // cannot start with digit
    || "custom_indicator";
}

/** Scale a float to 1e8 integer string */
function scaleToU64(n: number): string {
  return String(Math.round(n * SCALE));
}

/** Resolve a period value: if it matches an input param, reference the field; otherwise literal */
function resolvePeriod(
  value: number,
  rawArg: Expr | undefined,
  params: Record<string, number>,
): IRValue {
  // If the raw arg is an identifier that matches a known input param, use field reference
  if (rawArg && rawArg.k === "id" && params[rawArg.name] !== undefined) {
    return { kind: "field", name: toSnakeCase(rawArg.name) };
  }
  return { kind: "literal", value: value || 1 };
}

/** Resolve Pine multiplier arguments that Move helpers encode as x10 integers. */
function resolveMultiplierX10(
  value: number,
  rawArg: Expr | undefined,
  params: Record<string, number>,
): IRValue {
  if (rawArg && rawArg.k === "id" && params[rawArg.name] !== undefined) {
    return { kind: "field", name: toSnakeCase(rawArg.name) };
  }
  return { kind: "literal", value: Math.round((value || 1) * 10) };
}

/** Extract max period from an IRValue (for buffer sizing) */
function irValueMax(v: IRValue, params: Record<string, number>): number {
  if (v.kind === "literal") return v.value;
  // For field references, look up the default value from params
  // Reverse-lookup: the field name is snake_case, params keys are original camelCase
  for (const [key, val] of Object.entries(params)) {
    if (toSnakeCase(key) === v.name) return val;
  }
  return 30; // safe default
}

// ─── Known TA Function Mapping ──────────────────────────────────────────────

const TA_FN_MAP: Record<string, string> = {
  sma: "compute_sma",
  ema: "compute_ema",
  rsi: "compute_rsi",
  macd: "compute_macd",
  bb: "compute_bb",
  bbands: "compute_bb",
  stoch: "compute_stoch",
  supertrend: "compute_supertrend",
  highest: "compute_highest",
  lowest: "compute_lowest",
  atr: "compute_atr",
  crossover: "compute_crossover",
  crossunder: "compute_crossunder",
  wma: "compute_sma",     // approximate
  hma: "compute_sma",     // approximate
  dema: "compute_ema",    // approximate
  tema: "compute_ema",    // approximate
  cci: "compute_rsi",     // approximate
  williams_r: "compute_rsi", // approximate
  mfi: "compute_rsi",     // approximate
  vwap: "compute_sma",    // approximate
  obv: "compute_sma",     // approximate
};

/** Map a parser TA function name to an IRTAOp kind */
function taFnToKind(fn: string): IRTAOp["kind"] | null {
  const map: Record<string, IRTAOp["kind"]> = {
    sma: "sma", ema: "ema", rsi: "rsi", macd: "macd",
    bb: "bb", bbands: "bb", stoch: "stoch", supertrend: "supertrend",
    highest: "highest", lowest: "lowest", atr: "atr",
    crossover: "crossover", crossunder: "crossunder",
    // Approximations for less common indicators
    wma: "sma", hma: "sma", dema: "ema", tema: "ema",
    cci: "rsi", williams_r: "rsi", mfi: "rsi",
    vwap: "sma", obv: "sma",
  };
  return map[fn] ?? null;
}

// ─── Expression Conversion ──────────────────────────────────────────────────

/**
 * Tracks which fields are referenced during expression conversion,
 * so we can create prev_ companion fields for crossover detection.
 */
interface ConvertCtx {
  referencedFields: Set<string>;
  assignments: Record<string, Expr>;
  params: Record<string, number>;
  taTargets: Set<string>; // all TA-computed field names (snake_case)
  resolvingNames: Set<string>;
}

/** Convert a PineScript Expr to an IRExpr */
function convertExpr(e: Expr, ctx: ConvertCtx): IRExpr {
  switch (e.k) {
    case "num": {
      return { kind: "lit_u64", value: scaleToU64(e.v) };
    }

    case "bool": {
      return { kind: "lit_bool", value: e.v };
    }

    case "str":
    case "na": {
      // Treat na/string as 0 in numeric context
      return { kind: "lit_u64", value: "0" };
    }

    case "id": {
      const name = e.name;
      // Built-in price references
      if (name === "close" || name === "open" || name === "high" || name === "low") {
        return { kind: "price" };
      }
      const snaked = toSnakeCase(name);
      const assignment = ctx.assignments[name];
      if (
        assignment &&
        ctx.params[name] === undefined &&
        !ctx.taTargets.has(snaked) &&
        !ctx.resolvingNames.has(name)
      ) {
        ctx.resolvingNames.add(name);
        try {
          return convertExpr(assignment, ctx);
        } finally {
          ctx.resolvingNames.delete(name);
        }
      }
      ctx.referencedFields.add(snaked);
      return { kind: "field_ref", field: snaked };
    }

    case "hist": {
      // Historical access: close[1] → prev_field for last_price
      // someVar[1] → prev_field for that variable
      if (e.name === "close" || e.name === "open" || e.name === "high" || e.name === "low") {
        const field = "last_price";
        ctx.referencedFields.add(field);
        return { kind: "prev_field", field };
      }
      const snaked = toSnakeCase(e.name);
      ctx.referencedFields.add(snaked);
      return { kind: "prev_field", field: snaked };
    }

    case "call": {
      const { ns, fn, args } = e;

      // na(x) uses 0 as the on-chain "not available" sentinel.
      if (!ns && fn === "na") {
        if (args.length === 0) return { kind: "lit_bool", value: true };
        return { kind: "na_check", expr: convertExpr(args[0], ctx) };
      }

      // nz(x, fallback) replaces the on-chain "na" sentinel with a fallback.
      // The fallback defaults to 0, matching Pine's nz(source) behavior.
      if (!ns && fn === "nz") {
        const value = convertExpr(args[0] ?? { k: "na" }, ctx);
        const fallback = args[1]
          ? convertExpr(args[1], ctx)
          : { kind: "lit_u64" as const, value: "0" };
        return {
          kind: "ternary",
          cond: { kind: "na_check", expr: value },
          yes: fallback,
          no: value,
        };
      }

      // ta.crossover(a, b) → (prev_a <= prev_b) && (a > b)
      if (ns === "ta" && fn === "crossover" && args.length >= 2) {
        const a = convertExpr(args[0], ctx);
        const b = convertExpr(args[1], ctx);
        const prevA = toPrevExpr(a, ctx);
        const prevB = toPrevExpr(b, ctx);
        return {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: "<=", left: prevA, right: prevB },
          right: { kind: "binop", op: ">", left: a, right: b },
        };
      }

      // ta.crossunder(a, b) → (prev_a >= prev_b) && (a < b)
      if (ns === "ta" && fn === "crossunder" && args.length >= 2) {
        const a = convertExpr(args[0], ctx);
        const b = convertExpr(args[1], ctx);
        const prevA = toPrevExpr(a, ctx);
        const prevB = toPrevExpr(b, ctx);
        return {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: ">=", left: prevA, right: prevB },
          right: { kind: "binop", op: "<", left: a, right: b },
        };
      }

      // math.abs, math.max, math.min → call nodes
      if (ns === "math") {
        return {
          kind: "call",
          fn: `math_${fn}`,
          args: args.map(a => convertExpr(a, ctx)),
        };
      }

      // Other ta.* calls that return a value inline (e.g., ta.sma used directly in an expression)
      if (ns === "ta") {
        // If this TA call was assigned to a variable, reference that variable's field
        // Otherwise, just reference it as a call
        return {
          kind: "call",
          fn: `ta_${fn}`,
          args: args.map(a => convertExpr(a, ctx)),
        };
      }

      // Generic function call
      return {
        kind: "call",
        fn: ns ? `${ns}_${fn}` : fn,
        args: args.map(a => convertExpr(a, ctx)),
      };
    }

    case "binop": {
      const { op, l, r } = e;

      if (op === "and") {
        return {
          kind: "binop", op: "&&",
          left: convertExpr(l, ctx),
          right: convertExpr(r, ctx),
        };
      }
      if (op === "or") {
        return {
          kind: "binop", op: "||",
          left: convertExpr(l, ctx),
          right: convertExpr(r, ctx),
        };
      }

      // Multiplication → scaled_mul (for fixed-point arithmetic)
      if (op === "*") {
        return {
          kind: "scaled_mul",
          left: convertExpr(l, ctx),
          right: convertExpr(r, ctx),
          scale: SCALE,
        };
      }

      // Subtraction → safe_sub (unsigned underflow protection)
      if (op === "-") {
        return {
          kind: "safe_sub",
          left: convertExpr(l, ctx),
          right: convertExpr(r, ctx),
        };
      }

      // Comparison and other binary ops pass through
      return {
        kind: "binop", op,
        left: convertExpr(l, ctx),
        right: convertExpr(r, ctx),
      };
    }

    case "unop": {
      return {
        kind: "unop",
        op: e.op === "not" ? "!" : e.op,
        expr: convertExpr(e.e, ctx),
      };
    }

    case "ternary": {
      return {
        kind: "ternary",
        cond: convertExpr(e.cond, ctx),
        yes: convertExpr(e.yes, ctx),
        no: convertExpr(e.no, ctx),
      };
    }

    default: {
      // Fallback for any unhandled expression kind
      return { kind: "lit_bool", value: false };
    }
  }
}

/** Convert an IRExpr to its "previous bar" equivalent */
function toPrevExpr(expr: IRExpr, ctx: ConvertCtx): IRExpr {
  switch (expr.kind) {
    case "field_ref": {
      const prevName = `prev_${expr.field}`;
      ctx.referencedFields.add(expr.field);
      return { kind: "prev_field", field: expr.field };
    }
    case "price": {
      return { kind: "prev_field", field: "last_price" };
    }
    default:
      // For complex expressions, wrap as prev_field if we can extract a field
      return expr;
  }
}

// ─── Main Transform ─────────────────────────────────────────────────────────

/**
 * Transform a ParsedPine AST into an IndicatorIR suitable for Move code generation.
 *
 * Steps:
 *   1. Extract inputs → user_input state fields
 *   2. Map TA calls → IRTAOps + ta_computed state fields
 *   3. Create prev_ companion fields for crossover/signal detection
 *   4. Convert buy/sell expressions from Expr → IRExpr
 *   5. Compute buffer capacity from max period
 *   6. Build signal logic (explicit or pattern-based fallback)
 *   7. Generate module name
 */
export function astToIndicatorIR(parsed: ParsedPine, creatorAddr: string): IndicatorIR {
  const stateFields: IRStateField[] = [];
  const taOps: IRTAOp[] = [];
  const neededTAFns = new Set<string>();
  const taTargets = new Set<string>(); // snake_case names of TA-computed fields
  let maxPeriod = 0;

  // ── Step 1: Extract inputs ──────────────────────────────────────────────

  const inputs: IndicatorIR["inputs"] = [];

  for (const [name, def] of Object.entries(parsed.inputs)) {
    // Only create state fields for numeric inputs (int/float)
    if (def.type === "int" || def.type === "float") {
      const snaked = toSnakeCase(name);
      const defVal = typeof def.default === "number" ? def.default : 0;

      stateFields.push({
        name: snaked,
        moveType: "u64",
        initValue: `${Math.round(defVal)}u64`,
        comment: `input: ${def.title || name}`,
        source: "user_input",
      });

      inputs.push({
        name: snaked,
        default: defVal,
        min: def.minval,
        max: def.maxval,
      });
    }
  }

  // ── Step 2: Map TA calls → IRTAOps ─────────────────────────────────────

  for (const tc of parsed.taCalls) {
    // Handle pivot functions specially (they don't map to standard IRTAOp kinds)
    if (tc.fn === "pivothigh" || tc.fn === "pivotlow") {
      const target = tc.targets[0] ? toSnakeCase(tc.targets[0]) : (tc.fn === "pivothigh" ? "swing_high" : "swing_low");
      const fnName = tc.fn === "pivothigh" ? "compute_pivothigh" : "compute_pivotlow";
      const period = tc.periods[0] ?? 5;
      neededTAFns.add(fnName);
      maxPeriod = Math.max(maxPeriod, period * 2 + 1);

      taOps.push({
        kind: "assign",
        target,
        expr: { kind: "call", fn: fnName, args: [
          { kind: "lit_u64", value: String(period) },
          { kind: "lit_u64", value: String(period) },
        ]},
      });
      taTargets.add(tc.targets[0] ?? target);
      stateFields.push({
        name: target, moveType: "u64", initValue: "0u64",
        comment: `${tc.fn}(${period})`, source: "ta_computed",
      });
      continue;
    }

    const kind = taFnToKind(tc.fn);
    if (!kind) continue; // skip truly unknown TA functions

    // Register the needed compute function
    const computeFn = TA_FN_MAP[tc.fn];
    if (computeFn) neededTAFns.add(computeFn);

    // Determine target names (snake_case)
    const targets = tc.targets.map(t => toSnakeCase(t));

    switch (kind) {
      case "sma":
      case "ema":
      case "rsi":
      case "atr":
      case "highest":
      case "lowest": {
        const target = targets[0] || `${kind}_val`;
        const period = resolvePeriod(tc.periods[0] || 14, tc.rawArgs[1], parsed.params);
        maxPeriod = Math.max(maxPeriod, irValueMax(period, parsed.params));

        taOps.push({ kind, target, period } as IRTAOp);
        taTargets.add(target);

        stateFields.push({
          name: target,
          moveType: "u64",
          initValue: "0u64",
          comment: `${tc.fn}(${tc.periods.join(", ")})`,
          source: "ta_computed",
        });
        break;
      }

      case "macd": {
        const targetLine = targets[0] || "macd_line";
        const targetSignal = targets[1] || "macd_signal";
        const targetHist = targets[2] || "macd_hist";
        const fast = resolvePeriod(tc.periods[0] || 12, tc.rawArgs[1], parsed.params);
        const slow = resolvePeriod(tc.periods[1] || 26, tc.rawArgs[2], parsed.params);
        const signal = resolvePeriod(tc.periods[2] || 9, tc.rawArgs[3], parsed.params);
        maxPeriod = Math.max(
          maxPeriod,
          irValueMax(fast, parsed.params),
          irValueMax(slow, parsed.params),
          irValueMax(signal, parsed.params),
        );

        taOps.push({ kind: "macd", targetLine, targetSignal, targetHist, fast, slow, signal });
        taTargets.add(targetLine);
        taTargets.add(targetSignal);
        taTargets.add(targetHist);

        for (const [name, comment] of [
          [targetLine, "MACD line"],
          [targetSignal, "MACD signal"],
          [targetHist, "MACD histogram"],
        ] as const) {
          stateFields.push({
            name,
            moveType: "u64",
            initValue: "0u64",
            comment,
            source: "ta_computed",
          });
        }
        break;
      }

      case "bb": {
        const targetMid = targets[0] || "bb_mid";
        const targetUpper = targets[1] || "bb_upper";
        const targetLower = targets[2] || "bb_lower";
        const period = resolvePeriod(tc.periods[0] || 20, tc.rawArgs[1], parsed.params);
        const multiplier = resolveMultiplierX10(tc.periods[1] || 2, tc.rawArgs[2], parsed.params);
        maxPeriod = Math.max(maxPeriod, irValueMax(period, parsed.params));

        taOps.push({ kind: "bb", targetUpper, targetLower, targetMid, period, multiplier });
        taTargets.add(targetUpper);
        taTargets.add(targetLower);
        taTargets.add(targetMid);

        for (const [name, comment] of [
          [targetUpper, "BB upper band"],
          [targetLower, "BB lower band"],
          [targetMid, "BB middle band"],
        ] as const) {
          stateFields.push({
            name,
            moveType: "u64",
            initValue: "0u64",
            comment,
            source: "ta_computed",
          });
        }
        break;
      }

      case "stoch": {
        const targetK = targets[0] || "stoch_k";
        const targetD = targets[1] || "stoch_d";
        const kPeriod = resolvePeriod(tc.periods[0] || 14, tc.rawArgs[1], parsed.params);
        const dPeriod = resolvePeriod(tc.periods[1] || 3, tc.rawArgs[2], parsed.params);
        maxPeriod = Math.max(maxPeriod, irValueMax(kPeriod, parsed.params), irValueMax(dPeriod, parsed.params));

        taOps.push({ kind: "stoch", targetK, targetD, kPeriod, dPeriod });
        taTargets.add(targetK);
        taTargets.add(targetD);

        for (const [name, comment] of [
          [targetK, "Stochastic %K"],
          [targetD, "Stochastic %D"],
        ] as const) {
          stateFields.push({
            name,
            moveType: "u64",
            initValue: "0u64",
            comment,
            source: "ta_computed",
          });
        }
        break;
      }

      case "supertrend": {
        // Pine returns [supertrendLine, direction] from ta.supertrend(factor, atrPeriod).
        const targetLine = targets[0] || "st_line";
        const targetDir = targets[1] || "st_direction";
        const multiplier = resolveMultiplierX10(tc.periods[0] || 3, tc.rawArgs[0], parsed.params);
        const atrPeriod = resolvePeriod(tc.periods[1] || 10, tc.rawArgs[1], parsed.params);
        maxPeriod = Math.max(maxPeriod, irValueMax(atrPeriod, parsed.params));

        taOps.push({ kind: "supertrend", targetDir, targetLine, atrPeriod, multiplier });
        taTargets.add(targetDir);
        taTargets.add(targetLine);

        stateFields.push({
          name: targetDir,
          moveType: "u64",
          initValue: "0u64",
          comment: "SuperTrend direction (1=up, 2=down)",
          source: "ta_computed",
        });
        stateFields.push({
          name: targetLine,
          moveType: "u64",
          initValue: "0u64",
          comment: "SuperTrend line value",
          source: "ta_computed",
        });
        break;
      }

      case "crossover":
      case "crossunder": {
        // Crossover/crossunder as standalone TA calls (not in expressions)
        const target = targets[0] || `${kind}_flag`;
        const seriesA = tc.targets.length >= 1 ? toSnakeCase(tc.targets[0]) : "series_a";
        const seriesB = tc.targets.length >= 2 ? toSnakeCase(tc.targets[1]) : "series_b";

        // Resolve series names from the call's args if available
        const resolvedA = tc.rawArgs[0]?.k === "id" ? toSnakeCase(tc.rawArgs[0].name) : seriesA;
        const resolvedB = tc.rawArgs[1]?.k === "id" ? toSnakeCase(tc.rawArgs[1].name) : seriesB;

        taOps.push({ kind, target, seriesA: resolvedA, seriesB: resolvedB });
        taTargets.add(target);

        stateFields.push({
          name: target,
          moveType: "bool",
          initValue: "false",
          comment: `${kind}(${resolvedA}, ${resolvedB})`,
          source: "ta_computed",
        });
        break;
      }

      // pivothigh/pivotlow handled above the switch
    }
  }

  // ── Step 3: Convert expressions & collect referenced fields ─────────────

  const convertCtx: ConvertCtx = {
    referencedFields: new Set<string>(),
    assignments: parsed.assignments,
    params: parsed.params,
    taTargets,
    resolvingNames: new Set<string>(),
  };

  let buyIR: IRExpr | null = null;
  let sellIR: IRExpr | null = null;

  if (parsed.buyExpr) {
    buyIR = convertExpr(parsed.buyExpr, convertCtx);
  }
  if (parsed.sellExpr) {
    sellIR = convertExpr(parsed.sellExpr, convertCtx);
  }

  // ── Step 4: Create prev_ companion fields ──────────────────────────────

  // Any TA-computed field that is referenced in buy/sell expressions
  // needs a prev_ companion for crossover detection
  const prevFieldsNeeded = new Set<string>();

  for (const fieldName of convertCtx.referencedFields) {
    if (taTargets.has(fieldName)) {
      prevFieldsNeeded.add(fieldName);
    }
  }

  // Also check for explicit crossover/crossunder ops
  for (const op of taOps) {
    if (op.kind === "crossover" || op.kind === "crossunder") {
      prevFieldsNeeded.add(op.seriesA);
      prevFieldsNeeded.add(op.seriesB);
    }
  }

  // Always add last_price tracking
  const hasLastPrice = stateFields.some(f => f.name === "last_price");
  if (!hasLastPrice) {
    stateFields.push({
      name: "last_price",
      moveType: "u64",
      initValue: "0u64",
      comment: "previous bar close price",
      source: "system",
    });
  }

  for (const fieldName of prevFieldsNeeded) {
    const prevName = `prev_${fieldName}`;
    // Skip if already exists
    if (stateFields.some(f => f.name === prevName)) continue;

    // Find the original field to match its type
    const original = stateFields.find(f => f.name === fieldName);
    const moveType = original?.moveType ?? "u64";
    const initValue = moveType === "bool" ? "false" : "0u64";

    stateFields.push({
      name: prevName,
      moveType,
      initValue,
      comment: `previous value of ${fieldName}`,
      source: "ta_computed",
    });
  }

  // Add signal output field
  stateFields.push({
    name: "last_signal",
    moveType: "u8",
    initValue: "0u8",
    comment: "0=neutral, 1=buy, 2=sell",
    source: "signal",
  });

  // ── Step 5: Compute buffer capacity ─────────────────────────────────────

  const bufferCapacity = Math.max(maxPeriod + BUFFER_PADDING, 30);
  const warmupMinBars = Math.max(maxPeriod, 10);

  // ── Step 5b: Statement-level conversion (V3) ────────────────────────────
  // Walk ALL parsed statements and convert to IR nodes, not just TA calls.
  // This handles: var assignments, if/else chains, for/while loops,
  // custom function definitions, visual stripping, and strategy calls.

  const varFieldNames = new Set<string>();
  const visualsStripped: string[] = [];
  const funcDefs: IRFuncDef[] = [];
  let needsOHLC = false;
  const varFields: Array<{ name: string; historyDepth: number }> = [];

  // Track var declarations from the parser
  const varDecls = parsed.varDeclarations ?? new Map();
  for (const [varName] of varDecls) {
    const fieldName = toSnakeCase(varName);
    varFieldNames.add(fieldName);
    // Add to state fields if not already present
    if (!stateFields.find(f => f.name === fieldName)) {
      stateFields.push({
        name: fieldName,
        moveType: "u64",
        initValue: "0u64",
        comment: `persistent var from PineScript`,
        source: "ta_computed",
      });
    }
  }

  // Build a set of statements already consumed by the TA extraction pass.
  // These include: ta.* assignments, input.* assignments, indicator()/strategy() calls.
  const consumedTargets = new Set<string>();
  for (const tc of parsed.taCalls) {
    for (const t of tc.targets) consumedTargets.add(t);
  }
  for (const k of Object.keys(parsed.inputs)) consumedTargets.add(k);

  // Filter statements: skip those already handled by TA pass or that are boilerplate
  const unconsumedStmts = parsed.statements.filter(stmt => {
    // Skip indicator() / strategy() declarations
    if (stmt.k === "expr" && stmt.e.k === "call" &&
        (stmt.e.fn === "indicator" || stmt.e.fn === "strategy")) return false;

    // Skip input.* assignments (already in state fields from Step 1)
    if (stmt.k === "assign" && stmt.value.k === "call" &&
        stmt.value.ns === "input") return false;

    // Skip ta.* assignments (already in taOps from Step 2)
    if (stmt.k === "assign" && stmt.value.k === "call" &&
        stmt.value.ns === "ta" && consumedTargets.has(stmt.targets[0])) return false;

    // Skip assignments to TA targets that were destructured (e.g., [macdLine, signalLine] = ta.macd(...))
    if (stmt.k === "assign" && stmt.targets.some(t => consumedTargets.has(t)) &&
        stmt.value.k === "call" && stmt.value.ns === "ta") return false;

    return true;
  });

  // Convert remaining statements to IR
  const stmtIR = convertStatementsToIR(unconsumedStmts, {
    varFieldNames,
    visualsStripped,
    neededTAFns: neededTAFns,
    funcDefs,
    taFieldNames: new Set(stateFields.map(f => f.name)),
    exprConverter: (e: Expr) => convertExpr(e, convertCtx),
  });

  // Append statement-derived IR ops after the TA-call-derived ones
  taOps.push(...stmtIR);

  // Detect OHLC usage by scanning all expressions for high/low/open/volume references
  const allSource = JSON.stringify(parsed.statements);
  if (allSource.includes('"high"') || allSource.includes('"low"') || allSource.includes('"open"') || allSource.includes('"volume"')) {
    needsOHLC = true;
  }

  // Compute history depths for var fields
  for (const fieldName of varFieldNames) {
    let maxDepth = 0;
    const depthPattern = new RegExp(`"${fieldName}".*?"offset":\\s*(\\d+)`, "g");
    let m;
    while ((m = depthPattern.exec(allSource)) !== null) {
      const d = parseInt(m[1]);
      if (d > maxDepth) maxDepth = d;
    }
    varFields.push({ name: fieldName, historyDepth: maxDepth });
  }

  // ── Step 5c: Detect buy/sell conditions from statement IR ───────────────
  // Look for boolean variables named bullish*/bearish*, buy*/sell* etc.
  // and use them as the signal conditions if explicit buyExpr/sellExpr aren't set.

  if (!buyIR || !sellIR) {
    for (const op of stmtIR) {
      if (op.kind === "let" && op.moveType === "bool") {
        const name = op.name.toLowerCase();
        if (!buyIR && (name.includes("bullish") || name.includes("buy") || name.includes("long"))) {
          // Reference the local variable directly (not state.X)
          buyIR = op.expr;
        }
        if (!sellIR && (name.includes("bearish") || name.includes("sell") || name.includes("short"))) {
          sellIR = op.expr;
        }
      }
    }
  }

  // ── Step 6: Build signal logic ──────────────────────────────────────────

  const signalLogic = buildSignalLogic(parsed, buyIR, sellIR);

  // ── Step 7: Generate module name ────────────────────────────────────────

  const moduleName = deriveModuleName(parsed);

  // ── Assemble ────────────────────────────────────────────────────────────

  return {
    moduleName,
    creatorAddr,
    stateFields,
    bufferCapacity,
    warmupMinBars,
    taOps,
    signalLogic,
    neededTAFunctions: [...neededTAFns],
    description: parsed.moveConfig.description,
    inputs,
    funcDefs,
    varFields,
    visualsStripped,
    needsOHLC,
  };
}

// ─── Signal Logic Builder ───────────────────────────────────────────────────

/**
 * Build signal logic from explicit buy/sell expressions or fall back to
 * pattern-based defaults derived from the detected indicator pattern.
 */
function buildSignalLogic(
  parsed: ParsedPine,
  buyIR: IRExpr | null,
  sellIR: IRExpr | null,
): IRSignalLogic {
  // If we have explicit expressions, use them
  if (buyIR && sellIR) {
    return { buyCondition: buyIR, sellCondition: sellIR };
  }

  // Fall back to pattern-based defaults
  const pattern = parsed.detectedPattern;
  const config = parsed.moveConfig;

  switch (pattern) {
    case "sma_cross":
    case "ema_cross": {
      // Fast MA > Slow MA → buy; Fast MA < Slow MA → sell
      const taCalls = parsed.taCalls.filter(t =>
        t.fn === "sma" || t.fn === "ema" || t.fn === "wma" || t.fn === "hma",
      );
      const fastField = taCalls[0] ? toSnakeCase(taCalls[0].targets[0]) : "fast_ma";
      const slowField = taCalls[1] ? toSnakeCase(taCalls[1].targets[0]) : "slow_ma";

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: "<=",
            left: { kind: "prev_field", field: fastField },
            right: { kind: "prev_field", field: slowField },
          },
          right: { kind: "binop", op: ">",
            left: { kind: "field_ref", field: fastField },
            right: { kind: "field_ref", field: slowField },
          },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: ">=",
            left: { kind: "prev_field", field: fastField },
            right: { kind: "prev_field", field: slowField },
          },
          right: { kind: "binop", op: "<",
            left: { kind: "field_ref", field: fastField },
            right: { kind: "field_ref", field: slowField },
          },
        },
      };
    }

    case "rsi": {
      // RSI < 30 → buy (oversold); RSI > 70 → sell (overbought)
      const rsiField = parsed.taCalls.find(t => t.fn === "rsi")
        ? toSnakeCase(parsed.taCalls.find(t => t.fn === "rsi")!.targets[0])
        : "rsi_val";
      const oversold = scaleToU64(30);
      const overbought = scaleToU64(70);

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "<",
          left: { kind: "field_ref", field: rsiField },
          right: { kind: "lit_u64", value: oversold },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: ">",
          left: { kind: "field_ref", field: rsiField },
          right: { kind: "lit_u64", value: overbought },
        },
      };
    }

    case "macd": {
      // MACD histogram crosses above 0 → buy; crosses below 0 → sell
      const histField = parsed.taCalls.find(t => t.fn === "macd")
        ? toSnakeCase(parsed.taCalls.find(t => t.fn === "macd")!.targets[2] || "macd_hist")
        : "macd_hist";
      const zero = scaleToU64(0);

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: "<=",
            left: { kind: "prev_field", field: histField },
            right: { kind: "lit_u64", value: zero },
          },
          right: { kind: "binop", op: ">",
            left: { kind: "field_ref", field: histField },
            right: { kind: "lit_u64", value: zero },
          },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: "&&",
          left: { kind: "binop", op: ">=",
            left: { kind: "prev_field", field: histField },
            right: { kind: "lit_u64", value: zero },
          },
          right: { kind: "binop", op: "<",
            left: { kind: "field_ref", field: histField },
            right: { kind: "lit_u64", value: zero },
          },
        },
      };
    }

    case "bb": {
      // Price < lower band → buy; Price > upper band → sell
      const bbCalls = parsed.taCalls.find(t => t.fn === "bb" || t.fn === "bbands");
      const upperField = bbCalls?.targets[1] ? toSnakeCase(bbCalls.targets[1]) : "bb_upper";
      const lowerField = bbCalls?.targets[2] ? toSnakeCase(bbCalls.targets[2]) : "bb_lower";

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "<",
          left: { kind: "price" },
          right: { kind: "field_ref", field: lowerField },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: ">",
          left: { kind: "price" },
          right: { kind: "field_ref", field: upperField },
        },
      };
    }

    case "stoch": {
      // %K < 20 → buy (oversold); %K > 80 → sell (overbought)
      const kField = parsed.taCalls.find(t => t.fn === "stoch")
        ? toSnakeCase(parsed.taCalls.find(t => t.fn === "stoch")!.targets[0])
        : "stoch_k";

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "<",
          left: { kind: "field_ref", field: kField },
          right: { kind: "lit_u64", value: scaleToU64(20) },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: ">",
          left: { kind: "field_ref", field: kField },
          right: { kind: "lit_u64", value: scaleToU64(80) },
        },
      };
    }

    case "supertrend": {
      // Direction values are encoded as u64 because Move has no signed integer.
      // 1 = up trend, 2 = down trend.
      const dirField = parsed.taCalls.find(t => t.fn === "supertrend")
        ? toSnakeCase(parsed.taCalls.find(t => t.fn === "supertrend")!.targets[1] || "st_direction")
        : "st_direction";

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: "==",
          left: { kind: "field_ref", field: dirField },
          right: { kind: "lit_u64", value: "1" },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: "==",
          left: { kind: "field_ref", field: dirField },
          right: { kind: "lit_u64", value: "2" },
        },
      };
    }

    case "donchian": {
      // Price breaks above upper channel → buy; below lower → sell
      const dcCalls = parsed.taCalls.find(t => t.fn === "donchian" || t.fn.includes("donchian"));
      const upperField = dcCalls?.targets[0] ? toSnakeCase(dcCalls.targets[0]) : "dc_upper";
      const lowerField = dcCalls?.targets[1] ? toSnakeCase(dcCalls.targets[1]) : "dc_lower";

      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: ">",
          left: { kind: "price" },
          right: { kind: "field_ref", field: upperField },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: "<",
          left: { kind: "price" },
          right: { kind: "field_ref", field: lowerField },
        },
      };
    }

    default: {
      // Unknown / custom pattern — use any partial expression we have,
      // or fall back to a simple price-vs-SMA comparison
      return {
        buyCondition: buyIR ?? {
          kind: "binop", op: ">",
          left: { kind: "price" },
          right: { kind: "field_ref", field: "last_price" },
        },
        sellCondition: sellIR ?? {
          kind: "binop", op: "<",
          left: { kind: "price" },
          right: { kind: "field_ref", field: "last_price" },
        },
      };
    }
  }
}

// ─── Module Name Derivation ─────────────────────────────────────────────────

function deriveModuleName(parsed: ParsedPine): string {
  // First: extract strategy name from strategy("Name", ...) call in the AST
  for (const stmt of parsed.statements) {
    if (stmt.k === "expr" && stmt.e.k === "call" && stmt.e.fn === "strategy") {
      const firstArg = stmt.e.args[0];
      if (firstArg?.k === "str" && firstArg.v.length > 2) {
        return toModuleName(firstArg.v);
      }
    }
  }

  const { detectedPattern, moveConfig } = parsed;

  // Fall back to pattern + periods
  switch (detectedPattern) {
    case "sma_cross":
      return toModuleName(`sma_cross_${moveConfig.shortPeriod}_${moveConfig.longPeriod}`);
    case "ema_cross":
      return toModuleName(`ema_cross_${moveConfig.shortPeriod}_${moveConfig.longPeriod}`);
    case "rsi":
      return toModuleName(`rsi_${moveConfig.shortPeriod}`);
    case "macd":
      return toModuleName(`macd_${moveConfig.shortPeriod}_${moveConfig.longPeriod}_${moveConfig.thirdPeriod}`);
    case "bb":
      return toModuleName(`bb_${moveConfig.shortPeriod}`);
    case "stoch":
      return toModuleName(`stoch_${moveConfig.shortPeriod}_${moveConfig.longPeriod}`);
    case "supertrend":
      return toModuleName(`supertrend_${moveConfig.shortPeriod}`);
    case "donchian":
      return toModuleName(`donchian_${moveConfig.shortPeriod}`);
    case "cci":
      return toModuleName(`cci_${moveConfig.shortPeriod}`);
    case "williams":
      return toModuleName(`williams_r_${moveConfig.shortPeriod}`);
    case "atr_band":
      return toModuleName(`atr_band_${moveConfig.shortPeriod}`);
    case "custom":
    case "unknown":
    default:
      return "custom_indicator";
  }
}

// ─── V3: Statement-Level Conversion ──────────────────────────────────────────

/** Visual-only PineScript functions that produce no on-chain logic */
const VISUAL_FNS = new Set([
  "plot", "plotshape", "plotchar", "plotarrow", "fill", "bgcolor",
  "barcolor", "hline", "plotcandle", "plotbar",
]);
const VISUAL_NS_FNS = new Set([
  "label.new", "label.set_text", "label.set_xy", "label.delete",
  "line.new", "line.set_xy1", "line.delete",
  "box.new", "box.set_lefttop", "box.delete",
  "table.new", "table.cell",
]);

interface ConvertContext {
  varFieldNames: Set<string>;
  visualsStripped: string[];
  neededTAFns: Set<string>;
  funcDefs: IRFuncDef[];
  taFieldNames: Set<string>;
  exprConverter: (e: Expr) => IRExpr;
}

// Stmt type from the parser
type Stmt = import("./pine-parser").Stmt;

/**
 * Convert an array of PineScript statements to IR statements.
 * This is the core of the V3 universal transpiler — it walks every statement
 * and produces the Move-equivalent IR, following patterns from the Sol2Move transpiler.
 */
/** Infer the Move type from an IR expression */
function inferMoveType(expr: IRExpr): string {
  switch (expr.kind) {
    case "lit_bool": return "bool";
    case "na_check": case "not_na": return "bool";
    case "binop":
      if (["&&", "||", ">", "<", ">=", "<=", "==", "!="].includes(expr.op)) return "bool";
      return "u64";
    case "unop":
      if (expr.op === "!") return "bool";
      return "u64";
    default: return "u64";
  }
}

function convertStatementsToIR(stmts: Stmt[], ctx: ConvertContext): IRTAOp[] {
  const result: IRTAOp[] = [];

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];

    // Skip duplicate: an assign to a var field that is immediately followed by
    // an if block whose body contains the same assignment. This is a parser
    // artifact where PineScript's indented if-body reassignment also appears
    // as a top-level statement.
    if (stmt.k === "assign" && ctx.varFieldNames.has(toSnakeCase(stmt.targets[0] ?? ""))) {
      const next = stmts[i + 1];
      if (next?.k === "if" && next.then.some(
        s => s.k === "assign" && s.targets[0] === stmt.targets[0]
      )) {
        continue; // skip the duplicate
      }
    }

    const converted = convertSingleStmt(stmt, ctx);
    if (converted) result.push(...converted);
  }

  return result;
}

function convertSingleStmt(stmt: Stmt, ctx: ConvertContext): IRTAOp[] | null {
  switch (stmt.k) {
    case "assign": {
      const targetName = toSnakeCase(stmt.targets[0] ?? "tmp");

      // Skip var initializations — they're handled by init_module via initValue.
      // Detect: target is a var field AND the value is a simple literal (0, na, false)
      if (ctx.varFieldNames.has(targetName)) {
        const v = stmt.value;
        const isInit = (v.k === "num" && (v.v === 0 || v.v === 0.0)) ||
                       (v.k === "na") ||
                       (v.k === "bool" && v.v === false);
        if (isInit) return null; // init already in struct

        // Reassignment to a var → state update
        const valueIR = ctx.exprConverter(stmt.value);
        return [{ kind: "state_update", field: targetName, expr: valueIR }];
      }

      // Strip assignments where the RHS is a visual call (e.g., x = plot(...))
      if (stmt.value.k === "call") {
        const fn = stmt.value.fn;
        const fullFn = stmt.value.ns ? `${stmt.value.ns}.${fn}` : fn;
        if (VISUAL_FNS.has(fn) || VISUAL_NS_FNS.has(fullFn)) {
          ctx.visualsStripped.push(fullFn);
          return [{ kind: "noop", comment: `stripped: ${targetName} = ${fullFn}()` }];
        }
      }

      const valueIR = ctx.exprConverter(stmt.value);

      // If target is already a TA-computed field, emit state_update
      if (ctx.taFieldNames.has(targetName)) {
        return [{ kind: "state_update", field: targetName, expr: valueIR }];
      }

      // Otherwise it's a local variable — infer type from expression
      const moveType = inferMoveType(valueIR);
      return [{ kind: "let", name: targetName, moveType, expr: valueIR }];
    }

    case "if": {
      const condIR = ctx.exprConverter(stmt.cond);
      const thenIR = convertStatementsToIR(stmt.then, ctx);
      const elsIR = stmt.els ? convertStatementsToIR(stmt.els, ctx) : undefined;

      // If the body is entirely noops (stripped visuals / strategy calls), skip
      const hasRealOps = (ops: IRTAOp[]) => ops.some(o => o.kind !== "noop");
      if (!hasRealOps(thenIR) && (!elsIR || !hasRealOps(elsIR))) {
        return null;
      }

      return [{
        kind: "if",
        cond: condIR,
        then: thenIR,
        els: elsIR,
      }];
    }

    case "for": {
      const startIR = ctx.exprConverter(stmt.start);
      const endIR = ctx.exprConverter(stmt.end);
      const stepIR: IRExpr = stmt.step
        ? ctx.exprConverter(stmt.step)
        : { kind: "lit_u64", value: "1" };
      const bodyIR = convertStatementsToIR(stmt.body, ctx);

      return [{
        kind: "for",
        varName: toSnakeCase(stmt.varName),
        start: startIR,
        end: endIR,
        step: stepIR,
        body: bodyIR,
        maxIters: 256, // gas safety cap
      }];
    }

    case "while": {
      const condIR = ctx.exprConverter(stmt.cond);
      const bodyIR = convertStatementsToIR(stmt.body, ctx);

      return [{
        kind: "while",
        cond: condIR,
        body: bodyIR,
        maxIters: 256,
      }];
    }

    case "funcdef": {
      // Convert custom PineScript function to an IRFuncDef
      const bodyIR = convertStatementsToIR(stmt.body, ctx);
      ctx.funcDefs.push({
        name: toSnakeCase(stmt.name),
        params: stmt.params.map(p => ({ name: toSnakeCase(p), moveType: "u64" })),
        returnType: "u64",
        body: bodyIR,
      });
      return null; // funcdef doesn't produce inline IR, it's stored separately
    }

    case "visual": {
      // Strip visual-only calls — they produce no on-chain logic
      ctx.visualsStripped.push(stmt.fn);
      return [{ kind: "noop", comment: `stripped: ${stmt.fn}()` }];
    }

    case "expr": {
      const e = stmt.e;

      // Check for visual function calls
      if (e.k === "call") {
        const fullName = e.ns ? `${e.ns}.${e.fn}` : e.fn;
        if (VISUAL_FNS.has(e.fn) || VISUAL_NS_FNS.has(fullName)) {
          ctx.visualsStripped.push(fullName);
          return [{ kind: "noop", comment: `stripped: ${fullName}()` }];
        }

        // strategy.entry → signal BUY (handled by signal logic builder)
        if (e.ns === "strategy" && e.fn === "entry") {
          return [{ kind: "noop", comment: "strategy.entry() → signal logic" }];
        }
        if (e.ns === "strategy" && e.fn === "close") {
          return [{ kind: "noop", comment: "strategy.close() → signal logic" }];
        }
      }

      // General expression statement — skip (no useful side effects on-chain)
      return null;
    }

    default:
      return null;
  }
}
