"use client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Info, Disc, Fingerprint, Atom } from "lucide-react"

export function DashboardHeader() {
  return (
    <header className="relative z-10 w-full border-b border-white/10 bg-black/40 backdrop-blur-md p-4 lg:px-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 lg:gap-4">
        {/* User Profile */}
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 border-2 border-white/10 ring-2 ring-white/5">
            <AvatarImage src="/placeholder.svg" />
            <AvatarFallback className="bg-zinc-900 text-primary font-bold text-lg">B11</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-white tracking-tight leading-none">blockchain_test_bybit</h1>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-400 font-medium">Bybit</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
          </div>
        </div>

        {/* Stats & Toggles */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-12 text-sm">
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-zinc-400">
              <Disc className="w-4 h-4 text-zinc-500" />
              <span className="font-medium">vCeFi Status</span>
              <span className="text-white font-medium ml-auto sm:ml-0">Private</span>
              <Info className="w-3 h-3 text-zinc-600" />
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <Fingerprint className="w-4 h-4 text-zinc-500" />
              <span className="font-medium">Trader ID</span>
              <span className="font-mono text-zinc-500 ml-auto sm:ml-0">0xb77d...97b11</span>
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <Atom className="w-4 h-4 text-zinc-500" />
              <span className="font-medium">Genesis Epoch</span>
              <span className="text-white ml-auto sm:ml-0">
                2905747 <span className="text-zinc-600 ml-1">(88 Epochs)</span>
              </span>
            </div>
          </div>

          <div className="flex flex-row sm:flex-col gap-4 sm:gap-3 border-t sm:border-t-0 sm:border-l border-white/10 pt-4 sm:pt-0 sm:pl-6">
            <div className="flex items-center gap-3">
              <Switch
                id="vcefi"
                defaultChecked
                className="data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_10px_rgba(255,246,0,0.5)] border-white/10"
              />
              <Label htmlFor="vcefi" className="text-zinc-300 font-medium cursor-pointer">
                vCeFi
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="vault" className="data-[state=checked]:bg-primary border-white/10" />
              <Label htmlFor="vault" className="text-zinc-300 font-medium cursor-pointer">
                Vault
              </Label>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
