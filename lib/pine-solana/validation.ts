import type { Bar, CompileOptions, ProgramIR } from "./ir";
import { createPineRuntime } from "./runtime";

function record(v: unknown): v is Record<string, unknown> { return !!v && typeof v === "object" && !Array.isArray(v); }
/** Validate public API/CLI inputs before source compilation. */
export function validateCompileOptions(value: unknown): CompileOptions {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("options must be an object");
  const allowed = new Set(["inputs", "signals", "maxHistory", "maxStateBytes", "programId"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown compiler option ${key}`);
  if (value.inputs !== undefined) {
    if (!record(value.inputs) || Object.keys(value.inputs).length > 128) throw new Error("inputs must contain at most 128 named values");
    for (const [key, v] of Object.entries(value.inputs)) if (!/^[A-Za-z_]\w*$/.test(key) || !["number", "boolean", "string"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v) || typeof v === "string" && v.length > 4096) throw new Error(`Invalid input override ${key}`);
  }
  if (value.signals !== undefined) {
    if (!record(value.signals)) throw new Error("signals must be an object");
    for (const [key, v] of Object.entries(value.signals)) {
      if (!["long", "short", "close", "quantity"].includes(key)) throw new Error(`Unknown signal field ${key}`);
      if (key === "quantity" ? typeof v !== "number" || !Number.isFinite(v) || v <= 0 : typeof v !== "string" || !v.trim() || v.length > 4096 || /[\r\n]/.test(v)) throw new Error(`Invalid signal ${key}`);
    }
  }
  for (const key of ["maxHistory", "maxStateBytes"]) if (value[key] !== undefined && !Number.isInteger(value[key])) throw new Error(`${key} must be an integer`);
  if (value.programId !== undefined && (typeof value.programId !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.programId))) throw new Error("programId must be a base58 Solana public key");
  return value as CompileOptions;
}

export interface ReferenceTrace {
  schemaVersion: 1;
  provenance: {
    origin: "tradingview-export" | "hand-calculated";
    sourceHash: string;
    configHash: string;
    symbol: string;
    timeframe: string;
    capturedAt: string;
    notes?: string;
  };
  bars: Bar[];
  /** One output row for each input bar; keys are Pine output names. */
  outputs: Array<Record<string, number | boolean | null>>;
}
export interface TraceCheck {
  ok: boolean;
  origin: ReferenceTrace["provenance"]["origin"];
  checkedBars: number;
  checkedValues: number;
  absoluteTolerance: number;
  relativeTolerance: number;
  mismatches: Array<{ bar: number; time: number; name: string; expected: number | boolean | null; actual: number | boolean | null | undefined }>;
  scope: "named-series-on-exact-supplied-dataset";
}

/** Independent, supplied output traces are the parity gate; IR-vs-IR tests alone are not Pine conformance. */
export function verifyReferenceTrace(ir: ProgramIR, reference: ReferenceTrace, absoluteTolerance = 1e-8, relativeTolerance = 1e-8): TraceCheck {
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0 || !Number.isFinite(relativeTolerance) || relativeTolerance < 0) throw new Error("Tolerances must be finite and nonnegative");
  if (reference.schemaVersion !== 1 || !reference.provenance || !["tradingview-export", "hand-calculated"].includes(reference.provenance.origin)) throw new Error("Reference must identify its origin and schemaVersion");
  if (reference.provenance.sourceHash !== ir.sourceHash || reference.provenance.configHash !== ir.configHash) throw new Error("Reference source/config hash does not match this exact compilation");
  if (!reference.provenance.symbol || !reference.provenance.timeframe || !Number.isFinite(Date.parse(reference.provenance.capturedAt))) throw new Error("Reference provenance must identify symbol, timeframe and capture date");
  if (!Array.isArray(reference.bars) || !Array.isArray(reference.outputs) || !reference.bars.length || reference.bars.length > 100_000 || reference.bars.length !== reference.outputs.length) throw new Error("Reference needs equal, nonempty bar and output arrays (at most 100000 bars)");
  const names = Object.keys(reference.outputs[0] ?? {});
  if (!names.length || names.some(name => !Object.prototype.hasOwnProperty.call(ir.outputs, name))) throw new Error("Reference must name at least one actual compiled output");
  const runtime = createPineRuntime(ir);
  const mismatches: TraceCheck["mismatches"] = [];
  let checkedValues = 0, totalMismatches = 0;
  for (let i = 0; i < reference.bars.length; i++) {
    const expected = reference.outputs[i];
    if (!record(expected) || Object.keys(expected).length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(expected, name))) throw new Error(`Reference output schema changes at bar ${i}`);
    const actual = runtime.push(reference.bars[i]).outputs;
    for (const name of names) {
      const want = expected[name], got = actual[name];
      if (want !== null && typeof want !== "boolean" && (typeof want !== "number" || !Number.isFinite(want))) throw new Error(`Invalid reference value at bar ${i}: ${name}`);
      checkedValues++;
      const matches = typeof want === "number" && typeof got === "number" ? Math.abs(want - got) <= absoluteTolerance + relativeTolerance * Math.max(Math.abs(want), Math.abs(got)) : want === got;
      if (!matches) { totalMismatches++; if (mismatches.length < 100) mismatches.push({ bar: i, time: reference.bars[i].time, name, expected: want, actual: got }); }
    }
  }
  return { ok: totalMismatches === 0, origin: reference.provenance.origin, checkedBars: reference.bars.length, checkedValues, absoluteTolerance, relativeTolerance, mismatches, scope: "named-series-on-exact-supplied-dataset" };
}
