import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compilePineToSolana } from "../lib/pine-solana/compiler";

test("CLI imports independent CSV expectations and reports success, mismatch, and malformed provenance distinctly", () => {
  const directory = mkdtempSync(join(tmpdir(), "pine-solana-reference-"));
  const source = '//@version=6\nstrategy("CLI reference")\nvalue = close / 2\nstrategy.entry("L", strategy.long)\n';
  const compiled = compilePineToSolana(source);
  assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
  const ir = compiled.ir!;
  const mapping = {
    schemaVersion: 1,
    provenance: { origin: "hand-calculated", sourceHash: ir.sourceHash, configHash: ir.configHash, symbol: "SYNTHETIC", timeframe: "1m", capturedAt: "2026-11-06T00:00:00Z" },
    timeFormat: "unix-seconds",
    columns: { time: "time", open: "open", high: "high", low: "low", close: "close", volume: "volume" },
    outputs: { value: "half" },
  };
  const run = (...args: string[]) => {
    const child = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("scripts/pine-solana.ts"), ...args], { encoding: "utf8", timeout: 10_000 });
    assert.equal(child.error, undefined, child.error?.message);
    return child;
  };
  try {
    const pine = join(directory, "strategy.pine"), csv = join(directory, "chart.csv"), options = join(directory, "mapping.json");
    const reference = join(directory, "reference.json"), report = join(directory, "report.json");
    writeFileSync(pine, source);
    // Hand-calculated: half of 2 and 4 is 1 and 2. No evaluator generates this CSV.
    writeFileSync(csv, "time,open,high,low,close,volume,half\n60,2,2,2,2,1,1\n120,4,4,4,4,2,2\n");
    writeFileSync(options, JSON.stringify(mapping));
    const imported = run("import-reference", pine, "--csv", csv, "--mapping", options, "--out", reference);
    assert.equal(imported.status, 0, imported.stderr);
    const trace = JSON.parse(readFileSync(reference, "utf8"));
    assert.deepEqual(trace.outputs, [{ value: 1 }, { value: 2 }]);
    assert.equal(trace.provenance.origin, "hand-calculated");
    const verified = run("verify", pine, "--reference", reference, "--out", report);
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(readFileSync(report, "utf8")).checkedValues, 2);

    trace.outputs[1].value = 9;
    writeFileSync(reference, JSON.stringify(trace));
    const mismatch = run("verify", pine, "--reference", reference, "--out", report);
    assert.equal(mismatch.status, 3, mismatch.stderr);
    const failed = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(failed.ok, false);
    assert.equal(failed.mismatchCount, 1);
    assert.equal(failed.mismatches[0].expected, 9);
    assert.equal(failed.mismatches[0].actual, 2);

    mapping.provenance.configHash = "0".repeat(64);
    writeFileSync(options, JSON.stringify(mapping));
    const absent = join(directory, "must-not-exist.json");
    const rejected = run("import-reference", pine, "--csv", csv, "--mapping", options, "--out", absent);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /source\/config hash/);
    assert.equal(existsSync(absent), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
