---
title: "Get total predeposit points and deposited amount across all users (Season 0)"
url: "https://docs.decibel.trade/api-reference/predeposit-points/get-total-predeposit-points-and-deposited-amount-across-all-users-season-0"
scraped: "2026-02-03T21:43:40.266Z"
---

# Get total predeposit points and deposited amount across all users (Season 0)

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Predeposit Points
Get total predeposit points and deposited amount across all users (Season 0)
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
predeposits
/
totals
Try it
Get total predeposit points and deposited amount across all users (Season 0)
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/predeposits/totals
```
200
Copy
Ask AI
```
{
"total_deposited_amount": "<string>",
"total_points": 123
}
```
#### Response
200
application/json
Season 0 totals
Predeposit totals response DTO (Season 0)
[​
](#response-total-deposited-amount)
total\_deposited\_amount
string
required
Total deposited amount across all users (USDC base units, 6 decimals)
[​
](#response-total-points)
total\_points
number<double>
required
Total season 0 reward points distributed across all users
[Get UA positions for a user (non-zero balances only) Computed on-demand from predeposit\_balance\_events](/api-reference/predeposit-points/get-ua-positions-for-a-user-non-zero-balances-onlycomputed-on-demand-from-predeposit_balance_events)[Handler to get referral info for an account (who referred them)](/api-reference/referrals/handler-to-get-referral-info-for-an-account-who-referred-them)
⌘I