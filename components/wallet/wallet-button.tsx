"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"

export function WalletButton() {
  const { connected, account, disconnect, wallets, connect } = useWallet()
  const { balance, aptBalance, subaccount, loading, refetch } = useWalletBalance()
  const [showWalletModal, setShowWalletModal] = useState(false)
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

  if (connected && account) {
    return (
      <>
        {/* Compact header button - address and balance on same line */}
        <button
          onClick={() => setShowAccountModal(true)}
          className="group flex items-center gap-2 px-3 py-2 bg-black/60 border border-primary/20 hover:border-primary/40 rounded-lg transition-all hover:bg-black/80"
        >
          <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center">
            <Wallet className="size-3 text-primary" />
          </div>
          <span className="text-[11px] font-mono text-zinc-400 group-hover:text-zinc-300 transition-colors">
            {formatAddress(account.address)}
          </span>
          <span className="text-sm font-bold text-primary tabular-nums">
            {loading ? '...' : `$${(balance ?? 0).toFixed(2)}`}
          </span>
          <ChevronDown className="size-3 text-zinc-500 group-hover:text-zinc-400 transition-colors" />
        </button>

        {/* Account Modal - Compact mobile-friendly design */}
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-zinc-950 border border-white/10 w-[calc(100vw-2rem)] max-w-xs p-4 rounded-xl">
            <DialogHeader className="pb-3 border-b border-white/10">
              <DialogTitle className="text-white text-sm font-medium">Account</DialogTitle>
              <DialogDescription className="sr-only">Your wallet details</DialogDescription>
            </DialogHeader>

            {/* Balance */}
            <div className="py-4 text-center">
              <div className="text-3xl font-bold text-primary tabular-nums">
                ${loading ? '---' : (balance ?? 0).toFixed(2)}
              </div>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wide mt-1">USDC Balance</div>
            </div>

            {/* Addresses */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 bg-black/50 rounded">
                <span className="text-zinc-500">Wallet</span>
                <div className="flex items-center gap-1">
                  <code className="text-zinc-300 font-mono">{formatAddress(account.address)}</code>
                  <button onClick={() => copyAddress(account.address.toString())} className="p-1 hover:bg-white/10 rounded" aria-label="Copy">
                    <Copy className={`size-3 ${copied === account.address.toString() ? 'text-green-400' : 'text-zinc-500'}`} />
                  </button>
                </div>
              </div>
              {subaccount && (
                <div className="flex items-center justify-between p-2 bg-black/50 rounded">
                  <span className="text-zinc-500">Subaccount</span>
                  <div className="flex items-center gap-1">
                    <code className="text-zinc-300 font-mono">{formatAddress(subaccount)}</code>
                    <button onClick={() => copyAddress(subaccount)} className="p-1 hover:bg-white/10 rounded" aria-label="Copy">
                      <Copy className={`size-3 ${copied === subaccount ? 'text-green-400' : 'text-zinc-500'}`} />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between p-2 bg-black/50 rounded">
                <span className="text-zinc-500">APT</span>
                <span className="text-white font-mono tabular-nums">{loading ? '...' : (aptBalance?.toFixed(2) ?? '0')}</span>
              </div>
            </div>

            {/* Disconnect */}
            <button
              onClick={() => { disconnect(); setShowAccountModal(false) }}
              className="w-full mt-4 p-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
            >
              Disconnect
            </button>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowWalletModal(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-black font-bold rounded-lg shadow-[0_0_20px_rgba(255,246,0,0.3)] transition-colors"
      >
        <Wallet className="size-4" />
        Connect
      </button>

      <Dialog open={showWalletModal} onOpenChange={setShowWalletModal}>
        <DialogContent className="bg-zinc-900/95 backdrop-blur border-white/10 w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden">
          <div className="px-4 py-3 bg-white/5 border-b border-white/10">
            <DialogHeader>
              <DialogTitle className="text-primary font-mono text-sm uppercase tracking-widest">Connect Wallet</DialogTitle>
              <DialogDescription className="text-zinc-500 text-xs">Choose a wallet</DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-4 space-y-2">
            {wallets?.filter((w) => w.readyState === "Installed" || w.readyState === "Loadable").length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-zinc-400">No Aptos wallets detected</p>
                <a href="https://petra.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-black font-medium rounded">
                  Get Petra Wallet <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ) : (
              wallets?.filter((w) => w.readyState === "Installed" || w.readyState === "Loadable").map((wallet) => (
                <button
                  key={wallet.name}
                  onClick={async () => {
                    try {
                      await connect(wallet.name as WalletName)
                      setShowWalletModal(false)
                    } catch (error) {
                      console.error("Failed to connect:", error)
                    }
                  }}
                  className="w-full flex items-center gap-3 p-3 bg-black/40 border border-white/10 rounded hover:border-primary/50 transition-all"
                >
                  {wallet.icon && <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded" />}
                  <span className="text-sm font-medium text-white">{wallet.name}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
