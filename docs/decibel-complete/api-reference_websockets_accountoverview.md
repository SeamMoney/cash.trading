---
source: https://docs.decibel.trade/api-reference/websockets/accountoverview
title: accountoverview
scraped: 2025-11-28T01:21:01.299Z
---

Account overview - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsAccount overview[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

- [WSSAccount overview](/api-reference/websockets/accountoverview)
- [WSSUsers with positions](/api-reference/websockets/userswithpositions)
- [WSSBulk order fills](/api-reference/websockets/bulkorderfills)
- [WSSBulk orders](/api-reference/websockets/bulkorders)
- [WSSMarket trades](/api-reference/websockets/markettrades)
- [WSSUser positions](/api-reference/websockets/userpositions)
- [WSSOrder update](/api-reference/websockets/orderupdate)
- [WSSUser order history](/api-reference/websockets/userorderhistory)
- [WSSUser trades](/api-reference/websockets/usertrades)
- [WSSUser open orders](/api-reference/websockets/useropenorders)
- [WSSAll market prices](/api-reference/websockets/allmarketprices)
- [WSSNotifications](/api-reference/websockets/notifications)
- [WSSMarket depth](/api-reference/websockets/marketdepth)
- [WSSMarket price](/api-reference/websockets/marketprice)
- [WSSUser funding rate history](/api-reference/websockets/userfundingratehistory)
- [WSSUser trade history](/api-reference/websockets/usertradehistory)
- [WSSUser active twaps](/api-reference/websockets/useractivetwaps)
- [WSSMarket candlestick](/api-reference/websockets/marketcandlestick)

MessagesAccount overview message```
{  "topic": "account_overview:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "account_overview": {    "perp_equity_balance": 50250.75,    "unrealized_pnl": 1250.5,    "unrealized_funding_cost": -125.25,    "cross_margin_ratio": 0.15,    "maintenance_margin": 2500,    "cross_account_leverage_ratio": 500,    "volume": 125000,    "all_time_return": 0.25,    "pnl_90d": 5000,    "sharpe_ratio": 1.8,    "max_drawdown": -0.08,    "weekly_win_rate_12w": 0.65,    "average_cash_position": 45000,    "average_leverage": 5.5,    "cross_account_position": 25000,    "total_margin": 10000,    "usdc_cross_withdrawable_balance": 7500,    "usdc_isolated_withdrawable_balance": 2500  }}
```

Websockets# Account overview

Copy pageUser’s account overview including equity, margin, and PnL

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsaccount_overview:{userAddr}ConnectMessagesAccount overview message```
{  "topic": "account_overview:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "account_overview": {    "perp_equity_balance": 50250.75,    "unrealized_pnl": 1250.5,    "unrealized_funding_cost": -125.25,    "cross_margin_ratio": 0.15,    "maintenance_margin": 2500,    "cross_account_leverage_ratio": 500,    "volume": 125000,    "all_time_return": 0.25,    "pnl_90d": 5000,    "sharpe_ratio": 1.8,    "max_drawdown": -0.08,    "weekly_win_rate_12w": 0.65,    "average_cash_position": 45000,    "average_leverage": 5.5,    "cross_account_position": 25000,    "total_margin": 10000,    "usdc_cross_withdrawable_balance": 7500,    "usdc_isolated_withdrawable_balance": 2500  }}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendAccountOverviewMessagetype:objectshow 2 propertiesUser's account overview including equity, margin, and PnL

[Users with positions](/api-reference/websockets/userswithpositions)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)