// Launchpad — constants (inlined from packages/indicator-launchpad)

export const PYTH_BENCHMARKS_URL = "https://benchmarks.pyth.network";
export const PYTH_HERMES_URL = "https://hermes.pyth.network";

export const PYTH_FEED_IDS: Record<string, string> = {
  "BTC/USD": "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "ETH/USD": "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "SOL/USD": "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "APT/USD": "03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5",
};

export const CANDLE_RESOLUTIONS = ["1", "5", "15", "30", "60", "240", "D"] as const;
export const SUPPORTED_TA_FUNCTIONS = [
  "sma", "ema", "rsi", "macd",
  "crossover", "crossunder",
  "highest", "lowest", "atr",
  "bb", "supertrend",
] as const;

export const DEFAULT_MIN_SHARPE = 1500;     // 1.5 (scaled 1000x)
export const DEFAULT_MIN_PROFITABLE = 80;   // 80%
export const DEFAULT_MIN_SIMS = 10_000;
export const DEFAULT_MIN_ROBUSTNESS = 70;
