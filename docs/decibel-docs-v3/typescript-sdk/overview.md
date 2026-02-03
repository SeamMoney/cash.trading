---
title: "TypeScript SDK Overview"
url: "https://docs.decibel.trade/typescript-sdk/overview"
scraped: "2026-02-03T21:44:18.362Z"
---

# TypeScript SDK Overview

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
TypeScript SDK Overview
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#what-is-the-decibel-typescript-sdk)
What is the Decibel TypeScript SDK?
The SDK provides a clean, typed interface to interact with Decibel on Aptos:
-   Read operations: `DecibelReadDex` — query markets, depth, prices, trades, positions, orders, subaccounts, vaults.
-   Write operations: `DecibelWriteDex` — place/cancel orders, manage positions and subaccounts, vault operations, delegation.
[
## Installation
Install the SDK and required peer dependencies for Node or browser environments.
](/typescript-sdk/installation)[
## Read SDK
Market data, account state, orders, positions, and historical data.
](/typescript-sdk/read-sdk)[
## Write SDK
Trading, position management, TP/SL, TWAP, subaccounts, and vault transactions.
](/typescript-sdk/write-sdk)
## 
[​
](#quick-start)
Quick start
### 
[​
](#read-market-and-account-data)
Read: market and account data
Copy
Ask AI
```
import { DecibelReadDex, NETNA_CONFIG } from "@decibeltrade/sdk";
const read = new DecibelReadDex(NETNA_CONFIG, {
// Required: used to send Authorization: Bearer <YOUR_NODE_API_KEY> on node requests
nodeApiKey: process.env.APTOS_NODE_API_KEY!,
});
const markets = await read.markets.getAll();
const account = await read.accountOverview.getByAddr("0x...account");
```
### 
[​
](#write-submit-transactions)
Write: submit transactions
Copy
Ask AI
```
import { DecibelWriteDex, NETNA_CONFIG } from "@decibeltrade/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
const account = new Ed25519Account({
privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
// Required: used to send Authorization: Bearer <YOUR_NODE_API_KEY> on node requests
nodeApiKey: process.env.APTOS_NODE_API_KEY!,
// Defaults: simulate before submit, fee payer enabled
});
```
## 
[​
](#when-to-use-which)
When to use which
-   Use `DecibelReadDex` when you need market data, order/position history, or account state. No private keys required.
-   Use `DecibelWriteDex` for on-chain actions and trading. In browsers, avoid embedding private keys — prefer session keys or a wallet and pass `accountOverride` for specific calls.
## 
[​
](#related)
Related
-   Configuration and network presets: `NETNA_CONFIG`, `LOCAL_CONFIG`, `DOCKER_CONFIG`, `NAMED_CONFIGS`
-   See REST and WebSocket topics in Quick Start for direct API access.
[Installation](/typescript-sdk/installation)
⌘I