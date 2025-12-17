# Decibrrr Trading Bot - Current Status

**Last Updated**: December 16, 2025
**Status**: Ready for Competition (pending testnet reset)

---

## COMPLETED FEATURES

### Core Trading
- TWAP order placement via Decibel SDK
- IOC (Immediate-or-Cancel) orders with attached TP/SL
- Multi-strategy support: twap, high_risk, tx_spammer
- Automatic position management
- Bot persistence across server restarts

### SDK Integration (@decibeltrade/sdk v0.2.1)
- DecibelReadDex for market data
- DecibelWriteDex for order placement
- Dynamic market address resolution (survives testnet resets)
- Proper TimeInForce enum usage
- TP/SL orders with chain unit conversion

### High Risk Strategy (Competition Mode)
- Fast IOC entry for instant fills
- Attached TP/SL in single transaction
- Automatic fallback to TWAP if IOC doesn't fill
- Force close with IOC when targets hit

### Cloud Mode (Browser-Independent)
- Vercel Cron runs `/api/cron/bot-tick` every minute
- Bot state persisted to database
- UI shows cloud status indicator (green = cloud, yellow = browser-only)
- TP/SL triggers on-chain automatically (no polling needed)

### Backtesting Infrastructure
- lib/backtest.ts - Simulation engine
- app/api/backtest/route.ts - API endpoint
- scripts/run-backtest.mjs - CLI tool
- Parameter optimization support

---

## CODE QUALITY AUDIT (December 16, 2025)

### Dead Code Identified

| File/Function | Status | Notes |
|--------------|--------|-------|
| `lib/twap-bot.ts` | **UNUSED** | TWAPBot class not imported anywhere |
| `lib/calculations.ts` | **UNUSED** | Functions never called |
| `simplified_twap_bot.ts` | **UNUSED** | Example file at project root |
| `lib/decibel-sdk.ts` → `getWriteDexForAccount()` | **UNUSED** | Defined but never called |
| `lib/decibel-sdk.ts` → `getMarketAddressFromSDK()` | **UNUSED** | Defined but never called |
| `lib/decibel-ws.ts` | **SCRIPT-ONLY** | Only used by scripts/ |

### Active Code (Verified Working)
- `lib/bot-engine.ts` - Main trading logic
- `lib/bot-manager.ts` - Bot singleton management
- `lib/decibel-sdk.ts` → getReadDex, getAllMarketAddresses, getWriteDex
- `lib/backtest.ts` - Backtesting engine
- `lib/decibel-api.ts` - Stats route
- `lib/price-feed.ts` - Bot tick routes

---

## SDK VERIFICATION

### Correct Usage
| Method | Status | Notes |
|--------|--------|-------|
| `placeOrder` | OK | Uses TimeInForce.ImmediateOrCancel enum |
| `placeTpSlOrderForPosition` | OK | Chain unit conversion correct |
| `cancelTpSlOrderForPosition` | OK | |
| `cancelTwapOrder` | OK | |
| `markets.getAll` | OK | |
| `marketPrices.getByName` | OK | |
| `userOpenOrders.getByAddr` | OK | |

### SDK Configuration
```typescript
const writeDex = new DecibelWriteDex(TESTNET_CONFIG, account, {
  nodeApiKey: process.env.APTOS_NODE_API_KEY,
  skipSimulate: true,   // Faster transactions
  noFeePayer: true,     // Fee payer had issues per dev chat
});
```

### TimeInForce Values
```typescript
TimeInForce.GoodTillCanceled = 0
TimeInForce.PostOnly = 1
TimeInForce.ImmediateOrCancel = 2
```

---

## STRATEGY PARAMETERS

### High Risk Strategy (Updated after backtest)
```typescript
const IOC_SLIPPAGE_PCT = 0.005     // 0.5% slippage
const PROFIT_TARGET_PCT = 0.003    // 0.3% price move = +12% at 40x
const STOP_LOSS_PCT = 0.0015       // 0.15% price move = -6% at 40x
const CAPITAL_USAGE_PCT = 0.50     // Use 50% of capital
```

### Why These Parameters?
Previous parameters (0.03% TP, 0.02% SL) were guaranteed losers:
- Costs: ~0.12% (slippage + fees + spread)
- TP target: 0.03%
- Result: Costs > Profit target = 100% loss rate

New parameters ensure:
- TP target (0.3%) > Costs (0.12%) = Profit possible

---

## PENDING ITEMS

### Testnet Reset (Today - Dec 16, 2025)
- Testnet is being reset with new contract addresses
- SDK `getAllMarketAddresses()` will fetch new addresses automatically
- No code changes needed after reset

### Before Competition
- [ ] Verify testnet is back online
- [ ] Run SDK test endpoint to confirm connectivity
- [ ] Place test trade to verify flow
- [ ] Monitor first few high_risk trades

---

## IMPORTANT FILES

### Trading Core
```
lib/bot-engine.ts           - Main trading logic (all strategies)
lib/bot-manager.ts          - Bot singleton with DB persistence
lib/decibel-sdk.ts          - SDK singleton initialization
lib/backtest.ts             - Backtesting simulation engine
```

### API Routes
```
app/api/bot/start/route.ts  - Start bot
app/api/bot/stop/route.ts   - Stop bot
app/api/bot/tick/route.ts   - Manual tick
app/api/cron/bot-tick/route.ts - Cron tick
app/api/backtest/route.ts   - Run backtests
app/api/sdk-test/route.ts   - Verify SDK works
app/api/markets/refresh/route.ts - Update market addresses
```

### Documentation
```
docs/HIGH_RISK_STRATEGY_DESIGN.md - Test cases and strategy design
docs/DECIBEL_ERROR_CODES.md - Contract error codes
```

---

## REQUIREMENTS

- Node.js >= 20.9.0 (required for SDK ESM modules)
- Vercel uses Node 20 by default (production OK)
- Local dev: use `nvm use 20` if needed

---

## QUICK START

```bash
# Verify SDK connectivity (after testnet reset)
curl http://localhost:3000/api/sdk-test

# Run backtest
node scripts/run-backtest.mjs

# Start a high_risk bot
POST /api/bot/start
{
  "userWalletAddress": "0x...",
  "userSubaccount": "0x...",
  "capitalUSDC": 100,
  "volumeTargetUSDC": 10000,
  "bias": "neutral",
  "strategy": "high_risk",
  "market": "0x...",
  "marketName": "BTC/USD"
}
```
