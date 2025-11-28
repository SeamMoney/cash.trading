---
source: https://docs.decibel.trade/api-reference/websockets/useractivetwaps
title: useractivetwaps
scraped: 2025-11-28T01:21:07.933Z
---

User active twaps - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUser active twaps[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUser active twaps message```
{  "topic": "user_active_twaps:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "twaps": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "is_buy": true,      "order_id": "78901",      "is_reduce_only": false,      "start_unix_ms": 1699564800000,      "frequency_s": 300,      "duration_s": 3600,      "orig_size": 100,      "remaining_size": 75,      "status": "Open",      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345679    }  ]}
```

Websockets# User active twaps

Copy pageUser’s active TWAP (Time-Weighted Average Price) orders

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsuser_active_twaps:{userAddr}ConnectMessagesUser active twaps message```
{  "topic": "user_active_twaps:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "twaps": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "is_buy": true,      "order_id": "78901",      "is_reduce_only": false,      "start_unix_ms": 1699564800000,      "frequency_s": 300,      "duration_s": 3600,      "orig_size": 100,      "remaining_size": 75,      "status": "Open",      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345679    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendUserActiveTwapsMessagetype:objectshow 2 propertiesUser's active TWAP (Time-Weighted Average Price) orders

[User trade history](/api-reference/websockets/usertradehistory)[Market candlestick](/api-reference/websockets/marketcandlestick)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)