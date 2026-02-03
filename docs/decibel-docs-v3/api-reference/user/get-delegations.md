---
title: "Get delegations"
url: "https://docs.decibel.trade/api-reference/user/get-delegations"
scraped: "2026-02-03T21:43:44.162Z"
---

# Get delegations

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
User
Get delegations
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
delegations
Try it
Get delegations
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/delegations
```
200
Copy
Ask AI
```
[
{
"delegated_account": "0x123...",
"permission_type": "TradePerpsAllMarkets",
"expiration_time_s": 1736326800000
}
]
```
#### Query Parameters
[​
](#parameter-subaccount)
subaccount
string
required
Subaccount address
#### Response
200
application/json
Delegations retrieved successfully
[​
](#response-items-delegated-account)
delegated\_account
string
required
The address of the delegated account
Example:
`"0x123..."`
[​
](#response-items-permission-type)
permission\_type
string
required
The permission type that was granted
Example:
`"TradePerpsAllMarkets"`
[​
](#response-items-expiration-times-one-of-0)
expiration\_time\_s
integer<int64> | null
The expiration time in seconds (optional, None means no expiration)
Required range: `x >= 0`
Example:
`1736326800000`
[Get user fund history (deposits and withdrawals)](/api-reference/user/get-user-fund-history-deposits-and-withdrawals)[Get apiv1orders](/api-reference/user/get-apiv1orders)
⌘I