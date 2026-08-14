"use client"

import { ReactNode } from "react"
import { WalletProvider } from "@/components/wallet/wallet-provider"
import { WalletBalanceProvider } from "@/hooks/use-wallet-balance"
import { MockDataProvider } from "@/contexts/mock-data-context"
import { MockDataToggle } from "@/components/dev/mock-data-toggle"
import { BuilderConsentOnConnect } from "@/components/wallet/builder-consent-on-connect"

export function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <MockDataProvider>
      <WalletProvider>
        <WalletBalanceProvider>
          {children}
          <BuilderConsentOnConnect />
          <MockDataToggle />
        </WalletBalanceProvider>
      </WalletProvider>
    </MockDataProvider>
  )
}
