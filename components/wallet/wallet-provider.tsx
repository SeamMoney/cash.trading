"use client"

import { FC, ReactNode } from "react"
import { AptosWalletAdapterProvider, type DappConfig } from "@aptos-labs/wallet-adapter-react"
import { Network } from "@aptos-labs/ts-sdk"

// Initialize X-Chain wallet derivation at module level (client-side only)
// This allows Phantom, MetaMask, Rainbow, etc. to derive Aptos accounts
if (typeof window !== 'undefined') {
  // Dynamic imports for client-side only
  import('@aptos-labs/derived-wallet-ethereum').then(({ setupAutomaticEthereumWalletDerivation }) => {
    setupAutomaticEthereumWalletDerivation({ defaultNetwork: Network.TESTNET })
  }).catch(console.error)

  import('@aptos-labs/derived-wallet-solana').then(({ setupAutomaticSolanaWalletDerivation }) => {
    setupAutomaticSolanaWalletDerivation({ defaultNetwork: Network.TESTNET })
  }).catch(console.error)
}

// Get dapp image URI for Aptos Connect
const getDappImageURI = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/favicon.ico`
  }
  return undefined
}

export const WalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const dappConfig: DappConfig = {
    network: Network.TESTNET,
    // Enable cross-chain wallets (Phantom Solana, MetaMask Ethereum, etc.)
    crossChainWallets: true,
    // Aptos Connect configuration for keyless wallets (Google/Apple login)
    aptosConnect: {
      dappId: '57fa42a9-29c6-4f1e-939c-4eefa36d9ff5', // Official example dappId
      dappImageURI: getDappImageURI(),
    },
  }

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={dappConfig}
      onError={(error: unknown) => {
        console.error("Wallet adapter error:", error)
        if (error instanceof Error) {
          console.error("Error details:", error.message, error.stack)
        }
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  )
}
