/**
 * Sealed-vault END-TO-END deploy — one command from empty account to live
 * attested ticks on chain. Testnet is fully automated once the deployer has
 * gas; mainnet runs the same pipeline against mainnet params with your funded
 * key (and skips the testnet-only USDC mint).
 *
 *   pnpm sealed:e2e run       [--network testnet] [--state .sealed-e2e]
 *   pnpm sealed:e2e status    — where the pipeline is, what it needs
 *   pnpm sealed:e2e attest    — keep ticking an already-deployed vault
 *   pnpm sealed:e2e verify-package --package 0x... — compile at the exact
 *                                    address and compare every module byte
 *   pnpm sealed:e2e verify-execution — prove a recorded testnet override
 *                                      produced a real Decibel position
 *   pnpm sealed:e2e preflight-mainnet — keyless, read-only release readiness
 *   pnpm sealed:e2e verify-markets — re-read lot/min/szDecimals from chain and
 *                                    diff against lib/sealed-vaults.ts
 *   --test-signal buy|sell|neutral — TESTNET ONLY: exercise order plumbing with
 *                                   an explicitly recorded synthetic signal
 *
 * The pipeline is RESUMABLE: every step records its result in the state file
 * and is skipped when already done, so re-running after any failure continues
 * where it stopped. Keys are generated into the state dir (chmod 600) unless
 * SEALED_DEPLOYER_PRIVATE_KEY / SEALED_ATTESTOR_PRIVATE_KEY are set.
 *
 * Steps: keys → funding → publish → usdc (testnet only) → subaccount →
 *        decibel-vault → sealed-vault → delegate → seal → attest
 *
 * Requires the aptos CLI for the publish step. If it's not on PATH, run
 * scripts/install-aptos-cli.sh (pins v8.1.0) or set APTOS_BIN.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Account,
  AccountAddress,
  Ed25519PrivateKey,
  type CommittedTransactionResponse,
} from "@aptos-labs/ts-sdk";

import { transpileV3, TRANSPILER_VERSION } from "../lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "../lib/strategy-equivalence";
import {
  buildTickAttestedPayload,
  computeProgramCommitment,
  fromHex,
  signAttestation,
  toHex,
  type Signal,
} from "../lib/sealed-attestor";
import { SEALED_PRESETS, buildManifest, canonicalizePine } from "../lib/sealed-presets";
import { derivePrimarySubaccount } from "../lib/sealed-vaults";
import { fetchPythCandles } from "../lib/launchpad/pyth";
import {
  DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS,
  MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS,
} from "../lib/decibel-builder-config";
import {
  assertAutomatedVaultBuilderCompatible,
  createAuthenticatedAptosForNetwork,
} from "../lib/automated-vault-builder";
import {
  SEALED_PACKAGE_MODULES,
  compareSealedPackageBytecode,
  sealedPackageBytecodeMatches,
  type BytecodeByModule,
} from "../lib/sealed-package-verification";

// ─── Network config (authoritative, verified on-chain 2026-07-30) ────────────

const NET = {
  testnet: {
    nodeUrl: "https://api.testnet.aptoslabs.com/v1",
    decibel: "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f",
    usdcMetadata: "0x5428acf5c112826d0c74ae1cd2de9030f53d1d01235e6c2621d967bf914ee1c8",
    market: {
      name: "BTC/USD",
      addr: "0x161b7b3f58327d057ee5824de0c1a4fc4fa3d121b847c138e921a255768a0dca",
      sizeDecimalsPow: 1_000_000_000n, // szDecimals = 9
      lotSize: 10_000n,
      minSize: 20_000n,
      tickerSize: 1_000_000n,
    },
    explorerSuffix: "?network=testnet",
    canMintUsdc: true,
  },
  mainnet: {
    nodeUrl: "https://api.mainnet.aptoslabs.com/v1",
    decibel: "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06",
    usdcMetadata: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
    market: {
      name: "BTC/USD",
      addr: "0x5e0e16f34adfb4b316f8d532d68acbfa206826feaaa418d3938046bdc2044861",
      sizeDecimalsPow: 100_000_000n, // szDecimals = 8
      lotSize: 1_000n,
      minSize: 2_000n,
      tickerSize: 100_000n,
    },
    explorerSuffix: "?network=mainnet",
    canMintUsdc: false,
  },
} as const;

type NetworkName = keyof typeof NET;

// Aptos validates a publish against the CLI's 2,000,000-unit maximum-gas ceiling, not the
// transaction's eventual (much smaller) fee. A clean-room publish with 1 APT therefore fails
// before submission even though the actual end-to-end run costs far less. Keep the fresh
// publish gate separate from the lower reserve needed after a package already exists so a
// resumable setup is not needlessly blocked.
const MIN_FRESH_PUBLISH_GAS_OCTAS = 250_000_000n; // 2.5 APT — proven clean-room reserve
const MIN_RESUME_GAS_OCTAS = 40_000_000n; // 0.4 APT — post-publish setup transactions
const USDC_MINT_UNITS = 500_000_000n; // 500 USDC — covers the 100 USDC creation fee
                                      // + 100 USDC activation minimum with headroom
const VAULT_FUND_UNITS = 100_000_000n; // 100 USDC into the Decibel vault
const LAUNCH_FEE_UNITS = 50_000_000n;  // 50 USDC — our fee, on top of Decibel's 100
const STRATEGY_PACKAGE_DIR = resolve(__dirname, "../contracts/strategy-vaults");
const STRATEGY_PACKAGE_BUILD = "CashStrategyVaults";
// Aptos rejects an immutable package when any dependency has a weaker policy.
// Decibel's mainnet packages publish with policy 1 (`compatible`), so compatible is the
// strongest policy this adapter package can use while importing Decibel entry/view APIs.
const MAINNET_UPGRADE_POLICY = "compatible" as const;
const MAINNET_PUBLISH_CONFIRMATION =
  "PUBLISH_COMPATIBLE_SEALED_VAULTS_ON_APTOS_MAINNET";
const MAINNET_FUNDED_E2E_CONFIRMATION =
  "SPEND_250_USDC_ON_MAINNET_SEALED_E2E";
const BAR_TOO_SOON_RETRY_DELAY_MS = 35_000;
const MAX_BAR_TOO_SOON_RETRIES = 3;

interface PlatformEconomics {
  treasuryAddress: string;
  builderAddress: string;
  builderFeeBps: number;
}

interface TickRecord {
  seq: string;
  signal: number;
  tx: string;
  source?: "runner" | "test-override";
}

function applyMainnetUpgradePolicy(toml: string): string {
  const policy = `upgrade_policy = "${MAINNET_UPGRADE_POLICY}"`;
  if (/^upgrade_policy\s*=.*$/m.test(toml)) {
    return toml.replace(/^upgrade_policy\s*=.*$/m, policy);
  }
  return toml.replace('version = "0.1.0"', `version = "0.1.0"\n${policy}`);
}

// ─── State ───────────────────────────────────────────────────────────────────

interface E2EState {
  network: NetworkName;
  deployerAddr?: string;
  attestorPub?: string;
  publishTx?: string;
  initPlatformTx?: string;
  packageAddress?: string;
  subaccountAddr?: string;
  usdcMintTx?: string;
  decibelVaultAddr?: string;
  decibelVaultTx?: string;
  commitment?: string;
  manifestJson?: string;
  strategyVaultAddr?: string;
  createTx?: string;
  delegateTx?: string;
  sealTx?: string;
  ticks?: TickRecord[];
}

function parseArgs(argv: string[]) {
  const cmd = argv[2] ?? "run";
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = argv[i + 1]?.startsWith("--") ? "true" : argv[++i];
      flags[key] = val ?? "true";
    }
  }
  return { cmd, flags };
}

const { cmd, flags } = parseArgs(process.argv);
const network = (flags.network === "mainnet" ? "mainnet" : "testnet") as NetworkName;
const cfg = NET[network];
const stateDir = resolve(flags.state ?? `.sealed-e2e-${network}`);
const statePath = join(stateDir, "state.json");

function parseTestSignal(): Signal | undefined {
  const requested = flags["test-signal"];
  if (requested === undefined) return undefined;
  if (network !== "testnet") {
    throw new Error(
      "--test-signal is forbidden outside testnet; no state, key, or transaction was touched",
    );
  }
  const signals: Record<string, Signal> = { neutral: 0, buy: 1, sell: 2 };
  const signal = signals[requested];
  if (signal === undefined) {
    throw new Error("--test-signal must be one of: buy, sell, neutral");
  }
  return signal;
}

// Parse before any command can load state or key material. This makes the test-only escape
// hatch structurally incapable of reaching a mainnet signer.
const testSignal = parseTestSignal();

function assertMainnetExecutionConfirmed() {
  if (network !== "mainnet") return;

  if (flags["confirm-mainnet"] !== MAINNET_PUBLISH_CONFIRMATION) {
    throw new Error(
      "Mainnet publishing changes live chain state. No state, key, transaction, or package was created. " +
        `Re-run with --confirm-mainnet ${MAINNET_PUBLISH_CONFIRMATION}`,
    );
  }

  if (
    cmd === "run" &&
    flags["confirm-funded-e2e"] !== MAINNET_FUNDED_E2E_CONFIRMATION
  ) {
    throw new Error(
      "The full mainnet E2E run creates and funds a real vault and spends 250 USDC. " +
        "Use `sealed:publish` for package deployment, or explicitly add " +
        `--confirm-funded-e2e ${MAINNET_FUNDED_E2E_CONFIRMATION}`,
    );
  }
}

function loadState(): E2EState {
  if (existsSync(statePath)) {
    ensureStateDir();
    // Lock down an older or user-created state file before parsing or rejecting it. A network
    // mismatch must not leave a manifest-bearing file world-readable merely because execution
    // stopped early.
    chmodSync(statePath, 0o600);
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as E2EState;
    if (parsed.network !== network) {
      throw new Error(
        `state network mismatch: ${statePath} belongs to ${parsed.network}, not ${network}`,
      );
    }
    return parsed;
  }
  return { network };
}

function ensureStateDir() {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
}

function writePrivateFile(path: string, contents: string) {
  ensureStateDir();
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function saveState(s: E2EState) {
  if (s.network !== network) {
    throw new Error(`refusing to write ${s.network} state into the ${network} state directory`);
  }
  ensureStateDir();
  const temporary = `${statePath}.${process.pid}.tmp`;
  try {
    writePrivateFile(temporary, JSON.stringify(s, null, 2));
    renameSync(temporary, statePath);
    chmodSync(statePath, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const aptos = createAuthenticatedAptosForNetwork(network);

function loadOrCreateKey(file: string, envVar: string): Ed25519PrivateKey {
  const fromEnv = process.env[envVar];
  if (fromEnv) return new Ed25519PrivateKey(fromEnv);
  const path = join(stateDir, file);
  if (existsSync(path)) {
    ensureStateDir();
    chmodSync(path, 0o600);
    return new Ed25519PrivateKey(readFileSync(path, "utf8").trim());
  }
  const key = Ed25519PrivateKey.generate();
  writePrivateFile(path, key.toString());
  console.log(`  generated ${file} (chmod 600) — set ${envVar} to override`);
  return key;
}

function normalizeAddress(raw: string, label: string): string {
  try {
    return AccountAddress.fromString(raw.trim()).toString();
  } catch {
    throw new Error(`${label} must be a valid Aptos address`);
  }
}

function resolvePlatformEconomics(deployerAddress: string): PlatformEconomics {
  const configuredBuilder = process.env.DECIBEL_BUILDER_ADDRESS?.trim();
  const configuredTreasury = process.env.SEALED_TREASURY_ADDRESS?.trim();
  if (network === "mainnet" && !configuredTreasury) {
    throw new Error(
      "SEALED_TREASURY_ADDRESS is required for a mainnet publish; " +
        "the deployer key must not silently receive launch revenue",
    );
  }

  const treasuryAddress = normalizeAddress(
    configuredTreasury || configuredBuilder || deployerAddress,
    "SEALED_TREASURY_ADDRESS",
  );
  // Retained in platform/vault state for auditability and old-package compatibility. New
  // automated vault orders carry no builder code until Decibel exposes a vault-admin approval
  // API for the actual trading subaccount.
  const builderAddress = normalizeAddress(
    configuredBuilder || treasuryAddress,
    "DECIBEL_BUILDER_ADDRESS",
  );

  const rawFee = process.env.SEALED_VAULT_BUILDER_FEE_BPS?.trim();
  const builderFeeBps = rawFee
    ? Number(rawFee)
    : DEFAULT_AUTOMATED_VAULT_BUILDER_FEE_BPS;
  if (
    !Number.isSafeInteger(builderFeeBps) ||
    builderFeeBps < 0 ||
    builderFeeBps > MAX_AUTOMATED_VAULT_BUILDER_FEE_BPS
  ) {
    throw new Error(
      "SEALED_VAULT_BUILDER_FEE_BPS must be 0. Direct user orders may use the normal "
        + "DECIBEL_BUILDER_FEE_BPS, but delegated vault orders cannot approve that fee for "
        + "their actual Decibel trading subaccount.",
    );
  }

  return { treasuryAddress, builderAddress, builderFeeBps };
}

function assertPlatformTerms(terms: unknown[], intended: PlatformEconomics) {
  const actualLaunchFee = BigInt(String(terms[0]));
  const actualTreasury = normalizeAddress(String(terms[1]), "on-chain treasury");
  const actualBuilder = normalizeAddress(String(terms[2]), "on-chain builder address");
  const actualFeeBps = Number(terms[3]);
  const matches =
    actualLaunchFee === LAUNCH_FEE_UNITS &&
    actualTreasury === intended.treasuryAddress &&
    actualBuilder === intended.builderAddress &&
    actualFeeBps === intended.builderFeeBps;
  if (!matches) {
    throw new Error(
      "existing on-chain platform terms do not match the requested deployment config; " +
        "refusing to continue or silently redirect revenue",
    );
  }
}

const explorer = (tx: string) => `https://explorer.aptoslabs.com/txn/${tx}${cfg.explorerSuffix}`;

function packageNamedAddresses(packageAddress: string): string {
  return `cash_strategy=${packageAddress},decibel=${cfg.decibel},order_book=0x5`;
}

function runAptosCli(args: string[], cwd: string): string {
  const aptosBin = process.env.APTOS_BIN ?? "aptos";
  try {
    const output = execFileSync(aptosBin, args, { cwd, encoding: "utf8" });
    if (output.includes('"Error"')) throw new Error(output.slice(-3000));
    return output;
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `aptos ${args[0]} ${args[1]} failed\n` +
        `${(error.stdout ?? "").slice(-3000)}\n` +
        `${(error.stderr ?? "").slice(-3000)}\n${error.message ?? ""}`,
    );
  }
}

function compilePackageAtAddress(packageDir: string, packageAddress: string): void {
  runAptosCli(
    ["move", "compile", "--named-addresses", packageNamedAddresses(packageAddress)],
    packageDir,
  );
}

function readCompiledPackageBytecode(packageDir: string): BytecodeByModule {
  return Object.fromEntries(
    SEALED_PACKAGE_MODULES.map((module) => {
      const path = join(
        packageDir,
        "build",
        STRATEGY_PACKAGE_BUILD,
        "bytecode_modules",
        `${module}.mv`,
      );
      return [module, existsSync(path) ? readFileSync(path).toString("hex") : undefined];
    }),
  ) as BytecodeByModule;
}

async function fetchPublishedPackageBytecode(packageAddress: string): Promise<BytecodeByModule> {
  const entries = await Promise.all(
    SEALED_PACKAGE_MODULES.map(async (module) => {
      const response = await fetch(`${cfg.nodeUrl}/accounts/${packageAddress}/module/${module}`, {
        cache: "no-store",
      });
      if (response.status === 404) return [module, undefined] as const;
      if (!response.ok) {
        throw new Error(
          `Aptos fullnode returned ${response.status} reading ${module}: ` +
            (await response.text()).slice(0, 500),
        );
      }
      const body = (await response.json()) as { bytecode?: string };
      return [module, body.bytecode] as const;
    }),
  );
  return Object.fromEntries(entries) as BytecodeByModule;
}

async function assertPublishedPackageMatches(
  packageDir: string,
  packageAddress: string,
  onChainBytecode?: BytecodeByModule,
): Promise<void> {
  const comparisons = compareSealedPackageBytecode(
    readCompiledPackageBytecode(packageDir),
    onChainBytecode ?? (await fetchPublishedPackageBytecode(packageAddress)),
  );
  console.log(`[bytecode] exact module verification at ${packageAddress}`);
  for (const comparison of comparisons) {
    const local = comparison.localSha256?.slice(0, 16) ?? "missing";
    const onChain = comparison.onChainSha256?.slice(0, 16) ?? "missing";
    console.log(
      `  ${comparison.status.toUpperCase().padEnd(16)} ${comparison.module.padEnd(18)} ` +
        `local=${local} on-chain=${onChain}`,
    );
  }
  if (!sealedPackageBytecodeMatches(comparisons)) {
    throw new Error(
      "published sealed-vault bytecode does not exactly match this checkout; refusing to continue",
    );
  }
}

/**
 * Recover the only safe crash window in the publish pipeline: Aptos committed the package,
 * but the process stopped before state.json recorded it. An empty account is a normal fresh
 * run. A partial package or bytecode drift is not recoverable and must fail closed.
 */
async function recoverExactPublishedPackage(
  packageDir: string,
  packageAddress: string,
): Promise<boolean> {
  const published = await fetchPublishedPackageBytecode(packageAddress);
  const present = SEALED_PACKAGE_MODULES.filter((module) => published[module]);
  if (present.length === 0) return false;

  if (present.length !== SEALED_PACKAGE_MODULES.length) {
    const missing = SEALED_PACKAGE_MODULES.filter((module) => !published[module]);
    throw new Error(
      `partial sealed-vault package found at ${packageAddress}; ` +
        `present=${present.join(",")} missing=${missing.join(",")}; refusing recovery`,
    );
  }

  console.log(
    `[publish] found an unrecorded package at ${packageAddress}; verifying exact bytecode…`,
  );
  compilePackageAtAddress(packageDir, packageAddress);
  await assertPublishedPackageMatches(packageDir, packageAddress, published);
  return true;
}

async function submit(
  signer: Account,
  fn: string,
  args: unknown[],
  typeArgs: string[] = [],
): Promise<CommittedTransactionResponse> {
  const txn = await aptos.transaction.build.simple({
    sender: signer.accountAddress,
    data: {
      function: fn as `${string}::${string}::${string}`,
      typeArguments: typeArgs,
      functionArguments: args as (string | number | boolean | Uint8Array)[],
    },
  });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
  const committed = await aptos.waitForTransaction({ transactionHash: pending.hash });
  if (!committed.success) {
    throw new Error(`tx failed: ${fn} — ${committed.vm_status} (${explorer(pending.hash)})`);
  }
  return committed as CommittedTransactionResponse;
}

/** USDC in an account's PRIMARY fungible store — the wallet pot, not the Decibel subaccount. */
async function usdcBalance(addr: string): Promise<bigint> {
  try {
    const [raw] = (await aptos.view({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [addr, cfg.usdcMetadata],
      },
    })) as [string];
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

async function balanceOctas(addr: string): Promise<bigint> {
  try {
    const res = await fetch(
      `${cfg.nodeUrl}/accounts/${addr}/balance/0x1::aptos_coin::AptosCoin`,
      { cache: "no-store" },
    );
    if (!res.ok) return 0n;
    return BigInt(await res.text());
  } catch {
    return 0n;
  }
}

// ─── Pipeline steps ──────────────────────────────────────────────────────────

async function run() {
  // This must stay before loadState/loadOrCreateKey: a typo or copied command must not even
  // create local key material, much less submit a mainnet transaction.
  assertMainnetExecutionConfirmed();
  const state = loadState();
  const deployerKey = loadOrCreateKey("deployer.key", "SEALED_DEPLOYER_PRIVATE_KEY");
  const attestorKey = loadOrCreateKey("attestor.key", "SEALED_ATTESTOR_PRIVATE_KEY");
  const deployer = Account.fromPrivateKey({ privateKey: deployerKey });
  const attestorAcct = Account.fromPrivateKey({ privateKey: attestorKey });
  state.deployerAddr = deployer.accountAddress.toString();
  state.attestorPub = attestorAcct.publicKey.toString();
  const platformEconomics = resolvePlatformEconomics(state.deployerAddr);
  saveState(state);

  console.log(`\nSEALED VAULT E2E — ${network.toUpperCase()}`);
  console.log(`  deployer  ${state.deployerAddr}`);
  console.log(`  attestor  ${state.attestorPub}\n`);

  // Publishing and recording state are separate durability boundaries. Recover a package
  // that landed before a crash only after proving every module exactly matches this checkout.
  let packageVerified = false;
  if (
    !state.packageAddress &&
    (await recoverExactPublishedPackage(STRATEGY_PACKAGE_DIR, state.deployerAddr))
  ) {
    state.packageAddress = state.deployerAddr;
    packageVerified = true;
    saveState(state);
    console.log(`  recovered package state at ${state.packageAddress}`);
  }

  // ── funding gate ──
  const bal = await balanceOctas(state.deployerAddr);
  const minGasOctas = state.packageAddress
    ? MIN_RESUME_GAS_OCTAS
    : MIN_FRESH_PUBLISH_GAS_OCTAS;
  const minGasApt = Number(minGasOctas) / 1e8;
  console.log(`[funding] balance ${Number(bal) / 1e8} APT (need ${minGasApt})`);
  if (bal < minGasOctas) {
    console.log(
      network === "testnet"
        ? `\n  BLOCKED on gas. The public faucet requires a signed-in JWT, so a human must:\n` +
            `    → fund ${state.deployerAddr} until it holds at least ${minGasApt} APT\n` +
            `      (https://aptos.dev/network/faucet — paste the address)\n` +
            `    or transfer from any funded testnet wallet.\n` +
            `  Re-run this command after; every completed step is skipped.\n`
        : `\n  BLOCKED on gas. Fund ${state.deployerAddr} with at least ${minGasApt} APT on MAINNET, or set\n` +
            `  SEALED_DEPLOYER_PRIVATE_KEY to an already-funded key and re-run.\n`,
    );
    process.exit(2);
  }

  // ── publish ──
  if (!state.packageAddress) {
    console.log(`[publish] compiling + publishing to ${network}…`);
    let pkgDir = STRATEGY_PACKAGE_DIR;
    // Decibel's imported mainnet packages use Aptos policy 1 (`compatible`). Aptos rejects an
    // immutable package that depends on those weaker-policy packages with EDEP_WEAKER_POLICY.
    // Keep this explicit rather than relying on the CLI default, and keep the deployer cold.
    if (network === "mainnet") {
      const tmp = join(stateDir, "pkg-mainnet");
      ensureStateDir();
      rmSync(tmp, { recursive: true, force: true });
      cpSync(pkgDir, tmp, { recursive: true });
      const tomlPath = join(tmp, "Move.toml");
      const toml = readFileSync(tomlPath, "utf8");
      writeFileSync(tomlPath, applyMainnetUpgradePolicy(toml));
      pkgDir = tmp;
      console.log(`  mainnet: publishing with upgrade_policy = "${MAINNET_UPGRADE_POLICY}"`);
    }
    const named = packageNamedAddresses(state.deployerAddr);
    compilePackageAtAddress(pkgDir, state.deployerAddr);
    runAptosCli(["move", "test", "--named-addresses", named], pkgDir);
    const publishKeyPath = join(stateDir, `.publish-key-${process.pid}`);
    writePrivateFile(publishKeyPath, deployerKey.toString());
    let out: string;
    try {
      out = runAptosCli([
        "move", "publish",
        "--named-addresses", named,
        "--url", cfg.nodeUrl,
        // Never put a mainnet private key in the process argument list. The temporary file is
        // mode 0600 and is removed whether publishing succeeds or fails.
        "--private-key-file", publishKeyPath,
        "--assume-yes",
        // The package vendors the Decibel + order_book deps, so the publish writeset is large.
        // 200k units ran out of gas on testnet; 2M is the protocol's per-transaction ceiling.
        "--max-gas", "2000000",
        // Ship bytecode only. With the default `sparse` artifacts the package is 62KB, over
        // Aptos's 60KB single-transaction limit. Source verifiability does not depend on this:
        // the module source is in this repo, and a vault's guarantee rests on the program
        // commitment and the on-chain trace, not on the explorer rendering our Move.
        "--included-artifacts", "none",
      ], pkgDir);
    } finally {
      rmSync(publishKeyPath, { force: true });
    }
    const tx = out.match(/"transaction_hash":\s*"(0x[0-9a-f]+)"/)?.[1];
    // The CLI exits 0 for a transaction that COMMITTED but reverted (e.g. "Out of gas"), and
    // recording that as a successful publish makes every later step fail with a confusing
    // "module not found". Confirm on chain before writing the state file.
    if (tx) {
      const landed = await aptos.getTransactionByHash({ transactionHash: tx });
      const ok = (landed as { success?: boolean }).success;
      if (!ok) {
        throw new Error(
          `publish transaction reverted: ${(landed as { vm_status?: string }).vm_status}\n` +
            `  ${explorer(tx)}`,
        );
      }
    }
    await assertPublishedPackageMatches(pkgDir, state.deployerAddr);
    packageVerified = true;
    state.publishTx = tx;
    state.packageAddress = state.deployerAddr;
    saveState(state);
    console.log(`  published at ${state.packageAddress}`);
    if (tx) console.log(`  ${explorer(tx)}`);
  } else {
    console.log(`[publish] already at ${state.packageAddress}`);
  }
  const pkg = state.packageAddress;
  if (!pkg) throw new Error("publish completed without a package address");
  if (!packageVerified) {
    console.log(`[publish] compiling current source at the saved package address…`);
    compilePackageAtAddress(STRATEGY_PACKAGE_DIR, pkg);
    await assertPublishedPackageMatches(STRATEGY_PACKAGE_DIR, pkg);
  }

  // ── platform economics ──
  // init_platform is idempotent-by-abort: publishing a new version keeps the resource, so we
  // only call it when it is genuinely absent.
  {
    let terms: unknown[] | null = null;
    try {
      terms = (await aptos.view({
        payload: { function: `${pkg}::sealed_vault::platform_terms`, functionArguments: [] },
      })) as unknown[];
    } catch { /* not initialized yet */ }
    if (!terms) {
      console.log(`[platform] init_platform (launch fee ${Number(LAUNCH_FEE_UNITS) / 1e6} USDC, builder ${platformEconomics.builderFeeBps}bps)…`);
      const committed = await submit(deployer, `${pkg}::sealed_vault::init_platform`, [
        platformEconomics.treasuryAddress,
        LAUNCH_FEE_UNITS.toString(),
        cfg.usdcMetadata,
        platformEconomics.builderAddress,
        platformEconomics.builderFeeBps.toString(),
      ]);
      state.initPlatformTx = committed.hash;
      saveState(state);
      console.log(`  ${explorer(committed.hash)}`);
    } else {
      assertPlatformTerms(terms, platformEconomics);
      console.log(`[platform] fee=${Number(terms[0]) / 1e6} USDC treasury=${String(terms[1]).slice(0, 10)}… builder=${String(terms[2]).slice(0, 10)}… ${terms[3]}bps`);
    }
  }

  if (flags["publish-only"] !== undefined || cmd === "publish") {
    console.log(`\n[publish-only] stopping here. The package is live and configured.`);
    console.log(`  SEALED_VAULT_PACKAGE=${pkg}`);
    console.log(`  NEXT_PUBLIC_SEALED_VAULT_PACKAGE=${pkg}`);
    console.log(`  SEALED_ATTESTOR_PUBLIC_KEY=${state.attestorPub}`);
    console.log(`\n  No vault was created and no USDC was spent.\n`);
    return;
  }

  // ── testnet USDC ──
  if (cfg.canMintUsdc && !state.usdcMintTx) {
    console.log(`[usdc] minting ${Number(USDC_MINT_UNITS) / 1e6} testnet USDC…`);
    try {
      const committed = await submit(deployer, `${cfg.decibel}::usdc::restricted_mint`, [
        USDC_MINT_UNITS.toString(),
      ]);
      state.usdcMintTx = committed.hash;
      saveState(state);
      console.log(`  ${explorer(committed.hash)}`);
    } catch (err) {
      // The faucet is per-account lifetime-capped. Already-minted is not a failure — the
      // funds are still there, possibly sitting in the subaccount.
      if (!String(err).includes("E_MINT_ACCOUNT_LIMIT_EXCEEDED")) throw err;
      console.log(`  already minted for this account — continuing with the existing balance`);
      state.usdcMintTx = "already-minted";
      saveState(state);
    }
  }

  // ── wallet float for the platform launch fee ──
  // Our fee is a primary-fungible-store transfer from the WALLET, while Decibel's creation fee
  // and the vault funding come from the SUBACCOUNT. A run that put everything in the
  // subaccount leaves create_sealed_vault aborting with EINSUFFICIENT_BALANCE, so top the
  // wallet back up from the subaccount rather than failing.
  {
    const walletUsdc = await usdcBalance(state.deployerAddr!);
    if (walletUsdc < LAUNCH_FEE_UNITS) {
      const need = LAUNCH_FEE_UNITS - walletUsdc + 1_000_000n;
      console.log(`[usdc] wallet has ${Number(walletUsdc) / 1e6}, need ${Number(LAUNCH_FEE_UNITS) / 1e6} for the launch fee — withdrawing ${Number(need) / 1e6} from the subaccount…`);
      const committed = await submit(deployer, `${cfg.decibel}::dex_accounts_entry::withdraw_from_subaccount`, [
        state.subaccountAddr,
        cfg.usdcMetadata,
        need.toString(),
      ]);
      console.log(`  ${explorer(committed.hash)}`);
    }
  }

  // ── subaccount + deposit ──
  if (!state.subaccountAddr) {
    console.log(`[subaccount] creating primary subaccount + depositing USDC…`);
    // "…_at" means at a SUBACCOUNT address, not the owner's. Passing the owner aborts with
    // ESUBACCOUNT_DOESNT_EXIST(0x2) — which reads like "create one first", but creating one
    // via create_new_subaccount makes a *non-primary* subaccount at an unrelated address and
    // changes nothing. The primary subaccount address is derived, and depositing to it is
    // what brings it into existence.
    const primary = derivePrimarySubaccount(state.deployerAddr!, network);
    const committed = await submit(deployer, `${cfg.decibel}::dex_accounts_entry::deposit_to_subaccount_at`, [
      primary,
      cfg.usdcMetadata,
      // Two separate pots, and mixing them up is the easy mistake: Decibel's 100 USDC
      // creation fee and the vault's initial funding come from the SUBACCOUNT, while our
      // launch fee is a primary-fungible-store transfer from the WALLET. Leave the launch
      // fee (plus headroom) behind, or create_sealed_vault aborts with EINSUFFICIENT_BALANCE.
      (USDC_MINT_UNITS - LAUNCH_FEE_UNITS - 10_000_000n).toString(),
    ]);
    // Confirm against the chain rather than trusting the derivation. Note this is the plain
    // `primary_subaccount` view — the `_public` variant exists for Move callers and is NOT
    // marked #[view], so the view API rejects it.
    const sub = (await aptos.view({
      payload: {
        function: `${cfg.decibel}::dex_accounts::primary_subaccount`,
        functionArguments: [state.deployerAddr],
      },
    })) as [string];
    const confirmed = AccountAddress.from(sub[0]).toStringLong();
    if (confirmed !== AccountAddress.from(primary).toStringLong()) {
      throw new Error(`derived primary subaccount ${primary} != on-chain ${confirmed}`);
    }
    state.subaccountAddr = confirmed;
    saveState(state);
    console.log(`  subaccount ${state.subaccountAddr}`);
    console.log(`  ${explorer(committed.hash)}`);
  }

  // ── Decibel vault ──
  if (!state.decibelVaultAddr) {
    console.log(`[decibel-vault] create_and_fund_vault…`);
    const committed = await submit(deployer, `${cfg.decibel}::vault_api::create_and_fund_vault`, [
      state.subaccountAddr, // Object<Subaccount>
      cfg.usdcMetadata, // Object<Metadata>
      "Sealed Alpha (e2e)", // name
      "Private strategy enforced by cash_strategy::sealed_vault", // description
      [], // social_links
      "sSEAL", // share_symbol
      "", // share_icon_uri
      "", // share_project_uri
      "1000", // fee_bps — Decibel's MAX (10%); we split it, see lib/vault-economics.ts
      "2592000", // fee_interval_s — 30 days is Decibel's FLOOR; 86400 aborts
      "0", // contribution lockup
      VAULT_FUND_UNITS.toString(), // initial funding
      true, // accepts_contributions
      false, // delegate_to_creator — the ONLY delegate will be the sealed module
    ]);
    let vault: string | undefined;
    for (const ch of (committed as { changes?: Array<{ address?: string; data?: { type?: string } }> }).changes ?? []) {
      if (ch.data?.type === `${cfg.decibel}::vault::Vault`) vault = ch.address;
    }
    if (!vault) throw new Error(`vault address not found in tx changes (${explorer(committed.hash)})`);
    state.decibelVaultAddr = vault;
    state.decibelVaultTx = committed.hash;
    saveState(state);
    console.log(`  decibel vault ${vault}`);
    console.log(`  ${explorer(committed.hash)}`);
  }

  // ── program commitment ──
  const pine = canonicalizePine(
    flags.pine ? readFileSync(flags.pine, "utf8") : SEALED_PRESETS[flags.preset ?? "ema"],
  );
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr: cfg.market.addr });
  if (t.errors?.length) throw new Error(`transpile failed:\n${t.errors.join("\n")}`);
  const runner = createStrategyRunner(t.ir);
  if (runner.unsupported.size > 0) {
    throw new Error(`evaluator cannot run: ${[...runner.unsupported].join(", ")}`);
  }
  const manifestJson = buildManifest({
    transpilerVersion: TRANSPILER_VERSION,
    moduleName: t.moduleName,
    marketAddr: cfg.market.addr,
  });
  const commitment = computeProgramCommitment({
    canonicalPine: pine,
    emittedMove: t.moveSource,
    manifestJson,
  });
  state.commitment = toHex(commitment);
  state.manifestJson = manifestJson;
  saveState(state);
  console.log(`[commit] ${state.commitment} (${t.moduleName})`);

  // ── sealed vault ──
  if (!state.strategyVaultAddr) {
    console.log(`[sealed-vault] create_sealed_vault…`);
    const committed = await submit(deployer, `${pkg}::sealed_vault::create_sealed_vault`, [
      // vector<u8> must be bytes; a hex string is encoded as its UTF-8 characters.
      fromHex(state.commitment!),
      fromHex(state.attestorPub!),
      state.decibelVaultAddr,
      cfg.market.addr,
      cfg.market.sizeDecimalsPow.toString(),
      cfg.market.lotSize.toString(),
      cfg.market.minSize.toString(),
      cfg.market.tickerSize.toString(),
      "1000", // 10% NAV per order
      "200", // 2x max leverage
      "30", // min bar interval
      "30", // 0.30% slippage tolerance on IOC orders
      "500", // trace capacity
      new Uint8Array(), // enclave measurement — empty for tier-1 bare-key attestation
    ]);
    let sv: string | undefined;
    for (const ev of (committed as { events?: Array<{ type: string; data: Record<string, string> }> }).events ?? []) {
      if (ev.type.endsWith("::sealed_vault::SealedVaultCreated")) sv = ev.data.strategy_vault;
    }
    if (!sv) throw new Error("SealedVaultCreated event missing");
    state.strategyVaultAddr = sv;
    state.createTx = committed.hash;
    // Sealed at birth — create IS the seal, so there is no separate seal transaction.
    state.sealTx = committed.hash;
    saveState(state);
    console.log(`  strategy vault ${sv}`);
    console.log(`  ${explorer(committed.hash)}`);
  }

  // ── delegate ──
  if (!state.delegateTx) {
    console.log(`[delegate] vault_admin_api::delegate_dex_actions_to…`);
    const expiry = Math.floor(Date.now() / 1000) + 365 * 86_400;
    const committed = await submit(deployer, `${cfg.decibel}::vault_admin_api::delegate_dex_actions_to`, [
      state.decibelVaultAddr,
      state.strategyVaultAddr,
      String(expiry), // Option<u64> — plain value serializes as Some
    ]);
    state.delegateTx = committed.hash;
    saveState(state);
    console.log(`  ${explorer(committed.hash)}`);
  }

  // ── register in the app feed (best-effort) ──
  const appUrl = process.env.SEALED_APP_URL ?? flags["app-url"];
  if (appUrl) {
    try {
      const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/sealed/vaults`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVaultAddr: state.strategyVaultAddr,
          packageAddress: pkg,
          network,
          creatorAddr: state.deployerAddr,
          decibelVaultAddr: state.decibelVaultAddr,
          programCommitment: state.commitment,
          attestorPubkey: state.attestorPub,
          manifestJson: state.manifestJson,
          market: cfg.market.name,
          name: "Sealed Alpha (e2e)",
          description: "Deployed by scripts/sealed-e2e-deploy.ts",
          pctBps: 1000,
          maxLeverageX100: 200,
          minBarIntervalS: 30,
          sealed: true,
          createTxHash: state.createTx,
          sealTxHash: state.sealTx,
        }),
      });
      console.log(`[register] ${appUrl} -> ${res.status}`);
    } catch (err) {
      console.log(`[register] skipped (${err instanceof Error ? err.message : "unreachable"})`);
    }
  } else {
    console.log(`[register] no SEALED_APP_URL/--app-url — register later via POST /api/sealed/vaults`);
  }

  // ── attest a few live bars ──
  const submittedTicks = await attestTicks(
    state,
    deployer,
    attestorKey,
    runner,
    Number(flags.ticks ?? 3),
  );
  if (testSignal === 1 || testSignal === 2) {
    const executionTick = submittedTicks.find((tick) => tick.signal === testSignal);
    if (!executionTick) {
      throw new Error("the directional test probe submitted no matching tick");
    }
    await verifyDirectionalExecutionProbe(state, executionTick);
  }

  console.log(`\nLIVE. Add to .env / Vercel:`);
  console.log(`  SEALED_VAULT_PACKAGE=${pkg}`);
  console.log(`  NEXT_PUBLIC_SEALED_VAULT_PACKAGE=${pkg}`);
  console.log(`  SEALED_ATTESTOR_PUBLIC_KEY=${state.attestorPub}`);
  console.log(`\nVault object: ${state.strategyVaultAddr}`);
  console.log(
    `Explorer: https://explorer.aptoslabs.com/object/${state.strategyVaultAddr}${cfg.explorerSuffix}`,
  );
  console.log(`Keep ticking:  pnpm sealed:e2e attest --network ${network}\n`);
}

async function attestTicks(
  state: E2EState,
  cranker: Account,
  attestorPriv: Ed25519PrivateKey,
  runner: ReturnType<typeof createStrategyRunner>,
  count: number,
): Promise<TickRecord[]> {
  const pkg = state.packageAddress!;
  if (testSignal !== undefined) {
    console.log(
      `[attest] TESTNET EXECUTION PROBE: overriding runner output with signal=${testSignal}`,
    );
  }
  // Warm the strategy on history so the signal is meaningful.
  const now = Math.floor(Date.now() / 1000);
  const candles = await fetchPythCandles("BTC/USD", "1", now - (runner.warmupBars + 60) * 120, now);
  for (const c of candles) runner.pushBar(c.close);

  const chainId = await aptos.getChainId();
  state.ticks ??= [];

  let submitted = 0;
  let tooSoonRetries = 0;
  const submittedTicks: TickRecord[] = [];
  while (submitted < count) {
    const ctx = (await aptos.view({
      payload: {
        function: `${pkg}::sealed_vault::get_attestation_context`,
        functionArguments: [state.strategyVaultAddr],
      },
    })) as [string, string, string, number, string];
    const seq = BigInt(ctx[1]);
    const digest = String(ctx[2]);

    const nowTick = Math.floor(Date.now() / 1000);
    const latest = await fetchPythCandles("BTC/USD", "1", nowTick - 300, nowTick);
    const close = latest[latest.length - 1]?.close;
    let signal: Signal = 0;
    if (close) {
      const s = runner.pushBar(close);
      signal = s === "buy" ? 1 : s === "sell" ? 2 : 0;
    }
    if (testSignal !== undefined) signal = testSignal;

    if (signal !== 0) {
      await assertAutomatedVaultBuilderCompatible({
        aptos,
        network,
        packageAddress: pkg,
        strategyVaultAddress: state.strategyVaultAddr!,
        moduleName: "sealed_vault",
        expectedDecibelSubaccount: state.subaccountAddr,
        decibelPackageAddress: cfg.decibel,
      });
    }

    const barTs = BigInt(Math.floor(Date.now() / 1000));
    const signature = signAttestation(attestorPriv, {
      chainId,
      strategyVault: state.strategyVaultAddr!,
      programCommitment: fromHex(state.commitment!),
      seq,
      inputDigest: fromHex(digest),
      barTs,
      signal,
    });
    const payload = buildTickAttestedPayload({
      packageAddress: pkg,
      strategyVault: state.strategyVaultAddr!,
      barTs,
      signal,
      signature,
    });
    try {
      const committed = await submit(cranker, payload.function, payload.functionArguments);
      const tick: TickRecord = {
        seq: seq.toString(),
        signal,
        tx: committed.hash,
        source: testSignal === undefined ? "runner" : "test-override",
      };
      state.ticks.push(tick);
      submittedTicks.push(tick);
      saveState(state);
      console.log(`[attest] seq=${seq} signal=${signal} ${explorer(committed.hash)}`);
      submitted += 1;
      tooSoonRetries = 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/E_BAR_TOO_SOON|EBAR_TOO_SOON/.test(msg)) {
        throw err;
      }
      tooSoonRetries += 1;
      if (tooSoonRetries > MAX_BAR_TOO_SOON_RETRIES) {
        throw new Error(
          `[attest] seq=${seq} remained too soon after ${MAX_BAR_TOO_SOON_RETRIES} retries`,
          { cause: err },
        );
      }
      console.log(
        `[attest] seq=${seq} bar too soon — waiting 35s, then retrying the same tick`,
      );
      await new Promise((resolve) => setTimeout(resolve, BAR_TOO_SOON_RETRY_DELAY_MS));
      continue;
    }
    if (submitted < count) {
      await new Promise((resolve) => setTimeout(resolve, BAR_TOO_SOON_RETRY_DELAY_MS));
    }
  }
  return submittedTicks;
}

interface ChainEvent {
  type?: string;
  data?: Record<string, unknown>;
}

interface DecibelPosition {
  is_long?: boolean | string;
  market?: { inner?: string } | string;
  size?: string | number;
}

function eventBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function requirePositiveInteger(value: unknown, label: string): bigint {
  try {
    const parsed = BigInt(String(value));
    if (parsed > 0n) return parsed;
  } catch {
    // Use the single, field-specific error below for malformed and non-positive values.
  }
  throw new Error(`${label} must be a positive integer`);
}

async function verifyDirectionalExecutionProbe(state: E2EState, tick: TickRecord) {
  if (network !== "testnet") {
    throw new Error("directional execution probes are testnet-only");
  }
  if (tick.source !== "test-override" || (tick.signal !== 1 && tick.signal !== 2)) {
    throw new Error("execution proof requires a directional test-override tick");
  }
  if (!state.packageAddress || !state.strategyVaultAddr || !state.decibelVaultAddr) {
    throw new Error("execution proof requires package, strategy-vault, and Decibel-vault state");
  }

  const expectedLong = tick.signal === 1;
  const landed = (await aptos.getTransactionByHash({
    transactionHash: tick.tx,
  })) as {
    success?: boolean;
    vm_status?: string;
    events?: ChainEvent[];
  };
  if (landed.success !== true) {
    throw new Error(`execution-probe transaction failed: ${landed.vm_status ?? tick.tx}`);
  }

  const events = landed.events ?? [];
  const orderEvent = events.find((event) => event.type?.endsWith("::market_types::OrderEvent"));
  const vaultTraded = events.find((event) => event.type?.endsWith("::sealed_vault::VaultTraded"));
  const attestedTick = events.find((event) => event.type?.endsWith("::sealed_vault::AttestedTick"));
  if (!orderEvent?.data) throw new Error("execution proof is missing Decibel OrderEvent");
  if (!vaultTraded?.data) throw new Error("execution proof is missing VaultTraded");
  if (!attestedTick?.data) throw new Error("execution proof is missing AttestedTick");
  if (eventBoolean(orderEvent.data.is_bid) !== expectedLong) {
    throw new Error("Decibel OrderEvent direction does not match the test signal");
  }
  if (eventBoolean(vaultTraded.data.is_buy) !== expectedLong) {
    throw new Error("VaultTraded direction does not match the test signal");
  }
  if (!eventBoolean(attestedTick.data.traded)) {
    throw new Error("AttestedTick reported traded=false");
  }
  if (Number(attestedTick.data.signal) !== tick.signal) {
    throw new Error("AttestedTick signal does not match the recorded test tick");
  }
  const orderSize = requirePositiveInteger(orderEvent.data.size_delta, "OrderEvent size_delta");
  const tradedSize = requirePositiveInteger(vaultTraded.data.size, "VaultTraded size");

  const platformTerms = (await aptos.view({
    payload: {
      function: `${state.packageAddress}::sealed_vault::platform_terms`,
      functionArguments: [],
    },
  })) as unknown[];
  const builderTerms = (await aptos.view({
    payload: {
      function: `${state.packageAddress}::sealed_vault::get_builder_terms`,
      functionArguments: [state.strategyVaultAddr],
    },
  })) as unknown[];
  if (BigInt(String(platformTerms[3])) !== 0n || BigInt(String(builderTerms[1])) !== 0n) {
    throw new Error("automated-vault execution proof requires zero platform and vault builder fee");
  }

  const vaultResource = (await aptos.getAccountResource({
    accountAddress: state.decibelVaultAddr,
    resourceType: `${cfg.decibel}::vault::Vault`,
  })) as { portfolio?: { dex_primary_subaccount?: string } };
  const dexSubaccount = vaultResource.portfolio?.dex_primary_subaccount;
  if (!dexSubaccount) throw new Error("Decibel vault is missing its trading subaccount");
  if (normalizeAddress(String(orderEvent.data.user), "OrderEvent user") !== normalizeAddress(dexSubaccount, "Decibel trading subaccount")) {
    throw new Error("Decibel OrderEvent was emitted for a different trading subaccount");
  }

  const [positionRows] = (await aptos.view({
    payload: {
      function: `${cfg.decibel}::perp_engine::list_positions`,
      functionArguments: [dexSubaccount],
    },
  })) as [DecibelPosition[]];
  const position = positionRows.find((row) => {
    const market = typeof row.market === "string" ? row.market : row.market?.inner;
    return (
      market !== undefined &&
      normalizeAddress(market, "position market") === normalizeAddress(cfg.market.addr, "configured market") &&
      eventBoolean(row.is_long) === expectedLong &&
      BigInt(String(row.size ?? 0)) > 0n
    );
  });
  if (!position) {
    throw new Error(`Decibel has no live ${expectedLong ? "long" : "short"} position from the probe`);
  }

  console.log("[verify-execution] TESTNET directional order proved end to end");
  console.log(`  tx=${tick.tx}`);
  console.log(`  direction=${expectedLong ? "long" : "short"} order=${orderSize} traded=${tradedSize}`);
  console.log(`  decibel_subaccount=${dexSubaccount} position=${String(position.size)}`);
  console.log("  automated_builder_fee=0bps (platform and vault)");
}

// ─── status / attest / verify-markets ────────────────────────────────────────

async function status() {
  const state = loadState();
  const { manifestJson, ...publicState } = state;
  console.log(JSON.stringify({ ...publicState, manifestStored: Boolean(manifestJson) }, null, 2));
  if (state.deployerAddr) {
    console.log(`\nbalance: ${Number(await balanceOctas(state.deployerAddr)) / 1e8} APT`);
  }
  if (state.strategyVaultAddr && state.packageAddress) {
    const s = await aptos.view({
      payload: {
        function: `${state.packageAddress}::sealed_vault::get_sealed_state`,
        functionArguments: [state.strategyVaultAddr],
      },
    });
    console.log(`on-chain: sealed=${(s as unknown[])[11]} trades=${(s as unknown[])[12]} seq=${(s as unknown[])[13]}`);
  }
}

async function attestForever() {
  const state = loadState();
  if (!state.sealTx) throw new Error("vault not sealed yet — run `sealed:e2e run` first");
  const deployerKey = loadOrCreateKey("deployer.key", "SEALED_DEPLOYER_PRIVATE_KEY");
  const attestorPriv = loadOrCreateKey("attestor.key", "SEALED_ATTESTOR_PRIVATE_KEY");
  const deployer = Account.fromPrivateKey({ privateKey: deployerKey });
  const pine = canonicalizePine(
    flags.pine ? readFileSync(flags.pine, "utf8") : SEALED_PRESETS[flags.preset ?? "ema"],
  );
  const t = transpileV3(pine, undefined, { target: "vault", marketAddr: cfg.market.addr });
  const runner = createStrategyRunner(t.ir);
  const interval = Number(flags.interval ?? 60);
  for (;;) {
    try {
      await attestTicks(state, deployer, attestorPriv, runner, 1);
    } catch (err) {
      console.error("tick failed:", err instanceof Error ? err.message.slice(0, 300) : err);
    }
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

interface PreflightCheck {
  label: string;
  ok: boolean;
  detail: string;
}

async function preflightMainnet() {
  if (network !== "mainnet") {
    throw new Error("preflight-mainnet requires --network mainnet");
  }

  const checks: PreflightCheck[] = [];
  const check = async (label: string, action: () => Promise<string> | string) => {
    try {
      checks.push({ label, ok: true, detail: await action() });
    } catch (error) {
      checks.push({
        label,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  await check("Aptos CLI", () => {
    const version = runAptosCli(["--version"], STRATEGY_PACKAGE_DIR).trim();
    if (!/^aptos\s+8\./.test(version)) {
      throw new Error(`expected Aptos CLI 8.x, found ${version || "unknown"}`);
    }
    return version;
  });

  await check("Aptos mainnet fullnode", async () => {
    const chainId = await aptos.getChainId();
    if (chainId !== 1) throw new Error(`expected chain id 1, received ${chainId}`);
    return `${cfg.nodeUrl} (chain id ${chainId})`;
  });

  await check("Decibel BTC/USD market", async () => {
    const view = async (fn: string) => {
      return (await aptos.view({
        payload: {
          function: `${cfg.decibel}::perp_engine::${fn}` as `${string}::${string}::${string}`,
          functionArguments: [cfg.market.addr],
        },
      })) as unknown[];
    };
    const [lot] = await view("market_lot_size");
    const [min] = await view("market_min_size");
    const [sz] = await view("market_sz_decimals");
    const sizeDecimalsPow = 10n ** BigInt(Number(sz));
    if (
      BigInt(String(lot)) !== cfg.market.lotSize ||
      BigInt(String(min)) !== cfg.market.minSize ||
      sizeDecimalsPow !== cfg.market.sizeDecimalsPow
    ) {
      throw new Error(
        `config drift: lot=${lot} min=${min} szDecimals=${sz}; do not publish`,
      );
    }
    return `lot=${lot} min=${min} szDecimals=${sz}`;
  });

  await check("Mainnet USDC metadata", async () => {
    const response = await fetch(`${cfg.nodeUrl}/accounts/${cfg.usdcMetadata}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`fullnode returned ${response.status} for ${cfg.usdcMetadata}`);
    }
    return "native USDC metadata account exists";
  });

  await check("Mainnet platform economics", () => {
    const economics = resolvePlatformEconomics("0x1");
    if (economics.builderFeeBps !== 0) {
      throw new Error("automated vault builder fee must be 0 bps");
    }
    return `treasury configured; automated builder fee=${economics.builderFeeBps}bps`;
  });

  let packageAddress: string | undefined;
  if (flags.package) {
    await check("Intended package address", () => {
      packageAddress = normalizeAddress(flags.package, "package address");
      return `${packageAddress} (public deployer address)`;
    });
  } else {
    checks.push({
      label: "Intended package address",
      ok: false,
      detail: "pass --package 0x<fresh-mainnet-deployer-address>; no key is required",
    });
  }

  const compileAddress = packageAddress ?? "0xca54";
  const packageDir = mkdtempSync(join(tmpdir(), "cash-sealed-mainnet-preflight-"));
  try {
    cpSync(STRATEGY_PACKAGE_DIR, packageDir, { recursive: true });
    const moveToml = join(packageDir, "Move.toml");
    const toml = readFileSync(moveToml, "utf8");
    writeFileSync(moveToml, applyMainnetUpgradePolicy(toml));

    await check("Compatible Move package", () => {
      const named = packageNamedAddresses(compileAddress);
      compilePackageAtAddress(packageDir, compileAddress);
      runAptosCli(["move", "test", "--named-addresses", named], packageDir);
      return packageAddress
        ? `compiled and tested at ${packageAddress}`
        : "compiled and tested at a placeholder; exact address check is still required";
    });

    if (packageAddress) {
      await check("Package address state", async () => {
        const published = await fetchPublishedPackageBytecode(packageAddress!);
        const present = SEALED_PACKAGE_MODULES.filter((module) => published[module]);
        if (present.length !== 0 && present.length !== SEALED_PACKAGE_MODULES.length) {
          const missing = SEALED_PACKAGE_MODULES.filter((module) => !published[module]);
          throw new Error(
            `partial package: present=${present.join(",")} missing=${missing.join(",")}`,
          );
        }

        const alreadyPublished = present.length === SEALED_PACKAGE_MODULES.length;
        if (alreadyPublished) {
          await assertPublishedPackageMatches(packageDir, packageAddress!, published);
        }
        const balance = await balanceOctas(packageAddress!);
        const required = alreadyPublished
          ? MIN_RESUME_GAS_OCTAS
          : MIN_FRESH_PUBLISH_GAS_OCTAS;
        if (balance < required) {
          throw new Error(
            `${alreadyPublished ? "existing" : "fresh"} package address has ${Number(balance) / 1e8} APT; ` +
              `fund at least ${Number(required) / 1e8} APT`,
          );
        }
        return `${alreadyPublished ? "exact package already published" : "fresh address"}; ` +
          `balance=${Number(balance) / 1e8} APT`;
      });
    }
  } finally {
    rmSync(packageDir, { recursive: true, force: true });
  }

  console.log("\nSEALED VAULT MAINNET PREFLIGHT — READ ONLY");
  for (const result of checks) {
    console.log(`${result.ok ? "PASS " : "BLOCK"}  ${result.label}: ${result.detail}`);
  }
  const blockers = checks.filter((result) => !result.ok);
  console.log(
    blockers.length === 0
      ? "\nREADY: all pre-publish checks passed; no key was loaded and no transaction was submitted."
      : `\nNOT READY: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}; ` +
          "no key was loaded and no transaction was submitted.",
  );
  if (blockers.length > 0) process.exitCode = 1;
}

async function verifyMarkets() {
  for (const net of ["testnet", "mainnet"] as const) {
    const c = NET[net];
    const view = async (fn: string) => {
      const res = await fetch(`${c.nodeUrl}/view`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          function: `${c.decibel}::perp_engine::${fn}`,
          type_arguments: [],
          arguments: [c.market.addr],
        }),
      });
      return (await res.json()) as unknown[];
    };
    const [lot] = await view("market_lot_size");
    const [min] = await view("market_min_size");
    const [sz] = await view("market_sz_decimals");
    const szPow = 10n ** BigInt(Number(sz));
    const ok =
      BigInt(String(lot)) === c.market.lotSize &&
      BigInt(String(min)) === c.market.minSize &&
      szPow === c.market.sizeDecimalsPow;
    console.log(
      `${net} ${c.market.name}: lot=${lot} min=${min} szDecimals=${sz} — ${ok ? "MATCHES config" : "*** DRIFT — update NET + lib/sealed-vaults.ts ***"}`,
    );
    if (!ok) process.exitCode = 1;
  }
}

async function verifyPackage() {
  const configuredAddress = flags.package ?? loadState().packageAddress;
  if (!configuredAddress) {
    throw new Error("pass --package 0x... or use a state file containing packageAddress");
  }
  const packageAddress = normalizeAddress(configuredAddress, "package address");
  console.log(`[verify-package] compiling current source for ${network} at ${packageAddress}…`);
  compilePackageAtAddress(STRATEGY_PACKAGE_DIR, packageAddress);
  await assertPublishedPackageMatches(STRATEGY_PACKAGE_DIR, packageAddress);
  console.log("[verify-package] all sealed-vault modules match exactly");
}

async function verifyExecution() {
  if (network !== "testnet") {
    throw new Error("verify-execution is testnet-only; no state or key material was loaded");
  }
  const state = loadState();
  const directionalTicks = (state.ticks ?? []).filter(
    (tick) => tick.source === "test-override" && (tick.signal === 1 || tick.signal === 2),
  );
  const tick = flags.tx
    ? directionalTicks.find((candidate) => candidate.tx === flags.tx)
    : directionalTicks[0];
  if (!tick) {
    throw new Error(
      flags.tx
        ? `state contains no directional test tick for ${flags.tx}`
        : "state contains no directional test-override tick; run with --test-signal buy|sell",
    );
  }
  await verifyDirectionalExecutionProbe(state, tick);
}

(async () => {
  if (cmd === "run") return run();
  // Publish + init_platform ONLY. `run` continues into creating a real Decibel vault, which on
  // mainnet spends 100 USDC of protocol fee plus the seed plus our launch fee — not something
  // a deployment step should do by surprise.
  if (cmd === "publish") return run();
  if (cmd === "status") return status();
  if (cmd === "attest") return attestForever();
  if (cmd === "verify-package") return verifyPackage();
  if (cmd === "verify-execution") return verifyExecution();
  if (cmd === "preflight-mainnet") return preflightMainnet();
  if (cmd === "verify-markets") return verifyMarkets();
  console.error(
    "commands: run | publish | status | attest | verify-package | verify-execution | preflight-mainnet | verify-markets",
  );
  process.exit(1);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
