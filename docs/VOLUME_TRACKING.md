# Volume Tracking Investigation

## Summary

This document details the investigation into the volume discrepancy between Decibel's reported volume and our database tracking.

## The Discrepancy

- **Decibel Portfolio**: ~$10.04M total volume
- **Our Database**: ~$5.35M total volume
- **Difference**: ~$4.7M (~47% under-reported)

## Root Cause

The discrepancy comes from how TWAP (Time-Weighted Average Price) orders work:

1. **What we track**: Order submissions (1 record per TWAP order)
2. **What Decibel tracks**: Individual fills (2-5 records per TWAP order)

When a TWAP order is submitted:
- It gets split into multiple slices over 1-2 minutes
- Each slice fills separately at potentially different prices
- Decibel counts each fill as volume
- We only count the original order submission

## API Access

### REST API (Requires Authentication)

The Decibel REST API requires an API key from Aptos Labs:

```bash
curl "https://api.testnet.aptoslabs.com/decibel/api/v1/account_overviews?user={ADDRESS}&volume_window=30d" \
  -H "Authorization: Bearer {API_KEY}"
```

Response includes:
- `volume`: Total trading volume for the specified window
- `perp_equity_balance`: Current equity
- `unrealized_pnl`: Unrealized profit/loss
- `realized_pnl`: Realized profit/loss

### WebSocket API (No Auth Required)

WebSocket endpoints work without authentication but have limitations:

**Account Overview**: `account_overview:{userAddr}`
- Returns equity, margin, PnL
- Volume field returns 0 (not populated via WebSocket)

**Trade History**: `user_trade_history:{userAddr}`
- Returns last ~50 trades
- No pagination available
- Includes: size, price, PnL, fees per trade

**Real-time Trades**: `user_trades:{userAddr}`
- Streams new trades as they occur
- Useful for real-time volume tracking going forward

## Solutions

### Option 1: Use REST API with Auth (Recommended)

Add the Decibel API call to our stats endpoint:

```typescript
const response = await fetch(
  `https://api.testnet.aptoslabs.com/decibel/api/v1/account_overviews?user=${userAddr}&volume_window=30d`,
  { headers: { 'Authorization': `Bearer ${process.env.APTOS_API_KEY}` } }
)
const data = await response.json()
// data.volume contains accurate total volume
```

### Option 2: Track Fills in Real-time

Subscribe to WebSocket `user_trades:{userAddr}` and record each fill:
- More complex implementation
- Requires persistent WebSocket connection
- Only tracks volume going forward

### Option 3: Apply Multiplier (Approximate)

Based on our data, database volume × ~1.9 ≈ Decibel volume

This is an approximation and will drift over time.

## Files Created

- `lib/decibel-ws.ts` - WebSocket client for Decibel API
- `scripts/fetch-decibel-volume.ts` - Script to fetch volume from Decibel
- `scripts/reconcile-volume.ts` - Compare on-chain vs database volume
- `scripts/find-event-types.ts` - Analyze on-chain event types

## Key Findings

1. **TWAP slices create ~2x volume** compared to order submissions
2. **WebSocket provides real-time data** but limited history
3. **REST API with auth** is the most reliable source for total volume
4. **On-chain events** don't directly show fills for our subaccount (they go to counterparties)

## Environment Variables Needed

```
APTOS_API_KEY=your-aptos-api-key
```

Get an API key from: https://developers.aptoslabs.com/
