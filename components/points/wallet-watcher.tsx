"use client"

import { useEffect, useState, useCallback } from "react"
import { Eye, Plus, X, RefreshCw, Loader2, ExternalLink, Copy, Check } from "lucide-react"

interface WatchedWallet {
  address: string
  label?: string
  points: number
  dlp_balance: string
  ua_balance: string
  total_deposited: string
  lastUpdated: number
}

const STORAGE_KEY = 'decibrrr_watched_wallets'

export function WalletWatcher() {
  const [watchedWallets, setWatchedWallets] = useState<WatchedWallet[]>([])
  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [addingWallet, setAddingWallet] = useState(false)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)

  // Load watched wallets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const wallets = JSON.parse(saved)
        setWatchedWallets(wallets)
      } catch (e) {
        console.error('Failed to parse watched wallets:', e)
      }
    }
  }, [])

  // Save watched wallets to localStorage
  useEffect(() => {
    if (watchedWallets.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchedWallets))
    }
  }, [watchedWallets])

  const fetchWalletData = async (address: string): Promise<Partial<WatchedWallet>> => {
    try {
      const [pointsRes, balancesRes] = await Promise.all([
        fetch(`/api/predeposit/points?account=${address}`),
        fetch(`/api/predeposit/balances?account=${address}`),
      ])

      const points = await pointsRes.json()
      const balances = await balancesRes.json()

      return {
        points: points.points || 0,
        dlp_balance: balances.dlp_balance || '0',
        ua_balance: balances.ua_balance || '0',
        total_deposited: balances.total_deposited || '0',
        lastUpdated: Date.now(),
      }
    } catch (error) {
      console.error('Error fetching wallet data:', error)
      return {}
    }
  }

  const refreshAllWallets = useCallback(async () => {
    if (watchedWallets.length === 0) return

    setLoading(true)
    try {
      const updatedWallets = await Promise.all(
        watchedWallets.map(async (wallet) => {
          const data = await fetchWalletData(wallet.address)
          return { ...wallet, ...data }
        })
      )
      setWatchedWallets(updatedWallets)
    } catch (error) {
      console.error('Error refreshing wallets:', error)
    } finally {
      setLoading(false)
    }
  }, [watchedWallets])

  // Auto-refresh every 2 minutes
  useEffect(() => {
    if (watchedWallets.length > 0) {
      refreshAllWallets()
      const interval = setInterval(refreshAllWallets, 120000)
      return () => clearInterval(interval)
    }
  }, [watchedWallets.length]) // Only depend on length to avoid infinite loop

  const addWallet = async () => {
    if (!newAddress.trim()) return
    if (watchedWallets.some((w) => w.address.toLowerCase() === newAddress.toLowerCase())) {
      alert('Wallet already being watched')
      return
    }

    setAddingWallet(true)
    try {
      const data = await fetchWalletData(newAddress.trim())
      const newWallet: WatchedWallet = {
        address: newAddress.trim(),
        label: newLabel.trim() || undefined,
        points: data.points || 0,
        dlp_balance: data.dlp_balance || '0',
        ua_balance: data.ua_balance || '0',
        total_deposited: data.total_deposited || '0',
        lastUpdated: Date.now(),
      }
      setWatchedWallets([...watchedWallets, newWallet])
      setNewAddress('')
      setNewLabel('')
    } catch (error) {
      console.error('Error adding wallet:', error)
    } finally {
      setAddingWallet(false)
    }
  }

  const removeWallet = (address: string) => {
    setWatchedWallets(watchedWallets.filter((w) => w.address !== address))
  }

  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(null), 2000)
  }

  const formatNumber = (num: number | string, decimals = 2) => {
    const n = typeof num === 'string' ? parseFloat(num) : num
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
    return `$${n.toFixed(decimals)}`
  }

  const shortenAddress = (addr: string) => `${addr.slice(0, 8)}...${addr.slice(-6)}`

  return (
    <div className="space-y-4 animate-in fade-in zoom-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-2">
          <Eye className="w-4 h-4" />
          Wallet Watcher
        </div>
        {watchedWallets.length > 0 && (
          <button
            onClick={refreshAllWallets}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-black/40 border border-white/10 hover:border-primary/50 transition-colors text-xs font-mono uppercase tracking-wider text-zinc-400 hover:text-primary disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Refresh All
          </button>
        )}
      </div>

      {/* Add Wallet Form */}
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="0x... wallet address"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            className="flex-1 px-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-primary/50 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full md:w-40 px-4 py-2 bg-black/40 border border-white/10 text-white text-sm font-mono focus:border-primary/50 focus:outline-none"
          />
          <button
            onClick={addWallet}
            disabled={addingWallet || !newAddress.trim()}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-primary text-black font-mono font-bold text-sm uppercase tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {addingWallet ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Watch
          </button>
        </div>
      </div>

      {/* Watched Wallets List */}
      {watchedWallets.length === 0 ? (
        <div className="bg-black/20 border border-white/5 p-8 text-center">
          <Eye className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
          <p className="text-zinc-500 font-mono text-sm">
            No wallets being watched yet
          </p>
          <p className="text-zinc-600 font-mono text-xs mt-2">
            Add wallet addresses above to track their predeposit activity
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {watchedWallets.map((wallet) => (
            <div
              key={wallet.address}
              className="bg-black/40 backdrop-blur-sm border border-white/10 p-4 relative group hover:border-primary/30 transition-colors"
            >
              <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20 group-hover:border-primary transition-colors" />
              <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/20 group-hover:border-primary transition-colors" />

              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  {wallet.label && (
                    <div className="text-primary font-mono font-bold text-sm mb-1">
                      {wallet.label}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://explorer.aptoslabs.com/account/${wallet.address}?network=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-zinc-400 hover:text-primary transition-colors flex items-center gap-1"
                    >
                      {shortenAddress(wallet.address)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      onClick={() => copyAddress(wallet.address)}
                      className="text-zinc-500 hover:text-primary transition-colors"
                    >
                      {copiedAddress === wallet.address ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => removeWallet(wallet.address)}
                  className="text-zinc-500 hover:text-red-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Points
                  </div>
                  <div className="text-xl font-mono font-bold text-purple-500">
                    {wallet.points.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Total Deposited
                  </div>
                  <div className="text-xl font-mono font-bold text-white">
                    {formatNumber(wallet.total_deposited)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    DLP
                  </div>
                  <div className="text-lg font-mono text-blue-500">
                    {formatNumber(wallet.dlp_balance)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    Unallocated
                  </div>
                  <div className="text-lg font-mono text-orange-500">
                    {formatNumber(wallet.ua_balance)}
                  </div>
                </div>
              </div>

              {/* Last Updated */}
              <div className="text-[10px] font-mono text-zinc-600 mt-3">
                Updated {new Date(wallet.lastUpdated).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
