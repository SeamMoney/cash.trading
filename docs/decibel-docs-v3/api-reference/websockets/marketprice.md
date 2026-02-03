---
title: "Market price"
url: "https://docs.decibel.trade/api-reference/websockets/marketprice"
scraped: "2026-02-03T21:43:51.271Z"
---

# Market price

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Market price
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
market\_price:
{marketAddr}
Connect
Messages
Market price message
```
{  "topic": "market_price:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "price": {    "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",    "oracle_px": 50125.75,    "mark_px": 50120.5,    "mid_px": 50122.25,    "funding_rate_bps": 5,    "is_funding_positive": true,    "transaction_unix_ms": 1699564800000,    "open_interest": 125000.5  }}
```
Parameters
marketAddr
type:string
required
Market address (Aptos address format, e.g. 0x456...)
Send
MarketPriceMessage
type:object
show 2 properties
Real-time price updates for a specific market (oracle, mark, mid prices)
[User active twaps](/api-reference/websockets/useractivetwaps)[Market depth](/api-reference/websockets/marketdepth)
⌘I