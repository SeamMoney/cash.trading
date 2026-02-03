---
title: "Advanced"
url: "https://docs.decibel.trade/typescript-sdk/advanced"
scraped: "2026-02-03T21:44:16.527Z"
---

# Advanced

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Advanced
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#gas-price-manager)
Gas price manager
Use `GasPriceManager` to fetch and cache gas estimates and pass them to the Write SDK for faster, predictable transaction building:
Copy
Ask AI
```
import {
GasPriceManager,
DecibelWriteDex,
NETNA_CONFIG,
} from "@decibeltrade/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
const gas = new GasPriceManager(NETNA_CONFIG, {
multiplier: 2, // default multiplier applied to estimates
refreshIntervalMs: 60_000, // refresh cadence
});
await gas.initialize();
const account = new Ed25519Account({
privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
nodeApiKey: process.env.APTOS_NODE_API_KEY!, // Required
gasPriceManager: gas,
});
```
Stop the manager when your app unmounts:
Copy
Ask AI
```
gas.destroy();
```
## 
[​
](#fee-payer)
Fee payer
-   By default, transactions are submitted through Decibel’s fee payer service (`gasStationUrl`).
-   To submit directly to the fullnode, disable it:
Copy
Ask AI
```
const write = new DecibelWriteDex(NETNA_CONFIG, account, { noFeePayer: true });
```
## 
[​
](#time-synchronization)
Time synchronization
If client clocks are skewed, set `timeDeltaMs` to shift local time used when building transactions:
Copy
Ask AI
```
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
timeDeltaMs: serverDeltaMs,
});
```
You can compute `serverDeltaMs = serverTimeMs - Date.now()` using your own time endpoint.
[Error responses](/typescript-sdk/error-responses)
⌘I