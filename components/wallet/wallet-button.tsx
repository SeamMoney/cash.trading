"use client"

import { useState } from "react"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Wallet, ChevronDown, Copy, LogOut } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { WalletSelector, getWalletIcon } from "./wallet-selector"

// Aptos logo with ring for keyless wallets
function AptosKeylessIcon() {
  return (
    <div className="relative w-6 h-6">
      <div className="absolute inset-0 rounded-full border border-primary" />
      <svg
        width="14"
        height="14"
        viewBox="0 0 600 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <path d="M30.6608 171.033C18.0837 197.498 9.30164 226.119 5 256.181H255.339L309.999 171.033H30.6608Z" fill="white"/>
        <path d="M594.999 256.182C590.687 226.111 581.915 197.499 569.338 171.034H419.288L364.648 85.8753H508.549C454.803 33.2026 381.199 0.716797 299.994 0.716797C218.79 0.716797 145.195 33.2026 91.4395 85.8653H364.648L309.988 171.024L364.648 256.172H594.989L594.999 256.182Z" fill="white"/>
        <path d="M146.04 426.5L91.3809 511.648C145.136 564.311 218.601 597.284 299.805 597.284C381.01 597.284 455.718 565.99 509.672 511.648H200.7L146.04 426.5Z" fill="white"/>
        <path d="M200.68 341.331H5C9.31157 371.412 18.0837 400.024 30.6608 426.489H146.04L200.68 341.331Z" fill="white"/>
        <path d="M255.339 426.499H569.339C581.916 400.034 590.698 371.413 595 341.351H309.999L255.339 256.192L200.68 341.341" fill="white"/>
      </svg>
    </div>
  )
}

export function WalletButton() {
  const { connected, account, disconnect, wallet } = useWallet()
  const { balance, aptBalance, subaccount, loading } = useWalletBalance()
  const [showWalletSelector, setShowWalletSelector] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(null), 1500)
  }

  const formatAddress = (addr: string | { toString(): string }) => {
    const addrStr = typeof addr === 'string' ? addr : addr.toString()
    return `${addrStr.slice(0, 6)}...${addrStr.slice(-4)}`
  }

  // Check if connected via X-Chain (derived wallet from EVM/Solana)
  const isXChainWallet = wallet?.name?.toLowerCase().includes('ethereum') ||
                          wallet?.name?.toLowerCase().includes('metamask') ||
                          wallet?.name?.toLowerCase().includes('phantom') ||
                          wallet?.name?.toLowerCase().includes('solana') ||
                          wallet?.name?.toLowerCase().includes('rainbow') ||
                          wallet?.name?.toLowerCase().includes('rabby') ||
                          wallet?.name?.toLowerCase().includes('backpack')

  // Check if connected via Aptos Keyless (Google/Apple social login)
  const isKeylessWallet = wallet?.name?.toLowerCase().includes('google') ||
                          wallet?.name?.toLowerCase().includes('apple')

  const walletDisplayName = isKeylessWallet
    ? 'Aptos'
    : wallet?.name?.replace(' (Solana)', '').replace(' (Ethereum)', '') || 'Wallet'

  const walletIcon = getWalletIcon(wallet?.name || '', wallet?.icon)

  if (connected && account) {
    return (
      <>
        {/* Compact header button - address and balance on same line */}
        <button
          onClick={() => setShowAccountModal(true)}
          className="group flex items-center gap-2 px-3 py-2 bg-black/60 border border-primary/20 hover:border-primary/40 transition-all hover:bg-black/80"
        >
          {/* Wallet icon */}
          {isKeylessWallet ? (
            <AptosKeylessIcon />
          ) : walletIcon ? (
            <img src={walletIcon} alt={walletDisplayName} className="w-6 h-6" />
          ) : (
            <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Wallet className="size-3 text-primary" />
            </div>
          )}
          <span className="text-[11px] font-mono text-zinc-400 group-hover:text-zinc-300 transition-colors">
            {formatAddress(account.address)}
          </span>
          {/* X-Chain Badge */}
          {isXChainWallet && (
            <span className="px-1 py-0.5 bg-orange-500/20 text-orange-400 text-[9px] font-semibold">
              X-CHAIN
            </span>
          )}
          <span className="text-sm font-bold text-primary tabular-nums">
            {loading ? '...' : `$${(balance ?? 0).toFixed(2)}`}
          </span>
          <ChevronDown className="size-3 text-zinc-500 group-hover:text-zinc-400 transition-colors" />
        </button>

        {/* Account Modal - Ticket style */}
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-black border border-primary/30 w-[calc(100vw-2rem)] max-w-xs p-0 overflow-hidden">
            <DialogHeader className="sr-only">
              <DialogTitle>Account</DialogTitle>
              <DialogDescription>Your wallet details</DialogDescription>
            </DialogHeader>

            {/* Gradient header with wallet info */}
            <div className="relative p-5 bg-gradient-to-br from-primary/20 via-black to-black">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_50%_50%,_white_1px,_transparent_1px)] bg-[length:16px_16px]" />
              <div className="relative">
                {/* Wallet type indicator */}
                <div className="flex items-center justify-center gap-2 mb-3">
                  {isKeylessWallet ? (
                    <div className="relative w-10 h-10">
                      <div className="absolute inset-0 rounded-full border-2 border-primary" />
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 600 600"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                      >
                        <path d="M30.6608 171.033C18.0837 197.498 9.30164 226.119 5 256.181H255.339L309.999 171.033H30.6608Z" fill="white"/>
                        <path d="M594.999 256.182C590.687 226.111 581.915 197.499 569.338 171.034H419.288L364.648 85.8753H508.549C454.803 33.2026 381.199 0.716797 299.994 0.716797C218.79 0.716797 145.195 33.2026 91.4395 85.8653H364.648L309.988 171.024L364.648 256.172H594.989L594.999 256.182Z" fill="white"/>
                        <path d="M146.04 426.5L91.3809 511.648C145.136 564.311 218.601 597.284 299.805 597.284C381.01 597.284 455.718 565.99 509.672 511.648H200.7L146.04 426.5Z" fill="white"/>
                        <path d="M200.68 341.331H5C9.31157 371.412 18.0837 400.024 30.6608 426.489H146.04L200.68 341.331Z" fill="white"/>
                        <path d="M255.339 426.499H569.339C581.916 400.034 590.698 371.413 595 341.351H309.999L255.339 256.192L200.68 341.341" fill="white"/>
                      </svg>
                    </div>
                  ) : walletIcon ? (
                    <img src={walletIcon} alt={walletDisplayName} className="w-10 h-10" />
                  ) : null}
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold">{walletDisplayName}</span>
                    {isXChainWallet && (
                      <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-semibold">
                        X-CHAIN
                      </span>
                    )}
                  </div>
                </div>

                {/* Balance */}
                <div className="text-center">
                  <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-wide">Balance</div>
                  <div className="text-4xl font-mono font-bold text-primary tabular-nums mt-1">
                    ${loading ? '---' : (balance ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* X-Chain / Keyless Info */}
            {(isXChainWallet || isKeylessWallet) && (
              <div className="mx-4 -mt-1 mb-2">
                {isKeylessWallet && (
                  <div className="p-2.5 bg-primary/10 border border-primary/30">
                    <div className="text-primary text-xs text-center">
                      Aptos Keyless via {wallet?.name?.includes('Google') ? 'Google' : 'Apple'}
                    </div>
                  </div>
                )}
                {isXChainWallet && (
                  <div className="p-2.5 bg-orange-500/10 border border-orange-500/30">
                    <div className="text-orange-400 text-xs text-center">
                      Connected via X-Chain (AIP-113)
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Rip line */}
            <div className="relative flex h-5 w-full items-center">
              <div className="absolute -left-2.5 h-5 w-5 rounded-full bg-zinc-950" />
              <div className="w-full border-t-2 border-dashed border-white/20" />
              <div className="absolute -right-2.5 h-5 w-5 rounded-full bg-zinc-950" />
            </div>

            {/* Details */}
            <div className="px-4 pb-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 font-mono uppercase">Wallet</span>
                <div className="flex items-center gap-1.5">
                  <code className="text-white font-mono">{formatAddress(account.address)}</code>
                  <button onClick={() => copyAddress(account.address.toString())} className="p-1 hover:bg-white/10" aria-label="Copy">
                    <Copy className={`size-3 ${copied === account.address.toString() ? 'text-green-400' : 'text-zinc-600'}`} />
                  </button>
                </div>
              </div>
              {subaccount && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-mono uppercase">Subaccount</span>
                  <div className="flex items-center gap-1.5">
                    <code className="text-white font-mono">{formatAddress(subaccount)}</code>
                    <button onClick={() => copyAddress(subaccount)} className="p-1 hover:bg-white/10" aria-label="Copy">
                      <Copy className={`size-3 ${copied === subaccount ? 'text-green-400' : 'text-zinc-600'}`} />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 font-mono uppercase">APT</span>
                <span className="text-white font-mono tabular-nums">{loading ? '...' : (aptBalance?.toFixed(2) ?? '0')}</span>
              </div>

              {/* Barcode */}
              <div className="flex justify-center gap-0.5 pt-3">
                {[...Array(20)].map((_, i) => (
                  <div key={i} className={`bg-white/20 ${i % 3 === 0 ? 'w-0.5 h-5' : i % 2 === 0 ? 'w-1 h-5' : 'w-0.5 h-3'}`} />
                ))}
              </div>

              {/* Disconnect */}
              <button
                onClick={async () => {
                  setShowAccountModal(false)
                  await disconnect()
                }}
                className="w-full mt-2 p-2.5 flex items-center justify-center gap-2 text-xs font-mono uppercase tracking-wide text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/10 transition-all"
              >
                <LogOut className="size-3" />
                Disconnect
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowWalletSelector(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_20px_rgba(255,246,0,0.3)] transition-colors"
      >
        <Wallet className="size-4" />
        Connect
      </button>

      <WalletSelector
        isOpen={showWalletSelector}
        onClose={() => setShowWalletSelector(false)}
      />
    </>
  )
}
