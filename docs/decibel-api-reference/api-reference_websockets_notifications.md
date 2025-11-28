---
source: https://docs.decibel.trade/api-reference/websockets/notifications
scraped: 2025-11-28T01:19:19.487Z
---

Notifications - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationWebsocketsNotifications[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Websockets

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

MessagesNotifications message```
{  "topic": "notifications:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "notification": {    "account": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",    "message": "Your limit order for BTC-PERP has been filled",    "notification_type": "OrderFilled",    "order": {      "parent": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "order_123",      "order_id": "45678",      "status": "Filled",      "order_type": "Limit",      "trigger_condition": "None",      "order_direction": "Open Long",      "orig_size": 1.5,      "remaining_size": 0,      "size_delta": null,      "price": 50000.5,      "is_buy": true,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345678,      "unix_ms": 1699564800000    }  }}
```

Websockets# Notifications

Copy pageReal-time notifications for the user

Copy pageWSSws://api.netna.aptoslabs.com/decibel/wsnotifications:{userAddr}ConnectMessagesNotifications message```
{  "topic": "notifications:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "notification": {    "account": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",    "message": "Your limit order for BTC-PERP has been filled",    "notification_type": "OrderFilled",    "order": {      "parent": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "order_123",      "order_id": "45678",      "status": "Filled",      "order_type": "Limit",      "trigger_condition": "None",      "order_direction": "Open Long",      "orig_size": 1.5,      "remaining_size": 0,      "size_delta": null,      "price": 50000.5,      "is_buy": true,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345678,      "unix_ms": 1699564800000    }  }}
```

ParametersuserAddrtype:stringrequiredUser wallet address (Aptos address format, e.g. 0x123...)

SendNotificationsMessagetype:objectshow 2 propertiesReal-time notifications for the user

[All market prices](/api-reference/websockets/allmarketprices)[Market depth](/api-reference/websockets/marketdepth)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)