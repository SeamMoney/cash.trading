---
title: "Get user funding rate history"
url: "https://docs.decibel.trade/api-reference/account/get-user-funding-rate-history"
scraped: "2026-02-03T21:43:31.867Z"
---

# Get user funding rate history

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account
Get user funding rate history
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
funding\_rate\_history
Try it
Get user funding rate history
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/funding_rate_history
```
200
Copy
Ask AI
```
{
"items": [
{
"action": "Close Long",
"fee_amount": 123,
"is_funding_positive": true,
"is_rebate": true,
"market": "0xmarket123...",
"realized_funding_amount": 123,
"size": 1,
"transaction_unix_ms": 1735758000000
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
[​
](#parameter-pagination)
pagination
object
required
Pagination parameters (limit and offset)
Show child attributes
#### Response
200
application/json
Funding rate history retrieved successfully
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
[Get account positions](/api-reference/account/get-account-positions)[Get account's open orders](/api-reference/account/get-accounts-open-orders)
⌘I