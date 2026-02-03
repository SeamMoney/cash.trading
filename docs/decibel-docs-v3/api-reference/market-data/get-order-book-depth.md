---
title: "Get order book depth"
url: "https://docs.decibel.trade/api-reference/market-data/get-order-book-depth"
scraped: "2026-02-03T21:43:37.770Z"
---

# Get order book depth

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Market Data
Get order book depth
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
depth
Try it
Get order book depth
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/depth
```
200
Copy
Ask AI
```
{
"asks": [
{
"price": 123,
"size": 123
}
],
"bids": [
{
"price": 123,
"size": 123
}
],
"market": "0xmarket123...",
"unix_ms": 1699564800000
}
```
#### Query Parameters
[​
](#parameter-market)
market
string
required
Market address
[​
](#parameter-limit)
limit
integer<int32>
default:100
Maximum number of price levels to return per side
Required range: `x >= 0`
#### Response
200
application/json
Order book depth retrieved successfully
[​
](#response-asks)
asks
object\[\]
required
Show child attributes
[​
](#response-bids)
bids
object\[\]
required
Show child attributes
[​
](#response-market)
market
string
required
Example:
`"0xmarket123..."`
[​
](#response-unix-ms)
unix\_ms
integer<int64>
required
Latest transaction timestamp in milliseconds across all contributing depth levels
Example:
`1699564800000`
[Get candlestick (OHLC) data](/api-reference/market-data/get-candlestick-ohlc-data)[Get all available markets](/api-reference/market-data/get-all-available-markets)
⌘I