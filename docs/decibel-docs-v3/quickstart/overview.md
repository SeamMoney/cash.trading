---
title: "Welcome to Decibel"
url: "https://docs.decibel.trade/quickstart/overview"
scraped: "2026-02-03T21:44:01.735Z"
---

# Welcome to Decibel

[Decibel home page](/)
Search...
⌘KAsk AI
Search...
Navigation
Getting Started
Welcome to Decibel
(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"children":"document.documentElement.setAttribute('data-page-mode', 'none');","id":"\_mintlify-page-mode-script"}\])(self.\_\_next\_s=self.\_\_next\_s||\[\]).push(\[0,{"suppressHydrationWarning":true,"children":"(function n(a,b){if(!document.getElementById(\\"footer\\")?.classList.contains(\\"advanced-footer\\")||\\"maple\\"===b||\\"willow\\"===b||\\"almond\\"===b)return;let c=document.documentElement.getAttribute(\\"data-page-mode\\"),d=document.getElementById(\\"navbar\\"),e=document.getElementById(\\"navigation-items\\"),f=document.getElementById(\\"sidebar\\"),g=document.getElementById(\\"footer\\"),h=document.getElementById(\\"table-of-contents-content\\"),i=(e?.clientHeight??0)+16\*a+32\*(\\"mint\\"===b||\\"linden\\"===b);if(!g||\\"center\\"===c)return;let j=g.getBoundingClientRect().top,k=window.innerHeight-j;f&&e&&(i>j?(f.style.top=\`-${k}px\`,f.style.height=\`${window.innerHeight}px\`):(f.style.top=\`${a}rem\`,f.style.height=\\"auto\\")),h&&d&&(k>0?h.style.top=\\"custom\\"===c?\`${d.clientHeight-k}px\`:\`${40+d.clientHeight-k}px\`:h.style.top=\\"\\")})(\\n (function m(a,b,c){let d=document.documentElement.getAttribute(\\"data-banner-state\\"),e=2.5\*!!(null!=d?\\"visible\\"===d:b),f=3\*!!a,g=4,h=e+g+f;switch(c){case\\"mint\\":case\\"palm\\":break;case\\"aspen\\":f=2.5\*!!a,g=3.5,h=e+f+g;break;case\\"linden\\":g=4,h=e+g;break;case\\"almond\\":g=3.5,h=e+g}return h})(true, false, \\"mint\\"),\\n \\"mint\\",\\n)","id":"\_mintlify-footer-and-sidebar-scroll-script"}\])
Decibel is a decentralized perpetuals exchange with a fully on-chain order book and clearinghouse. Every order is placed, matched, and settled directly on the Aptos blockchain. There’s no off-chain matching engine. This documentation covers how Decibel works, how to trade on it, and how to build automated trading strategies.
## 
[​
](#how-decibel-is-different)
How Decibel Is Different
Unlike centralized exchanges, Decibel runs entirely on-chain. You keep control of your assets, and every fill is verifiable on the blockchain.
Decibel
Centralized Exchange
**Custody**
You hold your keys
Exchange holds your funds
**Order matching**
On-chain, transparent
Off-chain, opaque
**Settlement**
On-chain, verifiable
Internal ledger
**Ecosystem**
Composable with Aptos DeFi
Isolated
Unlike other DEXes that run on app-specific chains, Decibel lives on Aptos, a general-purpose L1. Your assets aren’t locked in a bridge or roll-up. You can move them anywhere in the Aptos ecosystem.
## 
[​
](#why-aptos)
Why Aptos?
Decibel needs a blockchain fast enough to run an on-chain order book:
-   **Parallel execution via Block-STM.** Block times under 20ms.
-   **Sub-second finality.** Settlement in roughly 0.125 seconds.
-   **Move VM** for type-safe contracts with formal verification support.
-   **Global validator set**, not a handful of nodes run by one team.
Aptos is one of the few L1s that can deliver the throughput and latency needed for high-frequency trading without off-chain components.
## 
[​
](#key-features)
Key Features
### 
[​
](#vaults-with-customizable-fees)
Vaults with Customizable Fees
Run your own on-chain hedge fund. Create a vault, set your performance fee, and let depositors earn from your strategy. Vault shares are fungible tokens you can use elsewhere in DeFi. Fees are calculated per interval (minimum 1 month): if the vault profits, you receive a percentage as newly minted shares. If it loses, you get nothing. [Create a vault →](/transactions/vault/create-and-fund)
### 
[​
](#bulk-orders-for-market-making)
Bulk Orders for Market Making
Other decentralized exchanges require you to cancel orders before replacing them. On Decibel, bulk orders are stateful updates. Send your new desired order state and it overwrites the previous one. No cancel transaction. No waiting. This cuts latency for market makers and saves gas. [Place bulk orders →](/transactions/order-management/place-bulk-order)
### 
[​
](#continuous-funding)
Continuous Funding
Funding rates accrue continuously instead of settling every few hours. This keeps perpetual prices tighter to spot and closes the window for manipulation that periodic funding creates. (TODO: create dedicated funding page)
### 
[​
](#transparent-liquidations)
Transparent Liquidations
Liquidation state is monitored off-chain by keepers, but execution happens on-chain. Every liquidation is verifiable, unlike some exchanges that just “turn off” your account.
### 
[​
](#multi-collateral-coming-soon)
Multi-Collateral (Coming Soon)
Use APT, USDC, BTC, ETH, or SOL as margin from a single unified account.
## 
[​
](#who-built-this)
Who Built This?
The team includes engineers who built the Aptos blockchain, the Move language, and core Aptos infrastructure. That’s why Decibel can do things other DEXes can’t.
## 
[​
](#next-steps)
Next Steps
![Three-tier account model](https://mintcdn.com/aptoslabs/canlJUnLiLpjMoUM/images/tssk/three-account.png?fit=max&auto=format&n=canlJUnLiLpjMoUM&q=85&s=bf69c920ffcf0782cea59f72f9d45dfa)
[
## Try the Platform
Trade on testnet with free funds
](https://trade.decibel.exchange)[
## TypeScript Quick Start
Fetch market data and place your first order in under 10 minutes
](/quickstart/typescript-starter-kit)[
## Account Model Deep Dive
How login, API wallets, and trading accounts work together
](/quickstart/typescript-starter-kit#1-the-three-tier-account-model)
[Core Concepts](/quickstart/concepts)
⌘I