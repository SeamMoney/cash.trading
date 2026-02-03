---
title: "Perpetuals – Smart Contract Overview"
url: "https://docs.decibel.trade/architecture/perps/perps-contract-overview"
scraped: "2026-02-03T21:43:57.216Z"
---

# Perpetuals – Smart Contract Overview

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Decibel Perp Engine
Perpetuals – Smart Contract Overview
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
* * *
## 
[​
](#1-core-modules)
1.  Core Modules
Module
Responsibility
**Account Management**
Creates & authorizes trading sub‑accounts; maintains permissions & balances.
**Orderbook**
Stores limit orders on‑chain and routes matched orders for settlement.
**Clearinghouse**
Updates positions & collateral, computes margin and funding, settles trades, and enforces risk limits.
## 
[​
](#2-key-workflows)
2.  Key Workflows
### 
[​
](#2-1-maker-order)
2.1  Maker Order
1.  User authorization is verified.
2.  Account margin is checked to ensure the new order is supportable.
3.  Order is inserted into the order book and becomes matchable.
### 
[​
](#2-2-taker-order)
2.2  Taker Order
1.  Performs the same authorization and margin validation.
2.  Order matches against resting liquidity.
3.  Clearinghouse settles the trade atomically and adjusts account balances.
### 
[​
](#2-3-withdrawals)
2.3  Withdrawals
1.  Authorization verified.
2.  Clearinghouse ensures post‑withdrawal collateral meets margin requirements.
3.  Approved collateral is transferred on‑chain to the user.
### 
[​
](#2-4-liquidations)
2.4  Liquidations
If an account’s equity falls below maintenance margin, the Clearinghouse initiates an on‑chain liquidation that closes positions to protect overall solvency.
## 
[​
](#3-risk-controls)
3.  Risk Controls
-   **Continuous Margin Checks:** Every trade and withdrawal is evaluated against margin requirements.
-   **Automated Liquidations:** Insolvent positions are closed promptly to prevent socialized losses.
-   **Emergency Modes:** Markets can be set to **reduce‑only** or **halted** during extreme volatility or upgrades.
## 
[​
](#4-security-&-governance)
4.  Security & Governance
-   Core contracts are written in **Move** and are open‑source.
-   Critical risk parameters (e.g., maintenance margin, funding cadence) are maintained onchain.
* * *
[Global Risk Controls](/architecture/perps/global-risk-controls)
⌘I