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
import { PRESSABLE_CONTROL } from "@/lib/surface";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

  const subline = loading
    ? "Loading vaults…"
    : error
      ? `Vault list unavailable · ${network}`
      : vaults.length === 0
        ? `No vaults yet · ${network}`
        : `${vaults.length} vault${vaults.length === 1 ? "" : "s"} · ${liveCount} running · ${network}`;

  return (
    // cash-trade-theme scopes the neon accent vars; without it the Header's
    // logo/Sign-In fall back to the near-black :root --accent and look dead.
    <div className="cash-trade-theme min-h-screen bg-black text-zinc-200">
      <Header />
      <main className="mx-auto max-w-[1536px] px-4 py-8 sm:px-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-balance text-[18px] font-semibold text-zinc-200">Vaults</h1>
            <p className="mt-1 truncate text-pretty text-[12px] text-zinc-600" aria-live="polite">
              {subline}
            </p>
          </div>
          {/* The primary lives here while the list is showing and has rows. The empty state
              carries it instead, and the launch flow has its own — never two at once. */}
          {!launching && !isEmpty && (
            <button
              type="button"
              onClick={() => setLaunching(true)}
              className={cn(
                "min-h-10 shrink-0 rounded-[4px] bg-accent px-4 py-2 text-[12px] font-semibold text-black transition-[filter] hover:brightness-95",
                PRESSABLE_CONTROL, FOCUS_RING,
              )}
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
        ) : (
          <section className="overflow-hidden rounded-[4px] border border-[#242424] bg-[#141414]">
            {connected && mine.length > 0 && (
              <div className="flex items-center gap-1 border-b border-[#242424] px-3 py-2">
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
                      className={cn(
                        "min-h-9 rounded-[4px] px-2.5 text-[12px] font-medium",
                        PRESSABLE_CONTROL, FOCUS_RING,
                        active ? "bg-[#1d1d1d] text-zinc-200" : "text-zinc-500 hover:text-zinc-300",
                      )}
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
