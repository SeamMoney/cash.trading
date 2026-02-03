---
title: "Get market prices"
url: "https://docs.decibel.trade/api-reference/market-data/get-market-prices"
scraped: "2026-02-03T21:43:37.230Z"
---

# Get market prices

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Market Data
Get market prices
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
prices
Try it
Get market prices
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/prices
```
200
Copy
Ask AI
```
[
{
"funding_rate_bps": 1,
"is_funding_positive": true,
"mark_px": 123,
"market": "0xmarket123...",
"mid_px": 123,
"open_interest": 123,
"oracle_px": 123,
"transaction_unix_ms": 123
}
]
```
#### Query Parameters
[​
](#parameter-market)
market
string
Market address filter (use "all" or omit for all markets)
#### Response
200
application/json
Market prices retrieved successfully
[​
](#response-items-funding-rate-bps)
funding\_rate\_bps
integer<int64>
required
Required range: `x >= 0`
[​
](#response-items-is-funding-positive)
is\_funding\_positive
boolean
required
[​
](#response-items-mark-px)
mark\_px
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
](#response-items-mid-px)
mid\_px
number<double>
required
[​
](#response-items-open-interest)
open\_interest
number<double>
required
[​
](#response-items-oracle-px)
oracle\_px
number<double>
required
[​
](#response-items-transaction-unix-ms)
transaction\_unix\_ms
integer<int64>
required
[Get all available markets](/api-reference/market-data/get-all-available-markets)[Get trades](/api-reference/market-data/get-trades)
⌘I