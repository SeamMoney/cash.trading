---
title: "Account overview"
url: "https://docs.decibel.trade/api-reference/websockets/accountoverview"
scraped: "2026-02-03T21:43:48.582Z"
---

# Account overview

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Account overview
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
account\_overview:
{userAddr}
Connect
Messages
Account overview message
```
{  "topic": "account_overview:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "account_overview": {    "perp_equity_balance": 50250.75,    "unrealized_pnl": 1250.5,    "realized_pnl": 0,    "unrealized_funding_cost": -125.25,    "cross_margin_ratio": 0.15,    "maintenance_margin": 2500,    "cross_account_leverage_ratio": 500,    "volume": 125000,    "all_time_return": 0.25,    "pnl_90d": 5000,    "sharpe_ratio": 1.8,    "max_drawdown": -0.08,    "weekly_win_rate_12w": 0.65,    "average_cash_position": 45000,    "average_leverage": 5.5,    "cross_account_position": 25000,    "total_margin": 10000,    "usdc_cross_withdrawable_balance": 7500,    "usdc_isolated_withdrawable_balance": 2500  }}
```
Parameters
userAddr
type:string
required
User wallet address (Aptos address format, e.g. 0x123...)
Send
AccountOverviewMessage
type:object
show 2 properties
User's account overview including equity, margin, and PnL
[User open orders](/api-reference/websockets/useropenorders)[Bulk orders](/api-reference/websockets/bulkorders)
⌘I