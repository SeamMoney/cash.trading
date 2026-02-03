---
title: "Get apiv1orders"
url: "https://docs.decibel.trade/api-reference/user/get-apiv1orders"
scraped: "2026-02-03T21:43:43.639Z"
---

# Get apiv1orders

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
User
Get apiv1orders
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
orders
Try it
cURL
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/orders
```
200
Cancelled
Copy
Ask AI
```
{  "status": "Cancelled",  "details": "IOC Violation",  "order": {    "parent": "0x0000000000000000000000000000000000000000000000000000000000000000",    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "client_order_id": "",    "order_id": "45679",    "status": "Cancelled",    "order_type": "Market",    "trigger_condition": "None",    "order_direction": "Close Short",    "orig_size": 2,    "remaining_size": 0,    "size_delta": null,    "price": 49500,    "is_buy": false,    "is_reduce_only": false,    "details": "IOC Violation",    "tp_order_id": null,    "tp_trigger_price": null,    "tp_limit_price": null,    "sl_order_id": null,    "sl_trigger_price": null,    "sl_limit_price": null,    "transaction_version": 12345680,    "unix_ms": 1699565000000  }}
```
#### Query Parameters
[​
](#parameter-market)
market
string
required
Market address
[​
](#parameter-account)
account
string
required
Account address
[​
](#parameter-order-id)
order\_id
string
Order ID (provide either this or client\_order\_id)
[​
](#parameter-client-order-id)
client\_order\_id
string
Client order ID (provide either this or order\_id)
#### Response
200 - application/json
Order details retrieved successfully
[​
](#response-details)
details
string
required
[​
](#response-order)
order
object
required
Show child attributes
[​
](#response-status)
status
string
required
[Get delegations](/api-reference/user/get-delegations)[Get user fund history (deprecated)](/api-reference/user/get-user-fund-history-deprecated)
⌘I