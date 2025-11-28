---
source: https://docs.decibel.trade/api-reference/websockets/allmarketprices
title: allmarketprices
scraped: 2025-11-28T01:21:05.576Z
---

All market prices - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsAll market prices[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesAll market prices message```
{  "topic": "all_market_prices",  "prices": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "oracle_px": 50125.75,      "mark_px": 50120.5,      "mid_px": 50122.25,      "funding_rate_bps": 5,      "is_funding_positive": true,      "transaction_unix_ms": 1699564800000,      "open_interest": 125000.5    },    {      "market": "0x1111111111111111111111111111111111111111111111111111111111111111",      "oracle_px": 3250,      "mark_px": 3248.75,      "mid_px": 3249.5,      "funding_rate_bps": 3,      "is_funding_positive": false,      "transaction_unix_ms": 1699564800000,      "open_interest": 85000.25    }  ]}
```

Websockets# All market prices

Copy pagePrice updates for all markets (global topic)

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsall_market_pricesConnectMessagesAll market prices message```
{  "topic": "all_market_prices",  "prices": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "oracle_px": 50125.75,      "mark_px": 50120.5,      "mid_px": 50122.25,      "funding_rate_bps": 5,      "is_funding_positive": true,      "transaction_unix_ms": 1699564800000,      "open_interest": 125000.5    },    {      "market": "0x1111111111111111111111111111111111111111111111111111111111111111",      "oracle_px": 3250,      "mark_px": 3248.75,      "mid_px": 3249.5,      "funding_rate_bps": 3,      "is_funding_positive": false,      "transaction_unix_ms": 1699564800000,      "open_interest": 85000.25    }  ]}
```

SendAllMarketPricesMessagetype:objectshow 2 propertiesPrice updates for all markets (global topic)

[User open orders](/api-reference/websockets/useropenorders)[Notifications](/api-reference/websockets/notifications)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)