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
 *   - the committed trace is malformed or changes while the signal is evaluated
 *   - the evaluator cannot execute every operation in the committed program
 * A signature is a claim that the committed program produced this signal. Signing anything
 * else, for any operational convenience, breaks the only guarantee the product makes.
 */
import { Account, Aptos, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { canonicalizePine } from "@/lib/sealed-presets";
import { parseMoveU64, parseSingleCommittedTrace } from "@/lib/committed-price-trace";
import {
  extractDecibelBuilderFills,
  type DecibelBuilderFillReceipt,
} from "@/lib/decibel-builder-receipt";
import {
  buildTickAttestedPayload,
  computeProgramCommitment,
  fromHex,
  parseMoveBytes32Hex,
  signAttestation,
  toHex,
  type Signal,
} from "@/lib/sealed-attestor";
import {
  assertAutomatedVaultBuilderCompatible,
  AutomatedVaultBuilderCompatibilityError,
  createAuthenticatedAptosForNetwork,
} from "@/lib/automated-vault-builder";

const toTrit = (s: "buy" | "sell" | "neutral"): Signal => (s === "buy" ? 1 : s === "sell" ? 2 : 0);

export interface TickInput {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  marketAddr: string;
  /** Registry-held manifest — needed to reproduce the commitment the chain stores. */
  manifestJson: string;
  pineScript: string;
  /** @deprecated Retained in the request shape for older registry rows; ticks use chain trace. */
  asset?: string;
  /** Exact Decibel account whose fills this vault owns. Counterparty events are ignored. */
  expectedDecibelSubaccount?: string;
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
  | {
      ok: true;
      seq: string;
      signal: Signal;
      txHash: string;
      trades: TickTrade[];
      builderFills: DecibelBuilderFillReceipt[];
    }
  | { ok: false; stage: string; error: string; seq?: string; signal?: Signal; retryable: boolean };

interface SingleAttestationContext {
  commitment: string;
  seq: bigint;
  inputDigest: string;
  lastBarTs: bigint;
}

async function readSingleContext(
  aptos: Aptos,
  input: Pick<TickInput, "packageAddress" | "strategyVaultAddr">,
): Promise<SingleAttestationContext> {
  const ctx = (await aptos.view({
    payload: {
      function: `${input.packageAddress}::sealed_vault::get_attestation_context`,
      functionArguments: [input.strategyVaultAddr],
    },
  })) as unknown[];
  if (!Array.isArray(ctx) || ctx.length < 5) {
    throw new Error("sealed attestation context returned an invalid tuple");
  }
  return {
    commitment: parseMoveBytes32Hex(ctx[0], "sealed program commitment"),
    seq: parseMoveU64(ctx[1], "sealed sequence"),
    inputDigest: parseMoveBytes32Hex(ctx[2], "sealed input digest"),
    lastBarTs: parseMoveU64(ctx[4], "sealed last-bar timestamp"),
  };
}

/**
 * Confirm the attestor private key matches the public key vaults commit to.
 *
 * `create_sealed_vault` bakes the public key in and the vault is sealed at birth, so a
 * mismatched pair is unrecoverable: every `tick_attested` aborts with E_INVALID_SIGNATURE
 * forever and the only remedy is relaunching the vault. Nothing else in the stack compares
 * them — a launch with a swapped pair succeeds, takes the creator's money, and produces a vault
 * that can never trade. Checked here so it surfaces as one clear error instead of an on-chain
 * abort code per vault.
 */
export function attestorKeyMismatch(privateKeyRaw: string, expectedPublicKey?: string): string | null {
  if (!expectedPublicKey) return null;
  let derived: string;
  try {
    derived = new Ed25519PrivateKey(privateKeyRaw).publicKey().toString();
  } catch (err) {
    return `SEALED_ATTESTOR_PRIVATE_KEY is not a valid ed25519 key: ${
      err instanceof Error ? err.message : "unparseable"
    }`;
  }
  const want = expectedPublicKey.trim().toLowerCase();
  const got = derived.toLowerCase();
  if (want.replace(/^0x/, "") !== got.replace(/^0x/, "")) {
    return (
      `attestor keypair mismatch: SEALED_ATTESTOR_PRIVATE_KEY derives ${derived}, but ` +
      `SEALED_ATTESTOR_PUBLIC_KEY is ${expectedPublicKey}. Vaults commit to the PUBLIC key at ` +
      `creation and are sealed at birth, so signing with the wrong key can never be corrected.`
    );
  }
  return null;
}

export async function performTick(input: TickInput): Promise<TickResult> {
  const network = input.network === "mainnet" ? "mainnet" : "testnet";
  const aptos = createAuthenticatedAptosForNetwork(network);

  // 1. Read the context FIRST. The attestation must be signed against the digest the chain
  //    currently holds, never one we assume — a stale digest is an invalid signature.
  let snapshot: SingleAttestationContext;
  try {
    snapshot = await readSingleContext(aptos, input);
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
  if (localCommitment.toLowerCase() !== snapshot.commitment.toLowerCase()) {
    return {
      ok: false,
      stage: "commitment",
      error: `commitment mismatch — on-chain ${snapshot.commitment}, local ${localCommitment}`,
      retryable: false,
    };
  }

  // 3. Replay exactly the history the contract has committed. The next signature is computed
  //    from the series THROUGH THE PREVIOUS accepted bar; `tick_attested` reads and appends the
  //    new price only after verifying it. A separate price feed is not equivalent to this trace.
  const runner = createStrategyRunner(t.ir);
  if (runner.unsupported.size > 0) {
    return {
      ok: false,
      stage: "evaluate",
      error: `evaluator cannot run: ${[...runner.unsupported].join(", ")}`,
      retryable: false,
    };
  }

  let closes: number[];
  try {
    const trace = await aptos.view({
      payload: {
        function: `${input.packageAddress}::sealed_vault::get_trace`,
        functionArguments: [input.strategyVaultAddr],
      },
    });
    closes = parseSingleCommittedTrace(trace, snapshot.seq, snapshot.lastBarTs).closes;
  } catch (err) {
    return {
      ok: false,
      stage: "read-trace",
      error: err instanceof Error ? err.message : "committed trace read failed",
      retryable: true,
    };
  }

  let signal: Signal = 0;
  for (const c of closes) signal = toTrit(runner.pushBar(c));

  // Context and trace are separate view calls. Re-read the signed context after evaluation so
  // a concurrent cranker cannot advance the vault between them and leave us signing a signal
  // computed from one snapshot against another. A race after this check still aborts safely on
  // chain because the signed sequence and digest are stale.
  let stable: SingleAttestationContext;
  try {
    stable = await readSingleContext(aptos, input);
  } catch (err) {
    return {
      ok: false,
      stage: "read-context",
      error: err instanceof Error ? err.message : "chain re-read failed",
      retryable: true,
    };
  }
  if (
    stable.seq !== snapshot.seq
    || stable.inputDigest.toLowerCase() !== snapshot.inputDigest.toLowerCase()
    || stable.commitment.toLowerCase() !== snapshot.commitment.toLowerCase()
    || stable.lastBarTs !== snapshot.lastBarTs
  ) {
    return {
      ok: false,
      stage: "state-changed",
      error: "vault state changed while its committed trace was being evaluated; retrying is safe",
      seq: snapshot.seq.toString(),
      signal,
      retryable: true,
    };
  }

  // A neutral bar only extends the committed trace. A directional bar reaches Decibel's order
  // engine, so older positive-fee packages must prove approval on the vault's ACTUAL trading
  // subaccount before we spend a signature or gas. New packages freeze this fee at zero.
  if (signal !== 0) {
    try {
      await assertAutomatedVaultBuilderCompatible({
        aptos,
        network,
        packageAddress: input.packageAddress,
        strategyVaultAddress: input.strategyVaultAddr,
        moduleName: "sealed_vault",
        expectedDecibelSubaccount: input.expectedDecibelSubaccount,
      });
    } catch (err) {
      return {
        ok: false,
        stage: "builder-preflight",
        error: err instanceof Error ? err.message : "builder compatibility read failed",
        seq: snapshot.seq.toString(),
        signal,
        retryable: !(err instanceof AutomatedVaultBuilderCompatibilityError),
      };
    }
  }

  // 4. Sign and submit. The cranker pays gas and contributes nothing else — it cannot alter
  //    the signal, and a wrong signature simply aborts.
  const nowS = Math.floor(Date.now() / 1000);
  const barTs = BigInt(nowS);
  const signature = signAttestation(new Ed25519PrivateKey(input.attestorPrivateKey), {
    chainId: await aptos.getChainId(),
    strategyVault: input.strategyVaultAddr,
    programCommitment: fromHex(snapshot.commitment),
    seq: snapshot.seq,
    inputDigest: fromHex(snapshot.inputDigest),
    barTs,
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
        barTs,
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
    const builderFills = extractDecibelBuilderFills({
      transaction: committed,
      network: input.network === "mainnet" ? "mainnet" : "testnet",
      expectedAccount: input.expectedDecibelSubaccount,
    });
    return {
      ok: true,
      seq: snapshot.seq.toString(),
      signal,
      txHash: res.hash,
      trades,
      builderFills,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "submit failed";
    // E_BAR_TOO_SOON is the normal state of a vault ticked more often than its cadence allows,
    // not a fault — the cron must not count it as a failure or it would back off healthy vaults.
    const benign = /E_BAR_TOO_SOON|EBAR_TOO_SOON/.test(msg);
    return {
      ok: false,
      stage: "submit",
      error: msg,
      seq: snapshot.seq.toString(),
      signal,
      retryable: benign,
    };
  }
}

/** True when a submit failure is just "this vault already ticked recently". */
export function isTooSoon(r: TickResult): boolean {
  return !r.ok && r.stage === "submit" && r.retryable;
}
