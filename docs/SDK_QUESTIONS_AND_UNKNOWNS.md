# Decibel API & SDK - Questions and Unknowns

**Date**: November 27, 2025
**Status**: Official SDK exists but is not publicly available on npm yet

---

## 📚 What We KNOW

### ✅ Official Decibel SDK Exists

**Package Name**: `@decibel/sdk`
**Status**: **EXISTS but NOT PUBLIC on npm yet**

**Evidence**:
- Documentation exists at https://docs.decibel.trade/typescript-sdk
- Installation instructions show: `npm install @decibel/sdk @aptos-labs/ts-sdk zod`
- Full API documentation for `DecibelReadDex` and `DecibelWriteDex` classes
- Type definitions and method signatures are documented

**Classes**:
```typescript
import {
  DecibelReadDex,      // Read-only operations
  DecibelWriteDex,     // Write operations (transactions)
  NETNA_CONFIG,        // Network configuration
  GasPriceManager      // Gas price optimization
} from "@decibel/sdk"
```

### ✅ SDK Capabilities (From Docs)

#### **DecibelReadDex** (Read-Only, No Private Keys)
```typescript
const read = new DecibelReadDex(NETNA_CONFIG, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY, // optional
});

// Available methods:
await read.markets.getAll()
await read.markets.getByName("BTC-USD")
await read.marketPrices.getByName("BTC-USD")
await read.marketDepth.getByName("BTC-USD")
await read.marketTrades.getByName("BTC-USD")
await read.candlesticks.getByName("BTC-USD", interval, start, end)
await read.accountOverview.getByAddr(addr)
await read.userOpenOrders.getBySubaccount(subaccount)
await read.userPositions.getBySubaccount(subaccount)
await read.userTradeHistory.getBySubaccount(subaccount)
await read.userSubaccounts.getByOwner(owner)
await read.delegations.getForSubaccount(subaccount)
await read.vaults.getUserOwned(user)
await read.portfolioChart.getByAddr(addr)
await read.leaderboard.getTopUsers()
```

#### **DecibelWriteDex** (Write Operations, Requires Private Key)
```typescript
const account = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
  gasPriceManager: gas, // optional
  skipSimulate: false,  // simulate before submit
  noFeePayer: false,   // use Decibel's fee payer service
});

// Available methods:
await write.placeOrder({...})
await write.placeTwapOrder({...})
await write.cancelOrder(orderId)
await write.cancelTwapOrder(twapId)
await write.deposit(amount, subaccount)
await write.withdraw(amount, subaccount)
await write.delegateTradingTo(subaccount, delegatee, expiration)
await write.revokeDelegation(subaccount, delegatee)
await write.createSubaccount()
await write.renameSubaccount(subaccount, newName)
await write.configureUserSettingsForMarket(market, subaccount, isCross, leverage)
await write.placeTpSlOrderForPosition({...})
await write.updateTpOrderForPosition({...})
await write.updateSlOrderForPosition({...})
await write.cancelTpSlOrderForPosition({...})
```

### ✅ REST API Endpoints (Read-Only)

**Base URL**: `https://api.netna.aptoslabs.com/decibel/api/v1`

**Confirmed Working**:
- `GET /active_twaps?user={address}` - Active TWAP orders
- `GET /positions?user={address}` - User positions
- `GET /trades?user={address}` - Trade history
- `GET /open_orders?user={address}` - Open orders
- `GET /markets` - All available markets
- `GET /market_prices` - All market prices
- `GET /orderbook?market={symbol}` - Order book depth
- `GET /candles?market={symbol}&interval={1m|5m|15m|1h|1d}` - Candlestick data

**Confirmed Limitation**: REST API is **READ-ONLY** - cannot place orders via REST!

### ✅ WebSocket API

**Base URL**: `wss://api.netna.aptoslabs.com/decibel/ws`

**Topics**:
- `account_overview`
- `user_positions`
- `user_open_orders`
- `order_update`
- `market_prices`
- `market_depth`
- `market_trades`
- `user_active_twaps`
- `notifications`

### ✅ Smart Contract Functions (On-Chain)

**Package**: `0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75`

**View Functions** (Read-Only):
```move
dex_accounts::primary_subaccount(owner: address) -> address
dex_accounts::is_delegated_trader(subaccount: address, trader: address) -> bool
accounts_collateral::available_order_margin(subaccount: address) -> u64
```

**Entry Functions** (Write, Require Signature):
```move
dex_accounts::delegate_trading_to_for_subaccount(subaccount, delegatee, expiration)
dex_accounts::revoke_trading_delegation_for_subaccount(subaccount, delegatee)
dex_accounts::place_twap_order_to_subaccount(subaccount, market, size, is_long, reduce_only, min_duration, max_duration, builder_address, max_builder_fee)
dex_accounts::place_market_order_to_subaccount(subaccount, market, size, is_long, reduce_only, builder_address, max_builder_fee)
dex_accounts::place_order_to_subaccount(subaccount, market, size, price, is_long, post_only, reduce_only, builder_address, max_builder_fee)
dex_accounts::cancel_order(order_id)
dex_accounts::cancel_twap_order(twap_id)
```

---

## ❓ What We DON'T KNOW

### 1. **Official SDK Availability Timeline**

**Question**: When will `@decibel/sdk` be publicly available on npm?

**Current Situation**:
- Docs say: `npm install @decibel/sdk`
- But package is NOT on npm public registry yet
- We get: `npm ERR! 404 Not Found - GET https://registry.npmjs.org/@decibel%2fsdk`

**Impact**:
- We had to build our own SDK by calling smart contracts directly
- We're reinventing the wheel
- Risk of bugs/incompatibilities with official SDK

**Workaround**: We built custom implementation using `@aptos-labs/ts-sdk` directly

**Need to Ask Decibel Team**:
- Is SDK in private beta?
- When will it be public?
- Can we get early access?
- Is there a GitHub repo we can install from?

---

### 2. **SDK Implementation Details**

**Questions**:
- How does `DecibelWriteDex` internally call smart contracts?
- What's the exact transaction payload format?
- How do they handle gas estimation?
- What's the fee payer service architecture?

**Why It Matters**:
- We're building transactions manually
- Need to ensure our approach matches theirs
- Gas optimization techniques unknown
- Fee payer service endpoint unknown

**Current Approach**:
```typescript
// Our custom implementation
const transaction = await aptos.transaction.build.simple({
  sender: botAccount.accountAddress,
  data: {
    function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
    typeArguments: [],
    functionArguments: [subaccount, market, size, is_long, reduce_only, min, max, undefined, undefined],
  },
});
```

**vs. Official SDK** (we assume):
```typescript
// What it probably looks like
await write.placeTwapOrder({
  subaccount,
  market,
  size,
  isLong,
  reduceOnly,
  minDuration: min,
  maxDuration: max,
});
```

---

### 3. **Fee Payer Service**

**Questions**:
- What's the fee payer endpoint? (`gasStationUrl` mentioned in docs)
- How does authentication work?
- What are the rate limits?
- Is it free for testnet?

**Why It Matters**:
- We're paying gas from bot wallet directly
- Fee payer could save APT costs
- Need to understand if we should use it

**Current State**: We don't use fee payer, bot wallet pays all gas

---

### 4. **GasPriceManager Implementation**

**Questions**:
- How does `GasPriceManager` fetch gas prices?
- What API endpoint does it use?
- What's the refresh interval strategy?
- How does the multiplier work?

**Why It Matters**:
- Gas estimation affects transaction success rate
- Need to optimize for speed vs cost
- Unknown how to cache gas prices properly

**Current Approach**: We rely on default Aptos SDK gas estimation

---

### 5. **Type Definitions & Schemas**

**Questions**:
- What are the exact TypeScript types for order parameters?
- What's the schema for TWAP order configuration?
- How are prices/sizes formatted (decimals, units)?

**Why It Matters**:
- We're guessing at parameter formats
- Risk of precision errors
- Type safety would catch bugs early

**Current Situation**:
- Using `number` types everywhere
- Manual conversion: `notional / price * 10^decimals`
- No validation of parameter ranges

**Example Unknown**:
```typescript
// What are the EXACT types?
type TwapOrderParams = {
  subaccount: string
  market: string
  size: ??? // u64? number? bigint? What decimals?
  isLong: boolean
  reduceOnly: boolean
  minDuration: number // seconds? milliseconds?
  maxDuration: number
  builderAddress?: string
  maxBuilderFee?: ??? // u64? number? What format?
}
```

---

### 6. **WebSocket Subscription Management**

**Questions**:
- How does SDK handle WebSocket reconnection?
- What's the subscription/unsubscription flow?
- How are errors handled?
- What's the message format exactly?

**Why It Matters**:
- We want real-time order fills
- Need reliable connection handling
- Error recovery strategy unknown

**From Docs**:
```typescript
const unsubscribe = read.marketPrices.subscribeByName("BTC-USD", (msg) => {
  console.log("Price update", msg);
});
```

**But we don't know**:
- Exact message format in `msg`
- How often updates come
- How to handle connection drops
- Rate limits on subscriptions

---

### 7. **Builder Fees & MEV**

**Questions**:
- What are "builder fees"?
- How does `builder_address` and `max_builder_fee` work?
- Is this an MEV capture mechanism?
- What happens if we pass `undefined`?

**Why It Matters**:
- We're passing `undefined` for builder params
- Might be missing optimization opportunities
- Could be affecting order execution

**Current Code**:
```typescript
functionArguments: [
  subaccountAddr,
  marketConfig.address,
  size,
  is_long,
  reduce_only,
  min,
  max,
  undefined, // builder_address - what is this?
  undefined, // max_builder_fee - should we set this?
]
```

---

### 8. **Session Keys & Account Override**

**Questions**:
- How do "session keys" work?
- What's the `accountOverride` parameter?
- How to implement delegated signing safely?

**Why It Matters**:
- Mentioned in SDK docs as best practice
- Security improvement over exposing private keys
- Don't understand implementation

**From Docs**:
> "Prefer wallets/session keys and pass `accountOverride` for specific calls"

**We don't know**:
- How to create session keys
- How to use `accountOverride`
- Security model

---

### 9. **Time Synchronization**

**Questions**:
- Why is `timeDeltaMs` needed?
- How much clock skew is acceptable?
- What errors occur if time is wrong?

**From Docs**:
```typescript
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  timeDeltaMs: serverDeltaMs, // what is this for?
});
```

**We don't know**:
- How to calculate `serverDeltaMs`
- What problems it solves
- When to use it

---

### 10. **Market Address vs Symbol Mapping**

**Questions**:
- Do we always need to use market addresses (0x...)?
- Can SDK accept symbols ("BTC-USD")?
- How to dynamically get addresses?

**Why It Matters**:
- We hardcode market addresses in `lib/decibel-client.ts`
- If new markets launch, we need to update code
- SDK might have dynamic lookup

**Current Approach**:
```typescript
export const MARKETS = {
  'BTC/USD': {
    address: '0x6a39745aaa7af8258060566f6501d84581de815128694f8ee013cae28e3357e7',
    ...
  },
};
```

**Better Approach** (if SDK supports):
```typescript
await write.placeTwapOrder({
  market: "BTC-USD", // symbol instead of address?
  ...
});
```

---

### 11. **Error Handling & Retry Logic**

**Questions**:
- What errors can occur?
- How to handle transaction failures?
- Does SDK auto-retry?
- What's the error format?

**Why It Matters**:
- Our error handling is basic
- Don't know which errors are retriable
- SDK might have better error messages

**Current Situation**:
```typescript
try {
  await signAndSubmitTransaction({ data: payload })
} catch (error) {
  // We just log and show generic error
  console.error("Failed to delegate:", error)
}
```

---

### 12. **Simulation vs Direct Submit**

**Questions**:
- When should we skip simulation (`skipSimulate: true`)?
- What does simulation check?
- Performance impact?

**From Docs**:
```typescript
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  skipSimulate: false, // default: simulate to estimate gas
});
```

**We don't know**:
- Exact simulation behavior
- When it's safe to skip
- Gas estimation accuracy

---

### 13. **TWAP Order Execution Details**

**Questions**:
- How are TWAP orders split into slices?
- What's the actual execution algorithm?
- How is `frequency_s` calculated?
- Can we customize slice size?

**What We Know**:
- We pass `min_duration` and `max_duration`
- Decibel backend handles execution
- We can track via `/api/v1/active_twaps`

**What We Don't Know**:
- Slice calculation formula
- Order of execution (random? sequential?)
- Price improvement strategies
- How directional bias affects execution

**From API Response**:
```json
{
  "duration_s": 300,
  "frequency_s": 30,  // ← How is this calculated from min/max?
  "orig_size": 1000,
  "remaining_size": 600
}
```

---

### 14. **Configuration Presets**

**Questions**:
- What's the difference between `NETNA_CONFIG`, `LOCAL_CONFIG`, `DOCKER_CONFIG`?
- What parameters do they set?
- When to use each?

**From Docs**:
> "Configuration and network presets: NETNA_CONFIG, LOCAL_CONFIG, DOCKER_CONFIG, NAMED_CONFIGS"

**We Use**:
```typescript
import { NETNA_CONFIG } from "@decibel/sdk"
```

**But don't know**:
- What endpoints it sets
- Whether it's testnet or mainnet
- Full configuration object

---

## 🔧 Our Custom SDK Implementation

Since the official SDK isn't available, we built our own:

### What We Implemented

**File**: `lib/decibel-client.ts`
- Market addresses and configurations
- Fee structure constants
- Package address

**File**: `app/api/bot/start/route.ts`
- Direct smart contract calls using `@aptos-labs/ts-sdk`
- Manual transaction building
- Direct signing and submission

**File**: `hooks/use-delegation.ts`
- Delegation check via view function
- Delegation transaction building

**File**: `hooks/use-wallet-balance.ts`
- Balance fetching via view function
- Subaccount detection

### What's Missing vs Official SDK

| Feature | Our Implementation | Official SDK |
|---------|-------------------|--------------|
| **Type Safety** | Basic TypeScript | Full type definitions |
| **Error Handling** | Generic catch blocks | Specific error types |
| **Gas Optimization** | Default estimation | GasPriceManager |
| **Fee Payer** | Not implemented | Built-in support |
| **Retry Logic** | None | Likely has auto-retry |
| **WebSockets** | Not implemented | Full subscription API |
| **Market Lookup** | Hardcoded addresses | Dynamic by symbol |
| **Validation** | Manual checks | Schema validation (Zod) |
| **Session Keys** | Not supported | Built-in |

---

## 🎯 What We Should Ask Decibel Team

### High Priority

1. **When will `@decibel/sdk` be public on npm?**
   - Is there a beta we can access?
   - GitHub repo we can install from?

2. **What's the fee payer service endpoint?**
   - Should we use it on testnet?
   - Rate limits?

3. **What's the exact format for builder fees?**
   - When should we use them?
   - MEV implications?

### Medium Priority

4. **How should we handle TWAP execution parameters?**
   - What's the relationship between duration and frequency?
   - Can we customize slice size?

5. **What's the recommended gas estimation strategy?**
   - Use GasPriceManager?
   - What multiplier to use?

6. **How to properly handle errors?**
   - Which errors are retriable?
   - Error codes/types?

### Low Priority

7. **Session keys implementation guide**
8. **Time synchronization best practices**
9. **WebSocket reconnection strategy**
10. **Market address dynamic lookup**

---

## 💡 Recommendations

### Short Term (While SDK is Private)

1. **Continue using our custom implementation**
   - It works and is based on smart contract ABIs
   - Low risk since we're calling contracts directly

2. **Document our approach thoroughly**
   - Make it easy to migrate to official SDK later
   - Keep SDK abstraction in one place

3. **Use REST API for read operations**
   - Already working well
   - Less risk than smart contract calls

4. **Monitor for SDK release**
   - Check npm registry periodically
   - Follow Decibel's Discord/Twitter

### Long Term (When SDK is Available)

1. **Migrate to official SDK**
   - Better type safety
   - Gas optimization
   - Fee payer support

2. **Add WebSocket support**
   - Real-time order fills
   - Price updates

3. **Implement GasPriceManager**
   - Better gas estimation
   - Cost optimization

4. **Use session keys**
   - Better security model
   - Delegated signing

---

## 📊 Comparison Matrix

| Aspect | Official SDK (Docs) | Our Custom SDK | REST API | Smart Contracts |
|--------|---------------------|----------------|----------|-----------------|
| **Availability** | ❌ Not on npm yet | ✅ Working | ✅ Public | ✅ On-chain |
| **Type Safety** | ✅ Full types | ⚠️ Basic | ❌ JSON | ❌ Raw bytes |
| **Error Handling** | ✅ Rich errors | ⚠️ Generic | ⚠️ HTTP codes | ❌ VM errors |
| **Gas Optimization** | ✅ GasPriceManager | ❌ Default | N/A | ❌ Manual |
| **Write Operations** | ✅ Full API | ✅ TWAP only | ❌ Read-only | ✅ All functions |
| **Documentation** | ✅ Complete | ✅ Our docs | ✅ Swagger | ⚠️ ABI only |
| **Ease of Use** | ✅✅✅ High | ⚠️ Medium | ✅✅ High | ❌ Low |

---

## 🔍 Investigation TODOs

- [ ] Check Decibel Discord for SDK beta access
- [ ] Ask on Decibel Twitter when SDK will be public
- [ ] Look for @decibel/sdk GitHub repo
- [ ] Check if we can install from GitHub directly
- [ ] Contact Decibel team for early access
- [ ] Document exact smart contract ABI
- [ ] Test all transaction types we need
- [ ] Create migration plan for when SDK is available

---

**Summary**: The official Decibel SDK exists and is well-documented, but it's not publicly available on npm yet. We've built a working custom implementation using direct smart contract calls, which is sufficient for now but lacks some advanced features like gas optimization, fee payer support, and WebSocket subscriptions. Once the SDK is public, we should migrate to it for better type safety and features.
