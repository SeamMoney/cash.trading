---
title: "Configuration"
url: "https://docs.decibel.trade/typescript-sdk/configuration"
scraped: "2026-02-03T21:44:16.995Z"
---

# Configuration

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Configuration
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#decibelconfig)
DecibelConfig
-   network: Aptos network identifier
-   fullnodeUrl: Aptos fullnode HTTP endpoint
-   tradingHttpUrl: Decibel trading REST base URL
-   tradingWsUrl: Decibel trading WebSocket URL
-   gasStationUrl: Fee payer service used for transaction submission
-   deployment: on-chain package and addresses (package, usdc, testc, perpEngineGlobal)
-   chainId: optional preconfigured chain id to accelerate build/sign
## 
[​
](#custom-config-example)
Custom config example
Copy
Ask AI
```
import { type DecibelConfig } from "@decibeltrade/sdk";
import { Network } from "@aptos-labs/ts-sdk";
const CUSTOM: DecibelConfig = {
network: Network.CUSTOM,
fullnodeUrl: "https://fullnode.example.com/v1",
tradingHttpUrl: "https://api.example.com/decibel",
tradingWsUrl: "wss://api.example.com/decibel/ws",
gasStationUrl: "https://gasstation.example.com",
deployment: {
package: "0x...package",
usdc: "0x...usdc",
testc: "0x...testc",
perpEngineGlobal: "0x...global",
},
chainId: 204, // optional
};
```
## 
[​
](#node-api-keys)
Node API keys
Pass `nodeApiKey` to `DecibelReadDex` or `DecibelWriteDex` for fullnode rate limits and performance.  
Under the hood, the SDK sends it as `Authorization: Bearer <YOUR_NODE_API_KEY>` on outbound HTTP requests:
Copy
Ask AI
```
const read = new DecibelReadDex(NETNA_CONFIG, {
nodeApiKey: process.env.APTOS_NODE_API_KEY!, // Required
});
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
nodeApiKey: process.env.APTOS_NODE_API_KEY!, // Required
});
```
[Installation](/typescript-sdk/installation)[Read SDK](/typescript-sdk/read-sdk)
⌘I