---
source: https://docs.decibel.trade/api-reference/market-data/get-all-available-markets
title: get all available markets
scraped: 2025-11-28T01:20:56.752Z
---

Get all available markets - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationMarket DataGet all available markets[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get all available marketscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/markets
```

200CopyAsk AI```
[
  {
    "lot_size": 1,
    "market_addr": "&#x3C;string>",
    "market_name": "&#x3C;string>",
    "max_leverage": 1,
    "max_open_interest": 123,
    "min_size": 1,
    "px_decimals": 1,
    "sz_decimals": 1,
    "tick_size": 1
  }
]
```

Market Data# Get all available markets

Copy pageReturns a list of all trading markets with their configuration details including
leverage limits, tick sizes, and decimal precision.Copy pageGET/api/v1/marketsTry itGet all available marketscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/markets
```

200CopyAsk AI```
[
  {
    "lot_size": 1,
    "market_addr": "&#x3C;string>",
    "market_name": "&#x3C;string>",
    "max_leverage": 1,
    "max_open_interest": 123,
    "min_size": 1,
    "px_decimals": 1,
    "sz_decimals": 1,
    "tick_size": 1
  }
]
```

#### Response

200 - application/jsonList of available markets

[​](#response-lot-size)lot_sizeintegerrequiredRequired range: `x >= 0`[​](#response-market-addr)market_addrstringrequired[​](#response-market-name)market_namestringrequired[​](#response-max-leverage)max_leverageintegerrequiredRequired range: `x >= 0`[​](#response-max-open-interest)max_open_interestnumberrequired[​](#response-min-size)min_sizeintegerrequiredRequired range: `x >= 0`[​](#response-px-decimals)px_decimalsintegerrequiredRequired range: `x >= 0`[​](#response-sz-decimals)sz_decimalsintegerrequiredRequired range: `x >= 0`[​](#response-tick-size)tick_sizeintegerrequiredRequired range: `x >= 0`[Get order book depth](/api-reference/market-data/get-order-book-depth)[Get market prices](/api-reference/market-data/get-market-prices)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)