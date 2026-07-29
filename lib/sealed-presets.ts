/**
 * Shared sealed-vault preset strategies.
 *
 * These MUST be defined in exactly one place. The program commitment is a hash
 * of the Pine source, so if the launcher and the attestor disagree by even one
 * character they compute different commitments — and the attestor then refuses
 * to sign against the on-chain hash (which is the correct behaviour, but an
 * infuriating way to discover a copy-paste divergence).
 */
export const SEALED_PRESETS: Record<string, string> = {
  ema: `//@version=5
strategy("EMA Cross 9/21", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
if (ta.crossover(fast, slow))
    strategy.entry("Long", strategy.long)
if (ta.crossunder(fast, slow))
    strategy.entry("Short", strategy.short)
`,
  rsi: `//@version=5
strategy("RSI Mean Reversion", overlay=true)
rsiLen = input.int(14, "RSI Length")
r = ta.rsi(close, rsiLen)
if (r < 30)
    strategy.entry("Long", strategy.long)
if (r > 70)
    strategy.entry("Short", strategy.short)
`,
};

export const SEALED_PRESET_NAMES = Object.keys(SEALED_PRESETS);

/** Canonicalise before hashing: normalise line endings and trailing whitespace
 *  so a strategy pasted from a different OS commits to the same hash. */
export function canonicalizePine(src: string): string {
  return src.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd() + "\n";
}

/** The manifest bound into the commitment alongside the Pine and emitted Move.
 *  Pins everything that changes emission, so the hash is reproducible. */
export function buildManifest(args: {
  transpilerVersion: string;
  moduleName: string;
  marketAddr: string;
}): string {
  // Key order is fixed — JSON.stringify preserves insertion order, and the
  // manifest is hashed verbatim.
  return JSON.stringify({
    transpiler: args.transpilerVersion,
    module: args.moduleName,
    marketAddr: args.marketAddr,
  });
}
