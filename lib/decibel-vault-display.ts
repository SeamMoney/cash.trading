export interface VaultDisplayMetrics {
  tvl: number | null;
  volume: number | null;
  volume_30d?: number | null;
  all_time_pnl: number | null;
}

function compactNumber(value: number, divisor: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / divisor);
}

/**
 * Compact a vault USD value without ever dropping its magnitude suffix.
 * The old card divided thousands by 1,000 but rendered no `K`, making the
 * DLP's $312,980 PnL look like $313.
 */
export function formatVaultUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000_000) {
    return `${sign}$${compactNumber(absolute, 1_000_000_000)}B`;
  }
  if (absolute >= 1_000_000) {
    return `${sign}$${compactNumber(absolute, 1_000_000)}M`;
  }
  if (absolute >= 1_000) {
    return `${sign}$${compactNumber(absolute, 1_000)}K`;
  }

  return `${sign}$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: absolute < 10 ? 2 : 0,
  }).format(absolute)}`;
}

/** A listed vault must have real capital, activity, and realized history. */
export function hasMeaningfulVaultActivity(vault: VaultDisplayMetrics): boolean {
  const tradingActivity = vault.volume ?? vault.volume_30d ?? 0;
  return (
    Number.isFinite(vault.tvl) &&
    (vault.tvl ?? 0) > 0 &&
    Number.isFinite(tradingActivity) &&
    tradingActivity > 0 &&
    Number.isFinite(vault.all_time_pnl) &&
    Math.abs(vault.all_time_pnl ?? 0) > 0
  );
}
