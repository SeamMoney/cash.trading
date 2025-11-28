---
source: https://docs.decibel.trade/api-reference/user/get-user-positions
title: get user positions
scraped: 2025-11-28T01:20:55.181Z
---

Get user positions - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet user positions[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get user positionscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/user_positions
```

200CopyAsk AI```
[
  {
    "entry_price": 123,
    "estimated_liquidation_price": 123,
    "event_uid": 1,
    "has_fixed_sized_tpsls": true,
    "is_deleted": true,
    "is_isolated": true,
    "market": "&#x3C;string>",
    "max_allowed_leverage": 1,
    "size": 123,
    "sl_limit_price": 1,
    "sl_order_id": "&#x3C;string>",
    "sl_trigger_price": 1,
    "tp_limit_price": 1,
    "tp_order_id": "&#x3C;string>",
    "tp_trigger_price": 1,
    "transaction_version": 1,
    "unrealized_funding": 123,
    "user": "&#x3C;string>",
    "user_leverage": 1
  }
]
```

User# Get user positions

Copy pageRetrieve all positions for a specific user with optional filtering by market.

Copy pageGET/api/v1/user_positionsTry itGet user positionscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/user_positions
```

200CopyAsk AI```
[
  {
    "entry_price": 123,
    "estimated_liquidation_price": 123,
    "event_uid": 1,
    "has_fixed_sized_tpsls": true,
    "is_deleted": true,
    "is_isolated": true,
    "market": "&#x3C;string>",
    "max_allowed_leverage": 1,
    "size": 123,
    "sl_limit_price": 1,
    "sl_order_id": "&#x3C;string>",
    "sl_trigger_price": 1,
    "tp_limit_price": 1,
    "tp_order_id": "&#x3C;string>",
    "tp_trigger_price": 1,
    "transaction_version": 1,
    "unrealized_funding": 123,
    "user": "&#x3C;string>",
    "user_leverage": 1
  }
]
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-limit)limitintegerdefault:100Maximum number of positions to return

Required range: `x >= 0`[​](#parameter-include-deleted)include_deletedbooleanInclude deleted positions

[​](#parameter-market-address)market_addressstringFilter by specific market address

#### Response

200 - application/jsonUser positions retrieved successfully

[​](#response-entry-price)entry_pricenumberrequired[​](#response-estimated-liquidation-price)estimated_liquidation_pricenumberrequired[​](#response-event-uid)event_uidintegerrequiredRequired range: `x >= 0`[​](#response-has-fixed-sized-tpsls)has_fixed_sized_tpslsbooleanrequired[​](#response-is-deleted)is_deletedbooleanrequired[​](#response-is-isolated)is_isolatedbooleanrequired[​](#response-market)marketstringrequired[​](#response-max-allowed-leverage)max_allowed_leverageintegerrequiredRequired range: `x >= 0`[​](#response-size)sizenumberrequired[​](#response-transaction-version)transaction_versionintegerrequiredRequired range: `x >= 0`[​](#response-unrealized-funding)unrealized_fundingnumberrequired[​](#response-user)userstringrequired[​](#response-user-leverage)user_leverageintegerrequiredRequired range: `x >= 0`[​](#response-sl-limit-price)sl_limit_priceinteger | nullRequired range: `x >= 0`[​](#response-sl-order-id)sl_order_idstring | null[​](#response-sl-trigger-price)sl_trigger_priceinteger | nullRequired range: `x >= 0`[​](#response-tp-limit-price)tp_limit_priceinteger | nullRequired range: `x >= 0`[​](#response-tp-order-id)tp_order_idstring | null[​](#response-tp-trigger-price)tp_trigger_priceinteger | nullRequired range: `x >= 0`[Get TWAP order history](/api-reference/user/get-twap-order-history)[Get asset contexts](/api-reference/market-data/get-asset-contexts)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)