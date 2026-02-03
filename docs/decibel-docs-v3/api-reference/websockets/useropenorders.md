---
title: "User open orders"
url: "https://docs.decibel.trade/api-reference/websockets/useropenorders"
scraped: "2026-02-03T21:43:54.072Z"
---

# User open orders

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
User open orders
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
user\_open\_orders:
{userAddr}
Connect
Messages
User open orders message
```
{  "topic": "user_open_orders:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "orders": [    {      "parent": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "client_order_id": "order_123",      "order_id": "45678",      "status": "Open",      "order_type": "Limit",      "trigger_condition": "None",      "order_direction": "Open Long",      "orig_size": 1.5,      "remaining_size": 1.5,      "size_delta": null,      "price": 50000.5,      "is_buy": true,      "is_reduce_only": false,      "details": "",      "tp_order_id": null,      "tp_trigger_price": null,      "tp_limit_price": null,      "sl_order_id": null,      "sl_trigger_price": null,      "sl_limit_price": null,      "transaction_version": 12345678,      "unix_ms": 1699564800000    }  ]}
```
Parameters
userAddr
type:string
required
User wallet address (Aptos address format, e.g. 0x123...)
Send
UserOpenOrdersMessage
type:object
show 2 properties
User's currently open orders
[User funding rate history](/api-reference/websockets/userfundingratehistory)[Account overview](/api-reference/websockets/accountoverview)
⌘I