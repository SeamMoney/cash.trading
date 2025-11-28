# Decibel API Documentation - Summary

**Scraped**: November 27, 2025
**Total Pages**: 51 pages
**Location**: `/docs/decibel-complete/`

---

## 📚 What We Scraped

### ✅ Quick Start Guides (3 files)
- `quickstart_overview.md` - Getting started with Decibel
- `quickstart_api-reference.md` - API quick reference
- `quickstart_market-data.md` - Market data basics

### ✅ Architecture (1 file)
- `architecture_perps_perps-contract-overview.md` - Perpetuals contract structure

### ✅ TypeScript SDK (3 files)
- `typescript-sdk_overview.md` - SDK overview
- `typescript-sdk_read-sdk.md` - Read-only functions (4.3KB)
- `typescript-sdk_write-sdk.md` - Write functions (19KB) ⭐ **MOST IMPORTANT**

### ✅ Transactions (1 file)
- `transactions_overview.md` - Transaction formatting and signing

### ✅ REST API Endpoints (19 files)

#### User Endpoints (11)
- `get-account-overview.md` - User account details
- `get-active-twap-orders.md` ⭐ **KEY for bot monitoring**
- `get-delegations.md` - Check delegation status
- `get-user-funding-rate-history.md`
- `get-users-open-orders.md` ⭐ **KEY for order tracking**
- `get-user-order-history.md` ⭐ **KEY for history**
- `get-single-order-details.md`
- `get-subaccounts.md`
- `get-user-trade-history.md` ⭐ **KEY for history**
- `get-twap-order-history.md` ⭐ **KEY for bot**
- `get-user-positions.md` ⭐ **KEY for portfolio**

#### Market Data Endpoints (6)
- `get-asset-contexts.md`
- `get-candlestick-ohlc-data.md`
- `get-order-book-depth.md`
- `get-all-available-markets.md` ⭐ **KEY for market selector**
- `get-market-prices.md` ⭐ **KEY for real-time prices**
- `get-trades.md`

#### Other REST APIs
- Bulk Orders (3 files)
- Analytics (2 files) - Leaderboard, portfolio charts
- Vaults (3 files)

### ✅ WebSocket APIs (17 files)
Real-time streaming data:
- `accountoverview.md`
- `userswithpositions.md`
- `bulkorderfills.md`
- `bulkorders.md`
- `markettrades.md`
- `userpositions.md` ⭐ **KEY for real-time positions**
- `orderupdate.md` ⭐ **KEY for order fills**
- `userorderhistory.md`
- `usertrades.md`
- `useropenorders.md`
- `allmarketprices.md` ⭐ **KEY for price feeds**
- `notifications.md`
- `marketdepth.md`
- `marketprice.md`
- `userfundingratehistory.md`
- `usertradehistory.md`
- `useractivetwaps.md` ⭐ **KEY for bot status**
- `marketcandlestick.md`

---

## 🔑 KEY FINDINGS FOR OUR BOT

### 1. **REST API Base URL**
```
https://api.netna.aptoslabs.com/decibel/api/v1
```

### 2. **WebSocket URL**
```
wss://api.netna.aptoslabs.com/decibel/ws
```

### 3. **Active TWAP Orders Endpoint** ⭐ CRITICAL
```bash
GET /api/v1/active_twaps?user={address}&limit=10
```

Response:
```json
[
  {
    "duration_s": 300,
    "frequency_s": 30,
    "is_buy": true,
    "is_reduce_only": false,
    "market": "0xmarket123...",
    "order_id": "<string>",
    "orig_size": 123,
    "remaining_size": 123,
    "start_unix_ms": 1730841600000,
    "status": "<string>",
    "transaction_unix_ms": 123,
    "transaction_version": 1
  }
]
```

**This is EXACTLY what we need for bot status tracking!**

### 4. **Market Prices Endpoint** ⭐ CRITICAL
```bash
GET /api/v1/market_prices
```

Response includes `mark_price` for each market - we can use this instead of hardcoded $100k BTC price!

### 5. **User Positions Endpoint** ⭐ CRITICAL
```bash
GET /api/v1/positions?user={address}
```

Response:
```json
[
  {
    "market": "0x...",
    "position_size": 100000,
    "entry_price": "100000.00",
    "unrealized_pnl": "123.45",
    "liquidation_price": "95000.00",
    ...
  }
]
```

Perfect for portfolio view!

### 6. **User Open Orders** ⭐ CRITICAL
```bash
GET /api/v1/open_orders?user={address}
```

### 7. **User Trade History** ⭐ CRITICAL
```bash
GET /api/v1/trades?user={address}&limit=100
```

Response:
```json
[
  {
    "market": "BTC/USD",
    "side": "buy",
    "size": 0.001,
    "price": "100000.00",
    "fee": "0.045",
    "timestamp": 1730841600000,
    ...
  }
]
```

Perfect for history table!

### 8. **All Available Markets** ⭐ CRITICAL
```bash
GET /api/v1/markets
```

Returns all market configs - we can dynamically build the market selector!

---

## 🚀 IMMEDIATE ACTION ITEMS

Now that we have the docs, we can implement:

### **Phase 1: Fix Price Fetching** (15 min)
Replace hardcoded BTC price with real-time data:

```typescript
// In app/api/bot/start/route.ts
// Instead of:
const BTC_PRICE = 100000

// Do:
const marketsResp = await fetch('https://api.netna.aptoslabs.com/decibel/api/v1/market_prices')
const markets = await marketsResp.json()
const btcMarket = markets.find(m => m.symbol === 'BTC/USD')
const BTC_PRICE = parseFloat(btcMarket.mark_price)
```

### **Phase 2: Build Bot Status Endpoint** (30 min)
```typescript
// app/api/bot/status/[id]/route.ts
export async function GET(req, { params }) {
  const { id } = params
  // Extract user address from botId
  const userAddress = id.split('_')[2] // bot_timestamp_address

  // Fetch active TWAPs
  const resp = await fetch(
    `https://api.netna.aptoslabs.com/decibel/api/v1/active_twaps?user=${userAddress}`
  )
  const activeTwaps = await resp.json()

  // Calculate progress
  const progress = activeTwaps.map(twap => ({
    orderId: twap.order_id,
    market: twap.market,
    progress: ((twap.orig_size - twap.remaining_size) / twap.orig_size) * 100,
    status: twap.status,
    isBuy: twap.is_buy,
  }))

  return NextResponse.json({ progress, activeTwaps })
}
```

### **Phase 3: Build Portfolio View** (1 hour)
Fetch positions from `/api/v1/positions?user={address}`
Display:
- Current positions
- Unrealized PnL
- Liquidation prices
- Position sizes

### **Phase 4: Build History Table** (1 hour)
Fetch trades from `/api/v1/trades?user={address}&limit=100`
Display in table with:
- Time
- Market
- Side
- Size
- Price
- Fee
- PnL

### **Phase 5: Add Market Selector** (30 min)
Fetch from `/api/v1/markets`
Build dropdown with all available markets

---

## 📖 Documentation Structure

```
docs/decibel-complete/
├── 00_INDEX.md                                    # Master index
├── quickstart_*.md                                # Getting started
├── architecture_*.md                              # Contract architecture
├── typescript-sdk_*.md                            # SDK docs
├── transactions_*.md                              # Transaction formatting
├── api-reference_user_*.md                        # User API endpoints
├── api-reference_market-data_*.md                 # Market data endpoints
├── api-reference_bulk-orders_*.md                 # Bulk orders
├── api-reference_analytics_*.md                   # Analytics
├── api-reference_vaults_*.md                      # Vaults
└── api-reference_websockets_*.md                  # WebSocket topics
```

---

## 🎯 KEY DOCUMENTATION FILES TO READ

For our bot, focus on these files:

1. **`typescript-sdk_write-sdk.md`** (19KB)
   - How to place orders
   - Delegation functions
   - TWAP order functions
   - All smart contract interactions

2. **`api-reference_user_get-active-twap-orders.md`**
   - Monitor bot execution status

3. **`api-reference_user_get-user-positions.md`**
   - Build portfolio view

4. **`api-reference_user_get-user-trade-history.md`**
   - Build history table

5. **`api-reference_market-data_get-market-prices.md`**
   - Real-time price feeds

6. **`api-reference_market-data_get-all-available-markets.md`**
   - Market selector data

7. **`api-reference_websockets_useractivetwaps.md`**
   - Real-time TWAP updates via WebSocket

---

## 💡 NEXT STEPS

1. ✅ **Read the key files** (you are here)
2. ⏭️ **Implement bot status API** using `/api/v1/active_twaps`
3. ⏭️ **Fix price fetching** using `/api/v1/market_prices`
4. ⏭️ **Build portfolio view** using `/api/v1/positions`
5. ⏭️ **Build history table** using `/api/v1/trades`
6. ⏭️ **Add market selector** using `/api/v1/markets`

---

## 🔗 Quick Links

**Live API**:
- REST: https://api.netna.aptoslabs.com/decibel/api/v1
- WebSocket: wss://api.netna.aptoslabs.com/decibel/ws

**Official Docs**:
- https://docs.decibel.trade

**Our Scraped Docs**:
- `docs/decibel-complete/00_INDEX.md`

---

**Summary**: We now have complete API documentation. We can build bot monitoring, portfolio tracking, and order history using the REST endpoints. All the data we need is available!
