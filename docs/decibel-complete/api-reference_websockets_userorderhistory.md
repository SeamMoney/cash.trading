---
source: https://docs.decibel.trade/api-reference/websockets/userorderhistory
title: userorderhistory
scraped: 2025-11-28T01:21:04.331Z
---

User order history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUser order history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUser order history message```
{  "topic": "user_order_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "orders": [    {      "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "historical_order_456",      "order_id": "45679",      "status": "Filled",      "order_type": "Market",      "trigger_condition": "None",      "order_direction": "Close Short",      "orig_size": 2,      "remaining_size": 0,      "size_delta": null,      "price": 49500,      "is_buy": false,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345680,      "unix_ms": 1699565000000    }  ]}
```

Websockets# User order history

Copy pageUser’s order history (filled, cancelled, rejected orders)

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsuser_order_history:{userAddr}ConnectMessagesUser order history message```
{  "topic": "user_order_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "orders": [    {      "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "historical_order_456",      "order_id": "45679",      "status": "Filled",      "order_type": "Market",      "trigger_condition": "None",      "order_direction": "Close Short",      "orig_size": 2,      "remaining_size": 0,      "size_delta": null,      "price": 49500,      "is_buy": false,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345680,      "unix_ms": 1699565000000    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendUserOrderHistoryMessagetype:objectshow 2 propertiesUser's order history (filled, cancelled, rejected orders)

[Order update](/api-reference/websockets/orderupdate)[User trades](/api-reference/websockets/usertrades)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)