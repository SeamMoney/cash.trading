---
title: "Bulk order fills"
url: "https://docs.decibel.trade/api-reference/websockets/bulkorderfills"
scraped: "2026-02-03T21:43:49.473Z"
---

# Bulk order fills

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Bulk order fills
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
bulk\_order\_fills:
{userAddr}
Connect
Messages
Bulk order fills message
```
{  "topic": "bulk_order_fills:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",  "bulk_order_fills": [    {      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "sequence_number": 100,      "user": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",      "filled_size": 1.5,      "price": 50000,      "is_bid": true,      "transaction_unix_ms": 1699564800000,      "transaction_version": 12345682,      "event_uid": 1.2345678901234568e+35    }  ]}
```
Parameters
userAddr
type:string
required
User wallet address (Aptos address format, e.g. 0x123...)
Send
BulkOrderFillsMessage
type:object
show 2 properties
User's bulk order fill events
[Notifications](/api-reference/websockets/notifications)[User positions](/api-reference/websockets/userpositions)
⌘I