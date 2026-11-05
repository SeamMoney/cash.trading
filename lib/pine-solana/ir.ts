/** Versioned, bounded graph shared by the TypeScript evaluator and Rust backend. */
export const SOLANA_COMPILER_VERSION = "0.1.0";
export const IR_VERSION = 1;
export type ValueType = "number" | "bool";
export type Op =
  | "const" | "open" | "high" | "low" | "close" | "volume" | "time" | "bar_index"
  | "add" | "sub" | "mul" | "div" | "mod" | "neg" | "abs" | "min" | "max"
  | "floor" | "ceil" | "round" | "sqrt" | "sign" | "is_na" | "nz"
  | "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "and" | "or" | "not" | "select"
  | "history" | "persistent" | "sma" | "ema" | "rma" | "highest" | "lowest" | "stdev" | "variance" | "sum" | "wma";
export interface Node {
  op: Op;
  type: ValueType;
  a: number;
  b: number;
  c: number;
  /** Numeric literal, or null for Pine na. */
  value: number | null;
  /** Period / history offset. */
  period: number;
  line: number;
}
export interface Layout { historyOffset: number; historyLength: number; auxOffset: number; auxLength: number }
export interface Order {
  kind: "entry" | "close" | "close_all";
  id: string;
  side: -1 | 0 | 1;
  condition: number;
  /** A node for fixed asset units. null on closes. */
  quantity: number | null;
}
export interface Diagnostic { severity: "error" | "warning" | "info"; code: string; message: string; line: number; column: number }
export interface CompileOptions {
  inputs?: Record<string, number | boolean | string>;
  /** Indicator scripts need explicit boolean signal expressions. Never infer trading from plots. */
  signals?: { long?: string; short?: string; close?: string; quantity?: number };
  maxHistory?: number;
  maxStateBytes?: number;
  programId?: string;
}
export interface ProgramIR {
  version: 1;
  compilerVersion: string;
  pineVersion: number;
  title: string;
  sourceHash: string;
  configHash: string;
  nodes: Node[];
  layouts: Layout[];
  orders: Order[];
  outputs: Record<string, number>;
  stateCells: number;
  maxHistory: number;
  inputs: Record<string, number | boolean | string>;
}
export interface CompileResult {
  ok: boolean;
  target: "solana";
  executionModel: "confirmed-bar-signal";
  diagnostics: Diagnostic[];
  ir?: ProgramIR;
  files: Record<string, string>;
  manifest?: Record<string, unknown>;
}
export interface Bar { open: number; high: number; low: number; close: number; volume: number; time: number }
export interface OrderIntent { kind: Order["kind"]; id: string; side: -1 | 0 | 1; quantity: number | null; barIndex: number; time: number }
export interface Evaluation { values: Array<number | null>; outputs: Record<string, number | boolean | null>; intents: OrderIntent[] }
