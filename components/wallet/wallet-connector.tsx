"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import { Wallet, FileText } from "lucide-react"
import { WalletButton } from "./wallet-button"
import { ManualAddressInput } from "./manual-address-input"
import { useWallet } from "@aptos-labs/wallet-adapter-react"

export function WalletConnector() {
  const [mode, setMode] = useState<"aptos" | "manual">("aptos")
  const { connected } = useWallet()

  // If already connected, just show the wallet button
  if (connected) {
    return <WalletButton />
  }

  return (
    <Card className="bg-zinc-900 border-white/10 p-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "aptos" | "manual")}>
        <TabsList className="grid w-full grid-cols-2 bg-black/40">
          <TabsTrigger
            value="aptos"
            className="data-[state=active]:bg-primary data-[state=active]:text-black"
          >
            <Wallet className="w-4 h-4 mr-2" />
            Aptos Wallet
          </TabsTrigger>
          <TabsTrigger
            value="manual"
            className="data-[state=active]:bg-primary data-[state=active]:text-black"
          >
            <FileText className="w-4 h-4 mr-2" />
            Manual Entry
          </TabsTrigger>
        </TabsList>

        <TabsContent value="aptos" className="mt-6 space-y-4">
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-white">Connect Your Aptos Wallet</h3>
              <p className="text-sm text-zinc-400">
                Connect Petra, Martian, or any Aptos wallet for full trading capability
              </p>
            </div>
            <div className="flex justify-center">
              <WalletButton />
            </div>
            <div className="text-xs text-zinc-500 text-center space-y-1">
              <p>Don't have an Aptos wallet yet?</p>
              <div className="flex gap-3 justify-center">
                <a
                  href="https://petra.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get Petra
                </a>
                <span className="text-zinc-600">|</span>
                <a
                  href="https://martianwallet.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get Martian
                </a>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="mt-6">
          <ManualAddressInput />
        </TabsContent>
      </Tabs>
    </Card>
  )
}
