"use client";

/**
 * /launchpad — the Vaults page.
 *
 * Two things live here and nothing else: the list of sealed vaults on the configured network,
 * and the flow that launches a new one. The launch flow replaces the list in place rather than
 * opening a second surface, so there is exactly one primary action on screen at any time.
 */
import { useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { cn } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
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

export function LaunchpadPage() {
  const { connected, account } = useWallet();
  const { vaults, loading, error, reload, network } = useSealedVaults();
  const [launching, setLaunching] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  const addr = account?.address?.toString();
  const mine = addr
    ? vaults.filter((v) => v.creatorAddr.toLowerCase() === addr.toLowerCase())
    : [];
  const liveCount = vaults.filter(vaultIsLive).length;
  const isEmpty = !loading && !error && vaults.length === 0;
  const showMine = connected && mineOnly && Boolean(addr);

  // Empty, the sub-line said nothing but the network name — a label under a title
  // that names no quantity. Dropped rather than padded; every other state still
  // carries the network alongside a number that needs it.
  const subline = loading
    ? "Loading vaults…"
    : error
      ? `Vault list unavailable · ${network}`
      : vaults.length === 0
        ? null
        : `${vaults.length} vault${vaults.length === 1 ? "" : "s"} · ${liveCount} running · ${network}`;

  return (
    // cash-trade-theme scopes the neon accent vars; without it the Header's
    // logo/Sign-In fall back to the near-black :root --accent and look dead.
    <div className="cash-trade-theme min-h-screen bg-background text-foreground">
      <Header />
      {/* One readable column. At 1536px the flow's rows ran 1330px wide with their
          content in the left 40%. The column claims no height of its own: the page
          ends where its content ends, so an empty list is a short page instead of
          one sentence floating in a reserved viewport. */}
      <main className="mx-auto flex w-full max-w-[900px] flex-col px-4 py-8 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className={SECTION_TITLE}>Vaults</h1>
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
  );
}
