---
source: https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-order-status
title: get bulk order status
scraped: 2025-11-28T01:20:58.403Z
---

Get bulk order status - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationBulk OrdersGet bulk order status[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get bulk order statuscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_order_status
```

200

NotFound

CopyAsk AI```
{  "status": "notFound",  "message": "Bulk order with sequence number {} not found"}
```

Bulk Orders# Get bulk order status

Copy pageRetrieve the status of a specific bulk order (placed or rejected).

Copy pageGET/api/v1/bulk_order_statusTry itGet bulk order statuscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_order_status
```

200

NotFound

CopyAsk AI```
{  "status": "notFound",  "message": "Bulk order with sequence number {} not found"}
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-market)marketstringrequiredMarket address

[​](#parameter-sequence-number)sequence_numberintegerrequiredSequence number of the bulk order

Required range: `x >= 0`#### Response

200 - application/jsonBulk order status retrieved successfully

[​](#response-bulk-order)bulk_orderobjectrequiredShow child attributes

[​](#response-details)detailsstringrequired[​](#response-status)statusstringrequired[Get bulk order fills](/api-reference/bulk-orders/get-bulk-order-fills)[Get bulk orders](/api-reference/bulk-orders/get-bulk-orders)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)