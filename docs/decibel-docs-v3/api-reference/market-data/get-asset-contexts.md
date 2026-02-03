---
title: "Get asset contexts"
url: "https://docs.decibel.trade/api-reference/market-data/get-asset-contexts"
scraped: "2026-02-03T21:43:36.234Z"
---

# Get asset contexts

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Market Data
Get asset contexts
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
asset\_contexts
Try it
Get asset contexts
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/asset_contexts
```
200
Copy
Ask AI
```
[
{
"mark_price": 123,
"market": "0xmarket123...",
"mid_price": 123,
"open_interest": 123,
"oracle_price": 123,
"previous_day_price": 123,
"price_change_pct_24h": 123,
"volume_24h": 123
}
]
```
#### Query Parameters
[​
](#parameter-market)
market
string
Filter by specific market address
#### Response
200
application/json
Asset context retrieved successfully
[​
](#response-items-mark-price)
mark\_price
number<double>
required
[​
](#response-items-market)
market
string
required
Example:
`"0xmarket123..."`
[​
](#response-items-mid-price)
mid\_price
number<double>
required
[​
](#response-items-open-interest)
open\_interest
number<double>
required
[​
](#response-items-oracle-price)
oracle\_price
number<double>
required
[​
](#response-items-previous-day-price)
previous\_day\_price
number<double>
required
[​
](#response-items-price-change-pct-24h)
price\_change\_pct\_24h
number<double>
required
[​
](#response-items-volume-24h)
volume\_24h
number<double>
required
[Get TWAP order history](/api-reference/twap/get-twap-order-history)[Get candlestick (OHLC) data](/api-reference/market-data/get-candlestick-ohlc-data)
⌘I