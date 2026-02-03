---
title: "Get user fund history (deposits and withdrawals)"
url: "https://docs.decibel.trade/api-reference/user/get-user-fund-history-deposits-and-withdrawals"
scraped: "2026-02-03T21:43:44.679Z"
---

# Get user fund history (deposits and withdrawals)

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
User
Get user fund history (deposits and withdrawals)
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
account\_fund\_history
Try it
Get user fund history (deposits and withdrawals)
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/account_fund_history
```
200
Copy
Ask AI
```
{
"funds": [
{
"amount": 1000,
"balance_after": 5000,
"movement_type": "deposit",
"timestamp": 1703318400000,
"transaction_version": 12345678
}
],
"total": 1
}
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
Account address
[​
](#parameter-pagination)
pagination
object
required
Show child attributes
#### Response
200
application/json
Fund history retrieved successfully
[​
](#response-funds)
funds
object\[\]
required
Show child attributes
[​
](#response-total)
total
integer<int64>
required
Required range: `x >= 0`
[Get delegations](/api-reference/user/get-delegations)
⌘I