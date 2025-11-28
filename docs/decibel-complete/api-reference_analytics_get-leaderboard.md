---
source: https://docs.decibel.trade/api-reference/analytics/get-leaderboard
title: get leaderboard
scraped: 2025-11-28T01:20:59.258Z
---

Get leaderboard - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationAnalyticsGet leaderboard[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get leaderboardcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/leaderboard
```

200CopyAsk AI```
{
  "items": [
    {
      "account": "&#x3C;string>",
      "account_value": 123,
      "rank": 1,
      "realized_pnl": 123,
      "roi": 123,
      "volume": 123
    }
  ],
  "total_count": 1
}
```

Analytics# Get leaderboard

Copy pageRetrieve paginated leaderboard data with sorting and search capabilities.

Copy pageGET/api/v1/leaderboardTry itGet leaderboardcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/leaderboard
```

200CopyAsk AI```
{
  "items": [
    {
      "account": "&#x3C;string>",
      "account_value": 123,
      "rank": 1,
      "realized_pnl": 123,
      "roi": 123,
      "volume": 123
    }
  ],
  "total_count": 1
}
```

#### Query Parameters

[​](#parameter-pagination)paginationobjectrequiredShow child attributes

[​](#parameter-sorting)sortingobjectrequiredShow child attributes

[​](#parameter-search-term)search_termstringOptional search term to filter accounts by account address

#### Response

200 - application/jsonLeaderboard retrieved successfully

[​](#response-items)itemsobject[]requiredThe items in the current page

Show child attributes

[​](#response-total-count)total_countintegerrequiredThe total number of items across all pages

Required range: `x >= 0`[Get bulk orders](/api-reference/bulk-orders/get-bulk-orders)[Get portfolio chart data](/api-reference/analytics/get-portfolio-chart-data)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)