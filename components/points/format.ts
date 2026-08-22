import { useEffect, useState } from "react";
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
 * Exactly zero means nothing has been realized yet, so it renders as the
 * page's "nothing here" em-dash rather than as an unsigned, uncoloured
 * "$0.00" — the one value in the column that carried no direction while every
 * row around it was signed. Anything non-zero keeps its sign even when the
 * cents round away, so a −$0.004 loss reads as a loss instead of hiding
 * inside the rounding.
 */
export const formatPnl = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value) || value === 0) return "—";
  return (Math.abs(value) < 1000 ? usdCents : usdWhole).format(value);
};
export const pnlTone = (value: number | null | undefined) => signTone(value === 0 ? null : value);
export const formatRank = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) || value <= 0 ? "—" : `#${amps.format(value)}`;
export const tierLabel = (tier: DecibelTierName | null | undefined) => (tier ? DECIBEL_TIER_LABELS[tier] : "—");

/**
 * How old the numbers on screen are. Both feeds sit behind a CDN cache
 * (`/api/points/profile` 120s, the leaderboard 60s), so a value here can
 * legitimately be minutes old — which is the reason to print its age at all.
 */
const formatAge = (fetchedAt: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
};

/**
 * "updated Ns ago" for a footer strip, shared by the profile card and the
 * leaderboard so both age the same way. Re-reads the clock rather than the
 * network: the data itself only changes when the page refetches.
 */
export function useAge(fetchedAt: number | null | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (fetchedAt == null) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [fetchedAt]);
  if (fetchedAt == null || now == null) return null;
  return formatAge(fetchedAt, now);
}
