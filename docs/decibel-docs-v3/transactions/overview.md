---
title: "Overview"
url: "https://docs.decibel.trade/transactions/overview"
scraped: "2026-02-03T21:44:11.221Z"
---

# Overview

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Overview
Overview
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
## 
[​
](#welcome-to-decibel-transactions)
Welcome to Decibel Transactions
Decibel transactions are executed on-chain on the Aptos blockchain. All trading operations, account management, and position management are performed through Move smart contract function calls.
[
## Account Management
Create subaccounts, deposit/withdraw collateral, and manage account settings
](/transactions/account-management/create-subaccount)[
## Order Management
Place, cancel, and manage trading orders including limit, market, and TWAP orders
](/transactions/order-management/place-order)[
## Position Management
Manage take-profit and stop-loss orders for positions
](/transactions/position-management/place-tp-sl-order)[
## Delegation
Delegate trading permissions to other accounts
](/transactions/account-management/delegate-trading)[
## Builder Fee
Approve and manage builder fees for subaccounts
](/transactions/builder-fee/approve-max-builder-fee)[
## Vault
Create, fund, and manage trading vaults
](/transactions/vault/create-and-fund)[
## Optimized Transaction Building
Build transactions synchronously using ABI, replay protection nonce, and chain ID for improved performance
](/transactions/optimized-building)[
## Formatting Prices and Sizes
Learn how to convert decimal prices and sizes to chain units using market configuration
](/transactions/formatting-prices-sizes)
## 
[​
](#package-address)
Package Address
All Decibel transactions use the following package address:
Testnet
Netna
Copy
Ask AI
```
0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88
```
## 
[​
](#helper-functions)
Helper Functions
### 
[​
](#get-market-address)
Get Market Address
Typescript
Python
Copy
Ask AI
```
import {
AccountAddress,
createObjectAddress,
MoveString,
} from "@aptos-labs/ts-sdk";
function getMarketAddr(
marketName: string,
perpEngineGlobal: string
): AccountAddress {
const marketNameBytes = new MoveString(marketName).bcsToBytes();
return createObjectAddress(
AccountAddress.fromString(perpEngineGlobal),
marketNameBytes
);
}
```
### 
[​
](#get-perp-engine-global-address)
Get Perp Engine Global Address
Typescript
Python
Copy
Ask AI
```
import { AccountAddress, createObjectAddress } from "@aptos-labs/ts-sdk";
function getPerpEngineGlobalAddress(): AccountAddress {
return createObjectAddress(
AccountAddress.fromString({PACKAGE}),
new TextEncoder().encode("GlobalPerpEngine")
);
}
```
[Optimized Transaction Building](/transactions/overview/optimized-building)
⌘I