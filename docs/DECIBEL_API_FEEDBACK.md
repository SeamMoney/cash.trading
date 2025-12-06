# Decibel API & SDK Technical Feedback

**Date**: December 5, 2025
**Project**: Decibrrr - Automated TWAP Volume Bot
**Strategies Implemented**: Delta Neutral, High-Risk HFT Scalping, Market Maker, TWAP

---

## What We Built

A comprehensive trading bot system that:
- Places TWAP orders via delegation (bot operator executes on behalf of user)
- Implements multiple strategies with different risk/volume profiles
- Tracks volume, PnL, and positions across sessions
- Recovers from database failures via on-chain backfill scripts
- Built WebSocket client for real-time data when REST API requires auth

**Total volume generated**: ~$10M on testnet

---

## 1. Volume Tracking Discrepancy - Root Cause Analysis

**The Problem**: Our database showed ~$5.35M volume, but Decibel portfolio showed ~$10.04M.

**Investigation Process**:

We built `scripts/reconcile-volume.ts` to compare on-chain `TradeEvent`s against our database:

```typescript
// scripts/reconcile-volume.ts - extracting trades from on-chain
for (const event of tx.events || []) {
  if (event.type?.includes('TradeEvent')) {
    const data = event.data || {}
    if (data.account?.toLowerCase() === SUBACCOUNT.toLowerCase()) {
      const sizeRaw = BigInt(data.size || '0')
      const sizeBTC = Number(sizeRaw) / 1e8
      const price = parseInt(data.price || '0') / 1e6
      const volumeUSD = sizeBTC * price
      // Each TradeEvent is ONE fill, not one order
    }
  }
}
```

**Root Cause Found**: TWAP orders create multiple `TradeEvent`s (one per slice fill), but we were only recording one database entry per order submission.

Example flow:
```
Bot places 1 TWAP order → Creates 1 OrderHistory record ($8.70 volume)
                        ↓
TWAP executes 3 slices  → Creates 3 TradeEvents on-chain ($8.70 × 3 ≈ $26 volume counted by Decibel)
```

**What We Built to Fix It**:

1. `lib/decibel-ws.ts` - WebSocket client to fetch real-time trade data:
```typescript
// Subscribe to trade history via WebSocket (REST requires auth)
ws.send(JSON.stringify({
  Subscribe: { topic: `user_trade_history:${userAddr}` }
}))

// Returns individual fills, not order submissions
// But limited to ~50 most recent trades, no pagination
```

2. `scripts/restore-trades-from-chain.ts` - Rebuilds database from `TradeEvent`s:
```typescript
// Parse TradeEvents which represent actual fills
function extractTradesFromTx(tx: any): Trade[] {
  for (const event of tx.events || []) {
    if (event.type?.includes('TradeEvent')) {
      if (data.account === SUBACCOUNT) {
        // This is ONE fill of potentially many from a TWAP order
        const volume = (Number(size) / 1e8) * price
      }
    }
  }
}
```

**What Would Help**:
- Document that TWAP orders generate multiple `TradeEvent`s (typically 2-5 per order)
- Provide `/api/v1/twap_fills?order_id=X` to get all fills for a specific TWAP order
- Or include `twap_order_id` field in `TradeEvent` to correlate fills to orders

---

## 2. TWAP Duration Units

**Error**: `EINVALID_TWAP_DURATION(0x11)`

**Discovery Process**: Initial attempt used milliseconds (standard JS convention):

```typescript
// lib/bot-engine.ts - WRONG (first attempt)
functionArguments: [
  this.config.userSubaccount,
  this.config.market,
  contractSize,
  isLong,
  false,     // reduce_only
  300000,    // 5 minutes - WRONG! This is milliseconds
  600000,    // 10 minutes
]
```

**Working Code** (`lib/bot-engine.ts:599`):
```typescript
// CORRECT - seconds
functionArguments: [
  this.config.userSubaccount,
  this.config.market,
  contractSize,
  isLong,
  false,     // reduce_only
  300,       // min duration: 5 minutes in SECONDS
  600,       // max duration: 10 minutes in SECONDS
  undefined, // builder_address
  undefined, // max_builder_fee
]
```

**For HFT/fast fills** (`lib/bot-engine.ts:1130-1136`):
```typescript
// Short TWAP for "fast" fills (IOC doesn't work on testnet)
60,   // min duration: 1 minute
120,  // max duration: 2 minutes
```

**What Would Help**: Better error message: "duration must be between 60 and 86400 seconds (got 300000)"

---

## 3. Market Configuration Discovery

**Problem**: Each market has different `ticker_size`, `lot_size`, `min_size`, and decimal precision. None of this is in the API response.

**Error Without Proper Rounding**: `EPRICE_NOT_RESPECTING_TICKER_SIZE`

**What We Had to Build** (`lib/bot-engine.ts:169-175`):
```typescript
// Manually discovered by querying on-chain PerpMarketConfig resources
const MARKET_CONFIG: Record<string, {
  tickerSize: bigint; lotSize: bigint; minSize: bigint;
  pxDecimals: number; szDecimals: number
}> = {
  'BTC/USD': { tickerSize: 100000n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 8 },
  'APT/USD': { tickerSize: 10n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 4 },
  'WLFI/USD': { tickerSize: 1n, lotSize: 10n, minSize: 100000n, pxDecimals: 6, szDecimals: 3 },
  'SOL/USD': { tickerSize: 10000n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 6 },
  'ETH/USD': { tickerSize: 10000n, lotSize: 10n, minSize: 10000n, pxDecimals: 6, szDecimals: 7 },
}
```

**Price Rounding Function** (`lib/bot-engine.ts:541-549`):
```typescript
private roundPriceToTickerSize(priceUSD: number): bigint {
  const config = this.getMarketConfig()
  const priceInChainUnits = BigInt(Math.floor(priceUSD * Math.pow(10, config.pxDecimals)))
  const rounded = (priceInChainUnits / config.tickerSize) * config.tickerSize
  return rounded
}
```

**What Would Help**: Include in `/api/v1/markets` response:
```json
{
  "symbol": "BTC/USD",
  "address": "0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e",
  "ticker_size": 100000,
  "lot_size": 10,
  "min_size": 100000,
  "price_decimals": 6,
  "size_decimals": 8
}
```

---

## 4. Position Parsing from On-Chain Resources

**Problem**: Getting current position requires parsing nested `BPlusTreeMap` structure.

**What We Built** (`lib/bot-engine.ts:330-394`):
```typescript
private async getCurrentPosition() {
  const resources = await this.aptos.getAccountResources({
    accountAddress: this.config.userSubaccount
  })

  const positionsResource = resources.find(r =>
    r.type.includes('perp_positions::UserPositions')
  )

  // Parse the BPlusTreeMap structure
  const data = positionsResource.data as {
    positions?: {
      root?: {
        children?: {
          entries?: Array<{
            key: { inner: string }  // market address
            value: {
              value: {
                size: string
                is_long: boolean
                avg_acquire_entry_px: string
                user_leverage: number
              }
            }
          }>
        }
      }
    }
  }

  const entries = data.positions?.root?.children?.entries || []
  const marketPosition = entries.find(e =>
    e.key.inner.toLowerCase() === this.config.market.toLowerCase()
  )
  // ... extract size, is_long, entry price
}
```

**What Would Help**: View function that returns clean position data:
```move
public fun get_position(subaccount: address, market: Object<PerpMarket>): (u64, bool, u64)
// Returns: (size, is_long, entry_price)
```

---

## 5. Event Schema Inconsistencies

**Problem**: Different events use different field names for the account identifier.

**What We Found** (`lib/bot-engine.ts:72-151`, `scripts/find-event-types.ts`):
```typescript
// BulkOrderFilledEvent uses 'user'
if (event.type?.includes('BulkOrderFilledEvent')) {
  if (data.user === subaccount) { ... }
}

// OrderEvent uses 'user'
if (event.type?.includes('OrderEvent')) {
  if (data.user === subaccount) { ... }
}

// TradeEvent uses 'account' (not 'user')
if (event.type?.includes('TradeEvent')) {
  if (data.account === subaccount) { ... }
}
```

**What Would Help**: Standardize on one field name across all events.

---

## 6. IOC Orders Don't Fill on Testnet

**Problem**: Immediate-Or-Cancel limit orders never fill due to thin liquidity.

**Our Workaround**: Use short-duration TWAP instead of IOC for "fast" fills.

```typescript
// lib/bot-engine.ts - HFT strategy close position
// We wanted IOC but it doesn't work, so we use short TWAP
const closeTransaction = await this.aptos.transaction.build.simple({
  data: {
    function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
    functionArguments: [
      this.config.userSubaccount,
      this.config.market,
      positionSize.toString(),
      closeDirection,
      true,   // reduce_only
      60,     // 1 minute min (shortest that reliably fills)
      120,    // 2 minutes max
    ],
  },
})
```

Comment in our code (`lib/bot-engine.ts:1115-1116`):
```typescript
// Close with TWAP - IOC has NO LIQUIDITY on testnet!
// TWAP will fill over 1-2 minutes, which is much better than IOC that doesn't fill at all
```

---

## 7. Market Address Discovery

**Problem**: `/api/v1/markets` doesn't return full Object addresses, only symbols.

**What We Had to Do** (`lib/bot-engine.ts:154-159`):
```typescript
// Hardcoded after finding on-chain via explorer
const MARKETS = {
  'BTC/USD': '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
  'APT/USD': '0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2',
  'WLFI/USD': '0x25d0f38fb7a4210def4e62d41aa8e616172ea37692605961df63a1c773661c2',
}
```

Also in backfill script (`scripts/backfill-trades.ts:25-31`):
```typescript
const MARKETS: Record<string, { name: string; pxDecimals: number; szDecimals: number }> = {
  '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e': { name: 'BTC/USD', pxDecimals: 6, szDecimals: 8, maxLeverage: 40 },
  '0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d': { name: 'ETH/USD', pxDecimals: 6, szDecimals: 7, maxLeverage: 20 },
  // ...
}
```

---

## 8. REST API Authentication

**Problem**: Useful endpoints like `/api/v1/account_overviews?volume_window=30d` require API key.

**What We Built Instead** (`lib/decibel-ws.ts`):
```typescript
// WebSocket doesn't require auth, but has limitations
export async function getAccountOverview(userAddr: string): Promise<AccountOverview | null> {
  const ws = new WebSocket('wss://api.testnet.aptoslabs.com/decibel/ws')

  ws.on('open', () => {
    ws.send(JSON.stringify({
      Subscribe: { topic: `account_overview:${userAddr}` }
    }))
  })

  // Returns equity, margin, PnL... but volume field is always 0
}
```

**Limitation Discovered** (`scripts/fetch-decibel-volume.ts:69-87`):
```
The Decibel WebSocket API provides:
- Account overview (equity, margin, PnL) - but volume field returns 0
- Last ~50 trades with full details (no pagination)

The REST API (which has volume data) requires authentication.
```

---

## 9. Error Codes Without Documentation

**Errors we encountered and had to figure out**:

| Error Code | Actual Meaning | How We Discovered |
|------------|----------------|-------------------|
| `EINVALID_TWAP_DURATION(0x11)` | Duration in wrong units | Trial and error - seconds not ms |
| `EPRICE_NOT_RESPECTING_TICKER_SIZE` | Price not rounded | On-chain PerpMarketConfig inspection |
| `0x6507` | No subaccount exists | User never used Decibel UI |
| `INSUFFICIENT_MARGIN(0x0a)` | Not enough collateral | Self-explanatory but undocumented |

---

## 10. What Worked Well

**Successfully Implemented**:

1. **Delegation System** - Bot operator executes on behalf of users securely
2. **TWAP Orders** - Reliable fills, just needed to learn the units
3. **On-Chain Price Fetching** (`lib/bot-engine.ts:285-325`):
```typescript
// This works great - price from oracle
const priceResource = resources.find(r => r.type.includes('price_management::Price'))
const priceRaw = data.oracle_px || data.mark_px
return parseInt(priceRaw) / Math.pow(10, pxDecimals)
```

4. **Trade Recovery Scripts** - Can rebuild entire database from on-chain events
5. **WebSocket Real-Time Data** - Works without auth for prices and trades

---

## Summary of Suggestions

| Issue | Impact | Suggested Fix |
|-------|--------|---------------|
| TWAP creates multiple TradeEvents | Volume tracking confusion | Document behavior, add correlation ID |
| Duration units undocumented | Wasted debugging time | Better error messages with expected range |
| Market config not in API | Manual on-chain inspection needed | Add to /api/v1/markets response |
| Position parsing complex | 50+ lines of parsing code | Add view function |
| Event field names inconsistent | Different parsing per event type | Standardize on one field name |
| Market addresses not in API | Hardcoding required | Include in /api/v1/markets |
| Error codes cryptic | Trial and error debugging | Error code reference table |
