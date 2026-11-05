import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const root = resolve("contracts/pine-solana-runtime");
  const source = await readFile(resolve(root, "src/lib.rs"), "utf8");
  const cargo = (await readFile(resolve(root, "Cargo.toml"), "utf8")).replace(/\n\[workspace\]\s*$/, "\n");
  const lockfile = await readFile(resolve(root, "generated-workspace.lock"), "utf8");
  const generated = "// Generated from src/lib.rs and Cargo.toml. Run pnpm pine:solana:sync-runtime after edits.\n"
    + `export const RUST_RUNTIME_SOURCE = ${JSON.stringify(source)};\n`
    + `export const RUST_RUNTIME_CARGO = ${JSON.stringify(cargo)};\n`
    + `export const RUST_WORKSPACE_LOCKFILE = ${JSON.stringify(lockfile)};\n`;
  const path = resolve(root, "source.ts");
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== generated) throw new Error("Bundled Rust source is stale; run pnpm pine:solana:sync-runtime");
  } else await writeFile(path, generated);
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
