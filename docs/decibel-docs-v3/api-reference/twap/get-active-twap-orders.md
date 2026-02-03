---
title: "Get active TWAP orders"
url: "https://docs.decibel.trade/api-reference/twap/get-active-twap-orders"
scraped: "2026-02-03T21:43:42.661Z"
---

# Get active TWAP orders

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
TWAP
Get active TWAP orders
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
active\_twaps
Try it
Get active TWAP orders
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/active_twaps
```
200
Copy
Ask AI
```
[
{
"client_order_id": "client_order_123",
"duration_s": 300,
"frequency_s": 30,
"is_buy": true,
"is_reduce_only": true,
"market": "0xmarket123...",
"order_id": "<string>",
"orig_size": 123,
"remaining_size": 123,
"start_unix_ms": 1730841600000,
"status": "<string>",
"transaction_unix_ms": 123,
"transaction_version": 1
}
]
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
User account address
[​
](#parameter-limit)
limit
integer<int32>
default:10
Maximum number of active TWAPs to return
Required range: `x >= 0`
#### Response
200
application/json
Active TWAPs retrieved successfully
[​
](#response-items-client-order-id)
client\_order\_id
string
required
Example:
`"client_order_123"`
[​
](#response-items-durations)
duration\_s
integer<int64>
required
Required range: `x >= 0`
Example:
`300`
[​
](#response-items-frequencys)
frequency\_s
integer<int64>
required
Required range: `x >= 0`
Example:
`30`
[​
](#response-items-is-buy)
is\_buy
boolean
required
Example:
`true`
[​
](#response-items-is-reduce-only)
is\_reduce\_only
boolean
required
[​
](#response-items-market)
market
string
required
Example:
`"0xmarket123..."`
[​
](#response-items-order-id)
order\_id
string
required
[​
](#response-items-orig-size)
orig\_size
number<double>
required
[​
](#response-items-remaining-size)
remaining\_size
number<double>
required
[​
](#response-items-start-unix-ms)
start\_unix\_ms
integer<int64>
required
Example:
`1730841600000`
[​
](#response-items-status)
status
string
required
[​
](#response-items-transaction-unix-ms)
transaction\_unix\_ms
integer<int64>
required
[​
](#response-items-transaction-version)
transaction\_version
integer<int64>
required
Required range: `x >= 0`
[Get public vaults](/api-reference/vaults/get-public-vaults)[Get TWAP order history](/api-reference/twap/get-twap-order-history)
⌘I