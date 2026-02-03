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
  const { balance, aptBalance, allSubaccounts, selectedSubaccountType, setSelectedSubaccountType, setCompetitionSubaccount, competitionChecked, loading, refetch } = useWalletBalance()
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
        {/* Balance Button - always primary/yellow color */}
        <button
          onClick={() => setShowAccountModal(true)}
          className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 border border-primary/30 hover:border-primary/50 rounded-lg transition-colors"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        >
          <Wallet className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-2">
            <span className="text-[10px] sm:text-xs font-mono text-zinc-500">{formatAddress(account.address)}</span>
            {loading ? (
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            ) : (
              <span className="text-sm sm:text-lg font-bold text-primary tabular-nums">
                ${(balance ?? 0).toFixed(2)}
              </span>
            )}
          </div>
          <ChevronDown className="w-3 h-3 text-zinc-500 flex-shrink-0" />
        </button>

        {/* Account Modal */}
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-zinc-900/95 backdrop-blur border-white/10 w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-white/5 border-b border-white/10">
              <DialogHeader>
                <DialogTitle className="text-primary font-mono text-sm uppercase tracking-widest">Account</DialogTitle>
                <DialogDescription className="text-zinc-500 text-xs">Wallet info</DialogDescription>
              </DialogHeader>
            </div>

            <div className="p-4 space-y-4">
              {/* Balance Summary */}
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="text-center">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide font-mono mb-1">
                    Available Balance
                  </div>
                  <div className="text-3xl font-bold text-primary tabular-nums">
                    ${(balance ?? 0).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {selectedSubaccountType === 'competition' ? '🏆 Competition Account' : '👤 Primary Account'}
                  </div>
                </div>
              </div>

              {/* Wallet Address */}
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-mono">Wallet</label>
                <div className="mt-1 flex items-center gap-2 p-2 bg-black/40 border border-white/10 rounded">
                  <code className="flex-1 text-[11px] text-white/80">{formatAddress(account.address)}</code>
                  <button onClick={() => copyAddress(account.address.toString())} className="p-1 hover:bg-white/10 rounded flex-shrink-0" aria-label="Copy address">
                    <Copy className="w-3 h-3 text-zinc-400" />
                  </button>
                  <a href={`https://explorer.aptoslabs.com/account/${account.address}?network=testnet`} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded flex-shrink-0" aria-label="View on explorer">
                    <ExternalLink className="w-3 h-3 text-zinc-400" />
                  </a>
                </div>
              </div>

              {/* Subaccounts - Clickable to switch */}
              {allSubaccounts.length > 0 && (
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wide font-mono">
                    Subaccounts ({allSubaccounts.length}) - tap to switch
                  </label>
                  <div className="mt-1 space-y-2">
                    {allSubaccounts.map((sub) => (
                      <button
                        key={sub.address}
                        onClick={() => setSelectedSubaccountType(sub.type as 'primary' | 'competition')}
                        className={`w-full p-2.5 rounded border text-left transition-all ${
                          sub.type === selectedSubaccountType
                            ? 'bg-primary/10 border-primary/50'
                            : 'bg-black/40 border-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {sub.type === 'competition' ? (
                            <Trophy className={`w-4 h-4 flex-shrink-0 ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-400'}`} />
                          ) : (
                            <User className={`w-4 h-4 flex-shrink-0 ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-400'}`} />
                          )}
                          <span className={`text-xs font-bold uppercase tracking-wide ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-400'}`}>
                            {sub.type === 'competition' ? 'Competition' : 'Primary'}
                          </span>
                          {sub.type === selectedSubaccountType && (
                            <span className="text-[8px] px-1.5 py-0.5 bg-primary/20 text-primary rounded font-mono">ACTIVE</span>
                          )}
                          <span className={`ml-auto text-sm font-bold ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-white'}`}>
                            ${sub.balance?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <code className="text-[9px] text-zinc-500">{formatAddress(sub.address)}</code>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyAddress(sub.address) }}
                            className="p-0.5 hover:bg-white/10 rounded flex-shrink-0"
                          >
                            <Copy className="w-2.5 h-2.5 text-zinc-500" />
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Enter Competition - only show after we've checked for existing competition subaccount */}
              {!competitionChecked && (
                <div className="p-3 bg-zinc-500/10 border border-zinc-500/30 rounded flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                  <span className="text-xs text-zinc-400">Checking competition status...</span>
                </div>
              )}
              {competitionChecked && !allSubaccounts.find(s => s.type === 'competition') && (
                <div className="space-y-2">
                  <button
                    onClick={handleEnterCompetition}
                    disabled={enteringCompetition}
                    className="w-full p-3 bg-primary/10 border border-primary/50 rounded flex items-center justify-center gap-2 hover:bg-primary/20 disabled:opacity-50 transition-all"
                  >
                    {enteringCompetition ? (
                      <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    ) : (
                      <Trophy className="w-4 h-4 text-primary" />
                    )}
                    <span className="text-xs text-primary font-bold uppercase tracking-wide">
                      {enteringCompetition ? 'Entering...' : 'Enter Competition'}
                    </span>
                  </button>
                  <p className="text-[9px] text-zinc-500 text-center">Get $10K virtual USDC to compete</p>

                  {/* Manual entry fallback */}
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
                          className="flex-1 h-7 bg-primary hover:bg-primary/80 text-black text-[10px]"
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

              {/* APT Balance - small inline */}
              <div className="flex items-center justify-between p-2 bg-black/40 border border-white/10 rounded">
                <span className="text-[10px] text-zinc-500 uppercase font-mono">Testnet APT</span>
                <span className="text-sm font-bold text-white">{aptBalance?.toFixed(2) || '0'} APT</span>
              </div>

              {/* Disconnect */}
              <Button
                onClick={() => { disconnect(); setShowAccountModal(false) }}
                variant="outline"
                className="w-full h-9 border-red-500/30 text-red-500 hover:bg-red-500/10 text-xs font-mono uppercase tracking-wide"
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
