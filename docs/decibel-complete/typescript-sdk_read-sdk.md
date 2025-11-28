---
source: https://docs.decibel.trade/typescript-sdk/read-sdk
title: read sdk
scraped: 2025-11-28T01:20:49.870Z
---

Read SDK - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationGetting StartedRead SDK[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Getting Started

- [TypeScript SDK Overview](/typescript-sdk/overview)
- [Installation](/typescript-sdk/installation)
- [Configuration](/typescript-sdk/configuration)
- [Read SDK](/typescript-sdk/read-sdk)
- [Write SDK](/typescript-sdk/write-sdk)
- [Advanced](/typescript-sdk/advanced)

On this page
- [Purpose](#purpose)
- [When to use](#when-to-use)
- [Initialization](#initialization)
- [Main readers](#main-readers)
- [Examples](#examples)
- [Markets](#markets)
- [Prices and candlesticks](#prices-and-candlesticks)
- [Account views](#account-views)
- [User positions](#user-positions)
- [Notes](#notes)

Getting Started# Read SDK

Copy pageQuery market data, account state, and subscribe to real-time updates

Copy page## [​](#purpose)Purpose

- Fetch market data (prices, depth, trades, candlesticks) and account views (orders, positions, subaccounts).

- Works over REST and Aptos views. No signing or private keys required.

## [​](#when-to-use)When to use

- Use for dashboards, analytics, and read-heavy server/frontend use cases.

- Do not use for submitting transactions; use the Write SDK instead.

## [​](#initialization)Initialization

CopyAsk AI```
import { DecibelReadDex, NETNA_CONFIG } from "@decibel/sdk";

const read = new DecibelReadDex(NETNA_CONFIG, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY, // optional
  onWsError: (e) => console.warn("WS error", e), // optional
});

```

## [​](#main-readers)Main readers

- Markets: `read.markets.getAll()`, `getByName()`

- Prices: `read.marketPrices.getAll()`, `getByName()`, `subscribeByName()`

- Depth: `read.marketDepth.getByName()`

- Trades: `read.marketTrades.getByName()`

- Candlesticks: `read.candlesticks.getByName()`, `subscribeByName()`

Accounts and orders:

- `read.accountOverview.getByAddr()`

- `read.userOpenOrders.getBySubaccount()` / `read.userOrderHistory.getBySubaccount()`

- `read.userPositions.getBySubaccount()`

- `read.userTradeHistory.getBySubaccount()`

- `read.userSubaccounts.getByOwner()`

Portfolio and leaderboard:

- `read.portfolioChart.getByAddr()`

- `read.leaderboard.getTopUsers()`

Vaults and delegations:

- `read.vaults.getUserOwned()` / `getAll()`

- `read.delegations.getForSubaccount()`

## [​](#examples)Examples

### [​](#markets)Markets

CopyAsk AI```
const markets = await read.markets.getAll();
const btc = await read.markets.getByName("BTC-USD");

```

### [​](#prices-and-candlesticks)Prices and candlesticks

CopyAsk AI```
const price = await read.marketPrices.getByName("BTC-USD");

// Subscribe (unsubscribe by calling the returned function)
const unsubscribe = read.marketPrices.subscribeByName("BTC-USD", (msg) => {
  console.log("Price update", msg);
});

// Candlesticks
import { CandlestickInterval } from "@decibel/sdk";
const candles = await read.candlesticks.getByName(
  "BTC-USD",
  CandlestickInterval.OneMinute,
  Date.now() - 60 * 60 * 1000,
  Date.now()
);

```

### [​](#account-views)Account views

CopyAsk AI```
const addr = "0x...owner";
const overview = await read.accountOverview.getByAddr(addr);
const subs = await read.userSubaccounts.getByOwner(addr);

```

### [​](#user-positions)User positions

CopyAsk AI```
const subAddr = "0x....subaccount";

const stopPositions = read.userPositions.subscribeByAddr(subAddr, (data) => {
  data.positions.forEach((position) => {
    console.log("Position delta", position.market_name, position.open_size);
  });
});

// Stop streaming for this subaccount
stopPositions();

```

## [​](#notes)Notes

- For raw REST/WS endpoints, see the API Reference tabs.

[Configuration](/typescript-sdk/configuration)[Write SDK](/typescript-sdk/write-sdk)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)