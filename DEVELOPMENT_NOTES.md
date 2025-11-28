# Decibel Market Maker Bot - Development Notes

*Last Updated: November 24, 2025 - Session 3*

## 🚨 CRITICAL UPDATES - Session 3

### ✅ What We Just Accomplished

1. **Solved the USDC Acquisition Blocker** 🎉
   - Analyzed Decibel's faucet system in depth
   - Identified 4 potential solutions (Manual, Programmatic, Multi-Wallet, Hybrid)
   - **Decision:** Implement hybrid approach (manual for MVP, test programmatic later)
   - Designed complete onboarding flow with USDC balance checks

2. **Documented Complete Faucet Architecture**
   - How it works: Navbar button → `restricted_mint` → 1000 USDC to subaccount
   - Multi-wallet strategy: 3000 USDC/day possible (ETH + SOL + Aptos)
   - On-chain constraints: Global limit 100k/day, per-user tracking via BPlusTreeMap
   - No REST API endpoint exists (UI only)

3. **Unblocked Project Development**
   - **Critical blocker removed:** We can ship MVP with manual funding
   - Clear implementation plan for Week 1 (manual flow)
   - Future upgrade path (test programmatic faucet in Week 2-3)
   - Project can now move forward to wallet integration phase

4. **Created Comprehensive Documentation**
   - Added 300+ line analysis section to DEVELOPMENT_NOTES.md
   - Detailed all 4 solution approaches with pros/cons
   - Implementation code examples for onboarding flow
   - Decision rationale and path forward

### 🔑 Key Decisions Made

**Decision:** Use Hybrid Approach (Solution D)
- **Phase 1 (This Week):** Manual pre-funding via Decibel UI
- **Phase 2 (Post-MVP):** Test programmatic `restricted_mint` calls
- **Phase 3 (If Needed):** Multi-wallet support for high-volume users

**Rationale:**
- De-risks the project (doesn't depend on unproven API calls)
- Ships immediately (no blockers)
- Preserves upgrade path (can add auto-refill later)
- Matches user expectations (testnet farmers understand manual faucets)

### 🎯 Immediate Next Steps

**Now Unblocked:**
1. **Build wallet connection UI** - Petra/Martian integration
2. **Build USDC onboarding flow** - Balance check + alert to mint
3. **Build bot launch API** - `/api/bot/start` endpoint
4. **Wire up native TWAP** - Use Decibel's `place_twap_order_to_subaccount`

**No Longer Blocked By:**
- ❌ "How will bots get USDC?" → ✅ Manual funding for MVP
- ❌ "Can we automate faucet?" → ✅ Test later, not required for launch
- ❌ "What if users need more USDC?" → ✅ Multi-wallet strategy documented

---

## 🚨 PREVIOUS UPDATES - Session 2

### ✅ What We Just Accomplished

1. **Successfully installed Aptos SDK** (`@aptos-labs/ts-sdk` v1.39.0)
   - Took 2m 8s, added 315 packages
   - All dependencies resolved correctly

2. **Discovered Decibel's Native TWAP Support** 🎉
   - Found `place_twap_order_to_subaccount()` entry function
   - Decibel handles order splitting automatically on-chain
   - This MASSIVELY simplifies our bot implementation
   - Parameters: size, is_long, min_duration, max_duration

3. **Mapped All Order Placement Functions**
   - `place_order_to_subaccount()` - Standard limit orders
   - `place_twap_order_to_subaccount()` - Native TWAP (!!!!)
   - `place_market_order_to_subaccount()` - Market orders
   - `place_bulk_orders_to_subaccount()` - Bulk placement
   - `cancel_order_to_subaccount()` - Cancel orders
   - `cancel_twap_orders_to_subaccount()` - Cancel TWAP

4. **Updated DecibelClient with Correct Signatures**
   - Fixed `placeLimitOrder()` to use `dex_accounts::place_order_to_subaccount`
   - Added `placeTWAPOrder()` method with native TWAP support
   - Fixed `cancelOrder()` to use correct parameter order
   - Added `getAccountOverview()` for REST API data
   - All function signatures verified against on-chain module ABI

5. **Documented Function Signatures**
   - All parameters documented with types (u64, u128, bool, Option<T>)
   - Market uses `Object<PerpMarket>` type (address string)
   - Subaccount uses `Object<Subaccount>` type (address string)
   - Order IDs are u128 (128-bit integers)

6. **Found All Market Addresses** ✅
   - Queried REST API `/api/v1/markets` successfully
   - BTC/USD: `0x6a39...3357e7` (40x leverage)
   - ETH/USD: `0xd909...936f8` (40x leverage)
   - Plus 7 other markets (SOL, APT, XRP, LINK, AAVE, ENA, HYPE)
   - Added to DecibelClient as `MARKETS` constant
   - Each market has: address, maxLeverage, sizeDecimals, priceDecimals

### 🔴 What's Still Unknown

1. **Market Addresses** - ✅ RESOLVED (see above)

2. **TWAP Order Behavior**
   - Unknown: How Decibel's native TWAP splits orders (time-based? event-based?)
   - Unknown: Can we query TWAP order progress/fills?
   - Unknown: Does TWAP respect directional bias, or just 50/50?
   - Need to test with small orders on testnet

3. **Order Type Enum**
   - Limit order uses `order_type = 0`
   - Need to find: Market order type (1?), Post-only (2?), FOK/IOC, etc.

### 🎯 Immediate Next Steps (Priority Order)

1. ~~**Find Market Addresses**~~ - ✅ DONE
   - ~~Open Decibel UI in browser devtools~~
   - ~~Capture network requests when placing orders~~
   - ~~Extract market Object addresses for BTC-PERP, ETH-PERP~~
   - ✅ Added all 9 markets to DecibelClient constants

2. **Test Native TWAP Order** - NEXT UP
   - Place small test TWAP order (e.g., $10 size, 5min duration)
   - Monitor fills via REST API or WebSocket
   - Verify fee calculations (should get maker rebate)
   - Document behavior for bot logic

3. **Simplify TWAPBot Implementation**
   - Since Decibel handles splitting, we can remove:
     - Order chunking logic
     - Time-based execution loop
     - Manual order placement intervals
   - Keep:
     - Margin calculations
     - Budget → Volume conversion
     - Execution mode configs (map to duration)

4. **Build Wallet Connection**
   - Add Petra wallet adapter
   - Add Martian wallet adapter
   - Implement hybrid approach: Auto-detect Aptos wallets, manual input for ETH/SOL

5. **Modify UI Components**
   - Add Budget input with live Volume calculation
   - Wire up margin checking with DecibelClient
   - Add market selector dropdown
   - Connect "INITIALIZE TRADING" button to bot execution

---

## 📊 SESSION 2 SUMMARY

### Major Breakthroughs

**1. Native TWAP Discovery** 🎉
   - Decibel has built-in `place_twap_order_to_subaccount()` function
   - Automatically handles order splitting on-chain
   - Eliminates need for our manual TWAP execution loop
   - Simplifies bot from 280 lines to potentially <100 lines

**2. Complete Function Mapping**
   - Queried all module ABIs using `find_order_functions.mjs`
   - Documented 14 order-related entry functions
   - Verified parameter types and order for each function
   - Updated DecibelClient with correct signatures

**3. Market Discovery**
   - Found all 9 available markets via REST API
   - BTC/USD and ETH/USD: 40x max leverage
   - Added MARKETS constant to DecibelClient
   - Each market includes: address, maxLeverage, sizeDecimals, priceDecimals

**4. Successful Integration Test**
   - Created `test_decibel_client.mjs` demonstrating usage
   - Verified subaccount query: ✅ Working
   - Verified balance query: ✅ $977.66 USDC available
   - All function signatures compile without errors

### What Changed in Code

**lib/decibel-client.ts (Updated)**
- ✅ Added MARKETS constant with 9 markets
- ✅ Fixed `placeLimitOrder()` to use `dex_accounts::place_order_to_subaccount`
- ✅ Added `placeTWAPOrder()` for native TWAP support
- ✅ Fixed `cancelOrder()` parameter order
- ✅ Added `getAccountOverview()` for REST API data
- ✅ All parameters use correct types (u64, u128, Object<T>, Option<T>)

**lib/twap-bot.ts (Updated)**
- ✅ Fixed parameter names: `marketId` → `marketAddress`, `isBuy` → `isLong`
- ⚠️ Still uses manual order splitting (needs refactor to use native TWAP)

**New Test Scripts**
- ✅ `find_order_functions.mjs` - Query module ABIs for entry functions
- ✅ `test_decibel_client.mjs` - Demonstrate correct usage of DecibelClient

### Next Session Goals

**Priority 1: Simplify TWAPBot**
- Refactor to use native `placeTWAPOrder()` instead of manual splitting
- Remove order chunking and time-based execution loop
- Map execution modes (aggressive/normal/passive) to duration ranges
- Keep margin calculations and Budget → Volume conversion

**Priority 2: Wallet Integration**
- Install and configure Petra wallet adapter
- Install and configure Martian wallet adapter
- Implement wallet connection UI component
- Build balance checker hook using DecibelClient

**Priority 3: UI Integration**
- Add Budget input with live Volume calculation
- Add market selector dropdown (BTC, ETH, SOL, etc.)
- Wire up margin warnings based on real-time balance
- Connect "INITIALIZE TRADING" button to bot execution

**Priority 4: Bot Execution API**
- Create `/api/bot/start` endpoint
- Create `/api/bot/status` endpoint
- Create `/api/bot/cancel` endpoint
- Store bot state in database or memory

---

## Project Overview

Building a Tread.fi-style market maker bot for Decibel (Aptos-native perpetuals DEX). The bot will allow users to run automated TWAP market-making strategies on testnet to farm volume/PnL for potential mainnet rewards.

---

## 🎯 Core Product Vision

### What We're Building
- **Market Maker Bot Interface** - One-click volume bot like Tread.fi
- **Budget ↔ Volume Calculator** - Linked inputs based on maker fees
- **TWAP Execution Engine** - Three modes: Aggressive/Normal/Passive
- **Directional Bias Control** - Slider from -1 (short) to +1 (long)
- **Real-time Margin Monitoring** - Live warnings for insufficient collateral
- **Bot History Dashboard** - Track active/completed bots with PnL

### Target Market
- Decibel testnet users farming for mainnet airdrop
- Users who already have testnet USDC (1000-2000 USDC)
- Goal: Generate massive volume to rank on leaderboard

### Revenue Model (Mainnet)
- **Vault Performance Fees**: 15% of bot profits
- **Protocol Integrator Shares**: 10-20% of volume fees (if Decibel offers)
- **Projected Year 1**: $250k-$500k at $2.5M TVL

---

## 🔬 Technical Research - What We Discovered

### Decibel Architecture Deep Dive

#### Account System (Verified On-Chain)
```
User Wallet (e.g., Ethereum address)
  ↓ (Derives to Aptos address)
Main Wallet: 0x<EXAMPLE_WALLET_ADDRESS>
  ↓ (Creates primary subaccount)
Primary Subaccount: 0x<EXAMPLE_SUBACCOUNT_ADDRESS>
  ↓ (USDC stored in DEX collateral system)
Collateral Store: 0x<EXAMPLE_COLLATERAL_STORE_ADDRESS>
```

**Key Findings:**
- Main wallet has NO USDC balance (only basic Account resource)
- Subaccount is an `Object` owned by main wallet
- USDC is NOT stored as FungibleAsset on user addresses
- Balance tracked in DEX's internal collateral system (offset-based accounting)
- Each subaccount can have delegated trading permissions

#### On-Chain Resources Found
**Main Wallet Resources:**
- `0x1::account::Account` - Basic account state

**Subaccount Resources:**
- `0x1::object::ObjectCore` - Object metadata
- `0x1::object::Untransferable` - Prevents transfers
- `0x1f51...::dex_accounts::Subaccount` - Trading permissions, delegations
- `0x1f51...::perp_positions::AccountInfo` - Fee tracking
- `0x1f51...::perp_positions::UserPositions` - Active positions (BPlusTreeMap)

**Example Position Data (WLFI/USD 3x Long):**
```json
{
  "market": "0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2",
  "is_long": true,
  "size": "19272280",
  "entry_px_times_size_sum": "3000404911800",
  "avg_acquire_entry_px": "155685",
  "user_leverage": 3,
  "is_isolated": false
}
```

### Balance Querying - The Solution

#### View Functions Discovered
```typescript
// Decibel Package: 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75

// Module: accounts_collateral
available_order_margin(address): u64
  - Returns available margin in raw USDC units (6 decimals)
  - Example: 1000330447 = $1000.33 USDC
  - This is the LIVE balance (fluctuates with PnL)

// Module: dex_accounts
primary_subaccount(address): address
  - Gets primary subaccount address for a wallet

primary_subaccount_object(address): Object<Subaccount>
  - Gets subaccount as typed object

// Module: perp_positions
get_maker_volume_in_window(address): u128
  - Trading volume as maker

// Module: dex_accounts (Entry Functions - Order Placement)
place_order_to_subaccount(...): void
  - Standard limit/market order placement
  - Parameters: subaccount, market, price, size, is_long, order_type, post_only, etc.

🎉 **MAJOR DISCOVERY**: place_twap_order_to_subaccount(...): void
  - Native TWAP order support built into Decibel!
  - Automatically splits orders over time on-chain
  - Parameters: subaccount, market, size, is_long, min_duration_seconds, max_duration_seconds
  - This means we DON'T need to manually implement TWAP splitting logic!

cancel_order_to_subaccount(...): void
  - Cancel individual orders
  - Parameters: subaccount, order_id (u128), market

cancel_twap_orders_to_subaccount(...): void
  - Cancel active TWAP orders
  - Parameters: subaccount, market, twap_order_id (u128)

get_taker_volume_in_window(address): u128
  - Trading volume as taker
```

#### Working Balance Query (Tested)
```javascript
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

async function getAvailableMargin(subaccountAddress) {
  const response = await fetch(`${APTOS_NODE}/view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      function: `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
      type_arguments: [],
      arguments: [subaccountAddress]
    })
  });

  const result = await response.json();
  const marginRaw = parseInt(result[0]);
  return marginRaw / 1_000_000; // Convert to USDC (6 decimals)
}

// Result: 1000.33 USDC ✅
```

### Why Decibel API Returns Zero

**Problem:** `GET /api/v1/account_overviews?user=0x...` returns all zeros even though UI shows balance.

**Root Cause:** Indexer lag
- API uses off-chain indexer that processes blocks
- Can take several minutes to update
- UI queries blockchain directly via view functions (instant)

**Solution:** We must query blockchain directly, not use REST API for balances.

### USDC Minting Process (Observed)

#### Transaction Flow
1. **User clicks "Mint USDC" on app.decibel.trade**
2. **Restricted Mint Transaction:**
   ```
   Function: 0x1f51...::usdc::restricted_mint
   Arguments: [1000000000] // 1000 USDC (6 decimals)
   Events:
     - Deposit to FungibleStore (main wallet)
     - Store address: 0x6016d5c629a81e8d234e9d76bdaf278e2bb658782c6515c52c025d10b674f5e7
   ```

3. **Auto-Deposit to Subaccount:**
   ```
   Function: 0x1f51...::dex_accounts::deposit_to_subaccount_at
   Arguments: [subaccount_addr, usdc_metadata, 1000000000]
   Events:
     - Withdraw from main wallet store
     - CollateralBalanceChangeEvent
     - Deposit to DEX collateral store (0x86ae...)
   ```

**Key Insight:** USDC is minted to main wallet, then immediately deposited to subaccount's collateral balance. We can verify this by checking the `restricted_mint` resource.

#### Faucet Constraints
```typescript
// Found in RestrictedMint resource
{
  "daily_restricted_mint": {
    "mints_per_day": "100000",
    "remaining_mints": "99940",
    "trigger_reset_mint_ts": "1764051202"
  },
  "total_restricted_mint_limit": "1000000000",
  "total_restricted_mint_per_owner": {
    // BPlusTreeMap tracking per-user mints
  }
}
```

**Observations:**
- Global limit: 100,000 mints per day
- Per-user limit: NOT enforced at 1000 USDC (we minted 2000 USDC successfully)
- Daily reset mechanism exists
- **Users CAN mint multiple times**

---

## 🔴 Critical Unknowns & Blockers

### 🚨 CRITICAL BLOCKER: USDC Acquisition for Algorithmic Trading

#### The Core Problem

**User's Question:** "But what I dont understand is how are we even going to get the api to work for algo trading when we can't get that USDC?"

This is the **most critical architectural question** for the entire project. If our bot needs to trade algorithmically but testnet USDC can only be obtained through manual UI interaction, we have a fundamental blocker.

#### How Decibel's Faucet Works

**Location:** Navbar "Mint" button on app.decibel.trade

**Process:**
1. User connects wallet (Ethereum, Solana, or Aptos)
2. User clicks "Mint USDC" button in navbar
3. System calls `restricted_mint` entry function
4. 1000 USDC minted directly to user's subaccount
5. Daily limit: 1000 USDC per wallet type per day

**Multi-Wallet Strategy:**
- Each wallet type (ETH/SOL/Aptos) can claim separately
- Maximum 3000 USDC/day if user connects all three wallet types
- User's derivation doesn't matter - Decibel abstracts this

**On-Chain Constraints:**
```typescript
// From RestrictedMint resource
{
  "daily_restricted_mint": {
    "mints_per_day": "100000",        // Global limit
    "remaining_mints": "99940",
    "trigger_reset_mint_ts": "1764051202"
  },
  "total_restricted_mint_limit": "1000000000",
  "total_restricted_mint_per_owner": {
    // BPlusTreeMap tracking per-user mints
  }
}
```

**Key Observations:**
- Global limit: 100,000 mints per day (unlikely to be hit)
- Per-user limit: Users successfully minted 2000 USDC (not strictly enforced at 1000)
- Daily reset mechanism exists
- No programmatic API endpoint discovered (UI button only)

#### Analysis: Is There a Programmatic Faucet API?

**Investigation Results:**

1. **REST API Exploration:** ❌
   - No `/api/faucet` or `/api/mint` endpoints found
   - Decibel API only has: `/markets`, `/account_overviews`, `/orderbook`, `/funding_rates`
   - No USDC minting endpoints exposed

2. **On-Chain Entry Function:** ⚠️
   ```move
   // Function: 0x1f51...::usdc::restricted_mint
   // Signature: restricted_mint(amount: u64)
   ```
   - Entry function exists and is callable on-chain
   - But likely has access control (only callable by authorized addresses)
   - Frontend probably signs with a privileged account

3. **Transaction Analysis:**
   - User clicks "Mint" → Frontend creates transaction
   - Transaction calls `restricted_mint` with hardcoded 1000 USDC
   - Signed by user's wallet (not a backend service)
   - This suggests users CAN call it directly if they have the right permissions

4. **Hypothesis:**
   - The `restricted_mint` function might check:
     - Caller is in allowlist, OR
     - Caller hasn't exceeded daily limit
   - If allowlist exists, we're blocked from programmatic calls
   - If it's just rate-limited, we could call it via our bot

#### Proposed Solutions

**Solution A: Manual Pre-Funding (Simplest, Least Automated)**

**How It Works:**
1. User manually mints 1000-3000 USDC via Decibel UI (5 minutes)
2. User connects wallet to our bot
3. Bot verifies sufficient balance before starting
4. Bot trades with pre-funded USDC
5. When balance runs low, bot pauses and alerts user to mint more

**Pros:**
- ✅ Works immediately without any faucet API
- ✅ No reverse-engineering required
- ✅ User controls their own funds
- ✅ Simple implementation

**Cons:**
- ❌ Manual step required before each bot run
- ❌ Friction in user experience
- ❌ Bot must pause when USDC runs out
- ❌ Users with high-volume strategies limited to 1000-3000 USDC/day

**Implementation:**
```typescript
// Onboarding flow
if (availableMargin < 100) {
  showAlert({
    title: "⚠️ Insufficient USDC",
    message: "You need testnet USDC to run bots. Get it from Decibel:",
    steps: [
      "1. Go to app.decibel.trade",
      "2. Connect your wallet",
      "3. Click 'Mint USDC' in navbar",
      "4. Return here and refresh balance"
    ],
    actions: [
      { label: "Go to Decibel", url: "https://app.decibel.trade" },
      { label: "Refresh Balance", onClick: recheckBalance }
    ]
  });
}
```

---

**Solution B: Programmatic Faucet Calls (Best UX, Requires Research)**

**How It Works:**
1. Bot attempts to call `restricted_mint` entry function directly
2. If successful, bot automatically tops up user's USDC when low
3. User never needs to visit Decibel UI manually

**Pros:**
- ✅ Fully automated experience
- ✅ Bot self-manages USDC balance
- ✅ No manual intervention required

**Cons:**
- ❌ May be blocked by access control on `restricted_mint`
- ❌ Requires testing with real transactions
- ❌ Could violate Decibel's intended faucet usage
- ❌ Risk of draining global daily limit

**Action Required:**
```typescript
// Test if we can call restricted_mint directly
async function testDirectFaucetCall(wallet) {
  const transaction = {
    function: `${DECIBEL_PACKAGE}::usdc::restricted_mint`,
    typeArguments: [],
    functionArguments: [1000_000_000], // 1000 USDC
  };

  try {
    const result = await aptos.signAndSubmitTransaction({
      sender: wallet,
      data: transaction,
    });
    console.log("✅ Direct faucet call successful!", result.hash);
    return true;
  } catch (error) {
    console.error("❌ Faucet call blocked:", error.message);
    // Check if error is "UNAUTHORIZED" vs "RATE_LIMITED"
    return false;
  }
}
```

**Next Step:**
- Test calling `restricted_mint` from our bot wallet
- If successful → implement auto-refill
- If blocked → fall back to Solution A or C

---

**Solution C: Multi-Wallet Pooling (Advanced, High Capacity)**

**How It Works:**
1. Bot supports connecting multiple wallets (ETH + SOL + Aptos)
2. Each wallet mints 1000 USDC/day separately
3. Bot aggregates balances: 3000 USDC/day capacity
4. Bot rotates between subaccounts to maximize volume

**Pros:**
- ✅ 3x daily USDC capacity (3000 vs 1000)
- ✅ Still uses official faucet (no hacks)
- ✅ Supports high-volume traders

**Cons:**
- ❌ Complex wallet management
- ❌ Users must connect 3 wallets
- ❌ Still requires manual minting (3x the friction)
- ❌ Subaccount coordination complexity

**Use Case:**
- Only worth it for users wanting to generate >$285k volume/day
- Most testnet farmers will be fine with 1000 USDC/day

---

**Solution D: Hybrid (Recommended for MVP)**

**How It Works:**
1. **Phase 1 (MVP):** Manual pre-funding (Solution A)
   - User mints USDC via Decibel UI once
   - Bot trades with pre-funded balance
   - Simple, reliable, ships immediately

2. **Phase 2 (Post-Launch):** Test programmatic faucet
   - After MVP launch, test `restricted_mint` directly
   - If it works → add auto-refill feature
   - If blocked → document it and keep manual flow

3. **Phase 3 (Future):** Multi-wallet support (if demand exists)
   - Only add if users request >1000 USDC/day capacity
   - Likely not needed for testnet

**Why This Works:**
- ✅ Shipping blocker removed (use Solution A immediately)
- ✅ Opportunity to upgrade UX later (Solution B)
- ✅ Scales with user demand (Solution C if needed)
- ✅ De-risks project (don't bet on unproven API calls)

#### Recommended Implementation Plan

**Week 1: Manual Funding Flow (MVP)**
```typescript
// components/onboarding/usdc-check.tsx
export function USDCBalanceCheck({ walletAddress }) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    async function checkBalance() {
      const margin = await decibelClient.getAvailableMargin(walletAddress);
      setBalance(margin);
    }
    checkBalance();
  }, [walletAddress]);

  if (balance === null) return <Spinner />;

  if (balance < 100) {
    return (
      <Alert variant="warning">
        <AlertTitle>⚠️ Insufficient USDC</AlertTitle>
        <AlertDescription>
          You need testnet USDC to run bots. Current balance: ${balance.toFixed(2)}

          <Steps>
            <Step>1. Visit <Link href="https://app.decibel.trade">app.decibel.trade</Link></Step>
            <Step>2. Connect your {walletType} wallet</Step>
            <Step>3. Click "Mint USDC" in navbar (1000 USDC/day)</Step>
            <Step>4. Return here and refresh</Step>
          </Steps>

          <Button onClick={() => window.open('https://app.decibel.trade')}>
            Get USDC →
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="success">
      <AlertTitle>✅ Ready to Trade</AlertTitle>
      <AlertDescription>
        Available: ${balance.toFixed(2)} USDC
      </AlertDescription>
    </Alert>
  );
}
```

**Week 2-3: Research Programmatic Faucet**
- Test `restricted_mint` calls from bot wallet
- Analyze access control mechanisms
- Document findings in DEVELOPMENT_NOTES.md
- If successful, implement auto-refill feature

**Future: Multi-Wallet (Only If Needed)**
- Monitor user feedback
- If users request >1000 USDC/day capacity, build multi-wallet support
- Otherwise, keep it simple

#### Decision: Path Forward

**Immediate Action:** Implement Solution D (Hybrid)
- Build manual funding flow for MVP (ships this week)
- User onboarding includes "Get USDC from Decibel" step
- Bot verifies balance before starting
- Bot pauses and alerts if balance runs too low

**Next Step:** Test programmatic faucet after MVP launch
- Create test script to call `restricted_mint` directly
- If successful → add auto-refill in v2
- If blocked → document and keep manual flow

**Documentation:**
- Add "Getting Testnet USDC" section to user docs
- Include screenshots of Decibel mint flow
- Set expectation: 1000 USDC/day limit
- Recommend budget planning: $100 budget = $285k volume = 3-4 bot runs/day

---

### 1. Multi-Chain Wallet Support

#### The Problem
Decibel allows users to connect:
- Ethereum wallets (MetaMask, Coinbase Wallet, etc.)
- Solana wallets (Phantom, Solflare, etc.)
- Aptos wallets (Petra, Martian, etc.)

**We don't know:**
- How Decibel derives Aptos addresses from ETH/SOL wallets
- If the derivation is deterministic or server-side mapping
- Whether we can replicate their derivation scheme

**Example address derivation pattern:**
```
Ethereum Wallet: 0x<EXAMPLE_ETH_ADDRESS>
Aptos Main Wallet: 0x<EXAMPLE_APTOS_ADDRESS>
Subaccount: 0x<EXAMPLE_SUBACCOUNT_ADDRESS>
```

**Question:** How did ETH address → Aptos address conversion happen?

### 2. Wallet Connection Strategy

#### Constraint
We can ONLY query balances if we know the user's Aptos subaccount address.

#### Three Possible Approaches

**Option A: Aptos-Only (Simplest)**
```
✅ Support: Petra, Martian wallets only
✅ We can: Derive subaccount deterministically
✅ We can: Query balance automatically
❌ Problem: Users who onboarded with ETH/SOL can't use us
❌ Problem: Smaller addressable market
```

**Option B: Multi-Wallet (Complex)**
```
✅ Support: ETH, SOL, APT wallets
❌ Need: Reverse-engineer Decibel's derivation
❌ Need: Multiple wallet adapter libraries
❌ Problem: We don't have derivation scheme
❌ Problem: Complex integration
```

**Option C: Hybrid (Recommended)**
```
✅ Primary: Petra/Martian auto-detect
✅ Fallback: Manual address input
✅ UX Flow:
   1. "Connect Aptos wallet" (auto-detects balance)
   2. OR
   3. "Already have Decibel USDC? Enter your Aptos address manually"
   4. User copies address from Decibel UI → pastes here
✅ Covers all user types
❌ Slightly clunky for ETH/SOL users
```

### 3. SDK Availability

**Status:** `@decibel/sdk` does NOT exist on npm
```bash
npm install @decibel/sdk
# Error: 404 Not Found
```

**Implications:**
- Must use raw `@aptos-labs/ts-sdk` for all transactions
- Must manually build transaction payloads
- Must manually handle view function calls
- More boilerplate code

**Workaround:** We built our own client wrapper (`lib/decibel-client.ts`)

### 4. Order Placement Functions

**Unknown:** Exact function signatures for placing orders

**Need to find:**
```
// Guessed based on docs, NOT verified:
function: 0x1f51...::orders::place_limit_order
arguments: [
  subaccount_addr,
  market_id,
  is_buy,
  price (u64),
  size (u64),
  post_only (bool)
]

// Alternative naming possibilities:
::dex_accounts::place_order_to_subaccount
::perp_engine::submit_order
::orderbook::add_limit_order
```

**Action Required:** Query module ABIs to find exact function names.

---

## 🛠️ Technical Implementation Plan

### Architecture Overview

```
┌─────────────────────────────────────────────┐
│         Next.js Frontend (React)            │
│  ┌────────────────────────────────────────┐ │
│  │  Wallet Connection (Petra/Martian)     │ │
│  │  - Auto-detect Aptos address           │ │
│  │  - Manual address input fallback       │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  Market Maker Bot UI                   │ │
│  │  - Budget ↔ Volume calculator          │ │
│  │  - Execution mode selector             │ │
│  │  - Directional bias slider             │ │
│  │  - Pre-trade analytics panel           │ │
│  │  - Margin warning system               │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────┐
│         API Routes (Next.js)                │
│  ┌────────────────────────────────────────┐ │
│  │  POST /api/bot/launch                  │ │
│  │  - Validate config                     │ │
│  │  - Create delegation tx (if needed)    │ │
│  │  - Spawn TWAPBot instance              │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  GET /api/balance/:address             │ │
│  │  - Query available_order_margin        │ │
│  │  - Return USDC balance                 │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────┐
│         Bot Engine (Server-Side)            │
│  ┌────────────────────────────────────────┐ │
│  │  TWAPBot Class                         │ │
│  │  - Calculate TWAP slices               │ │
│  │  - Place post-only orders              │ │
│  │  - Monitor fills & exposure            │ │
│  │  - Auto-pause on exposure limit        │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  DecibelClient Class                   │ │
│  │  - View function calls                 │ │
│  │  - Transaction building                │ │
│  │  - Order placement                     │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────┐
│         Aptos Blockchain                    │
│  - Query view functions                     │
│  - Submit signed transactions               │
│  - Monitor events                           │
└─────────────────────────────────────────────┘
```

### Files Created So Far

#### `/lib/decibel-client.ts` (181 lines)
**Purpose:** Wrapper around Aptos SDK for Decibel-specific operations

**Key Functions:**
```typescript
class DecibelClient {
  // Balance queries
  async getAvailableMargin(subaccountAddress: string): Promise<number>
  async getPrimarySubaccount(walletAddress: string): Promise<string>

  // Market data
  async getOrderbook(marketId: string)
  async getMarket(marketId: string)

  // Trading (TODO: verify function names)
  async placeLimitOrder(params: {
    marketId: string;
    subaccountAddress: string;
    isBuy: boolean;
    price: number;
    size: number;
    postOnly: boolean;
  }): Promise<string>

  async cancelOrder(params: {
    subaccountAddress: string;
    marketId: string;
    orderId: string;
  }): Promise<string>
}
```

**Constants:**
```typescript
DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
USDC_DECIMALS = 6
PRICE_DECIMALS = 6
MAKER_REBATE = 0.00015  // -0.015%
TAKER_FEE = 0.00045     // 0.045%
BUILDER_FEE = 0.0002    // 0.02%
```

#### `/lib/twap-bot.ts` (280 lines)
**Purpose:** TWAP market maker bot execution engine

**Key Features:**
```typescript
class TWAPBot {
  // Execution modes
  EXECUTION_MODES = {
    aggressive: {
      participationRate: 0.05,  // 5% of market volume
      minDuration: 300,         // 5 minutes
      safetyBuffer: 2.0         // 2x margin buffer
    },
    normal: {
      participationRate: 0.01,  // 1%
      minDuration: 900,         // 15 min
      safetyBuffer: 1.0
    },
    passive: {
      participationRate: 0.005, // 0.5%
      minDuration: 1800,        // 30 min
      safetyBuffer: 0.5
    }
  }

  // Core logic
  private calculateVolume(): number
  private calculateAlphaTilt(): number  // -0.2 to +0.2 from bias
  private calculateTWAPWeight(progress, alphaTilt): number
  private calculateRequiredMargin(notional): number
  private isExposureWithinTolerance(): boolean  // Max 8%

  async start(): Promise<void>
  async executeSlice(sliceVolume): Promise<void>
  stop(): void
}
```

**TWAP Algorithm:**
```
Volume = Budget / (BUILDER_FEE - MAKER_REBATE)
  e.g., $100 budget → $285,714 volume

Alpha Tilt = Directional Bias * 0.2
  - Positive bias: front-loads buys, back-loads sells
  - Negative bias: front-loads sells, back-loads buys
  - Neutral (0): even distribution

Slice Weight = baseWeight * (1 + alphaTilt * (2 * progress - 1))
  - Progress = sliceIndex / totalSlices
  - Adjusts order size based on tilt

Required Margin = (notional / leverage) * safetyBuffer * (1 + |bias| * 0.2)
  - Increases margin for extreme bias

Exposure Check = |buyVolume - sellVolume| / totalVolume <= 0.08
  - Auto-pause if exposure > 8%
```

#### `/lib/calculations.ts` (168 lines)
**Purpose:** Utility functions for fee/margin calculations

**Key Functions:**
```typescript
// Budget ↔ Volume conversion
calculateVolumeFromBudget(budget: number): number
calculateBudgetFromVolume(volume: number): number

// Margin calculations
calculateRequiredMargin(params: {
  volume: number;
  leverage: number;
  executionMode: ExecutionMode;
  directionalBias: number;
}): number

// Margin safety
getMarginWarningLevel(required, available): 'safe' | 'warning' | 'danger'

// Duration estimates
calculateEstimatedDuration(params: {
  volume: number;
  executionMode: ExecutionMode;
  dailyVolume: number;
}): number

// Fee breakdown
calculateFeeBreakdown(volume: number): {
  makerRebate: number;
  builderFee: number;
  netFee: number;
  budget: number;
}

// Config validation
validateBotConfig(params): { valid: boolean; errors: string[] }
```

**Example Calculations:**
```typescript
// Budget → Volume
const volume = calculateVolumeFromBudget(100);
// 100 / (0.0002 - (-0.00015)) = 100 / 0.00035 = $285,714

// Margin for 3x leverage, normal mode, neutral bias
const margin = calculateRequiredMargin({
  volume: 285714,
  leverage: 3,
  executionMode: 'normal',
  directionalBias: 0
});
// (285714 / 3) * 1.0 * 1.0 = $95,238

// Warning level
getMarginWarningLevel(95238, 100000); // 'safe'
getMarginWarningLevel(95238, 20000);  // 'danger'
```

### Existing UI Components

#### `/components/dashboard/trading-view.tsx`
**Current State:**
- ✅ Execution mode selector (Aggressive/Normal/Passive)
- ✅ Directional bias slider
- ✅ Pre-trade analytics panel
- ✅ Configuration panel
- ❌ Long/Short dual-sided (need to change to single market)
- ❌ Notional input (need Budget ↔ Volume linked inputs)
- ❌ No wallet connection
- ❌ No balance display
- ❌ No margin warnings

**Required Changes:**
1. Replace Long/Short sections with single Market Selector
2. Add Budget ↔ Volume linked inputs (Tread.fi style)
3. Add wallet connection button
4. Add USDC balance display
5. Add margin warning banners (red/orange/green)
6. Wire up to API routes

#### `/components/dashboard/header.tsx`
**Current State:**
- Shows static profile (blockchain_test_bybit)
- Shows Trader ID (mock data)
- Has vCeFi/Vault toggles

**Required Changes:**
1. Add "Connect Wallet" button
2. Show connected wallet address
3. Display real-time USDC balance
4. Add network indicator (Testnet)

#### `/components/dashboard/history-table.tsx`
**Current State:**
- Has table structure for bot history
- Shows Pair, Volume, Fees, PnL, Filled %, Status

**Required Changes:**
1. Wire up to database/API for real bot data
2. Add "Active Bots Only" filter
3. Add live updates (WebSocket or polling)
4. Add Cancel/Pause buttons for active bots

---

## 📊 Market Maker Bot Feature Spec (Tread.fi Parity)

### Input Controls

#### 1. Budget ↔ Volume Linked Fields
```
┌─────────────────────┐  ⟷  ┌─────────────────────┐
│  Budget: $100      │      │  Volume: $285,714   │
│  (fees to spend)    │      │  (total notional)   │
└─────────────────────┘      └─────────────────────┘

Formula:
  volume = budget / effectiveFee
  effectiveFee = BUILDER_FEE - MAKER_REBATE
               = 0.0002 - (-0.00015)
               = 0.00035 (0.035%)

User can edit either field:
  - Edit Budget → Volume auto-updates
  - Edit Volume → Budget auto-updates
```

#### 2. Market Selector
```
Dropdown: [BTC-USD ▼]
Options:
  - BTC-USD (default)
  - ETH-USD
  - SOL-USD
  - (all Decibel perps)

Shows:
  - Current price
  - 24h volume (for participation rate calc)
  - Funding rate
```

#### 3. Execution Mode Tabs
```
┌─────────────┬─────────────┬─────────────┐
│ AGGRESSIVE  │   NORMAL    │   PASSIVE   │
│   ~5 MIN    │   ~15 MIN   │   ~30 MIN   │
└─────────────┴─────────────┴─────────────┘

Selected mode highlights + shows config:
  - Duration estimate
  - Participation rate
  - Safety buffer
```

#### 4. Directional Bias Slider
```
        SHORT  ←────  NEUTRAL  ────→  LONG
         -1              0              +1
         ●━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━●
                         ▲
                      (current)

Effects:
  - Positive: Front-load buys, back-load sells
  - Negative: Front-load sells, back-load buys
  - Increases margin requirement up to 20%
```

### Pre-Trade Analytics Panel

```
┌────────────────────────────────────┐
│  Pre-Trade Analytics               │
├────────────────────────────────────┤
│  Available Margin    $1,000.33     │ ← Live balance
│  Recommended Margin  $95.24        │ ← Calculated
│  Est. Duration       15m 30s       │ ← Based on volume
│  Maker Rebate        -$42.86       │ ← volume * -0.015%
│  Builder Fee         +$57.14       │ ← volume * 0.02%
│  Net Cost            $14.28        │ ← Should ≈ budget
│  Participation Rate  1.0%          │ ← From mode
└────────────────────────────────────┘
```

### Margin Warning System

```
if (available < recommended * 0.1) {
  ┌────────────────────────────────────────────────┐
  │ ⚠️  CRITICAL: Insufficient Margin              │
  │ Available: $50 | Recommended: $95 (need 2x)    │
  │ → Reduce notional or add more USDC             │
  └────────────────────────────────────────────────┘
  [Launch Bot button DISABLED]

} else if (recommended > available * 5) {
  ┌────────────────────────────────────────────────┐
  │ ⚠️  WARNING: Tight Margin                      │
  │ Available: $100 | Recommended: $95 (close)     │
  └────────────────────────────────────────────────┘
  [Launch Bot button ENABLED with warning]

} else {
  ┌────────────────────────────────────────────────┐
  │ ✅ Safe Margin                                 │
  │ Available: $1,000 | Recommended: $95           │
  └────────────────────────────────────────────────┘
  [Launch Bot button ENABLED, green]
}
```

### Bot Execution Flow

```
User clicks "INITIALIZE TRADING"
  ↓
Validation:
  ✓ Wallet connected
  ✓ Sufficient margin
  ✓ Market exists
  ✓ Config valid
  ↓
[First time only] Create Delegation:
  Transaction: delegateTradingTo(BOT_OPERATOR_ADDRESS)
  User signs in wallet
  ↓
Server-side:
  - Create TWAPBot instance
  - Store in DB with user ID
  - Start execution loop
  ↓
Bot runs:
  Every 30s (or based on sliceInterval):
    1. Check exposure < 8%
    2. Calculate slice size (TWAP weighted)
    3. Get orderbook (best bid/ask)
    4. Place post-only buy order (inside spread)
    5. Place post-only sell order (inside spread)
    6. Update state (buyVolume, sellVolume, exposure)
    7. If filled → update progress
    8. If exposure > 8% → pause
  ↓
User sees live updates:
  - Progress: 45% filled ($128k / $286k)
  - Net Exposure: +$1,200 (0.4%)
  - Maker Rebate Earned: -$19.20
  - Status: ACTIVE | PAUSED | COMPLETED
  - [PAUSE] [CANCEL] buttons
  ↓
On completion or cancel:
  - Mark bot as completed
  - Calculate final PnL
  - Show in history
```

---

## 🚀 User Onboarding Flow (Detailed)

### Phase 1: Wallet Connection

```
┌───────────────────────────────────────────────┐
│  Welcome to Decibrrr                          │
│                                               │
│  [Connect Petra Wallet]                       │
│  [Connect Martian Wallet]                     │
│  ──────── OR ────────                         │
│  Already have Decibel USDC?                   │
│  Enter your Aptos address:                    │
│  [___________________________________]         │
│  [Check Balance]                              │
└───────────────────────────────────────────────┘

Path A: Petra/Martian
  → Auto-detect address
  → Query primary_subaccount(walletAddr)
  → Query available_order_margin(subaccountAddr)
  → Show balance

Path B: Manual Input
  → User pastes subaccount address from Decibel UI
  → Query available_order_margin(pastedAddr)
  → Show balance
```

### Phase 2: Balance Check

```javascript
const balance = await getAvailableMargin(subaccountAddr);

if (balance === 0) {
  ┌───────────────────────────────────────────────┐
  │  ⚠️  No Testnet USDC Detected                │
  │                                               │
  │  You need testnet USDC to run bots.          │
  │                                               │
  │  Get it in 2 minutes:                         │
  │  1. Go to app.decibel.trade                   │
  │  2. Connect your wallet                       │
  │  3. Click "Mint USDC"                         │
  │  4. Come back and refresh                     │
  │                                               │
  │  [Go to Decibel] [Refresh Balance]            │
  └───────────────────────────────────────────────┘

} else if (balance < 100) {
  ┌───────────────────────────────────────────────┐
  │  ⚠️  Low Balance                              │
  │  Available: $${balance} USDC                  │
  │                                               │
  │  Minimum recommended: $100 USDC               │
  │  You can still run small bots, or mint more.  │
  │                                               │
  │  [Get More USDC] [Continue Anyway]            │
  └───────────────────────────────────────────────┘

} else {
  ┌───────────────────────────────────────────────┐
  │  ✅ Ready to Trade!                           │
  │  Available: $${balance} USDC                  │
  │                                               │
  │  [Launch Your First Bot →]                    │
  └───────────────────────────────────────────────┘
}
```

### Phase 3: First Bot Launch

```
User configures bot:
  - Budget: $100
  - Market: BTC-USD
  - Mode: Normal (15 min)
  - Bias: 0 (Neutral)

Pre-trade check:
  ✓ Available: $1,000 > Recommended: $95
  ✓ Market active
  ✓ Config valid

User clicks "INITIALIZE TRADING"
  ↓
[First time] Delegation prompt:
  ┌───────────────────────────────────────────────┐
  │  🔐 Grant Trading Permission                  │
  │                                               │
  │  To run bots, you need to delegate trading    │
  │  to our operator wallet.                      │
  │                                               │
  │  This allows us to:                           │
  │  ✓ Place/cancel orders on your behalf        │
  │  ✓ Monitor your positions                    │
  │                                               │
  │  We CANNOT:                                   │
  │  ✗ Withdraw your USDC                        │
  │  ✗ Transfer your assets                      │
  │                                               │
  │  You can revoke anytime.                      │
  │                                               │
  │  [Sign Transaction]  [Cancel]                 │
  └───────────────────────────────────────────────┘

User signs delegation tx
  ↓
Bot launches
  ↓
Success toast:
  "Bot #1 launched! Targeting $285k volume over 15 minutes."

Redirect to Active Bots view
```

### Phase 4: Monitoring

```
Active Bots Tab:

┌─────────────────────────────────────────────────────────┐
│  Bot #1 - BTC-USD Market Maker                          │
│  ────────────────────────────────────────────────────── │
│  Status: ACTIVE                          [PAUSE] [STOP] │
│  Progress: ████████████░░░░░░░ 45%                      │
│  Volume: $128,571 / $285,714                            │
│  Duration: 6m 45s / 15m 00s                             │
│  Net Exposure: +$1,200 (0.4% - SAFE)                    │
│  Maker Rebate: -$19.29                                  │
│  MM PnL: +$5.12                                         │
└─────────────────────────────────────────────────────────┘

Live updates every 3 seconds via polling or WebSocket
```

---

## 💡 Key Decisions & Rationale

### Why Option C (Hybrid Wallet)?

**Decision:** Support Petra/Martian auto-detect + manual address input

**Rationale:**
1. **Simplicity:** Don't need to reverse-engineer ETH/SOL derivation
2. **Coverage:** Supports all user types (APT native + ETH/SOL via manual)
3. **Speed:** Can ship immediately without SDK
4. **Future-proof:** When SDK available, can upgrade to full multi-wallet

**Trade-off:** Manual input is slightly clunky for ETH/SOL users, but acceptable for testnet farming where users are tech-savvy.

### Why Direct Blockchain Queries?

**Decision:** Query `available_order_margin` view function directly instead of REST API

**Rationale:**
1. **Real-time:** View functions return instant data (API has indexer lag)
2. **Accuracy:** Matches what Decibel UI shows
3. **Dynamic:** Captures PnL fluctuations from open positions
4. **Reliability:** No dependency on indexer uptime

**Trade-off:** More code to maintain, but necessary for UX parity with Decibel.

### Why TWAP Market Maker?

**Decision:** Focus on market-making strategy (not directional trading)

**Rationale:**
1. **Volume farming:** Generates massive notional for leaderboard
2. **Lower risk:** Balanced buy/sell sides reduce directional exposure
3. **Maker rebates:** Earns fees instead of paying them
4. **Tread.fi proven:** Users already understand this UX
5. **Testnet optimal:** Fake money + volume incentives = perfect fit

**Alternative considered:** Directional momentum bots (rejected - too risky for users, less volume)

---

## 🔧 Next Steps (Implementation Roadmap)

### Week 1: Core Infrastructure
- [x] Install Aptos SDK
- [x] Build DecibelClient wrapper
- [x] Build TWAPBot engine
- [x] Build calculation utilities
- [ ] Test order placement (find correct function names)
- [ ] Add Petra wallet adapter
- [ ] Add Martian wallet adapter
- [ ] Build balance checker API route

### Week 2: UI Components
- [ ] Modify TradingView for Market Maker mode
- [ ] Add Budget ↔ Volume linked inputs
- [ ] Add margin warning banners
- [ ] Wire up wallet connection to header
- [ ] Build manual address input fallback
- [ ] Add market selector dropdown
- [ ] Style execution mode tabs

### Week 3: Bot Execution
- [ ] Build `/api/bot/launch` route
- [ ] Implement delegation transaction flow
- [ ] Create bot state management (DB or in-memory)
- [ ] Build bot monitoring system (polling)
- [ ] Add pause/resume functionality
- [ ] Add cancel + auto-close positions
- [ ] Wire up history table to real data

### Week 4: Testing & Launch
- [ ] Test on Aptos testnet with real USDC
- [ ] Monitor bot execution for bugs
- [ ] Add error handling + retry logic
- [ ] Add exposure auto-pause
- [ ] Deploy to Vercel
- [ ] Launch to Decibel community

---

## 🐛 Known Issues & Workarounds

### Issue 1: Aptos SDK Installation Slow
**Problem:** `pnpm add @aptos-labs/ts-sdk` takes 2+ minutes
**Workaround:** Use longer timeout, pre-install in Docker
**Status:** Resolved (installed successfully)

### Issue 2: Order Placement Function Unknown
**Problem:** Exact function signature not documented
**Action Required:** Query module ABI or test with known patterns
**Guesses:**
```typescript
// Option A:
0x1f51...::orders::place_limit_order(
  subaccount_addr, market_id, is_buy, price, size, post_only
)

// Option B:
0x1f51...::dex_accounts::place_order_to_subaccount(
  subaccount_addr, market_id, is_buy, price, size, time_in_force
)

// Option C (from docs hint):
0x1f51...::perp_engine::submit_order(...)
```

### Issue 3: Indexer Lag on Balance API
**Problem:** REST API returns zero balance for minutes after transaction
**Workaround:** Use view functions directly (implemented)
**Status:** Resolved

### Issue 4: Multi-Wallet Derivation Unknown
**Problem:** Don't know how Decibel derives Aptos from ETH/SOL
**Workaround:** Hybrid approach (auto-detect APT + manual input)
**Status:** Accepted as design constraint

---

## 📚 References & Documentation

### Decibel Official
- API Base: `https://api.netna.aptoslabs.com/decibel`
- Package: `0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75`
- Frontend: `https://app.decibel.trade`

### Aptos Resources
- Node: `https://api.testnet.aptoslabs.com/v1`
- Explorer: `https://explorer.aptoslabs.com/?network=testnet`
- SDK Docs: `https://aptos.dev/sdks/ts-sdk/`

### View Functions (Verified)
```
accounts_collateral::available_order_margin(address): u64
dex_accounts::primary_subaccount(address): address
dex_accounts::primary_subaccount_object(address): Object<Subaccount>
perp_positions::get_maker_volume_in_window(address): u128
perp_positions::get_taker_volume_in_window(address): u128
```

### Constants
```typescript
DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75'
USDC_METADATA = '0x8bc4c7c2180b05fcc5ed7802c62cbcabdf2a2dfd7cb19f5fce8beb7cdfab01c2'
COLLATERAL_STORE = '0x86aef2ef85b617efc54d6ecb16382e3c477801aef86efeb15b2ad7b3e949cc9b'
PRIMARY_BALANCE_TABLE = '0xc8a1388ac9979097370bda9b5931b901d3b1d5e0de8f33e50b5d02392f32506'

USDC_DECIMALS = 6
PRICE_DECIMALS = 6
MAKER_REBATE = -0.015%
TAKER_FEE = 0.045%
BUILDER_FEE = 0.02%
```

### Example Wallet Data
```
ETH Wallet: 0x<EXAMPLE_ETH_WALLET>
↓
Aptos Main: 0x<EXAMPLE_APTOS_WALLET>
Subaccount: 0x<EXAMPLE_SUBACCOUNT>
Balance: $1,000.33 USDC (fluctuates with PnL)
Position: WLFI/USD 3x LONG, size=19272280
```

---

## 🎓 Lessons Learned

### What Worked
1. **Direct view function queries** - Instant, accurate balance data
2. **Module ABI inspection** - Found exact function signatures
3. **Transaction event analysis** - Understood USDC flow
4. **Hybrid wallet approach** - Pragmatic solution to multi-chain problem

### What Didn't Work
1. **REST API for balances** - Too slow (indexer lag)
2. **Assuming SDK exists** - Wasted time trying to install
3. **Trying to support all wallets** - Too complex without SDK

### Key Insights
1. **Testnet = volume game** - Users care about PnL leaderboard
2. **Maker rebates are key** - We EARN fees instead of paying
3. **Cross-margin is dynamic** - Balance changes with every price tick
4. **Delegation is required** - Users must approve bot trading once

### Future Considerations
1. When Decibel SDK launches → refactor to use it
2. If mainnet rewards volume → pivot to max volume strategies
3. If mainnet rewards PnL → add directional trading bots
4. Consider vault pooling model → we take perf fee on managed capital

---

*End of Development Notes - Last Updated: November 24, 2025*
