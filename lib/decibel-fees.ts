import type { DecibelTrade } from "@/lib/decibel-api";

export type DecibelFeeSummary = {
  fills: number;
  netFeesUsd: number;
  rebatesUsd: number;
  totalFeesPaidUsd: number;
};

export function summarizeDecibelFees(trades: DecibelTrade[]): DecibelFeeSummary {
  const unique = new Map<string, DecibelTrade>();
  for (const trade of trades) {
    const key = `${trade.transaction_version}:${trade.trade_id}:${trade.market}:${trade.action}`;
    unique.set(key, trade);
  }

  let totalFeesPaidUsd = 0;
  let rebatesUsd = 0;
  for (const trade of unique.values()) {
    const fee = Math.abs(Number(trade.fee_amount));
    if (!Number.isFinite(fee)) continue;
    if (trade.is_rebate) rebatesUsd += fee;
    else totalFeesPaidUsd += fee;
  }

  return {
    fills: unique.size,
    totalFeesPaidUsd,
    rebatesUsd,
    netFeesUsd: totalFeesPaidUsd - rebatesUsd,
  };
}
