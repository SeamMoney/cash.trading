"use client"

import { useState } from "react"
import { useWallet, WalletName } from "@aptos-labs/wallet-adapter-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Wallet, ChevronDown, Copy, ExternalLink, LogOut, Trophy, User, Loader2, Zap } from "lucide-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"
import { DECIBEL_PACKAGE } from "@/lib/decibel-client"

export function WalletButton() {
  const { connected, account, disconnect, wallets, connect, signAndSubmitTransaction } = useWallet()
  const { balance, aptBalance, subaccount, allSubaccounts, selectedSubaccountType, setSelectedSubaccountType, setCompetitionSubaccount, competitionChecked, loading, refetch } = useWalletBalance()
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [showAddCompetition, setShowAddCompetition] = useState(false)
  const [competitionInput, setCompetitionInput] = useState('')
  const [enteringCompetition, setEnteringCompetition] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(null), 1500)
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

  // Get the active subaccount for display
  const activeSubaccount = allSubaccounts.find(s => s.type === selectedSubaccountType) || allSubaccounts[0]

  if (connected && account) {
    return (
      <>
        {/* Compact header button - address and balance on same line */}
        <button
          onClick={() => setShowAccountModal(true)}
          className="group flex items-center gap-2 px-3 py-2 bg-black/60 border border-primary/20 hover:border-primary/40 rounded-lg transition-all hover:bg-black/80"
        >
          <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center">
            {selectedSubaccountType === 'competition' ? (
              <Trophy className="size-3 text-primary" />
            ) : (
              <Wallet className="size-3 text-primary" />
            )}
          </div>
          <span className="text-[11px] font-mono text-zinc-400 group-hover:text-zinc-300 transition-colors">
            {formatAddress(account.address)}
          </span>
          <span className="text-sm font-bold text-primary tabular-nums">
            {loading ? '...' : `$${(balance ?? 0).toFixed(2)}`}
          </span>
          <ChevronDown className="size-3 text-zinc-500 group-hover:text-zinc-400 transition-colors" />
        </button>

        {/* Account Modal - Clean dark design */}
        <Dialog open={showAccountModal} onOpenChange={setShowAccountModal}>
          <DialogContent className="bg-black border border-white/10 w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden rounded-xl">
            {/* Header with glow */}
            <div className="relative px-5 py-4 border-b border-white/10">
              <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
              <DialogHeader className="relative">
                <DialogTitle className="text-white font-semibold text-base">Account</DialogTitle>
                <DialogDescription className="text-zinc-500 text-xs">Decibel Trading Account</DialogDescription>
              </DialogHeader>
            </div>

            <div className="p-4 space-y-4">
              {/* Balance Hero */}
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-zinc-900 to-black border border-white/10 p-5">
                <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedSubaccountType === 'competition' ? (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary/10 rounded-full">
                        <Trophy className="size-3 text-primary" />
                        <span className="text-[10px] font-mono uppercase text-primary">Competition</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-800 rounded-full">
                        <User className="size-3 text-zinc-400" />
                        <span className="text-[10px] font-mono uppercase text-zinc-400">Primary</span>
                      </div>
                    )}
                  </div>
                  <div className="text-4xl font-bold text-white tabular-nums tracking-tight">
                    ${loading ? '---' : (balance ?? 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">Available Margin (USDC)</div>
                </div>
              </div>

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
                  <code className="text-xs text-white font-mono">{account.address.toString()}</code>
                </div>

                {/* Trading Subaccount */}
                {activeSubaccount && (
                  <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono uppercase text-zinc-500">Trading Subaccount</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyAddress(activeSubaccount.address)}
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                          aria-label="Copy subaccount address"
                        >
                          <Copy className={`size-3 transition-colors ${copied === activeSubaccount.address ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-400'}`} />
                        </button>
                        <a
                          href={`https://explorer.aptoslabs.com/account/${activeSubaccount.address}?network=testnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                          aria-label="View subaccount on explorer"
                        >
                          <ExternalLink className="size-3 text-zinc-500 hover:text-zinc-400" />
                        </a>
                      </div>
                    </div>
                    <code className="text-xs text-white font-mono break-all">{activeSubaccount.address}</code>
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

              {/* Switch Accounts - only if multiple */}
              {allSubaccounts.length > 1 && (
                <div>
                  <div className="text-[10px] font-mono uppercase text-zinc-500 mb-2">Switch Account</div>
                  <div className="flex gap-2">
                    {allSubaccounts.map((sub) => (
                      <button
                        key={sub.address}
                        onClick={() => setSelectedSubaccountType(sub.type as 'primary' | 'competition')}
                        className={`flex-1 p-2.5 rounded-lg border text-center transition-all ${
                          sub.type === selectedSubaccountType
                            ? 'bg-primary/10 border-primary/40'
                            : 'bg-zinc-900/50 border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          {sub.type === 'competition' ? (
                            <Trophy className={`size-3 ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-500'}`} />
                          ) : (
                            <User className={`size-3 ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-500'}`} />
                          )}
                          <span className={`text-[10px] font-mono uppercase ${sub.type === selectedSubaccountType ? 'text-primary' : 'text-zinc-500'}`}>
                            {sub.type === 'competition' ? 'Competition' : 'Primary'}
                          </span>
                        </div>
                        <div className={`text-sm font-bold tabular-nums ${sub.type === selectedSubaccountType ? 'text-white' : 'text-zinc-400'}`}>
                          ${sub.balance?.toFixed(2) || '0.00'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Enter Competition CTA */}
              {!competitionChecked && (
                <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg flex items-center gap-2">
                  <Loader2 className="size-4 text-zinc-500 animate-spin" />
                  <span className="text-xs text-zinc-500">Checking competition status...</span>
                </div>
              )}
              {competitionChecked && !allSubaccounts.find(s => s.type === 'competition') && (
                <div className="space-y-2">
                  <button
                    onClick={handleEnterCompetition}
                    disabled={enteringCompetition}
                    className="w-full p-3 bg-gradient-to-r from-primary/20 to-primary/10 border border-primary/30 rounded-lg flex items-center justify-center gap-2 hover:from-primary/30 hover:to-primary/20 disabled:opacity-50 transition-all"
                  >
                    {enteringCompetition ? (
                      <Loader2 className="size-4 text-primary animate-spin" />
                    ) : (
                      <Trophy className="size-4 text-primary" />
                    )}
                    <span className="text-sm text-primary font-semibold">
                      {enteringCompetition ? 'Entering...' : 'Enter Competition'}
                    </span>
                  </button>
                  <p className="text-[10px] text-zinc-500 text-center">Get $10K virtual USDC to compete</p>

                  {/* Manual entry fallback */}
                  {!showAddCompetition ? (
                    <button onClick={() => setShowAddCompetition(true)} className="w-full text-[10px] text-zinc-600 hover:text-zinc-400 py-1">
                      Already entered? Add manually
                    </button>
                  ) : (
                    <div className="p-3 bg-zinc-900/50 border border-white/5 rounded-lg space-y-2">
                      <input
                        type="text"
                        value={competitionInput}
                        onChange={(e) => setCompetitionInput(e.target.value)}
                        placeholder="Competition subaccount address (0x...)"
                        className="w-full p-2 bg-black/60 border border-white/10 rounded text-xs font-mono text-white placeholder:text-zinc-600"
                      />
                      <div className="flex gap-2">
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
                          className="flex-1 h-8 bg-primary hover:bg-primary/80 text-black text-xs font-semibold"
                        >
                          Save
                        </Button>
                        <Button
                          onClick={() => { setShowAddCompetition(false); setCompetitionInput('') }}
                          variant="outline"
                          className="h-8 border-white/10 text-xs text-zinc-400"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
