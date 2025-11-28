---
source: https://docs.decibel.trade/api-reference/websockets/userpositions
title: userpositions
scraped: 2025-11-28T01:21:03.557Z
---

User positions - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUser positions[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUser positions message```
{  "topic": "user_positions:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "positions": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "size": 2.5,      "user_leverage": 10,      "max_allowed_leverage": 20,      "entry_price": 49800,      "is_isolated": false,      "is_deleted": false,      "unrealized_funding": -25.5,      "event_uid": 1.2345678901234568e+35,      "estimated_liquidation_price": 45000,      "transaction_version": 12345681,      "tp_order_id": "tp_001",      "tp_trigger_price": 52000,      "tp_limit_price": 51900,      "sl_order_id": "sl_001",      "sl_trigger_price": 48000,      "sl_limit_price": null,      "has_fixed_sized_tpsls": false    }  ]}
```

Websockets# User positions

Copy pageUser’s open positions with PnL and liquidation prices

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsuser_positions:{userAddr}ConnectMessagesUser positions message```
{  "topic": "user_positions:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "positions": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "size": 2.5,      "user_leverage": 10,      "max_allowed_leverage": 20,      "entry_price": 49800,      "is_isolated": false,      "is_deleted": false,      "unrealized_funding": -25.5,      "event_uid": 1.2345678901234568e+35,      "estimated_liquidation_price": 45000,      "transaction_version": 12345681,      "tp_order_id": "tp_001",      "tp_trigger_price": 52000,      "tp_limit_price": 51900,      "sl_order_id": "sl_001",      "sl_trigger_price": 48000,      "sl_limit_price": null,      "has_fixed_sized_tpsls": false    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendUserPositionsMessagetype:objectshow 2 propertiesUser's open positions with PnL and liquidation prices

[Market trades](/api-reference/websockets/markettrades)[Order update](/api-reference/websockets/orderupdate)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)