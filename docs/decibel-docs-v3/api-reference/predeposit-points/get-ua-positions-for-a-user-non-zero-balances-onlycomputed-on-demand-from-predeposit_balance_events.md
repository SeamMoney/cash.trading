---
title: "Get UA positions for a user (non-zero balances only)
Computed on-demand from predeposit_balance_events"
url: "https://docs.decibel.trade/api-reference/predeposit-points/get-ua-positions-for-a-user-non-zero-balances-onlycomputed-on-demand-from-predeposit_balance_events"
scraped: "2026-02-03T21:43:40.722Z"
---

# Get UA positions for a user (non-zero balances only)
Computed on-demand from predeposit_balance_events

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Predeposit Points
Get UA positions for a user (non-zero balances only) Computed on-demand from predeposit\_balance\_events
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
ua
Try it
Get UA positions for a user (non-zero balances only) Computed on-demand from predeposit\_balance\_events
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/predeposits/positions/ua
```
200
Copy
Ask AI
```
[
{
"balance": "<string>",
"deposit_index": 1
}
]
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
List of UA positions
[​
](#response-items-balance)
balance
string
required
Current balance as decimal string
[​
](#response-items-deposit-index)
deposit\_index
integer<int64>
required
Deposit index (FIFO position identifier)
Required range: `x >= 0`
[Get DLP balance for a user](/api-reference/predeposit-points/get-dlp-balance-for-a-user)[Get total predeposit points and deposited amount across all users (Season 0)](/api-reference/predeposit-points/get-total-predeposit-points-and-deposited-amount-across-all-users-season-0)
⌘I