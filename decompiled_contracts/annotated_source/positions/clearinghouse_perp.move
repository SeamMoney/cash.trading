/// ============================================================================
/// CLEARINGHOUSE PERP - Trade Settlement and Order Validation
/// ============================================================================
///
/// This module handles the core trade settlement logic for perpetual markets.
/// It acts as the clearinghouse between the order book and position management.
///
/// KEY RESPONSIBILITIES:
/// - Trade settlement between taker and maker
/// - Order placement validation (margin, reduce-only, market status)
/// - Reduce-only order enforcement
/// - Open interest cap enforcement
/// - Attached TP/SL order creation after fills
/// - Backstop liquidation and ADL settlement
/// - Order cleanup on cancellation
///
/// TRADE FLOW:
/// 1. Order book matches taker with maker
/// 2. clearinghouse validates both sides can settle
/// 3. Position updates are validated (margin, leverage)
/// 4. Trade is committed, balances updated
/// 5. Reduce-only orders are cancelled if position closed
/// 6. Child TP/SL orders are placed if attached
/// 7. Open interest tracking is updated
///
/// ============================================================================

module decibel::clearinghouse_perp {
    use aptos_framework::object;
    use decibel::perp_market;
    use econia::order_book_types;
    use decibel::perp_engine_types;
    use econia::market_types;
    use decibel::accounts_collateral;
    use std::string;
    use std::option;
    use decibel::pending_order_tracker;
    use decibel::order_margin;
    use decibel::perp_positions;
    use decibel::perp_market_config;
    use decibel::open_interest_tracker;
    use decibel::builder_code_registry;
    use decibel::position_update;
    use decibel::fee_distribution;
    use decibel::backstop_liquidator_profit_tracker;
    use aptos_framework::error;
    use std::vector;
    use decibel::price_management;
    use aptos_framework::math64;
    use econia::market_clearinghouse_order_info;
    use decibel::position_tp_sl;
    use decibel::tp_sl_utils;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::order_placement_utils;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;

    // ============================================================================
    // MAKER ORDER PLACEMENT
    // ============================================================================

    /// Called when a maker (limit) order is placed on the book
    ///
    /// Validates margin and registers pending order for margin tracking.
    /// IOC orders and backstop liquidator orders skip registration.
    friend fun place_maker_order(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        order_id: order_book_types::OrderIdType,
        price: u64,
        is_buy: bool,
        size: u64,
        time_in_force: order_book_types::TimeInForce,
        metadata: perp_engine_types::OrderMetadata
    ): market_types::PlaceMakerOrderResult<perp_engine_types::OrderMatchingActions> {
        // Skip for backstop liquidator or IOC orders
        let skip_registration = (account == accounts_collateral::backstop_liquidator())
            || (time_in_force == order_book_types::immediate_or_cancel());

        if (skip_registration) {
            return market_types::new_place_maker_order_result(
                option::none(),
                option::none()
            )
        };

        // Register attached TP/SL tracking
        let has_tp = option::is_some(&perp_engine_types::get_tp_from_metadata(&metadata));
        let has_sl = option::is_some(&perp_engine_types::get_sl_from_metadata(&metadata));
        if (has_tp || has_sl) {
            pending_order_tracker::add_order_based_tp_sl(account, market, has_tp, has_sl);
        };

        // Register for margin tracking
        let actions = if (perp_engine_types::is_reduce_only(&metadata)) {
            // Reduce-only: track separately for cancellation when position closes
            order_margin::add_reduce_only_order(account, market, order_id, size, is_buy)
        } else {
            // Normal order: add to pending order margin
            accounts_collateral::add_pending_order(account, market, size, is_buy, price);
            vector::empty()
        };

        if (vector::length(&actions) > 0) {
            // Return actions to cancel conflicting orders
            market_types::new_place_maker_order_result(
                option::none(),
                option::some(perp_engine_types::new_place_maker_order_actions(actions))
            )
        } else {
            market_types::new_place_maker_order_result(
                option::none(),
                option::none()
            )
        }
    }

    // ============================================================================
    // ORDER CLEANUP
    // ============================================================================

    /// Called when an order is removed from the book (filled, cancelled, expired)
    ///
    /// Removes order from pending margin tracking and cleans up TP/SL registrations.
    friend fun cleanup_order(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        order_id: order_book_types::OrderIdType,
        price: u64,
        remaining_size: u64,
        is_buy: bool,
        was_filled: bool,
        time_in_force: order_book_types::TimeInForce,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        metadata: perp_engine_types::OrderMetadata
    ) {
        // Skip cleanup for orders that were never registered
        let was_ioc = time_in_force == order_book_types::immediate_or_cancel();
        let skip_cleanup = was_filled || was_ioc || option::is_some(&trigger_condition);

        if (skip_cleanup) {
            return
        };

        // Clean up TP/SL registration
        let has_tp = option::is_some(&perp_engine_types::get_tp_from_metadata(&metadata));
        let has_sl = option::is_some(&perp_engine_types::get_sl_from_metadata(&metadata));
        if (has_tp || has_sl) {
            pending_order_tracker::remove_order_based_tp_sl(account, market, has_tp, has_sl);
        };

        // Skip margin cleanup for reduce-only, backstop, or fully filled orders
        let is_reduce_only = perp_engine_types::is_reduce_only(&metadata);
        let is_backstop = account == accounts_collateral::backstop_liquidator();
        let no_remaining = remaining_size == 0;

        if (is_reduce_only || no_remaining || is_backstop) {
            return
        };

        // Remove from pending order margin tracking
        if (remaining_size > 0 && !is_backstop) {
            let (pos_size, pos_is_long, pos_leverage) = perp_positions::get_position_details_or_default(account, market);
            pending_order_tracker::remove_pending_order(
                account, market, order_id, remaining_size, price, is_buy,
                is_reduce_only, pos_size, pos_is_long, pos_leverage
            );
        };
    }

    // ============================================================================
    // TRADE SETTLEMENT
    // ============================================================================

    /// Main trade settlement function
    ///
    /// Called when a trade matches between taker and maker. Handles:
    /// - Reduce-only enforcement
    /// - Open interest caps
    /// - Position updates for both sides
    /// - Fee distribution
    /// - Cleanup of reduce-only orders on position close
    /// - Creation of child TP/SL orders
    ///
    /// Returns SettleTradeResult with:
    /// - settled_size: Actual size that was settled (may be less than requested)
    /// - taker_fail_reason: Why taker couldn't fill (if any)
    /// - maker_fail_reason: Why maker couldn't fill (if any)
    /// - callback_result: Actions to execute and whether to continue matching
    friend fun settle_trade(
        market: object::Object<perp_market::PerpMarket>,
        taker: address,
        maker: address,
        taker_order_id: order_book_types::OrderIdType,
        maker_order_id: order_book_types::OrderIdType,
        taker_client_id: option::Option<string::String>,
        maker_client_id: option::Option<string::String>,
        taker_is_buy: bool,
        price: u64,
        size: u64,
        maker_remaining_size: u64,
        order_type: order_book_types::OrderType,
        taker_metadata: perp_engine_types::OrderMetadata,
        maker_metadata: perp_engine_types::OrderMetadata,
        fill_id: u128
    ): market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions> {
        // Validate basic requirements
        assert!(taker != maker, error::invalid_argument(13));
        assert!(size > 0, error::invalid_argument(2));
        assert!(price > 0, error::invalid_argument(4));

        // Check if market allows settlement
        if (!perp_market_config::can_settle_order(market, maker, taker)) {
            return market_types::new_settle_trade_result(
                0,
                option::some(string::utf8(b"Market is halted")),
                option::some(string::utf8(b"Market is halted")),
                market_types::new_callback_result_continue_matching(
                    perp_engine_types::new_settle_trade_actions(vector::empty())
                )
            )
        };

        // Check reduce-only constraints and get adjusted size
        let (early_return, adjusted_size_opt, taker_reason, maker_reason) =
            get_reduce_only_settlement_size(market, taker, maker, taker_is_buy, size, taker_metadata, maker_metadata);

        if (option::is_some(&early_return)) {
            return option::destroy_some(early_return)
        };

        let mut adjusted_size = option::destroy_some(adjusted_size_opt);

        // Check open interest cap
        let max_oi_delta = open_interest_tracker::get_max_open_interest_delta_for_market(market);
        let (final_size, oi_delta, oi_violated) = get_adjusted_size_for_open_interest_cap(
            taker, maker, market, taker_is_buy, adjusted_size, max_oi_delta
        );

        if (final_size == 0) {
            return market_types::new_settle_trade_result(
                0,
                option::none(),
                option::some(string::utf8(b"Max open interest violation")),
                market_types::new_callback_result_continue_matching(
                    perp_engine_types::new_settle_trade_actions(vector::empty())
                )
            )
        };

        let mut maker_reason = maker_reason;
        if (oi_violated) {
            maker_reason = option::some(string::utf8(b"Max open interest violation"));
        };

        // Validate taker position update
        let taker_builder_code = perp_engine_types::get_builder_code_from_metadata(&taker_metadata);
        let taker_use_backstop = perp_engine_types::use_backstop_liquidation_margin(&taker_metadata);
        let taker_is_margin_call = perp_engine_types::is_margin_call(&taker_metadata);

        let taker_update = accounts_collateral::validate_position_update_for_settlement(
            taker, market, price, taker_is_buy, true, final_size,
            taker_builder_code, taker_use_backstop, taker_is_margin_call
        );

        if (!position_update::is_update_successful(&taker_update)) {
            return market_types::new_settle_trade_result(
                0,
                maker_reason,
                option::some(position_update::unwrap_failed_update_reason(&taker_update)),
                market_types::new_callback_result_continue_matching(
                    perp_engine_types::new_settle_trade_actions(vector::empty())
                )
            )
        };

        // Validate maker position update
        let maker_builder_code = perp_engine_types::get_builder_code_from_metadata(&maker_metadata);
        let maker_use_backstop = perp_engine_types::use_backstop_liquidation_margin(&maker_metadata);
        let maker_is_margin_call = perp_engine_types::is_margin_call(&maker_metadata);

        let maker_update = accounts_collateral::validate_position_update_for_settlement(
            maker, market, price, !taker_is_buy, false, final_size,
            maker_builder_code, maker_use_backstop, maker_is_margin_call
        );

        if (!position_update::is_update_successful(&maker_update)) {
            return market_types::new_settle_trade_result(
                0,
                option::some(position_update::unwrap_failed_update_reason(&maker_update)),
                taker_reason,
                market_types::new_callback_result_continue_matching(
                    perp_engine_types::new_settle_trade_actions(vector::empty())
                )
            )
        };

        // Both sides validated - commit the trade
        let taker_fee_dist = position_update::unwrap_fee_distribution(&taker_update);
        let maker_fee_dist = position_update::unwrap_fee_distribution(&maker_update);

        let taker_closed_or_flipped = position_update::unwrap_is_closed_or_flipped(&taker_update);
        let maker_closed_or_flipped = position_update::unwrap_is_closed_or_flipped(&maker_update);

        // Determine trade trigger source
        let taker_trigger = if (perp_engine_types::is_margin_call(&taker_metadata)) {
            perp_positions::new_trade_trigger_source_margin_call()
        } else {
            perp_positions::new_trade_trigger_source_order_fill()
        };

        // Commit taker position
        let (taker_new_size, taker_new_is_long, taker_new_leverage) = accounts_collateral::commit_update_position(
            option::some(taker_order_id), taker_client_id, price, taker_is_buy, final_size,
            taker_builder_code, taker_update, fill_id, taker_trigger
        );

        // Commit maker position
        let maker_trigger = if (perp_engine_types::is_margin_call(&maker_metadata)) {
            perp_positions::new_trade_trigger_source_margin_call()
        } else {
            perp_positions::new_trade_trigger_source_order_fill()
        };

        let (maker_new_size, maker_new_is_long, maker_new_leverage) = accounts_collateral::commit_update_position(
            option::some(maker_order_id), maker_client_id, price, !taker_is_buy, final_size,
            maker_builder_code, maker_update, fill_id, maker_trigger
        );

        // Update pending order tracking for maker (if not backstop liquidator)
        let backstop = accounts_collateral::backstop_liquidator();
        if (maker != backstop) {
            if (order_book_types::is_single_order_type(&order_type)) {
                pending_order_tracker::remove_pending_order(
                    maker, market, maker_order_id, final_size, maker_remaining_size, !taker_is_buy,
                    perp_engine_types::is_reduce_only(&maker_metadata),
                    maker_new_size, maker_new_is_long, maker_new_leverage
                );
            } else {
                pending_order_tracker::update_position(
                    maker, market, maker_new_size, maker_new_is_long, maker_new_leverage
                );
            };
        };

        // Track backstop liquidator positions
        if (taker == backstop || maker == backstop) {
            let blp_is_buy = if (taker == backstop) { taker_is_buy } else { !taker_is_buy };
            backstop_liquidator_profit_tracker::track_position_update(market, price, final_size, blp_is_buy, true);
        };

        // Distribute fees
        accounts_collateral::distribute_fees(&taker_fee_dist, &maker_fee_dist);

        // Collect actions for orders to cancel
        let mut actions = vector::empty();

        // Cancel reduce-only orders if taker position was closed/flipped
        if (taker_closed_or_flipped) {
            let ro_orders = pending_order_tracker::clear_reduce_only_orders(taker, market);
            let i = 0;
            let len = vector::length(&ro_orders);
            while (i < len) {
                let order_id = *vector::borrow(&ro_orders, i);
                vector::push_back(&mut actions, perp_engine_types::new_cancel_order_action(taker, order_id));
                i = i + 1;
            };
        };

        // Cancel reduce-only orders if maker position was closed/flipped
        if (maker_closed_or_flipped) {
            let ro_orders = pending_order_tracker::clear_reduce_only_orders(maker, market);
            let i = 0;
            let len = vector::length(&ro_orders);
            while (i < len) {
                let order_id = *vector::borrow(&ro_orders, i);
                vector::push_back(&mut actions, perp_engine_types::new_cancel_order_action(maker, order_id));
                i = i + 1;
            };
        };

        // Place child TP/SL orders
        place_child_tp_sl_orders(market, taker, final_size, &taker_metadata);
        place_child_tp_sl_orders(market, maker, final_size, &maker_metadata);

        // Record open interest change
        open_interest_tracker::mark_open_interest_delta_for_market(market, oi_delta);

        // Build result
        let callback_result = if (vector::length(&actions) == 0) {
            market_types::new_callback_result_continue_matching(
                perp_engine_types::new_settle_trade_actions(vector::empty())
            )
        } else {
            // Stop matching to process cancellations
            market_types::new_callback_result_stop_matching(
                perp_engine_types::new_settle_trade_actions(actions)
            )
        };

        market_types::new_settle_trade_result(
            final_size, maker_reason, taker_reason, callback_result
        )
    }

    // ============================================================================
    // REDUCE-ONLY SIZE CALCULATION
    // ============================================================================

    /// Calculate settlement size respecting reduce-only constraints
    ///
    /// If either order is reduce-only, the size is limited to what would
    /// reduce (not flip) the position.
    fun get_reduce_only_settlement_size(
        market: object::Object<perp_market::PerpMarket>,
        taker: address,
        maker: address,
        taker_is_buy: bool,
        size: u64,
        taker_metadata: perp_engine_types::OrderMetadata,
        maker_metadata: perp_engine_types::OrderMetadata
    ): (
        option::Option<market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions>>,
        option::Option<u64>,
        option::Option<string::String>,
        option::Option<string::String>
    ) {
        let mut taker_reason = option::none();
        let mut maker_reason = option::none();

        // Get taker's max settlement size
        let taker_max = get_settlement_size_and_reason(
            market, taker, taker_is_buy, size, taker_metadata, &mut taker_reason
        );

        if (option::is_none(&taker_max)) {
            // Taker violates reduce-only constraint
            return (
                option::some(market_types::new_settle_trade_result(
                    0,
                    option::none(),
                    option::some(string::utf8(b"Taker reduce only violation")),
                    market_types::new_callback_result_continue_matching(
                        perp_engine_types::new_settle_trade_actions(vector::empty())
                    )
                )),
                option::none(),
                option::none(),
                option::none()
            )
        };

        let taker_max_size = option::destroy_some(taker_max);

        // Get maker's max settlement size
        let maker_max = get_settlement_size_and_reason(
            market, maker, !taker_is_buy, size, maker_metadata, &mut maker_reason
        );

        if (option::is_none(&maker_max)) {
            // Maker violates reduce-only constraint
            return (
                option::some(market_types::new_settle_trade_result(
                    0,
                    option::some(string::utf8(b"Maker reduce only violation")),
                    taker_reason,
                    market_types::new_callback_result_continue_matching(
                        perp_engine_types::new_settle_trade_actions(vector::empty())
                    )
                )),
                option::none(),
                option::none(),
                option::none()
            )
        };

        let maker_max_size = option::destroy_some(maker_max);

        // Use minimum of both sizes
        let final_size = math64::min(taker_max_size, maker_max_size);

        (option::none(), option::some(final_size), taker_reason, maker_reason)
    }

    /// Get max settlement size for a single order, respecting reduce-only
    fun get_settlement_size_and_reason(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_buy: bool,
        size: u64,
        metadata: perp_engine_types::OrderMetadata,
        reason_out: &mut option::Option<string::String>
    ): option::Option<u64> {
        let max_size = max_settlement_size<perp_engine_types::OrderMetadata>(
            market, account, is_buy, size, metadata
        );

        if (option::is_none(&max_size)) {
            return option::none()
        };

        let max = option::destroy_some(max_size);
        if (max != size) {
            *reason_out = option::some(string::utf8(b"Taker reduce only violation"));
        };

        option::some(max)
    }

    /// Calculate max settlement size considering reduce-only
    friend fun max_settlement_size<T: copy + drop + store>(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_buy: bool,
        size: u64,
        metadata: perp_engine_types::OrderMetadata
    ): option::Option<u64> {
        // If not reduce-only and market not in reduce-only mode, allow full size
        let is_ro = perp_engine_types::is_reduce_only(&metadata);
        let market_ro = perp_market_config::is_reduce_only(market, account);

        if (!is_ro && !market_ro) {
            return option::some(size)
        };

        // Validate reduce-only constraints
        let update_result = accounts_collateral::validate_reduce_only_update(account, market, is_buy, size);

        if (position_update::is_reduce_only_violation(&update_result)) {
            return option::none()
        };

        option::some(position_update::get_reduce_only_size(&update_result))
    }

    // ============================================================================
    // OPEN INTEREST CAP
    // ============================================================================

    /// Adjust settlement size to respect open interest cap
    ///
    /// Returns:
    /// - adjusted_size: Size that respects OI cap
    /// - oi_delta: Net change in open interest
    /// - was_reduced: Whether size was reduced due to cap
    fun get_adjusted_size_for_open_interest_cap(
        taker: address,
        maker: address,
        market: object::Object<perp_market::PerpMarket>,
        taker_is_buy: bool,
        size: u64,
        max_delta: u64
    ): (u64, i64, bool) {
        // Calculate OI delta from both sides
        let taker_delta = perp_positions::get_open_interest_delta_for_long(taker, market, taker_is_buy, size);
        let maker_delta = perp_positions::get_open_interest_delta_for_long(maker, market, !taker_is_buy, size);
        let total_delta = taker_delta + maker_delta;

        // If within cap, allow full size
        if (size < max_delta) {
            return (size, total_delta, false)
        };

        // Check if we exceed cap
        let max_delta_i64 = max_delta as i64;
        if (total_delta <= max_delta_i64) {
            return (size, total_delta, false)
        };

        // Need to reduce size
        assert!(total_delta >= 0, error::invalid_argument(10));
        let excess = (total_delta as u64) - max_delta;

        if (excess >= size) {
            // Can't settle anything
            return (0, 0i64, true)
        };

        // Reduce size by excess
        let reduced_size = size - excess;
        (reduced_size, max_delta_i64, true)
    }

    // ============================================================================
    // CHILD TP/SL ORDER PLACEMENT
    // ============================================================================

    /// Place child TP/SL orders after a trade fills
    ///
    /// Called after successful trade settlement to create the attached TP/SL orders.
    fun place_child_tp_sl_orders(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        fill_size: u64,
        metadata: &perp_engine_types::OrderMetadata
    ) {
        let tp_opt = perp_engine_types::get_tp_from_metadata(metadata);
        let sl_opt = perp_engine_types::get_sl_from_metadata(metadata);

        // Exit early if no TP/SL
        if (option::is_none(&tp_opt) && option::is_none(&sl_opt)) {
            return
        };

        // Get current position size (limit TP/SL to position size)
        let position_size = perp_positions::get_position_size(account, market);
        let tp_sl_size = math64::min(fill_size, position_size);

        if (tp_sl_size == 0) {
            return
        };

        let builder_code = perp_engine_types::get_builder_code_from_metadata(metadata);

        // Place TP order if present
        if (option::is_some(&tp_opt)) {
            let (trigger_price, limit_price, _parent_id) = perp_engine_types::destroy_child_tp_sl_order(
                option::destroy_some(tp_opt)
            );

            if (position_tp_sl::validate_tp_sl(account, market, trigger_price, true)) {
                let order_id = order_book_types::next_order_id();
                tp_sl_utils::place_tp_sl_order_for_position_internal(
                    market, account, trigger_price, limit_price,
                    option::some(tp_sl_size), true, option::some(order_id),
                    builder_code, false, true
                );
            };
        };

        // Place SL order if present
        if (option::is_some(&sl_opt)) {
            let (trigger_price, limit_price, _parent_id) = perp_engine_types::destroy_child_tp_sl_order(
                option::destroy_some(sl_opt)
            );

            if (position_tp_sl::validate_tp_sl(account, market, trigger_price, false)) {
                let order_id = order_book_types::next_order_id();
                tp_sl_utils::place_tp_sl_order_for_position_internal(
                    market, account, trigger_price, limit_price,
                    option::some(tp_sl_size), false, option::some(order_id),
                    builder_code, false, true
                );
            };
        };
    }

    // ============================================================================
    // ORDER VALIDATION
    // ============================================================================

    /// Validate order placement before adding to book
    ///
    /// Checks:
    /// - Market is open for trading
    /// - User has sufficient margin
    /// - TP/SL limits not exceeded
    friend fun validate_order_placement(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_buy: bool,
        price: u64,
        size: u64,
        time_in_force: order_book_types::TimeInForce,
        metadata: perp_engine_types::OrderMetadata
    ): market_types::ValidationResult {
        // Check market allows order placement
        if (!perp_market_config::can_place_order(market, account)) {
            return market_types::new_validation_result(
                option::some(string::utf8(b"Market is halted"))
            )
        };

        // Backstop liquidator bypasses validation
        if (account == accounts_collateral::backstop_liquidator()) {
            return market_types::new_validation_result(option::none())
        };

        // Validate TP/SL limits
        let has_tp = option::is_some(&perp_engine_types::get_tp_from_metadata(&metadata));
        let has_sl = option::is_some(&perp_engine_types::get_sl_from_metadata(&metadata));
        if (has_tp || has_sl) {
            if (!pending_order_tracker::validate_order_based_tp_sl(account, market, has_tp, has_sl)) {
                return market_types::new_validation_result(
                    option::some(string::utf8(b"Max fixed size TP/SL reached for market"))
                )
            };
        };

        // IOC orders skip margin validation (validated at settlement)
        if (time_in_force == order_book_types::immediate_or_cancel()) {
            return market_types::new_validation_result(option::none())
        };

        // Validate margin
        let validation_result = if (perp_engine_types::is_reduce_only(&metadata)) {
            order_margin::validate_reduce_only_order(account, market, is_buy)
        } else {
            accounts_collateral::validate_order_placement(account, market, size, is_buy, price)
        };

        market_types::new_validation_result(validation_result)
    }

    /// Validate bulk order placement (market maker)
    friend fun validate_bulk_order_placement(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        buy_prices: &vector<u64>,
        buy_sizes: &vector<u64>,
        sell_prices: &vector<u64>,
        sell_sizes: &vector<u64>
    ): market_types::ValidationResult {
        // Validate price/size arrays
        perp_market_config::validate_array_of_price_and_size(market, buy_prices, buy_sizes);
        perp_market_config::validate_array_of_price_and_size(market, sell_prices, sell_sizes);

        // Backstop liquidator bypasses validation
        if (account == accounts_collateral::backstop_liquidator()) {
            return market_types::new_validation_result(option::none())
        };

        // Validate buy side margin
        if (!vector::is_empty(buy_prices)) {
            let (avg_price, total_size) = get_effective_price_and_size(buy_prices, buy_sizes);
            let result = accounts_collateral::validate_order_placement(account, market, total_size, true, avg_price);
            if (option::is_some(&result)) {
                return market_types::new_validation_result(result)
            };
        };

        // Validate sell side margin
        if (!vector::is_empty(sell_prices)) {
            let (avg_price, total_size) = get_effective_price_and_size(sell_prices, sell_sizes);
            let result = accounts_collateral::validate_order_placement(account, market, total_size, false, avg_price);
            if (option::is_some(&result)) {
                return market_types::new_validation_result(result)
            };
        };

        market_types::new_validation_result(option::none())
    }

    /// Calculate weighted average price and total size for bulk orders
    fun get_effective_price_and_size(
        prices: &vector<u64>,
        sizes: &vector<u64>
    ): (u64, u64) {
        assert!(vector::length(sizes) == vector::length(prices), error::invalid_argument(1));

        let mut i = 0;
        let mut weighted_sum = 0u128;
        let mut total_size = 0u128;

        let len = vector::length(prices);
        while (i < len) {
            let size = (*vector::borrow(sizes, i)) as u128;
            let price_x_size = ((*vector::borrow(prices, i)) as u128) * size;
            weighted_sum = weighted_sum + price_x_size;
            total_size = total_size + size;
            i = i + 1;
        };

        let avg_price = weighted_sum / total_size;
        assert!(avg_price <= 9223372036854775807, error::invalid_argument(5));
        assert!(total_size <= 9223372036854775807, error::invalid_argument(3));

        (avg_price as u64, total_size as u64)
    }

    // ============================================================================
    // ORDER SIZE REDUCTION
    // ============================================================================

    /// Reduce order size (for reduce-only orders when position is reduced)
    friend fun reduce_order_size(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        order_id: order_book_types::OrderIdType,
        metadata: perp_engine_types::OrderMetadata,
        size_delta: u64
    ) {
        assert!(perp_engine_types::is_reduce_only(&metadata), 15);
        pending_order_tracker::decrease_reduce_only_order_size(account, market, order_id, size_delta);
    }

    // ============================================================================
    // BACKSTOP LIQUIDATION / ADL SETTLEMENT
    // ============================================================================

    /// Settle a backstop liquidation or ADL trade
    ///
    /// Used when the backstop liquidator takes over a position or
    /// when ADL (Auto-Deleveraging) occurs.
    friend fun settle_backstop_liquidation_or_adl(
        from_account: address,     // Account being liquidated/ADL'd
        to_account: address,       // Counterparty (backstop or ADL target)
        market: object::Object<perp_market::PerpMarket>,
        is_buy: bool,
        price: u64,
        size: u64,
        is_adl: bool
    ): option::Option<u64> {
        // Validate inputs
        assert!(size > 0, error::invalid_argument(2));
        assert!(price > 0, error::invalid_argument(4));
        assert!(from_account != to_account, error::invalid_argument(13));

        let backstop = accounts_collateral::backstop_liquidator();

        // Apply open interest cap (with max u64 to effectively skip cap check)
        let (adjusted_size, oi_delta, _) = get_adjusted_size_for_open_interest_cap(
            from_account, to_account, market, is_buy, size, 9223372036854775807
        );

        assert!(adjusted_size > 0, error::invalid_argument(8));

        // Validate from_account update
        let from_update = accounts_collateral::validate_backstop_liquidation_or_adl_update(
            from_account, market, price, is_buy, true, adjusted_size
        );
        assert!(position_update::is_update_successful(&from_update), error::invalid_argument(8));

        // Validate to_account update
        let to_update = accounts_collateral::validate_backstop_liquidation_or_adl_update(
            to_account, market, price, !is_buy, false, adjusted_size
        );

        if (!position_update::is_update_successful(&to_update)) {
            return option::none()
        };

        // Determine trigger source
        let trigger_source = if (is_adl) {
            perp_positions::new_trade_trigger_source_adl()
        } else {
            perp_positions::new_trade_trigger_source_backstop_liquidation()
        };

        // Commit from_account position
        let (from_new_size, from_new_is_long, from_new_leverage) =
            accounts_collateral::commit_update_position_with_backstop_liquidator(
                price, is_buy, adjusted_size, from_update, backstop, trigger_source
            );

        // Update pending order tracking if not backstop
        if (from_account != backstop) {
            pending_order_tracker::update_position(from_account, market, from_new_size, from_new_is_long, from_new_leverage);
        };

        // Commit to_account position
        let to_trigger = if (is_adl) {
            perp_positions::new_trade_trigger_source_adl()
        } else {
            perp_positions::new_trade_trigger_source_backstop_liquidation()
        };

        let (to_new_size, to_new_is_long, to_new_leverage) =
            accounts_collateral::commit_update_position_with_backstop_liquidator(
                price, !is_buy, adjusted_size, to_update, from_account, to_trigger
            );

        if (to_account != backstop) {
            pending_order_tracker::update_position(to_account, market, to_new_size, to_new_is_long, to_new_leverage);
        };

        // Update open interest
        open_interest_tracker::mark_open_interest_delta_for_market(market, oi_delta);

        option::some(adjusted_size)
    }

    // ============================================================================
    // DELISTED MARKET POSITION CLOSE
    // ============================================================================

    /// Close position when market is delisted
    ///
    /// Forces position closure at the settlement price when a market is delisted.
    friend fun close_delisted_position(
        account: address,
        market: object::Object<perp_market::PerpMarket>
    ) {
        let (size, is_long) = perp_positions::get_position_size_and_is_long(account, market);

        if (size == 0) {
            return
        };

        let mark_price = price_management::get_mark_price(market);

        // Validate the close
        let update = accounts_collateral::validate_backstop_liquidation_or_adl_update(
            account, market, mark_price, !is_long, false, size
        );

        assert!(position_update::is_update_successful(&update), 8);

        let backstop = accounts_collateral::backstop_liquidator();
        let trigger_source = perp_positions::new_trade_trigger_source_market_delisted();

        // Commit the close
        accounts_collateral::commit_update_position_with_backstop_liquidator(
            mark_price, !is_long, size, update, backstop, trigger_source
        );
    }

    // ============================================================================
    // MARKET CALLBACKS
    // ============================================================================

    /// Create clearinghouse callbacks for the order book
    ///
    /// These callbacks are invoked by the order book during matching to handle:
    /// - Trade settlement
    /// - Order validation
    /// - Maker order placement
    /// - Order cleanup
    /// - Size reduction
    friend fun market_callbacks(
        market: object::Object<perp_market::PerpMarket>
    ): market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions> {
        // Create callback functions (using lambdas)
        let settle_trade_cb = |_market_obj, taker_info, maker_info, fill_id, price, size|
            lambda_settle_trade(market, _market_obj, taker_info, maker_info, fill_id, price, size);

        let validate_order_cb = |order_info, size|
            lambda_validate_order(market, order_info, size);

        let validate_bulk_cb = |account, buy_prices, buy_sizes, sell_prices, sell_sizes, _metadata|
            lambda_validate_bulk(market, account, buy_prices, buy_sizes, sell_prices, sell_sizes, _metadata);

        let place_maker_cb = |order_info, size|
            lambda_place_maker(market, order_info, size);

        let cleanup_cb = |order_info, size, was_filled|
            lambda_cleanup(market, order_info, size, was_filled);

        let size_reduced_cb = |account, order_id, is_buy, old_size, new_size|
            lambda_size_reduced(account, order_id, is_buy, old_size, new_size);

        let reduce_size_cb = |order_info, size|
            lambda_reduce_size(market, order_info, size);

        let serialize_cb = |metadata|
            perp_engine_types::get_order_metadata_bytes(metadata);

        market_types::new_market_clearinghouse_callbacks(
            settle_trade_cb,
            validate_order_cb,
            validate_bulk_cb,
            place_maker_cb,
            cleanup_cb,
            size_reduced_cb,
            reduce_size_cb,
            serialize_cb
        )
    }

    /// Lambda for settle trade callback
    fun lambda_settle_trade(
        market: object::Object<perp_market::PerpMarket>,
        _market_obj: &mut market_types::Market<perp_engine_types::OrderMetadata>,
        taker_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        maker_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        fill_id: u128,
        price: u64,
        size: u64
    ): market_types::SettleTradeResult<perp_engine_types::OrderMatchingActions> {
        let (taker_account, taker_order_id, taker_client_id, taker_is_buy, taker_price, taker_tif, _, _, taker_metadata) =
            market_clearinghouse_order_info::into_inner(taker_info);
        let (maker_account, maker_order_id, maker_client_id, _, maker_size, _, _, _, maker_metadata) =
            market_clearinghouse_order_info::into_inner(maker_info);

        settle_trade(
            market, taker_account, maker_account,
            taker_order_id, maker_order_id,
            taker_client_id, maker_client_id,
            taker_is_buy, price, size, maker_size,
            order_book_types::single_order_type(),
            taker_metadata, maker_metadata, fill_id
        )
    }

    /// Lambda for validate order callback
    fun lambda_validate_order(
        market: object::Object<perp_market::PerpMarket>,
        order_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        size: u64
    ): market_types::ValidationResult {
        let (account, _, _, is_buy, price, time_in_force, _, _, metadata) =
            market_clearinghouse_order_info::into_inner(order_info);
        validate_order_placement(market, account, is_buy, price, size, time_in_force, metadata)
    }

    /// Lambda for validate bulk callback
    fun lambda_validate_bulk(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        buy_prices: &vector<u64>,
        buy_sizes: &vector<u64>,
        sell_prices: &vector<u64>,
        sell_sizes: &vector<u64>,
        _metadata: &perp_engine_types::OrderMetadata
    ): market_types::ValidationResult {
        validate_bulk_order_placement(market, account, buy_prices, buy_sizes, sell_prices, sell_sizes)
    }

    /// Lambda for place maker order callback
    fun lambda_place_maker(
        market: object::Object<perp_market::PerpMarket>,
        order_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        size: u64
    ): market_types::PlaceMakerOrderResult<perp_engine_types::OrderMatchingActions> {
        let (account, order_id, _, is_buy, price, time_in_force, _, _, metadata) =
            market_clearinghouse_order_info::into_inner(order_info);
        place_maker_order(market, account, order_id, price, is_buy, size, time_in_force, metadata)
    }

    /// Lambda for cleanup callback
    fun lambda_cleanup(
        market: object::Object<perp_market::PerpMarket>,
        order_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        remaining_size: u64,
        was_filled: bool
    ) {
        let (account, order_id, _, is_buy, price, time_in_force, _, trigger, metadata) =
            market_clearinghouse_order_info::into_inner(order_info);
        cleanup_order(market, account, order_id, price, remaining_size, is_buy, was_filled, time_in_force, trigger, metadata);
    }

    /// Lambda for size reduced callback (no-op)
    fun lambda_size_reduced(
        _account: address,
        _order_id: order_book_types::OrderIdType,
        _is_buy: bool,
        _old_size: u64,
        _new_size: u64
    ) {
        // No action needed
    }

    /// Lambda for reduce size callback
    fun lambda_reduce_size(
        market: object::Object<perp_market::PerpMarket>,
        order_info: market_clearinghouse_order_info::MarketClearinghouseOrderInfo<perp_engine_types::OrderMetadata>,
        size: u64
    ) {
        let (account, order_id, _, _, _, _, _, _, metadata) =
            market_clearinghouse_order_info::into_inner(order_info);
        reduce_order_size(market, account, order_id, metadata, size);
    }
}
