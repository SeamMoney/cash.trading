/**
 * One attested tick for one portfolio vault.
 *
 * ## How a single committed program drives many markets
 *
 * The program is committed once. It is then evaluated INDEPENDENTLY per market, each instance
 * fed only that market's own price history. Market 0's evaluator never sees market 1's prices,
 * so the strategy is genuinely the same rule applied to each book rather than a cross-market
 * model — and that is stated plainly rather than implied, because "trades every asset on
 * Decibel" could easily be read as the latter.
 *
 * That choice is deliberate. A cross-market model would need the program to name other symbols,
 * which means new PineScript syntax, which means the emitted Move and the commitment cover
 * constructs the on-chain evaluator cannot check. Per-market evaluation delivers multi-asset
 * and multi-position trading using the exact source the creator wrote and the exact evaluator
 * the single-market path already proves equivalent to the Move backend.
 *
 * ## Sizing and leverage
 *
 * A strategy sizes its own bets through `default_qty_type=strategy.percent_of_equity` plus
 * `default_qty_value`, and sets its own leverage through `margin_long` / `margin_short` —
 * both real TradingView parameters with exactly these meanings, so a script written for
 * TradingView carries them across unchanged. Absent either, the vault's configured value is
 * used. The contract clamps both to the caps frozen at creation, so a script can always ask
 * for LESS than the vault allows and never for more.
 *
 * ## What this refuses to do
 *
 * The refusals are the product. It will not sign when the source does not reproduce the
 * on-chain commitment, when the evaluator cannot run an operation, when the committed trace is
 * malformed or changes during evaluation, or when the resulting action vector would violate a
 * published bound. A signature asserts the committed program produced these actions; signing
 * anything else for operational convenience is the only way to break the guarantee, so there
 * is no fallback path here that produces a "close enough" action.
 */
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";

import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { canonicalizePine } from "@/lib/sealed-presets";
import {
  computeProgramCommitment,
  fromHex,
  parseMoveBytes32Hex,
  toHex,
} from "@/lib/sealed-attestor";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
import { parseMoveU64, parsePortfolioCommittedTrace } from "@/lib/committed-price-trace";
import {
  normalizePortfolioAddress,
  parsePortfolioBounds,
  parsePortfolioMarketAddresses,
  parsePortfolioPositions,
  type PortfolioBounds,
  type PortfolioPositionSnapshot,
} from "@/lib/portfolio-chain-state";
import {
  SIDE_CLOSE,
  SIDE_LONG,
  SIDE_SHORT,
  actionsToEntryArgs,
  signPortfolioAttestation,
  validateActions,
  type Action,
} from "@/lib/portfolio-attestor";
import { requestedLeverageX100, requestedPctBps } from "@/lib/pine-declarations";
import {
  extractDecibelBuilderFills,
  type DecibelBuilderFillReceipt,
} from "@/lib/decibel-builder-receipt";

// Re-exported so the attestor, the backtester and the launch UI all read the same two
// functions. Three implementations of "what did the script ask for" is how a preview starts
// disagreeing with what the vault actually does.
export { requestedLeverageX100, requestedPctBps };

export interface PortfolioMarket {
  /** Position in the vault's frozen allowlist. Must match the on-chain order exactly. */
  idx: number;
  /** Human-readable market name for diagnostics. */
  name: string;
  /** Exact Decibel market object address at this frozen index. */
  address: string;
  /** @deprecated Registry compatibility only; ticks evaluate the committed on-chain trace. */
  asset: string;
}

export interface PortfolioTickInput {
  strategyVaultAddr: string;
  packageAddress: string;
  network: string;
  markets: PortfolioMarket[];
  /** Registry-held manifest — needed to reproduce the commitment the chain stores. */
  manifestJson: string;
  pineScript: string;
  /** Default share of NAV per leg, in bps, when the script does not size itself. */
  defaultPctBps: number;
  /** Leverage per leg, ×100. */
  leverageX100: number;
  /** Exact Decibel account whose fills this vault owns. Counterparty events are ignored. */
  expectedDecibelSubaccount?: string;
  attestorPrivateKey: string;
  crankPrivateKey: string;
}

export type PortfolioTickResult =
  | {
      ok: true;
      seq: string;
      actions: Action[];
      txHash: string;
      skipped: string[];
      builderFills: DecibelBuilderFillReceipt[];
    }
  | { ok: false; stage: string; error: string; detail?: string[]; retryable: boolean };

interface PortfolioAttestationContext {
  commitment: string;
  seq: bigint;
  inputDigest: string;
}

async function readPortfolioContext(
  aptos: Aptos,
  input: Pick<PortfolioTickInput, "packageAddress" | "strategyVaultAddr">,
): Promise<PortfolioAttestationContext> {
  const ctx = (await aptos.view({
    payload: {
      function: `${input.packageAddress}::portfolio_vault::get_attestation_context`,
      functionArguments: [input.strategyVaultAddr],
    },
  })) as unknown[];
  if (!Array.isArray(ctx) || ctx.length < 3) {
    throw new Error("portfolio attestation context returned an invalid tuple");
  }
  return {
    commitment: parseMoveBytes32Hex(ctx[0], "portfolio program commitment"),
    seq: parseMoveU64(ctx[1], "portfolio sequence"),
    inputDigest: parseMoveBytes32Hex(ctx[2], "portfolio input digest"),
  };
}

async function readPortfolioPositions(
  aptos: Aptos,
  input: Pick<PortfolioTickInput, "packageAddress" | "strategyVaultAddr">,
  bounds: PortfolioBounds,
  seq: bigint,
): Promise<PortfolioPositionSnapshot> {
  const positions = await aptos.view({
    payload: {
      function: `${input.packageAddress}::portfolio_vault::get_positions`,
      functionArguments: [input.strategyVaultAddr],
    },
  });
  return parsePortfolioPositions(positions, { ...bounds, seq });
}

export async function performPortfolioTick(
  input: PortfolioTickInput,
): Promise<PortfolioTickResult> {
  const aptos = new Aptos(
    new AptosConfig({ network: input.network === "mainnet" ? Network.MAINNET : Network.TESTNET }),
  );

  // 1. Read the context FIRST. The attestation is signed against the digest the chain currently
  //    holds, never one we assume — a stale digest is simply an invalid signature.
  let snapshot: PortfolioAttestationContext;
  try {
    snapshot = await readPortfolioContext(aptos, input);
  } catch (err) {
    return {
      ok: false,
      stage: "read-context",
      error: err instanceof Error ? err.message : "chain read failed",
      retryable: true,
    };
  }

  // 2. Read the vault's published bounds rather than trusting the caller's copy. The contract
  //    will clamp anyway; reading them here means an over-sized action is caught before a
  //    signature and a transaction are spent on it, and the error names the field.
  let bounds: PortfolioBounds;
  try {
    const b = (await aptos.view({
      payload: {
        function: `${input.packageAddress}::portfolio_vault::get_bounds`,
        functionArguments: [input.strategyVaultAddr],
      },
    })) as unknown[];
    bounds = parsePortfolioBounds(b);
  } catch (err) {
    return {
      ok: false,
      stage: "read-bounds",
      error: err instanceof Error ? err.message : "bounds read failed",
      retryable: true,
    };
  }

  if (bounds.marketCount !== input.markets.length) {
    // The allowlist is frozen at creation and action indices address it positionally. A local
    // list of a different length means the indices mean something else on chain than here —
    // the one mistake that would place real orders on the wrong book.
    return {
      ok: false,
      stage: "markets",
      error:
        `market list disagrees with the chain: vault has ${bounds.marketCount}, `
        + `caller supplied ${input.markets.length}. Action indices address the on-chain `
        + `allowlist positionally, so a mismatch would trade the wrong markets.`,
      retryable: false,
    };
  }
  const misplacedMarket = input.markets.findIndex((market, index) => market.idx !== index);
  if (misplacedMarket >= 0) {
    return {
      ok: false,
      stage: "markets",
      error:
        `market ${misplacedMarket} declares index ${input.markets[misplacedMarket].idx}; `
        + "portfolio action indices must exactly match the frozen allowlist order",
      retryable: false,
    };
  }
  let onChainMarkets: string[];
  try {
    onChainMarkets = parsePortfolioMarketAddresses(
      await aptos.view({
        payload: {
          function: `${input.packageAddress}::portfolio_vault::get_markets`,
          functionArguments: [input.strategyVaultAddr],
        },
      }),
    );
  } catch (err) {
    return {
      ok: false,
      stage: "read-markets",
      error: err instanceof Error ? err.message : "market allowlist read failed",
      retryable: true,
    };
  }
  if (onChainMarkets.length !== input.markets.length) {
    return {
      ok: false,
      stage: "markets",
      error:
        `vault returned ${onChainMarkets.length} market addresses for `
        + `${input.markets.length} configured markets`,
      retryable: false,
    };
  }
  for (let index = 0; index < onChainMarkets.length; index++) {
    let configured: string;
    try {
      configured = normalizePortfolioAddress(
        input.markets[index].address,
        `configured market ${index}`,
      );
    } catch (err) {
      return {
        ok: false,
        stage: "markets",
        error: err instanceof Error ? err.message : "configured market address is invalid",
        retryable: false,
      };
    }
    if (onChainMarkets[index] !== configured) {
      return {
        ok: false,
        stage: "markets",
        error: `market ${index} is ${onChainMarkets[index]} on chain but ${configured} in the registry`,
        retryable: false,
      };
    }
  }

  // 3. Refuse to sign for a program the vault did not commit to.
  const canonical = canonicalizePine(input.pineScript);
  // The commitment binds one market address (the manifest's), even though the vault trades
  // several. That is the manifest the creator committed; reproducing it is what proves the
  // source is unchanged, so it is passed through verbatim rather than re-derived per market.
  let manifestMarket: string;
  try {
    manifestMarket = parseManifestMarketAddress(input.manifestJson);
  } catch (err) {
    return {
      ok: false,
      stage: "manifest",
      error: err instanceof Error ? err.message : "program manifest is invalid",
      retryable: false,
    };
  }
  const t = transpileV3(canonical, undefined, { target: "vault", marketAddr: manifestMarket });
  if (t.errors?.length) {
    return {
      ok: false,
      stage: "transpile",
      error: "source does not transpile",
      detail: t.errors,
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

  // 4. Read the vault's current legs, so an unchanged signal produces no action at all rather
  //    than an order the contract would ignore.
  let positions: PortfolioPositionSnapshot;
  try {
    positions = await readPortfolioPositions(aptos, input, bounds, snapshot.seq);
  } catch (err) {
    return {
      ok: false,
      stage: "read-positions",
      error: err instanceof Error ? err.message : "position read failed",
      retryable: true,
    };
  }
  const held = positions.held; // market_idx → is_long

  // 5. Read and evaluate the exact flattened history the contract has committed. The next
  //    action vector is computed from rows THROUGH THE PREVIOUS accepted tick; the contract
  //    reads and appends the new prices only after it verifies this signature.
  const pctBps = Math.min(requestedPctBps(canonical) ?? input.defaultPctBps, bounds.maxPctBps);
  // The script's leverage if it declares one, the vault's otherwise — and clamped either way.
  // A script can always ask for LESS than the vault allows; it can never ask for more.
  const leverageX100 = Math.min(
    requestedLeverageX100(canonical) ?? input.leverageX100,
    bounds.maxLeverageX100,
  );
  const actions: Action[] = [];
  const skipped: string[] = [];
  const supportProbe = createStrategyRunner(t.ir);
  if (supportProbe.unsupported.size > 0) {
    return {
      ok: false,
      stage: "evaluate",
      error: "evaluator cannot run this program",
      detail: [...supportProbe.unsupported],
      retryable: false,
    };
  }

  let closesByMarket: number[][];
  try {
    const trace = await aptos.view({
      payload: {
        function: `${input.packageAddress}::portfolio_vault::get_trace`,
        functionArguments: [input.strategyVaultAddr],
      },
    });
    closesByMarket = parsePortfolioCommittedTrace(
      trace,
      snapshot.seq,
      input.markets.length,
    ).closesByMarket;
  } catch (err) {
    return {
      ok: false,
      stage: "read-trace",
      error: err instanceof Error ? err.message : "committed portfolio trace read failed",
      retryable: true,
    };
  }

  for (const market of input.markets) {
    const runner = createStrategyRunner(t.ir);

    let signal: "buy" | "sell" | "neutral" = "neutral";
    for (const close of closesByMarket[market.idx]) signal = runner.pushBar(close);

    const have = held.get(market.idx);
    if (signal === "neutral") continue; // no instruction is how a strategy says "leave it"
    const wantLong = signal === "buy";
    if (have === wantLong) continue; // already positioned this way

    actions.push({
      marketIdx: market.idx,
      side: wantLong ? SIDE_LONG : SIDE_SHORT,
      pctBps,
      leverageX100,
    });
  }

  // Respect the position limit here as well as on chain. The contract skips the overflow legs
  // with an event, but choosing WHICH legs to drop belongs to the caller — dropping the tail
  // silently on chain would make the choice arbitrary and invisible.
  const openAfter = new Set(held.keys());
  for (const a of actions) if (a.side === SIDE_CLOSE) openAfter.delete(a.marketIdx);
  const opens = actions.filter((a) => a.side !== SIDE_CLOSE && !held.has(a.marketIdx));
  const room = bounds.maxPositions - openAfter.size;
  if (opens.length > room) {
    const dropped = opens.slice(Math.max(0, room));
    for (const d of dropped) {
      const m = input.markets.find((x) => x.idx === d.marketIdx);
      skipped.push(`${m?.name ?? `market ${d.marketIdx}`}: at the ${bounds.maxPositions}-position limit`);
    }
    for (const d of dropped) {
      const at = actions.indexOf(d);
      if (at >= 0) actions.splice(at, 1);
    }
  }

  const problems = validateActions(actions, bounds);
  if (problems.length > 0) {
    return { ok: false, stage: "validate", error: "action vector violates the vault's bounds", detail: problems, retryable: false };
  }

  // Context and trace are separate view calls. Do not sign if another cranker advanced the
  // digest between them. A race after this check still fails safely on-chain as a stale
  // sequence/digest rather than executing the wrong action vector.
  let stable: PortfolioAttestationContext;
  let stablePositions: PortfolioPositionSnapshot;
  try {
    stable = await readPortfolioContext(aptos, input);
    stablePositions = await readPortfolioPositions(aptos, input, bounds, stable.seq);
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
    || stablePositions.fingerprint !== positions.fingerprint
  ) {
    return {
      ok: false,
      stage: "state-changed",
      error: "vault state or positions changed while its committed trace was being evaluated; retrying is safe",
      retryable: true,
    };
  }

  // 6. Sign and submit. An empty action vector is still submitted: the bar must be committed to
  //    the trace whether or not it produced a trade, and a skipped bar is publicly visible as a
  //    gap in `seq` — which is exactly the discretion the sequence exists to remove.
  const signature = signPortfolioAttestation(new Ed25519PrivateKey(input.attestorPrivateKey), {
    chainId: await aptos.getChainId(),
    strategyVault: input.strategyVaultAddr,
    programCommitment: fromHex(snapshot.commitment),
    seq: snapshot.seq,
    inputDigest: fromHex(snapshot.inputDigest),
    actions,
  });

  const nowS = Math.floor(Date.now() / 1000);
  const args = actionsToEntryArgs(actions);
  const cranker = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(input.crankPrivateKey),
  });
  try {
    const txn = await aptos.transaction.build.simple({
      sender: cranker.accountAddress,
      data: {
        function: `${input.packageAddress}::portfolio_vault::tick_attested`,
        typeArguments: [],
        functionArguments: [
          input.strategyVaultAddr,
          String(nowS),
          args.marketIdxs,
          args.sides,
          args.pctBpsList,
          args.leverageList,
          Array.from(signature),
        ],
      },
    });
    const res = await aptos.signAndSubmitTransaction({ signer: cranker, transaction: txn });
    const committed = await aptos.waitForTransaction({ transactionHash: res.hash });
    const builderFills = extractDecibelBuilderFills({
      transaction: committed,
      network: input.network === "mainnet" ? "mainnet" : "testnet",
      expectedAccount: input.expectedDecibelSubaccount,
    });
    return {
      ok: true,
      seq: snapshot.seq.toString(),
      actions,
      txHash: res.hash,
      skipped,
      builderFills,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "submit failed";
    // E_BAR_TOO_SOON is the normal state of a vault ticked more often than its cadence allows,
    // not a fault — a cron must not count it as a failure or it would back off healthy vaults.
    const benign = /E_BAR_TOO_SOON|EBAR_TOO_SOON|,\s*11\)/.test(msg);
    return { ok: false, stage: "submit", error: msg, retryable: benign };
  }
}

/** The market address the commitment's manifest was built over. */
export function parseManifestMarketAddress(manifestJson: string): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (err) {
    throw new Error(
      `program manifest is not valid JSON: ${err instanceof Error ? err.message : "parse failed"}`,
    );
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("program manifest must be a JSON object");
  }
  const marketAddr = (manifest as { marketAddr?: unknown }).marketAddr;
  if (typeof marketAddr !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(marketAddr.trim())) {
    throw new Error("program manifest must contain a valid Aptos marketAddr");
  }
  return marketAddr.trim();
}

/** True when a submit failure is just "this vault already ticked recently". */
export function isTooSoon(r: PortfolioTickResult): boolean {
  return !r.ok && r.stage === "submit" && r.retryable;
}
