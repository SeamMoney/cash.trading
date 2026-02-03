---
title: "Get DLP balance for a user"
url: "https://docs.decibel.trade/api-reference/predeposit-points/get-dlp-balance-for-a-user"
scraped: "2026-02-03T21:43:39.248Z"
---

# Get DLP balance for a user

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Predeposit Points
Get DLP balance for a user
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
predeposits
/
positions
/
dlp
Try it
Get DLP balance for a user
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/predeposits/positions/dlp
```
200
Copy
Ask AI
```
{
"account": "<string>",
"balance": "<string>"
}
```
#### Query Parameters
[​
](#parameter-account)
account
string
required
Account address
#### Response
200
application/json
DLP balance
DLP balance response DTO
[​
](#response-account)
account
string
required
User's Aptos address
[​
](#response-balance)
balance
string
required
Current DLP balance as decimal string
[Get current predeposit points for a user](/api-reference/predeposit-points/get-current-predeposit-points-for-a-user)[Get UA positions for a user (non-zero balances only) Computed on-demand from predeposit\_balance\_events](/api-reference/predeposit-points/get-ua-positions-for-a-user-non-zero-balances-onlycomputed-on-demand-from-predeposit_balance_events)
⌘I