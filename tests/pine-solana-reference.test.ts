import test from "node:test";
import assert from "node:assert/strict";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { verifyReferenceTrace } from "../lib/pine-solana/validation";
import type { ReferenceTrace } from "../lib/pine-solana/validation";
import type { ProgramIR } from "../lib/pine-solana/ir";

function program(body = "value = close"): ProgramIR {
  const result = compilePineToSolana(`//@version=6\nstrategy("Reference verification")\n${body}\nstrategy.entry("L", strategy.long)\n`);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.ir!;
}

function reference(ir: ProgramIR, closes: number[], outputs: ReferenceTrace["outputs"]): ReferenceTrace {
  return {
    schemaVersion: 1,
    provenance: { origin: "hand-calculated", sourceHash: ir.sourceHash, configHash: ir.configHash, symbol: "SYNTHETIC", timeframe: "1m", capturedAt: "2026-11-06T00:00:00Z" },
    bars: closes.map((close, i) => ({ time: 60_000 * (i + 1), open: close, high: close, low: close, close, volume: 1 })),
    outputs,
  };
}

test("reference tolerance comparison cannot pass through floating-point overflow", () => {
  const ir = program();
  const expected = reference(ir, [-1e308], [{ value: 1e308 }]);
  // The mathematical error is 2e308, while the allowed error is only 1.9e308.
  // Direct subtraction and tolerance addition both overflow to Infinity.
  assert.equal(verifyReferenceTrace(ir, expected, 1e308, 0.9).ok, false);
  assert.equal(verifyReferenceTrace(ir, expected, 1e308, 1).ok, true);
  assert.equal(verifyReferenceTrace(ir, expected, 0, 1.9).ok, false);
  assert.equal(verifyReferenceTrace(ir, expected, 0, 2).ok, true);
  assert.equal(verifyReferenceTrace(ir, expected).ok, false);
  const tiny = reference(ir, [1e-300], [{ value: 2e-300 }]);
  assert.equal(verifyReferenceTrace(ir, tiny, 0, 0).ok, false);
  assert.equal(verifyReferenceTrace(ir, tiny, 0, 0.5).ok, true);
});

test("reference reports retain the complete mismatch count and per-series evidence", () => {
  const ir = program("value = close\nprevious = close[1]");
  const closes = Array.from({ length: 201 }, (_, i) => i + 1);
  const expected = reference(ir, closes, closes.map((_, i) => ({ value: 0, previous: i === 0 ? null : i })));
  const report = verifyReferenceTrace(ir, expected, 0, 0);
  assert.equal(report.ok, false);
  assert.equal(report.checkedBars, 201);
  assert.equal(report.checkedValues, 402);
  assert.equal(report.mismatchCount, 201);
  assert.equal(report.mismatches.length, 100);
  assert.equal(report.mismatchesTruncated, true);
  assert.deepEqual(report.series.value, { checked: 201, mismatches: 201, expectedMissing: 0, actualMissing: 0, firstMismatchBar: 0 });
  assert.deepEqual(report.series.previous, { checked: 201, mismatches: 0, expectedMissing: 1, actualMissing: 1, firstMismatchBar: null });
  assert.equal(report.sourceHash, ir.sourceHash);
  assert.equal(report.configHash, ir.configHash);
});

test("zero, false, and missing reference observations remain distinct", () => {
  const ir = program("value = close\nprevious = close[1]\nflag = close > open");
  const expected = reference(ir, [0], [{ value: 0, previous: null, flag: false }]);
  assert.equal(verifyReferenceTrace(ir, expected, 0, 0).ok, true);
  for (const outputs of [[{ value: null }], [{ previous: 0 }], [{ flag: 0 }], [{ flag: null }]]) {
    const report = verifyReferenceTrace(ir, { ...expected, outputs }, 0, 0);
    assert.equal(report.ok, false);
    assert.equal(report.mismatchCount, 1);
  }
});

test("reference provenance rejects coercible nonstrings and ambiguous capture dates", () => {
  const ir = program();
  const expected = reference(ir, [1], [{ value: 1 }]);
  for (const patch of [
    { symbol: {} }, { symbol: "  " }, { timeframe: 60 }, { timeframe: "" },
    { capturedAt: "2026-11-06" }, { capturedAt: "2026-11-06T00:00:00" },
    { capturedAt: true }, { capturedAt: "2026-02-30T00:00:00Z" },
    { notes: { claim: "independent" } }, { certified: true },
  ]) {
    const invalid = { ...expected, provenance: { ...expected.provenance, ...patch } } as unknown as ReferenceTrace;
    assert.throws(() => verifyReferenceTrace(ir, invalid));
  }
  assert.throws(() => verifyReferenceTrace(ir, null as unknown as ReferenceTrace), /schemaVersion/);
  assert.equal(verifyReferenceTrace(ir, expected).ok, true);
});
