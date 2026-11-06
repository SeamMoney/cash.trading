import test from "node:test";
import assert from "node:assert/strict";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { assertProgramCommitment, computeConfigHash, NUMERIC_PROFILE } from "../lib/pine-solana/commitment";
import { createPineRuntime } from "../lib/pine-solana/runtime";
import { generateRustFiles } from "../lib/pine-solana/rust-codegen";
import type { Bar, ProgramIR } from "../lib/pine-solana/ir";

const source = `//@version=6
strategy("Committed program")
length = input.int(2, "Period")
average = ta.sma(close, length)
signal = close > average
if signal
    strategy.entry("Long", strategy.long, qty=1)
`;
const candle = (close: number, time: number): Bar => ({ time, open: close, high: close, low: close, close, volume: 1 });
function compile() {
  const result = compilePineToSolana(source);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result;
}

test("serialized compiler artifacts carry a reproducible semantic-version commitment", () => {
  const result = compile();
  const ir: ProgramIR = JSON.parse(result.files["program.ir.json"]);
  assertProgramCommitment(ir);
  assert.equal(ir.configHash, computeConfigHash(ir));
  assert.equal(result.manifest!.configHash, ir.configHash);
  assert.equal(result.manifest!.numericProfile, NUMERIC_PROFILE);
  assert.equal(ir.compilerVersion, "0.2.0");
  assert.equal(compilePineToSolana(source.replaceAll("\n", "\r\n")).ir!.configHash, ir.configHash);
  const reordered = structuredClone(ir);
  reordered.outputs = Object.fromEntries(Object.entries(ir.outputs).reverse());
  reordered.nodes = ir.nodes.map(node => Object.fromEntries(Object.entries(node).reverse()) as unknown as ProgramIR["nodes"][number]);
  assert.equal(computeConfigHash(reordered), ir.configHash, "JSON key order cannot change program identity");
  reordered.title = "Presentation label only";
  assert.equal(computeConfigHash(reordered), ir.configHash);
});

test("changing executable IR cannot retain the old configuration identity", () => {
  const ir = compile().ir!;
  const mutations: Array<[string, (copy: ProgramIR) => void]> = [
    ["quantity value", copy => { copy.nodes[copy.orders[0].quantity!].value = 2; }],
    ["order id", copy => { copy.orders[0].id = "Changed"; }],
    ["order side", copy => { copy.orders[0].side = -1; }],
    ["outputs", copy => { copy.outputs.extra = copy.outputs.average; }],
    ["input configuration", copy => { copy.inputs.length = 3; }],
    ["source identity", copy => { copy.sourceHash = "a".repeat(64); }],
    ["history bound", copy => { copy.maxHistory++; }],
    ["state allocation", copy => { copy.stateCells++; }],
    ["Pine version", copy => { copy.pineVersion = 5; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(ir);
    mutate(copy);
    assert.notEqual(computeConfigHash(copy), ir.configHash, label);
    assert.throws(() => assertProgramCommitment(copy), /configuration hash/, label);
    assert.throws(() => createPineRuntime(copy), `${label}: runtime must reject`);
    assert.throws(() => generateRustFiles(copy), `${label}: generator must reject`);
  }
});

test("a recomputed graph commitment cannot reuse another program's saved state", () => {
  const ir = compile().ir!;
  const runtime = createPineRuntime(ir);
  runtime.push(candle(1, 60_000));
  const snapshot = runtime.snapshot();
  const changed = structuredClone(ir);
  changed.nodes[changed.orders[0].quantity!].value = 2;
  changed.configHash = computeConfigHash(changed);
  assertProgramCommitment(changed);
  assert.throws(() => createPineRuntime(changed, snapshot), /Snapshot.*program/);
  const priorVersion = structuredClone(ir);
  priorVersion.compilerVersion = "0.1.0";
  priorVersion.configHash = computeConfigHash(priorVersion);
  assert.throws(() => createPineRuntime(priorVersion), /version|recompile/i);
});

test("caller mutations after runtime creation cannot change the running strategy", () => {
  const ir = compile().ir!;
  const runtime = createPineRuntime(ir);
  const expectedHash = ir.configHash;
  ir.nodes[ir.orders[0].quantity!].value = 99;
  ir.orders[0].id = "Injected";
  ir.orders[0].side = -1;
  ir.outputs.average = ir.orders[0].quantity!;
  runtime.push(candle(1, 60_000));
  const actual = runtime.push(candle(3, 120_000));
  assert.equal(actual.outputs.average, 2);
  assert.equal(actual.intents.length, 1);
  assert.equal(actual.intents[0].id, "Long");
  assert.equal(actual.intents[0].side, 1);
  assert.equal(actual.intents[0].quantity, 1);
  assert.equal(runtime.snapshot().configHash, expectedHash);
});
