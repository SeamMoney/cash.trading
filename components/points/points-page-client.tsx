"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Header } from "@/components/layout/Header";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { useDecibelWalletIdentity } from "@/hooks/useDecibelWalletIdentity";
import { Leaderboard } from "./leaderboard";
import { PointsProfileCard } from "./points-profile-card";
import { formatAmps } from "./format";
import { usePointsGlobal, usePointsProfile } from "./use-points-data";

const VISIBILITY_REFRESH_MS = 2 * 60_000;

export function PointsPageClient({ embedded = false }: { embedded?: boolean }) {
  const { connected } = useWallet();
  // Rainbow and other x-chain wallets expose an adapter address that is not
  // the Decibel owner account; AMPs are keyed by the derived owner address.
  const { ownerAddress } = useDecibelWalletIdentity();
  const owner = connected && ownerAddress ? ownerAddress : null;

  const [nonce, setNonce] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);
  const [inspectOwner, setInspectOwner] = useState<string | null>(null);
  const lastFetchRef = useRef(Date.now());

  const refresh = useCallback(() => {
    lastFetchRef.current = Date.now();
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      if (Date.now() - lastFetchRef.current >= VISIBILITY_REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  const global = usePointsGlobal(nonce);
  const you = usePointsProfile(owner, nonce);
  const inspected = usePointsProfile(inspectOwner && inspectOwner !== owner ? inspectOwner : null, nonce);

  const subline = global.data
    ? `Season 1 · ${formatAmps(global.data.traders)} traders · ${formatAmps(global.data.totalAmps)} AMPs distributed`
    : global.loading
      ? "Season 1"
      : "Season 1 · global stats unavailable";

  const content = (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-balance text-[18px] font-semibold text-zinc-200">Points</h1>
          <p className="mt-1 text-pretty text-[12px] text-zinc-600">{subline}</p>
        </div>
        {owner ? (
          <button
            type="button"
            onClick={refresh}
            disabled={you.loading}
            className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:text-zinc-700"
          >
            {you.loading ? "Refreshing..." : "Refresh"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            className="rounded-[4px] bg-accent px-4 py-2 text-[12px] font-semibold text-black transition-[filter] hover:brightness-95"
          >
            Connect wallet
          </button>
        )}
      </div>

      <PointsProfileCard
        owner={owner}
        variant="you"
        profile={you.data}
        loading={you.loading}
        error={you.error}
        totalTraders={global.data?.traders ?? null}
      />

      {inspectOwner && inspectOwner !== owner && (
        <div className="mt-4">
          <PointsProfileCard
            owner={inspectOwner}
            variant="inspect"
            profile={inspected.data}
            loading={inspected.loading}
            error={inspected.error}
            totalTraders={global.data?.traders ?? null}
            onClose={() => setInspectOwner(null)}
          />
        </div>
      )}

      <Leaderboard owner={owner} you={you.data} nonce={nonce} onSelect={setInspectOwner} />

      <WalletSelector open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );

  if (embedded) return <div className="cash-trade-theme text-zinc-200">{content}</div>;

  return (
    // cash-trade-theme scopes the neon accent vars; without it the Header's
    // logo/Sign-In fall back to the near-black :root --accent and look dead.
    <div className="cash-trade-theme min-h-screen bg-black text-zinc-200">
      <Header />
      <main className="mx-auto max-w-[1536px] px-4 py-8 sm:px-8">{content}</main>
    </div>
  );
}
