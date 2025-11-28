---
source: https://docs.decibel.trade/api-reference/user/get-single-order-details
title: get single order details
scraped: 2025-11-28T01:20:53.568Z
---

Get single order details - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet single order details[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get single order detailscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/orders
```

200

Cancelled

CopyAsk AI```
{  "status": "Cancelled",  "details": "IOC Violation",  "order": {    "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "client_order_id": "",    "order_id": "45679",    "status": "Cancelled",    "order_type": "Market",    "trigger_condition": "None",    "order_direction": "Close Short",    "orig_size": 2,    "remaining_size": 0,    "size_delta": null,    "price": 49500,    "is_buy": false,    "is_reduce_only": false,    "details": "IOC Violation",    "tp_order_id": null,    "tp_trigger_price": null,    "tp_limit_price": null,    "sl_order_id": null,    "sl_trigger_price": null,    "sl_limit_price": null,    "transaction_version": 12345680,    "unix_ms": 1699565000000  }}
```

User# Get single order details

Copy pageRetrieve details of a specific order by order_id or client_order_id.

Copy pageGET/api/v1/ordersTry itGet single order detailscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/orders
```

200

Cancelled

CopyAsk AI```
{  "status": "Cancelled",  "details": "IOC Violation",  "order": {    "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "client_order_id": "",    "order_id": "45679",    "status": "Cancelled",    "order_type": "Market",    "trigger_condition": "None",    "order_direction": "Close Short",    "orig_size": 2,    "remaining_size": 0,    "size_delta": null,    "price": 49500,    "is_buy": false,    "is_reduce_only": false,    "details": "IOC Violation",    "tp_order_id": null,    "tp_trigger_price": null,    "tp_limit_price": null,    "sl_order_id": null,    "sl_trigger_price": null,    "sl_limit_price": null,    "transaction_version": 12345680,    "unix_ms": 1699565000000  }}
```

#### Query Parameters

[​](#parameter-market-address)market_addressstringrequiredMarket address

[​](#parameter-user-address)user_addressstringrequiredUser account address

[​](#parameter-order-id)order_idstringOrder ID (provide either this or client_order_id)

[​](#parameter-client-order-id)client_order_idstringClient order ID (provide either this or order_id)

#### Response

200 - application/jsonOrder details retrieved successfully

[​](#response-details)detailsstringrequired[​](#response-order)orderobjectrequiredShow child attributes

[​](#response-status)statusstringrequired[Get user order history](/api-reference/user/get-user-order-history)[Get subaccounts](/api-reference/user/get-subaccounts)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)