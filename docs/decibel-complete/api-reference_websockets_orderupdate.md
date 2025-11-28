---
source: https://docs.decibel.trade/api-reference/websockets/orderupdate
title: orderupdate
scraped: 2025-11-28T01:21:03.935Z
---

Order update - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsOrder update[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesOrder update message```
{  "topic": "order_updates:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "order": {    "status": "Filled",    "details": "",    "order": {      "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "historical_order_456",      "order_id": "45679",      "status": "Filled",      "order_type": "Market",      "trigger_condition": "None",      "order_direction": "Close Short",      "orig_size": 2,      "remaining_size": 0,      "size_delta": null,      "price": 49500,      "is_buy": false,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345680,      "unix_ms": 1699565000000    }  }}
```

Websockets# Order update

Copy pageOrder update for a specific user

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsorder_updates:{userAddr}ConnectMessagesOrder update message```
{  "topic": "order_updates:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "order": {    "status": "Filled",    "details": "",    "order": {      "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "historical_order_456",      "order_id": "45679",      "status": "Filled",      "order_type": "Market",      "trigger_condition": "None",      "order_direction": "Close Short",      "orig_size": 2,      "remaining_size": 0,      "size_delta": null,      "price": 49500,      "is_buy": false,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345680,      "unix_ms": 1699565000000    }  }}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendOrderUpdateMessagetype:objectshow 2 propertiesOrder update for a specific user

[User positions](/api-reference/websockets/userpositions)[User order history](/api-reference/websockets/userorderhistory)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)