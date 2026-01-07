/// ============================================================================
/// POSITION TP/SL - Take-Profit and Stop-Loss Order Management
/// ============================================================================
///
/// This module provides the interface layer for managing take-profit (TP) and
/// stop-loss (SL) orders attached to positions. It acts as a coordinator between
/// position state and the pending order tracker.
///
/// KEY CONCEPTS:
/// - TP/SL orders can be "full-sized" (close entire position) or "fixed-sized" (partial)
/// - Orders are triggered when price moves past the trigger price
/// - TP triggers when price moves in favor; SL triggers when price moves against
/// - Long positions: TP on price up, SL on price down
/// - Short positions: TP on price down, SL on price up
///
/// ORDER TYPES:
/// - Full-sized: Automatically sized to close the entire position
/// - Fixed-sized: User-specified size, may not close full position
///
/// ARCHITECTURE:
/// - This module validates position existence and direction
/// - Delegates actual order storage to pending_order_tracker
/// - Coordinates with position_tp_sl_tracker for price-triggered execution
///
/// ============================================================================

module decibel::position_tp_sl {
    use std::object;
    use std::option;
    use std::vector;
    use std::error;

    use decibel::perp_market;
    use decibel::perp_positions;
    use decibel::pending_order_tracker;
    use decibel::position_tp_sl_tracker;
    use decibel::builder_code_registry;
    use econia::order_book_types;

    // ============================================================================
    // Error Codes
    // ============================================================================

    /// TP/SL order not found for cancellation
    const E_TP_SL_NOT_FOUND: u64 = 16;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::tp_sl_utils;
    friend decibel::clearinghouse_perp;
    friend decibel::perp_engine;

    // ============================================================================
    // TP/SL ORDER MANAGEMENT
    // ============================================================================

    /// Add a new TP/SL order to a position
    ///
    /// # Parameters
    /// - `account`: The account that owns the position
    /// - `market`: The perpetual market
    /// - `order_id`: Unique identifier for the TP/SL order
    /// - `trigger_price`: Price at which the order triggers
    /// - `limit_price`: Optional limit price (market order if None)
    /// - `size`: Optional fixed size (full position size if None)
    /// - `is_tp`: True for take-profit, false for stop-loss
    /// - `builder_code`: Optional builder rebate code
    /// - `is_full_sized`: True if order should close entire position
    friend fun add_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
        is_tp: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_full_sized: bool
    ) {
        // Get position to determine size and direction
        let position = perp_positions::must_find_position_copy(account, market);
        let position_size = perp_positions::get_size(&position);
        let is_long = perp_positions::is_long(&position);

        // Add to pending order tracker
        pending_order_tracker::add_tp_sl(
            account,
            market,
            order_id,
            trigger_price,
            limit_price,
            size,
            is_tp,
            position_size,
            is_long,
            builder_code,
            is_full_sized
        );

        // Emit position update event to notify of TP/SL addition
        perp_positions::emit_position_update_event(&position, market, account);
    }

    /// Cancel an existing TP/SL order
    ///
    /// # Parameters
    /// - `account`: The account that owns the position
    /// - `market`: The perpetual market
    /// - `order_id`: The order ID to cancel
    ///
    /// # Aborts
    /// - E_TP_SL_NOT_FOUND (16): If the TP/SL order doesn't exist
    friend fun cancel_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType
    ) {
        // Get position to determine direction
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        // Attempt to cancel the TP/SL order
        let cancelled_key = pending_order_tracker::cancel_tp_sl(account, market, order_id, is_long);

        // Ensure an order was actually cancelled
        if (!option::is_some<pending_order_tracker::PendingTpSlKey>(&cancelled_key)) {
            abort error::invalid_argument(E_TP_SL_NOT_FOUND)
        };

        // Emit position update event
        perp_positions::emit_position_update_event(&position, market, account);
    }

    /// Increase the size of an existing TP/SL order
    /// Used when position size increases and TP/SL should track it
    ///
    /// # Parameters
    /// - `account`: The account that owns the position
    /// - `market`: The perpetual market
    /// - `trigger_price`: Price at which the order triggers
    /// - `limit_price`: Optional limit price
    /// - `builder_code`: Optional builder rebate code
    /// - `size_increase`: Amount to increase order size by
    /// - `is_tp`: True for take-profit, false for stop-loss
    friend fun increase_tp_sl_size(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        size_increase: u64,
        is_tp: bool
    ) {
        // Get position direction
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        // Increase size in pending order tracker
        pending_order_tracker::increase_tp_sl_size(
            account,
            market,
            trigger_price,
            limit_price,
            builder_code,
            size_increase,
            is_tp,
            is_long
        );

        // Emit position update event
        perp_positions::emit_position_update_event(&position, market, account);
    }

    /// Validate TP/SL parameters for a position
    /// Checks that trigger price makes sense for position direction
    ///
    /// # Parameters
    /// - `account`: The account to validate for
    /// - `market`: The perpetual market
    /// - `trigger_price`: The proposed trigger price
    /// - `is_tp`: True for take-profit, false for stop-loss
    ///
    /// # Returns
    /// True if the TP/SL parameters are valid
    friend fun validate_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        trigger_price: u64,
        is_tp: bool
    ): bool {
        // Get position direction
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        // Delegate validation to pending order tracker
        pending_order_tracker::validate_tp_sl(market, is_long, trigger_price, is_tp)
    }

    // ============================================================================
    // FIXED-SIZE TP/SL GETTERS
    // ============================================================================

    /// Get the order ID for a fixed-size TP/SL order matching the given parameters
    friend fun get_fixed_sized_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): option::Option<order_book_types::OrderIdType> {
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        pending_order_tracker::get_fixed_sized_tp_sl(
            account,
            market,
            is_tp,
            trigger_price,
            limit_price,
            builder_code,
            is_long
        )
    }

    /// Get full info for a fixed-size TP/SL order by key parameters
    friend fun get_fixed_sized_tp_sl_for_key(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): option::Option<pending_order_tracker::PendingTpSlInfo> {
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        pending_order_tracker::get_fixed_sized_tp_sl_for_key(
            account,
            market,
            is_tp,
            trigger_price,
            limit_price,
            builder_code,
            is_long
        )
    }

    /// Get full info for a fixed-size TP/SL order by order ID
    friend fun get_fixed_sized_tp_sl_for_order_id(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        order_id_raw: u128
    ): option::Option<pending_order_tracker::PendingTpSlInfo> {
        // Convert raw order ID to OrderIdType
        let order_id = order_book_types::new_order_id_type(order_id_raw);

        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        pending_order_tracker::get_fixed_sized_tp_sl_for_order_id(
            account,
            market,
            is_tp,
            order_id,
            is_long
        )
    }

    /// Get all fixed-size TP/SL orders for a position
    friend fun get_fixed_sized_tp_sl_orders(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool
    ): vector<pending_order_tracker::PendingTpSlInfo> {
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        pending_order_tracker::get_fixed_sized_tp_sl_orders(account, market, is_tp, is_long)
    }

    // ============================================================================
    // FULL-SIZE TP/SL GETTERS
    // ============================================================================

    /// Get the full-size TP/SL order for a position
    /// Full-size orders automatically close the entire position
    friend fun get_full_sized_tp_sl_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool
    ): option::Option<pending_order_tracker::PendingTpSlInfo> {
        let position = perp_positions::must_find_position_copy(account, market);
        let is_long = perp_positions::is_long(&position);

        pending_order_tracker::get_full_sized_tp_sl_order(account, market, is_tp, is_long)
    }

    // ============================================================================
    // PUBLIC VIEW FUNCTIONS
    // ============================================================================

    /// Get the stop-loss order for a position (public view function)
    public fun get_sl_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<pending_order_tracker::PendingTpSlInfo> {
        get_full_sized_tp_sl_order(account, market, false)  // is_tp = false for SL
    }

    /// Get the take-profit order for a position (public view function)
    public fun get_tp_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<pending_order_tracker::PendingTpSlInfo> {
        get_full_sized_tp_sl_order(account, market, true)  // is_tp = true for TP
    }

    // ============================================================================
    // TRIGGERED ORDER PROCESSING
    // ============================================================================

    /// Take all TP/SL orders ready to execute based on price movement
    /// Called by the matching engine when price moves past trigger prices
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `current_price`: The current mark price
    /// - `is_price_moving_up`: Direction of price movement
    /// - `max_orders`: Maximum number of orders to take
    ///
    /// # Returns
    /// Vector of pending requests to execute
    ///
    /// # Logic
    /// - Price moving up triggers: Long TP orders, Short SL orders
    /// - Price moving down triggers: Long SL orders, Short TP orders
    friend fun take_ready_tp_sl_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        is_price_moving_up: bool,
        max_orders: u64
    ): vector<position_tp_sl_tracker::PendingRequest> {
        // Get triggered orders from tracker based on price direction
        let triggered_orders = if (is_price_moving_up) {
            position_tp_sl_tracker::take_ready_price_move_up_orders(market, current_price, max_orders)
        } else {
            position_tp_sl_tracker::take_ready_price_move_down_orders(market, current_price, max_orders)
        };

        // Reverse to process in FIFO order (tracker returns in reverse order)
        vector::reverse<position_tp_sl_tracker::PendingRequest>(&mut triggered_orders);

        let orders_to_process = triggered_orders;
        let remaining_count = vector::length<position_tp_sl_tracker::PendingRequest>(&orders_to_process);

        // Process each triggered order - remove from pending tracker
        loop {
            if (!(remaining_count > 0)) break;

            // Pop the last order (we reversed so this is actually FIFO)
            let pending_request = vector::pop_back<position_tp_sl_tracker::PendingRequest>(&mut orders_to_process);

            // Get order details
            let account = position_tp_sl_tracker::get_account_from_pending_request(&pending_request);
            let position = perp_positions::must_find_position_copy(account, market);
            let is_long = perp_positions::is_long(&position);

            // Determine if this is a TP or SL based on position direction and price movement
            // Long position + price up = TP triggered
            // Long position + price down = SL triggered
            // Short position + price up = SL triggered
            // Short position + price down = TP triggered
            let is_tp = if (is_long) {
                is_price_moving_up  // Long: price up = TP
            } else {
                !is_price_moving_up  // Short: price down = TP
            };

            // Check if this is a fixed-size or full-size order
            let size = position_tp_sl_tracker::get_size_from_pending_request(&pending_request);
            let is_full_sized = option::is_none<u64>(&size);
            let order_id = position_tp_sl_tracker::get_order_id_from_pending_request(&pending_request);

            // Remove the order from pending tracker
            if (is_full_sized) {
                let _removed = pending_order_tracker::remove_full_sized_tp_sl_for_order(
                    account,
                    market,
                    order_id,
                    is_tp
                );
            } else {
                let _removed = pending_order_tracker::remove_fixed_sized_tp_sl_for_order(
                    account,
                    market,
                    order_id,
                    is_tp
                );
            };

            remaining_count = remaining_count - 1;
        };

        // Clean up empty vector
        vector::destroy_empty<position_tp_sl_tracker::PendingRequest>(orders_to_process);

        // Return the original triggered orders for execution
        triggered_orders
    }
}
