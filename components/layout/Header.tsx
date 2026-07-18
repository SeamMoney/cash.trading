"use client";

import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { WalletAccountModal } from "@/components/wallet/wallet-account-modal";
import { getChainFromWallet } from "@/lib/wallet-utils";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { BALANCE_UPDATE_EVENT, YIELD_CLAIM_EVENT } from "@/lib/portfolio-events";
import { Menu, X } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/launchpad", label: "Launchpad" },
  ...(process.env.NODE_ENV !== "production"
    ? [{ href: "/automation", label: "Automation" }]
    : []),
  { href: "/points", label: "Points" },
];

function CashWordmark() {
  return (
    <span className="font-display text-[20px] font-bold tracking-normal text-white">
      cash<span className="text-accent">.trading</span>
    </span>
  );
}

export function Header() {
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

  useEffect(() => {
    const controller = new AbortController();
    void refreshBalance(controller.signal);
    const interval = connected
      ? setInterval(() => void refreshBalance(), 5_000)
      : null;
    return () => {
      controller.abort();
      if (interval) clearInterval(interval);
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
      ? balanceLoading
        ? "..."
        : "—"
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
      <header className="relative z-50 isolate border-b border-white/[0.06] bg-[var(--background)]">
        <div className="mx-auto flex h-[72px] w-full max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="md:hidden -ml-1.5 rounded-lg p-2 text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link href="/" className="text-white shrink-0" aria-label="cash.trading home">
              <CashWordmark />
            </Link>

            {/* Desktop nav links */}
            <nav className="hidden md:flex items-center gap-1 ml-4">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3.5 py-1.5 rounded-lg text-[14px] font-medium transition-colors ${
                      isActive
                        ? "text-white"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: balance + wallet button */}
          <div className="flex items-center gap-3">
            {connected && (
              <button
                type="button"
                onClick={handleWalletClick}
                className="hidden items-center gap-1.5 rounded-[10px] px-2 py-1 text-[13px] font-mono tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 lg:flex"
                aria-label="Open account balance and Decibel settings"
              >
                <span className="text-[10px] font-display font-semibold uppercase tracking-wider text-zinc-600">Bal</span>
                <span className="font-semibold text-white">{balanceLabel}</span>
              </button>
            )}
            {connected ? (
              <button
                onClick={handleWalletClick}
                className="flex items-center gap-2 px-4 py-2 rounded-[10px] text-[14px] font-medium bg-white/[0.06] text-white border border-white/[0.08] hover:bg-white/[0.1] transition-colors"
              >
                {wallet?.icon && (
                  <img src={wallet.icon} alt="" className="w-4 h-4 rounded-[4px]" />
                )}
                {shortAddress}
                {isXChain && (
                  <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-accent/15 text-accent leading-none">
                    X-CHAIN
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={handleWalletClick}
                className="px-5 py-2 rounded-[10px] text-[14px] font-semibold bg-accent text-black transition-[filter] hover:brightness-95"
              >
                Sign In
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
              className="fixed inset-0 top-[72px] z-40 bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <nav className="absolute inset-x-0 top-[72px] z-50 flex flex-col border-b border-white/[0.06] bg-[var(--background)] px-3 py-2 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.8)] md:hidden">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`rounded-[10px] px-3 py-3 text-[15px] font-medium transition-colors ${
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
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
