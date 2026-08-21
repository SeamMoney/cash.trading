/**
 * Builder-code setup — creates the on-chain identity our builder code needs.
 *
 * What we learned from mainnet (all verified by simulation on 2026-08-12):
 *
 *   - The "builder address" a trader approves — and that orders carry — must be
 *     a Decibel SUBACCOUNT object, not a wallet. Approving a plain wallet
 *     address aborts with EBUILDER_SUBACCOUNT_NOT_FOUND, and orders that carry
 *     one abort with EBUILDER_NOT_REGISTERED. Working builders on mainnet
 *     (e.g. 0x8de28fda…) are Subaccount objects.
 *
 *   - `dex_accounts_entry::create_new_subaccount` is a permissionless entry
 *     function. No Decibel-side registration is required for the fee mechanism
 *     itself; program enrollment (the biweekly rewards) is separate.
 *
 * This script:
 *   1. derives the manager wallet from .cash-rewards/manager.key
 *   2. creates a new Decibel subaccount owned by it (fee-payer supported, so
 *      only ONE funded key is needed — the payer)
 *   3. prints the subaccount address to set as DECIBEL_BUILDER_ADDRESS
 *   4. proves the result by simulating a real trader approving it
 *
 * Prerequisite: EITHER the manager (0x69d3…) or the payer key holds ≥0.002 APT.
 * Payer resolution order: BOT_OPERATOR_PRIVATE_KEY, APTOS_PRIVATE_KEY.
 *
 * Usage:
 *   pnpm exec tsx scripts/builder-code-setup.ts          # simulate only
 *   pnpm exec tsx scripts/builder-code-setup.ts --submit # create it for real
 */
import { readFileSync } from "node:fs";
import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { DEFAULT_DECIBEL_BUILDER_FEE_BPS } from "../lib/decibel-builder-config";
import { builderFeeBpsToChainUnits } from "../lib/decibel";

const PKG =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";
const SUBMIT = process.argv.includes("--submit");

function loadKey(raw: string | undefined | null): Account | null {
  const cleaned = (raw ?? "")
    .replace("ed25519-priv-", "")
    .replace(/\\n/g, "")
    .trim();
  if (!cleaned) return null;
  try {
    return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(cleaned) });
  } catch {
    return null;
  }
}

async function main() {
  const apiKey = (process.env.GEOMI_API_KEY ?? "").trim();
  const aptos = new Aptos(
    new AptosConfig({
      network: Network.MAINNET,
      clientConfig: apiKey ? { API_KEY: apiKey } : undefined,
    }),
  );

  const manager = loadKey(readFileSync(".cash-rewards/manager.key", "utf8"));
  if (!manager) throw new Error("could not load .cash-rewards/manager.key");
  const managerAddr = manager.accountAddress.toString();
  console.log("manager (builder wallet):", managerAddr);

  // Gas: prefer the manager paying for itself; fall back to a fee payer.
  const managerApt = await aptos
    .getAccountAPTAmount({ accountAddress: manager.accountAddress })
    .catch(() => 0);
  let payer: Account | null = null;
  if (managerApt < 200_000) {
    for (const name of ["BOT_OPERATOR_PRIVATE_KEY", "APTOS_PRIVATE_KEY"]) {
      const candidate = loadKey(process.env[name]);
      if (!candidate) continue;
      const apt = await aptos
        .getAccountAPTAmount({ accountAddress: candidate.accountAddress })
        .catch(() => 0);
      console.log(
        `payer candidate ${name}:`,
        candidate.accountAddress.toString().slice(0, 14) + "…",
        "APT:",
        apt / 1e8,
      );
      if (apt >= 200_000) {
        payer = candidate;
        break;
      }
    }
    if (!payer) {
      console.error(
        "\nNo gas anywhere: fund the manager or a payer with ~0.01 APT and re-run.",
      );
      console.error(`  manager:  ${managerAddr}`);
      process.exit(1);
    }
  }

  const txn = await aptos.transaction.build.simple({
    sender: manager.accountAddress,
    withFeePayer: Boolean(payer),
    data: {
      function: `${PKG}::dex_accounts_entry::create_new_subaccount`,
      typeArguments: [],
      functionArguments: [],
    },
  });
  if (payer) txn.feePayerAddress = payer.accountAddress;

  const [sim] = await aptos.transaction.simulate.simple({
    signerPublicKey: manager.publicKey,
    ...(payer ? { feePayerPublicKey: payer.publicKey } : {}),
    transaction: txn,
  });
  console.log(
    "create_new_subaccount simulation:",
    sim.success ? "VM-ACCEPTED" : `ABORTED (${sim.vm_status})`,
  );
  if (!sim.success) process.exit(1);

  if (!SUBMIT) {
    console.log("\nDry run only. Re-run with --submit to create it.");
    return;
  }

  const managerAuth = aptos.transaction.sign({ signer: manager, transaction: txn });
  const submitted = payer
    ? await aptos.transaction.submit.simple({
        transaction: txn,
        senderAuthenticator: managerAuth,
        feePayerAuthenticator: aptos.transaction.signAsFeePayer({
          signer: payer,
          transaction: txn,
        }),
      })
    : await aptos.transaction.submit.simple({
        transaction: txn,
        senderAuthenticator: managerAuth,
      });
  const result = await aptos.waitForTransaction({ transactionHash: submitted.hash });
  if (!result.success) throw new Error(`tx failed: ${result.vm_status}`);
  console.log("tx:", submitted.hash);

  // The new Subaccount object address is in the write set.
  const changes = (result as { changes?: Array<{ data?: { type?: string }; address?: string }> }).changes ?? [];
  const created = changes.find(
    (c) => c.data?.type === `${PKG}::dex_accounts::Subaccount`,
  );
  const builderSubaccount = created?.address;
  if (!builderSubaccount) throw new Error("could not find new Subaccount in the write set");

  console.log("\n=== BUILDER SUBACCOUNT CREATED ===");
  console.log(builderSubaccount);
  console.log("\nSet this value in Vercel production AND .env:");
  console.log(`  DECIBEL_BUILDER_ADDRESS=${builderSubaccount}`);

  // Prove approvals now pass: simulate a real live trader approving it.
  // (Simulation does not check signatures, so no third-party key is needed.)
  const gql = await fetch("https://api.mainnet.aptoslabs.com/v1/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      query:
        'query { user_transactions(where: {entry_function_id_str: {_like: "%approve_max_builder_fee_for_subaccount"}}, order_by: {version: desc}, limit: 1) { version } }',
    }),
  }).then((r) => r.json() as Promise<{ data?: { user_transactions?: Array<{ version: number }> } }>);
  const version = gql.data?.user_transactions?.[0]?.version;
  if (!version) {
    console.log("(verification skipped: no recent approval tx found to borrow a trader from)");
    return;
  }
  const sample = (await aptos.getTransactionByVersion({
    ledgerVersion: BigInt(version),
  })) as { payload?: { arguments?: Array<{ inner?: string } | string> } };
  const subArg = sample.payload?.arguments?.[0];
  const traderSub = typeof subArg === "object" && subArg?.inner ? subArg.inner : (subArg as string);
  const core = (await aptos.getAccountResource({
    accountAddress: traderSub,
    resourceType: "0x1::object::ObjectCore",
  })) as { owner: string };
  const verifyTx = await aptos.transaction.build.simple({
    sender: core.owner,
    data: {
      function: `${PKG}::dex_accounts_entry::approve_max_builder_fee_for_subaccount`,
      typeArguments: [],
      functionArguments: [
        traderSub,
        builderSubaccount,
        builderFeeBpsToChainUnits(DEFAULT_DECIBEL_BUILDER_FEE_BPS),
      ],
    },
  });
  const [verify] = await aptos.transaction.simulate.simple({ transaction: verifyTx });
  console.log(
    `\nverification — live trader approving our builder at ${DEFAULT_DECIBEL_BUILDER_FEE_BPS} bp:`,
    verify.success ? "VM-ACCEPTED ✅" : `ABORTED (${verify.vm_status})`,
  );
}

main().catch((error) => {
  console.error("ERR:", error instanceof Error ? error.message : error);
  process.exit(1);
});
