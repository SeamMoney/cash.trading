---
source: https://docs.decibel.trade/typescript-sdk/overview
title: overview
scraped: 2025-11-28T01:20:49.420Z
---

TypeScript SDK Overview - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationGetting StartedTypeScript SDK Overview[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Getting Started

- [TypeScript SDK Overview](/typescript-sdk/overview)
- [Installation](/typescript-sdk/installation)
- [Configuration](/typescript-sdk/configuration)
- [Read SDK](/typescript-sdk/read-sdk)
- [Write SDK](/typescript-sdk/write-sdk)
- [Advanced](/typescript-sdk/advanced)

On this page
- [What is the Decibel TypeScript SDK?](#what-is-the-decibel-typescript-sdk)
- [Quick start](#quick-start)
- [Read: market and account data](#read:-market-and-account-data)
- [Write: submit transactions](#write:-submit-transactions)
- [When to use which](#when-to-use-which)
- [Related](#related)

Getting Started# TypeScript SDK Overview

Copy pageDecibel TypeScript SDK for reading market data and submitting transactions on Aptos

Copy page## [​](#what-is-the-decibel-typescript-sdk)What is the Decibel TypeScript SDK?

The SDK provides a clean, typed interface to interact with Decibel on Aptos:

- Read operations: `DecibelReadDex` — query markets, depth, prices, trades, positions, orders, subaccounts, vaults.

- Write operations: `DecibelWriteDex` — place/cancel orders, manage positions and subaccounts, vault operations, delegation.

## Installation

Install the SDK and required peer dependencies for Node or browser
environments.## Read SDK

Market data, account state, orders, positions, and historical data.## Write SDK

Trading, position management, TP/SL, TWAP, subaccounts, and vault
transactions.
## [​](#quick-start)Quick start

### [​](#read:-market-and-account-data)Read: market and account data

CopyAsk AI```
import { DecibelReadDex, NETNA_CONFIG } from "@decibel/sdk";

const read = new DecibelReadDex(NETNA_CONFIG, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY, // optional
});

const markets = await read.markets.getAll();
const account = await read.accountOverview.getByAddr("0x...account");

```

### [​](#write:-submit-transactions)Write: submit transactions

CopyAsk AI```
import { DecibelWriteDex, NETNA_CONFIG } from "@decibel/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const account = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  // Defaults: simulate before submit, fee payer enabled
  nodeApiKey: process.env.APTOS_NODE_API_KEY, // optional
});

```

## [​](#when-to-use-which)When to use which

- Use `DecibelReadDex` when you need market data, order/position history, or account state. No private keys required.

- Use `DecibelWriteDex` for on-chain actions and trading. In browsers, avoid embedding private keys — prefer session keys or a wallet and pass `accountOverride` for specific calls.

## [​](#related)Related

- Configuration and network presets: `NETNA_CONFIG`, `LOCAL_CONFIG`, `DOCKER_CONFIG`, `NAMED_CONFIGS`

- See REST and WebSocket topics in Quick Start for direct API access.

[Installation](/typescript-sdk/installation)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)