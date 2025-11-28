---
source: https://docs.decibel.trade/api-reference/vaults/get-public-vaults
title: get public vaults
scraped: 2025-11-28T01:21:00.926Z
---

Get public vaults - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationVaultsGet public vaults[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get public vaultscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/vaults
```

200CopyAsk AI```
{
  "items": [
    {
      "address": "&#x3C;string>",
      "all_time_return": 123,
      "average_leverage": 123,
      "created_at": 123,
      "depositors": 123,
      "manager": "&#x3C;string>",
      "manager_avg_cash": 123,
      "max_drawdown": 123,
      "name": "&#x3C;string>",
      "past_month_return": 123,
      "perp_equity": 123,
      "pnl_90d": 123,
      "pnl_history": [
        123
      ],
      "profit_share": 123,
      "sharpe_ratio": 123,
      "status": "&#x3C;string>",
      "tvl": 123,
      "vault_type": "&#x3C;string>",
      "volume": 123,
      "weekly_win_rate_12w": 123
    }
  ],
  "total_count": 1
}
```

Vaults# Get public vaults

Copy pageRetrieve paginated list of public vaults with optional status and vault type filtering.
Use `vault_type` query parameter to filter by ‘user’ or ‘protocol’ vaults.Copy pageGET/api/v1/vaultsTry itGet public vaultscURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/vaults
```

200CopyAsk AI```
{
  "items": [
    {
      "address": "&#x3C;string>",
      "all_time_return": 123,
      "average_leverage": 123,
      "created_at": 123,
      "depositors": 123,
      "manager": "&#x3C;string>",
      "manager_avg_cash": 123,
      "max_drawdown": 123,
      "name": "&#x3C;string>",
      "past_month_return": 123,
      "perp_equity": 123,
      "pnl_90d": 123,
      "pnl_history": [
        123
      ],
      "profit_share": 123,
      "sharpe_ratio": 123,
      "status": "&#x3C;string>",
      "tvl": 123,
      "vault_type": "&#x3C;string>",
      "volume": 123,
      "weekly_win_rate_12w": 123
    }
  ],
  "total_count": 1
}
```

#### Query Parameters

[​](#parameter-status)statusstringVault status filter (active, etc.)

[​](#parameter-vault-type)vault_typestringVault type filter ('user' or 'protocol'). If not provided, returns all vaults.

#### Response

200 - application/jsonPublic vaults retrieved successfully

[​](#response-items)itemsobject[]requiredThe items in the current page

Show child attributes

[​](#response-total-count)total_countintegerrequiredThe total number of items across all pages

Required range: `x >= 0`[Get user vault performance for all vaults where user has deposits](/api-reference/vaults/get-user-vault-performance-for-all-vaults-where-user-has-deposits)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)