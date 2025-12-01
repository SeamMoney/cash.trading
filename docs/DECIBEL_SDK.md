# Custom Decibel SDK Documentation

This document describes the custom Decibel trading SDK we built for the volume bot. Since Decibel doesn't have an official public TypeScript SDK, we reverse-engineered the contract interface by analyzing on-chain data and successful transactions.

## Overview

The Decibel REST API is **read-only** - it's used for fetching market data, prices, positions, and order history. All trading operations (placing orders, canceling orders, etc.) must go through **on-chain transactions** to Decibel's Move smart contracts.

### API vs On-Chain

| Operation | Method | Description |
|-----------|--------|-------------|
| Get markets | REST API | Fetch market list, prices, configs |
| Get positions | REST API | View open positions |
| Get order history | REST API | View past trades |
| Place order | On-chain TX | Submit transaction to Aptos |
| Cancel order | On-chain TX | Submit transaction to Aptos |
| Delegate permissions | On-chain TX | Submit transaction to Aptos |

## SDK Components

### 1. `lib/decibel-client.ts` - Constants & Configuration

Contains all the static configuration for interacting with Decibel:

```typescript
// Package address (Decibel's deployed Move module)
export const DECIBEL_PACKAGE = '0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75';

// Bot operator address (receives delegated trading permissions)
export const BOT_OPERATOR = '0x501f5aab249607751b53dcb84ed68c95ede4990208bd861c3374a9b8ac1426da';

// Fee structure
export const MAKER_REBATE = 0.00015;  // -0.015%
export const TAKER_FEE = 0.00045;     // 0.045%
export const BUILDER_FEE = 0.0002;    // 0.02%

// Market addresses (TESTNET - updated Nov 2025)
export const MARKETS = {
  'BTC/USD': {
    address: '0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e',
    maxLeverage: 40,
    sizeDecimals: 8,
    priceDecimals: 6,
  },
  'ETH/USD': { ... },
  // ... other markets
};
```

### 2. `lib/bot-engine.ts` - Trading Engine

The core trading engine that builds and submits transactions:

#### Key Functions Called

```move
// Place a TWAP order (time-weighted average price)
dex_accounts::place_twap_order_to_subaccount(
    subaccount: address,
    market: address,
    size: u64,
    is_long: bool,
    reduce_only: bool,
    min_duration_secs: u64,
    max_duration_secs: u64,
    builder_address: Option<address>,
    max_builder_fee: Option<u64>
)

// Place a market order (immediate execution)
dex_accounts::place_market_order_to_subaccount(
    subaccount: address,
    market: address,
    size: u64,
    is_long: bool,
    reduce_only: bool,
    client_order_id: Option<String>,
    stop_price: Option<u64>,
    tp_trigger_price: Option<u64>,
    tp_limit_price: Option<u64>,
    sl_trigger_price: Option<u64>,
    sl_limit_price: Option<u64>,
    builder_address: Option<address>,
    max_builder_fee: Option<u64>
)

// Place a limit order
dex_accounts::place_order_to_subaccount(
    subaccount: address,
    market: address,
    size: u64,
    price: u64,
    is_long: bool,
    time_in_force: u8,
    post_only: bool,
    ...
)

// Delegate trading permissions to another address
dex_accounts::delegate_trading_to_for_subaccount(
    subaccount: address,
    delegate: address,
    expiration: u64  // 0 = unlimited
)
```

#### Transaction Building Example

```typescript
const transaction = await this.aptos.transaction.build.simple({
  sender: this.botAccount.accountAddress,
  data: {
    function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
    typeArguments: [],
    functionArguments: [
      this.config.userSubaccount,  // User's subaccount address
      this.config.market,          // Market address (e.g., BTC/USD)
      contractSize,                // Size in contract units
      isLong,                      // true = long, false = short
      false,                       // reduce_only
      300,                         // min duration: 5 minutes
      600,                         // max duration: 10 minutes
      undefined,                   // builder_address (optional)
      undefined,                   // max_builder_fee (optional)
    ],
  },
});

const committedTxn = await this.aptos.signAndSubmitTransaction({
  signer: this.botAccount,
  transaction,
});
```

### 3. `app/api/bot/delegate/route.ts` - Delegation System

Generates transaction payloads for users to delegate trading permissions:

```typescript
// Returns a transaction payload for the frontend to sign
{
  type: 'entry_function_payload',
  function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
  type_arguments: [],
  arguments: [
    userSubaccount,   // User's subaccount
    BOT_OPERATOR,     // Bot wallet that will trade on their behalf
    "0",              // Expiration (0 = unlimited)
  ],
}
```

## Market Addresses

Market addresses can change when Decibel redeploys their testnet contracts. To fetch current addresses, query the on-chain data:

```bash
# Query Decibel's perp_engine::Global resource
curl -s "https://api.testnet.aptoslabs.com/v1/accounts/0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75/resources" \
  | jq '.[] | select(.type | contains("perp_engine::Global")) | .data.market_refs'
```

Then for each market address, get the symbol:
```bash
curl -s "https://api.testnet.aptoslabs.com/v1/accounts/{MARKET_ADDRESS}/resources" \
  | jq '.[] | select(.type | contains("PerpMarketConfig")) | .data.name'
```

### Current Testnet Markets (Nov 2025)

| Market | Address | Max Leverage |
|--------|---------|--------------|
| BTC/USD | `0xf50add10e6982e3953d9d5bec945506c3ac049c79b375222131704d25251530e` | 40x |
| ETH/USD | `0x5d4a373896cc46ce5bd27f795587c1d682e7f57a3de6149d19cc3f3cb6c6800d` | 20x |
| SOL/USD | `0xef5eee5ae8ba5726efcd8af6ee89dffe2ca08d20631fff3bafe98d89137a58c4` | 20x |
| APT/USD | `0xfaade75b8302ef13835f40c66ee812c3c0c8218549c42c0aebe24d79c27498d2` | 10x |
| XRP/USD | `0x2b0858711c401b2ff1d22156241127c4500b9cc88aaab1e54aca88f29282a144` | 3x |
| LINK/USD | `0x7eda0461c46e464d7a155f77626be1d268b48f1c7b2e864c5dcf12aa5bf3159a` | 3x |
| AAVE/USD | `0x7c6d96f972a4986030ec3012217621f117f6be8a9380ffa29a7941cd62ccd34d` | 3x |
| ENA/USD | `0xbc6857d4255c58eb97643a6a3c9aed718322bf677b2556ce09097ab1bb3b47be` | 3x |
| HYPE/USD | `0x5f848e543d8a3021e74282fd258ab1919bcfd934d730368fb04398b64cbef9cf` | 3x |

## Subaccount Structure

Each user has a subaccount object on Decibel that holds:
- USDC balance
- Open positions
- Delegated permissions

To verify a subaccount exists and check its configuration:

```bash
curl -s "https://api.testnet.aptoslabs.com/v1/accounts/{SUBACCOUNT_ADDRESS}/resources" | jq '.[].type'
```

Expected resources:
- `0x1::object::ObjectCore`
- `0x1::object::Untransferable`
- `dex_accounts::Subaccount` - Contains delegation permissions
- `perp_positions::AccountInfo`
- `perp_positions::UserPositions`

## Delegation Permissions

The `Subaccount` resource contains a `delegated_permissions` map showing who can trade:

```json
{
  "delegated_permissions": {
    "entries": [
      {
        "key": "0x501f5aab...",  // Bot operator address
        "value": {
          "perms": {
            "entries": [
              { "key": "TradePerpsAllMarkets", "value": "Unlimited" },
              { "key": "TradeVaultTokens", "value": "Unlimited" }
            ]
          }
        }
      }
    ]
  }
}
```

## Trading Strategies

The bot engine supports multiple strategies:

### TWAP (Time-Weighted Average Price)
- Places orders that execute over 5-10 minutes
- Minimizes market impact
- Best for volume generation

### Market Maker
- Fast TWAP orders (same as TWAP currently)
- Planned: bid/ask spread management

### Delta Neutral
- Places paired long/short limit orders
- Attempts to hedge positions

### High Risk
- Uses larger position sizes (up to 10x multiplier)
- Maximum PNL volatility
- Best for aggressive volume generation

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `EOBJECT_DOES_NOT_EXIST` | Market or subaccount doesn't exist | Update market addresses or create subaccount |
| `Transaction already in mempool` | Duplicate transaction | Wait and retry |
| `Rate limited` | Too many requests | Implement backoff |

### Debugging

1. Check transaction on explorer: `https://explorer.aptoslabs.com/txn/{TX_HASH}?network=testnet`
2. Verify market exists: Query market address resources
3. Verify subaccount exists: Query subaccount address resources
4. Check delegation: Look at `delegated_permissions` in Subaccount resource

## API Keys

Decibel requires API keys for their REST API (read operations):
1. Create a key at https://geomi.dev/
2. Use `Authorization: Bearer {API_KEY}` header
3. API endpoint: `https://api.netna.aptoslabs.com/decibel/api/v1/...`

Note: API keys are for reading data only. Trading still requires on-chain transactions.

## Future Improvements

- [ ] Automatic market address refresh from on-chain
- [ ] Position management (close positions)
- [ ] Order cancellation
- [ ] Real-time price feeds via WebSocket
- [ ] PnL tracking and reporting
- [ ] Multi-market arbitrage strategies
