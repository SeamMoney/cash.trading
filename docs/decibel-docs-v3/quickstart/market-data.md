---
title: "Market Data"
url: "https://docs.decibel.trade/quickstart/market-data"
scraped: "2026-02-03T21:44:00.668Z"
---

# Market Data

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Market Data
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#base-urls)
Base URLs
Decibel API supports two environments: **Netna:**
Copy
Ask AI
```
https://api.netna.aptoslabs.com/decibel
```
**Testnet:**
Copy
Ask AI
```
https://api.testnet.aptoslabs.com/decibel
```
**Note about the API URL:** The base URLs provide access to all Decibel markets and trading functionality. This includes perpetual futures markets, spot markets, and more.
## 
[​
](#package-addresses)
Package Addresses
Each environment has its own package address: **Netna Package Address:**
Copy
Ask AI
```
0xb8a5788314451ce4d2fbbad32e1bad88d4184b73943b7fe5166eab93cf1a5a95
```
**Testnet Package Address:**
Copy
Ask AI
```
0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88
```
**No authentication required:** The endpoints in this guide are public and don’t require authentication headers like OAuth or JWT. However, you **do** still need a Decibel **Node API key** to access the node; simply pass it as the `Authorization` header on your requests, in the format:  
`Authorization: Bearer <NODE_API_KEY>`
**Base URL Variable:** In the code examples below, `BASE_URL` refers to either: - `https://api.netna.aptoslabs.com/decibel` for Netna - `https://api.testnet.aptoslabs.com/decibel` for Testnet Make sure to set this variable in your code before making requests.
## 
[​
](#step-1-get-available-markets)
Step 1: Get Available Markets
Let’s start by fetching the list of available markets. We’ll use the Get Markets endpoint to retrieve all active trading markets.
Python
JavaScript
cURL
Copy
Ask AI
```
import requests
NODE_API_KEY = "YOUR_NODE_API_KEY"
headers = {"Authorization": f"Bearer {NODE_API_KEY}"}
# Make a GET request to the markets endpoint
response = requests.get(f"{BASE_URL}/api/v1/markets", headers=headers)
# Check if the request was successful
if response.status_code == 200:
markets = response.json()
print(f"Found {len(markets)} markets") # Print first 5 markets
for market in markets[:5]:
print(f"- {market.get('symbol', 'N/A')}: {market.get('name', 'N/A')}")
else:
print(f"Error: {response.status_code}")
print(response.text)
```
## 
[​
](#step-2-get-market-details)
Step 2: Get Market Details
Once you have a list of markets, you can fetch detailed information about a specific market, including its current price, order book depth, and trading statistics.
Python
JavaScript
cURL
Copy
Ask AI
```
import requests
NODE_API_KEY = "YOUR_NODE_API_KEY"
headers = {"Authorization": f"Bearer {NODE_API_KEY}"}
# Replace 'BTC-PERP' with an actual market symbol from Step 1
market_symbol = "BTC-PERP"
# Get market details
response = requests.get(f"{BASE_URL}/api/v1/markets/{market_symbol}", headers=headers)
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
## 
[​
](#step-3-get-order-book-data)
Step 3: Get Order Book Data
Now let’s retrieve the order book for a market, which shows the current buy and sell orders with their prices and sizes.
Python
JavaScript
cURL
Copy
Ask AI
```
import requests
NODE_API_KEY = "YOUR_NODE_API_KEY"
headers = {"Authorization": f"Bearer {NODE_API_KEY}"}
market_symbol = "BTC-PERP"
# Get order book (depth)
response = requests.get(
f"{BASE_URL}/api/v1/markets/{market_symbol}/orderbook",
params={"depth": 10}, # Get top 10 bids and asks
headers=headers,
)
if response.status_code == 200:
orderbook = response.json()
print("Bids (Buy Orders):")
for bid in orderbook.get("bids", [])[:5]:
print(f" Price: {bid['price']}, Size: {bid['size']}")
print("\nAsks (Sell Orders):")
for ask in orderbook.get("asks", [])[:5]:
print(f"  Price: {ask['price']}, Size: {ask['size']}")
else:
print(f"Error: {response.status_code}")
```
## 
[​
](#step-4-get-recent-trades)
Step 4: Get Recent Trades
Finally, let’s fetch recent trades for a market to see the latest trading activity.
Python
JavaScript
cURL
Copy
Ask AI
```
import requests
NODE_API_KEY = "YOUR_NODE_API_KEY"
headers = {"Authorization": f"Bearer {NODE_API_KEY}"}
market_symbol = "BTC-PERP"
# Get recent trades
response = requests.get(
f"{BASE_URL}/api/v1/markets/{market_symbol}/trades",
params={"limit": 10}, # Get last 10 trades
headers=headers,
)
if response.status_code == 200:
trades = response.json()
print("Recent Trades:")
for trade in trades:
print(
f" Price: {trade.get('price')}, Size: {trade.get('size')}, "
f"Side: {trade.get('side')}, Time: {trade.get('timestamp')}"
)
else:
print(f"Error: {response.status_code}")
```
[Client API Key Setup](/quickstart/node-api-key)[Authenticated Requests](/quickstart/authenticated-requests)
⌘I