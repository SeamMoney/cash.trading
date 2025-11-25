"use client"

import { ReactNode } from "react"
import { WalletProvider } from "@/components/wallet/wallet-provider"

export function ClientProviders({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>
}
