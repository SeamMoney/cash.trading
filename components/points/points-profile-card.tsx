"use client";

import { ExternalLink } from "lucide-react";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/hooks/useDecibelSubaccounts";
import { explorerAccountUrl } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { formatAmps, formatPnl, formatRank, formatSignedAmps, pnlTone, tierLabel } from "./format";
import type { PointsProfile } from "./use-points-data";

type Props = {
  owner: string | null;
  variant: "you" | "inspect";
  profile: PointsProfile | null;
  loading: boolean;
  error: string | null;
  totalTraders: number | null;
  onClose?: () => void;
};

const CELL = "bg-[#050505] px-5 py-4 md:px-6 md:py-5";
const LABEL = "text-[13px] text-zinc-500";
const VALUE = "mt-2 font-mono text-[26px] font-semibold tabular-nums text-zinc-200";

export function PointsProfileCard({ owner, variant, profile, loading, error, totalTraders, onClose }: Props) {
  if (!owner) {
    return (
      <section className="rounded-[4px] border border-dashed border-[#242424] px-6 py-10 text-center text-[13px] text-zinc-500">
        Connect to see your rank, tier and streak
      </section>
    );
  }

  const gone = (piece: PointsProfile["unavailable"][number]) =>
    Boolean(error) || (profile != null && profile.unavailable.includes(piece));
  const value = (node: React.ReactNode) => (loading && !profile ? <Skeleton className="mt-3 h-7 w-28" /> : node);

  const tier = profile?.tier ?? null;
  const streak = profile?.streak ?? null;

  return (
    <section className="overflow-hidden rounded-[4px] border border-[#1a1a1a] bg-[#1a1a1a]">
      <div className="grid grid-cols-2 gap-px md:grid-cols-4">
        <div className={CELL}>
          <p className={LABEL}>{variant === "you" ? "Your rank" : "Rank"}</p>
          {value(
            <p className={VALUE}>
              {gone("points") && gone("tier") ? "—" : formatRank(profile?.rank)}
              {profile?.rank != null && profile.rank > 0 && totalTraders != null && (
                <span className="ml-2 font-sans text-[12px] font-normal text-zinc-500">of {formatAmps(totalTraders)}</span>
              )}
            </p>,
          )}
        </div>
        <div className={CELL}>
          <p className={LABEL}>AMPs</p>
          {value(
            <p className={cn(VALUE, "text-accent")}>
              {gone("points") && gone("tier") ? "—" : (
                <NumberTicker value={profile?.totalAmps} format={{ maximumFractionDigits: 0 }} fallback="—" />
              )}
            </p>,
          )}
        </div>
        <div className={CELL}>
          <p className={LABEL}>Tier</p>
          {value(
            gone("tier") || !tier ? (
              <p className={VALUE}>—</p>
            ) : (
              <>
                <p className={cn(VALUE, "font-sans text-[20px]")}>
                  {tierLabel(tier.current)}
                  {tier.next && (
                    <span className="ml-2 font-mono text-[12px] font-normal text-zinc-500">
                      {formatAmps(tier.next.needed)} to {tierLabel(tier.next.name)}
                    </span>
                  )}
                </p>
                {tier.next && (
                  <div
                    role="progressbar"
                    aria-label={`Progress to ${tierLabel(tier.next.name)}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(tier.next.progress)}
                    className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#242424]"
                  >
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${tier.next.progress}%` }} />
                  </div>
                )}
              </>
            ),
          )}
        </div>
        <div className={CELL}>
          <p className={LABEL}>Streak</p>
          {value(
            <p className={VALUE}>
              {gone("streak") || !streak ? "—" : (
                <>
                  {formatAmps(streak.days)}
                  <span className="ml-1 font-sans text-[12px] font-normal text-zinc-500">
                    {streak.days === 1 ? "day" : "days"} · {streak.graceLeft}/{streak.graceTotal} grace left
                  </span>
                </>
              )}
            </p>,
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 bg-[#050505] px-5 py-3 text-[12px] text-zinc-500 md:px-6">
        <p className="min-w-0 flex-1 font-mono tabular-nums">
          {loading && !profile ? (
            <Skeleton className="h-4 w-72 max-w-full" />
          ) : error ? (
            <span className="text-[#e8774f]">Points are temporarily unavailable</span>
          ) : (
            <>
              <span>Last 7d {gone("last7d") ? "—" : formatSignedAmps(profile?.last7d)}</span>
              <span> · Trading {gone("points") ? "—" : formatAmps(profile?.bySource?.trading)}</span>
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
            </>
          )}
        </p>
        <span className="flex shrink-0 items-center gap-4">
          {variant === "inspect" && onClose && (
            <button type="button" onClick={onClose} className="text-zinc-500 transition-colors hover:text-zinc-300">
              Close
            </button>
          )}
          <a
            href={explorerAccountUrl(owner, "mainnet")}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-mono text-zinc-400 transition-colors hover:text-zinc-200"
          >
            {shortAddress(owner)}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </span>
      </div>
    </section>
  );
}
