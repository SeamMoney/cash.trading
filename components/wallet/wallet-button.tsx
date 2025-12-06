"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"

export function WalletButton() {
  const { connected, account, disconnect, wallets, connect } = useWallet()
  const { balance, aptBalance, subaccount, loading } = useWalletBalance()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
  }

  const formatAddress = (addr: string | { toString(): string }) => {
    const addrStr = typeof addr === 'string' ? addr : addr.toString()
    return `${addrStr.slice(0, 6)}...${addrStr.slice(-5)}`
  }

  if (connected && account) {
    return (
      <>
        <button
          onClick={() => setShowAccountModal(true)}
          className="flex items-center gap-2 sm:gap-3 px-3 py-2 bg-black/30 border border-white/10 rounded-lg hover:border-primary/50 transition-colors"
        >
          <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="hidden sm:inline text-xs font-mono text-zinc-400">{formatAddress(account.address)}</span>
          {!loading && balance !== null && (
            <span className="text-lg sm:text-xl font-bold text-primary">${balance.toFixed(2)}</span>
          )}
          <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        </button>

        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-zinc-900 border-white/10 max-w-[calc(100%-2rem)] sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white text-lg sm:text-xl">Account Details</DialogTitle>
              <DialogDescription className="text-zinc-400 text-sm">Your connected wallet information</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2 sm:mt-4">
              {/* Main Wallet Address */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Wallet Address</label>
                <div className="flex items-center gap-2 p-3 sm:p-3.5 bg-black/40 border border-white/10 rounded-lg hover:border-white/20 transition-colors">
                  <span className="text-xs sm:text-sm font-mono text-white flex-1 break-all">{account.address.toString()}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => copyAddress(account.address.toString())}
                      className="p-2 hover:bg-white/5 active:bg-white/10 rounded-lg transition-all focus:outline-none"
                      aria-label="Copy address"
                    >
                      <Copy className="w-4 h-4 text-zinc-400 hover:text-white transition-colors" />
                    </button>
                    <a
                      href={`https://explorer.aptoslabs.com/account/${account.address.toString()}?network=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-white/5 active:bg-white/10 rounded-lg transition-all focus:outline-none"
                      aria-label="View on explorer"
                    >
                      <ExternalLink className="w-4 h-4 text-zinc-400 hover:text-white transition-colors" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Subaccount */}
              {subaccount && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Decibel Subaccount</label>
                  <div className="flex items-center gap-2 p-3 sm:p-3.5 bg-black/40 border border-white/10 rounded-lg hover:border-white/20 transition-colors">
                    <span className="text-xs sm:text-sm font-mono text-white flex-1 break-all">{subaccount}</span>
                    <button
                      onClick={() => copyAddress(subaccount)}
                      className="p-2 hover:bg-white/5 active:bg-white/10 rounded-lg transition-all focus:outline-none flex-shrink-0"
                      aria-label="Copy subaccount address"
                    >
                      <Copy className="w-4 h-4 text-zinc-400 hover:text-white transition-colors" />
                    </button>
                  </div>
                </div>
              )}

              {/* USDC Balance */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Available Margin</label>
                <div className="p-4 sm:p-5 bg-gradient-to-br from-black/60 to-black/40 border border-primary/30 rounded-lg shadow-lg shadow-primary/5">
                  {loading ? (
                    <div className="text-sm text-zinc-500">Loading...</div>
                  ) : balance !== null ? (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-2xl sm:text-3xl font-bold text-primary">${balance.toFixed(2)}</span>
                      <span className="text-xs sm:text-sm text-zinc-400 font-medium">USDC</span>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500">No balance found</div>
                  )}
                </div>
              </div>

              {/* APT Balance */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Testnet APT</label>
                <div className="p-4 sm:p-5 bg-gradient-to-br from-black/60 to-black/40 border border-white/10 rounded-lg">
                  {loading ? (
                    <div className="text-sm text-zinc-500">Loading...</div>
                  ) : aptBalance !== null ? (
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-2xl sm:text-3xl font-bold text-white">{aptBalance.toFixed(4)}</span>
                      <span className="text-xs sm:text-sm text-zinc-400 font-medium">APT</span>
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500">No APT found</div>
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
                className="w-full mt-2 border-red-500/20 text-red-500 hover:bg-red-500/10 hover:border-red-500/30 active:bg-red-500/20 focus:outline-none focus-visible:ring-0 transition-all"
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
        <DialogContent className="bg-zinc-900 border-white/10 max-w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-lg sm:text-xl">Connect Wallet</DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">
              Choose a wallet to connect to Decibrrr
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 mt-2 sm:mt-4">
            {wallets?.filter((wallet) => wallet.readyState === "Installed" || wallet.readyState === "Loadable").length === 0 ? (
              <div className="text-center py-6 sm:py-8 space-y-4">
                <p className="text-sm text-zinc-400">No Aptos wallets detected</p>
                <a
                  href="https://petra.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-black font-medium rounded-lg hover:bg-primary/90 active:bg-primary/80 transition-all focus:outline-none shadow-lg shadow-primary/20"
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
                    className="flex items-center gap-3 p-4 bg-black/40 border border-white/10 rounded-lg hover:border-primary/50 hover:bg-black/60 active:bg-black/80 transition-all group focus:outline-none"
                  >
                    {wallet.icon && (
                      <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0" />
                    )}
                    <span className="text-sm sm:text-base font-medium text-white group-hover:text-primary transition-colors">
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
