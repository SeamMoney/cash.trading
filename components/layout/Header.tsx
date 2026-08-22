"use client";

import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { WalletAccountModal } from "@/components/wallet/wallet-account-modal";
import { getChainFromWallet, getPreferredWalletIcon } from "@/lib/wallet-utils";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { BALANCE_UPDATE_EVENT, YIELD_CLAIM_EVENT } from "@/lib/portfolio-events";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";

/** Top-level navigation, in display order. Shared with the mobile portfolio sheet. */
export const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/", label: "Trade" },
  { href: "/swap", label: "Swap" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/launchpad", label: "Launchpad" },
  // Link visibility only — this is a client component, so it cannot read the
  // server-side BOT_OWNER_ADDRESSES allowlist. Access is enforced by that
  // allowlist in the API and by a redirect on /automation itself; this flag
  // just avoids advertising a link that would bounce. Showing it is never a
  // security decision.
  ...(process.env.NEXT_PUBLIC_BOT_AUTOMATION_UI === "1" || process.env.NODE_ENV !== "production"
    ? [{ href: "/automation", label: "Automation" }]
    : []),
  { href: "/points", label: "Points" },
];

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function CashWordmark() {
  return (
    <span className="font-display text-[20px] font-bold tracking-normal text-white">
      cash<span className="text-accent">.trading</span>
    </span>
  );
}

export function Header({ constrained = false }: { constrained?: boolean } = {}) {
  const { connected, wallet } = useWallet();
  const pathname = usePathname();
  const {
    adapterAddress,
    decibelNetwork,
    originAddress,
    owner,
    selectedSubaccount,
  } = useDecibelSubaccounts();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const walletIcon = wallet?.name
    ? getPreferredWalletIcon(wallet.name, wallet.icon)
    : wallet?.icon;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const balanceRequestIdRef = useRef(0);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const addressStr = originAddress || adapterAddress;
  const balanceContext = `${owner}:${decibelNetwork}:${selectedSubaccount ?? ""}`;
  const balanceContextRef = useRef(balanceContext);
  balanceContextRef.current = balanceContext;
  const shortAddress = addressStr
    ? `${addressStr.slice(0, 6)}...${addressStr.slice(-4)}`
    : "";

  const chain = wallet ? getChainFromWallet(wallet) : null;
  const isXChain = chain === "ethereum" || chain === "solana";

  const refreshBalance = useCallback(async (signal?: AbortSignal) => {
    const requestContext = `${owner}:${decibelNetwork}:${selectedSubaccount ?? ""}`;
    if (balanceContextRef.current !== requestContext) return;
    const requestId = ++balanceRequestIdRef.current;
    const isCurrentRequest = () =>
      balanceRequestIdRef.current === requestId
      && balanceContextRef.current === requestContext
      && !signal?.aborted;
    if (!connected || !owner) {
      if (isCurrentRequest()) {
        setBalance(null);
        setBalanceLoading(false);
      }
      return;
    }

    setBalanceLoading(true);
    try {
      if (selectedSubaccount) {
        const params = new URLSearchParams({
          address: selectedSubaccount,
          chainOnly: "true",
          network: decibelNetwork,
        });
        const res = await fetch(`/api/decibel/positions?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const data = await res.json().catch(() => ({}));
        const equity = data?.overview?.equity;
        if (isCurrentRequest() && res.ok && typeof equity === "number" && Number.isFinite(equity)) {
          setBalance(equity);
          return;
        }
      }

      const params = new URLSearchParams({
        address: owner,
        network: decibelNetwork,
      });
      const res = await fetch(`/api/decibel/wallet-balance?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const data = await res.json().catch(() => ({}));
      const walletBalance = data?.balance;
      if (isCurrentRequest()) {
        setBalance(
          res.ok && typeof walletBalance === "number" && Number.isFinite(walletBalance)
            ? walletBalance
            : null,
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isCurrentRequest()) setBalance(null);
    } finally {
      if (isCurrentRequest()) setBalanceLoading(false);
    }
  }, [connected, decibelNetwork, owner, selectedSubaccount]);

  // 30s and visibility-gated: the header mounts on every page, so a 5s poll
  // ran on every open tab all day for a number that changes on deposits and
  // fills, both of which already trigger their own refresh.
  useEffect(() => {
    const controller = new AbortController();
    void refreshBalance(controller.signal);
    if (!connected) return () => controller.abort();

    let interval: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (interval || document.hidden) return;
      interval = setInterval(() => void refreshBalance(), 30_000);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refreshBalance();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [connected, refreshBalance]);

  useEffect(() => {
    const refreshSoon = () => {
      setTimeout(() => void refreshBalance(), 350);
    };
    window.addEventListener(BALANCE_UPDATE_EVENT, refreshSoon);
    window.addEventListener(YIELD_CLAIM_EVENT, refreshSoon);
    return () => {
      window.removeEventListener(BALANCE_UPDATE_EVENT, refreshSoon);
      window.removeEventListener(YIELD_CLAIM_EVENT, refreshSoon);
    };
  }, [refreshBalance]);

  const balanceLabel =
    balance === null
      ? null
      : `$${balance.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  const handleWalletClick = () => {
    if (connected) {
      setAccountModalOpen(true);
    } else {
      setSelectorOpen(true);
    }
  };

  // Let deep CTAs (e.g. the order panel's "Connect wallet" button) open the
  // selector without threading state through the page tree.
  useEffect(() => {
    const onOpen = () => {
      if (!connected) setSelectorOpen(true);
      else setAccountModalOpen(true);
    };
    window.addEventListener("cash:open-wallet-selector", onOpen);
    return () => window.removeEventListener("cash:open-wallet-selector", onOpen);
  }, [connected]);

  return (
    <>
      <header className="relative z-50 isolate border-b border-card-border bg-background">
        <div
          className={
            constrained
              ? "mx-auto flex h-[72px] w-full max-w-7xl items-center justify-between px-4 sm:px-6"
              : "mx-auto flex h-[72px] w-full max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8"
          }
        >
          {/* Left: logo + nav */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className={cn(
                PRESSABLE_CONTROL,
                FOCUS_RING,
                "-ml-2.5 flex size-11 items-center justify-center rounded-[var(--radius-sm)] text-zinc-300 hover:bg-white/[0.06] hover:text-white md:hidden",
              )}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link
              href="/"
              className={cn(FOCUS_RING, "shrink-0 rounded-[var(--radius-xs)] text-white")}
              aria-label="cash.trading home"
            >
              <CashWordmark />
            </Link>

            {/* Desktop nav links */}
            <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      FOCUS_RING,
                      "rounded-[var(--radius-sm)] px-3.5 py-1.5 text-sm font-medium transition-colors",
                      isActive ? "text-white" : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: theme + balance + wallet button */}
          <div className="flex items-center gap-3">
            {/* Desktop only: on mobile this moves into the nav sheet so the
                header keeps just balance + wallet. */}
            <ThemeToggle className="hidden md:inline-flex" />
            {connected && (
              <button
                type="button"
                onClick={handleWalletClick}
                className={cn(
                  PRESSABLE_CONTROL,
                  FOCUS_RING,
                  "hidden h-10 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 font-mono text-[13px] tabular-nums text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200 lg:flex",
                )}
                aria-label="Open account balance and Decibel settings"
              >
                <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Bal</span>
                {balanceLabel ? (
                  <span className="font-semibold text-white">{balanceLabel}</span>
                ) : balanceLoading ? (
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-14 animate-pulse rounded-full bg-white/[0.08] motion-reduce:animate-none"
                  />
                ) : (
                  <span className="font-semibold text-zinc-500">—</span>
                )}
              </button>
            )}
            {connected ? (
              <button
                type="button"
                onClick={handleWalletClick}
                className={cn(
                  PRESSABLE_CONTROL,
                  FOCUS_RING,
                  "flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-white/[0.08] bg-white/[0.06] px-4 text-sm font-medium text-white hover:bg-white/[0.1]",
                )}
              >
                {walletIcon && (
                  <img src={walletIcon} alt="" className="h-4 w-4 rounded-[var(--radius-xs)]" />
                )}
                {shortAddress}
                {isXChain && (
                  <span className="rounded-[var(--radius-xs)] bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-accent">
                    X-CHAIN
                  </span>
                )}
              </button>
            ) : (
              // Outlined, not filled. As a solid accent pill it competed with
              // the page's own primary action (e.g. "+ Deploy Strategy" sits
              // ~74px below it in the same corner) — two primaries means none.
              <button
                type="button"
                onClick={handleWalletClick}
                className={cn(
                  PRESSABLE_CONTROL,
                  FOCUS_RING,
                  "h-10 rounded-[var(--radius-sm)] border border-accent/30 px-5 text-sm font-semibold text-accent hover:bg-accent/10",
                )}
              >
                Connect wallet
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav menu */}
        {mobileMenuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 top-[72px] z-40 bg-black/50 md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav
              aria-label="Primary"
              className="absolute inset-x-0 top-[72px] z-50 flex flex-col border-b border-card-border bg-background px-3 py-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)] md:hidden"
            >
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      FOCUS_RING,
                      "flex min-h-11 items-center rounded-[var(--radius-sm)] px-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "text-zinc-300 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="mt-1 flex items-center justify-between border-t border-card-border px-3 pt-2">
                <span className="text-sm font-medium text-zinc-300">Theme</span>
                <ThemeToggle />
              </div>
            </nav>
          </>
        )}
      </header>

      {/* Wallet modals */}
      <WalletSelector
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
      />
      <WalletAccountModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
      />
    </>
  );
}
