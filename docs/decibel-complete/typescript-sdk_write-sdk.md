---
source: https://docs.decibel.trade/typescript-sdk/write-sdk
title: write sdk
scraped: 2025-11-28T01:20:50.252Z
---

Write SDK - Decibel[Skip to main content](#content-area)[Decibel home page](/)Search...⌘K
- [Support](https://discord.gg/decibel)

Search...NavigationGetting StartedWrite SDK[Welcome](/)[Quick Start](/quickstart/overview)[Architecture](/architecture/perps/perps-contract-overview)[TypeScript SDK](/typescript-sdk/overview)[REST APIs](/api-reference/user/get-account-overview)[WebSocket APIs](/api-reference/websockets/accountoverview)[Transactions](/transactions/overview)##### Getting Started

- [TypeScript SDK Overview](/typescript-sdk/overview)
- [Installation](/typescript-sdk/installation)
- [Configuration](/typescript-sdk/configuration)
- [Read SDK](/typescript-sdk/read-sdk)
- [Write SDK](/typescript-sdk/write-sdk)
- [Advanced](/typescript-sdk/advanced)

On this page
- [Purpose](#purpose)
- [When to use](#when-to-use)
- [Formatting price and size](#formatting-price-and-size)
- [Initialization](#initialization)
- [Function reference](#function-reference)
- [Utilities](#utilities)
- [roundToTickSize](#roundtoticksize)
- [sendSubaccountTx](#sendsubaccounttx)
- [withSubaccount](#withsubaccount)
- [Subaccounts and collateral](#subaccounts-and-collateral)
- [renameSubaccount](#renamesubaccount)
- [createSubaccount](#createsubaccount)
- [deposit](#deposit)
- [withdraw](#withdraw)
- [configureUserSettingsForMarket](#configureusersettingsformarket)
- [buildDeactivateSubaccountTx](#builddeactivatesubaccounttx)
- [Orders and matching](#orders-and-matching)
- [placeOrder](#placeorder)
- [cancelOrder](#cancelorder)
- [cancelClientOrder](#cancelclientorder)
- [triggerMatching](#triggermatching)
- [placeTwapOrder](#placetwaporder)
- [cancelTwapOrder](#canceltwaporder)
- [Position TP/SL helpers](#position-tp/sl-helpers)
- [placeTpSlOrderForPosition](#placetpslorderforposition)
- [updateTpOrderForPosition](#updatetporderforposition)
- [updateSlOrderForPosition](#updateslorderforposition)
- [cancelTpSlOrderForPosition](#canceltpslorderforposition)
- [Delegation and builder fees](#delegation-and-builder-fees)
- [delegateTradingTo](#delegatetradingto)
- [revokeDelegation](#revokedelegation)
- [approveMaxBuilderFee](#approvemaxbuilderfee)
- [revokeMaxBuilderFee](#revokemaxbuilderfee)
- [Vault transactions](#vault-transactions)
- [buildCreateVaultTx](#buildcreatevaulttx)
- [buildActivateVaultTx](#buildactivatevaulttx)
- [buildDepositToVaultTx](#builddeposittovaulttx)
- [buildWithdrawFromVaultTx](#buildwithdrawfromvaulttx)
- [buildDelegateDexActionsToTx](#builddelegatedexactionstotx)
- [TWAP and notification helpers](#twap-and-notification-helpers)
- [Session keys and overrides](#session-keys-and-overrides)
- [Type references](#type-references)

Getting Started# Write SDK

Copy pageSubmit trades and manage subaccounts, positions, and vaults

Copy page## [​](#purpose)Purpose

- Place/cancel orders (limit/market/stop, TP/SL, TWAP).

- Manage collateral, subaccounts, delegations, and builder fees.

- Build vault-related transactions.

## [​](#when-to-use)When to use

- Use when you need to submit transactions or manage trading state.

Avoid embedding private keys in browsers. Prefer:

- Wallets/session keys and pass `accountOverride` for specific calls.

- Server-side orchestration where secrets are controlled.

## [​](#formatting-price-and-size)Formatting price and size

See the [formatting guide](../transactions/overview/formatting-prices-sizes#convert-decimal-amount-to-chain-units) for converting UI values into chain units (e.g., `amountToChainUnits`).
## [​](#initialization)Initialization

CopyAsk AI```
import { DecibelWriteDex, NETNA_CONFIG, GasPriceManager } from "@decibel/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const account = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});

const gas = new GasPriceManager(NETNA_CONFIG);
await gas.initialize(); // optional but recommended

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
  gasPriceManager: gas, // speeds up building with cached gas
  skipSimulate: false, // default: simulate to estimate gas
  noFeePayer: false, // default: use fee payer service
  timeDeltaMs: 0, // see Advanced for clock skew handling
});

```

## [​](#function-reference)Function reference

The tables below enumerate every callable helper exposed in `DecibelWriteDex` (plus the `roundToTickSize` utility) along with the argument types you should pass. All functions live on an instantiated `write` client unless otherwise noted.
### [​](#utilities)Utilities

#### [​](#roundtoticksize)`roundToTickSize`

Returns: `number`

- `price`: `number` (required) – price in chain units

- `tickSize`: `number` (required) – tick size in chain units

Snaps prices to the nearest tick multiple.
#### [​](#sendsubaccounttx)`sendSubaccountTx`

Returns: `Promise<CommittedTransactionResponse>`

- `sendTx`: `(subaccountAddr: string) => Promise<CommittedTransactionResponse>` (required)

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Resolves the intended subaccount before running the transaction.
#### [​](#withsubaccount)`withSubaccount`

Returns: `Promise<T>`

- `fn`: `(subaccountAddr: string) => Promise<T>` (required)

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Utility to obtain the resolved subaccount address inside arbitrary logic.
### [​](#subaccounts-and-collateral)Subaccounts and collateral

#### [​](#renamesubaccount)`renameSubaccount`

Returns: `Promise<void>`

- `subaccountAddress`: `string` (required)

- `newName`: `string` (required)

Renames a subaccount.
#### [​](#createsubaccount)`createSubaccount`

Returns: `Promise<CommittedTransactionResponse>`
No arguments. Creates a new subaccount for the owner.
#### [​](#deposit)`deposit`

Returns: `Promise<CommittedTransactionResponse>`

- `amount`: `number` (required) – USDC amount in u64 base units

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Deposits collateral to a subaccount.
#### [​](#withdraw)`withdraw`

Returns: `Promise<CommittedTransactionResponse>`

- `amount`: `number` (required) – USDC amount in u64 base units

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Withdraws collateral from a subaccount.
#### [​](#configureusersettingsformarket)`configureUserSettingsForMarket`

Returns: `Promise<CommittedTransactionResponse>`

- `marketAddr`: `string` (required)

- `subaccountAddr`: `string` (required)

- `isCross`: `boolean` (required)

- `userLeverage`: `number` (required)

Configures leverage and cross/isolated margin for a market.
#### [​](#builddeactivatesubaccounttx)`buildDeactivateSubaccountTx`

Returns: `Promise<SimpleTransaction>`

- `subaccountAddr`: `string` (required)

- `revokeAllDelegations`: `boolean` (optional) – defaults to `true`

- `signerAddress`: `AccountAddress` (required)

Builds a transaction to deactivate a subaccount.
CopyAsk AI```
import { getPrimarySubaccountAddr } from "@decibel/sdk";

const sub = getPrimarySubaccountAddr(account.accountAddress);

// Deposit and then withdraw collateral (u64 base units)
await write.deposit(1_000_000, sub);
await write.withdraw(500_000, sub); // Example requested

```

### [​](#orders-and-matching)Orders and matching

#### [​](#placeorder)`placeOrder`

Returns: `Promise<PlaceOrderResult>`

- `marketName`: `string` (required)

- `price`: `number` (required) – in chain units

- `size`: `number` (required) – in chain units

- `isBuy`: `boolean` (required)

- `timeInForce`: `TimeInForce` (required)

- `isReduceOnly`: `boolean` (required)

- `clientOrderId`: `string` (optional)

- `stopPrice`: `number` (optional)

- `tpTriggerPrice`: `number` (optional)

- `tpLimitPrice`: `number` (optional)

- `slTriggerPrice`: `number` (optional)

- `slLimitPrice`: `number` (optional)

- `builderAddr`: `string` (optional)

- `builderFee`: `number` (optional)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

- `tickSize`: `number` (optional) – auto-rounds prices to tick multiples

Places a limit, market, or conditional order.
#### [​](#cancelorder)`cancelOrder`

Returns: `Promise<CommittedTransactionResponse>`

- `orderId`: `number | string` (required)

- `marketName`: `string` (required if `marketAddr` not provided)

- `marketAddr`: `string` (required if `marketName` not provided)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Cancels an order by its ID.
#### [​](#cancelclientorder)`cancelClientOrder`

Returns: `Promise<CommittedTransactionResponse>`

- `clientOrderId`: `string` (required)

- `marketName`: `string` (required)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Cancels an order by client-provided ID.
#### [​](#triggermatching)`triggerMatching`

Returns: `Promise<{ success: boolean; transactionHash: string }>`

- `marketAddr`: `string` (required)

- `maxWorkUnit`: `number` (required)

Manually advances matching for a market.
#### [​](#placetwaporder)`placeTwapOrder`

Returns: `Promise<CommittedTransactionResponse>`

- `marketName`: `string` (required)

- `size`: `number` (required) – in chain units

- `isBuy`: `boolean` (required)

- `isReduceOnly`: `boolean` (required)

- `twapFrequencySeconds`: `number` (required)

- `twapDurationSeconds`: `number` (required)

- `builderAddress`: `string` (optional)

- `builderFees`: `number` (optional)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Schedules recurring order slices over time.
#### [​](#canceltwaporder)`cancelTwapOrder`

Returns: `Promise<CommittedTransactionResponse>`

- `orderId`: `string` (required)

- `marketAddr`: `string` (required)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Stops a TWAP order stream.
**`placeOrder` argument shape**
CopyAsk AI```
type PlaceOrderArgs = {
  marketName: string;
  price: number; // already converted to on-chain units
  size: number; // on-chain base units
  isBuy: boolean;
  timeInForce: TimeInForce;
  isReduceOnly: boolean;
  clientOrderId?: string;
  stopPrice?: number;
  tpTriggerPrice?: number;
  tpLimitPrice?: number;
  slTriggerPrice?: number;
  slLimitPrice?: number;
  builderAddr?: string;
  builderFee?: number;
  subaccountAddr?: string;
  accountOverride?: Account;
  tickSize?: number;
};

```

CopyAsk AI```
import { TimeInForce } from "@decibel/sdk";
// amountToChainUnits helper defined in docs/transactions/overview/formatting-prices-sizes.mdx

const orderResult = await write.placeOrder({
  marketName: "BTC-USD",
  price: amountToChainUnits(45_000),
  size: amountToChainUnits(0.25),
  isBuy: true,
  timeInForce: TimeInForce.GoodTillCanceled,
  isReduceOnly: false,
  clientOrderId: "dash-1234",
  builderAddr: "0x...builder",
  builderFee: 25, // 0.25 bps
  tickSize: 5, // optional snapping via roundToTickSize
});

if (orderResult.success && orderResult.orderId) {
  await write.cancelOrder({
    orderId: orderResult.orderId,
    marketName: "BTC-USD",
  });
}

await write.placeTwapOrder({
  marketName: "BTC-USD",
  size: amountToChainUnits(2),
  isBuy: true,
  isReduceOnly: false,
  twapFrequencySeconds: 30,
  twapDurationSeconds: 15 * 60,
});

```

### [​](#position-tp/sl-helpers)Position TP/SL helpers

#### [​](#placetpslorderforposition)`placeTpSlOrderForPosition`

Returns: `Promise<CommittedTransactionResponse>`

- `marketAddr`: `string` (required)

- `tpTriggerPrice`: `number` (optional)

- `tpLimitPrice`: `number` (optional)

- `tpSize`: `number` (optional)

- `slTriggerPrice`: `number` (optional)

- `slLimitPrice`: `number` (optional)

- `slSize`: `number` (optional)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

- `tickSize`: `number` (optional) – auto-rounds prices to tick multiples

Places both take-profit and stop-loss orders for a position.
#### [​](#updatetporderforposition)`updateTpOrderForPosition`

Returns: `Promise<CommittedTransactionResponse>`

- `marketAddr`: `string` (required)

- `prevOrderId`: `number | string` (required)

- `tpTriggerPrice`: `number` (optional)

- `tpLimitPrice`: `number` (optional)

- `tpSize`: `number` (optional)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Updates an existing take-profit order.
#### [​](#updateslorderforposition)`updateSlOrderForPosition`

Returns: `Promise<CommittedTransactionResponse>`

- `marketAddr`: `string` (required)

- `prevOrderId`: `number | string` (required)

- `slTriggerPrice`: `number` (optional)

- `slLimitPrice`: `number` (optional)

- `slSize`: `number` (optional)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Updates an existing stop-loss order.
#### [​](#canceltpslorderforposition)`cancelTpSlOrderForPosition`

Returns: `Promise<CommittedTransactionResponse>`

- `marketAddr`: `string` (required)

- `orderId`: `number | string` (required)

- `subaccountAddr`: `string` (optional)

- `accountOverride`: `Account` (optional)

Cancels a TP/SL order.
CopyAsk AI```
await write.placeTpSlOrderForPosition({
  marketAddr: "0x...market",
  // amountToChainUnits helper defined in docs/transactions/overview/formatting-prices-sizes.mdx
  tpTriggerPrice: amountToChainUnits(47_000),
  tpLimitPrice: amountToChainUnits(46_950),
  tpSize: amountToChainUnits(0.1),
  slTriggerPrice: amountToChainUnits(43_000),
  slLimitPrice: amountToChainUnits(43_050),
  slSize: amountToChainUnits(0.1),
  tickSize: 5, // Example requested
});

```

### [​](#delegation-and-builder-fees)Delegation and builder fees

#### [​](#delegatetradingto)`delegateTradingTo`

Returns: `Promise<CommittedTransactionResponse>`

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

- `accountToDelegateTo`: `string` (required)

Grants an operator permission to trade on behalf of the subaccount.
#### [​](#revokedelegation)`revokeDelegation`

Returns: `Promise<CommittedTransactionResponse>`

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

- `accountToRevoke`: `string` (required)

Removes trading delegation from an operator.
#### [​](#approvemaxbuilderfee)`approveMaxBuilderFee`

Returns: `Promise<CommittedTransactionResponse>`

- `builderAddr`: `string` (required)

- `maxFee`: `number` (required) – in basis points

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Approves a maximum builder fee for a subaccount.
#### [​](#revokemaxbuilderfee)`revokeMaxBuilderFee`

Returns: `Promise<CommittedTransactionResponse>`

- `builderAddr`: `string` (required)

- `subaccountAddr`: `string` (optional) – defaults to primary subaccount

Revokes a previously approved builder fee.
CopyAsk AI```
await write.delegateTradingTo({
  subaccountAddr: sub,
  accountToDelegateTo: "0x...operator",
});

await write.approveMaxBuilderFee({
  builderAddr: "0x...builder",
  maxFee: 100, // 1 bps
});

```

### [​](#vault-transactions)Vault transactions

All vault helpers accept `WithSignerAddress<T>` (payload plus `signerAddress`).
#### [​](#buildcreatevaulttx)`buildCreateVaultTx`

Returns: `Promise<SimpleTransaction>`

- `contributionAssetType`: `string` (optional)

- `vaultName`: `string` (required)

- `vaultDescription`: `string` (required)

- `vaultSocialLinks`: `string[]` (required)

- `vaultShareSymbol`: `string` (required)

- `vaultShareIconUri`: `string` (optional)

- `vaultShareProjectUri`: `string` (optional)

- `feeBps`: `number` (required)

- `feeIntervalS`: `number` (optional)

- `contributionLockupDurationS`: `number` (optional)

- `initialFunding`: `number` (required)

- `acceptsContributions`: `boolean` (optional)

- `delegateToCreator`: `boolean` (optional)

- `signerAddress`: `AccountAddress` (required)

Builds a transaction to create a new vault.
#### [​](#buildactivatevaulttx)`buildActivateVaultTx`

Returns: `Promise<SimpleTransaction>`

- `vaultAddress`: `string` (required)

- `additionalFunding`: `number` (optional)

- `signerAddress`: `AccountAddress` (required)

Builds a transaction to activate a vault.
#### [​](#builddeposittovaulttx)`buildDepositToVaultTx`

Returns: `Promise<SimpleTransaction>`

- `vaultAddress`: `string` (required)

- `amount`: `number` (required)

- `signerAddress`: `AccountAddress` (required)

Builds a transaction to deposit funds into a vault.
#### [​](#buildwithdrawfromvaulttx)`buildWithdrawFromVaultTx`

Returns: `Promise<SimpleTransaction>`

- `vaultAddress`: `string` (required)

- `shares`: `number` (required)

- `signerAddress`: `AccountAddress` (required)

Builds a transaction to withdraw shares from a vault.
#### [​](#builddelegatedexactionstotx)`buildDelegateDexActionsToTx`

Returns: `Promise<SimpleTransaction>`

- `vaultAddress`: `string` (required)

- `accountToDelegateTo`: `string` (required)

- `signerAddress`: `AccountAddress` (required)

- `expirationTimestampSecs`: `number` (optional)

Builds a transaction to delegate DEX actions for a vault.
CopyAsk AI```
const buildTx = await write.buildCreateVaultTx({
  contributionAssetType: "0x1::fungible_asset::Metadata",
  vaultName: "My Vault",
  vaultDescription: "Strategy description",
  vaultSocialLinks: [],
  vaultShareSymbol: "MVS",
  feeBps: 0,
  initialFunding: 0,
  signerAddress: account.accountAddress,
});

const depositTx = await write.buildDepositToVaultTx({
  vaultAddress: "0x...vault",
  amount: 1_000_000,
  signerAddress: account.accountAddress,
});

```

### [​](#twap-and-notification-helpers)TWAP and notification helpers

`placeTwapOrder`, `cancelTwapOrder`, and the readers exposed under `read.userActiveTwaps` bridge the trading + monitoring workflow. For notification rendering, reference the Rust trading API docs.
## [​](#session-keys-and-overrides)Session keys and overrides

All transaction helpers accept an `accountOverride` to sign with a different account (e.g., a session key) while the SDK was constructed with the primary account:
CopyAsk AI```
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const session = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.SESSION_PRIVATE_KEY!),
});

await write.placeOrder({
  marketName: "BTC-USD",
  price: amountToChainUnits(45_100),
  size: amountToChainUnits(0.5),
  isBuy: true,
  timeInForce: TimeInForce.GoodTillCanceled,
  isReduceOnly: false,
  builderAddr: "0x...builder",
  builderFee: 25,
  accountOverride: session,
});

```

## [​](#type-references)Type references

CopyAsk AI```
// RenameSubaccountArgs
type RenameSubaccountArgs = {
  subaccountAddress: string;
  newName: string;
};

// Utility used throughout builder helpers
type WithSignerAddress<T> = T & {
  signerAddress: AccountAddress;
};

// CreateVaultArgs (see src/read/types.ts)
type CreateVaultArgs = {
  contributionAssetType?: string;
  vaultName: string;
  vaultDescription: string;
  vaultSocialLinks: string[];
  vaultShareSymbol: string;
  vaultShareIconUri?: string;
  vaultShareProjectUri?: string;
  feeBps: number;
  feeIntervalS?: number;
  contributionLockupDurationS?: number;
  initialFunding: number;
  acceptsContributions?: boolean;
  delegateToCreator?: boolean;
};

type ActivateVaultArgs = {
  vaultAddress: string;
  additionalFunding?: number;
};

type DepositToVaultArgs = {
  vaultAddress: string;
  amount: number;
};

type WithdrawFromVaultArgs = {
  vaultAddress: string;
  shares: number;
};

```

[Read SDK](/typescript-sdk/read-sdk)[Advanced](/typescript-sdk/advanced)⌘I[x](https://x.com/DecibelTrade)[Powered by Mintlify](https://www.mintlify.com?utm_campaign=poweredBy&utm_medium=referral&utm_source=aptoslabs)