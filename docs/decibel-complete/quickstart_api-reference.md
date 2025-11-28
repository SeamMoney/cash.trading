---
source: https://docs.decibel.trade/quickstart/api-reference
title: api reference
scraped: 2025-11-28T01:20:48.272Z
---

Quick Start: API Reference - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationGetting StartedQuick Start: API Reference[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Getting Started

- [🎧 Welcome to Decibel](/quickstart/overview)
- [Quick Start: Market Data](/quickstart/market-data)
- [Quick Start:  Authenticated Requests](/quickstart/authenticated-requests)
- [Quick Start: API Reference](/quickstart/api-reference)
- [Quick Start: Placing Your First Order](/quickstart/placing-your-first-order)

On this page
- [Welcome to Decibel API](#welcome-to-decibel-api)
- [API Specifications](#api-specifications)
- [Base URLs](#base-urls)
- [Quick Start](#quick-start)
- [REST API Example](#rest-api-example)
- [WebSocket Example](#websocket-example)
- [Features](#features)
- [Documentation Structure](#documentation-structure)

Getting Started# Quick Start: API Reference

Copy pageComplete REST and WebSocket API documentation for Decibel Trading Platform

Copy page## [​](#welcome-to-decibel-api)Welcome to Decibel API

The Decibel Trading Platform provides comprehensive APIs for programmatic trading:
## REST API

Query market data, orders, positions, and account information via HTTP
endpoints (see navigation below)## WebSocket Streams

Real-time updates for prices, order book, trades, and positions.
## [​](#api-specifications)API Specifications

Both APIs are automatically generated from the Rust codebase, ensuring documentation is always up-to-date:

- **OpenAPI 3.1.0** - RESTful HTTP endpoints

- **AsyncAPI 3.0.0** - WebSocket streaming channels

## [​](#base-urls)Base URLs

ProductionCopyAsk AI```
REST:      https://api.netna.aptoslabs.com/decibel
WebSocket: wss://api.netna.aptoslabs.com/decibel

```

## [​](#quick-start)Quick Start

### [​](#rest-api-example)REST API Example

CopyAsk AI```
curl https://api.netna.aptoslabs.com/decibel/api/v1/markets

```

### [​](#websocket-example)WebSocket Example

CopyAsk AI```
const ws = new WebSocket("ws://wss://api.netna.aptoslabs.com/decibel");

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

## [​](#features)Features

Market Data

- Real-time and historical price data

- Order book depth with multiple aggregation levels

- OHLCV candlestick data (1m, 15m, 1h, 4h, 1d)

- Recent trades and volume

Trading

Manage orders (limit, market, stop) - Bulk order submission - TWAP
(Time-Weighted Average Price) orders - Order history and fills

Positions & Account

Real-time position updates - Account equity and PnL - Margin and leverage
information - Funding rate history

WebSocket Topics

Subscribe to 17 different channels:

- User-specific: orders, positions, trades

- Market-specific: prices, depth, candlesticks

- Global: all markets, users with positions

## [​](#documentation-structure)Documentation Structure

The API documentation is organized into tabs:

- **Guides** - Getting started, tutorials, and examples

- **REST API** - All HTTP endpoints (auto-generated from OpenAPI)

- **WebSocket API** - All streaming channels (auto-generated from AsyncAPI)

[Quick Start:  Authenticated Requests](/quickstart/authenticated-requests)[Quick Start: Placing Your First Order](/quickstart/placing-your-first-order)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)