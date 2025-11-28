---
source: https://docs.decibel.trade/transactions/overview
title: overview
scraped: 2025-11-28T01:20:50.629Z
---

Overview - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationOverviewOverview[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Overview

- [Overview](/transactions/overview)
- [Optimized Transaction Building](/transactions/overview/optimized-building)
- [Formatting Prices and Sizes for Orders](/transactions/overview/formatting-prices-sizes)

##### Account Management

- [Create Subaccount](/transactions/account-management/create-subaccount)
- [Delegate Trading To](/transactions/account-management/delegate-trading)
- [Revoke Delegation](/transactions/account-management/revoke-delegation)
- [Deposit to Subaccount](/transactions/account-management/deposit)
- [Withdraw from Subaccount](/transactions/account-management/withdraw)
- [Configure User Settings for Market](/transactions/account-management/configure-settings)

##### Order Management

- [Place Order](/transactions/order-management/place-order)
- [Cancel Order](/transactions/order-management/cancel-order)
- [Cancel Client Order](/transactions/order-management/cancel-client-order)
- [Place TWAP Order](/transactions/order-management/place-twap-order)
- [Cancel TWAP Order](/transactions/order-management/cancel-twap-order)
- [Place Bulk Order](/transactions/order-management/place-bulk-order)
- [Cancel Bulk Order](/transactions/order-management/cancel-bulk-order)

##### Position Management

- [Place TP/SL Order for Position](/transactions/position-management/place-tp-sl-order)
- [Update TP Order for Position](/transactions/position-management/update-tp-order)
- [Update SL Order for Position](/transactions/position-management/update-sl-order)
- [Cancel TP/SL Order for Position](/transactions/position-management/cancel-tp-sl-order)

##### Builder Fee

- [Approve Max Builder Fee](/transactions/builder-fee/approve-max-builder-fee)
- [Revoke Max Builder Fee](/transactions/builder-fee/revoke-max-builder-fee)

##### Vault

- [Create and Fund Vault](/transactions/vault/create-and-fund)
- [Activate Vault](/transactions/vault/activate)
- [Contribute to Vault](/transactions/vault/contribute)
- [Redeem from Vault](/transactions/vault/redeem)
- [Delegate DEX Actions To](/transactions/vault/delegate-dex-actions)

On this page
- [Welcome to Decibel Transactions](#welcome-to-decibel-transactions)
- [Package Address](#package-address)
- [Helper Functions](#helper-functions)
- [Get Market Address](#get-market-address)
- [Get Primary Subaccount Address](#get-primary-subaccount-address)
- [Get Perp Engine Global Address](#get-perp-engine-global-address)

Overview# Overview

Copy pageComplete on-chain transaction documentation for Decibel Trading Platform

Copy page## [​](#welcome-to-decibel-transactions)Welcome to Decibel Transactions

Decibel transactions are executed on-chain on the Aptos blockchain. All trading operations, account management, and position management are performed through Move smart contract function calls.
## Account Management

Create subaccounts, deposit/withdraw collateral, and manage account settings## Order Management

Place, cancel, and manage trading orders including limit, market, and TWAP
orders## Position Management

Manage take-profit and stop-loss orders for positions## Delegation

Delegate trading permissions to other accounts## Builder Fee

Approve and manage builder fees for subaccounts## Vault

Create, fund, and manage trading vaults## Optimized Transaction Building

Build transactions synchronously using ABI, replay protection nonce, and
chain ID for improved performance## Formatting Prices and Sizes

Learn how to convert decimal prices and sizes to chain units using market
configuration
## [​](#package-address)Package Address

All Decibel transactions use the following package address:
CopyAsk AI```
0xb8a5788314451ce4d2fbbad32e1bad88d4184b73943b7fe5166eab93cf1a5a95

```

## [​](#helper-functions)Helper Functions

### [​](#get-market-address)Get Market Address

TypescriptPythonCopyAsk AI```
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

### [​](#get-primary-subaccount-address)Get Primary Subaccount Address

TypescriptPythonCopyAsk AI```
import { AccountAddress, createObjectAddress } from "@aptos-labs/ts-sdk";

function getPrimarySubaccountAddr(userAddress: AccountAddress): string {
const seed = new TextEncoder().encode("decibel_dex_primary");
return createObjectAddress(userAddress, seed).toString();
}

```

### [​](#get-perp-engine-global-address)Get Perp Engine Global Address

TypescriptPythonCopyAsk AI```
import { AccountAddress, createObjectAddress } from "@aptos-labs/ts-sdk";

function getPerpEngineGlobalAddress(): AccountAddress {
return createObjectAddress(
AccountAddress.fromString({PACKAGE}),
new TextEncoder().encode("GlobalPerpEngine")
);
}

```

[Optimized Transaction Building](/transactions/overview/optimized-building)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)