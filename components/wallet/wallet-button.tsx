"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut, Trophy, User, Loader2 } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export function WalletButton() {
  const { connected, account, disconnect, wallets, connect, signAndSubmitTransaction } = useWallet()
  const { balance, aptBalance, allSubaccounts, selectedSubaccountType, setCompetitionSubaccount, loading, refetch } = useWalletBalance()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [showAddCompetition, setShowAddCompetition] = useState(false)
  const [competitionInput, setCompetitionInput] = useState('')
  const [enteringCompetition, setEnteringCompetition] = useState(false)

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
  }

  const handleEnterCompetition = async () => {
    if (!signAndSubmitTransaction) return

    setEnteringCompetition(true)
    try {
      const response = await signAndSubmitTransaction({
        data: {
          function: `${DECIBEL_PACKAGE}::usdc::enter_trading_competition`,
          typeArguments: [],
          functionArguments: [],
        },
      })
      console.log('✅ Entered trading competition:', response.hash)
      setTimeout(() => refetch(), 3000)
    } catch (err) {
      console.error('Failed to enter competition:', err)
    } finally {
      setEnteringCompetition(false)
    }
  }

  const formatAddress = (addr: string | { toString(): string }) => {
    const addrStr = typeof addr === 'string' ? addr : addr.toString()
    return `${addrStr.slice(0, 6)}...${addrStr.slice(-4)}`
  }

  if (connected && account) {
    return (
      <>
        <button
          onClick={() => setShowAccountModal(true)}
          className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors ${
            selectedSubaccountType === 'competition'
              ? 'border-yellow-500/30 hover:border-yellow-500/50'
              : 'border-white/10 hover:border-primary/50'
          }`}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        >
          {selectedSubaccountType === 'competition' ? (
            <Trophy className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          ) : (
            <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
          )}
          <span className="hidden sm:inline text-xs font-mono text-zinc-400">{formatAddress(account.address)}</span>
          {!loading && balance !== null && (
            <span className={`text-lg font-bold ${selectedSubaccountType === 'competition' ? 'text-yellow-500' : 'text-primary'}`}>
              ${balance.toFixed(2)}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        </button>

        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-zinc-900 border-white/10 w-[calc(100vw-2rem)] max-w-sm p-4 overflow-hidden">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-white text-base">Account</DialogTitle>
              <DialogDescription className="text-zinc-500 text-xs">Wallet info</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              {/* Wallet Address */}
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Wallet</label>
                <div className="mt-1 flex items-center gap-2 p-2 bg-black/40 border border-white/10 rounded">
                  <code className="flex-1 text-[10px] text-white/80 overflow-hidden">{formatAddress(account.address)}</code>
                  <button onClick={() => copyAddress(account.address.toString())} className="p-1 hover:bg-white/10 rounded flex-shrink-0">
                    <Copy className="w-3 h-3 text-zinc-400" />
                  </button>
                  <a href={`https://explorer.aptoslabs.com/account/${account.address}?network=testnet`} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded flex-shrink-0">
                    <ExternalLink className="w-3 h-3 text-zinc-400" />
                  </a>
                </div>
              </div>

              {/* Subaccounts */}
              {allSubaccounts.length > 0 && (
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Subaccounts ({allSubaccounts.length})</label>
                  <div className="mt-1 space-y-1.5">
                    {allSubaccounts.map((sub) => (
                      <div
                        key={sub.address}
                        className={`p-2 rounded border ${
                          sub.type === selectedSubaccountType
                            ? sub.type === 'competition' ? 'bg-yellow-500/10 border-yellow-500/40' : 'bg-primary/10 border-primary/40'
                            : 'bg-black/40 border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {sub.type === 'competition' ? (
                            <Trophy className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                          ) : (
                            <User className="w-3 h-3 text-primary flex-shrink-0" />
                          )}
                          <span className={`text-[10px] font-bold uppercase ${sub.type === 'competition' ? 'text-yellow-500' : 'text-primary'}`}>
                            {sub.type}
                          </span>
                          {sub.type === selectedSubaccountType && (
                            <span className="text-[8px] px-1 bg-white/10 text-zinc-400 rounded">ACTIVE</span>
                          )}
                          <span className="ml-auto text-[10px] text-zinc-400">${sub.balance?.toFixed(2) || '0'}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <code className="flex-1 text-[9px] text-white/60 overflow-hidden">{formatAddress(sub.address)}</code>
                          <button onClick={() => copyAddress(sub.address)} className="p-1 hover:bg-white/10 rounded flex-shrink-0">
                            <Copy className="w-2.5 h-2.5 text-zinc-500" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Enter Competition */}
              {!allSubaccounts.find(s => s.type === 'competition') && (
                <div className="space-y-1.5">
                  <button
                    onClick={handleEnterCompetition}
                    disabled={enteringCompetition}
                    className="w-full p-2.5 bg-yellow-500/20 border border-yellow-500/50 rounded flex items-center justify-center gap-2 hover:bg-yellow-500/30 disabled:opacity-50"
                  >
                    {enteringCompetition ? (
                      <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
                    ) : (
                      <Trophy className="w-4 h-4 text-yellow-500" />
                    )}
                    <span className="text-xs text-yellow-500 font-medium">
                      {enteringCompetition ? 'Entering...' : 'Enter Competition'}
                    </span>
                  </button>
                  <p className="text-[9px] text-zinc-500 text-center">Get $10K virtual USDC</p>
                  {!showAddCompetition ? (
                    <button onClick={() => setShowAddCompetition(true)} className="w-full text-[9px] text-zinc-600 hover:text-zinc-400">
                      Already entered? Add manually
                    </button>
                  ) : (
                    <div className="p-2 bg-black/40 border border-white/10 rounded space-y-2">
                      <input
                        type="text"
                        value={competitionInput}
                        onChange={(e) => setCompetitionInput(e.target.value)}
                        placeholder="0x..."
                        className="w-full p-1.5 bg-black/60 border border-white/10 rounded text-[10px] font-mono text-white"
                      />
                      <div className="flex gap-1.5">
                        <Button
                          onClick={() => {
                            if (competitionInput.startsWith('0x') && competitionInput.length >= 60) {
                              setCompetitionSubaccount(competitionInput)
                              setShowAddCompetition(false)
                              setCompetitionInput('')
                              refetch()
                            }
                          }}
                          disabled={!competitionInput.startsWith('0x') || competitionInput.length < 60}
                          className="flex-1 h-7 bg-yellow-500 hover:bg-yellow-600 text-black text-[10px]"
                        >
                          Save
                        </Button>
                        <Button onClick={() => { setShowAddCompetition(false); setCompetitionInput('') }} variant="outline" className="h-7 border-white/10 text-[10px]">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Balances */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 bg-black/40 border border-primary/30 rounded">
                  <p className="text-[9px] text-zinc-500 uppercase">Margin</p>
                  <p className="text-lg font-bold text-primary">${balance?.toFixed(2) || '0'}</p>
                </div>
                <div className="p-3 bg-black/40 border border-white/10 rounded">
                  <p className="text-[9px] text-zinc-500 uppercase">APT</p>
                  <p className="text-lg font-bold text-white">{aptBalance?.toFixed(2) || '0'}</p>
                </div>
              </div>

              {/* Disconnect */}
              <Button
                onClick={() => { disconnect(); setShowAccountModal(false) }}
                variant="outline"
                className="w-full h-9 border-red-500/20 text-red-500 hover:bg-red-500/10 text-xs"
              >
                <LogOut className="w-3 h-3 mr-1.5" />
                Disconnect
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
        className="bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_20px_rgba(255,246,0,0.3)]"
      >
        <Wallet className="w-4 h-4 mr-2" />
        Connect
      </Button>

      <Dialog open={showWalletModal} onOpenChange={setShowWalletModal}>
        <DialogContent className="bg-zinc-900 border-white/10 w-[calc(100vw-2rem)] max-w-sm p-4">
          <DialogHeader>
            <DialogTitle className="text-white">Connect Wallet</DialogTitle>
            <DialogDescription className="text-zinc-400 text-sm">Choose a wallet</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 mt-3">
            {wallets?.filter((w) => w.readyState === "Installed" || w.readyState === "Loadable").length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-zinc-400">No Aptos wallets detected</p>
                <a href="https://petra.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-black font-medium rounded-lg">
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
                  className="w-full flex items-center gap-3 p-3 bg-black/40 border border-white/10 rounded-lg hover:border-primary/50"
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
