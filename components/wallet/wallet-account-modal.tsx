"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { explorerAccountUrl } from "@/lib/constants";
import { DecibelAccountManager } from "@/components/trade/DecibelAccountManager";
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
  const { account, wallet, disconnect, connected } = useWallet();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [decibelNetwork, setDecibelNetwork] = useState<DecibelPublicNetwork>(() => getDecibelPublicNetwork());

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => onDecibelPublicNetworkChange(setDecibelNetwork), []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  if (!open || !mounted || !connected || !account) return null;

  const address = account.address?.toString() ?? "";
  const shortAddress = address
    ? `${address.slice(0, 10)}...${address.slice(-8)}`
    : "";
  const explorerUrl = explorerAccountUrl(address);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDisconnect = async () => {
    await disconnect();
    onClose();
  };

  const content = (
    <div className="cash-trade-theme fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm modal-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-h-[calc(100dvh-24px)] overflow-y-auto sm:max-w-[460px] sm:mx-4 bg-[var(--background-secondary)] border border-white/[0.08] sm:rounded-2xl rounded-t-2xl modal-panel">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="font-display font-semibold text-[18px] tracking-tight">
            Account
          </h2>
          <button
            onClick={onClose}
            aria-label="Close account modal"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 pb-5">
          {/* Wallet identity */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
              {wallet?.icon ? (
                <img src={wallet.icon} alt="" className="w-11 h-11" />
              ) : (
                <div className="w-11 h-11 bg-accent/10 flex items-center justify-center">
                  <span className="text-accent font-bold text-[16px]">
                    {wallet?.name?.charAt(0) ?? "?"}
                  </span>
                </div>
              )}
            </div>
            <div>
              <p className="text-[14px] font-medium text-white">{wallet?.name}</p>
              <p className="text-[12px] text-zinc-500 mt-0.5">Connected</p>
            </div>
          </div>

          {/* Address card */}
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 mb-4">
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider mb-2">
              Address
            </p>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-mono text-zinc-300 flex-1 min-w-0 truncate">
                {shortAddress}
              </p>
              <button
                onClick={copyAddress}
                className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  Decibel Network
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Market data, orders, and positions
                </p>
              </div>
              <div className="grid grid-cols-2 rounded-lg border border-white/[0.06] bg-black/20 p-0.5">
                {(["mainnet", "testnet"] as const).map((network) => (
                  <button
                    key={network}
                    type="button"
                    onClick={() => setDecibelPublicNetwork(network)}
                    className={`rounded-md px-2.5 py-1.5 text-[11px] font-bold uppercase transition-colors ${
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
          </div>

          <DecibelAccountManager className="mb-4" />

          {/* Actions */}
          <div className="flex gap-2">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Explorer
            </a>
            <button
              onClick={handleDisconnect}
              className="flex-1 py-2.5 rounded-xl text-[13px] font-medium text-danger bg-danger/[0.06] border border-danger/[0.10] hover:bg-danger/[0.12] transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>

        <div className="pb-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
