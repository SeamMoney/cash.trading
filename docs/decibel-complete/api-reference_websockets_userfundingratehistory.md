---
source: https://docs.decibel.trade/api-reference/websockets/userfundingratehistory
title: userfundingratehistory
scraped: 2025-11-28T01:21:07.107Z
---

User funding rate history - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsUser funding rate history[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesUser funding rate history message```
{  "topic": "user_funding_rate_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "funding_rates": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Close Long",      "size": 1.5,      "is_funding_positive": false,      "realized_funding_amount": -12.3,      "is_rebate": false,      "fee_amount": 5.15,      "transaction_unix_ms": 1699564800000    }  ]}
```

Websockets# User funding rate history

Copy pageUser’s funding rate payment history

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsuser_funding_rate_history:{userAddr}ConnectMessagesUser funding rate history message```
{  "topic": "user_funding_rate_history:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "funding_rates": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Close Long",      "size": 1.5,      "is_funding_positive": false,      "realized_funding_amount": -12.3,      "is_rebate": false,      "fee_amount": 5.15,      "transaction_unix_ms": 1699564800000    }  ]}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendUserFundingRateHistoryMessagetype:objectshow 2 propertiesUser's funding rate payment history

[Market price](/api-reference/websockets/marketprice)[User trade history](/api-reference/websockets/usertradehistory)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)