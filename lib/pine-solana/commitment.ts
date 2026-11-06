import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { IR_VERSION, SOLANA_COMPILER_VERSION } from "./ir";
import type { ProgramIR } from "./ir";

/** A semantic revision changes the commitment even when its graph happens to be identical. */
export const NUMERIC_PROFILE = "f64-confirmed-bar-experimental-v2";
const COMMITMENT_DOMAIN = "cash.trading/pine-solana/program/v2";

type CommittedProgram = Pick<ProgramIR,
  "version" | "compilerVersion" | "pineVersion" | "sourceHash" | "nodes" | "orders" |
  "layouts" | "inputs" | "outputs" | "stateCells" | "maxHistory"
>;

/** JSON object order is irrelevant; array order and every executable field are significant. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Program commitment cannot contain a nonfinite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("Program commitment requires JSON values");
}

/** Uses the same portable SHA-256 implementation in compiler, simulator, and artifact checks. */
export function computeConfigHash(ir: CommittedProgram): string {
  const committed = {
    domain: COMMITMENT_DOMAIN,
    numericProfile: NUMERIC_PROFILE,
    irVersion: ir.version,
    compilerVersion: ir.compilerVersion,
    pineVersion: ir.pineVersion,
    sourceHash: ir.sourceHash,
    nodes: ir.nodes,
    orders: ir.orders,
    layouts: ir.layouts,
    inputs: ir.inputs,
    outputs: ir.outputs,
    stateCells: ir.stateCells,
    maxHistory: ir.maxHistory,
  };
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(committed))));
}

/** Call after bounded structural validation. Integrity is not proof of the claimed Pine source. */
export function assertProgramCommitment(ir: ProgramIR): void {
  if (ir.version !== IR_VERSION || ir.compilerVersion !== SOLANA_COMPILER_VERSION) {
    throw new Error("Unsupported Pine IR/compiler version; recompile the original source");
  }
  if (ir.configHash !== computeConfigHash(ir)) {
    throw new Error("Pine IR configuration hash does not match its executable graph");
  }
}
