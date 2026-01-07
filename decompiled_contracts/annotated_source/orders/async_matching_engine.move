/// ============================================================================
/// ASYNC MATCHING ENGINE - Asynchronous Order Queue and Matching
/// ============================================================================
///
/// This module implements an asynchronous order matching system that queues
/// orders and other trading operations for sequential processing. This ensures
/// fair ordering and prevents front-running within a transaction.
///
/// KEY FEATURES:
/// - FIFO order queue with time-based priority
/// - TWAP (Time-Weighted Average Price) order support
/// - Liquidation scheduling and processing
/// - ADL (Auto-Deleveraging) triggers
/// - Price-based conditional order triggering
///
/// PENDING REQUEST TYPES:
/// - Order: Standard order waiting to be matched
/// - Twap: TWAP order with remaining slices to execute
/// - ContinuedOrder: Partially filled order continuing execution
/// - Liquidation: Position being liquidated
/// - CheckADL: Check if ADL should be triggered
/// - TriggerADL: Execute ADL at specified price
/// - RefreshWithdrawMarkPrice: Update mark price for withdrawals
///
/// QUEUE ORDERING:
/// - Liquidations have higher priority (time=1,2,3)
/// - Regular transactions use microsecond timestamp
/// - Tie-breaker uses monotonically increasing counter
///
/// ============================================================================

module decibel::async_matching_engine {
    use std::vector;
    use std::option;
    use std::string;
    use std::signer;
    use std::error;
    use std::event;
    use std::object;
    use aptos_std::big_ordered_map;
    use aptos_framework::transaction_context;

    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::perp_engine_types;
    use decibel::price_management;
    use decibel::clearinghouse_perp;
    use decibel::accounts_collateral;
    use decibel::perp_positions;
    use decibel::liquidation;
    use decibel::tp_sl_utils;
    use decibel::order_placement_utils;
    use decibel::builder_code_registry;
    use decibel::backstop_liquidator_profit_tracker;
    use decibel::decibel_time;
    use econia::order_book_types;
    use econia::market_types;
    use econia::single_order_types;
    use econia::order_placement;

    // ============================================================================
    // Constants
    // ============================================================================

    /// Maximum number of requests to process per drain
    const MAX_DRAIN_ITERATIONS: u64 = 100;

    /// Default fill limit for orders
    const DEFAULT_FILL_LIMIT: u32 = 10;

    /// Minimum TWAP frequency in seconds
    const MIN_TWAP_FREQUENCY_S: u64 = 60;

    /// Minimum TWAP duration in seconds
    const MIN_TWAP_DURATION_S: u64 = 120;

    /// Maximum TWAP duration in seconds (24 hours)
    const MAX_TWAP_DURATION_S: u64 = 86400;

    /// Slippage basis points for TWAP orders
    const TWAP_SLIPPAGE_BPS: u64 = 300;  // 3%

    // ============================================================================
    // Error Codes
    // ============================================================================

    const E_ALREADY_EXISTS: u64 = 10;
    const E_TP_SL_WITH_REDUCE_ONLY: u64 = 12;
    const E_TP_SL_WITH_TRIGGER_PRICE: u64 = 13;
    const E_INVALID_TRIGGER_DIRECTION: u64 = 14;
    const E_ZERO_REMAINING_MATCHES: u64 = 16;
    const E_INVALID_TWAP_DURATION: u64 = 17;
    const E_INVALID_TWAP_FREQUENCY: u64 = 18;
    const E_TWAP_DURATION_NOT_DIVISIBLE: u64 = 19;
    const E_TWAP_SLICE_TOO_SMALL: u64 = 20;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::perp_engine;

    // ============================================================================
    // STRUCTS AND ENUMS
    // ============================================================================

    /// Main async matching engine resource stored on each market
    enum AsyncMatchingEngine has key {
        V1 {
            /// Priority queue of pending requests
            pending_requests: big_ordered_map::BigOrderedMap<PendingRequestKey, PendingRequest>,
            /// Whether async matching is enabled (orders queue vs immediate execution)
            async_matching_enabled: bool,
        }
    }

    /// Key for ordering pending requests in the queue
    enum PendingRequestKey has copy, drop, store {
        /// Liquidation-related requests (higher priority)
        Liquidatation {
            tie_breaker: u128,
            time: u64,  // 1=liquidation, 2=checkADL, 3=refreshMarkPrice
        }
        /// Regular trading operations
        RegularTransaction {
            time: u64,  // Microsecond timestamp
            tie_breaker: u128,
        }
    }

    /// Types of pending requests in the queue
    enum PendingRequest has store {
        /// Standard order waiting for matching
        Order {
            _0: PendingOrder,
        }
        /// TWAP order with remaining slices
        Twap {
            _0: PendingTwap,
        }
        /// Partially filled order continuing execution
        ContinuedOrder {
            _0: ContinuedPendingOrder,
        }
        /// Position being liquidated
        Liquidation {
            _0: PendingLiquidation,
        }
        /// Check if ADL should be triggered
        CheckADL,
        /// Execute ADL at this price
        TriggerADL {
            adl_price: u64,
        }
        /// Update mark price for withdrawal calculations
        RefreshWithdrawMarkPrice {
            mark_px: u64,
            funding_index: price_management::AccumulativeIndex,
        }
    }

    /// Pending order data
    struct PendingOrder has copy, drop, store {
        account: address,
        price: u64,
        orig_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        tp: option::Option<perp_engine_types::ChildTpSlOrder>,
        sl: option::Option<perp_engine_types::ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }

    /// TWAP order tracking
    struct PendingTwap has copy, drop, store {
        account: address,
        order_id: order_book_types::OrderIdType,
        is_buy: bool,
        orig_size: u64,
        remaining_size: u64,
        is_reduce_only: bool,
        twap_start_time_s: u64,
        twap_frequency_s: u64,
        twap_end_time_s: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        client_order_id: option::Option<string::String>,
    }

    /// Continued order after partial fill
    struct ContinuedPendingOrder has copy, drop, store {
        account: address,
        price: u64,
        orig_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        remaining_size: u64,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        tp: option::Option<perp_engine_types::ChildTpSlOrder>,
        sl: option::Option<perp_engine_types::ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }

    /// Pending liquidation state
    struct PendingLiquidation has store {
        user: address,
        markets_witnessed: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, bool>,
        market_during_cutoff: option::Option<object::Object<perp_market::PerpMarket>>,
        largest_slippage_tested: u64,
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Event emitted when system purges an order from queue
    enum SystemPurgedOrderEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            account: address,
            order_id: order_book_types::OrderIdType,
        }
    }

    /// Event emitted for TWAP order lifecycle
    enum TwapEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            account: address,
            is_buy: bool,
            order_id: order_book_types::OrderIdType,
            is_reduce_only: bool,
            start_time_s: u64,
            frequency_s: u64,
            duration_s: u64,
            orig_size: u64,
            remain_size: u64,
            status: TwapOrderStatus,
            client_order_id: option::Option<string::String>,
        }
    }

    /// TWAP order status
    enum TwapOrderStatus has copy, drop, store {
        Open,
        Triggered {
            _0: order_book_types::OrderIdType,  // Sub-order ID
            _1: u64,                             // Filled size
        }
        Cancelled {
            _0: string::String,  // Reason
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Register async matching engine for a market
    friend fun register_market(market_signer: &signer, async_enabled: bool) {
        let market_addr = signer::address_of(market_signer);
        if (exists<AsyncMatchingEngine>(market_addr)) {
            abort E_ALREADY_EXISTS
        };

        let engine = AsyncMatchingEngine::V1 {
            pending_requests: big_ordered_map::new_with_config<PendingRequestKey, PendingRequest>(
                0u16, 16u16, true
            ),
            async_matching_enabled: async_enabled,
        };
        move_to<AsyncMatchingEngine>(market_signer, engine);
    }

    // ============================================================================
    // ORDER PLACEMENT
    // ============================================================================

    /// Place an order on the market
    ///
    /// Orders may be queued for async processing or executed immediately
    /// depending on whether they cross the spread.
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: Order owner
    /// - `price`: Limit price
    /// - `size`: Order size
    /// - `is_buy`: True for buy, false for sell
    /// - `time_in_force`: Order time-in-force
    /// - `is_reduce_only`: True if reduce-only order
    /// - `provided_order_id`: Optional pre-generated order ID
    /// - `client_order_id`: Optional client-provided ID
    /// - `trigger_price`: Optional price trigger
    /// - `tp_trigger_price`: Optional take-profit trigger
    /// - `tp_limit_price`: Optional take-profit limit
    /// - `sl_trigger_price`: Optional stop-loss trigger
    /// - `sl_limit_price`: Optional stop-loss limit
    /// - `builder_code`: Optional builder rebate code
    ///
    /// # Returns
    /// The order ID
    friend fun place_order(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        price: u64,
        size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        provided_order_id: option::Option<order_book_types::OrderIdType>,
        client_order_id: option::Option<string::String>,
        trigger_price: option::Option<u64>,
        tp_trigger_price: option::Option<u64>,
        tp_limit_price: option::Option<u64>,
        sl_trigger_price: option::Option<u64>,
        sl_limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType acquires AsyncMatchingEngine {
        // Generate or use provided order ID
        let (order_id, is_new_order) = if (option::is_none<order_book_types::OrderIdType>(&provided_order_id)) {
            (order_book_types::next_order_id(), true)
        } else {
            (option::destroy_some<order_book_types::OrderIdType>(provided_order_id), false)
        };

        // Validate and create child TP/SL orders
        let (tp_order, sl_order) = tp_sl_utils::validate_and_get_child_tp_sl_orders(
            market, order_id, is_buy, tp_trigger_price, tp_limit_price, sl_trigger_price, sl_limit_price
        );

        let has_child_tp_sl = option::is_some<perp_engine_types::ChildTpSlOrder>(&tp_order) ||
                             option::is_some<perp_engine_types::ChildTpSlOrder>(&sl_order);

        // Validate: can't have TP/SL with reduce-only
        if (has_child_tp_sl) {
            if (is_reduce_only) { abort E_TP_SL_WITH_REDUCE_ONLY };
            assert!(option::is_none<u64>(&trigger_price), E_TP_SL_WITH_TRIGGER_PRICE);
        };

        // Validate builder code
        if (option::is_some<builder_code_registry::BuilderCode>(&builder_code)) {
            let code = option::borrow<builder_code_registry::BuilderCode>(&builder_code);
            builder_code_registry::validate_builder_code(account, code);
        };

        // Create trigger condition if trigger price specified
        let trigger_condition = if (option::is_some<u64>(&trigger_price)) {
            let mark_price = price_management::get_mark_price(market);
            let trigger = option::destroy_some<u64>(trigger_price);

            if (is_buy) {
                // Buy order triggers when price moves up
                assert!(mark_price < trigger, E_INVALID_TRIGGER_DIRECTION);
                option::some<order_book_types::TriggerCondition>(
                    order_book_types::price_move_up_condition(trigger)
                )
            } else {
                // Sell order triggers when price moves down
                if (mark_price > trigger) {
                    option::some<order_book_types::TriggerCondition>(
                        order_book_types::price_move_down_condition(trigger)
                    )
                } else {
                    abort E_INVALID_TRIGGER_DIRECTION
                }
            }
        } else {
            option::none<order_book_types::TriggerCondition>()
        };

        // Emit acknowledgment event for new orders
        if (is_new_order) {
            let status = market_types::order_status_acknowledged();
            let empty_msg = string::utf8(vector[]);
            let metadata = perp_engine_types::new_order_metadata(
                is_reduce_only,
                option::none<perp_engine_types::TwapMetadata>(),
                tp_order,
                sl_order,
                builder_code
            );
            let callbacks = clearinghouse_perp::market_callbacks(market);
            perp_market::emit_event_for_order(
                market, order_id, client_order_id, account, size, size, size, price,
                is_buy, true, status, empty_msg, metadata, trigger_condition, time_in_force, &callbacks
            );
        };

        // Determine if order will cross spread (taker) or rest on book (maker)
        if (perp_market::is_taker_order(market, price, is_buy, trigger_condition)) {
            // Taker order - queue for async matching
            add_taker_order_to_pending(
                market, account, price, size, is_buy, time_in_force, is_reduce_only,
                order_id, client_order_id, trigger_condition, tp_order, sl_order, builder_code
            );
        } else {
            // Maker order - place immediately
            let mut remaining_matches = DEFAULT_FILL_LIMIT;
            let metadata = perp_engine_types::new_order_metadata(
                is_reduce_only,
                option::none<perp_engine_types::TwapMetadata>(),
                tp_order,
                sl_order,
                builder_code
            );
            let (_order_id, _filled, _cancelled, _prices, _matches) =
                order_placement_utils::place_order_and_trigger_matching_actions(
                    market, account, price, size, size, is_buy, time_in_force,
                    trigger_condition, metadata, order_id, client_order_id, true, &mut remaining_matches
                );
        };

        // Trigger matching to process queue
        trigger_matching(market, DEFAULT_FILL_LIMIT);

        order_id
    }

    /// Place a TWAP (Time-Weighted Average Price) order
    ///
    /// TWAP orders execute over time in equal slices at regular intervals.
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `trader`: The trader placing the order
    /// - `size`: Total order size
    /// - `is_buy`: True for buy, false for sell
    /// - `is_reduce_only`: True if reduce-only order
    /// - `client_order_id`: Optional client-provided ID
    /// - `frequency_s`: Interval between slices in seconds (min 60)
    /// - `duration_s`: Total duration in seconds (min 120, max 86400)
    /// - `builder_code`: Optional builder rebate code
    ///
    /// # Returns
    /// The TWAP order ID
    friend fun place_twap_order(
        market: object::Object<perp_market::PerpMarket>,
        trader: &signer,
        size: u64,
        is_buy: bool,
        is_reduce_only: bool,
        client_order_id: option::Option<string::String>,
        frequency_s: u64,
        duration_s: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType {
        // Validate builder code
        if (option::is_some<builder_code_registry::BuilderCode>(&builder_code)) {
            let trader_addr = signer::address_of(trader);
            let code = option::borrow<builder_code_registry::BuilderCode>(&builder_code);
            builder_code_registry::validate_builder_code(trader_addr, code);
        };

        // Validate size
        perp_market_config::validate_size(market, size, false);

        // Validate duration
        assert!(duration_s >= MIN_TWAP_DURATION_S, E_INVALID_TWAP_DURATION);
        assert!(duration_s <= MAX_TWAP_DURATION_S, E_INVALID_TWAP_DURATION);

        // Validate frequency
        assert!(frequency_s >= MIN_TWAP_FREQUENCY_S, E_INVALID_TWAP_FREQUENCY);
        assert!(duration_s >= frequency_s, E_INVALID_TWAP_DURATION);
        assert!(duration_s % frequency_s == 0, E_TWAP_DURATION_NOT_DIVISIBLE);

        // Calculate number of slices and validate min slice size
        let now = decibel_time::now_seconds();
        let end_time = now + duration_s;
        let num_slices = duration_s / frequency_s + 1;
        let min_size = perp_market_config::get_min_size(market);
        assert!(size / num_slices >= min_size, E_TWAP_SLICE_TOO_SMALL);

        // Create TWAP metadata
        let twap_metadata = option::some<perp_engine_types::TwapMetadata>(
            perp_engine_types::new_twap_metadata(now, frequency_s, end_time)
        );
        let metadata = perp_engine_types::new_order_metadata(
            is_reduce_only,
            twap_metadata,
            option::none<perp_engine_types::ChildTpSlOrder>(),
            option::none<perp_engine_types::ChildTpSlOrder>(),
            builder_code
        );

        // Generate order ID
        let order_id = order_book_types::next_order_id();

        // Use extreme price for TWAP (will use slippage price at execution)
        let extreme_price = if (is_buy) { 9223372036854775807u64 } else { 1u64 };

        // Place order with time-based trigger
        let trader_addr = signer::address_of(trader);
        let time_in_force = order_book_types::immediate_or_cancel();
        let trigger_condition = option::some<order_book_types::TriggerCondition>(
            order_book_types::new_time_based_trigger_condition(now)
        );
        let callbacks = clearinghouse_perp::market_callbacks(market);

        let _result = perp_market::place_order_with_order_id(
            market, trader_addr, extreme_price, size, size, is_buy, time_in_force,
            trigger_condition, metadata, order_id, client_order_id, 1000u32, true, true, &callbacks
        );

        // Emit TWAP event
        let status = TwapOrderStatus::Open {};
        event::emit<TwapEvent>(TwapEvent::V1 {
            market,
            account: trader_addr,
            is_buy,
            order_id,
            is_reduce_only,
            start_time_s: now,
            frequency_s,
            duration_s,
            orig_size: size,
            remain_size: size,
            status,
            client_order_id,
        });

        order_id
    }

    /// Cancel a TWAP order
    friend fun cancel_twap_order(
        market: object::Object<perp_market::PerpMarket>,
        trader: &signer,
        order_id: order_book_types::OrderIdType
    ) {
        let trader_addr = signer::address_of(trader);
        let reason = market_types::order_cancellation_reason_cancelled_by_user();
        let empty_msg = string::utf8(vector[]);
        let callbacks = clearinghouse_perp::market_callbacks(market);

        // Cancel the order
        let cancelled_order = perp_market::cancel_order(
            market, trader_addr, order_id, false, reason, empty_msg, &callbacks
        );

        // Extract order details for event
        let (account, _order_id, _client_id, _trigger, _status, _entry_time, _price, _orig_size,
             _remain_size, is_buy, _tif, metadata) =
            single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(cancelled_order);

        let (start_time, frequency, end_time) = perp_engine_types::get_twap_from_metadata(&metadata);
        let is_reduce_only = perp_engine_types::is_reduce_only(&metadata);
        let duration = end_time - start_time;

        // Emit cancellation event
        let status = TwapOrderStatus::Cancelled {
            _0: string::utf8(vector[67u8, 97u8, 110u8, 99u8, 101u8, 108u8, 108u8, 101u8, 100u8, 32u8,
                                    98u8, 121u8, 32u8, 117u8, 115u8, 101u8, 114u8])  // "Cancelled by user"
        };
        event::emit<TwapEvent>(TwapEvent::V1 {
            market,
            account,
            is_buy,
            order_id,
            is_reduce_only,
            start_time_s: start_time,
            frequency_s: frequency,
            duration_s: duration,
            orig_size: _orig_size,
            remain_size: 0,
            status,
            client_order_id: option::none<string::String>(),
        });
    }

    // ============================================================================
    // LIQUIDATION
    // ============================================================================

    /// Liquidate a position
    friend fun liquidate_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ) acquires AsyncMatchingEngine {
        liquidate_position_with_fill_limit(user, market, DEFAULT_FILL_LIMIT);
    }

    /// Liquidate a position with custom fill limit
    friend fun liquidate_position_with_fill_limit(
        user: address,
        market: object::Object<perp_market::PerpMarket>,
        fill_limit: u32
    ) acquires AsyncMatchingEngine {
        // Verify account is liquidatable
        let status = accounts_collateral::position_status(user, market);
        if (!perp_positions::is_account_liquidatable_detailed(&status, false)) {
            abort error::invalid_argument(liquidation::get_enot_liquidatable())
        };

        // Schedule liquidation
        schedule_liquidation(user, market);

        // Schedule ADL check
        add_adl_to_pending(market);

        // Trigger matching if fill limit > 0
        if (fill_limit > 0u32) {
            trigger_matching_internal(market, fill_limit);
        };
    }

    /// Schedule a liquidation in the queue
    friend fun schedule_liquidation(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ) acquires AsyncMatchingEngine {
        // Cannot liquidate backstop liquidator
        let backstop = accounts_collateral::backstop_liquidator();
        if (!(user != backstop)) {
            abort error::invalid_argument(liquidation::get_ecannot_liquidate_backstop_liquidator())
        };

        // Create liquidation request
        let pending_liq = PendingLiquidation {
            user,
            markets_witnessed: big_ordered_map::new_from<object::Object<perp_market::PerpMarket>, bool>(
                vector::empty(), vector::empty()
            ),
            market_during_cutoff: option::none<object::Object<perp_market::PerpMarket>>(),
            largest_slippage_tested: 0,
        };

        // Add to queue
        let key = new_pending_liquidation_key();
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::Liquidation { _0: pending_liq }
        );
    }

    /// Add ADL check to pending queue
    friend fun add_adl_to_pending(market: object::Object<perp_market::PerpMarket>) acquires AsyncMatchingEngine {
        let key = new_pending_check_adl_key();
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::CheckADL {}
        );
    }

    // ============================================================================
    // MATCHING TRIGGER
    // ============================================================================

    /// Trigger matching engine to process pending requests
    friend fun trigger_matching(
        market: object::Object<perp_market::PerpMarket>,
        fill_limit: u32
    ) acquires AsyncMatchingEngine {
        trigger_matching_internal(market, fill_limit);
    }

    /// Internal matching trigger implementation
    fun trigger_matching_internal(
        market: object::Object<perp_market::PerpMarket>,
        mut fill_limit: u32
    ) acquires AsyncMatchingEngine {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);

        let async_enabled = engine.async_matching_enabled;
        let current_time = decibel_time::now_microseconds();

        assert!(fill_limit > 0u32, E_ZERO_REMAINING_MATCHES);

        // Process pending requests
        while (!big_ordered_map::is_empty<PendingRequestKey, PendingRequest>(&engine.pending_requests)
               && fill_limit > 0u32) {

            // Get front request
            let (key, request) = big_ordered_map::borrow_front<PendingRequestKey, PendingRequest>(
                &engine.pending_requests
            );

            // In async mode, skip future requests
            if (async_enabled) {
                let request_time = match (&key) {
                    PendingRequestKey::Liquidatation { time, .. } => *time,
                    PendingRequestKey::RegularTransaction { time, .. } => *time,
                };
                if (request_time >= current_time) {
                    return
                };
            };

            // Remove from queue
            let removed = big_ordered_map::remove<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests, &key
            );

            // Process based on request type
            match (removed) {
                PendingRequest::Order { _0: order } => {
                    process_pending_order(market, engine, order, key, &mut fill_limit);
                }
                PendingRequest::Twap { _0: twap } => {
                    trigger_pending_twap(market, engine, twap, &mut fill_limit, key);
                }
                PendingRequest::ContinuedOrder { _0: continued } => {
                    process_continued_order(market, engine, continued, key, &mut fill_limit);
                }
                PendingRequest::Liquidation { _0: liq } => {
                    process_pending_liquidation(market, engine, liq, key, &mut fill_limit);
                }
                PendingRequest::CheckADL => {
                    process_check_adl(market, engine, key);
                }
                PendingRequest::TriggerADL { adl_price } => {
                    process_trigger_adl(market, engine, adl_price, key, &mut fill_limit);
                }
                PendingRequest::RefreshWithdrawMarkPrice { mark_px, funding_index } => {
                    process_refresh_withdraw_mark_price(market, mark_px, funding_index);
                }
            };
        };
    }

    // ============================================================================
    // REQUEST PROCESSING
    // ============================================================================

    /// Process a pending order
    fun process_pending_order(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        order: PendingOrder,
        key: PendingRequestKey,
        fill_limit: &mut u32
    ) {
        let PendingOrder {
            account, price, orig_size, is_buy, time_in_force, is_reduce_only,
            order_id, client_order_id, trigger_condition, tp, sl, builder_code
        } = order;

        let metadata = perp_engine_types::new_order_metadata(
            is_reduce_only,
            option::none<perp_engine_types::TwapMetadata>(),
            tp,
            sl,
            builder_code
        );

        let (final_order_id, filled_size, cancellation_reason, _prices, _matches) =
            order_placement_utils::place_order_and_trigger_matching_actions(
                market, account, price, orig_size, orig_size, is_buy, time_in_force,
                trigger_condition, metadata, order_id, client_order_id, true, fill_limit
            );

        // If cancelled due to fill limit and partially filled, continue
        let is_fill_limit_violation = if (option::is_some<market_types::OrderCancellationReason>(&cancellation_reason)) {
            order_placement::is_fill_limit_violation(
                option::destroy_some<market_types::OrderCancellationReason>(cancellation_reason)
            )
        } else { false };

        if (is_fill_limit_violation && filled_size > 0) {
            let continued = ContinuedPendingOrder {
                account,
                price,
                orig_size,
                is_buy,
                time_in_force,
                is_reduce_only,
                order_id: final_order_id,
                client_order_id,
                remaining_size: filled_size,
                trigger_condition,
                tp,
                sl,
                builder_code,
            };
            big_ordered_map::add<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests,
                key,
                PendingRequest::ContinuedOrder { _0: continued }
            );
        };
    }

    /// Process a continued order (partial fill continuation)
    fun process_continued_order(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        continued: ContinuedPendingOrder,
        key: PendingRequestKey,
        fill_limit: &mut u32
    ) {
        let ContinuedPendingOrder {
            account, price, orig_size, is_buy, time_in_force, is_reduce_only,
            order_id, client_order_id, remaining_size, trigger_condition, tp, sl, builder_code
        } = continued;

        let metadata = perp_engine_types::new_order_metadata(
            is_reduce_only,
            option::none<perp_engine_types::TwapMetadata>(),
            tp,
            sl,
            builder_code
        );

        let (final_order_id, filled_size, cancellation_reason, _prices, _matches) =
            order_placement_utils::place_order_and_trigger_matching_actions(
                market, account, price, orig_size, remaining_size, is_buy, time_in_force,
                trigger_condition, metadata, order_id, client_order_id, false, fill_limit
            );

        let is_fill_limit_violation = if (option::is_some<market_types::OrderCancellationReason>(&cancellation_reason)) {
            order_placement::is_fill_limit_violation(
                option::destroy_some<market_types::OrderCancellationReason>(cancellation_reason)
            )
        } else { false };

        if (is_fill_limit_violation && filled_size > 0) {
            let new_continued = ContinuedPendingOrder {
                account,
                price,
                orig_size,
                is_buy,
                time_in_force,
                is_reduce_only,
                order_id: final_order_id,
                client_order_id,
                remaining_size: filled_size,
                trigger_condition,
                tp,
                sl,
                builder_code,
            };
            big_ordered_map::add<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests,
                key,
                PendingRequest::ContinuedOrder { _0: new_continued }
            );
        };
    }

    /// Process pending liquidation
    fun process_pending_liquidation(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        liq: PendingLiquidation,
        key: PendingRequestKey,
        fill_limit: &mut u32
    ) {
        let PendingLiquidation { user, markets_witnessed, market_during_cutoff: _, largest_slippage_tested: _ } = liq;
        big_ordered_map::destroy_empty<object::Object<perp_market::PerpMarket>, bool>(markets_witnessed);

        // Try to liquidate
        if (!liquidation::liquidate_position_internal(market, user, fill_limit)) {
            return  // Liquidation complete or position no longer liquidatable
        };

        // Position still liquidatable, re-queue
        let new_liq = PendingLiquidation {
            user,
            markets_witnessed: big_ordered_map::new_from<object::Object<perp_market::PerpMarket>, bool>(
                vector::empty(), vector::empty()
            ),
            market_during_cutoff: option::none<object::Object<perp_market::PerpMarket>>(),
            largest_slippage_tested: 0,
        };
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::Liquidation { _0: new_liq }
        );
    }

    /// Process ADL check
    fun process_check_adl(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        key: PendingRequestKey
    ) {
        let mark_price = price_management::get_mark_price(market);
        let adl_threshold = perp_market_config::get_adl_trigger_threshold(market);

        let should_adl = backstop_liquidator_profit_tracker::should_trigger_adl(
            market, mark_price, adl_threshold
        );

        if (option::is_some<u64>(&should_adl)) {
            let adl_price = option::destroy_some<u64>(should_adl);
            big_ordered_map::add<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests,
                key,
                PendingRequest::TriggerADL { adl_price }
            );
        };
    }

    /// Process ADL trigger
    fun process_trigger_adl(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        adl_price: u64,
        key: PendingRequestKey,
        fill_limit: &mut u32
    ) {
        let backstop = accounts_collateral::backstop_liquidator();
        let backstop_size = perp_positions::get_position_size(backstop, market);

        // Try to execute ADL
        if (!liquidation::trigger_adl_internal(market, backstop_size, adl_price, fill_limit)) {
            return  // ADL complete
        };

        // More ADL needed, re-queue
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::TriggerADL { adl_price }
        );
    }

    /// Process refresh withdraw mark price
    fun process_refresh_withdraw_mark_price(
        market: object::Object<perp_market::PerpMarket>,
        mark_px: u64,
        funding_index: price_management::AccumulativeIndex
    ) {
        let (settle_price, old_mark, _old_bid, _old_ask, _old_index) =
            price_management::update_withdraw_mark_px(market, mark_px, funding_index);

        let backstop = accounts_collateral::backstop_liquidator();
        perp_positions::update_account_status_cache_on_price_change(
            backstop, market, settle_price, old_mark, mark_px, funding_index,
            _old_bid, _old_ask, _old_index
        );
    }

    // ============================================================================
    // TWAP PROCESSING
    // ============================================================================

    /// Trigger a pending TWAP order slice
    fun trigger_pending_twap(
        market: object::Object<perp_market::PerpMarket>,
        engine: &mut AsyncMatchingEngine,
        twap: PendingTwap,
        fill_limit: &mut u32,
        key: PendingRequestKey
    ) {
        let PendingTwap {
            account, order_id, is_buy, orig_size, remaining_size, is_reduce_only,
            twap_start_time_s, twap_frequency_s, twap_end_time_s, builder_code, client_order_id
        } = twap;

        let now = decibel_time::now_seconds();

        // Calculate remaining slices
        let remaining_slices = if (now >= twap_end_time_s) {
            1u64
        } else {
            (twap_end_time_s - now) / twap_frequency_s + 1
        };

        // Calculate slice size
        let slice_size = remaining_size / remaining_slices;
        let lot_size = perp_market_config::get_lot_size(market);
        let rounded_slice = slice_size / lot_size * lot_size;

        // Get slippage price
        let slippage_price = perp_market::get_slippage_price(market, is_buy, TWAP_SLIPPAGE_BPS);

        if (option::is_none<u64>(&slippage_price)) {
            // No liquidity - use extreme price and place for next interval
            let extreme_price = if (is_buy) { 9223372036854775807u64 } else { 1u64 };
            let time_in_force = order_book_types::immediate_or_cancel();
            let trigger_condition = option::some<order_book_types::TriggerCondition>(
                order_book_types::new_time_based_trigger_condition(now + twap_frequency_s)
            );
            let metadata = perp_engine_types::new_order_metadata(
                is_reduce_only,
                option::some<perp_engine_types::TwapMetadata>(
                    perp_engine_types::new_twap_metadata(twap_start_time_s, twap_frequency_s, twap_end_time_s)
                ),
                option::none<perp_engine_types::ChildTpSlOrder>(),
                option::none<perp_engine_types::ChildTpSlOrder>(),
                builder_code
            );
            let callbacks = clearinghouse_perp::market_callbacks(market);
            let _result = perp_market::place_order_with_order_id(
                market, account, extreme_price, orig_size, remaining_size, is_buy, time_in_force,
                trigger_condition, metadata, order_id, option::none<string::String>(),
                1000u32, true, true, &callbacks
            );
            return
        };

        // Execute slice with slippage price
        let price = option::destroy_some<u64>(slippage_price);
        let rounded_price = perp_market_config::round_price_to_ticker(market, price, is_buy);
        let sub_order_id = order_book_types::next_order_id();

        let time_in_force = order_book_types::immediate_or_cancel();
        let metadata = perp_engine_types::new_order_metadata(
            is_reduce_only,
            option::some<perp_engine_types::TwapMetadata>(
                perp_engine_types::new_twap_metadata(twap_start_time_s, twap_frequency_s, twap_end_time_s)
            ),
            option::none<perp_engine_types::ChildTpSlOrder>(),
            option::none<perp_engine_types::ChildTpSlOrder>(),
            builder_code
        );

        let (_final_order_id, _filled_size, cancellation_reason, match_prices, _matches) =
            order_placement_utils::place_order_and_trigger_matching_actions(
                market, account, rounded_price, orig_size, rounded_slice, is_buy, time_in_force,
                option::none<order_book_types::TriggerCondition>(), metadata, sub_order_id,
                option::none<string::String>(), true, fill_limit
            );

        // Calculate total filled value
        let mut total_filled = 0u64;
        let mut prices = match_prices;
        vector::reverse<u64>(&mut prices);
        while (vector::length<u64>(&prices) > 0) {
            let fill_price = vector::pop_back<u64>(&mut prices);
            total_filled = total_filled + fill_price;
        };
        vector::destroy_empty<u64>(prices);

        // Emit triggered event
        let duration = twap_end_time_s - twap_start_time_s;
        let new_remaining = remaining_size - total_filled;
        let status = TwapOrderStatus::Triggered { _0: sub_order_id, _1: total_filled };
        event::emit<TwapEvent>(TwapEvent::V1 {
            market,
            account,
            is_buy,
            order_id,
            is_reduce_only,
            start_time_s: twap_start_time_s,
            frequency_s: twap_frequency_s,
            duration_s: duration,
            orig_size,
            remain_size: new_remaining,
            status,
            client_order_id,
        });

        // Check if more slices needed
        let is_fill_limit_violation = if (option::is_some<market_types::OrderCancellationReason>(&cancellation_reason)) {
            order_placement::is_fill_limit_violation(
                option::destroy_some<market_types::OrderCancellationReason>(cancellation_reason)
            )
        } else { false };

        if (is_fill_limit_violation) {
            // Fill limit hit - re-queue current slice
            let continued_twap = PendingTwap {
                account,
                order_id,
                is_buy,
                orig_size,
                remaining_size: rounded_slice - total_filled,
                is_reduce_only,
                twap_start_time_s,
                twap_frequency_s,
                twap_end_time_s,
                builder_code,
                client_order_id,
            };
            big_ordered_map::add<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests,
                key,
                PendingRequest::Twap { _0: continued_twap }
            );
            return
        };

        // Check for other cancellation reasons
        let is_valid_continuation = if (option::is_none<market_types::OrderCancellationReason>(&cancellation_reason)) {
            true
        } else {
            order_placement::is_ioc_violation(
                option::destroy_some<market_types::OrderCancellationReason>(cancellation_reason)
            )
        };

        if (!is_valid_continuation) {
            // Sub-order failed - cancel TWAP
            let status = TwapOrderStatus::Cancelled {
                _0: string::utf8(vector[83u8, 117u8, 98u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8,
                                        102u8, 97u8, 105u8, 108u8, 101u8, 100u8])  // "Sub order failed"
            };
            event::emit<TwapEvent>(TwapEvent::V1 {
                market,
                account,
                is_buy,
                order_id,
                is_reduce_only,
                start_time_s: twap_start_time_s,
                frequency_s: twap_frequency_s,
                duration_s: duration,
                orig_size,
                remain_size: 0,
                status,
                client_order_id,
            });
            return
        };

        // Check if more slices remain
        let updated_remaining_slices = remaining_slices - 1;
        if (updated_remaining_slices == 0) {
            return  // TWAP complete
        };

        // Schedule next slice
        let extreme_price = if (is_buy) { 9223372036854775807u64 } else { 1u64 };
        let trigger_condition = option::some<order_book_types::TriggerCondition>(
            order_book_types::new_time_based_trigger_condition(now + twap_frequency_s)
        );
        let next_metadata = perp_engine_types::new_order_metadata(
            is_reduce_only,
            option::some<perp_engine_types::TwapMetadata>(
                perp_engine_types::new_twap_metadata(twap_start_time_s, twap_frequency_s, twap_end_time_s)
            ),
            option::none<perp_engine_types::ChildTpSlOrder>(),
            option::none<perp_engine_types::ChildTpSlOrder>(),
            builder_code
        );
        let callbacks = clearinghouse_perp::market_callbacks(market);
        let _result = perp_market::place_order_with_order_id(
            market, account, extreme_price, orig_size, new_remaining, is_buy,
            order_book_types::immediate_or_cancel(), trigger_condition, next_metadata, order_id,
            option::none<string::String>(), 1000u32, true, true, &callbacks
        );
    }

    // ============================================================================
    // CONDITIONAL ORDER TRIGGERING
    // ============================================================================

    /// Trigger price-based conditional orders
    friend fun trigger_price_based_conditional_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64
    ) acquires AsyncMatchingEngine {
        // Take ready orders from order book
        let ready_orders = perp_market::take_ready_price_based_orders(market, current_price, 10);

        let mut i = 0u64;
        let len = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&ready_orders);

        while (i < len) {
            let order = *vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&ready_orders, i);
            let (account, order_id, client_id, _trigger, _status, _entry, price, _orig, _remain, is_buy, tif, metadata) =
                single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(order);

            let is_reduce_only = perp_engine_types::is_reduce_only(&metadata);
            let builder_code = perp_engine_types::get_builder_code_from_metadata(&metadata);

            // Re-place order without trigger condition
            let _new_order_id = place_order(
                market, account, price, _remain, is_buy, tif, is_reduce_only,
                option::some<order_book_types::OrderIdType>(order_id), client_id,
                option::none<u64>(),  // No trigger
                option::none<u64>(), option::none<u64>(),  // No TP
                option::none<u64>(), option::none<u64>(),  // No SL
                builder_code
            );

            i = i + 1;
        };
    }

    /// Trigger time-based (TWAP) orders
    friend fun trigger_twap_orders(market: object::Object<perp_market::PerpMarket>) acquires AsyncMatchingEngine {
        // Take ready time-based orders
        let ready_orders = perp_market::take_ready_time_based_orders(market, 10);

        let mut i = 0u64;
        let len = vector::length<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&ready_orders);

        while (i < len) {
            let order = *vector::borrow<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>>(&ready_orders, i);
            let (account, order_id, client_id, _trigger, _status, _entry, _price, orig_size, remain_size, is_buy, _tif, metadata) =
                single_order_types::destroy_single_order<perp_engine_types::OrderMetadata>(order);

            let (start_time, frequency, end_time) = perp_engine_types::get_twap_from_metadata(&metadata);
            let is_reduce_only = perp_engine_types::is_reduce_only(&metadata);
            let builder_code = perp_engine_types::get_builder_code_from_metadata(&metadata);

            // Create TWAP pending request
            let pending_twap = PendingTwap {
                account,
                order_id,
                is_buy,
                orig_size,
                remaining_size: remain_size,
                is_reduce_only,
                twap_start_time_s: start_time,
                twap_frequency_s: frequency,
                twap_end_time_s: end_time,
                builder_code,
                client_order_id: client_id,
            };

            // Add to queue
            let key = new_pending_transaction_key();
            let market_addr = object::object_address<perp_market::PerpMarket>(&market);
            let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);
            big_ordered_map::add<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests,
                key,
                PendingRequest::Twap { _0: pending_twap }
            );

            i = i + 1;
        };
    }

    // ============================================================================
    // QUEUE MANAGEMENT
    // ============================================================================

    /// Drain the async queue (emergency cleanup)
    friend fun drain_async_queue(market: object::Object<perp_market::PerpMarket>) acquires AsyncMatchingEngine {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);

        let mut iterations = 0u64;

        while (!big_ordered_map::is_empty<PendingRequestKey, PendingRequest>(&engine.pending_requests)) {
            if (iterations >= MAX_DRAIN_ITERATIONS) {
                return
            };
            iterations = iterations + 1;

            let (_key, request) = big_ordered_map::pop_front<PendingRequestKey, PendingRequest>(
                &mut engine.pending_requests
            );

            // Emit purge events for orders
            match (request) {
                PendingRequest::Liquidation { _0: liq } => {
                    let PendingLiquidation { user: _, markets_witnessed, market_during_cutoff: _, largest_slippage_tested: _ } = liq;
                    big_ordered_map::destroy_empty<object::Object<perp_market::PerpMarket>, bool>(markets_witnessed);
                }
                PendingRequest::Twap { _0: twap } => {
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1 {
                        market,
                        account: twap.account,
                        order_id: twap.order_id,
                    });
                }
                PendingRequest::Order { _0: order } => {
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1 {
                        market,
                        account: order.account,
                        order_id: order.order_id,
                    });
                }
                PendingRequest::ContinuedOrder { _0: continued } => {
                    event::emit<SystemPurgedOrderEvent>(SystemPurgedOrderEvent::V1 {
                        market,
                        account: continued.account,
                        order_id: continued.order_id,
                    });
                }
                PendingRequest::CheckADL => {}
                PendingRequest::TriggerADL { adl_price: _ } => {}
                PendingRequest::RefreshWithdrawMarkPrice { mark_px: _, funding_index: _ } => {}
            };
        };
    }

    /// Schedule refresh of withdraw mark price
    friend fun schedule_refresh_withdraw_mark_price(
        market: object::Object<perp_market::PerpMarket>,
        mark_px: u64,
        funding_index: price_management::AccumulativeIndex
    ) acquires AsyncMatchingEngine {
        let key = new_pending_refresh_withdraw_mark_price_key();
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::RefreshWithdrawMarkPrice { mark_px, funding_index }
        );
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// Add taker order to pending queue
    fun add_taker_order_to_pending(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        price: u64,
        size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        is_reduce_only: bool,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        trigger_condition: option::Option<order_book_types::TriggerCondition>,
        tp: option::Option<perp_engine_types::ChildTpSlOrder>,
        sl: option::Option<perp_engine_types::ChildTpSlOrder>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ) acquires AsyncMatchingEngine {
        let key = new_pending_transaction_key();
        let pending_order = PendingOrder {
            account,
            price,
            orig_size: size,
            is_buy,
            time_in_force,
            is_reduce_only,
            order_id,
            client_order_id,
            trigger_condition,
            tp,
            sl,
            builder_code,
        };

        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let engine = borrow_global_mut<AsyncMatchingEngine>(market_addr);
        big_ordered_map::add<PendingRequestKey, PendingRequest>(
            &mut engine.pending_requests,
            key,
            PendingRequest::Order { _0: pending_order }
        );
    }

    /// Create key for regular transaction
    fun new_pending_transaction_key(): PendingRequestKey {
        let time = decibel_time::now_microseconds();
        let tie_breaker = transaction_context::monotonically_increasing_counter();
        PendingRequestKey::RegularTransaction { time, tie_breaker }
    }

    /// Create key for liquidation (priority 1)
    fun new_pending_liquidation_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation {
            tie_breaker: transaction_context::monotonically_increasing_counter(),
            time: 1,
        }
    }

    /// Create key for check ADL (priority 2)
    fun new_pending_check_adl_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation {
            tie_breaker: transaction_context::monotonically_increasing_counter(),
            time: 2,
        }
    }

    /// Create key for refresh withdraw mark price (priority 3)
    fun new_pending_refresh_withdraw_mark_price_key(): PendingRequestKey {
        PendingRequestKey::Liquidatation {
            tie_breaker: transaction_context::monotonically_increasing_counter(),
            time: 3,
        }
    }
}
