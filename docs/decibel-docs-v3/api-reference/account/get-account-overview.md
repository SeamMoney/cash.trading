---
title: "Get account overview"
url: "https://docs.decibel.trade/api-reference/account/get-account-overview"
scraped: "2026-02-03T21:43:29.842Z"
---

# Get account overview

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Account
Get account overview
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
GET
/
api
/
v1
/
account\_overviews
Try it
Get account overview
cURL
Copy
Ask AI
```
curl --request GET \
--url https://api.testnet.aptoslabs.com/decibel/api/v1/account_overviews
```
200
Copy
Ask AI
```
{
"cross_account_leverage_ratio": 40.99,
"cross_margin_ratio": 0.01,
"maintenance_margin": 115.29,
"perp_equity_balance": 10064.88,
"total_margin": 9998.72,
"unrealized_funding_cost": -87.84,
"unrealized_pnl": 154,
"usdc_cross_withdrawable_balance": 9843.79,
"usdc_isolated_withdrawable_balance": 0,
"all_time_return": 123,
"average_cash_position": 123,
"average_leverage": 123,
"cross_account_position": 123,
"liquidation_fees_paid": 45.5,
"liquidation_losses": -500,
"max_drawdown": 123,
"net_deposits": 30277044.96,
"pnl_90d": 123,
"realized_pnl": 1250.5,
"sharpe_ratio": 123,
"volume": 123,
"weekly_win_rate_12w": 123
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
](#parameter-volume-window)
volume\_window
enum<string>
Volume time window (e.g., "7d", "14d", "30d", "90d"). Omit to exclude volume data. Time window for volume queries
Available options:
`7d`,
`14d`,
`30d`,
`90d`
[​
](#parameter-include-performance)
include\_performance
boolean
default:false
Include performance metrics
[​
](#parameter-performance-lookback-days)
performance\_lookback\_days
integer<int32>
default:90
Performance lookback window in days.
Required range: `x >= 0`
#### Response
200
application/json
Account overview retrieved successfully
[​
](#response-cross-account-leverage-ratio)
cross\_account\_leverage\_ratio
number<double>
required
Example:
`40.99`
[​
](#response-cross-margin-ratio)
cross\_margin\_ratio
number<double>
required
Example:
`0.01`
[​
](#response-maintenance-margin)
maintenance\_margin
number<double>
required
Example:
`115.29`
[​
](#response-perp-equity-balance)
perp\_equity\_balance
number<double>
required
Example:
`10064.88`
[​
](#response-total-margin)
total\_margin
number<double>
required
Example:
`9998.72`
[​
](#response-unrealized-funding-cost)
unrealized\_funding\_cost
number<double>
required
Example:
`-87.84`
[​
](#response-unrealized-pnl)
unrealized\_pnl
number<double>
required
Example:
`154`
[​
](#response-usdc-cross-withdrawable-balance)
usdc\_cross\_withdrawable\_balance
number<double>
required
Example:
`9843.79`
[​
](#response-usdc-isolated-withdrawable-balance)
usdc\_isolated\_withdrawable\_balance
number<double>
required
Example:
`0`
[​
](#response-all-time-return-one-of-0)
all\_time\_return
number<double> | null
[​
](#response-average-cash-position-one-of-0)
average\_cash\_position
number<double> | null
[​
](#response-average-leverage-one-of-0)
average\_leverage
number<double> | null
[​
](#response-cross-account-position-one-of-0)
cross\_account\_position
number<double> | null
[​
](#response-liquidation-fees-paid-one-of-0)
liquidation\_fees\_paid
number<double> | null
Total fees paid during margin call liquidations (always positive). Fee rate is configurable per market (default 0.5%, max 2% of notional). This is already included in realized\_pnl but shown separately for transparency. Null for accounts that have never been margin called.
Example:
`45.5`
[​
](#response-liquidation-losses-one-of-0)
liquidation\_losses
number<double> | null
Net collateral balance changes from liquidations (vault/BLP accounts only). Regular users: always null - their liquidation loss is in realized\_pnl via BackStopLiquidation trades. Vault accounts: positive = margin received from liquidated users (profit), negative = bad debt covered when users were underwater (loss).
Example:
`-500`
[​
](#response-max-drawdown-one-of-0)
max\_drawdown
number<double> | null
[​
](#response-net-deposits-one-of-0)
net\_deposits
number<double> | null
Net deposits (total deposits - total withdrawals) in USDC. Used to verify all\_time\_return: all\_time\_return = ((equity - net\_deposits) / net\_deposits) \* 100
Example:
`30277044.96`
[​
](#response-pnl-90d-one-of-0)
pnl\_90d
number<double> | null
[​
](#response-realized-pnl-one-of-0)
realized\_pnl
number<double> | null
Example:
`1250.5`
[​
](#response-sharpe-ratio-one-of-0)
sharpe\_ratio
number<double> | null
[​
](#response-volume-one-of-0)
volume
number<double> | null
[​
](#response-weekly-win-rate-12w-one-of-0)
weekly\_win\_rate\_12w
number<double> | null
[Get user positions (deprecated)](/api-reference/user/get-user-positions-deprecated)[Get account positions](/api-reference/account/get-account-positions)
⌘I