import { signTone } from "@/components/portfolio/portfolio-surface";
import { DECIBEL_TIER_LABELS, type DecibelTierName } from "@/lib/decibel-points";

const amps = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const signedAmps = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, signDisplay: "always" });

// Below $1,000 the cents carry the meaning: at 0 decimals a real −$0.49 loss
// rounds to "-$0" and then gets painted with the loss colour, which reads as
// "nothing happened, but red". Above $1,000 the cents are noise in a table.
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  signDisplay: "always",
});

export const formatAmps = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : amps.format(value);
export const formatSignedAmps = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : signedAmps.format(value);
/**
 * An amount that rounds to $0.00 has no direction, so it gets no sign and no
 * gain/loss colour: "+$0.00" in green claims a profit the number does not
 * contain, and "-$0.00" in red claims a loss.
 */
const roundsToZero = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && Math.abs(value) < 0.005;

export const formatPnl = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (roundsToZero(value)) return "$0.00";
  return (Math.abs(value) < 1000 ? usdCents : usdWhole).format(value);
};
export const pnlTone = (value: number | null | undefined) => signTone(roundsToZero(value) ? null : value);
export const formatRank = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value <= 0 ? "—" : `#${amps.format(value)}`;
export const tierLabel = (tier: DecibelTierName | null | undefined) => (tier ? DECIBEL_TIER_LABELS[tier] : "—");

/**
 * How old the profile on screen is. `/api/points/profile` sits behind a 120s
 * CDN cache, so a number here can legitimately be two minutes stale.
 */
export const formatAge = (fetchedAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};
