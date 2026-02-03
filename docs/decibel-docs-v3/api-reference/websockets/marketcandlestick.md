---
title: "Market candlestick"
url: "https://docs.decibel.trade/api-reference/websockets/marketcandlestick"
scraped: "2026-02-03T21:43:50.355Z"
---

# Market candlestick

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Market candlestick
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
market\_candlestick:
{marketAddr}
:
{interval}
Connect
Messages
Market candlestick message
```
{  "topic": "market_candlestick:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:1h",  "candle": {    "t": 1699564800000,    "T": 1699568400000,    "o": 49800,    "h": 50300,    "l": 49600,    "c": 50125.75,    "v": 1250.5,    "i": "1h"  }}
```
Parameters
interval
type:string
required
Candlestick interval (1m, 15m, 1h, 4h, or 1d)
marketAddr
type:string
required
Market address (Aptos address format, e.g. 0x456...)
Send
MarketCandlestickMessage
type:object
show 2 properties
Real-time candlestick/OHLCV data for a specific market and interval
[Market trades](/api-reference/websockets/markettrades)[All market prices](/api-reference/websockets/allmarketprices)
⌘I