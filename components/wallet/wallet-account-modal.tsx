"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { explorerAccountUrl } from "@/lib/constants";
import { DecibelAccountManager } from "@/components/trade/DecibelAccountManager";
import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { useDecibelSubaccounts } from "@/hooks/useDecibelSubaccounts";
import { useEvmSourceChain } from "@/hooks/useEvmSourceChain";
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

  const accountContent = (
    <div className="space-y-5 py-4 sm:pb-0 sm:pt-5">
          <div className="flex items-center gap-3">
            <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.04]">
              {walletIcon ? (
                <img src={walletIcon} alt="" className="size-10" />
              ) : (
                <div className="flex size-10 items-center justify-center bg-accent/10">
                  <span className="text-accent font-bold text-[16px]">
                    {walletDisplayName.charAt(0) || "?"}
                  </span>
                </div>
              )}
            </div>
            <div>
              <p className="text-[14px] font-medium text-white">{walletDisplayName}</p>
              <p className="text-[12px] text-zinc-500 mt-0.5">Connected</p>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pt-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Connected address
                </p>
                <p className="mt-1 truncate font-mono text-[13px] text-zinc-300">
                {shortAddress}
                </p>
              </div>
              <button
                type="button"
                onClick={copyAddress}
                className="shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {usesDecibelDomainIdentity && owner && (
              <div className="mt-3 rounded-md bg-white/[0.03] px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">
                  Decibel owner
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-500" title={owner}>
                  {owner.slice(0, 10)}...{owner.slice(-8)}
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Decibel Network
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Market data, orders, and positions
                </p>
              </div>
              <div className="grid shrink-0 grid-cols-2 rounded-md bg-white/[0.05] p-0.5">
                {(["mainnet", "testnet"] as const).map((network) => (
                  <button
                    key={network}
                    type="button"
                    onClick={() => setDecibelPublicNetwork(network)}
                    className={`rounded px-2.5 py-1.5 text-[11px] font-bold uppercase transition-colors ${
                      decibelNetwork === network
                        ? "bg-accent text-black"
                        : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    {network}
                  </button>
                ))}
              </div>
            </div>
            {walletNetworkMismatch && (
              <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
                Your wallet is connected to <span className="font-bold uppercase">{walletNetworkName}</span> but
                the app is set to <span className="font-bold uppercase">{decibelNetwork}</span>. Switch the
                network inside your wallet app too — otherwise {decibelNetwork}-only actions like the faucet
                will fail with a &quot;module not found&quot; error.
              </p>
            )}
          </div>

          <DecibelAccountManager className="border-t border-white/[0.06] pt-4" />

          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-md py-2.5 text-[13px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Explorer
            </a>
            <button
              type="button"
              onClick={handleDisconnect}
              className="rounded-md py-2.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/[0.08]"
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
      description="Wallet, Decibel account, and transfers"
      titleId="wallet-account-modal-title"
    >
      {accountContent}
    </ResponsiveModalSheet>
  );
}
