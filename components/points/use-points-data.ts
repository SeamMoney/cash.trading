"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointsProfile } from "@/app/api/points/profile/route";
import type { DecibelTierFilter, DecibelTierName } from "@/lib/decibel-points";

export type { PointsProfile };

export interface PointsGlobal {
  traders: number;
}

export interface LeaderboardRow {
  rank: number;
  owner: string;
  amps: number;
  trading: number;
  vault: number;
  referral: number;
  streak: number;
  bonus: number;
  realizedPnl: number;
}

export interface TierThreshold {
  name: DecibelTierName;
  amps: number;
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || json.unavailable) {
    throw new Error(`Points API unavailable (${response.status})`);
  }
  // These routes sit behind an s-maxage CDN cache, so "now" is not when the
  // numbers were read. Age is how long the response has already been sitting
  // in that cache, which makes the freshness we print the data's, not the tab's.
  const age = Number(response.headers.get("age"));
  return { json, fetchedAt: Date.now() - (Number.isFinite(age) ? age : 0) * 1000 };
}

type Async<T> = { data: T | null; loading: boolean; error: string | null };

/**
 * One fetch per (url, nonce); a newer request or an unmount drops the older
 * response so a wallet switch can never paint the previous owner's numbers.
 */
function useJson<T>(url: string | null, nonce: number, parse: (json: unknown) => T): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, loading: Boolean(url), error: null });
  const requestIdRef = useRef(0);
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    fetchJson(url, controller.signal)
      .then(({ json }) => {
        if (requestIdRef.current !== requestId) return;
        setState({ data: parseRef.current(json), loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId || controller.signal.aborted) return;
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : "unavailable" });
      });
    return () => {
      requestIdRef.current += 1;
      controller.abort();
    };
  }, [url, nonce]);

  return state;
}

export function usePointsGlobal(nonce: number) {
  return useJson<PointsGlobal>("/api/predeposit/total", nonce, (json) => {
    const data = json as { depositor_count?: unknown };
    const traders = Number(data.depositor_count);
    if (!Number.isFinite(traders)) throw new Error("invalid global points");
    return { traders };
  });
}

export function usePointsProfile(owner: string | null, nonce: number) {
  return useJson<PointsProfile>(
    owner ? `/api/points/profile?owner=${owner}` : null,
    nonce,
    (json) => json as PointsProfile,
  );
}

export function useTierThresholds(nonce: number) {
  return useJson<TierThreshold[]>("/api/points/tiers", nonce, (json) => {
    const data = json as { tiers?: unknown };
    if (!Array.isArray(data.tiers)) throw new Error("invalid tiers");
    return data.tiers as TierThreshold[];
  });
}

function parseRows(json: unknown): { rows: LeaderboardRow[]; total: number } {
  const data = json as { entries?: unknown; total?: unknown };
  if (!Array.isArray(data.entries)) throw new Error("invalid leaderboard");
  const rows = data.entries.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      rank: Number(item.rank),
      owner: String(item.account),
      amps: Number(item.points),
      trading: Number(item.trading_points),
      vault: Number(item.vault_points),
      referral: Number(item.referral_points),
      streak: Number(item.streak_points),
      bonus: Number(item.bonus_points),
      realizedPnl: Number(item.realized_pnl),
    };
  });
  return { rows, total: Number(data.total) || 0 };
}

export const LEADERBOARD_PAGE = 100;

export function useLeaderboard(tier: DecibelTierFilter | null, nonce: number) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [total, setTotal] = useState(0);
  // When the rows on screen were read. Only the first page sets it: "Show
  // more" appends without refreshing rows 1-100, so the strip keeps counting
  // from the fetch that produced the list the user is looking at.
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const requestId = ++requestIdRef.current;
      const params = new URLSearchParams({ limit: String(LEADERBOARD_PAGE), offset: String(offset) });
      if (tier) params.set("tier", tier);
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const response = await fetchJson(`/api/predeposit/leaderboard?${params}`);
        const page = parseRows(response.json);
        if (requestIdRef.current !== requestId) return;
        setRows((prev) => (offset === 0 ? page.rows : [...prev, ...page.rows]));
        setTotal(page.total);
        if (offset === 0) setFetchedAt(response.fetchedAt);
      } catch (err: unknown) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "unavailable");
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [tier],
  );

  useEffect(() => {
    setRows([]);
    setTotal(0);
    setFetchedAt(null);
    void load(0);
    return () => {
      requestIdRef.current += 1;
    };
  }, [load, nonce]);

  const showMore = useCallback(() => {
    if (loading || loadingMore) return;
    void load(rows.length);
  }, [load, loading, loadingMore, rows.length]);

  return {
    rows,
    total,
    fetchedAt,
    loading,
    loadingMore,
    error,
    showMore,
    hasMore: rows.length > 0 && rows.length < total,
  };
}

/** Exact-owner lookup with true rank (upstream `search_term`). */
export async function lookupLeaderboardOwner(owner: string, signal?: AbortSignal): Promise<LeaderboardRow | null> {
  const params = new URLSearchParams({ limit: "1", offset: "0", search_term: owner });
  const { json } = await fetchJson(`/api/predeposit/leaderboard?${params}`, signal);
  return parseRows(json).rows[0] ?? null;
}
