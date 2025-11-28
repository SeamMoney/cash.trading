---
source: https://docs.decibel.trade/api-reference/market-data/get-market-prices
title: get market prices
scraped: 2025-11-28T01:20:57.161Z
---

Get market prices - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationMarket DataGet market prices[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get market pricescURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/prices
```

200CopyAsk AI```
[
  {
    "funding_rate_bps": 1,
    "is_funding_positive": true,
    "mark_px": 123,
    "market": "0xmarket123...",
    "mid_px": 123,
    "open_interest": 123,
    "oracle_px": 123,
    "transaction_unix_ms": 123
  }
]
```

Market Data# Get market prices

Copy pageRetrieve current prices for one or all markets, including oracle price, mark price, funding rate, and open interest.

Copy pageGET/api/v1/pricesTry itGet market pricescURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/prices
```

200CopyAsk AI```
[
  {
    "funding_rate_bps": 1,
    "is_funding_positive": true,
    "mark_px": 123,
    "market": "0xmarket123...",
    "mid_px": 123,
    "open_interest": 123,
    "oracle_px": 123,
    "transaction_unix_ms": 123
  }
]
```

#### Query Parameters

[​](#parameter-market)marketstringMarket address filter (use "all" or omit for all markets)

#### Response

200 - application/jsonMarket prices retrieved successfully

[​](#response-funding-rate-bps)funding_rate_bpsintegerrequiredRequired range: `x >= 0`[​](#response-is-funding-positive)is_funding_positivebooleanrequired[​](#response-mark-px)mark_pxnumberrequired[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-mid-px)mid_pxnumberrequired[​](#response-open-interest)open_interestnumberrequired[​](#response-oracle-px)oracle_pxnumberrequired[​](#response-transaction-unix-ms)transaction_unix_msintegerrequired[Get all available markets](/api-reference/market-data/get-all-available-markets)[Get trades](/api-reference/market-data/get-trades)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)