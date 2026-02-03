---
title: "Get user positions (deprecated)"
url: "https://docs.decibel.trade/api-reference/user/get-user-positions-deprecated"
scraped: "2026-02-03T21:43:45.700Z"
---

# Get user positions (deprecated)

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
User
Get user positions (deprecated)
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
user\_positions
Try it
Get user positions (deprecated)
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/user_positions
```
200
Copy
Ask AI
```
[
{
"entry_price": 123,
"estimated_liquidation_price": 123,
"has_fixed_sized_tpsls": true,
"is_deleted": true,
"is_isolated": true,
"market": "<string>",
"size": 123,
"transaction_version": 1,
"unrealized_funding": 123,
"user": "<string>",
"user_leverage": 1,
"sl_limit_price": 123,
"sl_order_id": "<string>",
"sl_trigger_price": 123,
"tp_limit_price": 123,
"tp_order_id": "<string>",
"tp_trigger_price": 123
}
]
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
Account address
[​
](#parameter-limit)
limit
integer<int32>
default:500
Maximum number of positions to return
Required range: `x >= 0`
[​
](#parameter-include-deleted)
include\_deleted
boolean
Include deleted positions
[​
](#parameter-market-address)
market\_address
string
Filter by specific market address
#### Response
200
application/json
User positions retrieved successfully
[​
](#response-items-entry-price)
entry\_price
number<double>
required
[​
](#response-items-estimated-liquidation-price)
estimated\_liquidation\_price
number<double>
required
[​
](#response-items-has-fixed-sized-tpsls)
has\_fixed\_sized\_tpsls
boolean
required
[​
](#response-items-is-deleted)
is\_deleted
boolean
required
[​
](#response-items-is-isolated)
is\_isolated
boolean
required
[​
](#response-items-market)
market
string
required
[​
](#response-items-size)
size
number<double>
required
[​
](#response-items-transaction-version)
transaction\_version
integer<int64>
required
Required range: `x >= 0`
[​
](#response-items-unrealized-funding)
unrealized\_funding
number<double>
required
[​
](#response-items-user)
user
string
required
[​
](#response-items-user-leverage)
user\_leverage
integer<int32>
required
Required range: `x >= 0`
[​
](#response-items-sl-limit-price-one-of-0)
sl\_limit\_price
number<double> | null
[​
](#response-items-sl-order-id-one-of-0)
sl\_order\_id
string | null
[​
](#response-items-sl-trigger-price-one-of-0)
sl\_trigger\_price
number<double> | null
[​
](#response-items-tp-limit-price-one-of-0)
tp\_limit\_price
number<double> | null
[​
](#response-items-tp-order-id-one-of-0)
tp\_order\_id
string | null
[​
](#response-items-tp-trigger-price-one-of-0)
tp\_trigger\_price
number<double> | null
[Get user fund history (deprecated)](/api-reference/user/get-user-fund-history-deprecated)[Get account overview](/api-reference/account/get-account-overview)
⌘I