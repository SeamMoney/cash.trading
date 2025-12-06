# Decibel Smart Contract Error Codes

This document maps Decibel Move contract error codes to their meanings and relates them to issues we've encountered in the DECIBRRR bot.

## Quick Reference: Common Errors We've Hit

| Error Code | Module | Error Name | What It Means | Our Experience |
|------------|--------|------------|---------------|----------------|
| **4** | `perp_market_config` | `ESIZE_NOT_RESPECTING_MIN_SIZE` | Order size < min_size | Hit when placing tiny orders. Solution: Check `min_size` for each market |
| **5** | `perp_engine` | `EMARKET_HALTED` | Exchange is not open | Testnet maintenance. Just wait and retry |
| **6** | `perp_market_config` | `EPRICE_NOT_RESPECTING_TICKER_SIZE` | Price not multiple of ticker_size | Must round price to ticker_size |
| **8** | `dex_accounts` | `ENOT_SUBACCOUNT_OWNER_OR_LACKS_PERP_TRADING_PERMISSIONS` | No delegation | User hasn't delegated to bot operator |
| **15** | `dex_accounts` | `ESUBACCOUNT_IS_NOT_ACTIVE` | Inactive subaccount | Subaccount needs to be activated first |

---

## Full Error Code Reference

### `place_order_to_subaccount`

This is our main order placement function for IOC closes.

| Code | Module | Error Name | When It Occurs | Notes |
|------|--------|------------|----------------|-------|
| 1 | `builder_code_registry` | `EINVALID_AMOUNT` | Builder fees <= 0 | Don't set builder fees if not using |
| 1 | `tp_sl_utils` | `EINVALID_TP_SL_PARAMETERS` | Invalid TP/SL parameters | Check TP/SL logic |
| 1 | `order_placement_utils` | `EINVALID_MATCH_COUNT` | Match count validation error | Internal matching issue |
| 1 | `clearinghouse_perp` | `EINVALID_ARGUMENT` | Invalid argument | Generic - check all params |
| 2 | `clearinghouse_perp` | `EINVALID_SIZE_IS_ZERO` | Size == 0 in settlement | Size can't be zero |
| 3 | `clearinghouse_perp` | `EINVALID_SIZE_IS_TOO_LARGE` | Size too large | Reduce position size |
| 4 | `builder_code_registry` | `EINVALID_MAX_FEE` | Builder fees exceed max fee | Lower builder fee |
| **4** | `perp_market_config` | `ESIZE_NOT_RESPECTING_MIN_SIZE` | Size < min_size | **COMMON**: Must meet min order size |
| 4 | `pending_order_tracker` | `E_MAX_REDUCE_ONLY_ORDERS_EXCEEDED` | Too many reduce-only orders | Cancel some pending reduce-only orders |
| **5** | `perp_engine` | `EMARKET_HALTED` | Exchange is not open | **COMMON**: Testnet maintenance |
| 5 | `clearinghouse_perp` | `EINVALID_PRICE_IS_TOO_LARGE` | Price too large | Price overflow - reduce price |
| 5 | `builder_code_registry` | `EBUILDER_NOT_REGISTERED` | Builder not registered | Don't use builder if not registered |
| 5 | `pending_order_tracker` | `E_INVALID_REDUCE_ONLY_ORDER` | Invalid reduce-only order | Can't reduce non-existent position |
| **6** | `perp_market_config` | `EPRICE_NOT_RESPECTING_TICKER_SIZE` | Price not multiple of ticker_size | **COMMON**: Round price properly |
| **8** | `dex_accounts` | `ENOT_SUBACCOUNT_OWNER_OR_LACKS_PERP_TRADING_PERMISSIONS` | Signer lacks trading permissions | **COMMON**: User needs to delegate |
| 8 | `clearinghouse_perp` | `EINVALID_SETTLE_RESULT` | Invalid settlement result | Internal settlement error |
| 8 | `pending_order_tracker` | `EMAX_FIXED_SIZED_PENDING_REQS_HIT` | Max fixed-size pending requests exceeded | Too many pending orders |
| 9 | `pending_order_tracker` | `EFULL_SIZED_PENDING_REQ_EXISTS` | Full-sized pending request exists | Wait for existing order to fill |
| 10 | `perp_market_config` | `EINVALID_PRICE` | Price == 0 | Price can't be zero |
| 10 | `pending_order_tracker` | `EINVALID_TP_SL_SIZE` | Invalid TP/SL size | Check TP/SL size params |
| 10 | `clearinghouse_perp` | `EINVALID_SETTLE_OPEN_INTEREST_DELTA_NEGATIVE` | Negative open interest delta | Internal OI tracking issue |
| 11 | `perp_market_config` | `EINVALID_SIZE` | Size == 0 | Size can't be zero |
| 12 | `perp_market_config` | `EORDER_SIZE_TOO_LARGE` | Price × size too large | Notional too large - reduce size |
| 12 | `async_matching_engine` | `EINVALID_TP_SL_FOR_REDUCE_ONLY` | TP/SL with reduce_only | Can't use TP/SL with reduce_only |
| 13 | `async_matching_engine` | `EINVALID_TP_SL_WITH_TRIGGER_CONDITION` | TP/SL with stop_price | Invalid combo |
| 13 | `clearinghouse_perp` | `ESELF_TRADE_NOT_ALLOWED` | Taker == maker | Can't trade with yourself |
| 14 | `async_matching_engine` | `EINVALID_STOP_PRICE` | Invalid stop_price | Check stop price value |
| **15** | `dex_accounts` | `ESUBACCOUNT_IS_NOT_ACTIVE` | Subaccount is inactive | **IMPORTANT**: Activate subaccount first |
| 15 | `clearinghouse_perp` | `ENOT_REDUCE_ONLY` | Not reduce-only when expected | Order should be reduce_only but isn't |
| 16 | `async_matching_engine` | `EINVALD_WORK_UNITS_PER_TRIGGER` | Invalid work units | Internal - use defaults |

### `place_twap_order_to_subaccount`

Used for opening positions (TWAP has better fill on testnet).

| Code | Module | Error Name | When It Occurs |
|------|--------|------------|----------------|
| 1 | `clearinghouse_perp` | `EINVALID_ARGUMENT` | Prices/sizes length mismatch |
| 3 | `clearinghouse_perp` | `EINVALID_SIZE_IS_TOO_LARGE` | Total size exceeds I64_MAX |
| **4** | `perp_market_config` | `ESIZE_NOT_RESPECTING_MIN_SIZE` | Any size < min_size |
| **5** | `perp_engine` | `EMARKET_HALTED` | Exchange is not open |
| 5 | `clearinghouse_perp` | `EINVALID_PRICE_IS_TOO_LARGE` | Effective price exceeds I64_MAX |
| **6** | `perp_market_config` | `EPRICE_NOT_RESPECTING_TICKER_SIZE` | Any price not multiple of ticker_size |
| **8** | `dex_accounts` | `ENOT_SUBACCOUNT_OWNER_OR_LACKS_PERP_TRADING_PERMISSIONS` | Signer lacks trading permissions |
| 10 | `perp_market_config` | `EINVALID_PRICE` | Any price == 0 |
| 11 | `perp_market_config` | `EINVALID_SIZE` | Any size == 0 |
| 12 | `perp_market_config` | `EORDER_SIZE_TOO_LARGE` | Any price × size too large |
| 13 | `perp_market_config` | `EPRICE_SIZES_LENGTH_MISMATCH` | Prices length != sizes length |
| **15** | `dex_accounts` | `ESUBACCOUNT_IS_NOT_ACTIVE` | Subaccount is inactive |
| 16 | `async_matching_engine` | `EINVALD_WORK_UNITS_PER_TRIGGER` | Invalid work units |

### `cancel_twap_orders_to_subaccount`

Used when stopping bot to cancel pending TWAPs.

| Code | Module | Error Name | When It Occurs |
|------|--------|------------|----------------|
| **5** | `perp_engine` | `EMARKET_HALTED` | Exchange is not open |
| **8** | `dex_accounts` | `ENOT_SUBACCOUNT_OWNER_OR_LACKS_PERP_TRADING_PERMISSIONS` | Signer lacks trading permissions |
| **15** | `dex_accounts` | `ESUBACCOUNT_IS_NOT_ACTIVE` | Subaccount is inactive |

### `cancel_client_order_to_subaccount`

For cancelling specific orders by client_order_id.

| Code | Module | Error Name | When It Occurs |
|------|--------|------------|----------------|
| 2 | `pending_order_tracker` | `E_MARKET_NOT_FOUND` | Market not found in account's pending orders |
| 3 | `pending_order_tracker` | `E_INVALID_ORDER_CLEANUP_SIZE` | Invalid order cleanup size (size mismatch) |
| **5** | `perp_engine` | `EMARKET_HALTED` | Exchange is not open |
| 16 | `async_matching_engine` | `EINVALD_WORK_UNITS_PER_TRIGGER` | Invalid work units |

---

## Errors We've Encountered in Production

### 1. Permission Errors (Code 8)

**Error**: `ENOT_SUBACCOUNT_OWNER_OR_LACKS_PERP_TRADING_PERMISSIONS`

**Cause**: Bot operator trying to trade on behalf of user who hasn't delegated permissions.

**Solution**:
```typescript
// Check delegation before trading
const hasDelegation = await checkDelegation(userSubaccount, BOT_OPERATOR)
if (!hasDelegation) {
  throw new Error('User must delegate trading permissions first')
}
```

**Our implementation**: `app/api/bot/check-delegation/route.ts`

### 2. Price Ticker Size Errors (Code 6)

**Error**: `EPRICE_NOT_RESPECTING_TICKER_SIZE`

**Cause**: Price not rounded to market's ticker size.

**Solution**:
```typescript
// Round price to ticker size
function roundPriceToTickerSize(price: number, tickerSize: number): number {
  return Math.floor(price / tickerSize) * tickerSize
}

// For BTC/USD: tickerSize = 100000 (0.1 USD in 6 decimals)
const limitPrice = roundPriceToTickerSize(rawPrice * 1e6, 100000)
```

**Our implementation**: `lib/bot-engine.ts:roundPriceToTickerSize()`

### 3. Minimum Size Errors (Code 4)

**Error**: `ESIZE_NOT_RESPECTING_MIN_SIZE`

**Cause**: Order size below market minimum.

**Solution**:
```typescript
// Check minimum size before placing order
const minSize = getMarketMinSize(market)
if (orderSize < minSize) {
  console.log(`Size ${orderSize} below minimum ${minSize}`)
  return // Skip this order
}
```

### 4. Market Halted Errors (Code 5)

**Error**: `EMARKET_HALTED`

**Cause**: Testnet maintenance or exchange temporarily closed.

**Solution**: Retry with exponential backoff
```typescript
const MAX_RETRIES = 3
for (let i = 0; i < MAX_RETRIES; i++) {
  try {
    return await placeOrder()
  } catch (e) {
    if (e.message.includes('EMARKET_HALTED')) {
      await sleep(Math.pow(2, i) * 1000) // 1s, 2s, 4s
      continue
    }
    throw e
  }
}
```

### 5. Reduce-Only Errors (Code 5, 15)

**Error**: `E_INVALID_REDUCE_ONLY_ORDER` or `ENOT_REDUCE_ONLY`

**Cause**:
- Trying to reduce a position that doesn't exist
- reduce_only=true but order would increase position

**Solution**: Always check position exists before sending reduce_only order
```typescript
const position = await getOnChainPosition()
if (!position || position.size === 0) {
  console.log('No position to reduce')
  return
}
// Now safe to send reduce_only order
```

---

## Error Handling Best Practices

### 1. Parse VM Status

```typescript
if (!executedTxn.success) {
  const vmStatus = executedTxn.vm_status
  // Extract error code from vm_status string
  // e.g., "Move abort in 0x...::perp_market_config: ESIZE_NOT_RESPECTING_MIN_SIZE(0x4)"
  console.error(`Transaction failed: ${vmStatus}`)

  // Handle specific errors
  if (vmStatus.includes('EMARKET_HALTED')) {
    // Retry later
  } else if (vmStatus.includes('ENOT_SUBACCOUNT_OWNER')) {
    // Need delegation
  }
}
```

### 2. Pre-validate Orders

Before submitting, validate:
- [ ] Price > 0 and multiple of ticker_size
- [ ] Size > 0 and >= min_size
- [ ] Price × Size not too large
- [ ] User has delegated permissions
- [ ] Subaccount is active
- [ ] If reduce_only, position exists

### 3. Log Error Codes for Debugging

```typescript
catch (error) {
  console.error('Order failed:', {
    function: 'place_order_to_subaccount',
    error: error.message,
    params: { price, size, isLong, reduceOnly },
    vmStatus: error.vm_status
  })
}
```

---

## Market-Specific Constraints

| Market | Min Size | Ticker Size | Max Leverage | Size Decimals | Price Decimals |
|--------|----------|-------------|--------------|---------------|----------------|
| BTC/USD | TBD | 100000 (0.1 USD) | 40x | 8 | 6 |
| ETH/USD | TBD | TBD | 20x | 7 | 6 |
| SOL/USD | TBD | TBD | 20x | 6 | 6 |
| APT/USD | TBD | TBD | 10x | 6 | 6 |

**Note**: Min sizes should be fetched from Decibel API - ask Sean for endpoint.

---

## Related Files in Codebase

- `lib/bot-engine.ts` - Main trading logic with error handling
- `lib/decibel-client.ts` - Market configs (hardcoded, should use API)
- `app/api/bot/check-delegation/route.ts` - Permission checking
- `app/api/bot/stop/route.ts` - TWAP cancellation with error handling

---

*Last updated: December 2025*
*Source: Decibel Smart Contract Error Codes PDF*
