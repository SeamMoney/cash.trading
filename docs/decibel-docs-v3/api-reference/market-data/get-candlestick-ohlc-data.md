---
title: "Get candlestick (OHLC) data"
url: "https://docs.decibel.trade/api-reference/market-data/get-candlestick-ohlc-data"
scraped: "2026-02-03T21:43:36.775Z"
---

# Get candlestick (OHLC) data

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Market Data
Get candlestick (OHLC) data
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
candlesticks
Try it
Get candlestick (OHLC) data
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/candlesticks
```
200
Copy
Ask AI
```
[
{
"T": 1761591599999,
"c": 100,
"h": 102,
"i": "1h",
"l": 98,
"o": 100,
"t": 1761588000000,
"v": 1000
}
]
```
#### Query Parameters
[​
](#parameter-market)
market
string
required
Market address
[​
](#parameter-start-time)
startTime
integer<int64>
required
Start time in milliseconds
[​
](#parameter-end-time)
endTime
integer<int64>
required
End time in milliseconds
#### Response
200
application/json
Candlestick data retrieved successfully
[​
](#response-itemst)
T
integer<int64>
required
Example:
`1761591599999`
[​
](#response-items-c)
c
number<double>
required
Example:
`100`
[​
](#response-items-h)
h
number<double>
required
Example:
`102`
[​
](#response-items-i)
i
string
required
Example:
`"1h"`
[​
](#response-items-l)
l
number<double>
required
Example:
`98`
[​
](#response-items-o)
o
number<double>
required
Example:
`100`
[​
](#response-itemst)
t
integer<int64>
required
Example:
`1761588000000`
[​
](#response-items-v)
v
number<double>
required
Example:
`1000`
[Get asset contexts](/api-reference/market-data/get-asset-contexts)[Get order book depth](/api-reference/market-data/get-order-book-depth)
⌘I