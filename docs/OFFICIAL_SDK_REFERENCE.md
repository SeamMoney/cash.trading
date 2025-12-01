# Decibel Official SDK - Complete Reference

**Package**: `@decibel/sdk`
**Status**: ⚠️ Documented but NOT PUBLIC on npm yet
**Last Updated**: November 30, 2025

This document provides a complete reference for the **official Decibel TypeScript SDK** based on documentation scraped from https://docs.decibel.trade/typescript-sdk/

---

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Read SDK](#read-sdk)
4. [Write SDK](#write-sdk)
5. [Advanced Features](#advanced-features)
6. [Comparison with Custom SDK](#comparison-with-custom-sdk)
7. [Migration Guide](#migration-guide)

---

## Installation

### Package Installation

```bash
# npm
npm install @decibel/sdk @aptos-labs/ts-sdk zod

# pnpm
pnpm add @decibel/sdk @aptos-labs/ts-sdk zod

# yarn
yarn add @decibel/sdk @aptos-labs/ts-sdk zod
```

### Optional Dependencies

```bash
# TypeScript development in Node.js
npm install -D @types/ws
```

### Import Verification

```typescript
import {
  DecibelReadDex,
  DecibelWriteDex,
  NETNA_CONFIG,
  GasPriceManager
} from "@decibel/sdk";
```

---

## Configuration

### DecibelConfig Interface

```typescript
interface DecibelConfig {
  network: Network              // Aptos network (TESTNET, MAINNET, CUSTOM)
  fullnodeUrl: string          // Aptos fullnode endpoint
  tradingHttpUrl: string       // Decibel REST API base URL
  tradingWsUrl: string         // Decibel WebSocket URL
  gasStationUrl: string        // Fee payer service endpoint
  deployment: {
    package: string            // Decibel contract package address
    usdc: string              // USDC token address
    testc: string             // Test coin address
    perpEngineGlobal: string  // Perp engine global state
  }
  chainId?: number             // Optional: pre-configured chain ID
}
```

### Built-in Network Presets

```typescript
import { NETNA_CONFIG, LOCAL_CONFIG, DOCKER_CONFIG } from "@decibel/sdk";

// NETNA_CONFIG - Aptos testnet
// LOCAL_CONFIG - Local development
// DOCKER_CONFIG - Docker environment
```

### Custom Configuration

```typescript
import { type DecibelConfig } from "@decibel/sdk";
import { Network } from "@aptos-labs/ts-sdk";

const CUSTOM: DecibelConfig = {
  network: Network.CUSTOM,
  fullnodeUrl: "https://fullnode.example.com/v1",
  tradingHttpUrl: "https://api.example.com/decibel",
  tradingWsUrl: "wss://api.example.com/decibel/ws",
  gasStationUrl: "https://gasstation.example.com",
  deployment: {
    package: "0x...package",
    usdc: "0x...usdc",
    testc: "0x...testc",
    perpEngineGlobal: "0x...global",
  },
  chainId: 204,
};
```

### Node API Keys

```typescript
const read = new DecibelReadDex(NETNA_CONFIG, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
});

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
});
```

---

## Read SDK

### Overview

**Purpose**: Query market data and account state without signing transactions

**Features**:
- Market prices, depth, trades
- Candlestick/OHLC data
- User positions, orders, history
- WebSocket subscriptions
- No private keys required

### Initialization

```typescript
import { DecibelReadDex, NETNA_CONFIG } from "@decibel/sdk";

const read = new DecibelReadDex(NETNA_CONFIG, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY, // optional
  onWsError: (e) => console.warn("WS error", e), // optional
});
```

### Markets

```typescript
// Get all markets
const markets = await read.markets.getAll();

// Get specific market
const btc = await read.markets.getByName("BTC-USD");
```

### Prices

```typescript
// Get all prices
const allPrices = await read.marketPrices.getAll();

// Get specific price
const price = await read.marketPrices.getByName("BTC-USD");

// Subscribe to price updates
const unsubscribe = read.marketPrices.subscribeByName("BTC-USD", (msg) => {
  console.log("Price update", msg);
});

// Unsubscribe
unsubscribe();
```

### Order Book Depth

```typescript
const depth = await read.marketDepth.getByName("BTC-USD");
```

### Recent Trades

```typescript
const trades = await read.marketTrades.getByName("BTC-USD");
```

### Candlesticks

```typescript
import { CandlestickInterval } from "@decibel/sdk";

const candles = await read.candlesticks.getByName(
  "BTC-USD",
  CandlestickInterval.OneMinute,
  Date.now() - 60 * 60 * 1000,
  Date.now()
);

// Subscribe to candlestick updates
const unsub = read.candlesticks.subscribeByName(
  "BTC-USD",
  CandlestickInterval.FiveMinutes,
  (msg) => console.log("New candle", msg)
);
```

### Account Overview

```typescript
const overview = await read.accountOverview.getByAddr("0x...owner");
```

### Subaccounts

```typescript
const subs = await read.userSubaccounts.getByOwner("0x...owner");
```

### Orders

```typescript
const subAddr = "0x...subaccount";

// Open orders
const openOrders = await read.userOpenOrders.getBySubaccount(subAddr);

// Order history
const history = await read.userOrderHistory.getBySubaccount(subAddr);
```

### Positions

```typescript
// Get positions
const positions = await read.userPositions.getBySubaccount(subAddr);

// Subscribe to position updates
const stopPositions = read.userPositions.subscribeByAddr(subAddr, (data) => {
  data.positions.forEach((pos) => {
    console.log(pos.market_name, pos.open_size);
  });
});

// Stop streaming
stopPositions();
```

### Trade History

```typescript
const trades = await read.userTradeHistory.getBySubaccount(subAddr);
```

### TWAP Orders

```typescript
const activeTwaps = await read.userActiveTwaps.getBySubaccount(subAddr);
```

### Portfolio & Leaderboard

```typescript
// Portfolio chart
const portfolio = await read.portfolioChart.getByAddr(addr);

// Leaderboard
const leaderboard = await read.leaderboard.getTopUsers();
```

### Vaults

```typescript
// User-owned vaults
const myVaults = await read.vaults.getUserOwned(addr);

// All public vaults
const allVaults = await read.vaults.getAll();
```

### Delegations

```typescript
const delegations = await read.delegations.getForSubaccount(subAddr);
```

---

## Write SDK

### Overview

**Purpose**: Submit trading transactions and manage account state

**Features**:
- Place/cancel orders (limit, market, stop, TWAP)
- TP/SL (take profit / stop loss)
- Manage collateral and subaccounts
- Configure leverage and margin mode
- Delegation and builder fees
- Vault operations

### Initialization

```typescript
import { DecibelWriteDex, NETNA_CONFIG, GasPriceManager } from "@decibel/sdk";
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const account = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.PRIVATE_KEY!),
});

const gas = new GasPriceManager(NETNA_CONFIG);
await gas.initialize();

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
  gasPriceManager: gas,     // optional
  skipSimulate: false,      // simulate before submit
  noFeePayer: false,        // use Decibel's fee payer
  timeDeltaMs: 0,          // clock skew adjustment
});
```

### Price & Size Formatting

⚠️ **CRITICAL**: All prices and sizes must be in **chain units** (u64)

```typescript
// Convert decimal to chain units
function amountToChainUnits(amount: number, decimals: number = 8): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

// Examples
const price = amountToChainUnits(45_000);   // $45,000
const size = amountToChainUnits(0.25);      // 0.25 BTC
```

### Subaccounts

```typescript
import { getPrimarySubaccountAddr } from "@decibel/sdk";

// Create subaccount
await write.createSubaccount();

// Rename subaccount
await write.renameSubaccount(subAddr, "My Account");

// Get primary subaccount
const sub = getPrimarySubaccountAddr(account.accountAddress);
```

### Collateral Management

```typescript
// Deposit USDC
await write.deposit(1_000_000, sub); // 1 USDC (6 decimals)

// Withdraw USDC
await write.withdraw(500_000, sub);  // 0.5 USDC
```

### Leverage Configuration

```typescript
await write.configureUserSettingsForMarket(
  marketAddr,
  subaccountAddr,
  true,  // isCross (cross margin)
  10     // leverage (10x)
);
```

### Place Order

```typescript
import { TimeInForce } from "@decibel/sdk";

const result = await write.placeOrder({
  marketName: "BTC-USD",
  price: amountToChainUnits(45_000),
  size: amountToChainUnits(0.25),
  isBuy: true,
  timeInForce: TimeInForce.GoodTillCanceled,
  isReduceOnly: false,
  clientOrderId: "my-order-123",          // optional
  stopPrice: amountToChainUnits(44_000),  // optional
  builderAddr: "0x...builder",            // optional
  builderFee: 25,                         // optional (0.25 bps)
  subaccountAddr: sub,
  tickSize: 5,                            // optional auto-rounding
});

if (result.success && result.orderId) {
  console.log("Order ID:", result.orderId);
}
```

### Cancel Order

```typescript
// By order ID
await write.cancelOrder({
  orderId: result.orderId,
  marketName: "BTC-USD",
});

// By client order ID
await write.cancelClientOrder({
  clientOrderId: "my-order-123",
  marketName: "BTC-USD",
});
```

### TWAP Orders

```typescript
// Place TWAP
await write.placeTwapOrder({
  marketName: "BTC-USD",
  size: amountToChainUnits(2),
  isBuy: true,
  isReduceOnly: false,
  twapFrequencySeconds: 30,      // Order slice every 30s
  twapDurationSeconds: 15 * 60,  // Run for 15 minutes
  builderAddress: "0x...builder",
  builderFees: 25,
  subaccountAddr: sub,
});

// Cancel TWAP
await write.cancelTwapOrder({
  orderId: twapOrderId,
  marketAddr: marketAddress,
  subaccountAddr: sub,
});
```

### Take Profit / Stop Loss

```typescript
// Place TP/SL
await write.placeTpSlOrderForPosition({
  marketAddr: marketAddress,
  tpTriggerPrice: amountToChainUnits(47_000),
  tpLimitPrice: amountToChainUnits(46_950),
  tpSize: amountToChainUnits(0.1),
  slTriggerPrice: amountToChainUnits(43_000),
  slLimitPrice: amountToChainUnits(43_050),
  slSize: amountToChainUnits(0.1),
  subaccountAddr: sub,
  tickSize: 5,
});

// Update TP
await write.updateTpOrderForPosition({
  marketAddr: marketAddress,
  prevOrderId: existingOrderId,
  tpTriggerPrice: amountToChainUnits(48_000),
  tpLimitPrice: amountToChainUnits(47_950),
  subaccountAddr: sub,
});

// Update SL
await write.updateSlOrderForPosition({
  marketAddr: marketAddress,
  prevOrderId: existingOrderId,
  slTriggerPrice: amountToChainUnits(42_000),
  slLimitPrice: amountToChainUnits(42_050),
  subaccountAddr: sub,
});

// Cancel TP/SL
await write.cancelTpSlOrderForPosition({
  marketAddr: marketAddress,
  orderId: tpslOrderId,
  subaccountAddr: sub,
});
```

### Delegation

```typescript
// Delegate trading
await write.delegateTradingTo({
  subaccountAddr: sub,
  accountToDelegateTo: "0x...operator",
});

// Revoke delegation
await write.revokeDelegation({
  subaccountAddr: sub,
  accountToRevoke: "0x...operator",
});
```

### Builder Fees

```typescript
// Approve builder fee
await write.approveMaxBuilderFee({
  builderAddr: "0x...builder",
  maxFee: 100, // 1 bps
  subaccountAddr: sub,
});

// Revoke builder fee
await write.revokeMaxBuilderFee({
  builderAddr: "0x...builder",
  subaccountAddr: sub,
});
```

### Vault Operations

All vault methods return `Promise<SimpleTransaction>` for signing.

```typescript
// Create vault
const createTx = await write.buildCreateVaultTx({
  contributionAssetType: "0x1::fungible_asset::Metadata",
  vaultName: "My Vault",
  vaultDescription: "Description",
  vaultSocialLinks: ["https://twitter.com/..."],
  vaultShareSymbol: "MVS",
  feeBps: 100,
  initialFunding: 10_000_000,
  acceptsContributions: true,
  delegateToCreator: true,
  signerAddress: account.accountAddress,
});

// Deposit to vault
const depositTx = await write.buildDepositToVaultTx({
  vaultAddress: "0x...vault",
  amount: 1_000_000,
  signerAddress: account.accountAddress,
});

// Withdraw from vault
const withdrawTx = await write.buildWithdrawFromVaultTx({
  vaultAddress: "0x...vault",
  shares: 100_000,
  signerAddress: account.accountAddress,
});
```

### Utilities

```typescript
import { roundToTickSize } from "@decibel/sdk";

// Round price to tick size
const rounded = roundToTickSize(4500025000000, 5);

// Execute with subaccount helper
await write.sendSubaccountTx(
  async (subAddr) => {
    // Your transaction logic
    return committedTx;
  },
  optionalSubaccountAddr
);
```

---

## Advanced Features

### Gas Price Manager

Cache gas estimates for faster transaction building.

```typescript
import { GasPriceManager } from "@decibel/sdk";

const gas = new GasPriceManager(NETNA_CONFIG, {
  multiplier: 2,              // Gas multiplier
  refreshIntervalMs: 60_000,  // Refresh every 60s
});

await gas.initialize();

// Pass to Write SDK
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  gasPriceManager: gas,
});

// Always cleanup
gas.destroy();
```

### Fee Payer Configuration

```typescript
// Default: uses Decibel's fee payer service
const write = new DecibelWriteDex(NETNA_CONFIG, account);

// Direct submission (bypass fee payer)
const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  noFeePayer: true,
});
```

### Clock Skew Handling

```typescript
// If client time differs from server
const serverDeltaMs = serverTimeMs - Date.now();

const write = new DecibelWriteDex(NETNA_CONFIG, account, {
  timeDeltaMs: serverDeltaMs,
});
```

### Session Keys

Use different signing keys per transaction.

```typescript
import { Ed25519Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const session = new Ed25519Account({
  privateKey: new Ed25519PrivateKey(process.env.SESSION_KEY!),
});

await write.placeOrder({
  marketName: "BTC-USD",
  price: amountToChainUnits(45_000),
  size: amountToChainUnits(0.5),
  isBuy: true,
  timeInForce: TimeInForce.GoodTillCanceled,
  isReduceOnly: false,
  accountOverride: session, // Use session key
});
```

---

## Comparison with Custom SDK

| Feature | Official SDK | Our Custom SDK |
|---------|-------------|----------------|
| **Installation** | `npm install @decibel/sdk` | Built-in (lib/*) |
| **Read Operations** | `DecibelReadDex` class | Direct REST calls |
| **Write Operations** | `DecibelWriteDex` class | Manual entry functions |
| **Type Safety** | Full TypeScript types | Manual definitions |
| **Gas Optimization** | `GasPriceManager` | Manual estimation |
| **Fee Payer** | Built-in support | ❌ Not implemented |
| **WebSocket** | Built-in subscriptions | ❌ Not implemented |
| **Price Formatting** | `amountToChainUnits` helper | Manual conversion |
| **Tick Rounding** | `roundToTickSize` utility | ❌ Not implemented |
| **Session Keys** | `accountOverride` param | ❌ Not implemented |
| **Clock Skew** | `timeDeltaMs` option | ❌ Not implemented |
| **TP/SL Helpers** | Built-in methods | ❌ Not implemented |
| **Vault Operations** | Built-in methods | ❌ Not implemented |
| **Builder Fees** | Built-in management | ❌ Not implemented |

---

## Migration Guide

### When SDK Becomes Available

#### 1. Install Package

```bash
pnpm add @decibel/sdk @aptos-labs/ts-sdk zod
```

#### 2. Update Bot Engine

**Before** (`lib/bot-engine.ts`):
```typescript
import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk"

const transaction = await this.aptos.transaction.build.simple({
  sender: this.botAccount.accountAddress,
  data: {
    function: `${DECIBEL_PACKAGE}::dex_accounts::place_twap_order_to_subaccount`,
    typeArguments: [],
    functionArguments: [...],
  },
});
```

**After**:
```typescript
import { DecibelWriteDex, NETNA_CONFIG } from "@decibel/sdk"

const write = new DecibelWriteDex(NETNA_CONFIG, this.botAccount, {
  gasPriceManager: this.gas,
});

await write.placeTwapOrder({
  marketName: "BTC-USD",
  size: amountToChainUnits(orderSize),
  isBuy: isBuy,
  isReduceOnly: false,
  twapFrequencySeconds: 30,
  twapDurationSeconds: twapDuration,
  subaccountAddr: subaccount,
});
```

#### 3. Update Delegation

**Before** (`app/api/bot/delegate/route.ts`):
```typescript
return {
  type: 'entry_function_payload',
  function: `${DECIBEL_PACKAGE}::dex_accounts::delegate_trading_to_for_subaccount`,
  arguments: [subaccount, BOT_OPERATOR, "0"],
}
```

**After**:
```typescript
const write = new DecibelWriteDex(NETNA_CONFIG, userAccount);

await write.delegateTradingTo({
  subaccountAddr: subaccount,
  accountToDelegateTo: BOT_OPERATOR,
});
```

#### 4. Add Read SDK

**New functionality**:
```typescript
const read = new DecibelReadDex(NETNA_CONFIG);

// Get positions
const positions = await read.userPositions.getBySubaccount(subaccount);

// Get active TWAPs
const twaps = await read.userActiveTwaps.getBySubaccount(subaccount);

// Subscribe to price updates
const unsub = read.marketPrices.subscribeByName("BTC-USD", (msg) => {
  console.log("Price:", msg);
});
```

### Migration Benefits

✅ **Type Safety** - Full TypeScript definitions
✅ **Performance** - Gas caching, fee payer service
✅ **Reliability** - Battle-tested by Decibel
✅ **Features** - TP/SL, vaults, session keys
✅ **Maintenance** - Updates by Decibel team
✅ **WebSocket** - Real-time subscriptions

---

## Resources

- **Docs**: https://docs.decibel.trade/typescript-sdk
- **Aptos SDK**: https://aptos.dev/sdks/ts-sdk/
- **Discord**: https://discord.gg/decibel
- **Decibel DEX**: https://app.decibel.trade

---

**Status**: Waiting for `@decibel/sdk` to become public on npm 📦
