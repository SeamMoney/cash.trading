# Decibel Contract Comparison Report

## Contract Addresses

| Label | Address | Upgrade # | Balance |
|-------|---------|-----------|---------|
| **Contract 1** (OLD) | `0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75` | 17 | ~1000 APT |
| **Contract 2** (NEW) | `0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844` | 4 | ~0.78 APT |

**Note**: Despite Contract 2 having a lower "Upgrade Number" (4 vs 17), it contains MORE features and newer code. This suggests Contract 2 is a newer deployment (fresh start) while Contract 1 has been upgraded many times from an older codebase.

---

## Summary Statistics

| Metric | Contract 1 | Contract 2 | Difference |
|--------|------------|------------|------------|
| Total Modules | 47 | 51 | +4 |
| perp_engine functions | 85 | 97 | +12 |
| vault functions | 31 | 34 | +3 |
| Packages | 3 | 4 | +1 (decibel_usdc) |

---

## New Modules in Contract 2 (5 modules)

### 1. `slippage_math.mv.move`
**Purpose**: Calculates limit prices with slippage protection

```move
public fun compute_limit_price_with_slippage(
    market: Object<PerpMarket>,
    price: u64,
    slippage: u64,
    precision: u64,
    is_buy: bool
): u64
```
- For buys: adds slippage to price (willing to pay more)
- For sells: subtracts slippage from price (willing to receive less)
- Rounds to market ticker size

### 2. `vault_api.mv.move`
**Purpose**: Public API for vault operations with async processing

Key functions:
- `create_and_fund_vault()` - Entry point to create and fund a vault in one tx
- `process_pending_requests()` - Process async vault work queue
- `contribute_funds()` - Add funds to vault
- `redeem_and_deposit_to_dex()` - Redeem shares and deposit to DEX

### 3. `async_vault_engine.mv.move`
**Purpose**: Async work queue for vault operations

Features:
- `PendingRequestKey` - Time-based priority queue
- `process_pending_requests()` - Batch process vault operations
- Handles vault progress tracking with time delays

### 4. `async_vault_work.mv.move`
**Purpose**: Work item definitions for async vault processing

Tracks:
- Pending redemption requests
- Vault state transitions
- Work scheduling

### 5. `position_view_types.mv.move`
**Purpose**: Read-only view types for position data

```move
enum PositionViewInfo {
    V1 {
        market: Object<PerpMarket>,
        size: u64,
        is_long: bool,
        user_leverage: u8,
        is_isolated: bool,
    }
}
```
Getter functions for each field.

---

## Removed Module from Contract 2 (1 module)

### `order.mv.move`
**Status**: Removed/Deprecated
**Reason**: Order functionality likely refactored into `perp_engine` or other modules

---

## New Functions in Contract 2

### perp_engine.mv.move (+12 functions)

| Function | Purpose |
|----------|---------|
| `view_position` | View position details |
| `list_positions` | List all positions for user |
| `cross_position_status` | Get cross-margin position status |
| `get_blp_pnl` | Get BLP (Backstop Liquidity Provider) PnL |
| `get_position_unrealized_funding_cost` | Calculate unrealized funding |
| `get_oracle_internal_snapshot` | Get oracle price snapshot |
| `get_primary_store_balance_in_balance_precision` | Get balance with precision |
| `max_allowed_withdraw_fungible_amount` | Calculate max withdrawable |
| `market_slippage_pcts` | Get market slippage percentages |
| `set_market_slippage_pcts` | Configure slippage (admin) |
| `market_margin_call_fee_pct` | Get margin call fee percentage |
| `set_market_margin_call_fee_pct` | Configure margin call fee (admin) |
| `init_account_status_cache` | Initialize account caching |

### vault.mv.move (+8 functions)

| Function | Purpose |
|----------|---------|
| `place_force_closing_order` | Force close vault positions |
| `cancel_force_closing_order` | Cancel force close |
| `try_complete_redemption` | Async redemption completion |
| `lock_for_initated_redemption` | Lock shares for redemption |
| `get_vault_portfolio_subaccounts` | Get vault's DEX subaccounts |
| `get_order_ref_market` | Get order reference market |
| `get_order_ref_order_id` | Get order reference ID |
| `register_external_callbacks` | Register callback handlers |

---

## Removed Functions from Contract 2

### perp_engine.mv.move (-1 function)
| Function | Reason |
|----------|--------|
| `migrate_position_tp_sl_tracker` | Migration complete, no longer needed |

---

## New Package: decibel_usdc

Contract 2 has a separate `decibel_usdc` package (1 module), while Contract 1 bundles USDC in the main perp_dex package.

This separation allows:
- Independent USDC upgrades
- Cleaner dependency management
- Potential multi-collateral support

---

## Key Architectural Differences

### 1. Async Vault Processing
Contract 2 introduces an async work queue pattern:
```
vault_api → async_vault_work → async_vault_engine
                    ↓
            Process in batches
```

### 2. Slippage Protection
Contract 2 has dedicated `slippage_math` module vs inline calculations in Contract 1.

### 3. Position View Layer
Contract 2 separates view types (`position_view_types`) for cleaner read operations.

### 4. Force Closing Mechanism
Contract 2 vault has explicit force closing for risk management:
- `place_force_closing_order()`
- `cancel_force_closing_order()`

---

## Address Reference Changes

All modules reference their deploying address:
- Contract 1: `0x1f513904...`
- Contract 2: `0x9f830083...`

External dependencies remain the same:
- Pyth: `0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387`
- Orderbook: `0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466`

---

## Conclusion

**Contract 2 (`0x9f830083...`) appears to be a NEWER, more feature-rich deployment:**
- +5 new modules for async processing, slippage math, and position views
- +12 new functions in perp_engine
- +8 new functions in vault
- Separate USDC package for cleaner architecture
- Advanced vault features (async processing, force closing)

**Contract 1 (`0x1f513904...`) appears to be an OLDER deployment:**
- Has been upgraded 17 times (vs 4)
- Higher balance suggests it's the active/production contract
- Contains legacy `order` module
- Contains migration function that's been removed in Contract 2

---

## File Locations

- Contract 1 decompiled: `decompiled_v2/`
- Contract 2 decompiled: `decompiled_v2_new/`
