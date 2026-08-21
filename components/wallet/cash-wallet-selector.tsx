"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {
  groupAndSortWallets,
  isInstallRequired,
} from "@aptos-labs/wallet-adapter-core";
import type {
  AdapterNotDetectedWallet,
  AdapterWallet,
} from "@aptos-labs/wallet-adapter-core";
import { ChevronDown } from "lucide-react";

import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { ProductSegmented } from "@/components/ui/product-surface";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import {
  EVM_SOURCE_CHAIN_STORAGE_KEY,
  storeEvmSourceChain,
  type EvmCctpSourceChain,
} from "@/lib/evm-cctp";
import { cn } from "@/lib/utils";
import { getPreferredWalletIcon, isRainbowWallet } from "@/lib/wallet-utils";

type AnyWallet = AdapterWallet | AdapterNotDetectedWallet;
type WalletChain = "Aptos" | "Solana" | "EVM";

interface WalletSelectorProps {
  open: boolean;
  onClose: () => void;
  preferredChain?: WalletChain;
}

const CHAIN_TABS: WalletChain[] = ["Aptos", "Solana", "EVM"];
const EVM_SOURCE_CHAINS: EvmCctpSourceChain[] = ["Arbitrum", "Base", "Ethereum"];
const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SEGMENT = cn(
  PRESSABLE_CONTROL,
  FOCUS_RING,
  "min-h-9 rounded-[var(--radius-xs)] px-2 text-xs font-semibold sm:min-h-8",
);

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

export function WalletSelector({ open, onClose, preferredChain }: WalletSelectorProps) {
  const { connect, wallets, notDetectedWallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [activeChain, setActiveChain] = useState<WalletChain>("Aptos");
  const [evmSourceChain, setEvmSourceChain] = useState<EvmCctpSourceChain>("Arbitrum");
  const [showMore, setShowMore] = useState(false);
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
      const deduped = dedupeWallets([
        ...matching.filter((wallet) => !isInstallRequired(wallet)),
        ...matching.filter((wallet) => isInstallRequired(wallet)),
      ]);
      result[chain] = chain === "EVM"
        ? deduped.sort((a, b) => Number(isRainbowWallet(b.name)) - Number(isRainbowWallet(a.name)))
        : deduped;
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
    setActiveChain(preferredChain ?? (hasDetectedEvm ? "EVM" : hasDetectedSolana ? "Solana" : "Aptos"));
    try {
      const saved = window.localStorage.getItem(EVM_SOURCE_CHAIN_STORAGE_KEY) as EvmCctpSourceChain | null;
      if (saved && EVM_SOURCE_CHAINS.includes(saved)) setEvmSourceChain(saved);
    } catch {
      // Storage is optional; the visible selector remains authoritative.
    }
  }, [availableByChain, open, preferredChain]);

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
    const walletIcon = getPreferredWalletIcon(wallet.name, wallet.icon);
    const rowClass = cn(
      PRESSABLE_CONTROL,
      FOCUS_RING,
      "flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-card-border bg-card px-3 py-2.5 text-left hover:border-border-strong hover:bg-white/[0.07]",
    );
    const identity = (
      <span className="flex min-w-0 items-center gap-3">
        {walletIcon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={walletIcon} alt="" className="size-7 shrink-0 rounded-[var(--radius-xs)] object-contain" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-white/[0.06] text-xs font-bold text-zinc-400">
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
    <div className="space-y-4 py-3 sm:py-0">
      {googleWallet ? (
        <button
          type="button"
          onClick={() => void handleConnect(googleWallet.name)}
          disabled={connecting !== null}
          className={cn(
            PRESSABLE_CONTROL,
            FOCUS_RING,
            "flex min-h-12 w-full items-center justify-between rounded-[var(--radius-sm)] bg-accent px-4 py-3 text-left text-sm font-semibold text-accent-foreground hover:brightness-95 disabled:cursor-wait disabled:opacity-50",
          )}
        >
          <span>Continue with Google</span>
          <span>{connecting === googleWallet.name ? "Connecting…" : "Continue"}</span>
        </button>
      ) : null}

      <ProductSegmented className="grid grid-cols-3" role="tablist" aria-label="Wallet network">
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
              SEGMENT,
              activeChain === chain
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {chain}
          </button>
        ))}
      </ProductSegmented>

      {activeChain === "EVM" ? (
        <div>
          <p id="wallet-selector-usdc-source" className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">USDC source</p>
          <ProductSegmented className="grid grid-cols-3" role="group" aria-labelledby="wallet-selector-usdc-source">
            {EVM_SOURCE_CHAINS.map((chain) => (
              <button
                key={chain}
                type="button"
                aria-pressed={evmSourceChain === chain}
                onClick={() => selectEvmSourceChain(chain)}
                className={cn(
                  SEGMENT,
                  "text-[11px]",
                  evmSourceChain === chain
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {chain}
              </button>
            ))}
          </ProductSegmented>
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.map(walletRow)}
        {showMore && appleWallet ? walletRow(appleWallet) : null}
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-card-border px-4 py-8 text-center text-xs text-muted-foreground">
            No {activeChain} wallets detected.
          </div>
        ) : null}
      </div>

      {(hiddenWallets.length > 0 || appleWallet) ? (
        <button
          type="button"
          onClick={() => setShowMore((value) => !value)}
          aria-expanded={showMore}
          className={cn(FOCUS_RING, "flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] text-[11px] font-semibold text-zinc-500 transition-colors hover:text-zinc-300")}
        >
          {showMore ? "Show fewer wallets" : `Show more wallets${hiddenWallets.length ? ` (${hiddenWallets.length + (appleWallet ? 1 : 0)})` : ""}`}
          <ChevronDown className={cn("size-3 transition-transform", showMore && "rotate-180")} aria-hidden="true" />
        </button>
      ) : null}

      <p className="px-2 text-center text-[11px] leading-4 text-muted-foreground">
        By connecting, you agree to cash.trading&apos;s Terms of Service and Privacy Policy.
      </p>
    </div>
  );

  return (
    <ResponsiveModalSheet
      badge={activeChain}
      desktopContentClassName="p-4"
      desktopMaxWidthClassName="sm:!max-w-[620px]"
      open={open}
      onClose={onClose}
      title="Connect wallet"
      description="Choose Aptos, Solana, or EVM"
      titleId="wallet-selector-title"
    >
      {selectorContent}
    </ResponsiveModalSheet>
  );
}
