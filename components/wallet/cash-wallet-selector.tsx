"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  groupAndSortWallets,
  isInstallRequired,
} from "@aptos-labs/wallet-adapter-core";
import type {
  AdapterWallet,
  AdapterNotDetectedWallet,
} from "@aptos-labs/wallet-adapter-core";
import { X } from "lucide-react";

type AnyWallet = AdapterWallet | AdapterNotDetectedWallet;

interface WalletSelectorProps {
  open: boolean;
  onClose: () => void;
}

function CashLogo() {
  return (
    <div className="flex size-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent text-black shadow-sm shadow-accent/20">
      <span className="font-display text-[24px] font-black leading-none">$</span>
    </div>
  );
}

export function WalletSelector({ open, onClose }: WalletSelectorProps) {
  const { connect, wallets, notDetectedWallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  const allWallets: AnyWallet[] = [...wallets, ...notDetectedWallets];
  const { petraWebWallets } = groupAndSortWallets(allWallets);

  // Parity with app.decibel.trade's connect modal: show EVERY detected wallet
  // (Aptos AIP-62 natives plus EVM/Solana derived — Petra, Phantom, OKX,
  // Nightly, MetaMask, Backpack, Rainbow, ...), deduped by base name, instead
  // of a hardcoded allowlist that hid wallets users actually have.
  const installedRaw = allWallets.filter(
    (w) =>
      !isInstallRequired(w) &&
      !petraWebWallets.some((pw) => pw.name === w.name),
  );
  const seen = new Map<string, AnyWallet>();
  for (const w of installedRaw) {
    const base = w.name.replace(/\s*\(.*\)/, "").trim();
    if (!seen.has(base)) seen.set(base, w);
  }
  const installed = Array.from(seen.values());

  // Not-detected popular wallets get an install link (Decibel-style), rather
  // than being hidden entirely.
  const POPULAR_NOT_DETECTED = ["Petra", "Nightly", "OKX Wallet", "Backpack", "Phantom", "MetaMask", "Rainbow"];
  const installedBases = new Set(seen.keys());
  const moreWallets: AnyWallet[] = [];
  const seenMore = new Set<string>();
  for (const w of notDetectedWallets as AnyWallet[]) {
    const base = w.name.replace(/\s*\(.*\)/, "").trim();
    if (
      POPULAR_NOT_DETECTED.includes(base) &&
      !installedBases.has(base) &&
      !seenMore.has(base)
    ) {
      seenMore.add(base);
      moreWallets.push(w);
    }
  }

  // Separate Google and Apple from other social wallets
  const googleWallet = petraWebWallets.find((w) => w.name.toLowerCase().includes("google"));
  const appleWallet = petraWebWallets.find((w) => w.name.toLowerCase().includes("apple"));

  const handleConnect = useCallback(
    async (walletName: string) => {
      setConnecting(walletName);
      try {
        await connect(walletName);
        onClose();
      } catch {
        // User rejected or error
      } finally {
        setConnecting(null);
      }
    },
    [connect, onClose],
  );

  if (!open || !mounted) return null;

  const hasSocial = googleWallet || appleWallet;
  const hasWallets = installed.length > 0;

  const content = (
    <div className="cash-trade-theme fixed inset-0 z-[100] bg-[#0a0a0a] modal-backdrop overflow-y-auto">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close wallet selector"
        className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        <X className="size-4" strokeWidth={2.5} />
      </button>

      {/* Centered card */}
      <div className="relative min-h-full flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[440px] bg-[#161616] border border-white/[0.08] rounded-2xl p-8 sm:p-10 modal-panel">
          <div className="flex justify-center mb-5">
            <CashLogo />
          </div>

          {/* Heading */}
          <h1 className="text-[26px] font-bold text-white text-center mb-8">
            Sign in to cash.trading
          </h1>

          {googleWallet && (
            <button
              onClick={() => handleConnect(googleWallet.name)}
              disabled={!!connecting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl bg-accent text-black hover:bg-[#5dff3f] active:scale-[0.98] transition-all disabled:opacity-50 mb-3"
            >
              <span className="text-[15px] font-semibold">
                Continue with Google
              </span>
              {connecting === googleWallet.name && (
                <div className="w-4 h-4 border-2 border-black/40 border-t-transparent rounded-full animate-spin ml-1" />
              )}
            </button>
          )}

          {/* OR divider (between Google and social icons row) */}
          {googleWallet && (appleWallet || hasWallets) && (
            <div className="flex items-center gap-4 my-5">
              <div className="flex-1 h-px bg-white/[0.08]" />
              <span className="text-[12px] text-zinc-500 font-medium tracking-wider">OR</span>
              <div className="flex-1 h-px bg-white/[0.08]" />
            </div>
          )}

          {/* Social icon buttons in a row (Apple + wallets) */}
          {(hasSocial || hasWallets) && (
            <div className="flex flex-wrap gap-3">
              {/* Apple button */}
              {appleWallet && (
                <button
                  type="button"
                  aria-label="Continue with Apple"
                  onClick={() => handleConnect(appleWallet.name)}
                  disabled={!!connecting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.08] border border-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <span className="text-[13px] font-semibold text-white">Apple</span>
                  {connecting === appleWallet.name && (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                </button>
              )}

              {/* Wallet icon buttons */}
              {installed.map((w) => {
                const isActive = connecting === w.name;
                return (
                  <button
                    key={w.name}
                    type="button"
                    aria-label={`Connect ${w.name}`}
                    onClick={() => handleConnect(w.name)}
                    disabled={!!connecting}
                    className="flex-1 min-w-[88px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.08] border border-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {w.icon ? (
                      <img src={w.icon} alt={w.name} className="w-5 h-5 rounded" />
                    ) : (
                      <span className="text-[14px] font-bold text-zinc-400">{w.name.charAt(0)}</span>
                    )}
                    {isActive && (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Not-detected popular wallets — install links (Decibel parity) */}
          {moreWallets.length > 0 && (
            <div className="mt-5">
              <p className="text-[11px] uppercase tracking-wider text-zinc-600 font-medium mb-2.5">
                More wallets
              </p>
              <div className="space-y-1.5">
                {moreWallets.map((w) => (
                  <a
                    key={w.name}
                    href={(w as { url?: string }).url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.04] hover:bg-white/[0.08] transition-all"
                  >
                    <span className="flex items-center gap-2.5">
                      {w.icon ? (
                        <img src={w.icon} alt={w.name} className="w-5 h-5 rounded" />
                      ) : (
                        <span className="text-[14px] font-bold text-zinc-400">{w.name.charAt(0)}</span>
                      )}
                      <span className="text-[13px] font-medium text-zinc-300">
                        {w.name.replace(/\s*\(.*\)/, "")}
                      </span>
                    </span>
                    <span className="text-[11px] text-zinc-500">Install</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {installed.length === 0 && petraWebWallets.length === 0 && (
            <div className="text-center py-8">
              <p className="text-[13px] text-zinc-500">No wallets detected.</p>
              <p className="text-[12px] text-zinc-600 mt-1">Install a wallet extension to connect.</p>
            </div>
          )}

          {/* Terms */}
          <p className="text-[12px] text-zinc-500 text-center mt-8 leading-relaxed">
            By signing in you agree to cash.trading&apos;s{" "}
            <span className="underline underline-offset-2">Terms of Service</span>{" "}
            and{" "}
            <span className="underline underline-offset-2">Privacy Policy</span>.
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
