---
source: https://docs.decibel.trade/api-reference/user/get-user-order-history
title: get user order history
scraped: 2025-11-28T01:20:53.167Z
---

Get user order history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet user order history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get user order historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/order_history
```

200CopyAsk AI```
{
  "items": [
    {
      "client_order_id": "&#x3C;string>",
      "details": "&#x3C;string>",
      "is_buy": true,
      "is_reduce_only": true,
      "market": "&#x3C;string>",
      "order_direction": "&#x3C;string>",
      "order_id": "&#x3C;string>",
      "order_type": "&#x3C;string>",
      "orig_size": 123,
      "parent": "&#x3C;string>",
      "price": 123,
      "remaining_size": 123,
      "size_delta": 123,
      "sl_limit_price": 1,
      "sl_order_id": "&#x3C;string>",
      "sl_trigger_price": 1,
      "status": "&#x3C;string>",
      "tp_limit_price": 1,
      "tp_order_id": "&#x3C;string>",
      "tp_trigger_price": 1,
      "transaction_version": 1,
      "trigger_condition": "&#x3C;string>",
      "unix_ms": 1
    }
  ],
  "total_count": 1
}
```

User# Get user order history

Copy pageRetrieve paginated order history for a specific user.

Copy pageGET/api/v1/order_historyTry itGet user order historycURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/order_history
```

200CopyAsk AI```
{
  "items": [
    {
      "client_order_id": "&#x3C;string>",
      "details": "&#x3C;string>",
      "is_buy": true,
      "is_reduce_only": true,
      "market": "&#x3C;string>",
      "order_direction": "&#x3C;string>",
      "order_id": "&#x3C;string>",
      "order_type": "&#x3C;string>",
      "orig_size": 123,
      "parent": "&#x3C;string>",
      "price": 123,
      "remaining_size": 123,
      "size_delta": 123,
      "sl_limit_price": 1,
      "sl_order_id": "&#x3C;string>",
      "sl_trigger_price": 1,
      "status": "&#x3C;string>",
      "tp_limit_price": 1,
      "tp_order_id": "&#x3C;string>",
      "tp_trigger_price": 1,
      "transaction_version": 1,
      "trigger_condition": "&#x3C;string>",
      "unix_ms": 1
    }
  ],
  "total_count": 1
}
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

#### Response

200 - application/jsonOrder history retrieved successfully

[​](#response-items)itemsobject[]requiredThe items in the current page

Show child attributes

[​](#response-total-count)total_countintegerrequiredThe total number of items across all pages

Required range: `x >= 0`[Get user's open orders](/api-reference/user/get-users-open-orders)[Get single order details](/api-reference/user/get-single-order-details)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)