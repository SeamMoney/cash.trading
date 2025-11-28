---
source: https://docs.decibel.trade/api-reference/websockets/bulkorderfills
title: bulkorderfills
scraped: 2025-11-28T01:21:02.090Z
---

Bulk order fills - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsBulk order fills[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesBulk order fills message```
{  "topic": "bulk_order_fills:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "bulk_order_fills": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "sequence_number": 100,      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "filled_size": 1.5,      "price": 50000,      "is_bid": true,      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345682,      "event_uid": 1.2345678901234568e+35    }  ]}
```

Websockets# Bulk order fills

Copy pageUser’s bulk order fill events

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsbulk_order_fills:{userAddr}ConnectMessagesBulk order fills message```
{  "topic": "bulk_order_fills:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "bulk_order_fills": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "sequence_number": 100,      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "filled_size": 1.5,      "price": 50000,      "is_bid": true,      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345682,      "event_uid": 1.2345678901234568e+35    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendBulkOrderFillsMessagetype:objectshow 2 propertiesUser's bulk order fill events

[Users with positions](/api-reference/websockets/userswithpositions)[Bulk orders](/api-reference/websockets/bulkorders)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)