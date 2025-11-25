"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"

export function WalletButton() {
  const { connected, account, disconnect, wallets, connect } = useWallet()
  const { balance, subaccount, loading } = useWalletBalance()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
  }

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  if (connected && account) {
    return (
      <>
        <button
          onClick={() => setShowAccountModal(true)}
          className="flex items-center gap-3 px-4 py-2 bg-black/40 border border-white/10 rounded-lg hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm font-mono text-white">{formatAddress(account.address)}</span>
          </div>
          {!loading && balance !== null && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border border-primary/20 rounded">
              <span className="text-xs font-bold text-primary">${balance.toFixed(2)}</span>
              <span className="text-xs text-primary/60">USDC</span>
            </div>
          )}
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        </button>

        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-zinc-900 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-white">Account Details</DialogTitle>
              <DialogDescription className="text-zinc-400">Your connected wallet information</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Main Wallet Address */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500">WALLET ADDRESS</label>
                <div className="flex items-center gap-2 p-3 bg-black/40 border border-white/10 rounded-lg">
                  <span className="text-sm font-mono text-white flex-1">{account.address}</span>
                  <button
                    onClick={() => copyAddress(account.address)}
                    className="p-1.5 hover:bg-white/5 rounded transition-colors"
                  >
                    <Copy className="w-4 h-4 text-zinc-400" />
                  </button>
                  <a
                    href={`https://explorer.aptoslabs.com/account/${account.address}?network=testnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-white/5 rounded transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-zinc-400" />
                  </a>
                </div>
              </div>

              {/* Subaccount */}
              {subaccount && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500">DECIBEL SUBACCOUNT</label>
                  <div className="flex items-center gap-2 p-3 bg-black/40 border border-white/10 rounded-lg">
                    <span className="text-sm font-mono text-white flex-1">{formatAddress(subaccount)}</span>
                    <button
                      onClick={() => copyAddress(subaccount)}
                      className="p-1.5 hover:bg-white/5 rounded transition-colors"
                    >
                      <Copy className="w-4 h-4 text-zinc-400" />
                    </button>
                  </div>
                </div>
              )}

              {/* Balance */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500">AVAILABLE MARGIN</label>
                <div className="p-4 bg-black/40 border border-primary/20 rounded-lg">
                  {loading ? (
                    <div className="text-sm text-zinc-500">Loading...</div>
                  ) : balance !== null ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-primary">${balance.toFixed(2)}</span>
                      <span className="text-sm text-zinc-400">USDC</span>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500">No balance found</div>
                  )}
                </div>
              </div>

              {/* Disconnect Button */}
              <Button
                onClick={() => {
                  disconnect()
                  setShowAccountModal(false)
                }}
                variant="outline"
                className="w-full border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Wallet
              </Button>
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
        className="bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_20px_rgba(255,246,0,0.3)] transition-all"
      >
        <Wallet className="w-4 h-4 mr-2" />
        Connect Wallet
      </Button>

      <Dialog open={showWalletModal} onOpenChange={setShowWalletModal}>
        <DialogContent className="bg-zinc-900 border-white/10 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Connect Wallet</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Choose a wallet to connect to Decibrrr
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 mt-4">
            {wallets?.filter((wallet) => wallet.readyState === "Installed" || wallet.readyState === "Loadable").length === 0 ? (
              <div className="text-center py-8 space-y-4">
                <p className="text-sm text-zinc-400">No Aptos wallets detected</p>
                <a
                  href="https://petra.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Get Petra Wallet
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ) : (
              wallets
                ?.filter((wallet) => wallet.readyState === "Installed" || wallet.readyState === "Loadable")
                .map((wallet) => (
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
                    className="flex items-center gap-3 p-4 bg-black/40 border border-white/10 rounded-lg hover:border-primary/50 hover:bg-black/60 transition-all group"
                  >
                    {wallet.icon && (
                      <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded" />
                    )}
                    <span className="text-sm font-medium text-white group-hover:text-primary transition-colors">
                      {wallet.name}
                    </span>
                  </button>
                ))
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-zinc-500 text-center">
              By connecting, you agree to our Terms of Service
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
