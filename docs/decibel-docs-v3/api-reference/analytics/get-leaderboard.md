---
title: "Get leaderboard"
url: "https://docs.decibel.trade/api-reference/analytics/get-leaderboard"
scraped: "2026-02-03T21:43:33.288Z"
---

# Get leaderboard

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Analytics
Get leaderboard
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
leaderboard
Try it
Get leaderboard
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/leaderboard
```
200
Copy
Ask AI
```
{
"items": [
{
"account": "<string>",
"account_value": 123,
"rank": 1,
"realized_pnl": 123,
"roi": 123,
"volume": 123
}
],
"total_count": 1
}
```
#### Query Parameters
[​
](#parameter-pagination)
pagination
object
required
Show child attributes
[​
](#parameter-sorting)
sorting
object
required
Generic sorting parameters
Show child attributes
[​
](#parameter-search-term)
search\_term
string
Optional search term to filter accounts by account address prefix
#### Response
200
application/json
Paginated leaderboard entries with rankings
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
[Get bulk orders](/api-reference/bulk-orders/get-bulk-orders)[Get portfolio chart data](/api-reference/analytics/get-portfolio-chart-data)
⌘I