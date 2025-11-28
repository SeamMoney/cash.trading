---
source: https://docs.decibel.trade/api-reference/user/get-user-trade-history
title: get user trade history
scraped: 2025-11-28T01:20:54.366Z
---

Get user trade history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet user trade history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

- [GETGet account overview](/api-reference/user/get-account-overview)
- [GETGet active TWAP orders](/api-reference/user/get-active-twap-orders)
- [GETGet delegations](/api-reference/user/get-delegations)
- [GETGet user funding rate history](/api-reference/user/get-user-funding-rate-history)
- [GETGet user's open orders](/api-reference/user/get-users-open-orders)
- [GETGet user order history](/api-reference/user/get-user-order-history)
- [GETGet single order details](/api-reference/user/get-single-order-details)
- [GETGet subaccounts](/api-reference/user/get-subaccounts)
- [GETGet user trade history](/api-reference/user/get-user-trade-history)
- [GETGet TWAP order history](/api-reference/user/get-twap-order-history)
- [GETGet user positions](/api-reference/user/get-user-positions)

##### Market Data

- [GETGet asset contexts](/api-reference/market-data/get-asset-contexts)
- [GETGet candlestick (OHLC) data](/api-reference/market-data/get-candlestick-ohlc-data)
- [GETGet order book depth](/api-reference/market-data/get-order-book-depth)
- [GETGet all available markets](/api-reference/market-data/get-all-available-markets)
- [GETGet market prices](/api-reference/market-data/get-market-prices)
- [GETGet trades](/api-reference/market-data/get-trades)

##### Bulk Orders

- [GETGet bulk order fills](/api-reference/bulk-orders/get-bulk-order-fills)
- [GETGet bulk order status](/api-reference/bulk-orders/get-bulk-order-status)
- [GETGet bulk orders](/api-reference/bulk-orders/get-bulk-orders)

##### Analytics

- [GETGet leaderboard](/api-reference/analytics/get-leaderboard)
- [GETGet portfolio chart data](/api-reference/analytics/get-portfolio-chart-data)

##### Vaults

- [GETGet user-owned vaults](/api-reference/vaults/get-user-owned-vaults)
- [GETGet user vault performance for all vaults where user has deposits](/api-reference/vaults/get-user-vault-performance-for-all-vaults-where-user-has-deposits)
- [GETGet public vaults](/api-reference/vaults/get-public-vaults)

Get user trade historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/trade_history
```

200CopyAsk AI```
[
  {
    "account": "0x1234567890abcdef1234567890abcdef12345678",
    "action": "buy",
    "client_order_id": "client_order_abc",
    "fee_amount": 123,
    "is_funding_positive": true,
    "is_profit": true,
    "is_rebate": true,
    "market": "0xmarket123456789abcdef",
    "order_id": "12345",
    "price": 50000.25,
    "realized_funding_amount": 123,
    "realized_pnl_amount": 123,
    "size": 100.5,
    "trade_id": 3647276,
    "transaction_unix_ms": 1634567890000,
    "transaction_version": 3647276285
  }
]
```

User# Get user trade history

Copy pageRetrieve trade history for a specific user with optional filtering by market and order ID.

Copy pageGET/api/v1/trade_historyTry itGet user trade historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/trade_history
```

200CopyAsk AI```
[
  {
    "account": "0x1234567890abcdef1234567890abcdef12345678",
    "action": "buy",
    "client_order_id": "client_order_abc",
    "fee_amount": 123,
    "is_funding_positive": true,
    "is_profit": true,
    "is_rebate": true,
    "market": "0xmarket123456789abcdef",
    "order_id": "12345",
    "price": 50000.25,
    "realized_funding_amount": 123,
    "realized_pnl_amount": 123,
    "size": 100.5,
    "trade_id": 3647276,
    "transaction_unix_ms": 1634567890000,
    "transaction_version": 3647276285
  }
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-limit)limitintegerdefault:10Maximum number of trades to return

Required range: `x >= 0`[​](#parameter-order-id)order_idstringFilter by specific order ID

[​](#parameter-market)marketstringFilter by market address

#### Response

200 - application/jsonTrade history retrieved successfully

[​](#response-account)accountstringrequiredUser's account address

Example:`"0x1234567890abcdef1234567890abcdef12345678"`

[​](#response-action)actionstringrequiredTrade action type (e.g., "buy", "sell", "liquidation")

Example:`"buy"`

[​](#response-client-order-id)client_order_idstringrequiredClient-specified order ID

Example:`"client_order_abc"`

[​](#response-fee-amount)fee_amountnumberrequiredFee amount in raw units

[​](#response-is-funding-positive)is_funding_positivebooleanrequiredWhether funding was positive

[​](#response-is-profit)is_profitbooleanrequiredWhether trade was profitable

[​](#response-is-rebate)is_rebatebooleanrequiredWhether trade received rebate

[​](#response-market)marketstringrequiredMarket identifier address

Example:`"0xmarket123456789abcdef"`

[​](#response-order-id)order_idstringrequiredOrder ID associated with trade

Example:`"12345"`

[​](#response-price)pricenumberrequiredTrade price

Example:`50000.25`

[​](#response-realized-funding-amount)realized_funding_amountnumberrequiredRealized funding amount

[​](#response-realized-pnl-amount)realized_pnl_amountnumberrequiredRealized PnL amount

[​](#response-size)sizenumberrequiredTrade size

Example:`100.5`

[​](#response-trade-id)trade_idintegerrequiredTrade ID

Required range: `x >= 0`Example:`3647276`

[​](#response-transaction-unix-ms)transaction_unix_msintegerrequiredTransaction timestamp in milliseconds

Example:`1634567890000`

[​](#response-transaction-version)transaction_versionintegerrequiredTransaction version

Required range: `x >= 0`Example:`3647276285`

[Get subaccounts](/api-reference/user/get-subaccounts)[Get TWAP order history](/api-reference/user/get-twap-order-history)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)