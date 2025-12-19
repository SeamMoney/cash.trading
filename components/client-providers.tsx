"use client"

import { ReactNode } from "react"
import { WalletProvider } from "@/components/wallet/wallet-provider"
import { WalletBalanceProvider } from "@/hooks/use-wallet-balance"

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <WalletBalanceProvider>
        {children}
      </WalletBalanceProvider>
    </WalletProvider>
  )
}
