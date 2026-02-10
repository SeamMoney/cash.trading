# X-Chain Wallet Reference Code

This folder contains reference code from `/Users/maxmohammadi/aptos-polymarket/` for the X-Chain wallet implementation.

## What is X-Chain?

X-Chain (AIP-113) allows users to connect to Aptos using their existing Ethereum (MetaMask, Rainbow, Rabby) or Solana (Phantom, Backpack) wallets. No bridging or new wallet setup required!

## Key Features Implemented

### 1. Cross-Chain Wallet Derivation
- Ethereum wallets: MetaMask, Rainbow, Rabby, Coinbase Wallet
- Solana wallets: Phantom, Backpack
- Uses `@aptos-labs/derived-wallet-ethereum` and `@aptos-labs/derived-wallet-solana`

### 2. Keyless Wallets (Social Login)
- Google login via Aptos Connect
- Apple login via Aptos Connect
- Uses Petra Web wallet for social auth flow

### 3. Wallet Selector UI
- Chain tabs (Aptos / Solana / Ethereum)
- Social login buttons (Google, Apple)
- X-CHAIN badge for derived wallets
- Custom wallet icons

## Files in This Reference

- `contexts/WalletContext.tsx` - Wallet provider setup with xchain derivation
- `components/WalletSelector.tsx` - Multi-chain wallet selection modal
- `components/LoginPage.tsx` - Login page with wallet options
- `components/PolyHeader.tsx` - Header with wallet display and X-CHAIN badge
- `hooks/useAutoFundApt.ts` - Auto-fund new users with APT for gas
- `main.tsx` - App entry point showing provider setup
- `package.json` - Dependencies reference
- `assets/wallet-logos/` - Wallet icon images

## Dependencies Required

```json
{
  "@aptos-labs/derived-wallet-ethereum": "^0.8.4",
  "@aptos-labs/derived-wallet-solana": "^0.9.1",
  "@aptos-labs/wallet-adapter-react": "^7.2.8",
  "@aptos-labs/wallet-adapter-core": "^7.10.2",
  "framer-motion": "^12.x"
}
```

## Implementation in Decibrrr

The xchain wallet has been implemented in:

- `components/wallet/wallet-provider.tsx` - Updated with xchain derivation setup
- `components/wallet/wallet-selector.tsx` - New multi-chain wallet selector
- `components/wallet/wallet-button.tsx` - Updated with X-CHAIN badge and keyless icons
- `public/wallet-logos/` - Wallet icon assets

## Configuration

The wallet provider uses:
- `crossChainWallets: true` - Enables EVM/Solana wallet detection
- `aptosConnect.dappId` - For keyless wallet (Google/Apple) authentication
- Dynamic imports for SSR compatibility in Next.js
