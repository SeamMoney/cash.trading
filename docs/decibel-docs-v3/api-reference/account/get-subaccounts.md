---
title: "Get subaccounts"
url: "https://docs.decibel.trade/api-reference/account/get-subaccounts"
scraped: "2026-02-03T21:43:31.379Z"
---

# Get subaccounts

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account
Get subaccounts
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
subaccounts
Try it
Get subaccounts
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/subaccounts
```
200
Copy
Ask AI
```
[
{
"is_active": true,
"is_primary": true,
"primary_account_address": "0x123...",
"subaccount_address": "0x123...",
"custom_label": "My Subaccount"
}
]
```
#### Query Parameters
[​
](#parameter-owner)
owner
string
required
Owner account address
#### Response
200
application/json
Subaccounts retrieved successfully
[​
](#response-items-is-active)
is\_active
boolean
required
[​
](#response-items-is-primary)
is\_primary
boolean
required
Example:
`true`
[​
](#response-items-primary-account-address)
primary\_account\_address
string
required
Example:
`"0x123..."`
[​
](#response-items-subaccount-address)
subaccount\_address
string
required
Example:
`"0x123..."`
[​
](#response-items-custom-label-one-of-0)
custom\_label
string | null
Example:
`"My Subaccount"`
[Get user order history](/api-reference/account/get-user-order-history)[Get user trade history](/api-reference/account/get-user-trade-history)
⌘I