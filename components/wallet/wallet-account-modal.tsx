"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { explorerAccountUrl } from "@/lib/constants";
import { DecibelAccountManager } from "@/components/trade/DecibelAccountManager";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { ProductSegmented } from "@/components/ui/product-surface";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useEvmSourceChain } from "@/hooks/useEvmSourceChain";
import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";
import { formatWalletConnectionName, getChainFromWallet, getPreferredWalletIcon } from "@/lib/wallet-utils";
import {
  getDecibelPublicNetwork,
  onDecibelPublicNetworkChange,
  setDecibelPublicNetwork,
  type DecibelPublicNetwork,
} from "@/lib/decibel-public";

interface WalletAccountModalProps {
  open: boolean;
  onClose: () => void;
}

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Quiet text action: same shape as every other control in the sheet. */
const TEXT_BUTTON = cn(
  PRESSABLE_CONTROL,
  FOCUS_RING,
  "flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium sm:min-h-10",
);

export function WalletAccountModal({ open, onClose }: WalletAccountModalProps) {
  const { account, wallet, disconnect, connected, network: walletNetwork } = useWallet();
  const {
    adapterAddress,
    originAddress,
    owner,
    usesDecibelDomainIdentity,
  } = useDecibelSubaccounts();
  const [copied, setCopied] = useState(false);
  const [decibelNetwork, setDecibelNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());
  const isEvmWallet = wallet ? getChainFromWallet(wallet) === "ethereum" : false;
  const activeEvmSourceChain = useEvmSourceChain({
    enabled: connected && isEvmWallet,
    preferredWalletName: wallet?.name,
  });
  const walletDisplayName = wallet?.name
    ? formatWalletConnectionName(wallet.name, activeEvmSourceChain)
    : "Wallet";
  const walletIcon = wallet?.name
    ? getPreferredWalletIcon(wallet.name, wallet.icon)
    : wallet?.icon;

  // The app's Decibel network and the wallet's own network are independent; a
  // mismatch makes testnet-only calls (e.g. the USDC faucet) fail in the wallet
  // with a raw module_not_found error. Warn before the user hits that wall.
  const walletNetworkName = walletNetwork?.name?.toLowerCase() ?? "";
  const walletNetworkMismatch =
    connected &&
    Boolean(walletNetworkName) &&
    walletNetworkName !== decibelNetwork;

  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

  if (!open || !connected || !account) return null;

  const address = originAddress || adapterAddress;
  const shortAddress = address
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : "";
  const explorerUrl = explorerAccountUrl(owner || adapterAddress);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = async () => {
    await disconnect();
    onClose();
  };

  // One column, top to bottom: who you are → which network → balance and
  // deposit → bridge → leave. Sections are separated by a hairline, never by
  // nested cards or repeated headings.
  const accountContent = (
    <div className="space-y-4 py-3 sm:py-0">
      <div className="flex items-center gap-3">
        <div className="size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-card">
          {walletIcon ? (
            <img src={walletIcon} alt="" className="size-10" />
          ) : (
            <div className="flex size-10 items-center justify-center bg-accent/10 text-base font-bold text-accent">
              {walletDisplayName.charAt(0) || "?"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{walletDisplayName}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={address}>
            {shortAddress}
          </p>
        </div>
        <button
          type="button"
          onClick={copyAddress}
          aria-label={copied ? "Address copied" : "Copy wallet address"}
          className={cn(TEXT_BUTTON, "-mr-3 shrink-0 text-[11px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 sm:-mr-2")}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {usesDecibelDomainIdentity && owner && (
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={owner}>
          Decibel owner {owner.slice(0, 10)}...{owner.slice(-8)}
        </p>
      )}

      <div className="border-t border-card-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <span
            id="wallet-account-network-label"
            className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Network
          </span>
          <ProductSegmented
            role="group"
            aria-labelledby="wallet-account-network-label"
            className="shrink-0"
          >
            {(["mainnet", "testnet"] as const).map((network) => (
              <button
                key={network}
                type="button"
                aria-pressed={decibelNetwork === network}
                onClick={() => setDecibelPublicNetwork(network)}
                className={cn(
                  PRESSABLE_CONTROL,
                  FOCUS_RING,
                  "min-h-9 rounded-[var(--radius-xs)] px-3 text-[11px] font-semibold uppercase tracking-wide sm:min-h-7",
                  decibelNetwork === network
                    ? "bg-card text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {network}
              </button>
            ))}
          </ProductSegmented>
        </div>
        {walletNetworkMismatch && (
          <p
            role="alert"
            className="mt-2 rounded-[var(--radius-sm)] bg-warning/10 px-3 py-2 text-[11px] leading-4 text-warning"
          >
            Wallet is on {walletNetworkName}, app is on {decibelNetwork}. Switch networks in
            your wallet before depositing.
          </p>
        )}
      </div>

      <DecibelAccountManager className="border-t border-card-border pt-4" />

      <div className="grid grid-cols-2 gap-2 border-t border-card-border pt-4">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(TEXT_BUTTON, "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100")}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Explorer
        </a>
        <button
          type="button"
          onClick={handleDisconnect}
          className={cn(TEXT_BUTTON, "text-danger hover:bg-danger/[0.08]")}
        >
          Disconnect
        </button>
      </div>
    </div>
  );

  return (
    <ResponsiveModalSheet
      open={open}
      onClose={onClose}
      title="Account"
      description="Balance, deposits and bridge"
      desktopContentClassName="pt-4"
      desktopMaxWidthClassName="sm:!max-w-lg"
      titleId="wallet-account-modal-title"
    >
      {accountContent}
    </ResponsiveModalSheet>
  );
}
