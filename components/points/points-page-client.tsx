"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Header, PageConnectCta } from "@/components/layout/Header";
import { SECTION_TITLE } from "@/components/portfolio/portfolio-surface";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { useDecibelWalletIdentity } from "@/hooks/useDecibelWalletIdentity";
import { PAGE_SHELL, PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { Leaderboard } from "./leaderboard";
import { PointsProfileCard } from "./points-profile-card";
import { formatAmps, useAge } from "./format";
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

  const stats = global.data
    ? `${formatAmps(global.data.traders)} depositors`
    : global.loading
      ? null
      : "global stats unavailable";
  // The trader count sits behind a 30s CDN cache with a 300s stale window, so
  // it can be minutes old. It was the last live number in the app printed with
  // no age on it; the same `useAge` the leaderboard footer and profile card use
  // stamps it here, on the line that already existed. No stamp when the count
  // failed to load — there is then no number to age.
  const age = useAge(global.fetchedAt);
  const subline = ["Season 1", stats, age && `updated ${age}`].filter(Boolean).join(" · ");

  const content = (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className={SECTION_TITLE}>Points</h1>
          {/* No max-w and no truncate: the line is short enough to sit on one
              row now, and clipping it would hide the trader count. */}
          <p className="mt-1 text-pretty text-[11px] text-muted-foreground">{subline}</p>
        </div>
        {/* Connecting is the profile card's job — the page never shows two
            entry points to the same wallet. */}
        {owner && (
          <button
            type="button"
            onClick={refresh}
            disabled={you.loading}
            className={cn("shrink-0 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-40", PRESSABLE_CONTROL)}
          >
            {you.loading ? "Refreshing..." : "Refresh"}
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
        onConnect={() => setConnectOpen(true)}
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
    // PageConnectCta: with no owner the profile card below renders the filled
    // "Connect wallet", so the header must not render its outline copy of the
    // same act ~500px away — one act, one button.
    <PageConnectCta present={!owner}>
    <div className="cash-trade-theme min-h-screen bg-background text-zinc-200">
      <Header />
      {/* One readable column, the same measure /launchpad settled on. At 1536px
          the leaderboard row stretched to 1368px around ~570px of content, so a
          rank sat 470px from its AMPs and the row stopped reading as a row. */}
      <main className={PAGE_SHELL}>{content}</main>
    </div>
    </PageConnectCta>
  );
}
