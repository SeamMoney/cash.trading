"use client";

import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { createPortal } from "react-dom";
import { useState, useEffect } from "react";
import { explorerAccountUrl } from "@/lib/constants";
import { DecibelAccountManager } from "@/components/trade/DecibelAccountManager";

interface WalletAccountModalProps {
  open: boolean;
  onClose: () => void;
}

export function WalletAccountModal({ open, onClose }: WalletAccountModalProps) {
  const { account, wallet, disconnect, connected } = useWallet();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

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
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
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

          <DecibelAccountManager className="mb-4" />

          {/* Actions */}
          <div className="flex gap-2">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium text-zinc-400 bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
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
