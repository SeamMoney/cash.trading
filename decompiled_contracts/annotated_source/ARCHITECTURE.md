# Decibel Protocol Architecture

This document describes how the Decibel perpetual DEX protocol interacts with the Econia order book infrastructure.

## Contract Addresses

| Contract | Address | Network | Deployed |
|----------|---------|---------|----------|
| **Decibel Protocol** (Current) | `0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88` | Aptos Testnet | Jan 21, 2026 |
| **Decibel Protocol** (Previous) | `0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844` | Aptos Testnet | Dec 2025 |
| **Econia Order Book** (Decibel's fork) | `0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7` | Aptos Testnet | Dec 16, 2025 |

> **Note:** The Econia contract at `0x1b3f...` is a redeployment of Econia's open-source order book code by Aptos Labs specifically for Decibel. It is NOT the original Econia testnet deployment.

## Recent Changes (Jan 21, 2026 Testnet Reset)

- **New Contract Address:** `0xd0b2...` replaces `0x9f83...`
- **New Module:** `dex_accounts_entry` added as wrapper with entry functions for trading
- **New Modules:** `vault_api`, `order_apis`, `account_management_apis`, `predeposit`, `slippage_math`, `work_unit_utils`, `position_view_types`, `perp_order`
- **Primary Subaccount Derivation:** Now uses `GlobalSubaccountManager` + BCS-encoded seed
- **API Changes:** List endpoints now return `{items: [], total: x}` format
- **SDK Version:** Updated to 0.2.9

## High-Level Architecture

```mermaid
flowchart TB
    subgraph User["User Layer"]
        Wallet[User Wallet]
        Frontend[Frontend/SDK]
    end

    subgraph Decibel["Decibel Protocol (0x9f83...)"]
        subgraph EntryPoints["Entry Points"]
            PublicAPI[public_apis.move]
            PerpEngineAPI[perp_engine_api.move]
            VaultAPI[vault_api.move]
        end

        subgraph Trading["Trading Layer"]
            PerpEngine[perp_engine.move]
            PerpMarket[perp_market.move]
            Clearinghouse[clearinghouse_perp.move]
            OrderPlacement[order_placement_utils.move]
            AsyncMatching[async_matching_engine.move]
        end

        subgraph Positions["Position Management"]
            PerpPositions[perp_positions.move]
            PositionUpdate[position_update.move]
            TPSL[position_tp_sl.move]
        end

        subgraph Accounts["Account Management"]
            DexAccounts[dex_accounts_entry.move]
            Collateral[accounts_collateral.move]
            BalanceSheet[collateral_balance_sheet.move]
        end

        subgraph Risk["Risk Management"]
            Liquidation[liquidation.move]
            ADL[adl_tracker.move]
            OITracker[open_interest_tracker.move]
        end

        subgraph Pricing["Price & Oracle"]
            Oracle[oracle.move]
            PriceManagement[price_management.move]
            Pyth[Pyth Integration]
            Chainlink[Chainlink Integration]
        end

        subgraph Fees["Fee System"]
            FeeManager[trading_fees_manager.move]
            FeeDistribution[fee_distribution.move]
            Referrals[referral_registry.move]
        end
    end

    subgraph Econia["Econia Order Book (0x1b3f...)"]
        OrderBook[order_book.move]
        MarketTypes[market_types.move]
        OrderBookTypes[order_book_types.move]
        OrderOps[order_operations.move]
        SingleOrder[single_order_types.move]
        BulkOrder[market_bulk_order.move]
        OrderPlacementEconia[order_placement.move]
    end

    Wallet --> Frontend
    Frontend --> EntryPoints
    EntryPoints --> Trading
    Trading --> Positions
    Trading --> Accounts
    Trading --> Risk
    Trading --> Pricing
    Trading --> Fees

    PerpMarket <-->|"Wraps & Calls"| Econia
    Clearinghouse -->|"Callbacks"| Econia
    OrderPlacement -->|"Place/Cancel"| Econia
```

## Order Flow: User Places a Trade

```mermaid
sequenceDiagram
    participant User
    participant PerpEngine as perp_engine.move
    participant PerpMarket as perp_market.move
    participant Econia as Econia Order Book
    participant Clearinghouse as clearinghouse_perp.move
    participant Positions as perp_positions.move
    participant Collateral as accounts_collateral.move

    User->>PerpEngine: place_order()
    PerpEngine->>PerpMarket: place_order_with_order_id()

    Note over PerpMarket: PerpMarket wraps Econia's Market type

    PerpMarket->>Econia: order_placement::place_order()

    Note over Econia: Order book matching begins

    alt Order Matches (Taker)
        Econia->>Clearinghouse: settle_trade() callback
        Clearinghouse->>Collateral: validate_position_update()
        Collateral->>Positions: get_position_details()
        Positions-->>Collateral: (size, is_long, leverage)
        Collateral-->>Clearinghouse: UpdatePositionResult
        Clearinghouse->>Collateral: commit_update_position()
        Collateral->>Positions: update_position()
        Clearinghouse-->>Econia: SettleTradeResult
    else Order Rests (Maker)
        Econia->>Clearinghouse: place_maker_order() callback
        Clearinghouse->>Collateral: add_pending_order()
        Clearinghouse-->>Econia: PlaceMakerOrderResult
    end

    Econia-->>PerpMarket: OrderMatchResult
    PerpMarket-->>PerpEngine: (order_id, filled_size, ...)
    PerpEngine-->>User: Order confirmation
```

## The Callback Architecture

Decibel uses a callback pattern to integrate with Econia. The order book invokes callbacks during matching to let Decibel handle:

```mermaid
flowchart LR
    subgraph Econia["Econia Order Book"]
        Matching[Order Matching Engine]
    end

    subgraph Callbacks["Decibel Callbacks"]
        SettleTrade[settle_trade]
        ValidateOrder[validate_order_placement]
        PlaceMaker[place_maker_order]
        Cleanup[cleanup_order]
        ReduceSize[reduce_order_size]
    end

    subgraph Actions["Callback Actions"]
        Margin[Margin Validation]
        Position[Position Updates]
        Fees[Fee Distribution]
        TPSL[TP/SL Placement]
        OI[Open Interest Tracking]
    end

    Matching -->|"On trade match"| SettleTrade
    Matching -->|"Before order added"| ValidateOrder
    Matching -->|"When maker posts"| PlaceMaker
    Matching -->|"On cancel/expire"| Cleanup
    Matching -->|"On partial fill"| ReduceSize

    SettleTrade --> Position
    SettleTrade --> Fees
    SettleTrade --> TPSL
    SettleTrade --> OI
    ValidateOrder --> Margin
    PlaceMaker --> Margin
```

## Econia Modules Used by Decibel

| Econia Module | Decibel Usage | Description |
|--------------|---------------|-------------|
| `order_book` | `perp_market.move` | Core order book queries (remaining size, slippage price) |
| `market_types` | `perp_market.move`, `clearinghouse_perp.move` | Market and callback types |
| `order_book_types` | Throughout | Order IDs, TimeInForce, TriggerCondition |
| `order_placement` | `perp_market.move`, `order_placement_utils.move` | Placing orders on the book |
| `order_operations` | `perp_market.move` | Cancel, decrease size operations |
| `single_order_types` | `perp_market.move`, `perp_engine.move` | Single order data structures |
| `market_bulk_order` | `perp_market.move` | Market maker bulk order operations |
| `market_clearinghouse_order_info` | `clearinghouse_perp.move` | Order info for callbacks |

## The PerpMarket Wrapper

The key integration point is `perp_market.move`, which wraps Econia's generic `Market` type:

```mermaid
classDiagram
    class PerpMarket {
        +market: Market~OrderMetadata~
        +get_remaining_size()
        +best_bid_price()
        +best_ask_price()
        +place_order_with_order_id()
        +cancel_order()
        +place_bulk_order()
    }

    class EconiaMarket["Market<T>"] {
        +order_book: OrderBook~T~
        +price_triggers: PriceTriggers
        +time_triggers: TimeTriggers
    }

    class OrderMetadata {
        +builder_code: Option~BuilderCode~
        +is_reduce_only: bool
        +use_backstop_margin: bool
        +is_margin_call: bool
        +tp: Option~ChildTPSL~
        +sl: Option~ChildTPSL~
    }

    PerpMarket *-- EconiaMarket : contains
    EconiaMarket o-- OrderMetadata : parameterized with
```

## Trade Settlement Flow

```mermaid
flowchart TB
    subgraph SettleTrade["settle_trade() in clearinghouse_perp.move"]
        Validate[Validate both sides can settle]
        ReduceOnly[Check reduce-only constraints]
        OICap[Check open interest cap]
        TakerUpdate[Validate taker position update]
        MakerUpdate[Validate maker position update]
        CommitTaker[Commit taker position]
        CommitMaker[Commit maker position]
        DistributeFees[Distribute fees]
        PlaceTPSL[Place child TP/SL orders]
        UpdateOI[Update open interest]
    end

    Validate --> ReduceOnly
    ReduceOnly --> OICap
    OICap --> TakerUpdate
    TakerUpdate --> MakerUpdate
    MakerUpdate --> CommitTaker
    CommitTaker --> CommitMaker
    CommitMaker --> DistributeFees
    DistributeFees --> PlaceTPSL
    PlaceTPSL --> UpdateOI
```

## Liquidation Flow with Econia

```mermaid
sequenceDiagram
    participant Keeper
    participant Liquidation as liquidation.move
    participant Clearinghouse as clearinghouse_perp.move
    participant PerpMarket as perp_market.move
    participant Econia as Econia Order Book
    participant Backstop as Backstop Liquidator

    Keeper->>Liquidation: margin_call_liquidation()

    Note over Liquidation: Check if account is liquidatable

    alt Margin Call (Soft Liquidation)
        Liquidation->>PerpMarket: place_order_with_order_id()
        PerpMarket->>Econia: order_placement::place_order()
        Note over Econia: Market order to close position
        Econia-->>PerpMarket: OrderMatchResult
    else Backstop Liquidation
        Liquidation->>Clearinghouse: settle_backstop_liquidation_or_adl()
        Note over Clearinghouse: Protocol takes over at mark price
        Clearinghouse->>Backstop: Transfer position
    else ADL (Auto-Deleverage)
        Liquidation->>Clearinghouse: settle_backstop_liquidation_or_adl()
        Note over Clearinghouse: Reduce profitable counterparty
    end
```

## Data Flow: Position State

```mermaid
flowchart LR
    subgraph Econia["Econia (0x1b3f...)"]
        OrderBook[(Order Book State)]
        Orders[Resting Orders]
    end

    subgraph Decibel["Decibel (0x9f83...)"]
        Positions[(Position State)]
        Collateral[(Collateral State)]
        PendingOrders[(Pending Order Margin)]
        OI[(Open Interest)]
    end

    OrderBook --> |"Order fills"| Positions
    Orders --> |"Pending margin"| PendingOrders
    Positions --> |"Margin requirements"| Collateral
    Positions --> |"Track OI"| OI
```

## Key Integration Patterns

### 1. Generic Type Parameterization

Econia's order book is generic over order metadata. Decibel provides `OrderMetadata`:

```move
// Econia's generic market
Market<T: copy + drop + store>

// Decibel's instantiation
Market<perp_engine_types::OrderMetadata>
```

### 2. Callback Registration

Decibel creates callbacks that Econia invokes during matching:

```move
// From clearinghouse_perp.move
fun market_callbacks(market): MarketClearinghouseCallbacks<OrderMetadata, OrderMatchingActions> {
    market_types::new_market_clearinghouse_callbacks(
        settle_trade_callback,
        validate_order_callback,
        validate_bulk_callback,
        place_maker_callback,
        cleanup_callback,
        size_reduced_callback,
        reduce_size_callback,
        serialize_callback
    )
}
```

### 3. Cross-Contract Calls

Decibel calls Econia functions directly via `use` imports:

```move
// In perp_market.move
use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book;
use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_placement;

// Then call
order_placement::place_order_with_order_id(...)
order_book::get_remaining_size(...)
```

## Summary

Decibel is a **perpetual DEX application layer** built on top of **Econia's order book infrastructure**:

| Layer | Responsibility | Contract |
|-------|---------------|----------|
| **Application** | Margin, leverage, funding, liquidations, vaults | Decibel (`0x9f83...`) |
| **Matching** | Order book, price-time priority, matching engine | Econia fork (`0x1b3f...`) |
| **Settlement** | State changes, balance updates | Both (via callbacks) |

The architecture enables:
- **Separation of concerns**: Order matching logic is delegated to Econia
- **Composability**: Decibel adds perp-specific features on top
- **Efficiency**: Econia's hyper-parallelized matching handles throughput
