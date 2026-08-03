/**
 * The strategy catalog offered in the launch dropdown.
 *
 * Only strategies that actually transpile belong here — offering one that the
 * commit step will reject is a dead end the user can't debug. The transpiler
 * rejects anything needing OHLC or volume (the on-chain trace is one mark price
 * per bar), so the honest catalog is close-only strategies.
 *
 * `pnpm test:catalog` proves every entry commits successfully.
 */
export interface CatalogStrategy {
  id: string;
  label: string;
  /** One line a non-quant understands. Shown under the dropdown. */
  blurb: string;
  script: string;
}

const head = (name: string) => `//@version=5\nstrategy("${name}", overlay=true)\n`;

export const SEALED_CATALOG: CatalogStrategy[] = [
  {
    id: "ema-cross",
    label: "EMA Cross (9/21)",
    blurb: "Trend following. Goes long when the fast average crosses above the slow one.",
    script:
      head("EMA Cross 9/21") +
      `fastLen = input.int(9, "Fast")\n` +
      `slowLen = input.int(21, "Slow")\n` +
      `fast = ta.ema(close, fastLen)\n` +
      `slow = ta.ema(close, slowLen)\n` +
      `if (ta.crossover(fast, slow))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow))\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "rsi-reversion",
    label: "RSI Mean Reversion",
    blurb: "Buys oversold, sells overbought. Works best in ranging markets.",
    script:
      head("RSI Mean Reversion") +
      `rsiLen = input.int(14, "RSI Length")\n` +
      `r = ta.rsi(close, rsiLen)\n` +
      `if (r < 30)\n    strategy.entry("Long", strategy.long)\n` +
      `if (r > 70)\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "macd",
    label: "MACD Momentum",
    blurb: "Follows momentum shifts using the MACD signal-line crossover.",
    script:
      head("MACD Momentum") +
      `[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)\n` +
      `if (ta.crossover(macdLine, signalLine))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(macdLine, signalLine))\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "bollinger-breakout",
    label: "Bollinger Breakout",
    blurb: "Trades expansion out of a volatility squeeze, confirmed by trend.",
    script:
      head("Bollinger Breakout") +
      `len = input.int(20, "Length")\n` +
      `fast = ta.ema(close, 9)\n` +
      `slow = ta.ema(close, 21)\n` +
      `[mid, upper, lower] = ta.bb(close, len, 2)\n` +
      `if (ta.crossover(fast, slow) and close > upper)\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow) and close < lower)\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "sma-trend",
    label: "SMA Trend (50/200)",
    blurb: "Classic golden/death cross. Slow, low-turnover trend capture.",
    script:
      head("SMA Trend 50/200") +
      `fast = ta.sma(close, 50)\n` +
      `slow = ta.sma(close, 200)\n` +
      `if (ta.crossover(fast, slow))\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow))\n    strategy.entry("Short", strategy.short)\n`,
  },
  {
    id: "breakout-channel",
    label: "Donchian Breakout",
    blurb: "Buys new highs, sells new lows over a rolling window.",
    script:
      head("Donchian Breakout") +
      `len = input.int(20, "Lookback")\n` +
      `hi = ta.highest(close, len)\n` +
      `lo = ta.lowest(close, len)\n` +
      `fast = ta.ema(close, 9)\n` +
      `slow = ta.ema(close, 21)\n` +
      `if (ta.crossover(fast, slow) and close >= hi)\n    strategy.entry("Long", strategy.long)\n` +
      `if (ta.crossunder(fast, slow) and close <= lo)\n    strategy.entry("Short", strategy.short)\n`,
  },
];

export function findCatalogStrategy(id: string): CatalogStrategy | null {
  return SEALED_CATALOG.find((s) => s.id === id) ?? null;
}
