"use client";

/**
 * /launchpad — the Sealed vaults page.
 *
 * Two things live here and nothing else: the list of sealed vaults on the configured network,
 * and the flow that launches a new one. The launch flow replaces the list in place rather than
 * opening a second surface, so there is exactly one primary action on screen at any time.
 *
 * "Sealed" is load-bearing in the name, not decoration. One tab away /trade renders
 * "Decibel Vaults (N)" from a different registry — Decibel's own vault contract. These are
 * strategy vaults whose rules the chain enforces, and the two lists disagreeing about how many
 * "Vaults" exist was the app contradicting itself.
 */
import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { cn } from "@/lib/utils";
import { Header, PageConnectCta } from "@/components/layout/Header";
import { useAge } from "@/components/points/format";
import { SealedLaunch } from "@/components/sealed/SealedLaunch";
import { SealedSwap } from "@/components/sealed/SealedSwap";
import {
  SealedVaultFeed,
  useSealedVaults,
  vaultIsLive,
} from "@/components/sealed/SealedVaultFeed";
import {
  BUTTON_PRIMARY,
  PANEL,
  SECTION_TITLE,
  SEGMENTED_ITEM,
  SEGMENTED_ITEM_ACTIVE,
} from "@/components/portfolio/portfolio-surface";
import { PAGE_SHELL } from "@/lib/surface";

export function LaunchpadPage() {
  const { connected, account } = useWallet();
  const { vaults, loading, error, reload, network, fetchedAt } = useSealedVaults();
  const [launching, setLaunching] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  const addr = account?.address?.toString();
  const mine = addr
    ? vaults.filter((v) => v.creatorAddr.toLowerCase() === addr.toLowerCase())
    : [];
  const liveCount = vaults.filter(vaultIsLive).length;
  const isEmpty = !loading && !error && vaults.length === 0;
  const showMine = connected && mineOnly && Boolean(addr);

  // Every state names a quantity AND the source it came from. The empty case used to
  // resolve to null, which left the page saying nothing about where it had looked — a
  // list that is empty on mainnet and a list that is empty because it read testnet are
  // different facts, and the reader could not tell them apart.
  //
  // …and a quantity plus a network is still only half a fact: "No sealed vaults ·
  // mainnet" says where it looked but not when. The age comes from the same helper
  // the /points leaderboard and profile card print, so freshness reads identically
  // wherever the app claims a number. Suppressed while loading (there is nothing on
  // screen to be old) and on error (the count shown is not from a read that landed).
  const age = useAge(fetchedAt);
  const subline = [
    loading
      ? "Loading vaults…"
      : error
        ? "Vault list unavailable"
        : vaults.length === 0
          ? "No sealed vaults"
          : `${vaults.length} vault${vaults.length === 1 ? "" : "s"} · ${liveCount} running`,
    network,
    !loading && !error && age ? `updated ${age}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // cash-trade-theme scopes the neon accent vars; without it the Header's
    // logo/Sign-In fall back to the near-black :root --accent and look dead.
    //
    // PageConnectCta: disconnected, this page already renders an accent primary
    // of its own ("Launch a vault", or SealedLaunch's own "Connect wallet" once
    // the flow is open), so the header must not render its outline copy — the
    // page was showing two accent controls at once, which is two primaries.
    //
    // No min-h-screen. The page is as tall as its content: with no vaults that is
    // a title, a line and a button, and holding a viewport open under them was
    // reserving a screen for absence. <body> paints the background either way.
    <PageConnectCta present={!connected}>
    <div className="cash-trade-theme bg-background text-foreground">
      <Header />
      {/* PAGE_SHELL, not a private measure. The app shipped five different <main>
          widths, so the content's left edge moved as you changed tabs; this page's
          900 is now the shared reading tier rather than a number that happens to
          match /points. The column claims no height of its own: the page ends where
          its content ends, so an empty list is a short page, not one sentence
          floating in a reserved viewport. */}
      <main className={cn(PAGE_SHELL, "flex flex-col")}>
        {/* Empty, the title block and the empty state are one object — the sub-line
            already states the count and the network, and the sentence under it is the
            same thought continued. 20px of air between them read as a missing section. */}
        <div className={cn("flex items-center justify-between gap-4", isEmpty ? "mb-3" : "mb-5")}>
          <div className="min-w-0">
            <h1 className={SECTION_TITLE}>Sealed vaults</h1>
            {/* Always mounted at one line's height, so the live region survives
                the loading → empty transition and the header block does not
                change height when the sub-line goes quiet. */}
            <p
              className="mt-1 min-h-4 truncate text-pretty text-xs text-muted-foreground"
              aria-live="polite"
            >
              {subline}
            </p>
          </div>
          {/* The primary lives here while the list is showing and has rows. The empty state
              carries it instead, and the launch flow has its own — never two at once. */}
          {!launching && !isEmpty && (
            <button
              type="button"
              onClick={() => setLaunching(true)}
              className={cn(BUTTON_PRIMARY, "shrink-0")}
            >
              Launch a vault
            </button>
          )}
        </div>

        {launching ? (
          <SealedLaunch
            onCancel={() => setLaunching(false)}
            onLaunched={() => void reload()}
          />
        ) : isEmpty ? (
          // No panel, no wrapper. A bordered box drawn around two lines is a frame
          // around nothing, and centring them in the viewport reserved 480px of
          // black to do it. They sit under the title on the page's own rhythm.
          <SealedVaultFeed
            vaults={vaults}
            loading={loading}
            error={error}
            onRetry={() => void reload()}
            onLaunch={() => setLaunching(true)}
          />
        ) : (
          <section className={PANEL}>
            {connected && mine.length > 0 && (
              <div className="flex items-center gap-1 border-b border-card-border px-3 py-2">
                {([
                  ["all", `All (${vaults.length})`],
                  ["mine", `Mine (${mine.length})`],
                ] as const).map(([key, label]) => {
                  const active = key === "mine" ? mineOnly : !mineOnly;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setMineOnly(key === "mine")}
                      aria-pressed={active}
                      className={cn(SEGMENTED_ITEM, active && SEGMENTED_ITEM_ACTIVE)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {showMine ? (
              <div className="p-3">
                <SealedSwap creatorAddr={addr} />
              </div>
            ) : (
              <SealedVaultFeed
                vaults={vaults}
                loading={loading}
                error={error}
                onRetry={() => void reload()}
                onLaunch={() => setLaunching(true)}
              />
            )}
          </section>
        )}
      </main>
    </div>
    </PageConnectCta>
  );
}
