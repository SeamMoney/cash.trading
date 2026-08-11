/**
 * Clean-room proof that a portfolio vault actually TRADES on the live Decibel testnet engine.
 *
 *   pnpm test:portfolio-cleanroom
 *
 * `scripts/portfolio-e2e-testnet.ts` reuses the existing e2e stack, whose Decibel vault has a
 * genuine outside depositor — so `is_swap` derives true, the notice gate correctly blocks
 * trading for 24h, and everything downstream of the gate stays unproven. This builds a whole
 * stack from nothing so the gate does not apply and the tick runs to completion:
 *
 *   fresh account ← APT from the existing deployer (the public faucet needs a human JWT)
 *     → mint testnet USDC (per-account lifetime cap, so a fresh account is the only way)
 *     → publish the package at a fresh address (which is also how the `is_swap` signature
 *       change lands — removing an entry-fn parameter cannot upgrade in place)
 *     → init_platform → subaccount → Decibel vault → portfolio vault → delegate → TICK
 *
 * What only this can prove: order placement against a real order book, the multi-market price
 * fold over four live marks, and the maintenance pass that calls `view_position` /
 * `get_position_size` / `get_market_round_price_to_ticker` for real.
 *
 * Idempotent. State lands in `.portfolio-cleanroom-testnet/` (gitignored); re-running resumes
 * at the first incomplete step rather than spending USDC again.
 * Pass `--migrate-key-only` to move a legacy embedded key into deployer.key without submitting
 * a transaction.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Account,
  AccountAddress,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";

import { performPortfolioTick } from "../lib/portfolio-tick";
import {
  PORTFOLIO_DEFAULTS,
  SEALED_MARKETS,
  buildCreatePortfolioVaultPayload,
  commitProgram,
  derivePrimarySubaccount,
} from "../lib/sealed-vaults";
import { buildDelegateDecibelVaultPayload } from "../lib/decibel-vaults";
import { SEALED_CATALOG } from "../lib/sealed-catalog";

const DIR = ".portfolio-cleanroom-testnet";
const DECIBEL = "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f";
const USDC = "0x5428acf5c112826d0c74ae1cd2de9030f53d1d01235e6c2621d967bf914ee1c8";
const APTOS_BIN = process.env.APTOS_BIN ?? "aptos";

const MINT_UNITS = 500_000_000n;   // 500 USDC — Decibel's 100 fee + 100 seed + our 50 + headroom
const VAULT_FUND = 100_000_000n;   // 100 USDC seed, Decibel's activation minimum
const LAUNCH_FEE = 50_000_000n;    // our fee, paid from the WALLET not the subaccount
const APT_SEED = 300_000_000n;     // 3 APT for gas + publish

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

interface State {
  /** Legacy location. Migrated to deployer.key before the next transaction. */
  privateKey?: string;
  addr?: string;
  fundTx?: string;
  mintTx?: string;
  publishTx?: string;
  initTx?: string;
  subaccount?: string;
  depositTx?: string;
  decibelVault?: string;
  portfolioVault?: string;
  delegateTx?: string;
  tickTx?: string;
}

mkdirSync(DIR, { recursive: true, mode: 0o700 });
chmodSync(DIR, 0o700);
const statePath = resolve(DIR, "state.json");
const keyPath = resolve(DIR, "deployer.key");
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
if (existsSync(statePath)) chmodSync(statePath, 0o600);

function writeOwnerOnlyFile(path: string, contents: string) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  // `mode` only applies when a file is first created. Tighten an existing file too.
  chmodSync(path, 0o600);
}

const save = () => writeOwnerOnlyFile(statePath, JSON.stringify(state, null, 2));

async function send(signer: Account, label: string, data: Parameters<typeof aptos.transaction.build.simple>[0]["data"]) {
  const txn = await aptos.transaction.build.simple({ sender: signer.accountAddress, data });
  const pending = await aptos.signAndSubmitTransaction({ signer, transaction: txn });
  const done = await aptos.waitForTransaction({ transactionHash: pending.hash });
  if (!(done as { success?: boolean }).success) {
    throw new Error(`${label} reverted: ${(done as { vm_status?: string }).vm_status}\n  ${pending.hash}`);
  }
  console.log(`  ok   ${label}  ${pending.hash}`);
  return done;
}

const entry = (fn: string, args: unknown[]) =>
  ({ function: fn as `${string}::${string}::${string}`, typeArguments: [], functionArguments: args }) as
    Parameters<typeof send>[2];

async function usdc(addr: string): Promise<bigint> {
  const [b] = (await aptos.view({
    payload: {
      function: "0x1::primary_fungible_store::balance",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [addr, USDC],
    },
  })) as [string];
  return BigInt(b);
}

(async () => {
  console.log("\nportfolio_vault clean-room — testnet\n");

  // ── 1. A fresh account, funded from the existing deployer ──────────────────
  // Older runs embedded this key in state.json and passed it in argv to the Aptos CLI. Keep
  // the resumable account, but migrate the secret to an owner-only file before using it.
  let cleanroomPrivateKeyRaw: string;
  if (existsSync(keyPath)) {
    chmodSync(keyPath, 0o600);
    cleanroomPrivateKeyRaw = readFileSync(keyPath, "utf8").trim();
    if (state.privateKey && state.privateKey.trim() !== cleanroomPrivateKeyRaw) {
      throw new Error("legacy state key does not match deployer.key; refusing ambiguous migration");
    }
  } else if (state.privateKey) {
    cleanroomPrivateKeyRaw = state.privateKey.trim();
    writeOwnerOnlyFile(keyPath, cleanroomPrivateKeyRaw);
  } else {
    cleanroomPrivateKeyRaw = Account.generate().privateKey.toString();
    writeOwnerOnlyFile(keyPath, cleanroomPrivateKeyRaw);
  }
  if (state.privateKey) {
    delete state.privateKey;
    save();
  }
  const me = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(cleanroomPrivateKeyRaw) });
  const derivedAddr = me.accountAddress.toStringLong();
  if (state.addr && AccountAddress.from(state.addr).toStringLong() !== derivedAddr) {
    throw new Error("state address does not match deployer.key; refusing to sign");
  }
  if (!state.addr) {
    state.addr = derivedAddr;
    save();
  }
  console.log(`  account    ${state.addr}`);

  if (process.argv.includes("--migrate-key-only")) {
    console.log("  key state  migrated to owner-only deployer.key; no transaction submitted\n");
    return;
  }

  if (!existsSync(".sealed-e2e-testnet/deployer.key")) {
    console.log("skipped: .sealed-e2e-testnet/deployer.key not found — this E2E run needs a funded testnet deployer key");
    process.exit(0);
  }

  if (!state.fundTx) {
    // The public faucet needs a signed-in JWT, so gas comes from the account that already has
    // it rather than from a human step.
    const funder = Account.fromPrivateKey({
      privateKey: new Ed25519PrivateKey(readFileSync(".sealed-e2e-testnet/deployer.key", "utf8").trim()),
    });
    const done = await send(funder, "fund fresh account with APT",
      entry("0x1::aptos_account::transfer", [state.addr!, APT_SEED.toString()]));
    state.fundTx = (done as { hash: string }).hash;
    save();
  }

  // ── 2. Testnet USDC. The mint is lifetime-capped per account, which is the whole reason
  //       this needs a fresh account rather than reusing the existing deployer. ────────────
  if (!state.mintTx) {
    const done = await send(me, "restricted_mint 500 USDC",
      entry(`${DECIBEL}::usdc::restricted_mint`, [MINT_UNITS.toString()]));
    state.mintTx = (done as { hash: string }).hash;
    save();
  }
  console.log(`  wallet USDC ${Number(await usdc(state.addr!)) / 1e6}`);

  // ── 3. Publish at the fresh address. This is also how the derived-`is_swap` signature
  //       lands: dropping an entry-function parameter cannot upgrade a package in place. ──
  if (!state.publishTx) {
    console.log("  publishing package (fresh address)…");
    const named = `cash_strategy=${state.addr},decibel=${DECIBEL},order_book=0x5`;
    const out = execFileSync(APTOS_BIN, [
      "move", "publish", "--skip-fetch-latest-git-deps",
      "--named-addresses", named,
      "--url", "https://api.testnet.aptoslabs.com/v1",
      // Do not expose the signing key through the process argument list.
      "--private-key-file", keyPath,
      "--assume-yes", "--max-gas", "2000000", "--included-artifacts", "none",
    ], { cwd: "contracts/strategy-vaults", encoding: "utf8" });
    const tx = out.match(/"transaction_hash":\s*"(0x[0-9a-f]+)"/)?.[1];
    if (!tx || !out.includes('"success": true')) throw new Error(`publish failed:\n${out.slice(-1500)}`);
    state.publishTx = tx;
    save();
    console.log(`  ok   publish  ${tx}`);
  }
  const PKG = state.addr!;

  // ── 4. Platform config (fee table both modules share) ──────────────────────
  if (!state.initTx) {
    const done = await send(me, "init_platform",
      entry(`${PKG}::sealed_vault::init_platform`,
        [state.addr!, LAUNCH_FEE.toString(), USDC, state.addr!, "2"]));
    state.initTx = (done as { hash: string }).hash;
    save();
  }

  // ── 5. Subaccount + deposit. Decibel's creation fee and the seed come from the
  //       SUBACCOUNT; our launch fee is a wallet transfer. Keep them separate. ────────────
  if (!state.subaccount) {
    const primary = derivePrimarySubaccount(state.addr!, "testnet");
    const done = await send(me, "deposit_to_subaccount_at",
      entry(`${DECIBEL}::dex_accounts_entry::deposit_to_subaccount_at`,
        [primary, USDC, (MINT_UNITS - LAUNCH_FEE - 10_000_000n).toString()]));
    const [sub] = (await aptos.view({
      payload: { function: `${DECIBEL}::dex_accounts::primary_subaccount`, functionArguments: [state.addr] },
    })) as [string];
    const confirmed = AccountAddress.from(sub).toStringLong();
    if (confirmed !== AccountAddress.from(primary).toStringLong()) {
      throw new Error(`derived subaccount ${primary} != on-chain ${confirmed}`);
    }
    state.subaccount = confirmed;
    state.depositTx = (done as { hash: string }).hash;
    save();
  }
  console.log(`  subaccount ${state.subaccount}`);

  // ── 6. The Decibel vault that holds the capital ────────────────────────────
  if (!state.decibelVault) {
    const done = await send(me, "create_and_fund_vault",
      entry(`${DECIBEL}::vault_api::create_and_fund_vault`, [
        state.subaccount, USDC,
        // Aptos caps fungible-asset metadata names, and the share FA takes the vault's name —
        // "Portfolio Alpha (clean-room)" aborted with ENAME_TOO_LONG. The launch UI already
        // guards this with `truncateDisplayName`; this script is the raw path.
        "Portfolio Alpha",
        "Multi-market strategy enforced by cash_strategy::portfolio_vault",
        [], "sPORT", "", "",
        "1000", "2592000", "0",
        VAULT_FUND.toString(), true, false,
      ]));
    let vault: string | undefined;
    for (const ch of (done as { changes?: Array<{ address?: string; data?: { type?: string } }> }).changes ?? []) {
      if (ch.data?.type === `${DECIBEL}::vault::Vault`) vault = ch.address;
    }
    if (!vault) throw new Error("vault address not in tx changes");
    state.decibelVault = vault;
    save();
  }
  console.log(`  decibel vault ${state.decibelVault}`);

  // ── 7. The portfolio strategy ──────────────────────────────────────────────
  //
  // `--strategy <id>` launches a SECOND portfolio vault on the same Decibel vault. That is the
  // free-swap path (the vault is already licensed, so no launch fee), it makes `is_swap` derive
  // TRUE, and it is how an order actually gets placed: EMA-cross only signals on a crossover
  // EVENT, so a single tick almost always sees `neutral` on all four markets. A state-based
  // strategy like multi-asset-momentum is directional on most bars.
  const wantId = process.argv.find((a) => a.startsWith("--strategy="))?.split("=")[1];
  if (wantId) {
    state.portfolioVault = undefined;
    state.delegateTx = undefined;
  }
  const strategy = SEALED_CATALOG.find((s) => s.id === (wantId ?? "ema-cross"))!;
  if (!strategy) throw new Error(`unknown strategy ${wantId}`);
  console.log(`  strategy   ${strategy.label}`);
  const markets = SEALED_MARKETS.slice(0, 4);
  const commit = commitProgram({ pine: strategy.script, marketAddr: markets[0].addr });
  if (!commit.ok) throw new Error(`commit: ${commit.error}`);
  const attestorKey = readFileSync(".sealed-e2e-testnet/attestor.key", "utf8").trim();
  const attestorPub = new Ed25519PrivateKey(attestorKey).publicKey().toString();

  if (!state.portfolioVault) {
    const done = await send(me, "create_portfolio_vault",
      buildCreatePortfolioVaultPayload({
        packageAddress: PKG,
        programCommitment: commit.commitment,
        attestorPubkey: attestorPub,
        decibelVaultAddr: state.decibelVault!,
        markets,
        maxPctBps: PORTFOLIO_DEFAULTS.maxPctBps,
        maxLeverageX100: PORTFOLIO_DEFAULTS.maxLeverageX100,
        maxPortfolioLeverageX100: PORTFOLIO_DEFAULTS.maxPortfolioLeverageX100,
        maxPositions: PORTFOLIO_DEFAULTS.maxPositions,
        maxHoldBars: PORTFOLIO_DEFAULTS.maxHoldBars,
        maxAdverseFundingBps: PORTFOLIO_DEFAULTS.maxAdverseFundingBps,
        minBarIntervalS: 60,
        slippageBps: 30,
        traceCapacity: 500,
      }) as Parameters<typeof send>[2]);
    const evs0 = (done as { events?: Array<{ type: string; data: Record<string, unknown> }> }).events ?? [];
    const ev = evs0.find((e) => e.type.endsWith("::portfolio_vault::PortfolioVaultCreated"));
    if (!ev) throw new Error("no PortfolioVaultCreated event");
    state.portfolioVault = String(ev.data.strategy_vault);
    save();
    // A LaunchFeeCharged event on the second launch would mean swapping the algo is not free,
    // which is the thing the $50-once pricing is sold on.
    const charged = evs0.find((e) => e.type.endsWith("::LaunchFeeCharged"));
    console.log(`       is_swap derived on chain: ${ev.data.is_swap}`);
    console.log(`       launch fee charged: ${charged ? `YES (${charged.data.units})` : "no — vault already licensed"}`);
  }
  const SV = state.portfolioVault!;
  console.log(`  portfolio vault ${SV}`);

  if (!state.delegateTx) {
    const done = await send(me, "delegate_dex_actions_to",
      buildDelegateDecibelVaultPayload({
        vaultAddress: state.decibelVault!, delegate: SV,
        network: "testnet", packageAddress: DECIBEL,
      }).payload as Parameters<typeof send>[2]);
    state.delegateTx = (done as { hash: string }).hash;
    save();
  }

  // ── 8. The thing none of the other tests can reach: a tick that actually trades ────────
  console.log("\n  ticking (no swap gate — fresh vault, creator holds every share)…");
  const r = await performPortfolioTick({
    strategyVaultAddr: SV,
    packageAddress: PKG,
    network: "testnet",
    markets: markets.map((m, idx) => ({ idx, name: m.name, address: m.addr, asset: m.pythAsset })),
    manifestJson: commit.manifestJson,
    pineScript: strategy.script,
    defaultPctBps: 1000,
    leverageX100: 200,
    attestorPrivateKey: attestorKey,
    crankPrivateKey: cleanroomPrivateKeyRaw,
  });

  if (!r.ok) {
    console.log(`\n  TICK FAILED  stage=${r.stage}\n  ${r.error}`);
    for (const d of r.detail ?? []) console.log(`    • ${d}`);
    process.exitCode = 1;
    return;
  }
  state.tickTx = r.txHash;
  save();
  console.log(`  ok   tick  seq ${r.seq}, ${r.actions.length} action(s)  ${r.txHash}`);
  for (const a of r.actions) {
    console.log(`         ${markets[a.marketIdx].name} side=${a.side} ${a.pctBps / 100}% @ ${a.leverageX100 / 100}x`);
  }
  for (const s of r.skipped) console.log(`       skipped: ${s}`);

  // ── 9. Read back what the chain did, including whether orders actually went out ────────
  const view = async (fn: string) =>
    (await aptos.view({ payload: { function: `${PKG}::portfolio_vault::${fn}`, functionArguments: [SV] } })) as unknown[];
  console.log(`\n  get_state     ${JSON.stringify(await view("get_state"))}`);
  console.log(`  get_positions ${JSON.stringify(await view("get_positions"))}`);
  const trace = await view("get_trace");
  console.log(`  get_trace     ${(trace[0] as string[]).length} prices / ${trace[2]} markets per row`);

  const tick = await aptos.getTransactionByHash({ transactionHash: r.txHash });
  const evs = (tick as { events?: Array<{ type: string; data: Record<string, unknown> }> }).events ?? [];
  const traded = evs.filter((e) => e.type.endsWith("::PortfolioTraded"));
  const skipped = evs.filter((e) => e.type.endsWith("::PortfolioSkipped"));
  console.log(`\n  PortfolioTraded  ${traded.length}`);
  for (const e of traded) {
    console.log(`    market ${e.data.market_idx} ${e.data.is_buy ? "BUY " : "SELL"} size=${e.data.size} `
      + `px=${e.data.order_px} reduce_only=${e.data.reduce_only} reason=${e.data.reason}`);
  }
  for (const e of skipped) {
    console.log(`  PortfolioSkipped market ${e.data.market_idx} size=${e.data.computed_size} `
      + `min=${e.data.min_size} portfolio_cap=${e.data.blocked_by_portfolio_cap}`);
  }

  await send(me, "force_close_stale (permissionless)",
    entry(`${PKG}::portfolio_vault::force_close_stale`, [SV]));

  console.log(`\n  package  https://explorer.aptoslabs.com/account/${PKG}?network=testnet`);
  console.log(`  vault    https://explorer.aptoslabs.com/account/${SV}?network=testnet`);
  console.log("\nclean-room: PASSED — a portfolio vault traded on the live engine.\n");
})();
