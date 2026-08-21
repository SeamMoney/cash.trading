"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { shortAddress } from "@/hooks/useDecibelSubaccounts";
import { isValidAptosAddress, normalizeAptosAddress } from "@/lib/decibel";
import { tierForAmps, type DecibelTierFilter } from "@/lib/decibel-points";
import { cn } from "@/lib/utils";
import { formatAmps, formatPnl, formatRank, pnlTone, tierLabel } from "./format";
import {
  lookupLeaderboardOwner,
  useLeaderboard,
  useTierThresholds,
  type LeaderboardRow,
  type PointsProfile,
} from "./use-points-data";

const TIER_FILTERS: { label: string; value: DecibelTierFilter | null }[] = [
  { label: "All", value: null },
  { label: "Top 20", value: "top20" },
  { label: "Diamond", value: "diamond" },
  { label: "Double Platinum", value: "doublePlatinum" },
  { label: "Gold", value: "gold" },
];

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
  const ownRowLoaded = owner != null && rows.some((row) => row.owner === owner);
  const showYouRow = owner != null && you != null && you.rank != null && you.rank > 0 && !ownRowLoaded && !exact && !query;
  const loading = board.loading || (exact?.loading ?? false);

  return (
    <section className="mt-8 rounded-[4px] border border-[#242424] bg-[#141414]">
      <div className="flex flex-col gap-4 px-4 pt-5 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-[18px] font-semibold text-zinc-200">Leaderboard</h2>
          <div className="flex flex-wrap gap-x-4 text-[12px]">
            {TIER_FILTERS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setTier(item.value)}
                className={cn(
                  "text-zinc-500 transition-colors hover:text-zinc-300",
                  tier === item.value && "text-zinc-200 underline decoration-zinc-500 underline-offset-4",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search address"
          spellCheck={false}
          autoComplete="off"
          className="h-8 w-full rounded-[4px] border-[#242424] bg-[#050505] font-mono text-[12px] text-zinc-200 md:w-72 md:text-[12px]"
        />
      </div>

      <div className="relative mt-4 md:max-h-[640px] md:overflow-auto">
        {/* Desktop table */}
        <table className="hidden w-full text-left text-[13px] md:table">
          <thead className="text-zinc-500">
            <tr className="[&>th]:px-6 [&>th]:py-3 [&>th]:font-medium">
              <th className="w-20">#</th>
              <th>Address</th>
              <th className="text-right">AMPs</th>
              <th>Tier</th>
              <th className="text-right">Realized PnL</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index} className="border-t border-[#242424] [&>td]:px-6 [&>td]:py-4">
                    <td><Skeleton className="h-4 w-8" /></td>
                    <td><Skeleton className="h-4 w-40" /></td>
                    <td><Skeleton className="ml-auto h-4 w-20" /></td>
                    <td><Skeleton className="h-4 w-16" /></td>
                    <td><Skeleton className="ml-auto h-4 w-20" /></td>
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={row.owner}
                    onClick={() => onSelect(row.owner)}
                    className={cn(
                      "cursor-pointer border-t border-[#242424] text-zinc-300 transition-colors hover:bg-white/[0.03] [&>td]:px-6 [&>td]:py-4",
                      row.owner === owner && "bg-accent/[0.06]",
                    )}
                  >
                    <td className="font-mono tabular-nums text-zinc-500">{row.rank}</td>
                    <td className="font-mono">
                      {shortAddress(row.owner)}
                      {row.owner === owner && <span className="ml-2 font-sans text-[11px] text-accent">You</span>}
                    </td>
                    <td className="text-right font-mono tabular-nums text-zinc-200">{formatAmps(row.amps)}</td>
                    <td>{tierOf(row.amps)}</td>
                    <td className={cn("text-right font-mono tabular-nums", pnlTone(row.realizedPnl))}>{formatPnl(row.realizedPnl)}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        {/* Mobile card rows */}
        <div className="md:hidden">
          {loading && rows.length === 0
            ? Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="border-t border-[#242424] px-4 py-4">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="mt-2 h-3 w-28" />
                </div>
              ))
            : rows.map((row) => (
                <button
                  key={row.owner}
                  type="button"
                  onClick={() => onSelect(row.owner)}
                  className={cn(
                    "block w-full border-t border-[#242424] px-4 py-4 text-left text-[13px] text-zinc-300",
                    row.owner === owner && "bg-accent/[0.06]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3 font-mono">
                      <span className="tabular-nums text-zinc-500">{row.rank}</span>
                      <span className="truncate">{shortAddress(row.owner)}</span>
                    </span>
                    <span className="font-mono tabular-nums text-zinc-200">{formatAmps(row.amps)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[12px] text-zinc-500">
                    <span>{tierOf(row.amps)}</span>
                    <span className={cn("font-mono tabular-nums", pnlTone(row.realizedPnl))}>{formatPnl(row.realizedPnl)}</span>
                  </div>
                </button>
              ))}
        </div>

        {!loading && rows.length === 0 && (
          <div className="border-t border-[#242424] px-6 py-12 text-center text-[13px] text-zinc-600">
            {board.error ? "Leaderboard is temporarily unavailable" : exact ? "No AMPs recorded for that address" : "No matching addresses"}
          </div>
        )}

        {showYouRow && (
          <div
            className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-[#242424] bg-[#141414] px-4 py-3 text-[13px] text-zinc-200 md:px-6"
          >
            <span className="flex min-w-0 items-center gap-3 font-mono md:gap-0">
              <span className="tabular-nums text-zinc-500 md:inline-block md:w-[calc(5rem-1.5rem)]">{formatRank(you.rank).slice(1)}</span>
              <span className="truncate">{shortAddress(owner)}</span>
              <span className="ml-2 font-sans text-[11px] text-accent">You</span>
            </span>
            <span className="flex items-center gap-6 font-mono tabular-nums">
              <span>{formatAmps(you.totalAmps)}</span>
              <span className="hidden font-sans text-zinc-500 md:inline">{tierLabel(you.tier?.current ?? null)}</span>
              <span className={cn("hidden md:inline", pnlTone(you.realizedPnl))}>{formatPnl(you.realizedPnl)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[#242424] px-4 py-3 text-[12px] text-zinc-500 sm:px-6">
        <span>
          {board.total > 0 && !exact ? `${formatAmps(rows.length)} of ${formatAmps(board.total)}` : ""}
        </span>
        {board.hasMore && !exact && !query && (
          <button
            type="button"
            onClick={board.showMore}
            disabled={board.loadingMore}
            className="text-zinc-400 transition-colors hover:text-zinc-200 disabled:text-zinc-600"
          >
            {board.loadingMore ? "Loading..." : "Show more"}
          </button>
        )}
      </div>
    </section>
  );
}
