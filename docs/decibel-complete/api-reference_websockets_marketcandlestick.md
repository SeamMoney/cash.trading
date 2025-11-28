---
source: https://docs.decibel.trade/api-reference/websockets/marketcandlestick
title: marketcandlestick
scraped: 2025-11-28T01:21:08.358Z
---

Market candlestick - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsMarket candlestick[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesMarket candlestick message```
{  "topic": "market_candlestick:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1h",  "candle": {    "t": 1699564800000,    "T": 1699568400000,    "o": 49800,    "h": 50300,    "l": 49600,    "c": 50125.75,    "v": 1250.5,    "i": "1h"  }}
```

Websockets# Market candlestick

Copy pageReal-time candlestick/OHLCV data for a specific market and interval

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsmarket_candlestick:{marketAddr}:{interval}ConnectMessagesMarket candlestick message```
{  "topic": "market_candlestick:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1h",  "candle": {    "t": 1699564800000,    "T": 1699568400000,    "o": 49800,    "h": 50300,    "l": 49600,    "c": 50125.75,    "v": 1250.5,    "i": "1h"  }}
```

Parametersintervaltype:stringrequiredCandlestick interval (1m, 15m, 1h, 4h, or 1d)

marketAddrtype:stringrequiredMarket address (Aptos address format, e.g. 0x456...)

SendMarketCandlestickMessagetype:objectshow 2 propertiesReal-time candlestick/OHLCV data for a specific market and interval

[User active twaps](/api-reference/websockets/useractivetwaps)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)