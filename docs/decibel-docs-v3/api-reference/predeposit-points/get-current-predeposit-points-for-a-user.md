---
title: "Get current predeposit points for a user"
url: "https://docs.decibel.trade/api-reference/predeposit-points/get-current-predeposit-points-for-a-user"
scraped: "2026-02-03T21:43:38.774Z"
---

# Get current predeposit points for a user

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Predeposit Points
Get current predeposit points for a user
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
predeposits
/
points
Try it
Get current predeposit points for a user
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/predeposits/points
```
200
Copy
Ask AI
```
{
"account": "<string>",
"points": 123
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
User predeposit points
Predeposit user points response DTO
[​
](#response-account)
account
string
required
User's Aptos address
[​
](#response-points)
points
number<double>
required
Current predeposit reward points
[Get predeposit balance event history for a user](/api-reference/predeposit-points/get-predeposit-balance-event-history-for-a-user)[Get DLP balance for a user](/api-reference/predeposit-points/get-dlp-balance-for-a-user)
⌘I