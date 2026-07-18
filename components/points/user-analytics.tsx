"use client";

import { FormEvent, useEffect, useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";

interface UserAnalyticsProfile {
  owner: string;
  points: {
    rank: number | null;
    total: number;
    trading: number;
    vault: number;
    referral: number;
    streak: number;
    bonus: number;
    realizedPnl: number;
  };
  account: {
    primarySubaccount: string | null;
    subaccounts: number;
    overview: {
      equity: number;
      collateral: number;
      unrealizedPnl: number;
      totalNotional: number;
      leverage: number | null;
    } | null;
    openPositions: Array<{
      market: string;
      isLong: boolean;
      size: number;
      leverage: number;
      entryPrice: number;
    }>;
  };
  vaults: Array<{
    address: string;
    name: string;
    vaultType: string | null;
    deposited: number | null;
    currentValue: number | null;
    shares: number | null;
    pnl: number | null;
    returnPct: number | null;
  }>;
  unavailable: {
    account: boolean;
    overview: boolean;
    positions: boolean;
    vaults: boolean;
  };
}

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatPoints(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUsd(value: number | null | undefined, signed = false) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? "always" : "auto",
  });
}

export function UserAnalytics({ account }: { account?: string | null }) {
  const [input, setInput] = useState(account ?? "");
  const [selectedAccount, setSelectedAccount] = useState(account ?? "");
  const [profile, setProfile] = useState<UserAnalyticsProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) return;
    setInput(account);
    setSelectedAccount(account);
  }, [account]);

  useEffect(() => {
    if (!selectedAccount) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(
      `/api/decibel/user-stats?account=${encodeURIComponent(selectedAccount)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || data.unavailable === true) {
          throw new Error(data?.error || "Account stats are temporarily unavailable");
        }
        setProfile(data as UserAnalyticsProfile);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setProfile(null);
        setError(reason instanceof Error ? reason.message : "Account lookup failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedAccount]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim();
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
      setError("Enter a valid Aptos owner address.");
      return;
    }
    setSelectedAccount(value);
  }

  const breakdown = profile
    ? [
        ["Trading", profile.points.trading],
        ["Streak", profile.points.streak],
        ["Vault", profile.points.vault],
        ["Referral", profile.points.referral],
        ["Bonus", profile.points.bonus],
      ] as const
    : [];

  return (
    <section id="account-intelligence" className="border border-white/10 bg-black/40">
      <div className="border-b border-white/10 px-3 py-3">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-300">
          Decibel account intelligence
        </div>
        <p className="mt-1 text-pretty text-[10px] font-mono text-zinc-600">
          Inspect public Season 1 AMPs, live account exposure, and vault positions by owner address.
        </p>
      </div>

      <form onSubmit={submit} className="flex gap-2 border-b border-white/10 p-3">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Aptos owner address</span>
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-600" aria-hidden="true" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0x... Aptos owner address"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full border border-white/10 bg-black/50 pl-8 pr-3 font-mono text-[11px] text-white outline-none focus:border-primary/50"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="h-9 shrink-0 bg-primary px-4 text-[11px] font-mono font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" aria-label="Loading account" /> : "Analyze"}
        </button>
      </form>

      {error ? (
        <div role="alert" className="px-3 py-4 text-pretty text-[11px] font-mono text-red-400">
          {error}
        </div>
      ) : null}

      {profile ? (
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
            <div className="min-w-0 font-mono text-[11px] text-zinc-400">
              {shortAddress(profile.owner)}
            </div>
            <a
              href={`https://explorer.aptoslabs.com/account/${profile.owner}?network=mainnet`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-[10px] font-mono text-zinc-500 hover:text-primary"
            >
              Explorer <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>

          <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
            {[
              ["Total AMPs", formatPoints(profile.points.total), "text-primary"],
              ["Rank", profile.points.rank ? `#${profile.points.rank.toLocaleString()}` : "Unranked", "text-white"],
              ["Realized P&L", formatUsd(profile.points.realizedPnl, true), profile.points.realizedPnl < 0 ? "text-red-400" : "text-green-400"],
              ["Account equity", formatUsd(profile.account.overview?.equity), "text-white"],
            ].map(([label, value, color]) => (
              <div key={label} className="bg-[#090909] px-3 py-3">
                <div className="text-[9px] font-mono uppercase text-zinc-600">{label}</div>
                <div className={`mt-1 font-mono text-base font-semibold tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-5">
            {breakdown.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 bg-black px-3 py-2 sm:block">
                <div className="text-[9px] font-mono uppercase text-zinc-600">{label}</div>
                <div className="font-mono text-[11px] tabular-nums text-zinc-300 sm:mt-1">{formatPoints(value)}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-px border-t border-white/10 bg-white/10 lg:grid-cols-2">
            <div className="bg-black p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase text-zinc-500">Open positions</span>
                <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                  {profile.account.openPositions.length}
                </span>
              </div>
              {profile.account.openPositions.length ? (
                <div className="space-y-1">
                  {profile.account.openPositions.map((position) => (
                    <div key={`${position.market}:${position.isLong}`} className="flex items-center justify-between gap-3 border-t border-white/5 py-2 text-[11px]">
                      <span className="truncate text-zinc-300">{position.market}</span>
                      <span className={`shrink-0 font-mono tabular-nums ${position.isLong ? "text-green-400" : "text-red-400"}`}>
                        {position.isLong ? "LONG" : "SHORT"} {position.leverage.toFixed(1)}x
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-[10px] font-mono text-zinc-700">
                  {profile.unavailable.positions ? "Position data unavailable" : "No open positions"}
                </div>
              )}
            </div>

            <div className="bg-black p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase text-zinc-500">Vault positions</span>
                <span className="font-mono text-[10px] tabular-nums text-zinc-600">{profile.vaults.length}</span>
              </div>
              {profile.vaults.length ? (
                <div className="space-y-1">
                  {profile.vaults.map((vault) => (
                    <div key={vault.address} className="flex items-center justify-between gap-3 border-t border-white/5 py-2 text-[11px]">
                      <span className="truncate text-zinc-300">{vault.name}</span>
                      <span className="shrink-0 font-mono tabular-nums text-zinc-400">
                        {formatUsd(vault.currentValue)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-4 text-center text-[10px] font-mono text-zinc-700">
                  {profile.unavailable.vaults ? "Vault data unavailable" : "No vault positions"}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : !error && !loading ? (
        <div className="px-3 py-5 text-center text-[10px] font-mono text-zinc-700">
          Search an owner address or choose a leaderboard account.
        </div>
      ) : null}
    </section>
  );
}
