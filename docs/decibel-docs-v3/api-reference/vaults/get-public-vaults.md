---
title: "Get public vaults"
url: "https://docs.decibel.trade/api-reference/vaults/get-public-vaults"
scraped: "2026-02-03T21:43:47.151Z"
---

# Get public vaults

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Vaults
Get public vaults
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
vaults
Try it
Get public vaults
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/vaults
```
200
Copy
Ask AI
```
{
"items": [
{
"address": "<string>",
"created_at": 123,
"manager": "<string>",
"name": "<string>",
"status": "<string>",
"all_time_pnl": 123,
"all_time_return": 123,
"average_leverage": 123,
"depositors": 123,
"description": "<string>",
"manager_cash_pct": 123,
"max_drawdown": 123,
"net_deposits": 30277044.96,
"past_month_return": 123,
"perp_equity": 123,
"pnl_90d": 123,
"profit_share": 123,
"sharpe_ratio": 123,
"social_links": [
"<string>"
],
"tvl": 123,
"vault_type": "<string>",
"volume": 123,
"volume_30d": 123,
"weekly_win_rate_12w": 123
}
],
"total_count": 1,
"total_value_locked": 123,
"total_volume": 123
}
```
#### Query Parameters
[​
](#parameter-status)
status
string
Vault status filter (active, etc.)
[​
](#parameter-vault-type)
vault\_type
string
Vault type filter ('user' or 'protocol'). If not provided, returns all vaults.
[​
](#parameter-vault-address)
vault\_address
string
Vault address filter. If provided, returns only the vault with this address.
[​
](#parameter-search)
search
string
Search filter. If provided, filters vaults by vault address, vault name, or manager address (case-insensitive).
#### Response
200
application/json
Public vaults retrieved successfully
[​
](#response-items)
items
object\[\]
required
Show child attributes
[​
](#response-total-count)
total\_count
integer<int32>
required
Required range: `x >= 0`
[​
](#response-total-value-locked)
total\_value\_locked
number<double>
required
Total value locked across all filtered vaults
[​
](#response-total-volume)
total\_volume
number<double>
required
Total all-time trading volume across all filtered vaults
[Get user vault performance (deprecated)](/api-reference/vaults/get-user-vault-performance-deprecated)[Get active TWAP orders](/api-reference/twap/get-active-twap-orders)
⌘I