---
source: https://docs.decibel.trade/api-reference/user/get-account-overview
title: get account overview
scraped: 2025-11-28T01:20:51.059Z
---

Get account overview - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationUserGet account overview[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### User

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

Get account overviewcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/account_overviews
```

200CopyAsk AI```
{
  "all_time_return": 123,
  "average_cash_position": 123,
  "average_leverage": 123,
  "cross_account_leverage_ratio": 40.99,
  "cross_account_position": 123,
  "cross_margin_ratio": 0.01,
  "maintenance_margin": 115.29,
  "max_drawdown": 123,
  "perp_equity_balance": 10064.88,
  "pnl_90d": 123,
  "sharpe_ratio": 123,
  "total_margin": 9998.72,
  "unrealized_funding_cost": -87.84,
  "unrealized_pnl": 154,
  "usdc_cross_withdrawable_balance": 9843.79,
  "usdc_isolated_withdrawable_balance": 0,
  "volume": 123,
  "weekly_win_rate_12w": 123
}
```

User# Get account overview

Copy pageRetrieve account information including equity, PnL, margin, and optional performance metrics.

Copy pageGET/api/v1/account_overviewsTry itGet account overviewcURL

CopyAsk AI```
curl --request GET \
  --url https://api.netna.aptoslabs.com/decibel/api/v1/account_overviews
```

200CopyAsk AI```
{
  "all_time_return": 123,
  "average_cash_position": 123,
  "average_leverage": 123,
  "cross_account_leverage_ratio": 40.99,
  "cross_account_position": 123,
  "cross_margin_ratio": 0.01,
  "maintenance_margin": 115.29,
  "max_drawdown": 123,
  "perp_equity_balance": 10064.88,
  "pnl_90d": 123,
  "sharpe_ratio": 123,
  "total_margin": 9998.72,
  "unrealized_funding_cost": -87.84,
  "unrealized_pnl": 154,
  "usdc_cross_withdrawable_balance": 9843.79,
  "usdc_isolated_withdrawable_balance": 0,
  "volume": 123,
  "weekly_win_rate_12w": 123
}
```

#### Query Parameters

[​](#parameter-user)userstringrequiredUser account address

[​](#parameter-volume-window)volume_windowenum<string>Volume time window (e.g., "7d", "14d", "30d", "90d"). Omit to exclude volume data.

Available options: `7d`, `14d`, `30d`, `90d` [​](#parameter-include-performance)include_performancebooleandefault:falseInclude performance metrics

[​](#parameter-performance-lookback-days)performance_lookback_daysintegerdefault:90Performance lookback window in days.

Required range: `x >= 0`#### Response

200 - application/jsonAccount overview retrieved successfully

[​](#response-cross-account-leverage-ratio)cross_account_leverage_rationumberrequiredExample:`40.99`

[​](#response-cross-margin-ratio)cross_margin_rationumberrequiredExample:`0.01`

[​](#response-maintenance-margin)maintenance_marginnumberrequiredExample:`115.29`

[​](#response-perp-equity-balance)perp_equity_balancenumberrequiredExample:`10064.88`

[​](#response-total-margin)total_marginnumberrequiredExample:`9998.72`

[​](#response-unrealized-funding-cost)unrealized_funding_costnumberrequiredExample:`-87.84`

[​](#response-unrealized-pnl)unrealized_pnlnumberrequiredExample:`154`

[​](#response-usdc-cross-withdrawable-balance)usdc_cross_withdrawable_balancenumberrequiredExample:`9843.79`

[​](#response-usdc-isolated-withdrawable-balance)usdc_isolated_withdrawable_balancenumberrequiredExample:`0`

[​](#response-all-time-return)all_time_returnnumber | null[​](#response-average-cash-position)average_cash_positionnumber | null[​](#response-average-leverage)average_leveragenumber | null[​](#response-cross-account-position)cross_account_positionnumber | null[​](#response-max-drawdown)max_drawdownnumber | null[​](#response-pnl-90d)pnl_90dnumber | null[​](#response-sharpe-ratio)sharpe_rationumber | null[​](#response-volume)volumenumber | null[​](#response-weekly-win-rate-12w)weekly_win_rate_12wnumber | null[Get active TWAP orders](/api-reference/user/get-active-twap-orders)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)