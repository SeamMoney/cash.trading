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
  script: string;
}

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
    id: "macd",
    label: "MACD Momentum",
    blurb: "Long when MACD crosses above its signal line, short when it crosses below.",
    category: "Momentum",
    direction: "Long/short",
    turnover: "Medium",
    draws: "MACD, signal line and histogram in their own pane",
    script:
      head("MACD Momentum") +
      `[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)\n` +
      `plot(macdLine, title="MACD", color=${q(C.upper)}, linewidth=2)\n` +
      `plot(signalLine, title="Signal", color=${q(C.signal)}, linewidth=2)\n` +
      `plot(hist, title="Histogram", color=${q(C.mid)}, style=plot.style_histogram)\n` +
      `hline(0, title="Zero", color=${q(C.mid)})\n` +
      `if (ta.crossover(macdLine, signalLine))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(macdLine, signalLine))\n    strategy.entry("Short", strategy.short)\n`,
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
