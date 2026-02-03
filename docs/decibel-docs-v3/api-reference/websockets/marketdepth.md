---
title: "Market depth"
url: "https://docs.decibel.trade/api-reference/websockets/marketdepth"
scraped: "2026-02-03T21:43:50.819Z"
---

# Market depth

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Market depth
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
depth:
{marketAddr}
:
{aggregationLevel}
Connect
Messages
Market depth message
```
{  "topic": "depth:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1",  "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "bids": [    {      "price": 50000,      "size": 10.5    },    {      "price": 49950,      "size": 15.2    },    {      "price": 49900,      "size": 20    }  ],  "asks": [    {      "price": 50050,      "size": 8.3    },    {      "price": 50100,      "size": 12.7    },    {      "price": 50150,      "size": 18.5    }  ]}
```
Parameters
marketAddr
type:string
required
Market address (Aptos address format, e.g. 0x456...)
Send
MarketDepthMessage
type:object
show 4 properties
Market order book depth with aggregated price levels. Optional aggregationLevel parameter (1, 2, 5, 10, 100, or 1000) can be appended to the topic, defaults to 1 if not specified.
[Market price](/api-reference/websockets/marketprice)[User funding rate history](/api-reference/websockets/userfundingratehistory)
⌘I