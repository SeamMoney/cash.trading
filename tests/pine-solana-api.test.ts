import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/launchpad/compile-solana/route";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { validateCompileOptions, verifyReferenceTrace } from "../lib/pine-solana/validation";
import type { ReferenceTrace } from "../lib/pine-solana/validation";

const pine = `//@version=6\nstrategy("API test")\nx = ta.sma(close, 2)\nif close > x\n    strategy.entry("L", strategy.long)\n`;
test("compile endpoint returns real artifacts without deployment", async () => {
  const response = await POST(new Request("http://localhost/api/launchpad/compile-solana", { method: "POST", body: JSON.stringify({ pineScript: pine }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.manifest.deployment, "not-deployed");
  assert.ok(Object.keys(body.files).some(path => path.endsWith("Cargo.toml")));
  assert.ok(body.files["program.ir.json"]); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("unsupported scripts return 422 and no generated artifacts", async () => {
  const response = await POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ pineScript: pine.replace("ta.sma(close, 2)", 'request.security("X", "60", close)') }) }));
  assert.equal(response.status, 422); assert.deepEqual((await response.json()).files, {});
});
test("endpoint rejects malformed, oversized and unexpected fields", async () => {
  for (const body of ["{", JSON.stringify({ pineScript: pine, publish: true }), JSON.stringify({ pineScript: pine, options: { inputs: { x: {} } } }), JSON.stringify({ pineScript: 1 })]) {
    assert.equal((await POST(new Request("http://localhost/", { method: "POST", body }))).status, 400);
  }
  assert.equal((await POST(new Request("http://localhost/", { method: "POST", body: "x".repeat(160001) }))).status, 413);
});
test("public option schema rejects coercion and unknown fields", () => {
  for (const options of [[], null, { inputs: { bad: null } }, { inputs: { x: Infinity } }, { signals: { long: "true\nx = 1" } }, { signals: { quantity: 0 } }, { maxHistory: "128" }, { programId: "bad" }, { deploy: true }]) assert.throws(() => validateCompileOptions(options));
  assert.deepEqual(validateCompileOptions({ signals: { long: "buy", quantity: 1 } }), { signals: { long: "buy", quantity: 1 } });
});
test("independent reference comparison cannot pass by checking zero values or another config", () => {
  const compiled = compilePineToSolana(pine); assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
  const ir = compiled.ir!;
  const reference: ReferenceTrace = {
    schemaVersion: 1,
    provenance: { origin: "hand-calculated", sourceHash: ir.sourceHash, configHash: ir.configHash, symbol: "SYNTHETIC", timeframe: "1m", capturedAt: "2026-11-05T00:00:00Z" },
    bars: [1, 3, 7].map((close, i) => ({ time: 60000 * (i + 1), open: close, high: close, low: close, close, volume: 10 })),
    outputs: [{ x: null }, { x: 2 }, { x: 5 }],
  };
  const report = verifyReferenceTrace(ir, reference);
  assert.equal(report.ok, true); assert.equal(report.checkedValues, 3); assert.equal(report.origin, "hand-calculated");
  const wrong = structuredClone(reference); wrong.outputs[2].x = 6;
  assert.equal(verifyReferenceTrace(ir, wrong).ok, false);
  assert.throws(() => verifyReferenceTrace(ir, { ...reference, bars: [], outputs: [] }));
  assert.throws(() => verifyReferenceTrace(ir, { ...reference, outputs: [{}, {}, {}] }));
  assert.throws(() => verifyReferenceTrace(ir, { ...reference, provenance: { ...reference.provenance, configHash: "wrong" } }));
  assert.throws(() => verifyReferenceTrace(ir, reference, -1));
});
