---
title: "Read SDK"
url: "https://docs.decibel.trade/typescript-sdk/read-sdk"
scraped: "2026-02-03T21:44:18.826Z"
---

# Read SDK

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Read SDK
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#purpose)
Purpose
-   Fetch market data (prices, depth, trades, candlesticks) and account views (orders, positions, subaccounts).
-   Works over REST and Aptos views. No signing or private keys required.
## 
[​
](#when-to-use)
When to use
-   Use for dashboards, analytics, and read-heavy server/frontend use cases.
-   Do not use for submitting transactions; use the Write SDK instead.
## 
[​
](#initialization)
Initialization
Copy
Ask AI
```
import { DecibelReadDex, NETNA_CONFIG } from "@decibeltrade/sdk";
const read = new DecibelReadDex(NETNA_CONFIG, {
// Required: SDK will send Authorization: Bearer <YOUR_NODE_API_KEY> on fullnode requests
nodeApiKey: process.env.APTOS_NODE_API_KEY!,
onWsError: (e) => console.warn("WS error", e), // optional
});
```
## 
[​
](#main-readers)
Main readers
-   Markets: `read.markets.getAll()`, `getByName()`
-   Prices: `read.marketPrices.getAll()`, `getByName()`, `subscribeByName()`
-   Depth: `read.marketDepth.getByName()`
-   Trades: `read.marketTrades.getByName()`
-   Candlesticks: `read.candlesticks.getByName()`, `subscribeByName()`
-   Accounts and orders:
-   `read.accountOverview.getByAddr()`
-   `read.userOpenOrders.getBySubaccount()` / `read.userOrderHistory.getBySubaccount()`
-   `read.userPositions.getBySubaccount()`
-   `read.userTradeHistory.getBySubaccount()`
-   `read.userSubaccounts.getByOwner()`
-   Portfolio and leaderboard:
-   `read.portfolioChart.getByAddr()`
-   `read.leaderboard.getTopUsers()`
-   Vaults and delegations:
-   `read.vaults.getUserOwned()` / `getAll()`
-   `read.delegations.getForSubaccount()`
## 
[​
](#examples)
Examples
### 
[​
](#markets)
Markets
Copy
Ask AI
```
const markets = await read.markets.getAll();
const btc = await read.markets.getByName("BTC-USD");
```
### 
[​
](#prices-and-candlesticks)
Prices and candlesticks
Copy
Ask AI
```
const price = await read.marketPrices.getByName("BTC-USD");
// Subscribe (unsubscribe by calling the returned function)
const unsubscribe = read.marketPrices.subscribeByName("BTC-USD", (msg) => {
console.log("Price update", msg);
});
// Candlesticks
import { CandlestickInterval } from "@decibeltrade/sdk";
const candles = await read.candlesticks.getByName(
"BTC-USD",
CandlestickInterval.OneMinute,
Date.now() - 60 * 60 * 1000,
Date.now()
);
```
### 
[​
](#account-views)
Account views
Copy
Ask AI
```
const addr = "0x...owner";
const overview = await read.accountOverview.getByAddr(addr);
const subs = await read.userSubaccounts.getByOwner(addr);
```
### 
[​
](#user-positions)
User positions
Copy
Ask AI
```
const subAddr = "0x....subaccount";
const stopPositions = read.userPositions.subscribeByAddr(subAddr, (data) => {
data.positions.forEach((position) => {
console.log("Position delta", position.market_name, position.open_size);
});
});
// Stop streaming for this subaccount
stopPositions();
```
## 
[​
](#notes)
Notes
-   For raw REST/WS endpoints, see the API Reference tabs.
[Configuration](/typescript-sdk/configuration)[Write SDK](/typescript-sdk/write-sdk)
⌘I