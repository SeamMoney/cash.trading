---
source: https://docs.decibel.trade/api-reference/websockets/markettrades
title: markettrades
scraped: 2025-11-28T01:21:03.121Z
---

Market trades - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsMarket trades[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesMarket trades message```
{  "topic": "trades:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "trades": [    {      "account": "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Open Long",      "trade_id": 3647277,      "size": 0.8,      "price": 50100,      "is_profit": false,      "realized_pnl_amount": -45.2,      "is_funding_positive": true,      "realized_funding_amount": 5.1,      "is_rebate": false,      "fee_amount": 20.04,      "order_id": "45680",      "client_order_id": "order_123",      "transaction_unix_ms": 1699564900000,      "transaction_version": 3647276286    }  ]}
```

Websockets# Market trades

Copy pageRecent trades for a specific market

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wstrades:{marketAddr}ConnectMessagesMarket trades message```
{  "topic": "trades:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "trades": [    {      "account": "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Open Long",      "trade_id": 3647277,      "size": 0.8,      "price": 50100,      "is_profit": false,      "realized_pnl_amount": -45.2,      "is_funding_positive": true,      "realized_funding_amount": 5.1,      "is_rebate": false,      "fee_amount": 20.04,      "order_id": "45680",      "client_order_id": "order_123",      "transaction_unix_ms": 1699564900000,      "transaction_version": 3647276286    }  ]}
```

ParametersmarketAddrtype:stringrequiredMarket address (Aptos address format, e.g. 0x456...)

SendMarketTradesMessagetype:objectshow 2 propertiesRecent trades for a specific market

[Bulk orders](/api-reference/websockets/bulkorders)[User positions](/api-reference/websockets/userpositions)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)