"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut, User, Loader2, AlertTriangle } from "lucide-react"
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

        {/* Account Modal - Clean dark design with scroll */}
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-black border border-white/10 w-[calc(100vw-2rem)] max-w-sm max-h-[85vh] p-0 overflow-hidden rounded-xl flex flex-col">
            {/* Header with glow */}
            <div className="relative px-5 py-4 border-b border-white/10 flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
              <DialogHeader className="relative">
                <DialogTitle className="text-white font-semibold text-base">Account</DialogTitle>
                <DialogDescription className="text-zinc-500 text-xs">Decibel Trading Account</DialogDescription>
              </DialogHeader>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              {/* Balance Hero */}
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-zinc-900 to-black border border-white/10 p-5">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                <div className="relative">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-800 rounded-full w-fit mb-2">
                    <User className="size-3 text-zinc-400" />
                    <span className="text-[10px] font-mono uppercase text-zinc-400">Primary</span>
                  </div>
                  <div className="text-4xl font-bold text-white tabular-nums tracking-tight">
                    ${loading ? '---' : (balance ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">Available Margin (USDC)</div>
                </div>
              </div>

              {/* Warning if balance fetch failed */}
              {!loading && balance === 0 && subaccount && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="size-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-yellow-500/80">
                    <p className="font-semibold mb-1">No balance found</p>
                    <p>Your subaccount may not be initialized yet. Try trading on <a href="https://app.decibel.trade" target="_blank" rel="noopener noreferrer" className="underline">app.decibel.trade</a> first to create your account.</p>
                  </div>
                </div>
              )}

              {/* Wallet Info Card */}
              <div className="space-y-3">
                {/* Connected Wallet */}
                <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase text-zinc-500">Connected Wallet</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyAddress(account.address.toString())}
                        className="p-1 hover:bg-white/5 rounded transition-colors"
                        aria-label="Copy wallet address"
                      >
                        <Copy className={`size-3 transition-colors ${copied === account.address.toString() ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-400'}`} />
                      </button>
                      <a
                        href={`https://explorer.aptoslabs.com/account/${account.address}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 hover:bg-white/5 rounded transition-colors"
                        aria-label="View on explorer"
                      >
                        <ExternalLink className="size-3 text-zinc-500 hover:text-zinc-400" />
                      </a>
                    </div>
                  </div>
                  <code className="text-xs text-white font-mono break-all">{account.address.toString()}</code>
                </div>

                {/* Trading Subaccount */}
                {subaccount && (
                  <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono uppercase text-zinc-500">Trading Subaccount</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyAddress(subaccount)}
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                          aria-label="Copy subaccount address"
                        >
                          <Copy className={`size-3 transition-colors ${copied === subaccount ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-400'}`} />
                        </button>
                        <a
                          href={`https://explorer.aptoslabs.com/account/${subaccount}?network=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                          aria-label="View subaccount on explorer"
                        >
                          <ExternalLink className="size-3 text-zinc-500 hover:text-zinc-400" />
                        </a>
                      </div>
                    </div>
                    <code className="text-xs text-white font-mono break-all">{subaccount}</code>
                  </div>
                )}
              </div>

              {/* Balance Breakdown */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg">
                  <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">Testnet APT</div>
                  <div className="text-lg font-bold text-white tabular-nums">
                    {loading ? '...' : (aptBalance?.toFixed(2) ?? '0')}
                  </div>
                </div>
                <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg">
                  <div className="text-[10px] font-mono uppercase text-zinc-500 mb-1">USDC Balance</div>
                  <div className="text-lg font-bold text-primary tabular-nums">
                    ${loading ? '...' : (balance ?? 0).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Disconnect Button */}
              <button
                onClick={() => { disconnect(); setShowAccountModal(false) }}
                className="w-full p-2.5 bg-zinc-900/50 border border-white/5 hover:border-red-500/30 rounded-lg flex items-center justify-center gap-2 text-zinc-400 hover:text-red-400 transition-all"
              >
                <LogOut className="size-4" />
                <span className="text-sm">Disconnect</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <>
      <Button
        onClick={() => setShowWalletModal(true)}
        className="bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_20px_rgba(255,246,0,0.3)]"
      >
        <Wallet className="w-4 h-4 mr-2" />
        Connect Wallet
      </Button>

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
