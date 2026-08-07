/**
 * Does this strategy actually trade, through the evaluator the VAULT runs?
 *
 * ## Why this is a separate check from "does it transpile"
 *
 * Transpiling proves the source lowers to Move. It does not prove the emitted program does
 * anything. Three real strategies got all the way through the commit step and would have
 * produced a vault that silently did nothing, or did half of what it claimed:
 *
 *   - `ta.macd` once set the signal line EQUAL to the MACD line in both the codegen and the
 *     evaluator. A line cannot cross itself, so every MACD crossover was false on every bar.
 *   - `bb` had no case in the evaluator at all, so the bands were never set and every
 *     comparison against them was false — Bollinger's short leg was dead.
 *   - The IR lowers `a - b` to a u64 `safe_sub` that saturates at zero, so any strategy keyed
 *     on a difference going negative loses that entire side.
 *
 * Every one of those looked correct in the preview, which runs a different interpreter with
 * signed float arithmetic. A creator would have paid the launch fee for a bot that never
 * traded, and nothing anywhere would have said so.
 *
 * ## What it does
 *
 * Runs the committed-program executor over a deterministic price series designed to force
 * crossings in both directions, and reports which signals actually appear. The caller decides
 * what to do about it — the honest policy is to reject a script whose SOURCE declares both
 * directions but whose evaluator only ever produces one, because that is a claim the emitted
 * program does not keep.
 *
 * The series is synthetic and deterministic on purpose: this runs on an interactive commit,
 * so it cannot depend on a price feed being up, and two creators committing the same script
 * must get the same verdict.
 */
import { transpileV3 } from "@/lib/launchpad/transpiler-v3";
import { canonicalizePine } from "@/lib/sealed-presets";
import { createStrategyRunner } from "@/lib/strategy-equivalence";

export interface LivenessReport {
  /** Bars actually evaluated after warmup. */
  bars: number;
  buys: number;
  sells: number;
  /** IR ops the evaluator could not run. Non-empty means the verdict is unknown, not a pass. */
  unsupported: string[];
  /** Does the SOURCE ask for each side? Read from the script, not the IR. */
  declaresLong: boolean;
  declaresShort: boolean;
  /** Populated when the emitted program cannot keep a promise the source makes. */
  problems: string[];
}

/**
 * A price series with enough two-way movement that any ordinary crossover, band or threshold
 * strategy fires in both directions. Two incommensurable sine components plus a slow drift, so
 * it neither trends monotonically (which never produces a crossover event) nor oscillates so
 * regularly that a strategy could be tuned to it.
 */
export function livenessSeries(bars = 600): number[] {
  const out: number[] = [];
  let px = 60_000;
  for (let i = 0; i < bars; i++) {
    px *= 1 + Math.sin(i / 9) * 0.004 + Math.cos(i / 23) * 0.002 + Math.sin(i / 61) * 0.001;
    out.push(px);
  }
  return out;
}

export function checkLiveness(pineScript: string, marketAddr: string): LivenessReport {
  const canonical = canonicalizePine(pineScript);
  // Direction claims come from the SOURCE. Reading them from the IR would ask the emitted
  // program whether it does what the emitted program does, which is always yes.
  const declaresLong = /strategy\.long/.test(canonical);
  const declaresShort = /strategy\.short/.test(canonical);

  const t = transpileV3(canonical, undefined, { target: "vault", marketAddr });
  if (t.errors?.length) {
    return {
      bars: 0, buys: 0, sells: 0, unsupported: [], declaresLong, declaresShort,
      problems: t.errors,
    };
  }

  const runner = createStrategyRunner(t.ir);
  const closes = livenessSeries();
  let buys = 0;
  let sells = 0;
  for (const c of closes) {
    const sig = runner.pushBar(c);
    if (sig === "buy") buys++;
    if (sig === "sell") sells++;
  }
  const bars = Math.max(0, closes.length - runner.warmupBars);

  const problems: string[] = [];
  // An unrunnable op means the signal was derived from missing values. That is not a "maybe" —
  // it is a strategy the attestor must refuse, so it is reported as a problem rather than as
  // context.
  if (runner.unsupported.size > 0) {
    problems.push(
      `The on-chain evaluator cannot run: ${[...runner.unsupported].join(", ")}. A vault built `
      + `from this would trade on values it never computed.`,
    );
  }
  if (buys === 0 && sells === 0) {
    problems.push(
      "This script never produces a signal through the on-chain evaluator, on a price series "
      + "built to trigger both directions. A vault built from it would be created, charged, and "
      + "then never trade.",
    );
  } else {
    if (declaresLong && buys === 0) {
      problems.push(
        "The script calls strategy.entry(…, strategy.long) but the on-chain evaluator never "
        + "produces a buy. The long side would be silently dead.",
      );
    }
    if (declaresShort && sells === 0) {
      problems.push(
        "The script calls strategy.entry(…, strategy.short) but the on-chain evaluator never "
        + "produces a sell. The short side would be silently dead. A common cause is keying on "
        + "a subtraction going negative — the on-chain integer type saturates at zero, so "
        + "`a - b < 0` is never true. Compare the two series directly instead: `a < b`.",
      );
    }
  }

  return {
    bars,
    buys,
    sells,
    unsupported: [...runner.unsupported],
    declaresLong,
    declaresShort,
    problems,
  };
}
