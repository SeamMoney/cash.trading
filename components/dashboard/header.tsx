"use client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Info, Disc, Fingerprint, Atom } from "lucide-react"
import { WalletButton } from "@/components/wallet/wallet-button"
import { useWallet } from "@aptos-labs/wallet-adapter-react"
import { useWalletBalance } from "@/hooks/use-wallet-balance"

export function DashboardHeader() {
  const { connected, account } = useWallet()
  const { balance, loading } = useWalletBalance()

  return (
    <header className="relative z-10 w-full border-b border-white/10 bg-black/40 backdrop-blur-md p-4 lg:px-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 lg:gap-4">
        {/* User Profile */}
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 border-2 border-white/10 ring-2 ring-white/5">
            <AvatarImage src="/placeholder.svg" />
            <AvatarFallback className="bg-zinc-900 text-primary font-bold text-lg">DB</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-white tracking-tight leading-none">Decibel Trader</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400 font-medium">Aptos Testnet</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
          </div>
        </div>

        {/* Wallet Connection */}
        <WalletButton />
      </div>
    </header>
  )
}
