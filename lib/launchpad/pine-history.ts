import type { Expr, InputDef } from "./pine-parser";

/**
 * The on-chain price trace is a sliding vector. Keep a hard ceiling on any
 * source-controlled history request so a script cannot turn every tick into an
 * unbounded vector shift or force an impractically large warmup.
 */
export const MAX_ON_CHAIN_HISTORY_OFFSET = 2_048;

export interface BoundedDynamicHistoryIndex {
  series: "close";
  inputName: string;
  defaultOffset: number;
  minOffset: number;
  maxOffset: number;
}

export type DynamicHistoryIndexAnalysis =
  | { ok: true; value: BoundedDynamicHistoryIndex }
  | { ok: false; reason: string };

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * Prove that a dynamic Pine history lookup is safe before it reaches the IR.
 *
 * For now, only a direct, bounded `input.int` may select a close-price offset:
 * `close[n]`, where `n = input.int(..., minval=0, maxval=...)`.
 *
 * Arbitrary expressions and loop locals need a separate integer-domain IR.
 * Named series need their own ring buffers. Rejecting both is intentional: a
 * plausible but different strategy is worse than an explicit compile error.
 */
export function analyzeBoundedDynamicHistoryIndex(
  expr: Expr,
  inputs: Record<string, InputDef>,
): DynamicHistoryIndexAnalysis {
  if (expr.k !== "binop" || expr.op !== "index") {
    return { ok: false, reason: "the expression is not a dynamic history lookup" };
  }

  if (expr.l.k !== "id") {
    return {
      ok: false,
      reason: "history indexing is only supported directly on the close series",
    };
  }
  if (expr.l.name !== "close") {
    return {
      ok: false,
      reason: `dynamic history for \`${expr.l.name}\` needs a dedicated per-series buffer; only \`close[input]\` is supported`,
    };
  }
  if (expr.r.k !== "id") {
    return {
      ok: false,
      reason: "the offset must be a direct bounded input.int name, not an expression or loop local",
    };
  }

  const input = inputs[expr.r.name];
  if (!input || input.type !== "int") {
    return {
      ok: false,
      reason: `\`${expr.r.name}\` must be declared with input.int`,
    };
  }
  if (!isInteger(input.default)) {
    return { ok: false, reason: `input \`${expr.r.name}\` needs an integer default` };
  }
  if (!isInteger(input.minval) || !isInteger(input.maxval)) {
    return {
      ok: false,
      reason: `input \`${expr.r.name}\` needs explicit integer minval and maxval bounds`,
    };
  }
  if (input.minval < 0) {
    return {
      ok: false,
      reason: `input \`${expr.r.name}\` has a negative minval; history offsets must be non-negative`,
    };
  }
  if (input.maxval < input.minval) {
    return {
      ok: false,
      reason: `input \`${expr.r.name}\` has maxval below minval`,
    };
  }
  if (input.default < input.minval || input.default > input.maxval) {
    return {
      ok: false,
      reason: `input \`${expr.r.name}\` has a default outside its declared bounds`,
    };
  }
  if (input.maxval > MAX_ON_CHAIN_HISTORY_OFFSET) {
    return {
      ok: false,
      reason: `input \`${expr.r.name}\` can request ${input.maxval} bars, above the on-chain limit of ${MAX_ON_CHAIN_HISTORY_OFFSET}`,
    };
  }

  return {
    ok: true,
    value: {
      series: "close",
      inputName: expr.r.name,
      defaultOffset: input.default,
      minOffset: input.minval,
      maxOffset: input.maxval,
    },
  };
}
