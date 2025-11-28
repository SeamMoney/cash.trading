---
source: https://docs.decibel.trade/api-reference/user/get-user-funding-rate-history
title: get user funding rate history
scraped: 2025-11-28T01:20:52.381Z
---

Get user funding rate history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet user funding rate history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get user funding rate historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/funding_rate_history
```

200CopyAsk AI```
[
  {
    "action": "Close Long",
    "fee_amount": 123,
    "is_funding_positive": true,
    "is_rebate": true,
    "market": "0xmarket123...",
    "realized_funding_amount": 123,
    "size": 1,
    "transaction_unix_ms": 1735758000000
  }
]
```

User# Get user funding rate history

Copy pageRetrieve funding rate payment history for a specific user.

Copy pageGET/api/v1/funding_rate_historyTry itGet user funding rate historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/funding_rate_history
```

200CopyAsk AI```
[
  {
    "action": "Close Long",
    "fee_amount": 123,
    "is_funding_positive": true,
    "is_rebate": true,
    "market": "0xmarket123...",
    "realized_funding_amount": 123,
    "size": 1,
    "transaction_unix_ms": 1735758000000
  }
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-limit)limitintegerdefault:10Maximum number of funding rate history entries to return

Required range: `x >= 0`#### Response

200 - application/jsonFunding rate history retrieved successfully

[​](#response-action)actionstringrequiredExample:`"Close Long"`

[​](#response-fee-amount)fee_amountnumberrequired[​](#response-is-funding-positive)is_funding_positivebooleanrequired[​](#response-is-rebate)is_rebatebooleanrequired[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-realized-funding-amount)realized_funding_amountnumberrequired[​](#response-size)sizenumberrequiredExample:`1`

[​](#response-transaction-unix-ms)transaction_unix_msintegerrequiredExample:`1735758000000`

[Get delegations](/api-reference/user/get-delegations)[Get user's open orders](/api-reference/user/get-users-open-orders)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)