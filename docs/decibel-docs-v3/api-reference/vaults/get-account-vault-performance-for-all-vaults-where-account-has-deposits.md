---
title: "Get account vault performance for all vaults where account has deposits"
url: "https://docs.decibel.trade/api-reference/vaults/get-account-vault-performance-for-all-vaults-where-account-has-deposits"
scraped: "2026-02-03T21:43:46.664Z"
---

# Get account vault performance for all vaults where account has deposits

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Vaults
Get account vault performance for all vaults where account has deposits
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
account\_vault\_performance
Try it
Get account vault performance for all vaults where account has deposits
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/account_vault_performance
```
200
Copy
Ask AI
```
[
{
"account_address": "<string>",
"vault": {
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
},
"all_time_earned": 123,
"all_time_return": 123,
"current_num_shares": 1,
"current_value_of_shares": 123,
"deposits": [
{
"amount_usdc": 123,
"shares_received": 1,
"timestamp_ms": 123,
"unlock_timestamp_ms": 123
}
],
"locked_amount": 123,
"share_price": 123,
"total_deposited": 123,
"total_withdrawn": 123,
"unrealized_pnl": 123,
"volume": 123,
"weekly_win_rate_12w": 123,
"withdrawals": [
{
"shares_redeemed": 1,
"status": "<string>",
"timestamp_ms": 123,
"amount_usdc": 123
}
]
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
[​
](#parameter-offset)
offset
integer<int64>
default:0
Number of results to skip (for pagination)
Required range: `x >= 0`
[​
](#parameter-limit)
limit
integer<int64>
default:20
Maximum number of results to return
Required range: `x >= 0`
#### Response
200
application/json
Account vault performance retrieved successfully
[​
](#response-items-account-address)
account\_address
string
required
[​
](#response-items-vault)
vault
object
required
Vault object with metadata + metrics
Show child attributes
[​
](#response-items-all-time-earned-one-of-0)
all\_time\_earned
number<double> | null
All-time profit/loss in USDC (includes both realized and unrealized)
[​
](#response-items-all-time-return-one-of-0)
all\_time\_return
number<double> | null
All-time return percentage (includes both realized and unrealized)
[​
](#response-items-current-num-shares-one-of-0)
current\_num\_shares
integer<int64> | null
Number of shares owned (in base units with 6 decimals)
Required range: `x >= 0`
[​
](#response-items-current-value-of-shares-one-of-0)
current\_value\_of\_shares
number<double> | null
Current value of user's shares in USDC
[​
](#response-items-deposits-one-of-0)
deposits
object\[\] | null
Show child attributes
[​
](#response-items-locked-amount-one-of-0)
locked\_amount
number<double> | null
Amount currently locked (cannot withdraw). Frontend: withdrawable = current\_value\_of\_shares - locked\_amount
[​
](#response-items-share-price-one-of-0)
share\_price
number<double> | null
Current share price (NAV per share)
[​
](#response-items-total-deposited-one-of-0)
total\_deposited
number<double> | null
Total amount deposited in USDC (sum of all contributions)
[​
](#response-items-total-withdrawn-one-of-0)
total\_withdrawn
number<double> | null
Total amount withdrawn in USDC (sum of all settled redemptions)
[​
](#response-items-unrealized-pnl-one-of-0)
unrealized\_pnl
number<double> | null
Unrealized profit/loss in USDC (only on current holdings)
[​
](#response-items-volume-one-of-0)
volume
number<double> | null
Trading volume in USDC
[​
](#response-items-weekly-win-rate-12w-one-of-0)
weekly\_win\_rate\_12w
number<double> | null
[​
](#response-items-withdrawals-one-of-0)
withdrawals
object\[\] | null
Show child attributes
[Get account-owned vaults](/api-reference/vaults/get-account-owned-vaults)[Get user-owned vaults (deprecated)](/api-reference/vaults/get-user-owned-vaults-deprecated)
⌘I