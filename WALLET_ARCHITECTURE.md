# Wallet Architecture & Cross-Chain Compatibility Analysis

*Created: November 24, 2025*

## 🚨 THE CRITICAL QUESTION

**User's Question:**
> "The problem with that is someone who logs into decibel with a eth or solana or non aptos wallet? Because if we only have the aptos wallet adapter how are we going to support people who used their non aptos wallets to mint log in to decibel? Does it even matter?"

**Short Answer:** **IT DOES MATTER, AND WE HAVE A SOLUTION.**

---

## 🔍 Understanding The Problem

### How Decibel Works (Multi-Chain)

Decibel's frontend accepts **THREE wallet types:**
1. **Ethereum wallets** (MetaMask, Coinbase Wallet, Rainbow, etc.)
2. **Solana wallets** (Phantom, Solflare, etc.)
3. **Aptos wallets** (Petra, Martian, Nightly, etc.)

**What happens under the hood:**
```
User connects ETH wallet (0xa141...9E8C3)
    ↓
Decibel derives/maps to Aptos address
    ↓
Creates Aptos main wallet: 0xb082...d19cd
    ↓
Creates subaccount: 0xb932...65465
    ↓
User mints 1000 USDC → goes to subaccount
```

### How Our Bot Works (Aptos-Only)

**Our approach:**
```
User connects Aptos wallet (Petra/Martian/etc)
    ↓
We get Aptos address directly: 0x...
    ↓
Query primary_subaccount(address)
    ↓
Query available_order_margin(subaccount)
    ↓
Start trading
```

### The Conflict

**Scenario 1: User has Petra wallet**
- ✅ Connects to Decibel with Petra → gets subaccount A
- ✅ Mints 1000 USDC → subaccount A has balance
- ✅ Connects to our bot with Petra → we get same address → can query subaccount A
- ✅ **WORKS PERFECTLY**

**Scenario 2: User has MetaMask (Ethereum wallet)**
- User connects to Decibel with MetaMask → Decibel creates subaccount B
- User mints 1000 USDC → subaccount B has balance
- ❌ User tries to connect to our bot → we only support Aptos wallets
- ❌ User can't connect their MetaMask to us
- ❌ **USER IS BLOCKED**

---

## 💡 THE SOLUTION: Three Approaches

### Solution 1: Aptos-Only (Simple, But Excludes Users) ❌

**Strategy:** Only support Aptos wallets

**Pros:**
- ✅ Simple implementation
- ✅ Clean UX (just connect Petra/Martian)
- ✅ Works perfectly for Aptos-native users

**Cons:**
- ❌ **Excludes users who onboarded with ETH/SOL wallets**
- ❌ Those users have USDC but can't use our bot
- ❌ Shrinks addressable market significantly
- ❌ Bad UX for cross-chain users

**Verdict:** Not acceptable for mainnet, might be okay for testnet MVP

---

### Solution 2: Manual Address Input (Universal, But Clunky) ⚠️

**Strategy:** Support Aptos wallets + manual address input fallback

**How it works:**

**Path A - Aptos Native Users:**
```tsx
<AptosWalletAdapterProvider>
  <button onClick={connectWallet}>Connect Aptos Wallet</button>
</AptosWalletAdapterProvider>

// User clicks → Petra opens → We get address automatically
// Query subaccount, show balance, ready to trade ✅
```

**Path B - ETH/SOL Users:**
```tsx
<div className="manual-input-section">
  <p>Used Ethereum or Solana wallet on Decibel?</p>
  <p>Enter your Aptos subaccount address manually:</p>

  <input
    placeholder="0xb9327b35f0acc8542559ac931f0c150a4be6a900cb914f1075758b1676665465"
    onChange={validateAptosAddress}
  />

  <button onClick={checkBalance}>Verify Balance</button>

  {/* If balance exists, show: */}
  <Alert>
    ✅ Found $1,000 USDC at this address
    You can use our bot in READ-ONLY mode
  </Alert>
</div>
```

**Pros:**
- ✅ Supports ALL users (APT, ETH, SOL)
- ✅ Works immediately without reverse-engineering derivation
- ✅ Can ship today

**Cons:**
- ❌ Clunky UX for ETH/SOL users (manual copy-paste)
- ❌ **CRITICAL LIMITATION:** Read-only mode for manual addresses
  - We can query balance ✅
  - We can show positions ✅
  - We CANNOT sign transactions ❌ (no private key access)
  - **Bot cannot trade for them!**

**Why the limitation?**
```typescript
// With Aptos wallet (Petra):
const wallet = useWallet(); // Has signing capability
await wallet.signAndSubmitTransaction(tx); // ✅ Works

// With manual address:
const address = "0xb932..."; // Just a string
await ??? // ❌ No way to sign transactions
```

**Verdict:** Can work for analytics/tracking, but NOT for bot execution

---

### Solution 3: Delegation System (Complex, But Fully Functional) ✅

**Strategy:** Bot operates via delegated trading permissions

**How Decibel's delegation works:**
```move
// On Decibel, users can delegate trading to another address
entry fun delegate_trading_to_subaccount(
  user: &signer,
  subaccount: Object<Subaccount>,
  delegate_address: address,
  permissions: TradingPermissions
)
```

**Our implementation:**

**Step 1: User connects ANY wallet to Decibel**
```
User has MetaMask (ETH wallet)
  ↓
Connects to Decibel → gets subaccount: 0xb932...65465
  ↓
Mints 1000 USDC → balance in subaccount
```

**Step 2: User connects to our bot (manual or Aptos wallet)**

**Option A - Aptos wallet user:**
```tsx
// User connects Petra
const { account } = useWallet();
// account.address = "0xabc..."

// One-time delegation setup
await wallet.signAndSubmitTransaction({
  function: `${DECIBEL}::dex_accounts::delegate_trading`,
  arguments: [
    BOT_OPERATOR_ADDRESS, // Our server's Aptos wallet
    ["place_order", "cancel_order", "place_twap"] // Permissions
  ]
});

// Now our bot can trade on their behalf!
```

**Option B - ETH/SOL wallet user:**
```tsx
// User manually enters subaccount address
const manualAddress = "0xb932...";

// We query balance to verify
const balance = await queryBalance(manualAddress); // ✅ Works

// User must go to Decibel to delegate:
<Alert>
  To use our bot, you need to delegate trading permissions:

  1. Go to app.decibel.trade
  2. Connect your MetaMask wallet
  3. Go to Settings → Delegations
  4. Add delegate: {BOT_OPERATOR_ADDRESS}
  5. Grant permissions: Trading
  6. Return here when done

  <Button href="https://app.decibel.trade/settings">
    Open Decibel Settings →
  </Button>
</Alert>

// Once delegated, our bot can trade!
```

**Step 3: Bot executes trades**
```typescript
// Our server has a wallet with private key
const botWallet = Account.fromPrivateKey(process.env.BOT_PRIVATE_KEY);

// Bot places orders on user's subaccount
await aptos.signAndSubmitTransaction({
  sender: botWallet, // OUR wallet signs
  data: {
    function: `${DECIBEL}::dex_accounts::place_twap_order_to_subaccount`,
    arguments: [
      userSubaccount, // User's subaccount (delegated to us)
      BTC_MARKET,
      1000000, // size
      true, // is_long
      false, // reduce_only
      300, // min_duration
      900, // max_duration
    ]
  }
});
```

**Pros:**
- ✅ Supports ALL users (APT, ETH, SOL via delegation)
- ✅ Bot can actually execute trades (not read-only)
- ✅ Secure (users control delegation, can revoke anytime)
- ✅ Standard pattern (many DeFi bots use this)

**Cons:**
- ❌ Complex setup (delegation transaction required)
- ❌ Requires Decibel UI support for delegation (might not exist on testnet)
- ❌ Friction for users (extra step)
- ❌ Requires us to run a server wallet (security responsibility)

**Verdict:** Best for production, might be overkill for testnet

---

## 🎯 RECOMMENDED STRATEGY

### For Testnet MVP (Ship This Week)

**Approach:** Solution 2 (Manual Input) with clear limitations

**Implementation:**
```tsx
// components/wallet/wallet-connector.tsx
export function WalletConnector() {
  const [mode, setMode] = useState<'aptos' | 'manual'>('aptos');

  return (
    <div>
      <Tabs value={mode} onValueChange={setMode}>
        <Tab value="aptos">Aptos Wallet</Tab>
        <Tab value="manual">Other Wallets</Tab>
      </Tabs>

      {mode === 'aptos' ? (
        <AptosWalletSection>
          {/* Full wallet adapter integration */}
          <AptosWalletAdapterProvider plugins={[
            new PetraWallet(),
            new MartianWallet(),
            new NightlyWallet(),
            // ... all 14 supported wallets
          ]}>
            <WalletSelector />
          </AptosWalletAdapterProvider>

          {/* Auto-query balance, full trading capability */}
        </AptosWalletSection>
      ) : (
        <ManualAddressSection>
          <Alert variant="info">
            Used Ethereum or Solana wallet on Decibel?
            Enter your Aptos subaccount address for read-only access.
          </Alert>

          <Input
            placeholder="0xb9327b35..."
            onChange={handleAddressInput}
          />

          <Button onClick={verifyBalance}>
            Verify Balance
          </Button>

          {balance > 0 && (
            <Alert variant="warning">
              ⚠️ Read-Only Mode

              Balance: ${balance} USDC ✅

              To enable bot trading, you need an Aptos wallet.
              We recommend creating a Petra wallet and transferring
              your USDC from Decibel.

              <Button href="https://petra.app">
                Get Petra Wallet →
              </Button>
            </Alert>
          )}
        </ManualAddressSection>
      )}
    </div>
  );
}
```

**Why this works for testnet:**
- Most serious testnet farmers will use Aptos wallets anyway
- Casual users can still check their balances
- Clear upgrade path to delegation system
- Ships fast, iterates later

---

### For Mainnet (Future)

**Approach:** Solution 3 (Delegation System)

**Phase 1: Aptos-native users**
1. User connects Aptos wallet
2. One-click delegation to our bot
3. Full trading capability

**Phase 2: Cross-chain users**
1. User inputs subaccount address
2. We detect it has USDC
3. Show instructions to delegate via Decibel UI
4. Once delegated, full trading capability

**Phase 3: Decibel SDK (if they release it)**
1. If Decibel releases multi-chain SDK
2. Integrate their derivation logic
3. Support ETH/SOL wallets natively

---

## 📊 USER DISTRIBUTION ESTIMATE

**For Decibel Testnet:**
- 70% Aptos native users (Petra/Martian) → ✅ Full support
- 20% Ethereum users (MetaMask) → ⚠️ Read-only or must switch
- 10% Solana users (Phantom) → ⚠️ Read-only or must switch

**For Mainnet:**
- 50% Aptos native → ✅ Full support
- 40% Ethereum users → ✅ Via delegation
- 10% Solana users → ✅ Via delegation

---

## 🔧 TECHNICAL IMPLEMENTATION

### Package Installation

```bash
# Install official Aptos wallet adapter
pnpm add @aptos-labs/wallet-adapter-react
pnpm add @aptos-labs/wallet-adapter-ant-design # or mui-design

# Install wallet plugins (all 14 supported wallets)
pnpm add petra-plugin-wallet-adapter
pnpm add @martianwallet/aptos-wallet-adapter
pnpm add @nightlylabs/aptos-wallet-adapter-plugin
pnpm add @pontem/wallet-adapter-plugin
pnpm add @rise-wallet/wallet-adapter
pnpm add @msafe/aptos-wallet-adapter
pnpm add @trustwallet/aptos-wallet-adapter
pnpm add @okwallet/aptos-wallet-adapter
pnpm add fewcha-plugin-wallet-adapter
pnpm add @blocto/aptos-wallet-adapter-plugin
pnpm add @welldone-studio/aptos-wallet-adapter
pnpm add @tp-lab/aptos-wallet-adapter
pnpm add @openblockhq/aptos-wallet-adapter
pnpm add @flipperplatform/wallet-adapter-plugin
```

### App Context Setup

```tsx
// app/providers.tsx
"use client"
import { AptosWalletAdapterProvider, NetworkName } from "@aptos-labs/wallet-adapter-react";
import { PetraWallet } from "petra-plugin-wallet-adapter";
import { MartianWallet } from "@martianwallet/aptos-wallet-adapter";
import { NightlyWallet } from "@nightlylabs/aptos-wallet-adapter-plugin";
// ... import all wallets

export function Providers({ children }: { children: React.ReactNode }) {
  const wallets = [
    new PetraWallet(),
    new MartianWallet(),
    new NightlyWallet(),
    // ... all 14 wallets
  ];

  return (
    <AptosWalletAdapterProvider
      plugins={wallets}
      autoConnect={true}
      onError={(error) => {
        console.error("Wallet error:", error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}
```

### Wallet Connection Component

```tsx
// components/wallet/connect-button.tsx
"use client"
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletSelector } from "@aptos-labs/wallet-adapter-ant-design";

export function ConnectWalletButton() {
  const { connected, account, disconnect } = useWallet();

  if (connected && account) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-400">
          {account.address.slice(0, 6)}...{account.address.slice(-4)}
        </span>
        <button onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return <WalletSelector />;
}
```

### Balance Checker

```tsx
// hooks/use-wallet-balance.ts
"use client"
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useState, useEffect } from "react";
import { decibelClient } from "@/lib/decibel-client";

export function useWalletBalance() {
  const { account, connected } = useWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [subaccount, setSubaccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !account) {
      setBalance(null);
      setSubaccount(null);
      return;
    }

    async function fetchBalance() {
      setLoading(true);
      try {
        // Get primary subaccount
        const sub = await decibelClient.getPrimarySubaccount(account.address);
        setSubaccount(sub);

        // Get balance
        const margin = await decibelClient.getAvailableMargin(sub);
        setBalance(margin);
      } catch (error) {
        console.error("Failed to fetch balance:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
  }, [connected, account]);

  return { balance, subaccount, loading };
}
```

---

## 🎯 DECISION MATRIX

| Scenario | User Wallet | Our Support | Trading Capability |
|----------|-------------|-------------|-------------------|
| User onboarded with Petra | Petra | ✅ Native | ✅ Full |
| User onboarded with Martian | Martian | ✅ Native | ✅ Full |
| User onboarded with MetaMask | None (manual) | ⚠️ Read-only | ❌ None (testnet) / ✅ Via delegation (mainnet) |
| User onboarded with Phantom | None (manual) | ⚠️ Read-only | ❌ None (testnet) / ✅ Via delegation (mainnet) |
| User has both Petra + MetaMask | Petra | ✅ Native | ✅ Full |

---

## ✅ FINAL RECOMMENDATION

### For This Week (Testnet MVP):

1. **Integrate Aptos Wallet Adapter** (all 14 wallets)
   - Primary path for 70%+ of users
   - Full trading capability
   - Clean UX

2. **Add Manual Address Input** (fallback)
   - For ETH/SOL wallet users
   - Read-only balance checking
   - Clear messaging: "To trade, use Aptos wallet"

3. **Document Clearly:**
   - "Best experience: Use Petra or Martian wallet"
   - "Have ETH/SOL wallet? You can check balance, but need Aptos wallet to trade"

### For Mainnet (Future):

1. **Implement Delegation System**
   - Support ALL users for trading
   - One-time setup, then seamless

2. **Monitor Decibel SDK**
   - If they release multi-chain SDK, integrate it
   - Native ETH/SOL support without delegation

---

**BOTTOM LINE:**
- ✅ Yes, it DOES matter that some users use ETH/SOL wallets
- ✅ We CAN support them with read-only mode (testnet MVP)
- ✅ We WILL support them fully via delegation (mainnet)
- ✅ Aptos wallet adapter is the right choice (supports 14 wallets)
- ✅ We're not excluding users, just starting with best UX first
