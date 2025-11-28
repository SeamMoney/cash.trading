---
source: https://docs.decibel.trade/api-reference/websockets/bulkorders
title: bulkorders
scraped: 2025-11-28T01:21:02.570Z
---

Bulk orders - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsBulk orders[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesBulk orders message```
{  "topic": "bulk_orders:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "bulk_order": {    "status": "Placed",    "details": "",    "bulk_order": {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "sequence_number": 100,      "previous_seq_num": 99,      "bid_prices": [        50000,        49900      ],      "bid_sizes": [        1,        2      ],      "ask_prices": [        50100,        50200      ],      "ask_sizes": [        1.5,        2.5      ],      "cancelled_bid_prices": [],      "cancelled_bid_sizes": [],      "cancelled_ask_prices": [],      "cancelled_ask_sizes": [],      "transaction_version": 12345678,      "transaction_unix_ms": 1699564800000,      "event_uid": 1.2345678901234568e+35    }  }}
```

Websockets# Bulk orders

Copy pageUser’s bulk orders (multi-order submissions)

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsbulk_orders:{userAddr}ConnectMessagesBulk orders message```
{  "topic": "bulk_orders:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "bulk_order": {    "status": "Placed",    "details": "",    "bulk_order": {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "sequence_number": 100,      "previous_seq_num": 99,      "bid_prices": [        50000,        49900      ],      "bid_sizes": [        1,        2      ],      "ask_prices": [        50100,        50200      ],      "ask_sizes": [        1.5,        2.5      ],      "cancelled_bid_prices": [],      "cancelled_bid_sizes": [],      "cancelled_ask_prices": [],      "cancelled_ask_sizes": [],      "transaction_version": 12345678,      "transaction_unix_ms": 1699564800000,      "event_uid": 1.2345678901234568e+35    }  }}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendBulkOrdersMessagetype:objectshow 2 propertiesUser's bulk orders (multi-order submissions)

[Bulk order fills](/api-reference/websockets/bulkorderfills)[Market trades](/api-reference/websockets/markettrades)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)