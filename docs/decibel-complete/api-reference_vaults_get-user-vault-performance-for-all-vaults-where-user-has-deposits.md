---
source: https://docs.decibel.trade/api-reference/vaults/get-user-vault-performance-for-all-vaults-where-user-has-deposits
title: get user vault performance for all vaults where user has deposits
scraped: 2025-11-28T01:21:00.497Z
---

Get user vault performance for all vaults where user has deposits - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationVaultsGet user vault performance for all vaults where user has deposits[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get user vault performance for all vaults where user has depositscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/user_vault_performance
```

200CopyAsk AI```
[
  {
    "all_time_return": 123,
    "current_num_shares": 1,
    "current_value_of_shares": 123,
    "net_deposits": 123,
    "unrealized_pnl": 123,
    "user_address": "&#x3C;string>",
    "vault_address": "&#x3C;string>"
  }
]
```

Vaults# Get user vault performance for all vaults where user has deposits

Copy pageRetrieve performance metrics for all vaults where the user has deposits, including net deposits, current value, returns, and PnL.
Results are ordered by net deposits (descending) and support pagination.Copy pageGET/api/v1/user_vault_performanceTry itGet user vault performance for all vaults where user has depositscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/user_vault_performance
```

200CopyAsk AI```
[
  {
    "all_time_return": 123,
    "current_num_shares": 1,
    "current_value_of_shares": 123,
    "net_deposits": 123,
    "unrealized_pnl": 123,
    "user_address": "&#x3C;string>",
    "vault_address": "&#x3C;string>"
  }
]
```

#### Query Parameters

[​](#parameter-user-address)user_addressstringrequiredUser account address

[​](#parameter-offset)offsetintegerdefault:0Number of results to skip (for pagination)

Required range: `x >= 0`[​](#parameter-limit)limitintegerdefault:20Maximum number of results to return

Required range: `x >= 0`#### Response

200 - application/jsonUser vault performance retrieved successfully

[​](#response-user-address)user_addressstringrequired[​](#response-vault-address)vault_addressstringrequired[​](#response-all-time-return)all_time_returnnumber | null[​](#response-current-num-shares)current_num_sharesinteger | nullRequired range: `x >= 0`[​](#response-current-value-of-shares)current_value_of_sharesnumber | null[​](#response-net-deposits)net_depositsnumber | null[​](#response-unrealized-pnl)unrealized_pnlnumber | null[Get user-owned vaults](/api-reference/vaults/get-user-owned-vaults)[Get public vaults](/api-reference/vaults/get-public-vaults)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)