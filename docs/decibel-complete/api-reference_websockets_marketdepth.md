---
source: https://docs.decibel.trade/api-reference/websockets/marketdepth
title: marketdepth
scraped: 2025-11-28T01:21:06.343Z
---

Market depth - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsMarket depth[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesMarket depth message```
{  "topic": "depth:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1",  "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "bids": [    {      "price": 50000,      "size": 10.5    },    {      "price": 49950,      "size": 15.2    },    {      "price": 49900,      "size": 20    }  ],  "asks": [    {      "price": 50050,      "size": 8.3    },    {      "price": 50100,      "size": 12.7    },    {      "price": 50150,      "size": 18.5    }  ]}
```

Websockets# Market depth

Copy pageMarket order book depth with aggregated price levels

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsdepth:{marketAddr}:{aggregationLevel}ConnectMessagesMarket depth message```
{  "topic": "depth:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1",  "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "bids": [    {      "price": 50000,      "size": 10.5    },    {      "price": 49950,      "size": 15.2    },    {      "price": 49900,      "size": 20    }  ],  "asks": [    {      "price": 50050,      "size": 8.3    },    {      "price": 50100,      "size": 12.7    },    {      "price": 50150,      "size": 18.5    }  ]}
```

ParametersaggregationLeveltype:stringrequiredPrice aggregation level for order book depth (1, 2, 5, or 10)

marketAddrtype:stringrequiredMarket address (Aptos address format, e.g. 0x456...)

SendMarketDepthMessagetype:objectshow 4 propertiesMarket order book depth with aggregated price levels

[Notifications](/api-reference/websockets/notifications)[Market price](/api-reference/websockets/marketprice)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)