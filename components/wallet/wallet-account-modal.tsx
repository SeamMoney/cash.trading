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
      <div className="absolute inset-0 bg-black/75 modal-backdrop" onClick={onClose} />

      <div className="relative w-full max-h-[calc(100dvh-16px)] overflow-y-auto bg-[#0b0b0b] px-5 pb-5 pt-4 shadow-2xl shadow-black/60 sm:mx-4 sm:max-w-[440px] sm:rounded-[14px] sm:border sm:border-white/[0.08] sm:px-6 sm:pb-6 modal-panel">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[18px] font-semibold text-zinc-100">
            Account
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="flex size-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.04]">
              {wallet?.icon ? (
                <img src={wallet.icon} alt="" className="size-10" />
              ) : (
                <div className="flex size-10 items-center justify-center bg-accent/10">
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

          <div className="border-t border-white/[0.06] pt-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
                  Address
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

        <div className="pb-[env(safe-area-inset-bottom)]" />
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
