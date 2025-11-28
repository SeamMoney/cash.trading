---
source: https://docs.decibel.trade/api-reference/user/get-delegations
title: get delegations
scraped: 2025-11-28T01:20:51.990Z
---

Get delegations - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet delegations[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get delegationscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/delegations
```

200CopyAsk AI```
[
  {
    "delegated_account": "0x123...",
    "expiration_time_s": 1736326800000,
    "permission_type": "TradePerpsAllMarkets"
  }
]
```

User# Get delegations

Copy pageRetrieve active delegations for a specific subaccount.

Copy pageGET/api/v1/delegationsTry itGet delegationscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/delegations
```

200CopyAsk AI```
[
  {
    "delegated_account": "0x123...",
    "expiration_time_s": 1736326800000,
    "permission_type": "TradePerpsAllMarkets"
  }
]
```

#### Query Parameters

[​](#parameter-subaccount)subaccountstringrequiredSubaccount address

#### Response

200 - application/jsonDelegations retrieved successfully

[​](#response-delegated-account)delegated_accountstringrequiredThe address of the delegated account

Example:`"0x123..."`

[​](#response-permission-type)permission_typestringrequiredThe permission type that was granted

Example:`"TradePerpsAllMarkets"`

[​](#response-expiration-times)expiration_time_sinteger | nullThe expiration time in seconds (optional, None means no expiration)

Required range: `x >= 0`Example:`1736326800000`

[Get active TWAP orders](/api-reference/user/get-active-twap-orders)[Get user funding rate history](/api-reference/user/get-user-funding-rate-history)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)