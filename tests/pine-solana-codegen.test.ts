import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RUST_RUNTIME_SOURCE, RUST_RUNTIME_CARGO, RUST_WORKSPACE_LOCKFILE } from "../contracts/pine-solana-runtime/source";
import { compilePineToSolana } from "../lib/pine-solana/compiler";

test("generated runtime is the actual tested Rust source, not a drifting copy", () => {
  assert.equal(RUST_RUNTIME_SOURCE, readFileSync("contracts/pine-solana-runtime/src/lib.rs", "utf8"));
  assert.equal(RUST_RUNTIME_CARGO, readFileSync("contracts/pine-solana-runtime/Cargo.toml", "utf8").replace(/\n\[workspace\]\s*$/, "\n"));
  assert.equal(RUST_WORKSPACE_LOCKFILE, readFileSync("contracts/pine-solana-runtime/generated-workspace.lock", "utf8"));
});
test("artifact configuration validates program addresses and preserves source text without Rust injection", () => {
  const pine = `//@version=6\nstrategy("Escaped \\\"title\\\"")\nstrategy.entry("L\\\" \\n💹", strategy.long)\n`;
  const result = compilePineToSolana(pine);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.files["source.pine"], pine);
  const graph = result.files["strategy/src/lib.rs"];
  assert.ok(graph.includes('id: "L\\" \\n💹"'));
  assert.equal(compilePineToSolana(pine, { programId: "not-a-public-key" }).ok, false);
  assert.equal(compilePineToSolana(pine, { programId: "1".repeat(31) }).ok, false);
});
