/// ============================================================================
/// PERP ENGINE TYPES - Order Metadata and Action Types
/// ============================================================================
///
/// This module defines the core data structures used throughout the perpetual
/// trading engine for order metadata, actions, and matching results.
///
/// KEY TYPES:
/// - OrderMetadata: Attached to every order, contains reduce-only flags, TP/SL, TWAP info
/// - ChildTpSlOrder: Take-profit/stop-loss orders attached to parent orders
/// - TwapMetadata: Time-weighted average price order scheduling info
/// - SingleOrderAction: Actions to take on orders (cancel, reduce size)
/// - OrderMatchingActions: Batch of actions from trade settlement
///
/// DESIGN NOTES:
/// - Two order types: V1_RETAIL (normal orders) and V1_BULK (market maker bulk orders)
/// - Bulk orders have simpler metadata (no TP/SL, no reduce-only)
/// - Order actions are collected during matching and executed afterwards
///
/// ============================================================================

module decibel::perp_engine_types {
    use econia::order_book_types;
    use std::option;
    use decibel::builder_code_registry;
    use aptos_std::bcs;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::pending_order_tracker;
    friend decibel::tp_sl_utils;
    friend decibel::clearinghouse_perp;
    friend decibel::order_placement_utils;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;

    // ============================================================================
    // STRUCT DEFINITIONS
    // ============================================================================

    /// Child TP/SL order attached to a parent order
    /// Created when an order is placed with attached TP/SL
    enum ChildTpSlOrder has copy, drop, store {
        V1 {
            trigger_price: u64,                              // Price that triggers the TP/SL
            parent_order_id: order_book_types::OrderIdType,  // ID of parent order
            limit_price: option::Option<u64>,                // Optional limit price (market if none)
        }
    }

    /// Container for a batch of order actions
    struct OrderActions has copy, drop, store {
        actions: vector<SingleOrderAction>,
    }

    /// Individual order action (cancel or reduce size)
    enum SingleOrderAction has copy, drop, store {
        CancelOrder {
            account: address,
            order_id: order_book_types::OrderIdType,
        }
        ReduceOrderSize {
            account: address,
            order_id: order_book_types::OrderIdType,
            size_delta: u64,  // Amount to reduce by
        }
    }

    /// Wrapper for matching engine action results
    /// Distinguishes between settle trade and maker order placement contexts
    enum OrderMatchingActions has copy, drop, store {
        SettleTradeMatchingActions {
            _0: OrderActions,
        }
        PlaceMakerOrderActions {
            _0: OrderActions,
        }
    }

    /// Order metadata attached to every order
    /// Contains all order-specific configuration and attached orders
    enum OrderMetadata has copy, drop, store {
        /// Standard retail order with full feature set
        V1_RETAIL {
            is_reduce_only: bool,                // Order can only reduce position
            use_backstop_liquidation_margin: bool,  // Use backstop margin for liquidation orders
            is_margin_call: bool,                // This is a liquidation order
            twap: option::Option<TwapMetadata>,  // TWAP order schedule if applicable
            tp_sl: TpSlMetadata,                 // Attached TP/SL orders
            builder_code: option::Option<builder_code_registry::BuilderCode>,  // Builder rebate code
        }
        /// Simplified bulk order (market maker)
        V1_BULK {
            builder_code: option::Option<builder_code_registry::BuilderCode>,
        }
    }

    /// TWAP (Time-Weighted Average Price) order metadata
    /// Schedules order execution over time intervals
    enum TwapMetadata has copy, drop, store {
        V1 {
            start_time_seconds: u64,     // When TWAP order begins
            frequency_seconds: u64,       // Interval between sub-orders
            end_time_seconds: u64,        // When TWAP order ends
        }
    }

    /// Container for attached TP/SL orders
    enum TpSlMetadata has copy, drop, store {
        V1 {
            tp: option::Option<ChildTpSlOrder>,  // Take-profit order
            sl: option::Option<ChildTpSlOrder>,  // Stop-loss order
        }
    }

    // ============================================================================
    // ORDER METADATA ACCESSORS
    // ============================================================================

    /// Check if order is reduce-only
    /// Bulk orders are never reduce-only
    friend fun is_reduce_only(metadata: &OrderMetadata): bool {
        match (metadata) {
            OrderMetadata::V1_RETAIL { is_reduce_only, .. } => *is_reduce_only,
            OrderMetadata::V1_BULK { .. } => false,
        }
    }

    /// Check if order uses backstop liquidation margin
    /// Only retail orders can use backstop margin
    friend fun use_backstop_liquidation_margin(metadata: &OrderMetadata): bool {
        match (metadata) {
            OrderMetadata::V1_BULK { .. } => false,
            OrderMetadata::V1_RETAIL { use_backstop_liquidation_margin, .. } => *use_backstop_liquidation_margin,
        }
    }

    /// Check if order is a margin call (liquidation)
    friend fun is_margin_call(metadata: &OrderMetadata): bool {
        match (metadata) {
            OrderMetadata::V1_RETAIL { is_margin_call, .. } => *is_margin_call,
            OrderMetadata::V1_BULK { .. } => false,
        }
    }

    /// Get builder code for rebates
    friend fun get_builder_code_from_metadata(metadata: &OrderMetadata): option::Option<builder_code_registry::BuilderCode> {
        match (metadata) {
            OrderMetadata::V1_RETAIL { builder_code, .. } => *builder_code,
            OrderMetadata::V1_BULK { builder_code, .. } => *builder_code,
        }
    }

    /// Get attached take-profit order
    friend fun get_tp_from_metadata(metadata: &OrderMetadata): option::Option<ChildTpSlOrder> {
        match (metadata) {
            OrderMetadata::V1_RETAIL { tp_sl, .. } => *&tp_sl.tp,
            OrderMetadata::V1_BULK { .. } => option::none(),
        }
    }

    /// Get attached stop-loss order
    friend fun get_sl_from_metadata(metadata: &OrderMetadata): option::Option<ChildTpSlOrder> {
        match (metadata) {
            OrderMetadata::V1_RETAIL { tp_sl, .. } => *&tp_sl.sl,
            OrderMetadata::V1_BULK { .. } => option::none(),
        }
    }

    /// Get TWAP schedule from metadata
    /// Panics if no TWAP metadata present
    friend fun get_twap_from_metadata(metadata: &OrderMetadata): (u64, u64, u64) {
        let twap = option::destroy_some(*&metadata.twap);
        (*&twap.start_time_seconds, *&twap.frequency_seconds, *&twap.end_time_seconds)
    }

    /// Serialize metadata for storage/hashing
    friend fun get_order_metadata_bytes(metadata: &OrderMetadata): vector<u8> {
        bcs::to_bytes(metadata)
    }

    // ============================================================================
    // ORDER METADATA CONSTRUCTORS
    // ============================================================================

    /// Create new retail order metadata
    friend fun new_order_metadata(
        is_reduce_only: bool,
        twap: option::Option<TwapMetadata>,
        tp: option::Option<ChildTpSlOrder>,
        sl: option::Option<ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): OrderMetadata {
        OrderMetadata::V1_RETAIL {
            is_reduce_only,
            use_backstop_liquidation_margin: false,
            is_margin_call: false,
            twap,
            tp_sl: TpSlMetadata::V1 { tp, sl },
            builder_code,
        }
    }

    /// Create default retail order metadata (no special flags)
    friend fun new_default_order_metadata(): OrderMetadata {
        OrderMetadata::V1_RETAIL {
            is_reduce_only: false,
            use_backstop_liquidation_margin: false,
            is_margin_call: false,
            twap: option::none(),
            tp_sl: new_tp_sl_empty_metadata(),
            builder_code: option::none(),
        }
    }

    /// Create bulk order metadata (for market makers)
    friend fun new_bulk_order_metadata(
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): OrderMetadata {
        OrderMetadata::V1_BULK { builder_code }
    }

    /// Create liquidation order metadata
    /// Sets margin call flag and backstop margin usage
    friend fun new_liquidation_metadata(): OrderMetadata {
        OrderMetadata::V1_RETAIL {
            is_reduce_only: false,
            use_backstop_liquidation_margin: true,
            is_margin_call: true,
            twap: option::none(),
            tp_sl: new_tp_sl_empty_metadata(),
            builder_code: option::none(),
        }
    }

    /// Create empty TP/SL metadata container
    friend fun new_tp_sl_empty_metadata(): TpSlMetadata {
        TpSlMetadata::V1 {
            tp: option::none(),
            sl: option::none(),
        }
    }

    /// Create TWAP order metadata
    friend fun new_twap_metadata(
        start_time: u64,
        frequency: u64,
        end_time: u64
    ): TwapMetadata {
        TwapMetadata::V1 {
            start_time_seconds: start_time,
            frequency_seconds: frequency,
            end_time_seconds: end_time,
        }
    }

    // ============================================================================
    // CHILD TP/SL ORDER OPERATIONS
    // ============================================================================

    /// Create a child TP/SL order
    friend fun new_child_tp_sl_order(
        trigger_price: u64,
        limit_price: option::Option<u64>,
        parent_order_id: order_book_types::OrderIdType
    ): ChildTpSlOrder {
        ChildTpSlOrder::V1 {
            trigger_price,
            parent_order_id,
            limit_price,
        }
    }

    /// Destroy and extract fields from child TP/SL order
    /// Returns (trigger_price, limit_price, parent_order_id)
    friend fun destroy_child_tp_sl_order(
        order: ChildTpSlOrder
    ): (u64, option::Option<u64>, order_book_types::OrderIdType) {
        let ChildTpSlOrder::V1 { trigger_price, parent_order_id, limit_price } = order;
        (trigger_price, limit_price, parent_order_id)
    }

    // ============================================================================
    // ORDER ACTION OPERATIONS
    // ============================================================================

    /// Create cancel order action
    friend fun new_cancel_order_action(
        account: address,
        order_id: order_book_types::OrderIdType
    ): SingleOrderAction {
        SingleOrderAction::CancelOrder { account, order_id }
    }

    /// Create reduce order size action
    friend fun new_reduce_order_size_action(
        account: address,
        order_id: order_book_types::OrderIdType,
        size_delta: u64
    ): SingleOrderAction {
        SingleOrderAction::ReduceOrderSize { account, order_id, size_delta }
    }

    /// Check if action is a cancel order
    friend fun is_cancel_order_action(action: &SingleOrderAction): bool {
        action is CancelOrder
    }

    /// Check if action is a reduce order size
    friend fun is_reduce_order_size_action(action: &SingleOrderAction): bool {
        action is ReduceOrderSize
    }

    /// Destroy and extract fields from cancel order action
    friend fun destroy_cancel_order_action(action: SingleOrderAction): (address, order_book_types::OrderIdType) {
        let SingleOrderAction::CancelOrder { account, order_id } = action;
        (account, order_id)
    }

    /// Destroy and extract fields from reduce order size action
    friend fun destroy_reduce_order_size_action(action: SingleOrderAction): (address, order_book_types::OrderIdType, u64) {
        let SingleOrderAction::ReduceOrderSize { account, order_id, size_delta } = action;
        (account, order_id, size_delta)
    }

    // ============================================================================
    // ORDER MATCHING ACTIONS
    // ============================================================================

    /// Create settle trade actions wrapper
    friend fun new_settle_trade_actions(actions: vector<SingleOrderAction>): OrderMatchingActions {
        OrderMatchingActions::SettleTradeMatchingActions {
            _0: OrderActions { actions }
        }
    }

    /// Create place maker order actions wrapper
    friend fun new_place_maker_order_actions(actions: vector<SingleOrderAction>): OrderMatchingActions {
        OrderMatchingActions::PlaceMakerOrderActions {
            _0: OrderActions { actions }
        }
    }

    /// Extract actions vector from matching actions
    friend fun destroy_order_matching_actions(matching_actions: OrderMatchingActions): vector<SingleOrderAction> {
        *&matching_actions._0.actions
    }
}
