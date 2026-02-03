---
title: "Installation"
url: "https://docs.decibel.trade/typescript-sdk/installation"
scraped: "2026-02-03T21:44:17.914Z"
---

# Installation

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Installation
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#install-packages)
Install packages
npm
Copy
Ask AI
```
npm install @decibeltrade/sdk @aptos-labs/ts-sdk zod
```
yarn
Copy
Ask AI
```
yarn add @decibeltrade/sdk @aptos-labs/ts-sdk zod
```
pnpm
Copy
Ask AI
```
pnpm add @decibeltrade/sdk @aptos-labs/ts-sdk zod
```
-   Optional (TypeScript in Node): `@types/ws`
npm
Copy
Ask AI
```
npm install -D @types/ws
```
## 
[​
](#import-and-verify)
Import and verify
Copy
Ask AI
```
import {
DecibelReadDex,
DecibelWriteDex,
NETNA_CONFIG,
} from "@decibeltrade/sdk";
```
The package includes ESM builds and TypeScript type definitions.
[TypeScript SDK Overview](/typescript-sdk/overview)[Configuration](/typescript-sdk/configuration)
⌘I