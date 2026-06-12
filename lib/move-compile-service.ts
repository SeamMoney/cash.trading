import { execFile } from "child_process";
import { createHash } from "crypto";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";

const execFileAsync = promisify(execFile);

/**
 * Sandboxed Move compile/publish service for deploy-from-UI
 * (docs/DEPLOY-FROM-UI.md "Backend-lane asks").
 *
 * Runs `aptos move compile` on user-supplied PineScript output in an isolated
 * temp package with hard caps, then optionally publishes the package to a
 * fresh object owned by the funded deployer key. The UI-lane route
 * (app/api/launchpad/deploy-vault) drives this and renders the progress rail.
 *
 * Requires the `aptos` CLI on PATH — available locally / on a VPS, not on
 * Vercel serverless. Callers must surface isCompileServiceAvailable()=false
 * as a truthful 501, never a fake success.
 */

// ── Hard caps ────────────────────────────────────────────────────────────────
const MAX_PINE_BYTES = 32 * 1024;
const COMPILE_TIMEOUT_MS = 240_000;
const PUBLISH_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 16 * 1024 * 1024;
// One compile at a time — the Move compiler is CPU-heavy and this box also
// runs the dev server.
let compileChain: Promise<unknown> = Promise.resolve();
// Per-IP limiter: N compiles per rolling hour.
const RATE_LIMIT_PER_HOUR = 6;
const rateBuckets = new Map<string, number[]>();
// Cache compile results by content hash so re-deploys of identical source are free.
const compileCache = new Map<string, CompileResult>();

const DEPS_ROOT = path.join(process.cwd(), "contracts", "strategy-vaults", "deps");

export interface CompileResult {
  ok: boolean;
  /** sha3-256 of the canonical Pine source (commitment input). */
  sourceHash: string;
  moduleName: string;
  moveSource: string;
  /** Verbatim Move compiler output when ok=false — never swallowed. */
  compilerError?: string;
  transpileErrors?: string[];
}

export interface PublishResult {
  ok: boolean;
  /** Object address the package was published under. */
  packageAddress?: string;
  txHash?: string;
  error?: string;
}

export function isCompileServiceAvailable(): Promise<boolean> {
  return execFileAsync("aptos", ["--version"], { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

export function checkRateLimit(clientKey: string): { allowed: boolean; retryAfterS?: number } {
  const now = Date.now();
  const windowStart = now - 3_600_000;
  const hits = (rateBuckets.get(clientKey) ?? []).filter((t) => t > windowStart);
  if (hits.length >= RATE_LIMIT_PER_HOUR) {
    return { allowed: false, retryAfterS: Math.ceil((hits[0] + 3_600_000 - now) / 1000) };
  }
  hits.push(now);
  rateBuckets.set(clientKey, hits);
  return { allowed: true };
}

function sha3_256Hex(input: string): string {
  // Node's crypto sha3-256 matches Move's std::hash::sha3_256.
  return "0x" + createHash("sha3-256").update(input, "utf8").digest("hex");
}

function moveToml(moduleAddressName: string, addressValue: string): string {
  return `[package]
name = "PineVault"
version = "0.1.0"

[addresses]
${moduleAddressName} = "${addressValue}"

[dependencies]
AptosFramework = { git = "https://github.com/aptos-labs/aptos-core.git", subdir = "aptos-move/framework/aptos-framework", rev = "mainnet" }
decibel_accounts = { local = "${path.join(DEPS_ROOT, "decibel_accounts")}" }
decibel_perp_dex = { local = "${path.join(DEPS_ROOT, "decibel_perp_dex")}" }
AptosTrading = { local = "${path.join(DEPS_ROOT, "AptosTrading")}" }
`;
}

async function withTempPackage<T>(
  moveSource: string,
  moduleAddressName: string,
  addressValue: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "pine-vault-"));
  try {
    await mkdir(path.join(dir, "sources"), { recursive: true });
    await writeFile(path.join(dir, "sources", "vault.move"), moveSource, "utf8");
    await writeFile(path.join(dir, "Move.toml"), moveToml(moduleAddressName, addressValue), "utf8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function extractModuleName(moveSource: string): string | null {
  return moveSource.match(/^module\s+([a-z0-9_]+)::/m)?.[1] ?? null;
}

/** Non-TTY aptos CLI exits 0 on failure with {"Error": ...} on stdout. */
function extractCliError(stdout: string): string | null {
  if (!stdout.includes('"Error"')) return null;
  try {
    const jsonStart = stdout.indexOf("{");
    const parsed = JSON.parse(stdout.slice(jsonStart)) as { Error?: string };
    if (parsed.Error) {
      // Prepend any compiler diagnostics printed before the JSON envelope.
      const diagnostics = stdout
        .slice(0, jsonStart)
        .split("\n")
        .filter((l) => !/^(UPDATING|FETCHING|INCLUDING|BUILDING)/.test(l))
        .join("\n")
        .trim();
      return [diagnostics, parsed.Error].filter(Boolean).join("\n").slice(-4000);
    }
  } catch {
    return stdout.slice(-2000);
  }
  return null;
}

/**
 * Transpile user PineScript to the vault target and compile it in isolation.
 * Compiler failures return the Move error verbatim (no silent fallback).
 */
export async function compilePineVault(args: {
  pineScript: string;
  creatorAddr: string;
  marketAddr: string;
  lotSize?: number;
  minSize?: number;
  szDecimalsPow?: string;
}): Promise<CompileResult> {
  if (Buffer.byteLength(args.pineScript, "utf8") > MAX_PINE_BYTES) {
    return {
      ok: false,
      sourceHash: "",
      moduleName: "",
      moveSource: "",
      transpileErrors: [`PineScript exceeds ${MAX_PINE_BYTES / 1024}KB cap`],
    };
  }

  // Defense-in-depth: the Pine parser currently substitutes DEFAULTS for
  // malformed call arguments (e.g. `ta.sma(close, )` silently becomes period
  // 14) while still reporting high confidence. Deploying a silently-different
  // strategy is worse than rejecting, so refuse the obvious malformed-call
  // shapes here until the parser is strict (flagged to the transpiler lane).
  const malformedCall = args.pineScript.match(/,\s*\)|\(\s*,/);
  if (malformedCall) {
    return {
      ok: false,
      sourceHash: sha3_256Hex(args.pineScript),
      moduleName: "",
      moveSource: "",
      transpileErrors: [
        `malformed call near "${malformedCall[0].replace(/\s+/g, " ")}" — empty argument slot; the transpiler would substitute a default and deploy a different strategy than written`,
      ],
    };
  }

  const sourceHash = sha3_256Hex(args.pineScript);
  const cacheKey = `${sourceHash}:${args.marketAddr}:${args.lotSize}:${args.minSize}:${args.szDecimalsPow}`;
  const cached = compileCache.get(cacheKey);
  if (cached) return cached;

  let moveSource: string;
  try {
    const result = transpileV3(args.pineScript, args.creatorAddr, {
      target: "vault",
      marketAddr: args.marketAddr,
      lotSize: args.lotSize,
      minSize: args.minSize,
      szDecimalsPow: args.szDecimalsPow,
    });
    const errors = (result as { errors?: string[] }).errors;
    if (errors?.length) {
      return { ok: false, sourceHash, moduleName: "", moveSource: "", transpileErrors: errors };
    }
    moveSource = result.moveSource;
  } catch (err) {
    return {
      ok: false,
      sourceHash,
      moduleName: "",
      moveSource: "",
      transpileErrors: [err instanceof Error ? err.message : "transpile failed"],
    };
  }

  const moduleName = extractModuleName(moveSource);
  if (!moduleName) {
    return {
      ok: false,
      sourceHash,
      moduleName: "",
      moveSource,
      transpileErrors: ["could not determine emitted module address name"],
    };
  }

  const run = async (): Promise<CompileResult> => {
    try {
      const { stdout } = await withTempPackage(moveSource, moduleName, "0xCAFE", (dir) =>
        execFileAsync(
          "aptos",
          ["move", "compile", "--skip-fetch-latest-git-deps", "--package-dir", dir],
          { timeout: COMPILE_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        ),
      );
      // aptos CLI (8.0.0) exits 0 on compile FAILURE when run without a TTY —
      // the error arrives as {"Error": ...} JSON on stdout. Exit code alone
      // would cache broken Move as success (found by dogfooding the rail).
      const cliError = extractCliError(stdout);
      if (cliError) {
        return { ok: false, sourceHash, moduleName, moveSource, compilerError: cliError };
      }
      const ok: CompileResult = { ok: true, sourceHash, moduleName, moveSource };
      compileCache.set(cacheKey, ok);
      return ok;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      // Verbatim compiler output, minus dependency-fetch noise.
      const raw = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message || "compile failed";
      const compilerError = raw
        .split("\n")
        .filter((l) => !/^(UPDATING|FETCHING|INCLUDING|BUILDING)/.test(l))
        .join("\n")
        .slice(-4000);
      return { ok: false, sourceHash, moduleName, moveSource, compilerError };
    }
  };

  // Serialize compiles behind the chain regardless of caller concurrency.
  const next = compileChain.then(run, run);
  compileChain = next.catch(() => undefined);
  return next;
}

/**
 * Publish a compiled package to a fresh object owned by the deployer key.
 * Testnet-only until a mainnet payer policy exists. The deployer pays gas;
 * the object address becomes the package address the UI binds the vault to.
 */
export async function publishPineVault(args: {
  moveSource: string;
  moduleName: string;
  network?: "testnet";
}): Promise<PublishResult> {
  const key = (process.env.EXPOSED_TESTNET_KEY ?? process.env.LAUNCHPAD_KEEPER_KEY ?? "").trim();
  if (!key) {
    return { ok: false, error: "no deployer key configured (EXPOSED_TESTNET_KEY)" };
  }

  const run = async (): Promise<PublishResult> => {
    try {
      const { stdout } = await withTempPackage(args.moveSource, args.moduleName, "_", (dir) =>
        execFileAsync(
          "aptos",
          [
            "move",
            "create-object-and-publish-package",
            "--address-name",
            args.moduleName,
            "--package-dir",
            dir,
            "--skip-fetch-latest-git-deps",
            "--private-key",
            key,
            "--url",
            "https://api.testnet.aptoslabs.com/v1",
            "--assume-yes",
          ],
          { timeout: PUBLISH_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        ),
      );
      const cliError = extractCliError(stdout);
      if (cliError) {
        return { ok: false, error: cliError };
      }
      const packageAddress = stdout.match(/object address (0x[0-9a-f]+)/i)?.[1]
        ?? stdout.match(/"Result":\s*"Published package at object address (0x[0-9a-f]+)/i)?.[1]
        ?? stdout.match(/(0x[0-9a-f]{60,64})/)?.[1];
      const txHash = stdout.match(/"transaction_hash":\s*"(0x[0-9a-f]+)"/)?.[1];
      if (!packageAddress) {
        return { ok: false, error: `publish output had no object address: ${stdout.slice(-400)}` };
      }
      return { ok: true, packageAddress, txHash };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const raw = [e.stdout, e.stderr].filter(Boolean).join("\n") || e.message || "publish failed";
      return { ok: false, error: raw.slice(-2000) };
    }
  };

  const next = compileChain.then(run, run);
  compileChain = next.catch(() => undefined);
  return next;
}
