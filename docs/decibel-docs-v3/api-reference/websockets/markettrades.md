---
title: "Market trades"
url: "https://docs.decibel.trade/api-reference/websockets/markettrades"
scraped: "2026-02-03T21:43:51.851Z"
---

# Market trades

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Websockets
Market trades
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
WSS
wss://api.testnet.aptoslabs.com/decibel/ws
trades:
{marketAddr}
Connect
Messages
Market trades message
```
{  "topic": "trades:0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",  "trades": [    {      "account": "0x9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba",      "market": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",      "action": "Open Long",      "trade_id": 3647277,      "size": 0.8,      "price": 50100,      "is_profit": false,      "realized_pnl_amount": -45.2,      "is_funding_positive": true,      "realized_funding_amount": 5.1,      "is_rebate": false,      "fee_amount": 20.04,      "order_id": "45680",      "client_order_id": "order_123",      "transaction_unix_ms": 1699564900000,      "transaction_version": 3647276286    }  ]}
```
Parameters
marketAddr
type:string
required
Market address (Aptos address format, e.g. 0x456...)
Send
MarketTradesMessage
type:object
show 2 properties
Recent trades for a specific market
[User order history](/api-reference/websockets/userorderhistory)[Market candlestick](/api-reference/websockets/marketcandlestick)
⌘I