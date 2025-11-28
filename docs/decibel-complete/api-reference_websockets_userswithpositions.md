---
source: https://docs.decibel.trade/api-reference/websockets/userswithpositions
title: userswithpositions
scraped: 2025-11-28T01:21:01.680Z
---

Users with positions - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUsers with positions[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUsers with positions message```
{  "topic": "users_with_positions",  "users": [    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",    "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"  ]}
```

Websockets# Users with positions

Copy pageList of all users currently holding positions (global topic)

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsusers_with_positionsConnectMessagesUsers with positions message```
{  "topic": "users_with_positions",  "users": [    "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",    "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"  ]}
```

SendUsersWithPositionsMessagetype:objectshow 2 propertiesList of all users currently holding positions (global topic)

[Account overview](/api-reference/websockets/accountoverview)[Bulk order fills](/api-reference/websockets/bulkorderfills)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)