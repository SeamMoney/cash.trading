---
title: "Get all available markets"
url: "https://docs.decibel.trade/api-reference/market-data/get-all-available-markets"
scraped: "2026-02-03T21:43:35.783Z"
---

# Get all available markets

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Market Data
Get all available markets
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
markets
Try it
Get all available markets
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/markets
```
200
Copy
Ask AI
```
[
{
"lot_size": 1,
"market_addr": "<string>",
"market_name": "<string>",
"max_leverage": 1,
"max_open_interest": 123,
"min_size": 1,
"mode": "<string>",
"px_decimals": 1,
"sz_decimals": 1,
"tick_size": 1,
"unrealized_pnl_haircut_bps": 1
}
]
```
#### Response
200
application/json
List of available markets
[​
](#response-items-lot-size)
lot\_size
integer<int64>
required
Required range: `x >= 0`
[​
](#response-items-market-addr)
market\_addr
string
required
[​
](#response-items-market-name)
market\_name
string
required
[​
](#response-items-max-leverage)
max\_leverage
integer<int32>
required
Required range: `x >= 0`
[​
](#response-items-max-open-interest)
max\_open\_interest
number<double>
required
[​
](#response-items-min-size)
min\_size
integer<int64>
required
Required range: `x >= 0`
[​
](#response-items-mode)
mode
string
required
[​
](#response-items-px-decimals)
px\_decimals
integer<int32>
required
Required range: `x >= 0`
[​
](#response-items-sz-decimals)
sz\_decimals
integer<int32>
required
Required range: `x >= 0`
[​
](#response-items-tick-size)
tick\_size
integer<int64>
required
Required range: `x >= 0`
[​
](#response-items-unrealized-pnl-haircut-bps)
unrealized\_pnl\_haircut\_bps
integer<int32>
required
Haircut for unrealized PnL when calculating withdrawable balance (in basis points, e.g., 1000 = 10%)
Required range: `x >= 0`
[Get order book depth](/api-reference/market-data/get-order-book-depth)[Get market prices](/api-reference/market-data/get-market-prices)
⌘I