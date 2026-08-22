/**
 * The strategy catalog offered in the launch dropdown.
 *
 * Only strategies that actually transpile belong here — offering one that the
 * commit step will reject is a dead end the user can't debug. The transpiler
 * rejects anything needing OHLC or volume (the on-chain trace is one mark price
 * per bar), so the honest catalog is close-only strategies.
 *
 * ## Every entry draws
 *
 * A PineScript that computes an EMA but never calls `plot()` renders as a bare
 * candle chart, which is what these scripts used to do — the preview looked
 * broken because there was genuinely nothing to draw. Every entry now plots the
 * series it trades on, so what you see on the chart IS the thing making the
 * decision. `pnpm test:catalog` fails an entry with no `plot(`.
 *
 * Visual calls are inert to the trading semantics: the parser routes them to a
 * `visual` statement, the transpiler ignores them when emitting Move, and the
 * evaluator that produces the attested signal never reads them. So adding a plot
 * cannot change what a vault trades — it only changes what you can see.
 *
 * `pnpm test:catalog` proves every entry commits successfully.
 */
export interface CatalogStrategy {
  id: string;
  label: string;
  /**
   * One line a non-quant understands — and one that matches the code.
   *
   * Every entry here is long/short: the scripts all call `strategy.entry(…, strategy.short)`.
   * The blurbs used to describe only the long leg ("goes long when the fast average crosses
   * above the slow one"), which understated the risk of a product people commit capital to.
   * `pnpm test:catalog` fails if a blurb claims a direction the script does not take.
   */
  blurb: string;
  /** What the strategy family is, in one word a trader recognises. */
  category: "Trend following" | "Mean reversion" | "Momentum" | "Breakout";
  /** Which sides it takes. Derived from the script and asserted by the catalog selftest. */
  direction: "Long only" | "Short only" | "Long/short";
  /** Roughly how often it flips, at the default 1-minute cadence. */
  turnover: "Low" | "Medium" | "High";
  /**
   * What the script draws, in the creator's words. Shown under the chart so the
   * lines have names — an unlabelled blue line is decoration, a labelled one is
   * information.
   */
  draws: string;
  /**
   * True when the script sets its own position size and leverage via `default_qty_*` /
   * `margin_long` / `margin_short`. Asserted against the source by `pnpm test:catalog`, so
   * this cannot claim a capability the script does not have.
   */
  selfSizing?: boolean;
  /** Original community script when this is a credited, materially adapted strategy. */
  source?: { label: string; url: string };
  script: string;
}

/**
 * The `turnover` grade in words, and the only place it is put into words.
 *
 * "High turnover" is desk jargon for "it flips sides a lot", which is the part
 * that costs a depositor fees — so say that instead. Both surfaces that show the
 * grade (the launch flow's strategy list and /automation's runner) read this map,
 * so one datum cannot speak two dialects. No number is claimed: the catalog only
 * grades it.
 */
export const FLIP_RATE: Record<string, string> = {
  Low: "changes side rarely",
  Medium: "changes side sometimes",
  High: "changes side often",
};

const head = (name: string) => `//@version=5\nstrategy("${name}", overlay=true)\n`;

/** Chart palette, kept in one place so no two strategies fight over the same hue. */
const C = {
  fast: "#39ff14",
  slow: "#7c8496",
  upper: "#4da3ff",
  lower: "#ff6b6b",
  mid: "#7c8496",
  signal: "#ffb020",
} as const;

export const SEALED_CATALOG: CatalogStrategy[] = [
  {
    id: "swing-consensus",
    label: "Swing Consensus",
    blurb: "Eight trend, momentum, and breakout votes; long or short on a five-vote consensus.",
    category: "Momentum",
    direction: "Long/short",
    turnover: "Medium",
    draws: "three EMAs, Bollinger bands, and the rolling breakout channel",
    source: {
      label: "Optimized4U's open-source Swing Trade Strategy",
      url: "https://www.tradingview.com/script/tE6a5fXq-Swing-Trade-Strategy/",
    },
    script: `//@version=5
// Swing Consensus — verified cash.trading adaptation
// Inspired by Optimized4U's open-source Swing Trade Strategy:
// https://www.tradingview.com/script/tE6a5fXq-Swing-Trade-Strategy/
// Original and adaptation licensed under MPL-2.0.
//
// The community strategy combines ten indicators. This adaptation keeps its
// weighted-consensus design while using the close-series inputs a sealed vault
// can replay exactly from its public on-chain trace.
strategy("Swing Consensus", overlay=true)

// ── Regime and momentum ──────────────────────────────────────────────
fast = ta.ema(close, 9)
slow = ta.ema(close, 21)
trend = ta.ema(close, 55)
rsiValue = ta.rsi(close, 14)
[macdLine, signalLine, histogram] = ta.macd(close, 12, 26, 9)

// ── Volatility and breakout structure ───────────────────────────────
[basis, upper, lower] = ta.bb(close, 20, 2)
channelHigh = ta.highest(close, 20)
channelLow = ta.lowest(close, 20)
mean = ta.sma(close, 50)

// ── Eight independently readable votes ──────────────────────────────
emaBull = fast > slow
emaBear = fast < slow
regimeBull = close > trend
regimeBear = close < trend
rsiBull = rsiValue > 55
rsiBear = rsiValue < 45
macdBull = macdLine > signalLine
macdBear = macdLine < signalLine
bandBull = close > basis
bandBear = close < basis
breakoutBull = close >= channelHigh
breakoutBear = close <= channelLow
slopeBull = fast > fast[1]
slopeBear = fast < fast[1]
meanBull = close > mean
meanBear = close < mean

bullScore = (emaBull ? 1 : 0) + (regimeBull ? 1 : 0) + (rsiBull ? 1 : 0) + (macdBull ? 1 : 0) + (bandBull ? 1 : 0) + (breakoutBull ? 1 : 0) + (slopeBull ? 1 : 0) + (meanBull ? 1 : 0)
bearScore = (emaBear ? 1 : 0) + (regimeBear ? 1 : 0) + (rsiBear ? 1 : 0) + (macdBear ? 1 : 0) + (bandBear ? 1 : 0) + (breakoutBear ? 1 : 0) + (slopeBear ? 1 : 0) + (meanBear ? 1 : 0)

// Require broad agreement. The sealed vault itself deduplicates a repeated side,
// so a persistent consensus cannot submit the same position twice.
longConsensus = bullScore >= 5 and bearScore <= 2
shortConsensus = bearScore >= 5 and bullScore <= 2

if longConsensus
    strategy.entry("Long", strategy.long)
if shortConsensus
    strategy.entry("Short", strategy.short)

// ── What the depositor sees is what the strategy reads ───────────────
plot(fast, title="EMA 9", color=${q(C.fast)}, linewidth=2)
plot(slow, title="EMA 21", color=${q(C.upper)}, linewidth=1)
plot(trend, title="EMA 55", color=${q(C.slow)}, linewidth=2)
u = plot(upper, title="Upper Band", color=${q(C.upper)}, linewidth=1)
l = plot(lower, title="Lower Band", color=${q(C.lower)}, linewidth=1)
fill(u, l, title="Volatility Channel", color=${q("#4da3ff16")})
plot(channelHigh, title="20-bar High", color=${q(C.signal)}, linewidth=1)
plot(channelLow, title="20-bar Low", color=${q(C.lower)}, linewidth=1)
`,
  },
  {
    id: "ema-cross",
    label: "EMA Cross (9/21)",
    blurb: "Long when EMA 9 crosses above EMA 21, short when it crosses below.",
    category: "Trend following",
    direction: "Long/short",
    turnover: "Medium",
    draws: "EMA 9 and EMA 21 over price",
    script:
      head("EMA Cross 9/21") +
      `fastLen = input.int(9, "Fast")\n` +
      `slowLen = input.int(21, "Slow")\n` +
      `fast = ta.ema(close, fastLen)\n` +
      `slow = ta.ema(close, slowLen)\n` +
      `plot(fast, title="EMA 9", color=${q(C.fast)}, linewidth=2)\n` +
      `plot(slow, title="EMA 21", color=${q(C.slow)}, linewidth=2)\n` +
      `if (ta.crossover(fast, slow))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow))\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "rsi-reversion",
    label: "RSI Mean Reversion",
    blurb: "Long under RSI 30, short over RSI 70. Fights trends; best in ranging markets.",
    category: "Mean reversion",
    direction: "Long/short",
    turnover: "High",
    draws: "RSI in its own pane with the 30/70 bands",
    script:
      head("RSI Mean Reversion") +
      `rsiLen = input.int(14, "RSI Length")\n` +
      `r = ta.rsi(close, rsiLen)\n` +
      `plot(r, title="RSI", color=${q(C.upper)}, linewidth=2)\n` +
      `hline(70, title="Overbought", color=${q(C.lower)})\n` +
      `hline(30, title="Oversold", color=${q(C.fast)})\n` +
      `hline(50, title="Midline", color=${q(C.mid)})\n` +
      `if (r < 30)\n    strategy.entry("Long", strategy.long)\n` +
      `if (r > 70)\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "bollinger-breakout",
    label: "Bollinger Breakout",
    blurb: "Long above the upper Bollinger band, short below the lower, with trend agreement.",
    category: "Breakout",
    direction: "Long/short",
    turnover: "Low",
    draws: "Bollinger bands with a shaded channel, plus both EMAs",
    script:
      head("Bollinger Breakout") +
      `len = input.int(20, "Length")\n` +
      `fast = ta.ema(close, 9)\n` +
      `slow = ta.ema(close, 21)\n` +
      `[mid, upper, lower] = ta.bb(close, len, 2)\n` +
      `u = plot(upper, title="Upper Band", color=${q(C.upper)}, linewidth=1)\n` +
      `l = plot(lower, title="Lower Band", color=${q(C.lower)}, linewidth=1)\n` +
      `plot(mid, title="Basis", color=${q(C.mid)}, linewidth=1)\n` +
      `fill(u, l, title="Bollinger Channel", color=${q("#4da3ff22")})\n` +
      `plot(fast, title="EMA 9", color=${q(C.fast)}, linewidth=2)\n` +
      `plot(slow, title="EMA 21", color=${q(C.slow)}, linewidth=1)\n` +
      `if (ta.crossover(fast, slow) and close > upper)\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow) and close < lower)\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "sma-trend",
    label: "SMA Trend (50/200)",
    blurb: "Golden/death cross. Long on 50 over 200, short on 50 under 200. Flips rarely.",
    category: "Trend following",
    direction: "Long/short",
    turnover: "Low",
    draws: "SMA 50 and SMA 200 over price",
    script:
      head("SMA Trend 50/200") +
      `fast = ta.sma(close, 50)\n` +
      `slow = ta.sma(close, 200)\n` +
      `plot(fast, title="SMA 50", color=${q(C.fast)}, linewidth=2)\n` +
      `plot(slow, title="SMA 200", color=${q(C.slow)}, linewidth=2)\n` +
      `if (ta.crossover(fast, slow))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow))\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "multi-asset-momentum",
    label: "Multi-Asset Momentum",
    blurb: "Long above the 50-bar mean with rising momentum, short below it. Sizes itself.",
    category: "Momentum",
    direction: "Long/short",
    turnover: "Medium",
    draws: "the 50-bar mean with the 10/30 EMA pair over price",
    selfSizing: true,
    // The only catalog entry that declares its OWN size and leverage, using the real
    // TradingView parameters for both: 20% of equity per position at 50% margin (2x). Built
    // for portfolio mode — select several markets and it runs on each, so the per-position
    // size is what keeps four legs inside the vault's aggregate exposure cap.
    script:
      `//@version=5\n`
      + `strategy("Multi-Asset Momentum", overlay=true, `
      + `default_qty_type=strategy.percent_of_equity, default_qty_value=20, `
      + `margin_long=50, margin_short=50)\n`
      + `len = input.int(50, "Mean Length")\n`
      + `mean = ta.sma(close, len)\n`
      // Momentum as an EMA spread rather than ta.roc: the transpiler has no on-chain form for
      // roc, and each TA call has to land on its own line to be lowered.
      + `fastM = ta.ema(close, 10)\n`
      + `slowM = ta.ema(close, 30)\n`
      + `plot(mean, title="Mean 50", color=${q(C.slow)}, linewidth=2)\n`
      + `plot(fastM, title="EMA 10", color=${q(C.fast)}, linewidth=2)\n`
      + `plot(slowM, title="EMA 30", color=${q(C.upper)}, linewidth=1)\n`
      // Momentum as a COMPARISON of the two averages, never as their difference.
      // `fastM - slowM` lowers to a u64 safe_sub that saturates at zero, so `< 0` can
      // never be true and the short leg would be silently dead on-chain. `pnpm
      // test:catalog` now runs the vault's own evaluator and fails exactly this.
      + `if (close > mean and fastM > slowM)\n    strategy.entry("Long", strategy.long)\n`
      + `if (close < mean and fastM < slowM)\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "breakout-channel",
    label: "Donchian Breakout",
    blurb: "Long at a 20-bar high, short at a 20-bar low, with trend agreement.",
    category: "Breakout",
    direction: "Long/short",
    turnover: "Medium",
    draws: "Donchian high/low channel, shaded, with both EMAs",
    script:
      head("Donchian Breakout") +
      `len = input.int(20, "Lookback")\n` +
      `hi = ta.highest(close, len)\n` +
      `lo = ta.lowest(close, len)\n` +
      `fast = ta.ema(close, 9)\n` +
      `slow = ta.ema(close, 21)\n` +
      `h = plot(hi, title="20-bar High", color=${q(C.upper)}, linewidth=1)\n` +
      `w = plot(lo, title="20-bar Low", color=${q(C.lower)}, linewidth=1)\n` +
      `fill(h, w, title="Donchian Channel", color=${q("#4da3ff18")})\n` +
      `plot(fast, title="EMA 9", color=${q(C.fast)}, linewidth=2)\n` +
      `plot(slow, title="EMA 21", color=${q(C.slow)}, linewidth=1)\n` +
      `if (ta.crossover(fast, slow) and close >= hi)\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow) and close <= lo)\n    strategy.entry("Short", strategy.short)\n`,
  },
];

/** Pine string literal. Kept a function so the colour constants read as colours above. */
function q(s: string): string {
  return `"${s}"`;
}

export function findCatalogStrategy(id: string): CatalogStrategy | null {
  return SEALED_CATALOG.find((s) => s.id === id) ?? null;
}
