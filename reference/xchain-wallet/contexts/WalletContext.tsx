import { type ReactNode } from 'react';
import { AptosWalletAdapterProvider, type DappConfig } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { setupAutomaticEthereumWalletDerivation } from '@aptos-labs/derived-wallet-ethereum';
import { setupAutomaticSolanaWalletDerivation } from '@aptos-labs/derived-wallet-solana';

// Initialize X-Chain wallet derivation at module level
// This allows Phantom, MetaMask, Rainbow, etc. to derive Aptos accounts
setupAutomaticEthereumWalletDerivation({ defaultNetwork: Network.TESTNET });
setupAutomaticSolanaWalletDerivation({ defaultNetwork: Network.TESTNET });

// Get dapp image URI for Aptos Connect
const getDappImageURI = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/favicon.ico`;
  }
  return undefined;
};

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const dappConfig: DappConfig = {
    network: Network.TESTNET,
    aptosApiKeys: {
      testnet: import.meta.env.VITE_APTOS_API_KEY_TESTNET,
      devnet: import.meta.env.VITE_APTOS_API_KEY_DEVNET,
      mainnet: import.meta.env.VITE_APTOS_API_KEY_MAINNET,
    },
    // Enable cross-chain wallets (Phantom Solana, MetaMask Ethereum, etc.)
    crossChainWallets: true,
    // Aptos Connect configuration for keyless wallets (Google/Apple login)
    // Using the official example dappId that is confirmed working
    aptosConnect: {
      dappId: '57fa42a9-29c6-4f1e-939c-4eefa36d9ff5',
      dappImageURI: getDappImageURI(),
    },
  };

  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={dappConfig}
      onError={(error: unknown) => {
        console.error('Wallet adapter error:', error);
        if (error instanceof Error) {
          console.error('Error details:', error.message, error.stack);
        }
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
