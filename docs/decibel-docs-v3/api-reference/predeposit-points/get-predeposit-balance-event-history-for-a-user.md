---
title: "Get predeposit balance event history for a user"
url: "https://docs.decibel.trade/api-reference/predeposit-points/get-predeposit-balance-event-history-for-a-user"
scraped: "2026-02-03T21:43:39.793Z"
---

# Get predeposit balance event history for a user

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Predeposit Points
Get predeposit balance event history for a user
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
predeposits
/
history
Try it
Get predeposit balance event history for a user
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/predeposits/history
```
200
Copy
Ask AI
```
{
"items": [
{
"account": "<string>",
"amount_delta": 1,
"deposit_index": 1,
"event_index": 1,
"fund_type": 1,
"kind": "<string>",
"transaction_unix_ms": 123,
"transaction_version": 1,
"tx_hash": "<string>"
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
](#parameter-kind)
kind
string
Event kind filter: deposit, withdraw, or promote
[​
](#parameter-fund-type)
fund\_type
integer<int32>
Fund type filter: 0 = DLP, 1 = UA
Required range: `x >= 0`
[​
](#parameter-start-time)
startTime
integer<int64>
Start time in milliseconds (inclusive)
[​
](#parameter-end-time)
endTime
integer<int64>
End time in milliseconds (inclusive)
#### Response
200
application/json
Predeposit balance event history retrieved successfully
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
[Get portfolio chart data](/api-reference/analytics/get-portfolio-chart-data)[Get current predeposit points for a user](/api-reference/predeposit-points/get-current-predeposit-points-for-a-user)
⌘I