"use client";

import Link from "next/link";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { WalletSelector } from "@/components/wallet/cash-wallet-selector";
import { WalletAccountModal } from "@/components/wallet/wallet-account-modal";
import { getChainFromWallet } from "@/lib/wallet-utils";
import { BALANCE_UPDATE_EVENT, YIELD_CLAIM_EVENT, type BalanceUpdateDetail, type YieldClaimDetail } from "@/lib/portfolio-events";

const NAV_ITEMS = [
  { href: "/trade", label: "Trade" },
  { href: "/launchpad", label: "Launchpad" },
  { href: "/automation", label: "Automation" },
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
  const { connected, account, wallet } = useWallet();
  const pathname = usePathname();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  const addressStr = account?.address?.toString() ?? "";
  const shortAddress = addressStr
    ? `${addressStr.slice(0, 6)}...${addressStr.slice(-4)}`
    : "";

  const chain = wallet ? getChainFromWallet(wallet) : null;
  const isXChain = chain === "ethereum" || chain === "solana";
  const [balance, setBalance] = useState(4218.32);

  useEffect(() => {
    const onBalanceUpdate = (e: Event) => {
      const d = (e as CustomEvent<BalanceUpdateDetail>).detail;
      setBalance((prev) => prev + d.delta);
    };
    const onYieldClaim = (e: Event) => {
      const d = (e as CustomEvent<YieldClaimDetail>).detail;
      setBalance((prev) => prev + d.claimed);
    };
    window.addEventListener(BALANCE_UPDATE_EVENT, onBalanceUpdate);
    window.addEventListener(YIELD_CLAIM_EVENT, onYieldClaim);
    return () => {
      window.removeEventListener(BALANCE_UPDATE_EVENT, onBalanceUpdate);
      window.removeEventListener(YIELD_CLAIM_EVENT, onYieldClaim);
    };
  }, []);

  const handleWalletClick = () => {
    if (connected) {
      setAccountModalOpen(true);
    } else {
      setSelectorOpen(true);
    }
  };

  return (
    <>
      <header className="relative z-50 isolate border-b border-white/[0.06] bg-[var(--background)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between">
          {/* Left: logo + nav */}
          <div className="flex items-center gap-3">
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
            <button
              type="button"
              onClick={handleWalletClick}
              className="hidden lg:flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[13px] font-mono tabular-nums text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
              aria-label="Open account balance and Decibel settings"
            >
              <span className="text-[10px] font-display font-semibold uppercase tracking-wider text-zinc-600">Bal</span>
              <span className="text-white font-semibold">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </button>
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
              <>
                <button
                  onClick={handleWalletClick}
                  className="hidden sm:block text-[14px] font-medium text-zinc-400 hover:text-white transition-colors"
                >
                  Sign In
                </button>
                <button
                  onClick={handleWalletClick}
                  className="px-5 py-2 rounded-[10px] text-[14px] font-semibold bg-accent text-black hover:bg-[#5dff3f] transition-colors"
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
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
