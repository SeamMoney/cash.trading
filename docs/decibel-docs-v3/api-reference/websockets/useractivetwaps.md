---
title: "User active twaps"
url: "https://docs.decibel.trade/api-reference/websockets/useractivetwaps"
scraped: "2026-02-03T21:43:53.183Z"
---

# User active twaps

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
User active twaps
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
user\_active\_twaps:
{userAddr}
Connect
Messages
User active twaps message
```
{  "topic": "user_active_twaps:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "twaps": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "is_buy": true,      "order_id": "78901",      "is_reduce_only": false,      "start_unix_ms": 1699564800000,      "frequency_s": 300,      "duration_s": 3600,      "orig_size": 100,      "remaining_size": 75,      "status": "Open",      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345679    }  ]}
```
Parameters
userAddr
type:string
required
User wallet address (Aptos address format, e.g. 0x123...)
Send
UserActiveTwapsMessage
type:object
show 2 properties
User's active TWAP (Time-Weighted Average Price) orders
[User trades](/api-reference/websockets/usertrades)[Market price](/api-reference/websockets/marketprice)
⌘I