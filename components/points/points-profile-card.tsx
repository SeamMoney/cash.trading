"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  BUTTON_PRIMARY,
  PANEL,
  STAT_GRID,
  STAT_LABEL,
  STAT_NOTE,
  STAT_TILE,
  STAT_VALUE,
} from "@/components/portfolio/portfolio-surface";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/hooks/useDecibelSubaccounts";
import { explorerAccountUrl } from "@/lib/constants";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { formatAge, formatAmps, formatPnl, formatRank, formatSignedAmps, pnlTone, tierLabel } from "./format";
import type { PointsProfile } from "./use-points-data";

type Props = {
  owner: string | null;
  variant: "you" | "inspect";
  profile: PointsProfile | null;
  loading: boolean;
  error: string | null;
  totalTraders: number | null;
  onConnect?: () => void;
  onClose?: () => void;
};

/**
 * "updated Ns ago" for the footer strip. Re-reads the clock rather than the
 * network: the profile itself only changes when the page refetches.
 */
function useAge(fetchedAt: number | null | undefined) {
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

export function PointsProfileCard({ owner, variant, profile, loading, error, totalTraders, onConnect, onClose }: Props) {
  const age = useAge(profile?.fetchedAt);

  if (!owner) {
    // The page's one primary action lives here, inside the panel whose contents
    // it unlocks — not in a header CTA competing with it from the far corner.
    return (
      <section className={cn(PANEL, "border-dashed px-4 py-10 text-center")}>
        <p className="text-[13px] text-muted-foreground">Connect to see your rank, tier and streak</p>
        {onConnect && (
          <button type="button" onClick={onConnect} className={cn(BUTTON_PRIMARY, "mt-4")}>
            Connect wallet
          </button>
        )}
      </section>
    );
  }

  const gone = (piece: PointsProfile["unavailable"][number]) =>
    Boolean(error) || (profile != null && profile.unavailable.includes(piece));
  // Skeletons are shaped like the loaded tile (value line + note line) so the
  // grid does not resize when the numbers land.
  const value = (node: React.ReactNode) =>
    loading && !profile ? (
      <>
        <Skeleton className="mt-2 h-8 w-28" />
        <Skeleton className="mt-2 h-3 w-20" />
      </>
    ) : (
      node
    );

  const tier = profile?.tier ?? null;
  const streak = profile?.streak ?? null;

  return (
    <section className={PANEL}>
      <div className={cn(STAT_GRID, "grid-cols-2 md:grid-cols-4")}>
        <div className={STAT_TILE}>
          <p className={STAT_LABEL}>{variant === "you" ? "Your rank" : "Rank"}</p>
          {value(
            <>
              <p className={STAT_VALUE}>{gone("points") && gone("tier") ? "—" : formatRank(profile?.rank)}</p>
              <p className={STAT_NOTE}>
                {profile?.rank != null && profile.rank > 0 && totalTraders != null
                  ? `of ${formatAmps(totalTraders)} traders`
                  : "\u00a0" /* reserve the note line so the tile keeps one height */}
              </p>
            </>,
          )}
        </div>

        <div className={STAT_TILE}>
          <p className={STAT_LABEL}>AMPs</p>
          {value(
            <>
              <p className={cn(STAT_VALUE, "text-accent")}>
                {gone("points") && gone("tier") ? "—" : (
                  <NumberTicker value={profile?.totalAmps} format={{ maximumFractionDigits: 0 }} fallback="—" />
                )}
              </p>
              {/* What an AMP is belongs next to the number, not in a page
                  sub-line a disconnected visitor reads before seeing one. */}
              <p className={STAT_NOTE}>
                Activity points · last 7d {gone("last7d") ? "—" : formatSignedAmps(profile?.last7d)}
              </p>
            </>,
          )}
        </div>

        <div className={STAT_TILE}>
          <p className={STAT_LABEL}>Tier</p>
          {value(
            gone("tier") || !tier ? (
              <p className={STAT_VALUE}>—</p>
            ) : (
              <>
                <p className={cn(STAT_VALUE, "font-sans text-lg")}>{tierLabel(tier.current)}</p>
                {tier.next ? (
                  <>
                    <p className={STAT_NOTE}>
                      {formatAmps(tier.next.needed)} to {tierLabel(tier.next.name)}
                    </p>
                    <div
                      role="progressbar"
                      aria-label={`Progress to ${tierLabel(tier.next.name)}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(tier.next.progress)}
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-tertiary"
                    >
                      <div className="h-full rounded-full bg-success" style={{ width: `${tier.next.progress}%` }} />
                    </div>
                  </>
                ) : (
                  <p className={STAT_NOTE}>Top tier</p>
                )}
              </>
            ),
          )}
        </div>

        <div className={STAT_TILE}>
          <p className={STAT_LABEL}>Streak</p>
          {value(
            gone("streak") || !streak ? (
              <p className={STAT_VALUE}>—</p>
            ) : (
              <>
                <p className={STAT_VALUE}>
                  {formatAmps(streak.days)}
                  <span className="ml-1.5 font-sans text-[11px] font-normal text-muted-foreground">
                    {streak.days === 1 ? "day" : "days"}
                  </span>
                </p>
                {/* "grace" was a term the page taught before it showed one;
                    the plain reading of the same two numbers needs no gloss. */}
                <p className={STAT_NOTE}>
                  {streak.graceLeft} of {streak.graceTotal} missed days left
                </p>
              </>
            ),
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-card-border bg-card px-4 py-3 text-[11px] text-muted-foreground">
        <div className="min-w-0 flex-1 font-mono tabular-nums">
          {loading && !profile ? (
            <Skeleton className="h-4 w-72 max-w-full" />
          ) : error ? (
            <span className="text-danger">Points are temporarily unavailable</span>
          ) : (
            <>
              <span>Trading {gone("points") ? "—" : formatAmps(profile?.bySource?.trading)}</span>
              <span> · Streak {gone("points") ? "—" : formatAmps(profile?.bySource?.streak)}</span>
              <span> · Referral {gone("points") ? "—" : formatAmps(profile?.bySource?.referral)}</span>
              <span> · Vault {gone("points") ? "—" : formatAmps(profile?.bySource?.vault)}</span>
              {(profile?.bySource?.bonus ?? 0) > 0 && <span> · Bonus {formatAmps(profile?.bySource?.bonus)}</span>}
              <span>
                {" "}· Realized PnL{" "}
                <span className={gone("points") ? undefined : pnlTone(profile?.realizedPnl)}>
                  {gone("points") ? "—" : formatPnl(profile?.realizedPnl)}
                </span>
              </span>
              {age && <span className="font-sans"> · updated {age}</span>}
            </>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-4">
          {variant === "inspect" && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={cn("hover:text-foreground", PRESSABLE_CONTROL)}
            >
              Close
            </button>
          )}
          <a
            href={explorerAccountUrl(owner, "mainnet")}
            target="_blank"
            rel="noreferrer"
            className={cn("flex items-center gap-1 font-mono hover:text-foreground", PRESSABLE_CONTROL)}
          >
            {shortAddress(owner)}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </span>
      </div>
    </section>
  );
}
