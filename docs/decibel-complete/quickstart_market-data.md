---
source: https://docs.decibel.trade/quickstart/market-data
title: market data
scraped: 2025-11-28T01:20:48.658Z
---

Quick Start: Market Data - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationGetting StartedQuick Start: Market Data[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Getting Started

- [🎧 Welcome to Decibel](/quickstart/overview)
- [Quick Start: Market Data](/quickstart/market-data)
- [Quick Start:  Authenticated Requests](/quickstart/authenticated-requests)
- [Quick Start: API Reference](/quickstart/api-reference)
- [Quick Start: Placing Your First Order](/quickstart/placing-your-first-order)

On this page
- [Step 1: Get Available Markets](#step-1:-get-available-markets)
- [Step 2: Get Market Details](#step-2:-get-market-details)
- [Step 3: Get Order Book Data](#step-3:-get-order-book-data)
- [Step 4: Get Recent Trades](#step-4:-get-recent-trades)

Getting Started# Quick Start: Market Data

Copy pageLearn how to send unauthenticated requests to access public market data

Copy pageThe Decibel API base URL is:
CopyAsk AI```
https://api.netna.aptoslabs.com/decibel

```

**Note about the API URL:** The base URL
`https://api.netna.aptoslabs.com/decibel` provides access to all Decibel
markets and trading functionality. This includes perpetual futures markets,
spot markets, and more.
**No authentication required:** The endpoints in this guide are public and
don’t require authentication headers. You can start making requests
immediately!
## [​](#step-1:-get-available-markets)Step 1: Get Available Markets

Let’s start by fetching the list of available markets. We’ll use the Get Markets endpoint to retrieve all active trading markets.
PythonJavaScriptcURLCopyAsk AI```
import requests

# Make a GET request to the markets endpoint

response = requests.get('https://api.netna.aptoslabs.com/decibel/api/v1/markets')

# Check if the request was successful

if response.status_code == 200:
markets = response.json()
print(f"Found {len(markets)} markets")
for market in markets[:5]: # Print first 5 markets
print(f"- {market.get('symbol', 'N/A')}: {market.get('name', 'N/A')}")
else:
print(f"Error: {response.status_code}")
print(response.text)

```

## [​](#step-2:-get-market-details)Step 2: Get Market Details

Once you have a list of markets, you can fetch detailed information about a specific market, including its current price, order book depth, and trading statistics.
PythonJavaScriptcURLCopyAsk AI```
import requests

# Replace 'BTC-PERP' with an actual market symbol from Step 1

market_symbol = 'BTC-PERP'

# Get market details

response = requests.get(f'https://api.netna.aptoslabs.com/decibel/api/v1/markets/{market_symbol}')

if response.status_code == 200:
market = response.json()
print(f"Market: {market.get('symbol')}")
print(f"Last Price: {market.get('lastPrice', 'N/A')}")
print(f"24h Volume: {market.get('volume24h', 'N/A')}")
print(f"24h High: {market.get('high24h', 'N/A')}")
print(f"24h Low: {market.get('low24h', 'N/A')}")
else:
print(f"Error: {response.status_code}")
print(response.text)

```

## [​](#step-3:-get-order-book-data)Step 3: Get Order Book Data

Now let’s retrieve the order book for a market, which shows the current buy and sell orders with their prices and sizes.
PythonJavaScriptcURLCopyAsk AI```
import requests

market_symbol = 'BTC-PERP'

# Get order book (depth)

response = requests.get(
f'https://api.netna.aptoslabs.com/decibel/api/v1/markets/{market_symbol}/orderbook',
params={'depth': 10} # Get top 10 bids and asks
)

if response.status_code == 200:
orderbook = response.json()
print(f"Bids (Buy Orders):")
for bid in orderbook.get('bids', [])[:5]:
print(f" Price: {bid['price']}, Size: {bid['size']}")

    print(f"\nAsks (Sell Orders):")
    for ask in orderbook.get('asks', [])[:5]:
      print(f"  Price: {ask['price']}, Size: {ask['size']}")

else:
print(f"Error: {response.status_code}")

```

## [​](#step-4:-get-recent-trades)Step 4: Get Recent Trades

Finally, let’s fetch recent trades for a market to see the latest trading activity.
PythonJavaScriptcURLCopyAsk AI```
import requests

market_symbol = 'BTC-PERP'

# Get recent trades

response = requests.get(
f'https://api.netna.aptoslabs.com/decibel/api/v1/markets/{market_symbol}/trades',
params={'limit': 10} # Get last 10 trades
)

if response.status_code == 200:
trades = response.json()
print(f"Recent Trades:")
for trade in trades:
print(f" Price: {trade.get('price')}, Size: {trade.get('size')}, "
f"Side: {trade.get('side')}, Time: {trade.get('timestamp')}")
else:
print(f"Error: {response.status_code}")

```

[🎧 Welcome to Decibel](/quickstart/overview)[Quick Start:  Authenticated Requests](/quickstart/authenticated-requests)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)