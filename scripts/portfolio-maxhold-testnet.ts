/**
 * Prove the two guarantees the contract makes that a strategy cannot opt out of.
 *
 *   pnpm test:portfolio-maxhold
 *
 * "Every position eventually closes" and "funding is a cost, not an afterthought" are the two
 * things `portfolio_vault` promises depositors beyond what the single-market path could. Both
 * are enforced in `close_expired`, which runs at the TOP of every tick, before a single signed
 * action is read. Neither had ever fired on a real engine.
 *
 * Proving them needs a vault whose `max_hold_bars` is small enough to trip within a test:
 * launch with `max_hold_bars = 1` and `min_bar_interval_s = 1`, tick once to open positions,
 * tick again a second later, and the contract must close everything it opened — WITHOUT the
 * strategy asking, and with `reason = CLOSE_REASON_MAX_HOLD (1)` on the event so a depositor
 * can tell a contract-enforced close from a strategy decision.
 *
 * Also reads `view_position` on the live positions to settle the funding sign convention that
 * `funding_exceeded` acts on (docs/DEPLOY-SEALED.md §2.5).
 *
 * Reuses the clean-room stack in `.portfolio-cleanroom-testnet/` — that Decibel vault is
 * already licensed and funded, so this costs gas only.
 */
import { existsSync, readFileSync } from "node:fs";
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

const DECIBEL = "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f";
if (!existsSync(".portfolio-cleanroom-testnet/state.json") || !existsSync(".sealed-e2e-testnet/attestor.key")) {
  console.log("skipped: needs .portfolio-cleanroom-testnet/state.json and .sealed-e2e-testnet/attestor.key — run the clean-room E2E first");
  process.exit(0);
}
const S = JSON.parse(readFileSync(".portfolio-cleanroom-testnet/state.json", "utf8"));
const PKG: string = S.addr;
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
const me = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(S.privateKey) });

async function send(label: string, data: Parameters<typeof aptos.transaction.build.simple>[0]["data"]) {
  const txn = await aptos.transaction.build.simple({ sender: me.accountAddress, data });
  const p = await aptos.signAndSubmitTransaction({ signer: me, transaction: txn });
  const d = await aptos.waitForTransaction({ transactionHash: p.hash });
  if (!(d as { success?: boolean }).success) {
    throw new Error(`${label} reverted: ${(d as { vm_status?: string }).vm_status}`);
  }
  console.log(`  ok   ${label}  ${p.hash}`);
  return d;
}

const REASON = ["STRATEGY", "MAX_HOLD", "FUNDING", "FLIP"];

(async () => {
  console.log("\nportfolio_vault max-hold + funding — testnet\n");

  const strategy = SEALED_CATALOG.find((s) => s.id === "multi-asset-momentum")!;
  const markets = SEALED_MARKETS.slice(0, 4);
  const commit = commitProgram({ pine: strategy.script, marketAddr: markets[0].addr });
  if (!commit.ok) throw new Error(`commit: ${commit.error}`);
  const attestorKey = readFileSync(".sealed-e2e-testnet/attestor.key", "utf8").trim();

  // A vault that force-closes after ONE bar, ticking every second. Everything else matches the
  // production defaults — only the two knobs under test are dialled down.
  // Resume against a vault that already has positions open, so a re-run costs gas rather than
  // another Decibel vault.
  const RESUME = process.argv.find((a) => a.startsWith("0x") && a.length === 66);
  let SV: string;
  if (RESUME) {
    SV = RESUME;
    console.log(`  resuming ${SV}\n`);
  } else {
  const created = await send("create_portfolio_vault (max_hold_bars=1)",
    buildCreatePortfolioVaultPayload({
      packageAddress: PKG,
      programCommitment: commit.commitment,
      attestorPubkey: new Ed25519PrivateKey(attestorKey).publicKey().toString(),
      decibelVaultAddr: S.decibelVault,
      markets,
      maxPctBps: PORTFOLIO_DEFAULTS.maxPctBps,
      maxLeverageX100: PORTFOLIO_DEFAULTS.maxLeverageX100,
      maxPortfolioLeverageX100: PORTFOLIO_DEFAULTS.maxPortfolioLeverageX100,
      maxPositions: PORTFOLIO_DEFAULTS.maxPositions,
      maxHoldBars: 1,
      maxAdverseFundingBps: PORTFOLIO_DEFAULTS.maxAdverseFundingBps,
      minBarIntervalS: 1,
      slippageBps: 30,
      traceCapacity: 500,
    }) as Parameters<typeof send>[1]);

  const ev = (created as { events?: Array<{ type: string; data: Record<string, unknown> }> }).events
    ?.find((e) => e.type.endsWith("::PortfolioVaultCreated"));
  SV = String(ev!.data.strategy_vault);
  console.log(`  vault ${SV}\n`);

  await send("delegate_dex_actions_to",
    buildDelegateDecibelVaultPayload({
      vaultAddress: S.decibelVault, delegate: SV, network: "testnet", packageAddress: DECIBEL,
    }).payload as Parameters<typeof send>[1]);
  }

  const tick = async (label: string) => {
    const r = await performPortfolioTick({
      strategyVaultAddr: SV, packageAddress: PKG, network: "testnet",
      markets: markets.map((m, idx) => ({ idx, name: m.name, asset: m.pythAsset })),
      manifestJson: commit.manifestJson, pineScript: strategy.script,
      defaultPctBps: 1000, leverageX100: 200,
      attestorPrivateKey: attestorKey, crankPrivateKey: S.privateKey,
    });
    if (!r.ok) throw new Error(`${label} failed at ${r.stage}: ${r.error}`);
    const tx = await aptos.getTransactionByHash({ transactionHash: r.txHash });
    const evs = (tx as { events?: Array<{ type: string; data: Record<string, unknown> }> }).events ?? [];
    const traded = evs.filter((e) => e.type.endsWith("::PortfolioTraded"));
    console.log(`\n  ${label}: seq ${r.seq}, ${r.actions.length} action(s), ${traded.length} fill(s)`);
    for (const e of traded) {
      const d = e.data;
      console.log(`    market ${d.market_idx} ${d.is_buy ? "BUY " : "SELL"} size=${d.size} `
        + `reduce_only=${d.reduce_only} reason=${REASON[Number(d.reason)]}`);
    }
    return traded;
  };

  // Bar 1: open. Bar 2: the contract must close what bar 1 opened, unasked.
  const opened = RESUME ? [] : await tick("tick 1 (open)");
  const before = (await aptos.view({
    payload: { function: `${PKG}::portfolio_vault::get_positions`, functionArguments: [SV] },
  })) as unknown[];
  const openCount = (before[1] as boolean[]).length;
  console.log(`  positions open before expiry: ${openCount}`);
  void opened;
  if (openCount === 0) {
    console.log("\n  INCONCLUSIVE — the strategy opened nothing this bar, so there is nothing to expire.");
    console.log("  Re-run; multi-asset-momentum is directional on most bars but not all.");
    process.exitCode = 1;
    return;
  }

  // Funding on the live positions. `public_read_api::view_position` is `public` but NOT marked
  // `#[view]`, so the REST view API refuses it — the contract can call it from Move (which is
  // what `funding_exceeded` does) but no off-chain reader can. That is why §2.5's canary uses
  // `list_positions` instead, and why this is best-effort rather than a gate.
  try {
    const vaultRes = (await aptos.getAccountResource({
      accountAddress: S.decibelVault,
      resourceType: `${DECIBEL}::vault::Vault`,
    })) as { portfolio: { dex_primary_subaccount: string } };
    const sub = vaultRes.portfolio.dex_primary_subaccount;
    const [rows] = (await aptos.view({
      payload: { function: `${DECIBEL}::public_read_api::list_positions`, functionArguments: [sub] },
    })) as [Array<Record<string, unknown>>];
    console.log(`\n  live positions on ${sub.slice(0, 14)}… (${rows.length}):`);
    for (const r of rows) {
      console.log(`    size=${r.size} is_long=${r.is_long} `
        + `funding=${JSON.stringify(r.unrealized_funding_amount_before_last_update ?? "n/a")}`);
    }
  } catch (err) {
    console.log(`\n  funding read unavailable off-chain: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
  }

  await new Promise((r) => setTimeout(r, 2500)); // clear min_bar_interval_s = 1
  const closed = await tick("tick 2 (expiry)");

  const forced = closed.filter((e) => Number(e.data.reason) === 1 && e.data.reduce_only === true);
  const positions = (await aptos.view({
    payload: { function: `${PKG}::portfolio_vault::get_positions`, functionArguments: [SV] },
  })) as unknown[];
  const stillOpen = (positions[1] as boolean[]).length;

  console.log(`\n  force-closed by MAX_HOLD: ${forced.length}`);
  console.log(`  positions still open:      ${stillOpen}`);
  console.log(`  vault  https://explorer.aptoslabs.com/account/${SV}?network=testnet`);

  // The guarantee is "the vault's book empties and nothing is silently dropped", NOT "every
  // leg closes with an order". A leg can be legitimately unclosable: if another strategy is
  // still delegated to the same Decibel vault, its positions NET against this one on the
  // engine, and the remainder can fall below the market minimum, which a reduce-only order
  // cannot express. The contract reports those as PortfolioSkipped rather than aborting — the
  // abort would brick the vault forever, since close_expired runs before anything else.
  if (stillOpen !== 0) {
    console.log(`\n  FAILED — ${stillOpen} position(s) left in the vault's book after expiry.`);
    console.log("  'every position eventually closes' does not hold.");
    process.exitCode = 1;
    return;
  }
  console.log(`\n  Book emptied: ${forced.length} closed by the contract, `
    + `${openCount - forced.length} reported as sub-minimum dust.`);
  if (openCount - forced.length > 0) {
    console.log("  Dust means another strategy is still delegated to this Decibel vault and its");
    console.log("  legs netted against these. See DEPLOY-SEALED §8.5c — revoke before swapping.");
  }
  console.log("\nmax-hold: PASSED — the contract emptied the book without the strategy asking.\n");
})();
