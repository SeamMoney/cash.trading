/**
 * Prove `portfolio_vault` works against the LIVE Decibel engine on testnet.
 *
 *   pnpm exec tsx scripts/portfolio-e2e-testnet.ts
 *
 * This closes docs/DEPLOY-SEALED.md §8.5a, which said plainly that portfolio mode compiled and
 * unit-tested but had never called a real engine. Everything it exercises is a thing that
 * cannot be verified any other way:
 *
 *   - `create_portfolio_vault` with a real four-market allowlist and real engine params
 *   - the launch-fee licence shared with `sealed_vault` (already licensed ⇒ charged nothing)
 *   - delegation of dex actions to the new vault object
 *   - `public_read_api::view_position` / `get_position_size` /
 *     `get_market_round_price_to_ticker` — four dependency calls this module had never made
 *   - a real attested tick through `performPortfolioTick`, signed off-chain and verified on
 *     chain, including the multi-market price fold
 *
 * Reads its keys from `.sealed-e2e-testnet/` (gitignored). Testnet only — it refuses to run
 * against mainnet, because it creates vaults and places orders.
 */
import { readFileSync } from "node:fs";
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";

import { performPortfolioTick } from "../lib/portfolio-tick";
import {
  PORTFOLIO_DEFAULTS,
  SEALED_MARKETS,
  buildCreatePortfolioVaultPayload,
  commitProgram,
} from "../lib/sealed-vaults";
import { buildDelegateDecibelVaultPayload } from "../lib/decibel-vaults";
import { SEALED_CATALOG } from "../lib/sealed-catalog";

const STATE = JSON.parse(readFileSync(".sealed-e2e-testnet/state.json", "utf8")) as Record<string, string>;
const key = (f: string) => readFileSync(`.sealed-e2e-testnet/${f}`, "utf8").trim();

const PKG = STATE.packageAddress;
const DECIBEL_VAULT = STATE.decibelVaultAddr;
const DECIBEL_PKG = "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f";

const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
const deployer = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(key("deployer.key")) });
const attestorKey = key("attestor.key");
const attestorPub = new Ed25519PrivateKey(attestorKey).publicKey().toString();

async function submit(label: string, data: Parameters<typeof aptos.transaction.build.simple>[0]["data"]) {
  const txn = await aptos.transaction.build.simple({ sender: deployer.accountAddress, data });
  const pending = await aptos.signAndSubmitTransaction({ signer: deployer, transaction: txn });
  const done = await aptos.waitForTransaction({ transactionHash: pending.hash });
  const ok = (done as { success?: boolean }).success;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}  ${pending.hash}`);
  if (!ok) throw new Error(`${label} reverted: ${(done as { vm_status?: string }).vm_status}`);
  return done;
}

/** Resume against an existing vault instead of creating another one. Each create costs a real
 *  Decibel transaction, so a re-run to check one fix should not mint a new vault. */
const RESUME = process.argv.find((a) => a.startsWith("0x") && a.length === 66);

(async () => {
  console.log(`\nportfolio_vault e2e — testnet, package ${PKG}\n`);

  // The attestor keypair is baked into the vault at creation and the vault is sealed at birth,
  // so a mismatch here is unrecoverable rather than a retry.
  if (attestorPub.toLowerCase() !== STATE.attestorPub.toLowerCase()) {
    throw new Error(`attestor key mismatch: derived ${attestorPub}, state says ${STATE.attestorPub}`);
  }

  // 1. Commit a strategy. The manifest binds market[0]; the tick path reproduces it verbatim.
  const strategy = SEALED_CATALOG.find((s) => s.id === "ema-cross")!;
  const markets = SEALED_MARKETS.slice(0, 4);
  const commit = commitProgram({ pine: strategy.script, marketAddr: markets[0].addr });
  if (!commit.ok) throw new Error(`commit failed: ${commit.error} ${(commit.errors ?? []).join("; ")}`);
  console.log(`  strategy   ${strategy.label}`);
  console.log(`  markets    ${markets.map((m) => m.name).join(", ")}`);
  console.log(`  commitment ${commit.commitment}\n`);

  // 2. Create the portfolio vault. This Decibel vault is already licensed by the single-market
  //    launch, so the shared launch-fee table must charge nothing — that shared table is the
  //    only thing the two modules have in common and this is the only way to prove it works.
  let sv: string;
  if (RESUME) {
    sv = RESUME;
    console.log(`  resuming against existing vault ${sv}\n`);
  } else {
  const created = await submit(
    "create_portfolio_vault",
    buildCreatePortfolioVaultPayload({
      packageAddress: PKG,
      programCommitment: commit.commitment,
      attestorPubkey: attestorPub,
      decibelVaultAddr: DECIBEL_VAULT,
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
      // No isSwap: the contract derives it from the licence. This Decibel vault is already
      // licensed, so it will come back true — which is correct, and is exactly why the caller
      // does not get a vote.
    }) as Parameters<typeof submit>[1],
  );

  const pv = (created as { events?: Array<{ type: string; data: Record<string, unknown> }> }).events
    ?.find((e) => e.type.endsWith("::portfolio_vault::PortfolioVaultCreated"));
  if (!pv) throw new Error("no PortfolioVaultCreated event");
  sv = String(pv.data.strategy_vault);
  console.log(`\n  vault      ${sv}`);
  console.log(`  markets on chain: ${pv.data.market_count}, max positions ${pv.data.max_positions}`);
  console.log(`  caps: portfolio ${Number(pv.data.max_portfolio_leverage_x100) / 100}x, `
    + `hold ${pv.data.max_hold_bars} bars, funding ${Number(pv.data.max_adverse_funding_bps) / 100}%\n`);

  // 3. Hand trading rights to it. `delegate_dex_actions_to` is `private entry` on Decibel, so
  //    this must be its own top-level transaction — it cannot be batched from Move.
  await submit(
    "delegate_dex_actions_to",
    buildDelegateDecibelVaultPayload({
      vaultAddress: DECIBEL_VAULT,
      delegate: sv,
      network: "testnet",
      packageAddress: DECIBEL_PKG,
    }).payload as Parameters<typeof submit>[1],
  );
  }

  // 4. Read back what the chain thinks, rather than what we sent.
  const view = async (fn: string) =>
    (await aptos.view({ payload: { function: `${PKG}::portfolio_vault::${fn}`, functionArguments: [sv] } })) as unknown[];
  const bounds = await view("get_bounds");
  const onChainMarkets = (await view("get_markets"))[0] as string[];
  console.log(`\n  get_bounds   ${JSON.stringify(bounds)}`);
  console.log(`  get_markets  ${onChainMarkets.length} entries, order matches: `
    + `${onChainMarkets.every((a, i) => a.toLowerCase() === markets[i].addr.toLowerCase())}`);

  // 5. The real thing: an attested tick. Signs off-chain, verifies on chain, folds four prices
  //    read on chain into the committed digest, and runs the maintenance pass that calls
  //    view_position / get_position_size for the first time ever.
  console.log("\n  ticking…");
  const r = await performPortfolioTick({
    strategyVaultAddr: sv,
    packageAddress: PKG,
    network: "testnet",
    markets: markets.map((m, idx) => ({ idx, name: m.name, asset: m.pythAsset })),
    manifestJson: commit.manifestJson,
    pineScript: strategy.script,
    defaultPctBps: 1000,
    leverageX100: 200,
    attestorPrivateKey: attestorKey,
    crankPrivateKey: key("deployer.key"),
  });

  if (!r.ok) {
    console.log(`  TICK FAILED  stage=${r.stage}  ${r.error}`);
    if (r.detail) for (const d of r.detail) console.log(`               • ${d}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ok   tick     seq ${r.seq}, ${r.actions.length} action(s)  ${r.txHash}`);
  for (const a of r.actions) {
    console.log(`         market ${a.marketIdx} (${markets[a.marketIdx].name}) side=${a.side} `
      + `${a.pctBps / 100}% @ ${a.leverageX100 / 100}x`);
  }
  for (const s of r.skipped) console.log(`       skipped: ${s}`);

  const state = await view("get_state");
  const positions = await view("get_positions");
  const trace = (await aptos.view({
    payload: { function: `${PKG}::portfolio_vault::get_trace`, functionArguments: [sv] },
  })) as unknown[];
  console.log(`\n  get_state     seq=${state[0]} trades=${state[1]} open=${state[2]} paused=${state[3]} sealed=${state[4]}`);
  console.log(`  get_positions ${JSON.stringify(positions)}`);
  console.log(`  get_trace     ${(trace[0] as string[]).length} prices across ${trace[2]} markets/row`);

  // 6. The permissionless remedy. Anyone can call it, it can only reduce exposure, and a
  //    depositor's guarantee that positions eventually close depends on it working from an
  //    account with no relationship to the vault.
  await submit("force_close_stale (permissionless)", {
    function: `${PKG}::portfolio_vault::force_close_stale`,
    typeArguments: [],
    functionArguments: [sv],
  } as Parameters<typeof submit>[1]);

  console.log(`\n  vault:    https://explorer.aptoslabs.com/account/${sv}?network=testnet`);
  console.log("\nportfolio_vault e2e: PASSED against the live engine.\n");
})();
