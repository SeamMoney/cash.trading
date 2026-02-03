---
title: "User positions"
url: "https://docs.decibel.trade/api-reference/websockets/userpositions"
scraped: "2026-02-03T21:43:55.052Z"
---

# User positions

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
User positions
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
user\_positions:
{userAddr}
Connect
Messages
User positions message
```
{  "topic": "user_positions:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "positions": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "size": 2.5,      "user_leverage": 10,      "max_allowed_leverage": 20,      "entry_price": 49800,      "is_isolated": false,      "is_deleted": false,      "unrealized_funding": -25.5,      "event_uid": 1.2345678901234568e+35,      "estimated_liquidation_price": 45000,      "transaction_version": 12345681,      "tp_order_id": "tp_001",      "tp_trigger_price": 52000,      "tp_limit_price": 51900,      "sl_order_id": "sl_001",      "sl_trigger_price": 48000,      "sl_limit_price": null,      "has_fixed_sized_tpsls": false    }  ]}
```
Parameters
userAddr
type:string
required
User wallet address (Aptos address format, e.g. 0x123...)
Send
UserPositionsMessage
type:object
show 2 properties
User's open positions with PnL and liquidation prices
[Bulk order fills](/api-reference/websockets/bulkorderfills)[User order history](/api-reference/websockets/userorderhistory)
⌘I