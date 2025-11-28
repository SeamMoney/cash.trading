---
source: https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-order-fills
title: get bulk order fills
scraped: 2025-11-28T01:20:57.991Z
---

Get bulk order fills - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationBulk OrdersGet bulk order fills[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get bulk order fillscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_order_fills
```

200CopyAsk AI```
[
  {
    "event_uid": 1,
    "filled_size": 123,
    "is_bid": true,
    "market": "0xmarket123...",
    "price": 123,
    "sequence_number": 12345,
    "transaction_unix_ms": 1730841600000,
    "transaction_version": 12345,
    "user": "0x123..."
  }
]
```

Bulk Orders# Get bulk order fills

Copy pageRetrieve fills for bulk orders with optional filtering by sequence number or range.

Copy pageGET/api/v1/bulk_order_fillsTry itGet bulk order fillscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_order_fills
```

200CopyAsk AI```
[
  {
    "event_uid": 1,
    "filled_size": 123,
    "is_bid": true,
    "market": "0xmarket123...",
    "price": 123,
    "sequence_number": 12345,
    "transaction_unix_ms": 1730841600000,
    "transaction_version": 12345,
    "user": "0x123..."
  }
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-market)marketstringFilter by specific market address

[​](#parameter-sequence-number)sequence_numberintegerSingle sequence number to query

Required range: `x >= 0`[​](#parameter-start-sequence-number)start_sequence_numberintegerStart of sequence number range

Required range: `x >= 0`[​](#parameter-end-sequence-number)end_sequence_numberintegerEnd of sequence number range. `start_sequence_number` is required if this is provided.

Required range: `x >= 0`[​](#parameter-pagination)paginationobjectPagination parameters

Show child attributes

#### Response

200 - application/jsonBulk order fills retrieved successfully

[​](#response-event-uid)event_uidintegerrequiredRequired range: `x >= 0`[​](#response-filled-size)filled_sizenumberrequired[​](#response-is-bid)is_bidbooleanrequired[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-price)pricenumberrequired[​](#response-sequence-number)sequence_numberintegerrequiredRequired range: `x >= 0`Example:`12345`

[​](#response-transaction-unix-ms)transaction_unix_msintegerrequiredExample:`1730841600000`

[​](#response-transaction-version)transaction_versionintegerrequiredRequired range: `x >= 0`Example:`12345`

[​](#response-user)userstringrequiredExample:`"0x123..."`

[Get trades](/api-reference/market-data/get-trades)[Get bulk order status](/api-reference/bulk-orders/get-bulk-order-status)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)