"use client"

import { FC, ReactNode } from "react"
import { AptosWalletAdapterProvider, NetworkName } from "@aptos-labs/wallet-adapter-react"

export const WalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Use AIP-62 Wallet Standard (auto-detects all installed wallets)
  // This avoids importing outdated wallet plugins that cause build issues
  const wallets = []

  return (
    <AptosWalletAdapterProvider
      plugins={wallets}
      autoConnect={true}
      dappConfig={{
        network: NetworkName.Testnet,
      }}
      onError={(error) => {
        console.error("Wallet adapter error:", error)
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  )
}
