"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CARD_ROW,
  CARD_ROW_GRID,
  CARD_ROW_LABEL,
  CARD_ROW_VALUE,
  PANEL,
  SECTION_GAP,
  SECTION_TITLE,
  TAB,
  TAB_ACTIVE,
  TABLE,
  TABLE_EMPTY,
  TABLE_HEAD,
  TABLE_ROW,
} from "@/components/portfolio/portfolio-surface";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/hooks/useDecibelSubaccounts";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import { tierForAmps, type DecibelTierFilter } from "@/lib/decibel-points";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { formatAmps, formatPnl, formatRank, pnlTone, tierLabel, useAge } from "./format";
import {
  lookupLeaderboardOwner,
  useLeaderboard,
  useTierThresholds,
  type LeaderboardRow,
  type PointsProfile,
} from "./use-points-data";

// Tiers only. "Top 20" was a row-count filter wearing a tier's clothes, and it
// was the chip that pushed the strip onto a second line on a phone; the list
// already opens at 100 rows and grows through "Show more".
const TIER_FILTERS: { label: string; value: DecibelTierFilter | null }[] = [
  { label: "All", value: null },
  { label: "Diamond", value: "diamond" },
  { label: "Double Platinum", value: "doublePlatinum" },
  { label: "Gold", value: "gold" },
];

/**
 * Selecting a row is a real <button> on both breakpoints. The desktop table
 * used to hang the handler off `<tr onClick>`, which no keyboard or screen
 * reader could reach; the mobile list already had the button, so the table
 * now wraps the address cell in the same one.
 */
const ROW_BUTTON = `text-left underline-offset-4 hover:underline ${PRESSABLE_CONTROL}`;

type Props = {
  owner: string | null;
  you: PointsProfile | null;
  nonce: number;
  onSelect: (owner: string) => void;
};

export function Leaderboard({ owner, you, nonce, onSelect }: Props) {
  const [tier, setTier] = useState<DecibelTierFilter | null>(null);
  const [search, setSearch] = useState("");
  const [exact, setExact] = useState<{ owner: string; row: LeaderboardRow | null; loading: boolean } | null>(null);
  const board = useLeaderboard(tier, nonce);
  const thresholds = useTierThresholds(nonce);

  const query = search.trim().toLowerCase();
  // A full address goes to the server (true rank, any page); anything shorter
  // narrows the rows already loaded.
  const exactOwner = isValidAptosAddress(query) && query.length > 10 ? normalizeAptosAddress(query) : null;

  useEffect(() => {
    if (!exactOwner) {
      setExact(null);
      return;
    }
    const controller = new AbortController();
    setExact({ owner: exactOwner, row: null, loading: true });
    const timer = window.setTimeout(() => {
      lookupLeaderboardOwner(exactOwner, controller.signal)
        .then((row) => {
          if (controller.signal.aborted) return;
          setExact({ owner: exactOwner, row, loading: false });
          if (row) onSelect(row.owner);
        })
        .catch(() => {
          if (!controller.signal.aborted) setExact({ owner: exactOwner, row: null, loading: false });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // onSelect is a stable setter from the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactOwner]);

  const rows = useMemo(() => {
    if (exact) return exact.row ? [exact.row] : [];
    if (!query) return board.rows;
    return board.rows.filter((row) => row.owner.includes(query));
  }, [board.rows, exact, query]);

  const tierOf = (amps: number) => (thresholds.data ? tierLabel(tierForAmps(amps, thresholds.data)) : "—");
  // The leaderboard is CDN-cached, so a number here can be a minute old. The
  // footer strip already existed and rendered an empty span whenever the count
  // was hidden; it now carries the freshness the numbers were missing.
  const age = useAge(exact ? null : board.fetchedAt);
  const footer = [
    board.total > 0 && !exact ? `${formatAmps(rows.length)} of ${formatAmps(board.total)}` : null,
    age ? `updated ${age}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const ownRowLoaded = owner != null && rows.some((row) => row.owner === owner);
  const showYouRow = owner != null && you != null && you.rank != null && you.rank > 0 && !ownRowLoaded && !exact && !query;
  const loading = board.loading || (exact?.loading ?? false);

  return (
    <section className={cn(SECTION_GAP, PANEL)}>
      <div className="flex flex-col gap-2 px-4 pt-4 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4">
          <h2 className={SECTION_TITLE}>Leaderboard</h2>
          {/* These switch what the table lists, so they are the app's in-panel
              content tabs — not a fourth underlined-link grammar with an 18px
              hit area. TAB carries the 44px target and the focus ring. */}
          {/* One row, always. At 390px the four chips just overrun the panel,
              which orphaned "Gold" on a second line under an otherwise full
              strip; without flex-wrap it cannot break, and it scrolls sideways
              instead, in the app's existing no-scrollbar treatment
              (components/trade/TradePageClient.tsx). min-w-0 is what lets it
              shrink to the panel and scroll at all. */}
          <div className="no-scrollbar flex min-w-0 items-center overflow-x-auto overscroll-x-contain">
            {TIER_FILTERS.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={tier === item.value}
                onClick={() => setTier(item.value)}
                className={cn(TAB, "shrink-0", tier === item.value && TAB_ACTIVE)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search leaderboard by address"
          placeholder="Search address"
          spellCheck={false}
          autoComplete="off"
          className="h-9 w-full rounded-[var(--radius-sm)] border-card-border bg-background font-mono text-base text-foreground md:w-72 md:shrink-0 md:text-[13px]"
        />
      </div>

      <div className="relative mt-4 md:max-h-[640px] md:overflow-auto">
        {/* Desktop table */}
        <table className={cn(TABLE, "hidden md:table")}>
          <thead>
            <tr className={TABLE_HEAD}>
              <th className="w-20">#</th>
              <th>Address</th>
              {/* The one place the page's headline unit is spelled out, and it
                  renders in every state — loading, empty, wallet or no wallet. */}
              <th className="text-right">AMPs (activity points)</th>
              <th>Tier</th>
              <th className="text-right">PnL</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index} className={TABLE_ROW}>
                    <td><Skeleton className="h-4 w-8" /></td>
                    <td><Skeleton className="h-4 w-40" /></td>
                    <td><Skeleton className="ml-auto h-4 w-20" /></td>
                    <td><Skeleton className="h-4 w-16" /></td>
                    <td><Skeleton className="ml-auto h-4 w-20" /></td>
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={row.owner} className={cn(TABLE_ROW, row.owner === owner && "bg-accent/[0.06]")}>
                    <td className="font-mono tabular-nums text-muted-foreground">{row.rank}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onSelect(row.owner)}
                        className={cn(ROW_BUTTON, "font-mono")}
                      >
                        {shortAddress(row.owner)}
                        {row.owner === owner && <span className="ml-2 font-sans text-[11px] text-accent">You</span>}
                      </button>
                    </td>
                    <td className="text-right font-mono tabular-nums">{formatAmps(row.amps)}</td>
                    <td>{tierOf(row.amps)}</td>
                    <td className={cn("text-right font-mono tabular-nums", pnlTone(row.realizedPnl))}>
                      {formatPnl(row.realizedPnl)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {/* Mobile card rows */}
        <div className="md:hidden">
          {loading && rows.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className={CARD_ROW}>
                  <Skeleton className="h-4 w-44" />
                  {/* Same two-column block as the loaded row, so the list does
                      not grow under the thumb when the numbers land. */}
                  <div className={CARD_ROW_GRID}>
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="ml-auto h-8 w-20" />
                  </div>
                </div>
              ))
            : rows.map((row) => (
                <button
                  key={row.owner}
                  type="button"
                  onClick={() => onSelect(row.owner)}
                  className={cn(
                    CARD_ROW,
                    "block w-full text-left",
                    PRESSABLE_CONTROL,
                    row.owner === owner && "bg-accent/[0.06]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3 font-mono">
                      <span className="tabular-nums text-muted-foreground">{row.rank}</span>
                      <span className="truncate">{shortAddress(row.owner)}</span>
                    </span>
                    {/* Tier names itself; the two numbers below do not, which is
                        why they take the same labelled cells /portfolio's
                        mobile rows use. */}
                    <span className="shrink-0 text-[11px] text-muted-foreground">{tierOf(row.amps)}</span>
                  </div>
                  <div className={CARD_ROW_GRID}>
                    <div>
                      <div className={CARD_ROW_LABEL}>AMPs</div>
                      <div className={CARD_ROW_VALUE}>{formatAmps(row.amps)}</div>
                    </div>
                    <div className="text-right">
                      <div className={CARD_ROW_LABEL}>PnL</div>
                      <div className={cn(CARD_ROW_VALUE, pnlTone(row.realizedPnl))}>{formatPnl(row.realizedPnl)}</div>
                    </div>
                  </div>
                </button>
              ))}
        </div>

        {!loading && rows.length === 0 && (
          <div className={cn(TABLE_EMPTY, "border-t border-card-border")}>
            {board.error ? "Leaderboard is temporarily unavailable" : exact ? "No AMPs recorded for that address" : "No matching addresses"}
          </div>
        )}

        {showYouRow && (
          <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-card-border bg-background-secondary px-4 py-3 text-[13px] text-foreground">
            <span className="flex min-w-0 items-center gap-3 font-mono md:gap-0">
              {/* 5rem = the table's `w-20` rank column, so the two align. */}
              <span className="tabular-nums text-muted-foreground md:inline-block md:w-20">
                {formatRank(you.rank).slice(1)}
              </span>
              <span className="truncate">{shortAddress(owner)}</span>
              <span className="ml-2 font-sans text-[11px] text-accent">You</span>
            </span>
            <span className="flex items-center gap-6 font-mono tabular-nums">
              <span>{formatAmps(you.totalAmps)}</span>
              <span className="hidden font-sans text-muted-foreground md:inline">{tierLabel(you.tier?.current ?? null)}</span>
              <span className={cn("hidden md:inline", pnlTone(you.realizedPnl))}>{formatPnl(you.realizedPnl)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-card-border px-4 py-3 text-[11px] text-muted-foreground">
        <span>{footer}</span>
        {board.hasMore && !exact && !query && (
          <button
            type="button"
            onClick={board.showMore}
            disabled={board.loadingMore}
            className={cn("hover:text-foreground disabled:opacity-40", PRESSABLE_CONTROL)}
          >
            {board.loadingMore ? "Loading..." : "Show more"}
          </button>
        )}
      </div>
    </section>
  );
}
