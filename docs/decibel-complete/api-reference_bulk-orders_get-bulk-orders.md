---
source: https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-orders
title: get bulk orders
scraped: 2025-11-28T01:20:58.820Z
---

Get bulk orders - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationBulk OrdersGet bulk orders[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get bulk orderscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_orders
```

200CopyAsk AI```
[
  {
    "ask_prices": [
      101,
      102,
      103
    ],
    "ask_sizes": [
      1,
      2,
      3
    ],
    "bid_prices": [
      99,
      98,
      97
    ],
    "bid_sizes": [
      1,
      2,
      3
    ],
    "cancelled_ask_prices": [],
    "cancelled_ask_sizes": [],
    "cancelled_bid_prices": [
      100
    ],
    "cancelled_bid_sizes": [
      1
    ],
    "event_uid": 1,
    "market": "0xmarket123...",
    "previous_seq_num": 12344,
    "sequence_number": 12345,
    "transaction_unix_ms": 1730841600000,
    "transaction_version": 12345,
    "user": "0x123..."
  }
]
```

Bulk Orders# Get bulk orders

Copy pageRetrieve bulk orders for a specific user with optional market filtering.

Copy pageGET/api/v1/bulk_ordersTry itGet bulk orderscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/bulk_orders
```

200CopyAsk AI```
[
  {
    "ask_prices": [
      101,
      102,
      103
    ],
    "ask_sizes": [
      1,
      2,
      3
    ],
    "bid_prices": [
      99,
      98,
      97
    ],
    "bid_sizes": [
      1,
      2,
      3
    ],
    "cancelled_ask_prices": [],
    "cancelled_ask_sizes": [],
    "cancelled_bid_prices": [
      100
    ],
    "cancelled_bid_sizes": [
      1
    ],
    "event_uid": 1,
    "market": "0xmarket123...",
    "previous_seq_num": 12344,
    "sequence_number": 12345,
    "transaction_unix_ms": 1730841600000,
    "transaction_version": 12345,
    "user": "0x123..."
  }
]
```

#### Path Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-market)marketstring | nullrequiredFilter by specific market address

#### Response

200 - application/jsonBulk orders retrieved successfully

[​](#response-ask-prices)ask_pricesnumber[]requiredExample:```
[101, 102, 103]
```

[​](#response-ask-sizes)ask_sizesnumber[]requiredExample:```
[1, 2, 3]
```

[​](#response-bid-prices)bid_pricesnumber[]requiredExample:```
[99, 98, 97]
```

[​](#response-bid-sizes)bid_sizesnumber[]requiredExample:```
[1, 2, 3]
```

[​](#response-cancelled-ask-prices)cancelled_ask_pricesnumber[]requiredExample:```
[]
```

[​](#response-cancelled-ask-sizes)cancelled_ask_sizesnumber[]requiredExample:```
[]
```

[​](#response-cancelled-bid-prices)cancelled_bid_pricesnumber[]requiredExample:```
[100]
```

[​](#response-cancelled-bid-sizes)cancelled_bid_sizesnumber[]requiredExample:```
[1]
```

[​](#response-event-uid)event_uidintegerrequiredRequired range: `x >= 0`[​](#response-market)marketstringrequiredExample:`"0xmarket123..."`

[​](#response-sequence-number)sequence_numberintegerrequiredRequired range: `x >= 0`Example:`12345`

[​](#response-transaction-unix-ms)transaction_unix_msintegerrequiredExample:`1730841600000`

[​](#response-transaction-version)transaction_versionintegerrequiredRequired range: `x >= 0`Example:`12345`

[​](#response-user)userstringrequiredExample:`"0x123..."`

[​](#response-previous-seq-num)previous_seq_numinteger | nullRequired range: `x >= 0`Example:`12344`

[Get bulk order status](/api-reference/bulk-orders/get-bulk-order-status)[Get leaderboard](/api-reference/analytics/get-leaderboard)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)