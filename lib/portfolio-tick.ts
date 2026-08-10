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
 * on-chain commitment, when the evaluator cannot run an operation, when a market has too little
 * history to warm the program up, or when the resulting action vector would violate a published
 * bound. A signature asserts the committed program produced these actions; signing anything
 * else for operational convenience is the only way to break the guarantee, so there is no
 * fallback path here that produces a "close enough" action.
 */
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";

import { fetchPythCandles } from "@/lib/launchpad/pyth";
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { canonicalizePine } from "@/lib/sealed-presets";
import { computeProgramCommitment, fromHex, toHex } from "@/lib/sealed-attestor";
import { createStrategyRunner } from "@/lib/strategy-equivalence";
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
  /** Market name, used to pick the price feed. */
  name: string;
  /** Pyth feed symbol, e.g. "BTC/USD". */
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

export async function performPortfolioTick(
  input: PortfolioTickInput,
): Promise<PortfolioTickResult> {
  const aptos = new Aptos(
    new AptosConfig({ network: input.network === "mainnet" ? Network.MAINNET : Network.TESTNET }),
  );

  // 1. Read the context FIRST. The attestation is signed against the digest the chain currently
  //    holds, never one we assume — a stale digest is simply an invalid signature.
  let seq: bigint;
  let inputDigest: string;
  let onChainCommitment: string;
  try {
    const ctx = (await aptos.view({
      payload: {
        function: `${input.packageAddress}::portfolio_vault::get_attestation_context`,
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

  // 2. Read the vault's published bounds rather than trusting the caller's copy. The contract
  //    will clamp anyway; reading them here means an over-sized action is caught before a
  //    signature and a transaction are spent on it, and the error names the field.
  let bounds: { marketCount: number; maxPctBps: number; maxLeverageX100: number; maxPositions: number };
  try {
    const b = (await aptos.view({
      payload: {
        function: `${input.packageAddress}::portfolio_vault::get_bounds`,
        functionArguments: [input.strategyVaultAddr],
      },
    })) as unknown[];
    bounds = {
      maxPctBps: Number(b[0]),
      maxLeverageX100: Number(b[1]),
      maxPositions: Number(b[3]),
      marketCount: Number(b[6]),
    };
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

  // 3. Refuse to sign for a program the vault did not commit to.
  const canonical = canonicalizePine(input.pineScript);
  // The commitment binds one market address (the manifest's), even though the vault trades
  // several. That is the manifest the creator committed; reproducing it is what proves the
  // source is unchanged, so it is passed through verbatim rather than re-derived per market.
  const manifestMarket = readManifestMarket(input.manifestJson);
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
  if (localCommitment.toLowerCase() !== onChainCommitment.toLowerCase()) {
    return {
      ok: false,
      stage: "commitment",
      error: `commitment mismatch — on-chain ${onChainCommitment}, local ${localCommitment}`,
      retryable: false,
    };
  }

  // 4. Read the vault's current legs, so an unchanged signal produces no action at all rather
  //    than an order the contract would ignore.
  let held = new Map<number, boolean>(); // market_idx → is_long
  try {
    const p = (await aptos.view({
      payload: {
        function: `${input.packageAddress}::portfolio_vault::get_positions`,
        functionArguments: [input.strategyVaultAddr],
      },
    })) as unknown[];
    // `get_positions` returns `vector<u8>` first, and the Aptos REST API serializes a
    // `vector<u8>` as a HEX STRING, not a JSON array — `["0x0002", [...]]`, not `[[0,2], ...]`.
    // Treating it as an array is a TypeError at runtime and is invisible to the type system,
    // to unit tests, and to the Move tests. It only appears against a live node.
    const idxs = decodeU8Vector(p[0]);
    const longs = p[1] as boolean[];
    held = new Map(idxs.map((idx, i) => [idx, Boolean(longs[i])]));
  } catch (err) {
    return {
      ok: false,
      stage: "read-positions",
      error: err instanceof Error ? err.message : "position read failed",
      retryable: true,
    };
  }

  // 5. Evaluate the committed program once per market, on that market's own history.
  const pctBps = Math.min(requestedPctBps(canonical) ?? input.defaultPctBps, bounds.maxPctBps);
  // The script's leverage if it declares one, the vault's otherwise — and clamped either way.
  // A script can always ask for LESS than the vault allows; it can never ask for more.
  const leverageX100 = Math.min(
    requestedLeverageX100(canonical) ?? input.leverageX100,
    bounds.maxLeverageX100,
  );
  const nowS = Math.floor(Date.now() / 1000);
  const actions: Action[] = [];
  const skipped: string[] = [];

  for (const market of input.markets) {
    // Checked AFTER the warmup loop, not here: `unsupported` is populated as ops execute, so
    // at this point it is always empty and the refusal never fired.
    const runner = createStrategyRunner(t.ir);

    let closes: number[];
    try {
      const candles = await fetchPythCandles(
        market.asset,
        "1",
        nowS - (runner.warmupBars + 80) * 120,
        nowS,
      );
      closes = candles.map((c) => c.close);
    } catch (err) {
      // One market's feed failing must not stop the others: the tick still commits a bar for
      // every market (prices are read on-chain), and skipping an ACTION is always safe —
      // it leaves the existing position alone rather than guessing.
      skipped.push(`${market.name}: price fetch failed (${err instanceof Error ? err.message : "unknown"})`);
      continue;
    }
    if (closes.length < runner.warmupBars + 2) {
      skipped.push(
        `${market.name}: ${closes.length} bars, need ${runner.warmupBars + 2} to warm up`,
      );
      continue;
    }

    let signal: "buy" | "sell" | "neutral" = "neutral";
    for (const c of closes) signal = runner.pushBar(c);
    if (runner.unsupported.size > 0) {
      return {
        ok: false,
        stage: "evaluate",
        error: "evaluator cannot run this program",
        detail: [...runner.unsupported],
        retryable: false,
      };
    }

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

  // 6. Sign and submit. An empty action vector is still submitted: the bar must be committed to
  //    the trace whether or not it produced a trade, and a skipped bar is publicly visible as a
  //    gap in `seq` — which is exactly the discretion the sequence exists to remove.
  const signature = signPortfolioAttestation(new Ed25519PrivateKey(input.attestorPrivateKey), {
    chainId: await aptos.getChainId(),
    strategyVault: input.strategyVaultAddr,
    programCommitment: fromHex(onChainCommitment),
    seq,
    inputDigest: fromHex(inputDigest),
    actions,
  });

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
      seq: seq.toString(),
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

/**
 * Decode a Move `vector<u8>` as returned by the Aptos REST API.
 *
 * The node hex-encodes byte vectors ("0x0002") rather than emitting a JSON array, which is
 * the same family of trap as the SDK encoding a JS string argument as its UTF-8 bytes. Both
 * directions of the `vector<u8>` boundary have now bitten this codebase, so both are handled
 * explicitly rather than by whatever the runtime happens to do. Accepts an array too, so a
 * future node or SDK change that starts returning one does not break this.
 */
function decodeU8Vector(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    const hex = v.replace(/^0x/i, "");
    const out: number[] = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }
  return [];
}

/** The market address the commitment's manifest was built over. */
function readManifestMarket(manifestJson: string): string {
  try {
    const m = JSON.parse(manifestJson) as { marketAddr?: unknown };
    return typeof m.marketAddr === "string" ? m.marketAddr : "0x1";
  } catch {
    return "0x1";
  }
}

/** True when a submit failure is just "this vault already ticked recently". */
export function isTooSoon(r: PortfolioTickResult): boolean {
  return !r.ok && r.stage === "submit" && r.retryable;
}
