/**
 * One attested tick for one sealed vault.
 *
 * Extracted so the manual endpoint (`/api/sealed/attest`) and the scheduled cron
 * (`/api/cron/sealed-tick`) run byte-identical logic. Two implementations of the signing path
 * is how a cron quietly starts signing something the endpoint would have refused.
 *
 * What this can do: compute one trit per bar from the committed program and sign it.
 * What it cannot do: choose the market, the size, the price, the direction of any resulting
 * order, or move funds. All of that is enforced on-chain — see docs/SEALED-INDICATOR.md §4.
 *
 * The refusals matter as much as the happy path. This will not sign when:
 *   - the supplied source does not reproduce the vault's on-chain commitment
 *   - the vault is not sealed
 *   - there is not enough price history to warm the program up
 * A signature is a claim that the committed program produced this signal. Signing anything
 * else, for any operational convenience, breaks the only guarantee the product makes.
 */
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";

import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { canonicalizePine } from "@/lib/sealed-presets";
import { fetchPythCandles } from "@/lib/launchpad/pyth";
import {
  buildTickAttestedPayload,
  computeProgramCommitment,
  fromHex,
  signAttestation,
  toHex,
  type Signal,
} from "@/lib/sealed-attestor";

const toTrit = (s: "buy" | "sell" | "neutral"): Signal => (s === "buy" ? 1 : s === "sell" ? 2 : 0);

export interface TickInput {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  marketAddr: string;
  /** Registry-held manifest — needed to reproduce the commitment the chain stores. */
  manifestJson: string;
  pineScript: string;
  /** Price feed symbol. Defaults to the vault's market name. */
  asset?: string;
  attestorPrivateKey: string;
  crankPrivateKey: string;
}

/** A fill the vault made, read out of the tick transaction we just submitted. */
export interface TickTrade {
  seq: number;
  isBuy: boolean;
  reduceOnly: boolean;
  size: number;
  /** 1e8-scaled trace price. */
  price: number;
  orderPx: number;
  timestamp: number;
}

export type TickResult =
  | { ok: true; seq: string; signal: Signal; txHash: string; trades: TickTrade[] }
  | { ok: false; stage: string; error: string; seq?: string; signal?: Signal; retryable: boolean };

export async function performTick(input: TickInput): Promise<TickResult> {
  const aptos = new Aptos(
    new AptosConfig({
      network: input.network === "mainnet" ? Network.MAINNET : Network.TESTNET,
    }),
  );

  // 1. Read the context FIRST. The attestation must be signed against the digest the chain
  //    currently holds, never one we assume — a stale digest is an invalid signature.
  let seq: bigint;
  let inputDigest: string;
  let onChainCommitment: string;
  try {
    const ctx = (await aptos.view({
      payload: {
        function: `${input.packageAddress}::sealed_vault::get_attestation_context`,
        functionArguments: [input.strategyVaultAddr],
      },
    })) as unknown[];
    onChainCommitment = String(ctx[0]);
    seq = BigInt(String(ctx[1]));
    inputDigest = String(ctx[2]);
  } catch (err) {
    return {
      ok: false,
      stage: "read-context",
      error: err instanceof Error ? err.message : "chain read failed",
      retryable: true,
    };
  }

  // 2. Refuse to sign for a program the vault did not commit to.
  const canonical = canonicalizePine(input.pineScript);
  const t = transpileV3(canonical, undefined, { target: "vault", marketAddr: input.marketAddr });
  if (t.errors?.length) {
    return {
      ok: false,
      stage: "transpile",
      error: `source does not transpile: ${t.errors.join("; ")}`,
      retryable: false,
    };
  }
  const localCommitment = toHex(
    computeProgramCommitment({
      canonicalPine: canonical,
      emittedMove: t.moveSource,
      manifestJson: input.manifestJson,
    }),
  );
  if (localCommitment.toLowerCase() !== onChainCommitment.toLowerCase()) {
    return {
      ok: false,
      stage: "commitment",
      error: `commitment mismatch — on-chain ${onChainCommitment}, local ${localCommitment}`,
      retryable: false,
    };
  }

  // 3. Warm the program on history, then take the latest bar.
  const runner = createStrategyRunner(t.ir);
  if (runner.unsupported.size > 0) {
    return {
      ok: false,
      stage: "evaluate",
      error: `evaluator cannot run: ${[...runner.unsupported].join(", ")}`,
      retryable: false,
    };
  }
  const nowS = Math.floor(Date.now() / 1000);
  let closes: number[] = [];
  try {
    const candles = await fetchPythCandles(
      input.asset ?? "BTC/USD",
      "1",
      nowS - (runner.warmupBars + 80) * 120,
      nowS,
    );
    closes = candles.map((c) => c.close);
  } catch (err) {
    return {
      ok: false,
      stage: "prices",
      error: err instanceof Error ? err.message : "price fetch failed",
      retryable: true,
    };
  }
  if (closes.length < runner.warmupBars + 2) {
    return {
      ok: false,
      stage: "prices",
      error: `insufficient price history (${closes.length} bars, need ${runner.warmupBars + 2})`,
      retryable: true,
    };
  }
  let signal: Signal = 0;
  for (const c of closes) signal = toTrit(runner.pushBar(c));

  // 4. Sign and submit. The cranker pays gas and contributes nothing else — it cannot alter
  //    the signal, and a wrong signature simply aborts.
  const signature = signAttestation(new Ed25519PrivateKey(input.attestorPrivateKey), {
    chainId: await aptos.getChainId(),
    strategyVault: input.strategyVaultAddr,
    programCommitment: fromHex(onChainCommitment),
    seq,
    inputDigest: fromHex(inputDigest),
    signal,
  });

  const cranker = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(input.crankPrivateKey),
  });
  try {
    const txn = await aptos.transaction.build.simple({
      sender: cranker.accountAddress,
      data: buildTickAttestedPayload({
        packageAddress: input.packageAddress,
        strategyVault: input.strategyVaultAddr,
        barTs: BigInt(nowS),
        signal,
        signature,
      }),
    });
    const res = await aptos.signAndSubmitTransaction({ signer: cranker, transaction: txn });
    const committed = await aptos.waitForTransaction({ transactionHash: res.hash });
    // Read the fills out of our own transaction. Aptos's hosted indexer removed its `events`
    // table entirely, so there is no way to query module events after the fact — but we are
    // the submitter, so the receipt is right here and is authoritative.
    const trades: TickTrade[] = [];
    for (const ev of (committed as { events?: Array<{ type: string; data: Record<string, string | boolean> }> }).events ?? []) {
      if (!ev.type.endsWith("::sealed_vault::VaultTraded")) continue;
      trades.push({
        seq: Number(ev.data.seq),
        isBuy: Boolean(ev.data.is_buy),
        reduceOnly: Boolean(ev.data.reduce_only),
        size: Number(ev.data.size),
        price: Number(ev.data.price),
        orderPx: Number(ev.data.order_px),
        timestamp: Number(ev.data.timestamp),
      });
    }
    return { ok: true, seq: seq.toString(), signal, txHash: res.hash, trades };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "submit failed";
    // E_BAR_TOO_SOON is the normal state of a vault ticked more often than its cadence allows,
    // not a fault — the cron must not count it as a failure or it would back off healthy vaults.
    const benign = /E_BAR_TOO_SOON|EBAR_TOO_SOON|,\s*11\)/.test(msg);
    return {
      ok: false,
      stage: "submit",
      error: msg,
      seq: seq.toString(),
      signal,
      retryable: benign,
    };
  }
}

/** True when a submit failure is just "this vault already ticked recently". */
export function isTooSoon(r: TickResult): boolean {
  return !r.ok && r.stage === "submit" && r.retryable;
}
