"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  groupAndSortWallets,
  isInstallRequired,
} from "@aptos-labs/wallet-adapter-core";
import type {
  AdapterNotDetectedWallet,
  AdapterWallet,
} from "@aptos-labs/wallet-adapter-core";
import { ChevronDown, X } from "lucide-react";

import { MobileModalSheet } from "@/components/ui/mobile-modal-sheet";
import {
  EVM_SOURCE_CHAIN_STORAGE_KEY,
  storeEvmSourceChain,
  type EvmCctpSourceChain,
} from "@/lib/evm-cctp";
import { cn } from "@/lib/utils";

type AnyWallet = AdapterWallet | AdapterNotDetectedWallet;
type WalletChain = "Aptos" | "Solana" | "EVM";

interface WalletSelectorProps {
  open: boolean;
  onClose: () => void;
}

const CHAIN_TABS: WalletChain[] = ["Aptos", "Solana", "EVM"];
const EVM_SOURCE_CHAINS: EvmCctpSourceChain[] = ["Arbitrum", "Base", "Ethereum"];
const POPULAR_WALLETS: Record<WalletChain, string[]> = {
  Aptos: ["Petra", "OKX Wallet", "Backpack", "Phantom"],
  Solana: ["Phantom", "Backpack", "OKX Wallet"],
  EVM: ["Rainbow", "MetaMask", "Rabby", "Coinbase Wallet", "OKX Wallet"],
};

function baseWalletName(name: string) {
  return name.replace(/\s*\((?:Solana|Ethereum)\)\s*$/i, "").trim();
}

function isNightly(name: string) {
  return /nightly/i.test(baseWalletName(name));
}

function walletChain(name: string): WalletChain {
  if (/\(solana\)/i.test(name)) return "Solana";
  if (/\(ethereum\)/i.test(name)) return "EVM";
  return "Aptos";
}

function dedupeWallets(wallets: AnyWallet[]) {
  const byName = new Map<string, AnyWallet>();
  for (const wallet of wallets) {
    const key = baseWalletName(wallet.name).toLowerCase();
    if (!byName.has(key)) byName.set(key, wallet);
  }
  return [...byName.values()];
}

export function WalletSelector({ open, onClose }: WalletSelectorProps) {
  const { connect, wallets, notDetectedWallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [activeChain, setActiveChain] = useState<WalletChain>("Aptos");
  const [evmSourceChain, setEvmSourceChain] = useState<EvmCctpSourceChain>("Arbitrum");
  const [showMore, setShowMore] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => setMounted(true), []);

  const allWallets = useMemo(
    () => [...wallets, ...notDetectedWallets].filter((wallet) => !isNightly(wallet.name)),
    [notDetectedWallets, wallets],
  );
  const { petraWebWallets } = useMemo(
    () => groupAndSortWallets(allWallets),
    [allWallets],
  );
  const socialNames = useMemo(
    () => new Set(petraWebWallets.map((wallet) => wallet.name)),
    [petraWebWallets],
  );
  const googleWallet = petraWebWallets.find((wallet) => /google/i.test(wallet.name));
  const appleWallet = petraWebWallets.find((wallet) => /apple/i.test(wallet.name));

  const availableByChain = useMemo(() => {
    const relevant = allWallets.filter((wallet) => !socialNames.has(wallet.name));
    const result: Record<WalletChain, AnyWallet[]> = { Aptos: [], Solana: [], EVM: [] };
    for (const chain of CHAIN_TABS) {
      const popular = new Set(POPULAR_WALLETS[chain].map((name) => name.toLowerCase()));
      const matching = relevant.filter((wallet) => {
        if (walletChain(wallet.name) !== chain) return false;
        return !isInstallRequired(wallet)
          || popular.has(baseWalletName(wallet.name).toLowerCase());
      });
      result[chain] = dedupeWallets([
        ...matching.filter((wallet) => !isInstallRequired(wallet)),
        ...matching.filter((wallet) => isInstallRequired(wallet)),
      ]);
    }
    return result;
  }, [allWallets, socialNames]);

  useEffect(() => {
    if (!open || wasOpenRef.current) {
      wasOpenRef.current = open;
      return;
    }
    wasOpenRef.current = true;
    setShowMore(false);
    const hasDetectedEvm = availableByChain.EVM.some((wallet) => !isInstallRequired(wallet));
    const hasDetectedSolana = availableByChain.Solana.some((wallet) => !isInstallRequired(wallet));
    setActiveChain(hasDetectedEvm ? "EVM" : hasDetectedSolana ? "Solana" : "Aptos");
    try {
      const saved = window.localStorage.getItem(EVM_SOURCE_CHAIN_STORAGE_KEY) as EvmCctpSourceChain | null;
      if (saved && EVM_SOURCE_CHAINS.includes(saved)) setEvmSourceChain(saved);
    } catch {
      // Storage is optional; the visible selector remains authoritative.
    }
  }, [availableByChain, open]);

  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.matchMedia("(min-width: 640px)").matches) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const handleConnect = useCallback(async (walletName: string) => {
    setConnecting(walletName);
    try {
      await connect(walletName);
      onClose();
    } catch {
      // Wallet rejection leaves the selector open so another option can be used.
    } finally {
      setConnecting(null);
    }
  }, [connect, onClose]);

  const selectEvmSourceChain = useCallback((chain: EvmCctpSourceChain) => {
    setEvmSourceChain(chain);
    storeEvmSourceChain(chain);
  }, []);

  if (!open || !mounted) return null;

  const chainWallets = availableByChain[activeChain];
  const primaryWallets = chainWallets.slice(0, 3);
  const hiddenWallets = chainWallets.slice(3);
  const rows = showMore ? chainWallets : primaryWallets;

  const walletRow = (wallet: AnyWallet) => {
    const needsInstall = isInstallRequired(wallet);
    const displayName = baseWalletName(wallet.name);
    const rowClass = "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.035] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07]";
    const identity = (
      <span className="flex min-w-0 items-center gap-3">
        {wallet.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wallet.icon} alt="" className="size-7 shrink-0 rounded-md object-contain" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-xs font-bold text-zinc-400">
            {displayName.charAt(0)}
          </span>
        )}
        <span className="truncate text-[13px] font-semibold text-zinc-200">{displayName}</span>
      </span>
    );

    if (needsInstall) {
      return (
        <a
          key={wallet.name}
          href={(wallet as { url?: string }).url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className={rowClass}
        >
          {identity}
          <span className="shrink-0 text-[11px] font-medium text-zinc-500">Install</span>
        </a>
      );
    }

    return (
      <button
        key={wallet.name}
        type="button"
        onClick={() => void handleConnect(wallet.name)}
        disabled={connecting !== null}
        className={cn(rowClass, "disabled:cursor-wait disabled:opacity-50")}
      >
        {identity}
        <span className="shrink-0 text-[11px] font-medium text-accent">
          {connecting === wallet.name ? "Connecting…" : "Connect"}
        </span>
      </button>
    );
  };

  const selectorContent = (
    <div className="space-y-4 bg-[#101010] py-3 font-mono sm:py-0">
      {googleWallet ? (
        <button
          type="button"
          onClick={() => void handleConnect(googleWallet.name)}
          disabled={connecting !== null}
          className="flex min-h-12 w-full items-center justify-between rounded-lg bg-accent px-4 py-3 text-left text-[13px] font-bold text-black transition-[filter] hover:brightness-95 disabled:cursor-wait disabled:opacity-50"
        >
          <span>Continue with Google</span>
          <span>{connecting === googleWallet.name ? "Connecting…" : "Continue"}</span>
        </button>
      ) : null}

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/[0.035] p-1" role="tablist" aria-label="Wallet network">
        {CHAIN_TABS.map((chain) => (
          <button
            key={chain}
            type="button"
            role="tab"
            aria-selected={activeChain === chain}
            onClick={() => {
              setActiveChain(chain);
              setShowMore(false);
            }}
            className={cn(
              "rounded-md px-3 py-2 text-[12px] font-semibold transition-colors",
              activeChain === chain
                ? "bg-white/[0.1] text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            {chain}
          </button>
        ))}
      </div>

      {activeChain === "EVM" ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">USDC source</p>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.05] p-1">
            {EVM_SOURCE_CHAINS.map((chain) => (
              <button
                key={chain}
                type="button"
                aria-pressed={evmSourceChain === chain}
                onClick={() => selectEvmSourceChain(chain)}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors",
                  evmSourceChain === chain
                    ? "bg-white/[0.1] text-zinc-100"
                    : "text-zinc-600 hover:text-zinc-300",
                )}
              >
                {chain}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.map(walletRow)}
        {showMore && appleWallet ? walletRow(appleWallet) : null}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-zinc-600">
            No {activeChain} wallets detected.
          </div>
        ) : null}
      </div>

      {(hiddenWallets.length > 0 || appleWallet) ? (
        <button
          type="button"
          onClick={() => setShowMore((value) => !value)}
          aria-expanded={showMore}
          className="flex w-full items-center justify-center gap-2 py-2 text-[11px] font-semibold text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {showMore ? "Show fewer wallets" : `Show more wallets${hiddenWallets.length ? ` (${hiddenWallets.length + (appleWallet ? 1 : 0)})` : ""}`}
          <ChevronDown className={cn("size-3 transition-transform", showMore && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}

      <p className="px-2 text-center text-[11px] leading-relaxed text-zinc-600">
        By connecting, you agree to cash.trading&apos;s Terms of Service and Privacy Policy.
      </p>
    </div>
  );

  return createPortal(
    <div className="cash-trade-theme">
      <MobileModalSheet
        open={open}
        onClose={onClose}
        title="Connect wallet"
        description="Choose Aptos, Solana, or EVM"
        titleId="wallet-selector-title"
      >
        {selectorContent}
      </MobileModalSheet>

      <div
        className="fixed inset-0 z-[9999] hidden items-center justify-center px-4 py-4 sm:flex"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/85" />
        <div
          ref={dialogRef}
          aria-labelledby="wallet-selector-title-desktop"
          aria-modal="true"
          role="dialog"
          onClick={(event) => event.stopPropagation()}
          className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[620px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#101010] shadow-2xl shadow-black/70"
          style={{ animation: "market-modal-in 0.2s ease-out" }}
        >
          <header className="flex items-center justify-between border-b border-white/[0.06] bg-[#171717] px-5 py-3 font-mono text-[13px] font-semibold text-[#888]">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-accent" />
              <span id="wallet-selector-title-desktop">CONNECT WALLET</span>
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent">
                {activeChain}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close wallet selector"
              className="rounded-md p-2 text-[#666] transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </header>
          <div className="max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain p-4">
            {selectorContent}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
