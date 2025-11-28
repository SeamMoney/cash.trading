---
source: https://docs.decibel.trade/api-reference/market-data/get-asset-contexts
title: get asset contexts
scraped: 2025-11-28T01:20:55.558Z
---

Get asset contexts - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationMarket DataGet asset contexts[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get asset contextscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/asset_contexts
```

200CopyAsk AI```
[
  {
    "mark_price": 123,
    "market": "0xmarket123...",
    "mid_price": 123,
    "open_interest": 123,
    "oracle_price": 123,
    "previous_day_price": 123,
    "price_change_pct_24h": 123,
    "price_history": [
      123
    ],
    "volume_24h": 123
  }
]
```

Market Data# Get asset contexts

Copy pageRetrieve market contexts including prices, volumes, and historical data.

Copy pageGET/api/v1/asset_contextsTry itGet asset contextscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/asset_contexts
```

200CopyAsk AI```
[
  {
    "mark_price": 123,
    "market": "0xmarket123...",
    "mid_price": 123,
    "open_interest": 123,
    "oracle_price": 123,
    "previous_day_price": 123,
    "price_change_pct_24h": 123,
    "price_history": [
      123
    ],
    "volume_24h": 123
  }
]
```

#### Query Parameters

[​](#parameter-market)marketstringFilter by specific market address

#### Response

200 - application/jsonAsset context retrieved successfully

[​](#response-mark-price)mark_pricenumberrequired[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-mid-price)mid_pricenumberrequired[​](#response-open-interest)open_interestnumberrequired[​](#response-oracle-price)oracle_pricenumberrequired[​](#response-previous-day-price)previous_day_pricenumberrequired[​](#response-price-change-pct-24h)price_change_pct_24hnumberrequired[​](#response-price-history)price_historynumber[]required[​](#response-volume-24h)volume_24hnumberrequired[Get user positions](/api-reference/user/get-user-positions)[Get candlestick (OHLC) data](/api-reference/market-data/get-candlestick-ohlc-data)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)