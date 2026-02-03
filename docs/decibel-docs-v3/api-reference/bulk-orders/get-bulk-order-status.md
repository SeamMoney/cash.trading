---
title: "Get bulk order status"
url: "https://docs.decibel.trade/api-reference/bulk-orders/get-bulk-order-status"
scraped: "2026-02-03T21:43:34.716Z"
---

# Get bulk order status

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Bulk Orders
Get bulk order status
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
bulk\_order\_status
Try it
Get bulk order status
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/bulk_order_status
```
200
NotFound
Copy
Ask AI
```
{  "status": "notFound",  "message": "Bulk order with sequence number {} not found"}
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
User account address
[​
](#parameter-market)
market
string
required
Market address
[​
](#parameter-sequence-number)
sequence\_number
integer<int64>
required
Sequence number of the bulk order
Required range: `x >= 0`
#### Response
200 - application/json
Bulk order status retrieved successfully
[​
](#response-bulk-order)
bulk\_order
object
required
Show child attributes
[​
](#response-details)
details
string
required
[​
](#response-status)
status
string
required
[Get bulk order fills](/api-reference/bulk-orders/get-bulk-order-fills)[Get bulk orders](/api-reference/bulk-orders/get-bulk-orders)
⌘I