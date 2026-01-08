# Decibel Protocol - Annotated Source Code Index

This directory contains fully annotated Move source code for the Decibel perpetual DEX protocol, decompiled from contract `0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844` on Aptos testnet.

> **See also:** [ARCHITECTURE.md](./ARCHITECTURE.md) - Full architecture documentation with Mermaid diagrams showing how Decibel integrates with Econia's order book.

## Directory Structure

```
annotated_source/
├── accounts/           # Account and collateral management
├── admin/              # Administrative APIs
├── core/               # Core utilities and math
├── fees/               # Fee calculation and distribution
├── liquidation/        # Liquidation and ADL systems
├── oracle/             # Price oracle integrations
├── orders/             # Order management and matching
├── positions/          # Position and market management
├── tokens/             # Token definitions
├── types/              # Type definitions
└── vault/              # Vault system for LP
```

## Module Reference

### Core Utilities (`core/`)

| Module | Description |
|--------|-------------|
| `math.move` | Precision scaling and decimal operations |
| `i64_math.move` | Signed 64-bit integer operations |
| `i64_aggregator.move` | Aggregator for signed integers |
| `slippage_math.move` | Slippage calculations for trades |
| `decibel_time.move` | Time management (simulated for testing) |
| `public_apis.move` | Public entry points for users |
| `perp_engine_api.move` | Public entry points for trading |

### Account Management (`accounts/`)

| Module | Description |
|--------|-------------|
| `dex_accounts.move` | Subaccount management and delegation |
| `accounts_collateral.move` | Cross/isolated margin and collateral |
| `collateral_balance_sheet.move` | Balance tracking and accounting |
| `dex_accounts_vault_extension.move` | Vault integration for trading accounts |

### Position Management (`positions/`)

| Module | Description |
|--------|-------------|
| `perp_market.move` | Market object and status management |
| `perp_market_config.move` | Market parameters configuration |
| `perp_positions.move` | Position state and calculations |
| `perp_engine.move` | Core trading engine |
| `perp_engine_types.move` | Type definitions for engine |
| `position_update.move` | Position modification logic |
| `clearinghouse_perp.move` | Trade settlement |
| `position_tp_sl.move` | Take-profit/stop-loss orders |
| `tp_sl_utils.move` | TP/SL utility functions |
| `position_tp_sl_tracker.move` | TP/SL order tracking |

### Order System (`orders/`)

| Module | Description |
|--------|-------------|
| `order_margin.move` | Order margin requirements |
| `order_placement_utils.move` | Order placement helpers |
| `pending_order_tracker.move` | Open order tracking |
| `async_matching_engine.move` | Async order processing |

### Oracle System (`oracle/`)

| Module | Description |
|--------|-------------|
| `oracle.move` | Multi-source oracle aggregation |
| `internal_oracle_state.move` | Internal price feed |
| `chainlink_state.move` | Chainlink Data Streams integration |
| `price_management.move` | Mark price and funding rate |
| `spread_ema.move` | Price spread EMA calculation |

### Liquidation System (`liquidation/`)

| Module | Description |
|--------|-------------|
| `liquidation.move` | Main liquidation logic |
| `liquidation_config.move` | Margin thresholds |
| `adl_tracker.move` | Auto-deleverage tracking |
| `backstop_liquidator_profit_tracker.move` | Backstop PnL tracking |

### Fee System (`fees/`)

| Module | Description |
|--------|-------------|
| `trading_fees_manager.move` | Tiered fee structure |
| `fee_distribution.move` | Fee routing and settlement |
| `fee_treasury.move` | Protocol fee treasury |
| `volume_tracker.move` | Trading volume tracking |
| `referral_registry.move` | Referral program |
| `builder_code_registry.move` | Frontend builder fees |
| `open_interest_tracker.move` | OI limits |

### Vault System (`vault/`)

| Module | Description |
|--------|-------------|
| `vault.move` | Core vault functionality |
| `vault_api.move` | Public vault entry points |
| `vault_global_config.move` | Global vault configuration |
| `vault_share_asset.move` | Vault share tokens with lockup |
| `async_vault_engine.move` | Async redemption queue |
| `async_vault_work.move` | Redemption state machine |

### Administration (`admin/`)

| Module | Description |
|--------|-------------|
| `admin_apis.move` | Admin permission and configuration |

### Tokens (`tokens/`)

| Module | Description |
|--------|-------------|
| `usdc.move` | USDC collateral token |
| `testc.move` | Test collateral token |

### Types (`types/`)

| Module | Description |
|--------|-------------|
| `position_view_types.move` | View types for positions |

## Key Concepts

### Margin System
- **Cross Margin**: Shared collateral across all positions
- **Isolated Margin**: Per-position collateral
- **Maintenance Margin**: 50% of initial margin (default)
- **Backstop Margin**: 33% of initial margin

### Liquidation Flow
1. **Margin Call**: Soft liquidation via market orders
2. **Backstop**: Protocol takes over at mark price
3. **ADL**: Auto-deleverage profitable positions

### Oracle System
- **Internal**: Admin-controlled prices
- **Pyth**: Pyth Network price feeds
- **Chainlink**: Chainlink Data Streams
- **Composite**: Primary + backup with deviation check

### Mark Price Calculation
Median of three EMAs:
- Oracle price (150s lookback)
- Oracle price (30s lookback)
- Basis adjustment (30s lookback)

### Funding Rate
- Premium-based with interest rate component
- Capped at ±4%/hour
- Updates on oracle refresh

### Vault System
- NAV-based share pricing
- Performance fees on profits
- Contribution lockup periods
- Async redemption for large requests

## External Dependencies

- `order_book` (`0x1b3f...`): Order book types and matching
- `chainlink_verifier` (`0xc687...`): Chainlink report verification
- `pyth` (`0x7e78...`): Pyth price feeds

## Notes

- All amounts use USDC decimals (6) unless otherwise noted
- Prices typically use 6-8 decimal precision
- Sizes use market-specific decimals (usually 8)
- Fees expressed in bps * 100 (e.g., 340 = 3.4 bps)
