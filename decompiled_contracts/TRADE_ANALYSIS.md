# Trade Transaction Analysis

## Transaction Details
- **Hash**: `0x5ccd7bc6eb9d505b63de10895c2727577452d9b3a97d37dd64b1a185f91af526`
- **Version**: 7332347560
- **Status**: ✅ Executed successfully
- **Gas Used**: 108 units
- **Timestamp**: 1767816687675539 (microseconds)

## Contract Used
**Contract 2 (Newer)**: `0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844`

## Your Trade Details

| Field | Value |
|-------|-------|
| **Your Account** | `0x590b5b49255e024050e6172868b19d1c8694070fe97658eecc962c98bc842869` |
| **Action** | CloseShort (Market Close) |
| **Market** | BTC/USD (`0xdb8c5e968efa1b4dcbb4aaa7e4389358768d9b26bd126d5fe1a33e0aa076c380`) |
| **Leverage** | 40x |
| **Order Type** | IOC (Immediate or Cancel) |

### Position Closed
| Metric | Value | Interpretation |
|--------|-------|----------------|
| **Entry Price** | 90,986,100,000 | ~$90,986.10 |
| **Exit Price** | 91,031,400,000 | ~$91,031.40 |
| **Size** | 43,496,680 | ~0.00043 BTC |
| **Direction** | Short | Betting price goes down |

### P&L Breakdown
| Component | Raw Value | Interpretation |
|-----------|-----------|----------------|
| **Realized PnL** | -19,689,902 | **Loss of ~$19.69** |
| **Realized Funding** | 14,095 | Funding cost |
| **Trading Fee** | 13,462,516 | ~$13.46 fee (taker) |
| **Total Cost** | ~$33.15 | PnL + Fee |

### Why You Lost
- You were **SHORT** at $90,986.10
- Price moved **UP** to $91,031.40 (+$45.30)
- Short positions lose when price increases
- Price moved against you by ~0.05%
- At 40x leverage: 0.05% × 40 = ~2% loss on margin

## Position After Trade
```json
{
  "size": "0",           // Position fully closed
  "is_long": false,
  "user_leverage": 40,
  "avg_acquire_entry_px": "90986100000"  // Historical reference
}
```

## Counterparty (Market Maker)
Your order was filled by market maker:
- **Account**: `0xa186f97247c3c982e8085827ae4bf903e31824b0d3d0701c1d6644edb8680af9`
- **Action**: OpenShort (took the other side of your buy-to-close)
- **Fee**: 0 (maker rebate)

## Fee Flow
```
Your Account → Fee Treasury → Fee Recipient
     $13.46 USDC trading fee
```

The fee was transferred to: `0x2f78f3edc34ea1eff678ace5dcf8bd355c6be30dc443043c8a87a51a73c62512`

## Order Book State
The transaction also shows a market maker placing a bulk order with 10 bid/ask levels:

**Best Bid**: $91,013.10 (size: 199,771,250)
**Best Ask**: $91,031.40 (size: 199,731,300) ← You filled here

Spread: ~$18.30 (~0.02%)

## Key Events in Order
1. `BulkOrderPlacedEvent` - MM places bid/ask ladder
2. `OrderEvent` - Your IOC buy order placed
3. `CollateralBalanceChangeEvent` - PnL applied (-$19.69)
4. `TradeEvent` - Your CloseShort executed
5. `PositionUpdateEvent` - Your position → 0
6. `TradeEvent` - MM's OpenShort (counterparty)
7. `CollateralBalanceChangeEvent` - Fee deducted (-$13.46)
8. `FungibleAsset::Withdraw/Deposit` - Fee transfer
9. `OpenInterestUpdateEvent` - OI decreased
10. `OrderEvent` - Your order status → FILLED
11. `BulkOrderFilledEvent` - MM order partially filled

## Summary
You closed a 40x leveraged short BTC position at a small loss. The price moved against you by ~$45, resulting in a ~$19.69 realized loss plus ~$13.46 in taker fees. Your position is now flat (size = 0).
