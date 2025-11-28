---
source: https://docs.decibel.trade/api-reference/websockets/marketprice
title: marketprice
scraped: 2025-11-28T01:21:06.740Z
---

Market price - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsMarket price[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesMarket price message```
{  "topic": "market_price:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "price": {    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "oracle_px": 50125.75,    "mark_px": 50120.5,    "mid_px": 50122.25,    "funding_rate_bps": 5,    "is_funding_positive": true,    "transaction_unix_ms": 1699564800000,    "open_interest": 125000.5  }}
```

Websockets# Market price

Copy pageReal-time price updates for a specific market (oracle, mark, mid prices)

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsmarket_price:{marketAddr}ConnectMessagesMarket price message```
{  "topic": "market_price:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "price": {    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "oracle_px": 50125.75,    "mark_px": 50120.5,    "mid_px": 50122.25,    "funding_rate_bps": 5,    "is_funding_positive": true,    "transaction_unix_ms": 1699564800000,    "open_interest": 125000.5  }}
```

ParametersmarketAddrtype:stringrequiredMarket address (Aptos address format, e.g. 0x456...)

SendMarketPriceMessagetype:objectshow 2 propertiesReal-time price updates for a specific market (oracle, mark, mid prices)

[Market depth](/api-reference/websockets/marketdepth)[User funding rate history](/api-reference/websockets/userfundingratehistory)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)