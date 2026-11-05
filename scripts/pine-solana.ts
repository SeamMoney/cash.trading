#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join, relative, sep } from "node:path";
import { compilePineToSolana } from "../lib/pine-solana/compiler";
import { replayPine } from "../lib/pine-solana/runtime";
import { validateCompileOptions, verifyReferenceTrace } from "../lib/pine-solana/validation";
import type { Bar } from "../lib/pine-solana/ir";

const help = `Pine -> Solana compiler (experimental confirmed-bar order intents)

  pnpm pine:solana analyze strategy.pine [--json] [--options options.json]
  pnpm pine:solana compile strategy.pine --out build/strategy [--options options.json]
  pnpm pine:solana simulate strategy.pine --bars candles.json [--out trace.json]
  pnpm pine:solana verify strategy.pine --reference reference.json [--out report.json]
  pnpm pine:solana corpus path/to/scripts [--out coverage.json]

Options JSON accepts inputs, explicit indicator signals, maxHistory, maxStateBytes,
and programId. compile creates Rust/Anchor source, source/config commitments and IR.
It does not deploy, create a wallet, send transactions, or execute trades.
Every candle JSON row has time (milliseconds), open, high, low, close and volume.
verify consumes a source/config-bound ReferenceTrace; see docs/PINE_SOLANA.md.
`;
async function output(value: unknown, path?: string) {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (path) { await mkdir(dirname(resolve(path)), { recursive: true }); await writeFile(resolve(path), content); console.log(resolve(path)); }
  else console.log(content);
}
async function main() {
  const args = process.argv.slice(2), command = args.shift();
  if (!command || ["help", "--help", "-h"].includes(command)) { console.log(help); return; }
  const sourcePath = args.shift();
  if (!sourcePath || sourcePath.startsWith("--")) throw new Error("A Pine file or corpus directory is required.\n" + help);
  const flags = new Map<string, string | true>();
  while (args.length) {
    const flag = args.shift()!;
    if (!["--out", "--bars", "--reference", "--options", "--json"].includes(flag)) throw new Error(`Unknown option ${flag}`);
    if (flags.has(flag)) throw new Error(`Duplicate option ${flag}`);
    if (flag === "--json") flags.set(flag, true);
    else {
      const value = args.shift(); if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      flags.set(flag, value);
    }
  }
  const pathFlag = (name: string) => typeof flags.get(name) === "string" ? flags.get(name) as string : undefined;
  const optionsPath = pathFlag("--options");
  const options = validateCompileOptions(optionsPath ? JSON.parse(await readFile(resolve(optionsPath), "utf8")) : {});
  if (command === "corpus") {
    const root = resolve(sourcePath), rows: unknown[] = [];
    async function walk(dir: string, depth = 0) {
      if (depth > 20) throw new Error("Corpus directory nesting exceeds 20");
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (item.name.startsWith(".") || ["node_modules", "target", "build"].includes(item.name)) continue;
        const path = join(dir, item.name);
        if (item.isDirectory()) await walk(path, depth + 1);
        else if (item.isFile() && item.name.endsWith(".pine")) {
          if (rows.length >= 10000) throw new Error("Corpus exceeds 10000 Pine files");
          const r = compilePineToSolana(await readFile(path, "utf8"), options);
          rows.push({ file: relative(root, path), accepted: r.ok, codes: [...new Set(r.diagnostics.filter(d => d.severity === "error").map(d => d.code))], diagnostics: r.diagnostics.filter(d => d.severity === "error"), sourceHash: r.ir?.sourceHash, stateBytes: r.ir ? r.ir.stateCells * 8 : undefined });
        }
      }
    }
    await walk(root);
    if (!rows.length) throw new Error("No .pine files found");
    const accepted = rows.filter(r => (r as { accepted: boolean }).accepted).length;
    await output({ scope: "only-the-supplied-corpus", total: rows.length, accepted, rejected: rows.length - accepted, tradingViewEquivalence: "not-certified", scripts: rows }, pathFlag("--out"));
    return;
  }
  if (!["analyze", "compile", "simulate", "verify"].includes(command)) throw new Error(`Unknown command ${command}`);
  const result = compilePineToSolana(await readFile(resolve(sourcePath), "utf8"), options);
  if (!result.ok || command === "analyze") {
    await output({ ok: result.ok, target: result.target, manifest: result.manifest, diagnostics: result.diagnostics }, pathFlag("--out"));
    if (!result.ok) process.exitCode = 2;
    return;
  }
  if (command === "compile") {
    const out = pathFlag("--out"); if (!out) throw new Error("compile requires --out");
    const root = resolve(out);
    for (const [name, content] of Object.entries(result.files)) {
      const path = resolve(root, name);
      if (!path.startsWith(root + sep)) throw new Error("Generated path escaped output directory");
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
    }
    console.log(`Generated ${Object.keys(result.files).length} files in ${root}`);
    console.log(`Source SHA-256: ${result.ir!.sourceHash}\nConfig SHA-256: ${result.ir!.configHash}`);
    console.log(`Graph: ${result.ir!.nodes.length} nodes; state: ${result.ir!.stateCells * 8} bytes; order sites: ${result.ir!.orders.length}`);
    console.log("Experimental source output. Build and simulate SBF, then validate TradingView reference traces before deploying.");
  } else if (command === "simulate") {
    const path = pathFlag("--bars"); if (!path) throw new Error("simulate requires --bars candles.json");
    const bars: Bar[] = JSON.parse(await readFile(resolve(path), "utf8"));
    if (!Array.isArray(bars) || !bars.length || bars.length > 100000) throw new Error("Candle JSON must contain 1–100000 rows");
    const trace = replayPine(result.ir!, bars);
    await output({ sourceHash: result.ir!.sourceHash, configHash: result.ir!.configHash, bars: bars.length, totalIntents: trace.reduce((n, r) => n + r.intents.length, 0), trace }, pathFlag("--out"));
  } else {
    const path = pathFlag("--reference"); if (!path) throw new Error("verify requires --reference");
    const report = verifyReferenceTrace(result.ir!, JSON.parse(await readFile(resolve(path), "utf8")));
    await output(report, pathFlag("--out"));
    if (!report.ok) process.exitCode = 3;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
