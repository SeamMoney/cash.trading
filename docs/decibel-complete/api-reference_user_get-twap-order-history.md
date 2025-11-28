---
source: https://docs.decibel.trade/api-reference/user/get-twap-order-history
title: get twap order history
scraped: 2025-11-28T01:20:54.778Z
---

Get TWAP order history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet TWAP order history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get TWAP order historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/twap_history
```

200CopyAsk AI```
[
  {
    "duration_s": 300,
    "frequency_s": 30,
    "is_buy": true,
    "is_reduce_only": true,
    "market": "0xmarket123...",
    "order_id": "&#x3C;string>",
    "orig_size": 123,
    "remaining_size": 123,
    "start_unix_ms": 1730841600000,
    "status": "&#x3C;string>",
    "transaction_unix_ms": 123,
    "transaction_version": 1
  }
]
```

User# Get TWAP order history

Copy pageRetrieve TWAP order history for a specific user including completed and cancelled orders.

Copy pageGET/api/v1/twap_historyTry itGet TWAP order historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/twap_history
```

200CopyAsk AI```
[
  {
    "duration_s": 300,
    "frequency_s": 30,
    "is_buy": true,
    "is_reduce_only": true,
    "market": "0xmarket123...",
    "order_id": "&#x3C;string>",
    "orig_size": 123,
    "remaining_size": 123,
    "start_unix_ms": 1730841600000,
    "status": "&#x3C;string>",
    "transaction_unix_ms": 123,
    "transaction_version": 1
  }
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-limit)limitintegerdefault:10Maximum number of TWAP history entries to return

Required range: `x >= 0`#### Response

200 - application/jsonTWAP history retrieved successfully

[​](#response-durations)duration_sintegerrequiredRequired range: `x >= 0`Example:`300`

[​](#response-frequencys)frequency_sintegerrequiredRequired range: `x >= 0`Example:`30`

[​](#response-is-buy)is_buybooleanrequiredExample:`true`

[​](#response-is-reduce-only)is_reduce_onlybooleanrequired[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-order-id)order_idstringrequired[​](#response-orig-size)orig_sizenumberrequired[​](#response-remaining-size)remaining_sizenumberrequired[​](#response-start-unix-ms)start_unix_msintegerrequiredExample:`1730841600000`

[​](#response-status)statusstringrequired[​](#response-transaction-unix-ms)transaction_unix_msintegerrequired[​](#response-transaction-version)transaction_versionintegerrequiredRequired range: `x >= 0`[Get user trade history](/api-reference/user/get-user-trade-history)[Get user positions](/api-reference/user/get-user-positions)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)