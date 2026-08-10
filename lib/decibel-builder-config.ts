/**
 * cash.trading's builder-code economics.
 *
 * Keep the default in one browser-safe module so ordinary orders, automated
 * strategies, backtests, and deployment tooling cannot silently quote
 * different fees.
 */
export const DEFAULT_DECIBEL_BUILDER_FEE_BPS = 1;
export const MAX_DECIBEL_BUILDER_FEE_BPS = 10;
export const DEFAULT_DECIBEL_BUILDER_FEE_RATE =
  DEFAULT_DECIBEL_BUILDER_FEE_BPS / 10_000;
