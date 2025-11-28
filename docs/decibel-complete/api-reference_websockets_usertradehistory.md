---
source: https://docs.decibel.trade/api-reference/websockets/usertradehistory
title: usertradehistory
scraped: 2025-11-28T01:21:07.492Z
---

User trade history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUser trade history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUser trade history message```
{  "topic": "user_trade_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "trades": [    {      "account": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Open Long",      "trade_id": 3647276,      "size": 1.5,      "price": 50125.75,      "is_profit": true,      "realized_pnl_amount": 187.5,      "is_funding_positive": false,      "realized_funding_amount": -12.3,      "is_rebate": true,      "fee_amount": 25.06,      "order_id": "45678",      "client_order_id": "order_123",      "transaction_unix_ms": 1699564800000,      "transaction_version": 3647276285    }  ]}
```

Websockets# User trade history

Copy pageUser’s trade execution history

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsuser_trade_history:{userAddr}ConnectMessagesUser trade history message```
{  "topic": "user_trade_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "trades": [    {      "account": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Open Long",      "trade_id": 3647276,      "size": 1.5,      "price": 50125.75,      "is_profit": true,      "realized_pnl_amount": 187.5,      "is_funding_positive": false,      "realized_funding_amount": -12.3,      "is_rebate": true,      "fee_amount": 25.06,      "order_id": "45678",      "client_order_id": "order_123",      "transaction_unix_ms": 1699564800000,      "transaction_version": 3647276285    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendUserTradeHistoryMessagetype:objectshow 2 propertiesUser's trade execution history

[User funding rate history](/api-reference/websockets/userfundingratehistory)[User active twaps](/api-reference/websockets/useractivetwaps)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)