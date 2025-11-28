---
source: https://docs.decibel.trade/api-reference/market-data/get-order-book-depth
title: get order book depth
scraped: 2025-11-28T01:20:56.338Z
---

Get order book depth - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationMarket DataGet order book depth[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get order book depthcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/depth
```

200CopyAsk AI```
{
  "asks": [
    {
      "price": 123,
      "size": 123
    }
  ],
  "bids": [
    {
      "price": 123,
      "size": 123
    }
  ],
  "market": "0xmarket123..."
}
```

Market Data# Get order book depth

Copy pageRetrieve current order book with bids and asks for a specific market.

Copy pageGET/api/v1/depthTry itGet order book depthcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/depth
```

200CopyAsk AI```
{
  "asks": [
    {
      "price": 123,
      "size": 123
    }
  ],
  "bids": [
    {
      "price": 123,
      "size": 123
    }
  ],
  "market": "0xmarket123..."
}
```

#### Query Parameters

[​](#parameter-market)marketstringrequiredMarket address

[​](#parameter-limit)limitintegerdefault:100Maximum number of price levels to return per side

Required range: `x >= 0`#### Response

200 - application/jsonOrder book depth retrieved successfully

[​](#response-asks)asksobject[]requiredShow child attributes

[​](#response-bids)bidsobject[]requiredShow child attributes

[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[Get candlestick (OHLC) data](/api-reference/market-data/get-candlestick-ohlc-data)[Get all available markets](/api-reference/market-data/get-all-available-markets)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)