---
source: https://docs.decibel.trade/api-reference/market-data/get-candlestick-ohlc-data
title: get candlestick ohlc data
scraped: 2025-11-28T01:20:55.957Z
---

Get candlestick (OHLC) data - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationMarket DataGet candlestick (OHLC) data[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get candlestick (OHLC) datacURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/candlesticks
```

200CopyAsk AI```
[
  {
    "T": 1761591599999,
    "c": 100,
    "h": 102,
    "i": "1h",
    "l": 98,
    "o": 100,
    "t": 1761588000000,
    "v": 1000
  }
]
```

Market Data# Get candlestick (OHLC) data

Copy pageRetrieve candlestick data for a specific market and time range with interpolation for missing intervals.

Copy pageGET/api/v1/candlesticksTry itGet candlestick (OHLC) datacURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/candlesticks
```

200CopyAsk AI```
[
  {
    "T": 1761591599999,
    "c": 100,
    "h": 102,
    "i": "1h",
    "l": 98,
    "o": 100,
    "t": 1761588000000,
    "v": 1000
  }
]
```

#### Query Parameters

[​](#parameter-market)marketstringrequiredMarket address

[​](#parameter-interval)intervalenum<string>requiredCandlestick interval (1m, 15m, 1h, 4h, 1d)

Available options: `1m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `1d`, `1w` [​](#parameter-start-time)startTimeintegerrequiredStart time in milliseconds

[​](#parameter-end-time)endTimeintegerrequiredEnd time in milliseconds

#### Response

200 - application/jsonCandlestick data retrieved successfully

[​](#responset)TintegerrequiredExample:`1761591599999`

[​](#response-c)cnumberrequiredExample:`100`

[​](#response-h)hnumberrequiredExample:`102`

[​](#response-i)istringrequiredExample:`"1h"`

[​](#response-l)lnumberrequiredExample:`98`

[​](#response-o)onumberrequiredExample:`100`

[​](#responset)tintegerrequiredExample:`1761588000000`

[​](#response-v)vnumberrequiredExample:`1000`

[Get asset contexts](/api-reference/market-data/get-asset-contexts)[Get order book depth](/api-reference/market-data/get-order-book-depth)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)