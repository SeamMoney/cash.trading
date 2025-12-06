# Decibel API Feedback & Questions

**Project**: Decibrrr - Automated TWAP Volume Bot
**Volume Generated**: ~$10M on testnet
**Date**: December 5, 2025

---

## Questions We Need Answered

### 1. TWAP Slice Execution Algorithm

We place TWAP orders with `min_duration` and `max_duration`, but we don't understand how slices are calculated.

**Current observation from API response**:
```json
{
  "duration_s": 300,
  "frequency_s": 30,
  "orig_size": 1000,
  "remaining_size": 600
}
```

**Questions**:
- How is `frequency_s` derived from `min_duration`/`max_duration`?
- What determines slice size? Is it `orig_size / (duration / frequency)`?
- Can we control slice size or frequency directly?
- How does the algorithm handle partial fills on individual slices?

**Why this matters**: We're tracking volume by order submission, but Decibel counts each slice fill separately. Understanding the algorithm would help us predict expected fills.

---

### 2. Builder Fees

We pass `undefined` for `builder_address` and `max_builder_fee` in all our orders:

```typescript
// lib/bot-engine.ts:1251-1252
undefined, // builder_address
undefined, // max_builder_fee
```

**Questions**:
- What is the builder fee system?
- When should we use it vs leaving undefined?
- What are valid fee values (format, units, range)?
- Is there a benefit to setting a builder address (faster execution, MEV protection)?

---

### 3. Fee Payer Service

The SDK docs mention `gasStationUrl` and `noFeePayer` options:

```typescript
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  noFeePayer: false, // use Decibel's fee payer service
});
```

**Questions**:
- What is the fee payer endpoint URL?
- How do we authenticate?
- Is it available for testnet?
- What are rate limits?
- Should we be using this instead of paying gas from our bot wallet?

**Current situation**: Our bot wallet pays all gas directly. We've spent significant APT on gas.

---

### 4. Time-in-Force Values for Limit Orders

We use `place_order_to_subaccount` with `time_in_force: 0`:

```typescript
// lib/bot-engine.ts:834
0,  // time_in_force: we know 0=GTC, but what are other values?
```

**Questions**:
- What are all valid `time_in_force` enum values? (0=GTC, 1=?, 2=?, etc.)
- Is there an IOC (Immediate-Or-Cancel) option? What value?
- Is there FOK (Fill-Or-Kill)?

**Context**: We wanted to use IOC for fast fills but couldn't find the right value. We worked around it by using short-duration TWAP (60-120 seconds) instead.

---

### 5. Conditional Order Types

The `conditional_order` parameter is undocumented:

```typescript
// lib/bot-engine.ts:837
undefined, // conditional_order - what values are valid?
```

**Questions**:
- What are the valid `conditional_order` enum values?
- How do conditional orders interact with `trigger_price`?
- Can we use this for stop-limit orders programmatically?

---

### 6. Session Keys / Account Override

SDK docs mention:
> "Prefer wallets/session keys and pass `accountOverride` for specific calls"

**Questions**:
- How do session keys work in the Aptos/Decibel context?
- How do we create a session key?
- What's the `accountOverride` parameter format?
- What's the security model - what can session keys do vs full private key?

**Why this matters**: Currently our bot operator has a full private key in `.env`. Session keys could be more secure.

---

### 7. REST API Authentication

We found that some REST endpoints require authentication:

```typescript
// scripts/fetch-decibel-volume.ts - we had to use WebSocket instead
// GET /api/v1/account_overviews?volume_window=30d requires API key
```

**Questions**:
- How do we get an API key for REST endpoints?
- Is there a developer program or do we request directly?
- Which endpoints require auth vs which are public?

**Current workaround**: We use WebSocket for account data (which doesn't require auth but has limitations like volume field returning 0).

---

### 8. WebSocket Volume Field

When we subscribe to `account_overview:{address}` via WebSocket, the `volume` field is always 0:

```typescript
// lib/decibel-ws.ts - AccountOverview type
export interface AccountOverview {
  perp_equity_balance: number
  unrealized_pnl: number
  volume: number  // Always returns 0 via WebSocket
  // ...
}
```

**Questions**:
- Is this intentional? Should volume be populated via WebSocket?
- Is there a different topic for volume data?
- Or is volume only available via authenticated REST API?

---

### 9. Reduce-Only Behavior

We use `reduce_only: true` when closing positions:

```typescript
// lib/bot-engine.ts:1134
true,  // reduce_only: TRUE for closing positions
```

**Questions**:
- If `reduce_only` is true but order size exceeds position size, what happens?
  - Does it partially fill up to position size?
  - Does it reject entirely?
  - Does it flip the position?
- Can we place a reduce-only order when we have no position? (for stop-loss pre-placement)

---

## Features That Would Help Us

### 1. Market Config in API Response

Currently we hardcode market configuration discovered by inspecting on-chain resources:

```typescript
// lib/bot-engine.ts:169-175
const MARKET_CONFIG = {
  'BTC/USD': { tickerSize: 100000n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 8 },
  'APT/USD': { tickerSize: 10n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 4 },
  // ... manually discovered values
}
```

**Request**: Add to `/api/v1/markets` response:
```json
{
  "symbol": "BTC/USD",
  "address": "0xf50add10...",
  "ticker_size": 100000,
  "lot_size": 10,
  "min_size": 100000,
  "price_decimals": 6,
  "size_decimals": 8,
  "max_leverage": 40
}
```

---

### 2. TWAP Fill Correlation

When we submit a TWAP order, we get one transaction hash. But the order creates multiple `TradeEvent`s (slices).

**Current problem**: We can't easily correlate which `TradeEvent`s belong to which TWAP order.

**Request**: Either:
- Add `twap_order_id` field to `TradeEvent` events
- Or provide `/api/v1/twap_fills?order_id=X` endpoint
- Or include fill breakdown in `/api/v1/active_twaps` response

---

### 3. Position View Function

Currently we parse the `UserPositions` resource with nested `BPlusTreeMap`:

```typescript
// lib/bot-engine.ts:351-372 - 40+ lines of parsing
const data = positionsResource.data as {
  positions?: {
    root?: {
      children?: {
        entries?: Array<{
          key: { inner: string }
          value: { value: { size, is_long, avg_acquire_entry_px, ... } }
        }>
      }
    }
  }
}
```

**Request**: View function that returns clean position data:
```move
public fun get_position(subaccount: address, market: Object<PerpMarket>): (u64, bool, u64, u64)
// Returns: (size, is_long, entry_price, unrealized_pnl)
```

---

### 4. Error Code Documentation

Errors we encountered and had to figure out through trial and error:

| Error | What it means | How we discovered |
|-------|---------------|-------------------|
| `EINVALID_TWAP_DURATION(0x11)` | Duration must be in seconds, not milliseconds | Trial and error |
| `EPRICE_NOT_RESPECTING_TICKER_SIZE` | Price not rounded to ticker_size | Inspected on-chain PerpMarketConfig |
| `0x6507` | User has no subaccount (never used Decibel) | Tested with fresh wallet |

**Request**: Error code reference table in docs.

---

### 5. WebSocket Trade History Pagination

Currently `user_trade_history:{address}` returns only ~50 most recent trades with no pagination:

```typescript
// lib/decibel-ws.ts:122-127
// Returns last ~50 trades, no pagination available via WebSocket
```

**Request**: Either:
- Add pagination params to WebSocket subscription
- Or provide cursor-based pagination in initial response
- Or document that full history requires REST API with auth

---

## What's Working Well

For context, these things work great:

1. **TWAP order execution** - Reliable fills once we learned the units
2. **Delegation system** - Secure, works as documented
3. **On-chain price oracle** - `price_management::Price` resource is reliable
4. **WebSocket real-time prices** - `market_price:{symbol}` works well
5. **Transaction building** - Standard Aptos SDK patterns work

---

## Summary

**Need clarification on**:
1. TWAP slice algorithm (frequency calculation, partial fills)
2. Builder fee system (when to use, valid values)
3. Fee payer service (endpoint, auth, availability)
4. Time-in-force enum values (especially IOC)
5. Conditional order types
6. Session keys implementation
7. REST API authentication process
8. WebSocket volume field behavior
9. Reduce-only edge cases

**Would help us build better**:
1. Market config in API (ticker_size, decimals, etc.)
2. TWAP fill correlation (link TradeEvents to orders)
3. Position view function (avoid BPlusTreeMap parsing)
4. Error code documentation
5. WebSocket pagination for trade history
