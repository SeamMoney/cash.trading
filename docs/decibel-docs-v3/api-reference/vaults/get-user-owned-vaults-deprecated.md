---
title: "Get user-owned vaults (deprecated)"
url: "https://docs.decibel.trade/api-reference/vaults/get-user-owned-vaults-deprecated"
scraped: "2026-02-03T21:43:47.586Z"
---

# Get user-owned vaults (deprecated)

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Vaults
Get user-owned vaults (deprecated)
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
user\_owned\_vaults
Try it
Get user-owned vaults (deprecated)
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/user_owned_vaults
```
200
Copy
Ask AI
```
{
"items": [
{
"age_days": 123,
"num_managers": 123,
"status": "<string>",
"vault_address": "<string>",
"vault_name": "<string>",
"vault_share_symbol": "<string>",
"apr": 123,
"manager_equity": 123,
"manager_stake": 123,
"tvl": 123
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
Account address
[​
](#parameter-pagination)
pagination
object
required
Pagination parameters
Show child attributes
#### Response
200
application/json
User-owned vaults retrieved successfully
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
[Get account vault performance for all vaults where account has deposits](/api-reference/vaults/get-account-vault-performance-for-all-vaults-where-account-has-deposits)[Get user vault performance (deprecated)](/api-reference/vaults/get-user-vault-performance-deprecated)
⌘I