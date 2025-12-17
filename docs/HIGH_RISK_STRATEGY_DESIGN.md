# High Risk Strategy - Fast IOC Implementation Design

## Overview

Redesign the `high_risk` strategy to use SDK's IOC (Immediate Or Cancel) orders for instant entry/exit instead of slow TWAP orders.

**Goal**: Maximize PnL and volume for the trading competition by capturing quick scalps.

---

## Current vs New Approach

| Aspect | Current (TWAP) | New (IOC + TP/SL) |
|--------|----------------|-------------------|
| Entry | TWAP 1-2 min | IOC instant |
| Exit trigger | Poll price, manual close | On-chain TP/SL auto-trigger |
| Exit execution | TWAP 1-2 min | IOC instant |
| Round-trip time | 2-4 minutes | Seconds |
| Liquidity risk | Low (TWAP guaranteed) | High (IOC may not fill) |

---

## State Machine

```
┌─────────────┐
│  NO_POSITION │◄────────────────────────────────┐
└──────┬──────┘                                  │
       │                                         │
       │ Place IOC Open                          │
       ▼                                         │
┌─────────────┐                                  │
│ IOC_PENDING │                                  │
└──────┬──────┘                                  │
       │                                         │
       ├─── IOC Filled ───►┌─────────────┐       │
       │                   │ POSITION_OPEN│       │
       │                   │ (TP/SL Active)│      │
       │                   └──────┬──────┘       │
       │                          │              │
       │                          ├── TP Hit ────┤
       │                          ├── SL Hit ────┤
       │                          └── Force Close┤
       │                                         │
       └─── IOC Not Filled ──► Fallback TWAP ───┘
```

---

## Test Cases

### ENTRY SCENARIOS

#### TC1: IOC Opens Successfully
```
Given: No existing position, bias=long
When: IOC order placed with 2% slippage
Then:
  - Order fills instantly
  - Position exists on-chain
  - TP/SL orders placed
  - DB updated with position details
```

#### TC2: IOC Partial Fill
```
Given: No existing position, IOC for 0.001 BTC
When: Only 0.0005 BTC liquidity available
Then:
  - Partial fill recorded
  - TP/SL sized for ACTUAL fill (0.0005 BTC)
  - Remaining unfilled portion cancelled
  - DB reflects actual position size
```

#### TC3: IOC No Fill (No Liquidity)
```
Given: No existing position, very thin order book
When: IOC placed but no matching orders
Then:
  - IOC cancelled (no fill)
  - Fallback to TWAP order
  - Log warning about liquidity
  - DB tracks TWAP pending state
```

#### TC4: IOC Transaction Fails
```
Given: No existing position
When: Transaction fails (gas, network, etc.)
Then:
  - Error caught and logged
  - No position opened
  - Retry on next tick
  - Error message saved to DB
```

### EXIT SCENARIOS (TP/SL)

#### TC5: Take Profit Triggers
```
Given: Long position at $100,000, TP at $100,030 (0.03%)
When: Mark price reaches $100,030
Then:
  - TP order auto-triggers on-chain
  - Position closes at ~$100,030
  - PnL: +$30 per BTC (before fees)
  - Volume counted (position value)
  - Bot detects closure, updates DB
```

#### TC6: Stop Loss Triggers
```
Given: Long position at $100,000, SL at $99,980 (0.02%)
When: Mark price drops to $99,980
Then:
  - SL order auto-triggers on-chain
  - Position closes at ~$99,980
  - PnL: -$20 per BTC (limited loss)
  - Volume counted
  - Bot detects closure, updates DB
```

#### TC7: Neither TP/SL Triggers - Manual Force Close
```
Given: Position open, volume target reached
When: Bot tick detects volume >= target
Then:
  - Cancel existing TP/SL orders
  - Place IOC close order
  - If IOC fails, fallback to TWAP close
  - Bot stops after position fully closed
```

#### TC8: TP/SL Placement Fails
```
Given: Position opened successfully
When: TP/SL placement fails (max 10 limit, network error)
Then:
  - Log error but don't panic
  - Fall back to manual monitoring mode
  - Poll price and close manually when target hit
  - Attempt to place TP/SL on next tick
```

### EDGE CASES

#### TC9: Position Already Exists (User's Manual Trade)
```
Given: User has existing BTC long position (not from bot)
When: Bot starts with high_risk strategy
Then:
  - Bot detects existing position
  - Bot should track it OR wait for it to close
  - Decision: Track and manage it (treat as bot's position)
  - Place TP/SL for existing position
```

#### TC10: Bot Position Exists from Previous Session
```
Given: Bot crashed/restarted with open position
When: Bot resumes
Then:
  - Check on-chain position
  - Sync DB with on-chain state
  - Resume monitoring/management
  - Re-place TP/SL if missing
```

#### TC11: Price Gaps Through TP/SL
```
Given: Long at $100k, TP at $100.03k, SL at $99.98k
When: Price gaps from $100k to $99.90k (past SL)
Then:
  - SL triggers at $99.90k (worse than target)
  - Actual PnL worse than expected
  - This is normal market risk - accept it
```

#### TC12: Rapid Price Movement
```
Given: Position open with TP/SL
When: Price spikes up then down rapidly
Then:
  - TP might trigger on spike
  - OR SL might trigger on drop
  - On-chain TP/SL handles this automatically
  - Bot just needs to detect the closure
```

#### TC13: Multiple Ticks Overlap
```
Given: Tick 1 places IOC open order
When: Tick 2 fires before Tick 1 completes
Then:
  - Rate limiting prevents double-open
  - Check pending order state
  - Skip if order in flight
```

#### TC14: Max 10 TP/SL Limit Hit
```
Given: 10 TP/SL orders already exist for market
When: Bot tries to place new TP/SL
Then:
  - Error: EMAX_FIXED_SIZED_PENDING_REQS_HIT
  - Cancel oldest TP/SL orders first
  - Retry placement
  - Log warning
```

#### TC15: Wrong Direction Position
```
Given: Bot bias=long, but short position exists
When: Bot tick runs
Then:
  - Detect direction mismatch
  - Close existing position first
  - Then open correct direction
```

### COMPETITION-SPECIFIC

#### TC16: Maximize PnL - Tight Targets
```
Given: 40x leverage, entry at $100k
When: TP = +0.03% ($100,030), SL = -0.02% ($99,980)
Then:
  - Leveraged PnL on TP: +1.2%
  - Leveraged PnL on SL: -0.8%
  - Win rate needed for profit: >40%
  - Each round-trip generates volume
```

#### TC17: Volume Counting
```
Given: Position size = 0.001 BTC at $100k
When: Position closes (TP or SL)
Then:
  - Volume = 0.001 * $100k = $100
  - Only count on CLOSE (not open)
  - This prevents double-counting
```

---

## Risk Parameters

```typescript
const HIGH_RISK_CONFIG = {
  // Slippage for IOC orders (aggressive pricing)
  IOC_SLIPPAGE_PCT: 0.02,  // 2% - ensures fill on testnet

  // TP/SL targets (price change, not leveraged PnL)
  PROFIT_TARGET_PCT: 0.0003,  // 0.03% price move
  STOP_LOSS_PCT: 0.0002,      // 0.02% price move

  // With 40x leverage:
  // TP: 0.03% * 40 = +1.2% leveraged profit
  // SL: 0.02% * 40 = -0.8% leveraged loss

  // Timeouts
  IOC_TIMEOUT_MS: 5000,       // Wait 5s for IOC to fill
  POSITION_CHECK_INTERVAL_MS: 3000,  // Check position every 3s

  // Fallback
  USE_TWAP_FALLBACK: true,    // Fall back to TWAP if IOC fails
  TWAP_DURATION_SEC: 60,      // 1 min TWAP as fallback

  // Capital allocation
  CAPITAL_USAGE_PCT: 0.80,    // Use 80% of capital
}
```

---

## Implementation Pseudocode

```typescript
async function executeHighRiskTrade(isLong: boolean): Promise<OrderResult> {
  // 1. Check existing position
  const position = await getOnChainPosition();

  if (position && position.size > 0) {
    // Position exists - monitor for TP/SL or manual close
    return await monitorExistingPosition(position);
  }

  // 2. No position - attempt IOC open
  const entryPrice = await getCurrentPrice();
  const { size, tpPrice, slPrice } = calculateOrderParams(entryPrice, isLong);

  try {
    // 3. Place IOC with attached TP/SL
    const result = await placeIOCWithTpSl({
      price: getAggressivePrice(entryPrice, isLong),
      size,
      isLong,
      tpTriggerPrice: tpPrice,
      slTriggerPrice: slPrice,
    });

    if (result.filled) {
      // 4. IOC filled - position open with TP/SL
      await updateDbPosition(result);
      return { success: true, ...result };
    } else {
      // 5. IOC didn't fill - fallback to TWAP
      console.log("IOC no fill, falling back to TWAP");
      return await placeTwapFallback(size, isLong);
    }
  } catch (error) {
    // 6. Error handling
    console.error("IOC failed:", error);
    return { success: false, error: error.message };
  }
}

async function monitorExistingPosition(position): Promise<OrderResult> {
  const currentPrice = await getCurrentPrice();
  const pnlPct = calculatePnL(position, currentPrice);

  // Check if TP/SL should have triggered
  // (On-chain TP/SL handles this, but we double-check)

  // Check if volume target reached - force close
  if (volumeTargetReached()) {
    return await forceClosePosition(position);
  }

  // Position still open, TP/SL active - just report status
  return {
    success: true,
    status: 'monitoring',
    pnl: pnlPct,
  };
}
```

---

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| IOC no fill | Result shows 0 filled | Fallback to TWAP |
| TP/SL placement fails | Catch error | Manual monitoring mode |
| Position out of sync | On-chain != DB | Sync DB to on-chain |
| Network timeout | Transaction timeout | Retry with backoff |
| Max TP/SL limit | Error code 0x10008 | Cancel old, retry |
| Price gaps past SL | Position closed at worse price | Accept - market risk |

---

## Monitoring & Logging

```typescript
// Key events to log
console.log(`🎯 [IOC] Opening ${isLong ? 'LONG' : 'SHORT'} at $${price}`);
console.log(`✅ [IOC] Filled ${filledSize}/${requestedSize}`);
console.log(`⚠️ [IOC] No fill - falling back to TWAP`);
console.log(`📊 [TP/SL] Set TP=$${tpPrice}, SL=$${slPrice}`);
console.log(`🎯 [TP] Triggered at $${triggerPrice}, PnL: +${pnl}%`);
console.log(`🛑 [SL] Triggered at $${triggerPrice}, PnL: ${pnl}%`);
console.log(`💰 [CLOSE] Position closed, volume: $${volume}`);
```

---

## Questions to Resolve

1. **Does SDK's placeOrder return fill info?** - Need to check if we can determine filled size
2. **Can we attach TP/SL to IOC order?** - Or must they be separate transactions?
3. **How does testnet liquidity look now?** - Need to test after reset
4. **What's the actual fill rate for IOC on testnet?** - May need to adjust slippage

---

## Next Steps

1. ✅ Design complete - this document
2. ⏳ Implement `placeIOCOrderWithTpSl()` method
3. ⏳ Add monitoring for TP/SL trigger detection
4. ⏳ Add fallback to TWAP
5. ⏳ Test on testnet after reset
6. ⏳ Tune parameters based on results
