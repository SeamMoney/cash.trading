/**
 * Sealed-vault END-TO-END deploy — one command from empty account to live
 * attested ticks on chain. Testnet is fully automated once the deployer has
 * gas; mainnet runs the same pipeline against mainnet params with your funded
 * key (and skips the testnet-only USDC mint).
 *
 *   pnpm sealed:e2e run       [--network testnet] [--state .sealed-e2e]
 *   pnpm sealed:e2e status    — where the pipeline is, what it needs
 *   pnpm sealed:e2e attest    — keep ticking an already-deployed vault
 *   pnpm sealed:e2e verify-markets — re-read lot/min/szDecimals from chain and
 *                                    diff against lib/sealed-vaults.ts
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
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  Account,
  AccountAddress,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
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
  DEFAULT_DECIBEL_BUILDER_FEE_BPS,
  MAX_DECIBEL_BUILDER_FEE_BPS,
} from "../lib/decibel-builder-config";

// ─── Network config (authoritative, verified on-chain 2026-07-30) ────────────

const NET = {
  testnet: {
    aptosNetwork: Network.TESTNET,
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
    aptosNetwork: Network.MAINNET,
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

const MIN_GAS_OCTAS = 40_000_000n; // 0.4 APT — publish + ~20 setup txs
const USDC_MINT_UNITS = 500_000_000n; // 500 USDC — covers the 100 USDC creation fee
                                      // + 100 USDC activation minimum with headroom
const VAULT_FUND_UNITS = 100_000_000n; // 100 USDC into the Decibel vault
const LAUNCH_FEE_UNITS = 50_000_000n;  // 50 USDC — our fee, on top of Decibel's 100

interface PlatformEconomics {
  treasuryAddress: string;
  builderAddress: string;
  builderFeeBps: number;
}

// ─── State ───────────────────────────────────────────────────────────────────

interface E2EState {
  network: NetworkName;
  deployerAddr?: string;
  attestorPub?: string;
  publishTx?: string;
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
  ticks?: Array<{ seq: string; signal: number; tx: string }>;
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

const aptos = new Aptos(new AptosConfig({ network: cfg.aptosNetwork }));

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
  if (network === "mainnet" && !configuredBuilder) {
    throw new Error(
      "DECIBEL_BUILDER_ADDRESS is required for an immutable mainnet publish; " +
        "the deployer key must not silently become the revenue recipient",
    );
  }

  const builderAddress = normalizeAddress(
    configuredBuilder || deployerAddress,
    "DECIBEL_BUILDER_ADDRESS",
  );
  const treasuryAddress = normalizeAddress(
    process.env.SEALED_TREASURY_ADDRESS?.trim() || builderAddress,
    "SEALED_TREASURY_ADDRESS",
  );

  const rawFee = process.env.DECIBEL_BUILDER_FEE_BPS?.trim();
  const builderFeeBps = rawFee
    ? Number(rawFee)
    : DEFAULT_DECIBEL_BUILDER_FEE_BPS;
  if (
    !Number.isSafeInteger(builderFeeBps) ||
    builderFeeBps < 1 ||
    builderFeeBps > MAX_DECIBEL_BUILDER_FEE_BPS
  ) {
    throw new Error(
      `DECIBEL_BUILDER_FEE_BPS must be a whole number from 1 to ${MAX_DECIBEL_BUILDER_FEE_BPS}`,
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

  // ── funding gate ──
  const bal = await balanceOctas(state.deployerAddr);
  console.log(`[funding] balance ${Number(bal) / 1e8} APT (need ${Number(MIN_GAS_OCTAS) / 1e8})`);
  if (bal < MIN_GAS_OCTAS) {
    console.log(
      network === "testnet"
        ? `\n  BLOCKED on gas. The public faucet requires a signed-in JWT, so a human must:\n` +
            `    → faucet ~1 APT to ${state.deployerAddr}\n` +
            `      (https://aptos.dev/network/faucet — paste the address)\n` +
            `    or transfer from any funded testnet wallet.\n` +
            `  Re-run this command after; every completed step is skipped.\n`
        : `\n  BLOCKED on gas. Send ~1 APT on MAINNET to ${state.deployerAddr}, or set\n` +
            `  SEALED_DEPLOYER_PRIVATE_KEY to an already-funded key and re-run.\n`,
    );
    process.exit(2);
  }

  // ── publish ──
  if (!state.packageAddress) {
    console.log(`[publish] compiling + publishing to ${network}…`);
    const aptosBin = process.env.APTOS_BIN ?? "aptos";
    let pkgDir = resolve(__dirname, "../contracts/strategy-vaults");
    // Mainnet publishes are IMMUTABLE: without this the rules stay upgradeable
    // by the publisher key, which voids the whole "sealed" claim
    // (docs/SEALED-INDICATOR.md §5). Testnet stays compatible for iteration.
    if (network === "mainnet") {
      const tmp = join(stateDir, "pkg-immutable");
      ensureStateDir();
      rmSync(tmp, { recursive: true, force: true });
      cpSync(pkgDir, tmp, { recursive: true });
      const tomlPath = join(tmp, "Move.toml");
      const toml = readFileSync(tomlPath, "utf8");
      if (!toml.includes("upgrade_policy")) {
        writeFileSync(tomlPath, toml.replace('version = "0.1.0"', 'version = "0.1.0"\nupgrade_policy = "immutable"'));
      }
      pkgDir = tmp;
      console.log(`  mainnet: publishing with upgrade_policy = "immutable"`);
    }
    const named = `cash_strategy=${state.deployerAddr},decibel=${cfg.decibel},order_book=0x5`;
    const runCli = (args: string[]) => {
      let out: string;
      try {
        out = execFileSync(aptosBin, args, { cwd: pkgDir, encoding: "utf8" });
      } catch (err) {
        // execFileSync throws a bare "Command failed" whose actual cause is in the captured
        // streams. Surfacing them is the difference between a diagnosable failure and a
        // one-line dead end.
        const e = err as { stdout?: string; stderr?: string; message?: string };
        throw new Error(
          `aptos ${args[0]} ${args[1]} failed\n` +
            `${(e.stdout ?? "").slice(-3000)}\n${(e.stderr ?? "").slice(-3000)}\n${e.message ?? ""}`,
        );
      }
      if (out.includes('"Error"')) throw new Error(out.slice(-3000));
      return out;
    };
    runCli(["move", "compile", "--named-addresses", named]);
    runCli(["move", "test", "--named-addresses", named]);
    const publishKeyPath = join(stateDir, `.publish-key-${process.pid}`);
    writePrivateFile(publishKeyPath, deployerKey.toString());
    let out: string;
    try {
      out = runCli([
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
      ]);
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
  await attestTicks(state, deployer, attestorKey, runner, Number(flags.ticks ?? 3));

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
) {
  const pkg = state.packageAddress!;
  // Warm the strategy on history so the signal is meaningful.
  const now = Math.floor(Date.now() / 1000);
  const candles = await fetchPythCandles("BTC/USD", "1", now - (runner.warmupBars + 60) * 120, now);
  for (const c of candles) runner.pushBar(c.close);

  const chainId = await aptos.getChainId();
  state.ticks ??= [];

  for (let i = 0; i < count; i++) {
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

    const signature = signAttestation(attestorPriv, {
      chainId,
      strategyVault: state.strategyVaultAddr!,
      programCommitment: fromHex(state.commitment!),
      seq,
      inputDigest: fromHex(digest),
      signal,
    });
    const payload = buildTickAttestedPayload({
      packageAddress: pkg,
      strategyVault: state.strategyVaultAddr!,
      barTs: BigInt(Math.floor(Date.now() / 1000)),
      signal,
      signature,
    });
    try {
      const committed = await submit(cranker, payload.function, payload.functionArguments);
      state.ticks.push({ seq: seq.toString(), signal, tx: committed.hash });
      saveState(state);
      console.log(`[attest] seq=${seq} signal=${signal} ${explorer(committed.hash)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("E_BAR_TOO_SOON") || msg.includes("11")) {
        console.log(`[attest] seq=${seq} bar too soon — waiting 35s`);
      } else {
        throw err;
      }
    }
    if (i < count - 1) await new Promise((r) => setTimeout(r, 35_000));
  }
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

(async () => {
  if (cmd === "run") return run();
  // Publish + init_platform ONLY. `run` continues into creating a real Decibel vault, which on
  // mainnet spends 100 USDC of protocol fee plus the seed plus our launch fee — not something
  // a deployment step should do by surprise.
  if (cmd === "publish") return run();
  if (cmd === "status") return status();
  if (cmd === "attest") return attestForever();
  if (cmd === "verify-markets") return verifyMarkets();
  console.error("commands: run | status | attest | verify-markets");
  process.exit(1);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
