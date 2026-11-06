/** Generate local VM expectations from the validated IR. This is backend parity,
 * not an independent TradingView oracle. The VM still executes the actual SBF.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPineRuntime } from "../lib/pine-solana/runtime";
import type { Bar, ProgramIR } from "../lib/pine-solana/ir";

async function main() {
  const project = resolve(process.argv[2] ?? "build/ema-cross");
  const ir: ProgramIR = JSON.parse(await readFile(resolve(project, "program.ir.json"), "utf8"));
  const candleBytes = await readFile("examples/pine-solana/candles.json");
  const candles: Bar[] = JSON.parse(candleBytes.toString("utf8"));
  const runtime = createPineRuntime(ir);
  const trace = candles.map(bar => {
    const result = runtime.push(bar);
    return { intents: result.intents, state: runtime.snapshot() };
  });
  const reference = { schemaVersion: 1, scope: "TypeScript-versus-actual-SBF; not-independent-Pine-conformance", sourceHash: ir.sourceHash, configHash: ir.configHash,
    candlesSha256: createHash("sha256").update(candleBytes).digest("hex"), trace };
  await writeFile(resolve(project, "svm-reference.json"), JSON.stringify(reference) + "\n");
  console.log(JSON.stringify({ project, bars: trace.length, stateCellsCompared: trace.length * ir.stateCells, intents: trace.reduce((count, row) => count + row.intents.length, 0) }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
