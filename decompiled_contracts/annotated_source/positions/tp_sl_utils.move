/// ============================================================================
/// TP/SL UTILS - Take-Profit/Stop-Loss Order Placement Utilities
/// ============================================================================
///
/// This module provides utility functions for placing and validating TP/SL orders.
/// It handles both position-level TP/SL orders and child TP/SL orders attached
/// to parent limit orders.
///
/// KEY FEATURES:
/// - Place TP/SL orders with validation
/// - Validate and create child TP/SL orders for limit orders
/// - Handle both new orders and size increases for existing orders
/// - Emit events for TP/SL order lifecycle
///
/// TWO TYPES OF TP/SL:
/// 1. Position TP/SL: Standalone orders attached to a position
/// 2. Child TP/SL: Orders attached to a parent limit order (activated when parent fills)
///
/// VALIDATION RULES:
/// - For long positions: TP trigger > current price, SL trigger < current price
/// - For short positions: TP trigger < current price, SL trigger > current price
/// - Prices and sizes must meet market minimums/maximums
///
/// ============================================================================

module decibel::tp_sl_utils {
    use std::object;
    use std::option;

    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::position_tp_sl;
    use decibel::perp_engine_types;
    use decibel::price_management;
    use decibel::builder_code_registry;
    use econia::order_book_types;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::clearinghouse_perp;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;

    // ============================================================================
    // ENUMS AND TYPES
    // ============================================================================

    /// Event emitted when an order-based TP/SL is created or modified
    /// These are child TP/SL orders attached to parent limit orders
    enum OrderBasedTpSlEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            parent_order_id: order_book_types::OrderIdType,
            status: TpSlStatus,
            trigger_price: u64,
            limit_price: option::Option<u64>,
            size: u64,
            is_tp: bool,
        }
    }

    /// Status of a TP/SL order
    enum TpSlStatus has copy, drop, store {
        INACTIVE,  // Child TP/SL waiting for parent to fill
        ACTIVE,    // TP/SL is active and monitoring price
    }

    // ============================================================================
    // STATUS CONSTRUCTORS
    // ============================================================================

    /// Get the ACTIVE status
    public fun get_active_tp_sl_status(): TpSlStatus {
        TpSlStatus::ACTIVE {}
    }

    /// Get the INACTIVE status
    public fun get_inactive_tp_sl_status(): TpSlStatus {
        TpSlStatus::INACTIVE {}
    }

    // ============================================================================
    // TP/SL ORDER PLACEMENT
    // ============================================================================

    /// Place a TP/SL order for a position
    /// Handles both new orders and increasing size of existing orders
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: The account placing the order
    /// - `trigger_price`: Price at which TP/SL triggers
    /// - `limit_price`: Optional limit price (market order if None)
    /// - `size`: Optional fixed size (None for full position size)
    /// - `is_tp`: True for take-profit, false for stop-loss
    /// - `provided_order_id`: Optional order ID (generates new if None)
    /// - `builder_code`: Optional builder rebate code
    /// - `is_full_sized`: True if order should close entire position
    /// - `is_short`: True if this is for a short position (affects validation)
    ///
    /// # Returns
    /// The order ID of the placed or modified TP/SL order
    friend fun place_tp_sl_order_for_position_internal(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
        is_tp: bool,
        provided_order_id: option::Option<order_book_types::OrderIdType>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_full_sized: bool,
        is_short: bool
    ): order_book_types::OrderIdType {
        // Validate trigger price meets market requirements
        perp_market_config::validate_price(market, trigger_price);

        let has_fixed_size = option::is_some<u64>(&size);

        // For fixed-size orders, validate the size
        if (has_fixed_size) {
            let order_size = option::destroy_some<u64>(size);

            // Validate price and size together if limit price provided
            if (option::is_some<u64>(&limit_price)) {
                let lim_price = *option::borrow<u64>(&limit_price);
                perp_market_config::validate_price_and_size(market, lim_price, order_size, is_short);
            } else {
                // Just validate size for market orders
                perp_market_config::validate_size(market, order_size, is_short);
            };

            // Check if a matching TP/SL already exists
            let existing_order_id = position_tp_sl::get_fixed_sized_tp_sl(
                account,
                market,
                is_tp,
                trigger_price,
                limit_price,
                builder_code
            );

            // If existing order found, increase its size
            if (option::is_some<order_book_types::OrderIdType>(&existing_order_id)) {
                position_tp_sl::increase_tp_sl_size(
                    account,
                    market,
                    trigger_price,
                    limit_price,
                    builder_code,
                    order_size,
                    is_tp
                );
                return option::destroy_some<order_book_types::OrderIdType>(existing_order_id)
            };

            // Fall through to create new order
        } else {
            // For full-size orders, validate limit price if provided
            if (option::is_some<u64>(&limit_price)) {
                let lim_price = *option::borrow<u64>(&limit_price);
                perp_market_config::validate_price(market, lim_price);
            };
        };

        // Generate or use provided order ID
        let order_id = if (option::is_none<order_book_types::OrderIdType>(&provided_order_id)) {
            order_book_types::next_order_id()
        } else {
            option::destroy_some<order_book_types::OrderIdType>(provided_order_id)
        };

        // Create new TP/SL order
        position_tp_sl::add_tp_sl(
            account,
            market,
            order_id,
            trigger_price,
            limit_price,
            size,
            is_tp,
            builder_code,
            is_full_sized
        );

        order_id
    }

    // ============================================================================
    // CHILD TP/SL ORDER VALIDATION
    // ============================================================================

    /// Validate and create child TP/SL orders for a parent limit order
    /// Child TP/SL orders become active when the parent order fills
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `parent_order_id`: The parent order these TP/SL attach to
    /// - `is_long`: True if parent order results in long position
    /// - `tp_trigger_price`: Optional TP trigger price
    /// - `tp_limit_price`: Optional TP limit price
    /// - `sl_trigger_price`: Optional SL trigger price
    /// - `sl_limit_price`: Optional SL limit price
    ///
    /// # Returns
    /// (tp_order, sl_order) - Optional child TP and SL orders
    ///
    /// # Aborts
    /// - 1: If TP trigger provided without limit price and invalid direction
    /// - 1: If SL trigger provided without limit price and invalid direction
    friend fun validate_and_get_child_tp_sl_orders(
        market: object::Object<perp_market::PerpMarket>,
        parent_order_id: order_book_types::OrderIdType,
        is_long: bool,
        tp_trigger_price: option::Option<u64>,
        tp_limit_price: option::Option<u64>,
        sl_trigger_price: option::Option<u64>,
        sl_limit_price: option::Option<u64>
    ): (option::Option<perp_engine_types::ChildTpSlOrder>, option::Option<perp_engine_types::ChildTpSlOrder>) {
        // Get current mark price for validation
        let mark_price = price_management::get_mark_price(market);

        // Validate take-profit if provided
        let has_tp_limit = option::is_some<u64>(&tp_limit_price);
        if (has_tp_limit) {
            let tp_limit = option::destroy_some<u64>(tp_limit_price);
            perp_market_config::validate_price(market, tp_limit);

            // TP trigger must be provided with limit
            assert!(option::is_some<u64>(&tp_trigger_price), 1);

            // Validate TP direction based on position side
            // Long: TP trigger must be above current price (profit when price rises)
            // Short: TP trigger must be below current price (profit when price falls)
            if (is_long) {
                if (option::destroy_some<u64>(tp_trigger_price) > mark_price) {
                    // Valid: long TP above current price
                } else {
                    abort 1  // Invalid: long TP below current price
                }
            } else {
                if (option::destroy_some<u64>(tp_trigger_price) < mark_price) {
                    // Valid: short TP below current price
                } else {
                    abort 1  // Invalid: short TP above current price
                }
            };
        };

        // Validate stop-loss if provided
        let has_sl_limit = option::is_some<u64>(&sl_limit_price);
        if (has_sl_limit) {
            let sl_limit = option::destroy_some<u64>(sl_limit_price);
            perp_market_config::validate_price(market, sl_limit);

            // SL trigger must be provided with limit
            assert!(option::is_some<u64>(&sl_trigger_price), 1);

            // Validate SL direction based on position side
            // Long: SL trigger must be below current price (stop loss when price falls)
            // Short: SL trigger must be above current price (stop loss when price rises)
            if (is_long) {
                if (option::destroy_some<u64>(sl_trigger_price) < mark_price) {
                    // Valid: long SL below current price
                } else {
                    abort 1  // Invalid: long SL above current price
                }
            } else {
                if (option::destroy_some<u64>(sl_trigger_price) > mark_price) {
                    // Valid: short SL above current price
                } else {
                    abort 1  // Invalid: short SL below current price
                }
            };
        };

        // Create TP child order if trigger provided
        let tp_order = if (option::is_some<u64>(&tp_trigger_price)) {
            option::some<perp_engine_types::ChildTpSlOrder>(
                perp_engine_types::new_child_tp_sl_order(
                    option::destroy_some<u64>(tp_trigger_price),
                    tp_limit_price,
                    parent_order_id
                )
            )
        } else {
            option::none<perp_engine_types::ChildTpSlOrder>()
        };

        // Create SL child order if trigger provided
        let sl_order = if (option::is_some<u64>(&sl_trigger_price)) {
            option::some<perp_engine_types::ChildTpSlOrder>(
                perp_engine_types::new_child_tp_sl_order(
                    option::destroy_some<u64>(sl_trigger_price),
                    sl_limit_price,
                    parent_order_id
                )
            )
        } else {
            option::none<perp_engine_types::ChildTpSlOrder>()
        };

        (tp_order, sl_order)
    }
}
