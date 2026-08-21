import { DECIBEL_TIER_LABELS, type DecibelTierName } from "@/lib/decibel-points";

const amps = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const signedAmps = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, signDisplay: "always" });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  signDisplay: "always",
});

export const formatAmps = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : amps.format(value);
export const formatSignedAmps = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : signedAmps.format(value);
export const formatPnl = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : usd.format(value);
export const formatRank = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value <= 0 ? "—" : `#${amps.format(value)}`;
export const tierLabel = (tier: DecibelTierName | null | undefined) => (tier ? DECIBEL_TIER_LABELS[tier] : "—");
export const pnlTone = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value === 0
    ? "text-zinc-300"
    : value > 0
      ? "text-green-400"
      : "text-[#e8774f]";
