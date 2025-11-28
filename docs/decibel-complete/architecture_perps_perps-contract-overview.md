---
source: https://docs.decibel.trade/architecture/perps/perps-contract-overview
title: perps contract overview
scraped: 2025-11-28T01:20:49.034Z
---

Perpetuals – Smart Contract Overview - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationDecibel Perp EnginePerpetuals – Smart Contract Overview[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Decibel Perp Engine

- [Perpetuals – Smart Contract Overview](/architecture/perps/perps-contract-overview)
- [Global Risk Controls](/architecture/perps/global-risk-controls)
- [Position Management](/architecture/perps/position-management)

##### Decibel Orderbook

- [Orderbook & Onchain Matching](/architecture/orderbook/orderbook)

On this page
- [1.  Core Modules](#1-core-modules)
- [2.  Key Workflows](#2-key-workflows)
- [2.1  Maker Order](#2-1-maker-order)
- [2.2  Taker Order](#2-2-taker-order)
- [2.3  Withdrawals](#2-3-withdrawals)
- [2.4  Liquidations](#2-4-liquidations)
- [3.  Risk Controls](#3-risk-controls)
- [4.  Security & Governance](#4-security-&-governance)

Decibel Perp Engine# Perpetuals – Smart Contract Overview

Copy pageDecibel is a decentralized exchange (DEX) for perpetual futures. This document provides an overview of its smart contract architecture and risk controls.

Copy page
## [​](#1-core-modules)1.  Core Modules

| Module | Responsibility 

| **Account Management** | Creates & authorizes trading sub‑accounts; maintains permissions & balances. 
| **Orderbook** | Stores limit orders on‑chain and routes matched orders for settlement. 
| **Clearinghouse** | Updates positions & collateral, computes margin and funding, settles trades, and enforces risk limits. 

## [​](#2-key-workflows)2.  Key Workflows

### [​](#2-1-maker-order)2.1  Maker Order

- User authorization is verified.

- Account margin is checked to ensure the new order is supportable.

- Order is inserted into the order book and becomes matchable.

### [​](#2-2-taker-order)2.2  Taker Order

- Performs the same authorization and margin validation.

- Order matches against resting liquidity.

- Clearinghouse settles the trade atomically and adjusts account balances.

### [​](#2-3-withdrawals)2.3  Withdrawals

- Authorization verified.

- Clearinghouse ensures post‑withdrawal collateral meets margin requirements.

- Approved collateral is transferred on‑chain to the user.

### [​](#2-4-liquidations)2.4  Liquidations

If an account’s equity falls below maintenance margin, the Clearinghouse initiates an on‑chain liquidation that closes positions to protect overall solvency.
## [​](#3-risk-controls)3.  Risk Controls

- **Continuous Margin Checks:** Every trade and withdrawal is evaluated against margin requirements.

- **Automated Liquidations:** Insolvent positions are closed promptly to prevent socialized losses.

- **Emergency Modes:** Markets can be set to **reduce‑only** or **halted** during extreme volatility or upgrades.

## [​](#4-security-&-governance)4.  Security & Governance

- Core contracts are written in **Move** and are open‑source.

- Critical risk parameters (e.g., maintenance margin, funding cadence) are maintained onchain.

[Global Risk Controls](/architecture/perps/global-risk-controls)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)