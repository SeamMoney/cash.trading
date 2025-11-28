---
source: https://docs.decibel.trade/api-reference/user/get-users-open-orders
title: get users open orders
scraped: 2025-11-28T01:20:52.788Z
---

Get user's open orders - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet user's open orders[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get user's open orderscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/open_orders
```

200CopyAsk AI```
[
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
]
```

User# Get user's open orders

Copy pageRetrieve all currently open orders for a specific user including TP/SL orders from positions.

Copy pageGET/api/v1/open_ordersTry itGet user's open orderscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/open_orders
```

200CopyAsk AI```
[
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
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-limit)limitintegerdefault:10Maximum number of orders to return

Required range: `x >= 0`#### Response

200 - application/jsonOpen orders retrieved successfully

[​](#response-client-order-id)client_order_idstringrequired[​](#response-details)detailsstringrequired[​](#response-is-buy)is_buybooleanrequired[​](#response-is-reduce-only)is_reduce_onlybooleanrequired[​](#response-market)marketstringrequired[​](#response-order-direction)order_directionstringrequired[​](#response-order-id)order_idstringrequired[​](#response-order-type)order_typestringrequired[​](#response-parent)parentstringrequired[​](#response-status)statusstringrequired[​](#response-transaction-version)transaction_versionintegerrequiredRequired range: `x >= 0`[​](#response-trigger-condition)trigger_conditionstringrequired[​](#response-unix-ms)unix_msintegerrequiredRequired range: `x >= 0`[​](#response-orig-size)orig_sizenumber | null[​](#response-price)pricenumber | null[​](#response-remaining-size)remaining_sizenumber | null[​](#response-size-delta)size_deltanumber | null[​](#response-sl-limit-price)sl_limit_priceinteger | nullRequired range: `x >= 0`[​](#response-sl-order-id)sl_order_idstring | null[​](#response-sl-trigger-price)sl_trigger_priceinteger | nullRequired range: `x >= 0`[​](#response-tp-limit-price)tp_limit_priceinteger | nullRequired range: `x >= 0`[​](#response-tp-order-id)tp_order_idstring | null[​](#response-tp-trigger-price)tp_trigger_priceinteger | nullRequired range: `x >= 0`[Get user funding rate history](/api-reference/user/get-user-funding-rate-history)[Get user order history](/api-reference/user/get-user-order-history)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)