---
title: "Get user order history"
url: "https://docs.decibel.trade/api-reference/account/get-user-order-history"
scraped: "2026-02-03T21:43:32.368Z"
---

# Get user order history

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account
Get user order history
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
order\_history
Try it
Get user order history
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/order_history
```
200
Copy
Ask AI
```
{
"items": [
{
"client_order_id": "<string>",
"details": "<string>",
"is_buy": true,
"is_reduce_only": true,
"market": "<string>",
"order_direction": "<string>",
"order_id": "<string>",
"order_type": "<string>",
"parent": "<string>",
"status": "<string>",
"transaction_version": 1,
"trigger_condition": "<string>",
"unix_ms": 1,
"orig_size": 123,
"price": 123,
"remaining_size": 123,
"size_delta": 123,
"sl_limit_price": 123,
"sl_order_id": "<string>",
"sl_trigger_price": 123,
"tp_limit_price": 123,
"tp_order_id": "<string>",
"tp_trigger_price": 123
}
],
"total_count": 1
}
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
User account address
#### Response
200
application/json
Order history retrieved successfully
[​
](#response-items)
items
object\[\]
required
The items in the current page
Show child attributes
[​
](#response-total-count)
total\_count
integer<int32>
required
The total number of items across all pages
Required range: `x >= 0`
[Get account's open orders](/api-reference/account/get-accounts-open-orders)[Get subaccounts](/api-reference/account/get-subaccounts)
⌘I