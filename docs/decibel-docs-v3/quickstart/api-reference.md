---
title: "API Reference"
url: "https://docs.decibel.trade/quickstart/api-reference"
scraped: "2026-02-03T21:43:58.484Z"
---

# API Reference

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
API Reference
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#welcome-to-decibel-api)
Welcome to Decibel API
The Decibel Trading Platform provides comprehensive APIs for programmatic trading:
[
## REST API
Query market data, orders, positions, and account information via HTTP endpoints (see navigation below)
](/api-reference/user/get-account-overview)[
## WebSocket Streams
Real-time updates for prices, order book, trades, and positions.
](/api-reference/websockets/bulkorderfills)
## 
[​
](#api-specifications)
API Specifications
Both APIs are automatically generated from the Rust codebase, ensuring documentation is always up-to-date:
-   **OpenAPI 3.1.0** - RESTful HTTP endpoints
-   **AsyncAPI 3.0.0** - WebSocket streaming channels
## 
[​
](#base-urls)
Base URLs
Testnet
Netna
Copy
Ask AI
```
REST: https://api.testnet.aptoslabs.com/decibel
WebSocket: wss://api.testnet.aptoslabs.com/decibel/ws
```
## 
[​
](#quick-start)
Quick Start
### 
[​
](#rest-api-example)
REST API Example
Testnet
Netna
Copy
Ask AI
```
curl https://api.testnet.aptoslabs.com/decibel/api/v1/markets \
-H "Authorization: Bearer YOUR_NODE_API_KEY"
```
### 
[​
](#websocket-example)
WebSocket Example
Copy
Ask AI
```
const ws = new WebSocket("wss://api.testnet.aptoslabs.com/decibel/ws");
// Subscribe to market prices
ws.send(
JSON.stringify({
Subscribe: { topic: "all_market_prices" },
})
);
ws.onmessage = (event) => {
const data = JSON.parse(event.data);
console.log("Market prices:", data);
};
```
## 
[​
](#features)
Features
Market Data
-   Real-time and historical price data
-   Order book depth with multiple aggregation levels
-   OHLCV candlestick data (1m, 15m, 1h, 4h, 1d)
-   Recent trades and volume
Trading
-   Manage orders (limit, market, stop) - Bulk order submission - TWAP (Time-Weighted Average Price) orders - Order history and fills
Positions & Account
-   Real-time position updates - Account equity and PnL - Margin and leverage information - Funding rate history
WebSocket Topics
Subscribe to 17 different channels:
-   User-specific: orders, positions, trades
-   Market-specific: prices, depth, candlesticks
-   Global: all markets, users with positions
## 
[​
](#documentation-structure)
Documentation Structure
The API documentation is organized into tabs:
1.  **Guides** - Getting started, tutorials, and examples
2.  **REST API** - All HTTP endpoints (auto-generated from OpenAPI)
3.  **WebSocket API** - All streaming channels (auto-generated from AsyncAPI)
[Authenticated Requests](/quickstart/authenticated-requests)[Placing Your First Order](/quickstart/placing-your-first-order)
⌘I