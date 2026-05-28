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

type AnyWallet = AdapterWallet | AdapterNotDetectedWallet;

interface WalletSelectorProps {
  open: boolean;
  onClose: () => void;
}

/* Google icon */
function GoogleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/* Apple icon */
function AppleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

/* Whop logo (orange triple-chevron) */
function WhopLogo() {
  return (
    <svg className="h-14 w-auto" viewBox="0 0 52 34" fill="none">
      <path d="M 8.403 0 C 5.041 0 2.723 1.475 0.97 3.143 C 0.97 3.143 0.261 3.814 0.27 3.835 L 7.636 11.2 L 15 3.835 C 13.605 1.915 10.976 0 8.403 0 Z" fill="#FA4616"/>
      <path d="M 26.588 0.001 C 23.226 0.001 20.909 1.476 19.155 3.144 C 19.155 3.144 18.508 3.798 18.479 3.836 L 9.375 12.942 L 16.729 20.295 L 33.186 3.836 C 31.791 1.916 29.163 0.001 26.588 0.001 Z" fill="#FA4616"/>
      <path d="M 44.827 0 C 41.465 0 39.148 1.475 37.394 3.143 C 37.394 3.143 36.72 3.802 36.695 3.835 L 18.483 22.049 L 20.41 23.977 C 23.393 26.959 28.274 26.959 31.257 23.977 L 51.401 3.835 L 51.424 3.835 C 50.03 1.915 47.402 0 44.827 0 Z" fill="#FA4616"/>
    </svg>
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

  // Allowlist — only show these wallets (by base name)
  const ALLOWED = new Set(["Petra", "Rainbow", "Backpack", "Phantom", "MetaMask"]);

  // Only show installed wallets that are in the allowlist
  const installedRaw = allWallets.filter(
    (w) =>
      !isInstallRequired(w) &&
      !petraWebWallets.some((pw) => pw.name === w.name),
  );

  // Deduplicate by base name, only keep allowed wallets
  const seen = new Map<string, AnyWallet>();
  for (const w of installedRaw) {
    const base = w.name.replace(/\s*\(.*\)/, "").trim();
    if (ALLOWED.has(base) && !seen.has(base)) {
      seen.set(base, w);
    }
  }
  const installed = Array.from(seen.values());

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
      {/* Whop geometric background SVG — subtle light pattern on dark bg */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "url(/whop-login-bg.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          opacity: 0.12,
          mixBlendMode: "screen",
        }}
      />

      {/* Close button — top right */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.1] transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Centered card */}
      <div className="relative min-h-full flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[440px] bg-[#161616] border border-white/[0.08] rounded-2xl p-8 sm:p-10 modal-panel">
          {/* Whop logo */}
          <div className="flex justify-center mb-5">
            <WhopLogo />
          </div>

          {/* Heading */}
          <h1 className="text-[26px] font-bold text-white text-center mb-8">
            Sign in to cash.trading
          </h1>

          {/* Primary: Google button (full-width, blue like "Continue") */}
          {googleWallet && (
            <button
              onClick={() => handleConnect(googleWallet.name)}
              disabled={!!connecting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl bg-[#1754d8] hover:bg-[#1e63e6] active:scale-[0.98] transition-all disabled:opacity-50 mb-3"
            >
              <GoogleIcon />
              <span className="text-[15px] font-semibold text-white">
                Continue with Google
              </span>
              {connecting === googleWallet.name && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin ml-1" />
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
            <div className="flex gap-3">
              {/* Apple button */}
              {appleWallet && (
                <button
                  onClick={() => handleConnect(appleWallet.name)}
                  disabled={!!connecting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.08] border border-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <AppleIcon className="w-5 h-5 text-white" />
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
                    onClick={() => handleConnect(w.name)}
                    disabled={!!connecting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white/[0.08] border border-white/[0.06] hover:bg-white/[0.12] active:scale-[0.98] transition-all disabled:opacity-50"
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
