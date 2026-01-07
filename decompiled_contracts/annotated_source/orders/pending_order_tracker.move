/// ============================================================================
/// PENDING ORDER TRACKER - Order Margin and TP/SL State Management
/// ============================================================================
///
/// This is the core module for tracking pending orders and their margin
/// requirements. It maintains per-account, per-market state for:
/// - Pending buy/sell orders and their margin requirements
/// - Reduce-only orders
/// - Take-profit and stop-loss orders
///
/// ARCHITECTURE:
/// - GlobalSummary: Resource stored at contract address containing all account data
/// - AccountSummary: Per-account data with a BigOrderedMap of markets
/// - PendingMarketState: Per-market pending order state
///
/// MARGIN CALCULATION:
/// - Orders reserve margin based on their notional value (size * price)
/// - Margin is calculated as: notional / (size_multiplier * leverage)
/// - If position exists in opposite direction, margin offset is applied
///
/// REDUCE-ONLY ORDERS:
/// - Must be in opposite direction to position
/// - Limited to 10 per market
/// - Automatically trimmed if total size exceeds position size
///
/// TP/SL LIMITS:
/// - 1 full-sized TP and 1 full-sized SL per position
/// - Up to 5 fixed-sized TP/SL orders (combined with pending child orders)
///
/// ============================================================================

module decibel::pending_order_tracker {
    use std::vector;
    use std::option;
    use std::table;
    use std::signer;
    use std::error;
    use std::string;
    use std::object;
    use aptos_std::big_ordered_map;
    use aptos_std::ordered_map;
    use aptos_std::math128;

    use decibel::perp_market;
    use decibel::perp_market_config;
    use decibel::perp_engine_types;
    use decibel::position_tp_sl_tracker;
    use decibel::builder_code_registry;
    use decibel::price_management;
    use econia::order_book_types;

    // ============================================================================
    // Constants
    // ============================================================================

    /// Maximum number of reduce-only orders per market per account
    const MAX_REDUCE_ONLY_ORDERS: u64 = 10;

    /// Maximum number of fixed-sized TP/SL orders per market per account
    const MAX_FIXED_TP_SL_ORDERS: u64 = 5;

    // ============================================================================
    // Error Codes
    // ============================================================================

    const E_NOT_AUTHORIZED: u64 = 1;
    const E_MARKET_NOT_FOUND: u64 = 2;
    const E_INVALID_SIZE: u64 = 3;
    const E_DIVISION_BY_ZERO: u64 = 4;
    const E_REDUCE_ONLY_WRONG_DIRECTION: u64 = 5;
    const E_INVALID_TP_SL: u64 = 7;
    const E_MAX_TP_SL_EXCEEDED: u64 = 8;
    const E_TP_SL_SIZE_EXCEEDS_POSITION: u64 = 10;
    const E_ORDER_BASED_TP_SL_NOT_FOUND: u64 = 11;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::perp_positions;
    friend decibel::order_margin;
    friend decibel::accounts_collateral;
    friend decibel::position_tp_sl;
    friend decibel::clearinghouse_perp;
    friend decibel::perp_engine;

    // ============================================================================
    // STRUCT DEFINITIONS
    // ============================================================================

    /// Per-account summary containing state for all markets
    struct AccountSummary has store {
        /// Map of market -> pending state for that market
        markets: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, PendingMarketState>,
    }

    /// Per-market pending order state for an account
    enum PendingMarketState has copy, drop, store {
        V1 {
            /// Total margin required for pending orders (in quote units)
            pending_margin: u64,
            /// Pending buy orders aggregated
            pending_longs: PendingOrders,
            /// Pending sell orders aggregated
            pending_shorts: PendingOrders,
            /// Reduce-only orders (can only reduce position)
            reduce_only_orders: ReduceOnlyOrders,
            /// Take-profit orders
            tp_reqs: PendingTpSLs,
            /// Stop-loss orders
            sl_reqs: PendingTpSLs,
        }
    }

    /// Aggregated pending orders in one direction (buy or sell)
    struct PendingOrders has copy, drop, store {
        /// Sum of (price * size) for all pending orders
        price_size_sum: u128,
        /// Sum of sizes for all pending orders
        size_sum: u64,
    }

    /// Reduce-only order tracking
    struct ReduceOnlyOrders has copy, drop, store {
        /// Total size across all reduce-only orders
        total_size: u64,
        /// Individual order tracking
        orders: vector<ReduceOnlyOrderInfo>,
    }

    /// Individual reduce-only order info
    struct ReduceOnlyOrderInfo has copy, drop, store {
        order_id: order_book_types::OrderIdType,
        size: u64,
    }

    /// TP/SL order tracking container
    struct PendingTpSLs has copy, drop, store {
        /// Full-size TP/SL (closes entire position)
        full_sized: option::Option<PendingTpSlKey>,
        /// Fixed-size TP/SL orders
        fixed_sized: vector<PendingTpSlKey>,
        /// Count of child TP/SL attached to pending orders (not yet active)
        pending_order_based_tp_sl_count: u64,
    }

    /// Key for referencing a pending TP/SL order
    struct PendingTpSlKey has copy, drop, store {
        /// Key for lookup in position_tp_sl_tracker
        price_index: position_tp_sl_tracker::PriceIndexKey,
        /// Unique order identifier
        order_id: order_book_types::OrderIdType,
    }

    /// Public info about a pending TP/SL order
    struct PendingTpSlInfo has copy, drop {
        order_id: order_book_types::OrderIdType,
        trigger_price: u64,
        account: address,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,  // None = full position size
    }

    /// Event data for fixed-size TP/SL
    struct FixedSizedTpSlForEvent has copy, drop, store {
        order_id: u128,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: u64,
    }

    /// Event data for full-size TP/SL
    struct FullSizedTpSlForEvent has copy, drop, store {
        order_id: u128,
        trigger_price: u64,
        limit_price: option::Option<u64>,
    }

    /// Global summary resource containing all account data
    enum GlobalSummary has key {
        V1 {
            summary: table::Table<address, AccountSummary>,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the global summary resource
    /// Can only be called by the contract deployer
    friend fun initialize(deployer: &signer) {
        if (!(signer::address_of(deployer) == @decibel)) {
            abort error::invalid_argument(E_NOT_AUTHORIZED)
        };

        if (!exists<GlobalSummary>(@decibel)) {
            let summary = GlobalSummary::V1 {
                summary: table::new<address, AccountSummary>(),
            };
            move_to<GlobalSummary>(deployer, summary);
        };
    }

    /// Initialize account summary if not exists
    friend fun initialize_account_summary(account: address) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);

        if (!table::contains<address, AccountSummary>(&global.summary, account)) {
            let account_summary = AccountSummary {
                markets: big_ordered_map::new_with_config<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                    64u16, 32u16, true
                ),
            };
            table::add<address, AccountSummary>(&mut global.summary, account, account_summary);
        };
    }

    // ============================================================================
    // ORDER MANAGEMENT
    // ============================================================================

    /// Add a non-reduce-only order (regular buy/sell)
    /// Updates pending margin requirement
    friend fun add_non_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        position_size: u64,
        position_is_long: bool,
        leverage: u8
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let mut account_summary = table::remove<address, AccountSummary>(&mut global.summary, account);

        // Initialize market state if needed
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            let empty_state = create_empty_pending_market_state();
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, empty_state
            );
        };

        // Get and update market state
        let mut market_state = big_ordered_map::remove<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, &market
        );

        // Update pending orders for appropriate direction
        let notional = (size as u128) * (price as u128);
        if (is_long) {
            let pending = &mut market_state.pending_longs;
            pending.price_size_sum = pending.price_size_sum + notional;
            pending.size_sum = pending.size_sum + size;
        } else {
            let pending = &mut market_state.pending_shorts;
            pending.price_size_sum = pending.price_size_sum + notional;
            pending.size_sum = pending.size_sum + size;
        };

        // Recalculate required margin
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        update_required_margin_for_market(
            &mut market_state,
            position_size,
            position_is_long,
            leverage,
            size_multiplier
        );

        // Store updated state
        big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, market, market_state
        );
        table::add<address, AccountSummary>(&mut global.summary, account, account_summary);
    }

    /// Add a reduce-only order
    /// Returns vector of order actions if existing orders need to be reduced
    friend fun add_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        size: u64,
        is_long: bool,
        position_size: u64,
        position_is_long: bool
    ): vector<perp_engine_types::SingleOrderAction> acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        // Initialize market state if needed
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            let empty_state = create_empty_pending_market_state();
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, empty_state
            );
        };

        // Use iter_modify to update state in place
        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        let result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, vector<perp_engine_types::SingleOrderAction>>(
            iter,
            &mut account_summary.markets,
            |state| add_reduce_only_order_internal(account, order_id, size, is_long, position_size, position_is_long, state)
        );

        result
    }

    /// Internal helper for adding reduce-only order
    fun add_reduce_only_order_internal(
        account: address,
        order_id: order_book_types::OrderIdType,
        size: u64,
        is_long: bool,
        position_size: u64,
        position_is_long: bool,
        state: &mut PendingMarketState
    ): vector<perp_engine_types::SingleOrderAction> {
        let reduce_only = &mut state.reduce_only_orders;

        // Validate: reduce-only order must be opposite to position
        if (!(is_long != position_is_long)) {
            abort error::invalid_argument(E_REDUCE_ONLY_WRONG_DIRECTION)
        };

        // Add new order
        let order_info = ReduceOnlyOrderInfo { order_id, size };
        vector::push_back<ReduceOnlyOrderInfo>(&mut reduce_only.orders, order_info);
        reduce_only.total_size = reduce_only.total_size + size;

        // Generate actions to trim orders if total exceeds position size
        let actions = vector::empty<perp_engine_types::SingleOrderAction>();
        let total_size = reduce_only.total_size;

        if (total_size > position_size) {
            let excess = total_size - position_size;
            let mut i = 0u64;

            while (excess > 0 && i < vector::length<ReduceOnlyOrderInfo>(&reduce_only.orders)) {
                let order = vector::borrow<ReduceOnlyOrderInfo>(&reduce_only.orders, i);
                let order_size = order.size;

                if (excess >= order_size) {
                    // Cancel entire order
                    let cancel_action = perp_engine_types::new_cancel_order_action(
                        account,
                        order.order_id
                    );
                    vector::push_back<perp_engine_types::SingleOrderAction>(&mut actions, cancel_action);
                    excess = excess - order_size;
                    i = i + 1;
                } else {
                    // Reduce order size
                    let reduce_action = perp_engine_types::new_reduce_order_size_action(
                        account,
                        order.order_id,
                        excess
                    );
                    vector::push_back<perp_engine_types::SingleOrderAction>(&mut actions, reduce_action);
                    break
                }
            };
        };

        actions
    }

    /// Remove a pending order (when filled or cancelled)
    friend fun remove_pending_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        size: u64,
        price: u64,
        is_long: bool,
        is_reduce_only: bool,
        position_size: u64,
        position_is_long: bool,
        leverage: u8
    ) acquires GlobalSummary {
        // Handle reduce-only orders separately
        if (is_reduce_only) {
            remove_reduce_only_order(account, market, order_id);
            return
        };

        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            abort error::invalid_argument(E_MARKET_NOT_FOUND)
        };

        let mut market_state = big_ordered_map::remove<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, &market
        );

        // Update pending orders for appropriate direction
        let notional = (size as u128) * (price as u128);
        if (is_long) {
            if (!(market_state.pending_longs.size_sum >= size)) {
                abort error::invalid_argument(E_INVALID_SIZE)
            };
            market_state.pending_longs.size_sum = market_state.pending_longs.size_sum - size;

            if (market_state.pending_longs.size_sum == 0) {
                // Verify consistency
                if (!(notional == market_state.pending_longs.price_size_sum)) {
                    abort error::invalid_argument(E_INVALID_SIZE)
                };
                market_state.pending_longs.price_size_sum = 0u128;
            } else {
                market_state.pending_longs.price_size_sum = market_state.pending_longs.price_size_sum - notional;
            }
        } else {
            if (!(market_state.pending_shorts.size_sum >= size)) {
                abort error::invalid_argument(E_INVALID_SIZE)
            };
            market_state.pending_shorts.size_sum = market_state.pending_shorts.size_sum - size;

            if (market_state.pending_shorts.size_sum == 0) {
                if (!(notional == market_state.pending_shorts.price_size_sum)) {
                    abort error::invalid_argument(E_INVALID_SIZE)
                };
                market_state.pending_shorts.price_size_sum = 0u128;
            } else {
                market_state.pending_shorts.price_size_sum = market_state.pending_shorts.price_size_sum - notional;
            }
        };

        // Recalculate margin
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        update_required_margin_for_market(&mut market_state, position_size, position_is_long, leverage, size_multiplier);

        big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, market, market_state
        );
    }

    /// Remove a reduce-only order
    fun remove_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            let _result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, bool>(
                iter,
                &mut account_summary.markets,
                |state| remove_reduce_only_order_internal(order_id, state)
            );
        };
    }

    /// Internal helper to remove reduce-only order
    fun remove_reduce_only_order_internal(
        order_id: order_book_types::OrderIdType,
        state: &mut PendingMarketState
    ): bool {
        let reduce_only = &mut state.reduce_only_orders;
        let mut i = 0u64;

        while (i < vector::length<ReduceOnlyOrderInfo>(&reduce_only.orders)) {
            let order = vector::borrow<ReduceOnlyOrderInfo>(&reduce_only.orders, i);
            if (&order.order_id == &order_id) {
                let removed_size = order.size;
                reduce_only.total_size = reduce_only.total_size - removed_size;
                let _removed = vector::remove<ReduceOnlyOrderInfo>(&mut reduce_only.orders, i);
                break
            };
            i = i + 1;
        };

        true
    }

    /// Decrease reduce-only order size (partial fill)
    friend fun decrease_reduce_only_order_size(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        new_size: u64
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            abort error::invalid_argument(E_MARKET_NOT_FOUND)
        };

        let _result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, bool>(
            iter,
            &mut account_summary.markets,
            |state| decrease_reduce_only_order_size_internal(order_id, new_size, state)
        );
    }

    /// Internal helper for decreasing reduce-only order size
    fun decrease_reduce_only_order_size_internal(
        order_id: order_book_types::OrderIdType,
        new_size: u64,
        state: &mut PendingMarketState
    ): bool {
        let reduce_only = &mut state.reduce_only_orders;
        let mut i = 0u64;

        while (i < vector::length<ReduceOnlyOrderInfo>(&reduce_only.orders)) {
            let order = vector::borrow<ReduceOnlyOrderInfo>(&reduce_only.orders, i);
            if (&order.order_id == &order_id) {
                let old_size = order.size;
                if (!(old_size >= new_size)) {
                    abort error::invalid_argument(E_INVALID_SIZE)
                };

                let size_decrease = old_size - new_size;
                reduce_only.total_size = reduce_only.total_size - size_decrease;

                let order_mut = vector::borrow_mut<ReduceOnlyOrderInfo>(&mut reduce_only.orders, i);
                order_mut.size = new_size;

                // Remove if size is zero
                if (new_size == 0) {
                    let _removed = vector::remove<ReduceOnlyOrderInfo>(&mut reduce_only.orders, i);
                };
                break
            };
            i = i + 1;
        };

        true
    }

    /// Clear all reduce-only orders for a market
    /// Returns order IDs of cleared orders
    friend fun clear_reduce_only_orders(
        account: address,
        market: object::Object<perp_market::PerpMarket>
    ): vector<order_book_types::OrderIdType> acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            return vector::empty<order_book_types::OrderIdType>()
        };

        big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, vector<order_book_types::OrderIdType>>(
            iter,
            &mut account_summary.markets,
            |state| {
                let reduce_only = &mut state.reduce_only_orders;
                let order_ids = vector::empty<order_book_types::OrderIdType>();

                let mut i = 0u64;
                while (i < vector::length<ReduceOnlyOrderInfo>(&reduce_only.orders)) {
                    let order = vector::borrow<ReduceOnlyOrderInfo>(&reduce_only.orders, i);
                    vector::push_back<order_book_types::OrderIdType>(&mut order_ids, order.order_id);
                    i = i + 1;
                };

                reduce_only.total_size = 0;
                reduce_only.orders = vector::empty<ReduceOnlyOrderInfo>();

                order_ids
            }
        )
    }

    // ============================================================================
    // TP/SL MANAGEMENT
    // ============================================================================

    /// Add a TP/SL order
    friend fun add_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
        is_tp: bool,
        position_size: u64,
        is_long: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        validate_limit: bool
    ) acquires GlobalSummary {
        // Validate TP/SL direction
        if (!validate_tp_sl(market, is_long, trigger_price, is_tp)) {
            abort error::invalid_argument(E_INVALID_TP_SL)
        };

        let is_full_sized = option::is_none<u64>(&size);
        let price_index = position_tp_sl_tracker::new_price_index_key(
            trigger_price, account, limit_price, is_full_sized, builder_code
        );
        let tp_sl_key = PendingTpSlKey { price_index, order_id };

        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        // Initialize market state if needed
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            let empty_state = create_empty_pending_market_state();
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, empty_state
            );
        };

        let mut market_state = big_ordered_map::remove<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, &market
        );

        if (is_full_sized) {
            // Full-sized TP/SL (only one per type)
            if (is_tp) {
                market_state.tp_reqs.full_sized = option::some<PendingTpSlKey>(tp_sl_key);
            } else {
                market_state.sl_reqs.full_sized = option::some<PendingTpSlKey>(tp_sl_key);
            }
        } else {
            // Fixed-sized TP/SL
            let fixed_size = option::destroy_some<u64>(size);

            // Validate size doesn't exceed position
            if (!(position_size >= fixed_size)) {
                abort error::invalid_argument(E_TP_SL_SIZE_EXCEEDS_POSITION)
            };

            // Validate count limit
            if (validate_limit) {
                let tp_sl_reqs = if (is_tp) { &market_state.tp_reqs } else { &market_state.sl_reqs };
                let current_count = vector::length<PendingTpSlKey>(&tp_sl_reqs.fixed_sized);
                let pending_count = tp_sl_reqs.pending_order_based_tp_sl_count;
                if (!(current_count + pending_count < MAX_FIXED_TP_SL_ORDERS)) {
                    abort error::invalid_argument(E_MAX_TP_SL_EXCEEDED)
                }
            };

            if (is_tp) {
                vector::push_back<PendingTpSlKey>(&mut market_state.tp_reqs.fixed_sized, tp_sl_key);
            } else {
                vector::push_back<PendingTpSlKey>(&mut market_state.sl_reqs.fixed_sized, tp_sl_key);
            }
        };

        // Add to price tracker
        position_tp_sl_tracker::add_new_tp_sl(
            market, account, order_id, price_index, limit_price, size, is_tp, is_long
        );

        big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, market, market_state
        );
    }

    /// Validate TP/SL trigger price direction
    /// Long + TP = price must be above mark (profit when price rises)
    /// Long + SL = price must be below mark (stop loss when price falls)
    /// Short + TP = price must be below mark (profit when price falls)
    /// Short + SL = price must be above mark (stop loss when price rises)
    friend fun validate_tp_sl(
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        trigger_price: u64,
        is_tp: bool
    ): bool {
        let mark_price = price_management::get_mark_price(market);

        // Determine if trigger should be above or below mark price
        // Long TP or Short SL = trigger above mark
        // Long SL or Short TP = trigger below mark
        let should_trigger_above = (is_long && is_tp) || (!is_long && !is_tp);

        if (should_trigger_above) {
            trigger_price > mark_price
        } else {
            trigger_price < mark_price
        }
    }

    /// Cancel TP/SL by order ID (searches all types)
    friend fun cancel_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        is_long: bool
    ): option::Option<PendingTpSlKey> acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return option::none<PendingTpSlKey>()
        };

        let mut market_state = big_ordered_map::remove<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, &market
        );

        // Try to find and remove from each category
        let mut result = remove_full_sized_tp_sl_for_order_internal(&mut market_state, true, order_id);
        if (option::is_some<PendingTpSlKey>(&result)) {
            let key = option::destroy_some<PendingTpSlKey>(result);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, true, is_long);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, market_state
            );
            return option::some(key)
        };

        result = remove_full_sized_tp_sl_for_order_internal(&mut market_state, false, order_id);
        if (option::is_some<PendingTpSlKey>(&result)) {
            let key = option::destroy_some<PendingTpSlKey>(result);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, false, is_long);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, market_state
            );
            return option::some(key)
        };

        result = remove_fixed_sized_tp_sl_for_order_internal(&mut market_state, true, order_id);
        if (option::is_some<PendingTpSlKey>(&result)) {
            let key = option::destroy_some<PendingTpSlKey>(result);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, true, is_long);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, market_state
            );
            return option::some(key)
        };

        result = remove_fixed_sized_tp_sl_for_order_internal(&mut market_state, false, order_id);
        if (option::is_some<PendingTpSlKey>(&result)) {
            let key = option::destroy_some<PendingTpSlKey>(result);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, false, is_long);
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, market_state
            );
            return option::some(key)
        };

        big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, market, market_state
        );
        option::none<PendingTpSlKey>()
    }

    /// Cancel all TP/SL orders for a position
    friend fun cancel_all_tp_sl_for_position(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        is_long: bool
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (!big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            let _result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, bool>(
                iter,
                &mut account_summary.markets,
                |state| cancel_all_tp_sl_internal(market, is_long, state)
            );
        };
    }

    /// Internal helper to cancel all TP/SL
    fun cancel_all_tp_sl_internal(
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        state: &mut PendingMarketState
    ): bool {
        // Cancel full-sized TP/SL
        cancel_full_sized_tp_sl(market, state, true, is_long);
        cancel_full_sized_tp_sl(market, state, false, is_long);

        // Cancel all fixed-sized TP orders
        let mut tp_keys = state.tp_reqs.fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut tp_keys);
        while (vector::length<PendingTpSlKey>(&tp_keys) > 0) {
            let key = vector::pop_back<PendingTpSlKey>(&mut tp_keys);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, true, is_long);
        };
        vector::destroy_empty<PendingTpSlKey>(tp_keys);

        // Cancel all fixed-sized SL orders
        let mut sl_keys = state.sl_reqs.fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut sl_keys);
        while (vector::length<PendingTpSlKey>(&sl_keys) > 0) {
            let key = vector::pop_back<PendingTpSlKey>(&mut sl_keys);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, false, is_long);
        };
        vector::destroy_empty<PendingTpSlKey>(sl_keys);

        // Clear the vectors
        state.tp_reqs.fixed_sized = vector::empty<PendingTpSlKey>();
        state.sl_reqs.fixed_sized = vector::empty<PendingTpSlKey>();

        true
    }

    /// Cancel full-sized TP/SL
    fun cancel_full_sized_tp_sl(
        market: object::Object<perp_market::PerpMarket>,
        state: &mut PendingMarketState,
        is_tp: bool,
        is_long: bool
    ) {
        let removed = remove_full_sized_tp_sl(state, is_tp);
        if (option::is_some<PendingTpSlKey>(&removed)) {
            let key = option::destroy_some<PendingTpSlKey>(removed);
            position_tp_sl_tracker::cancel_pending_tp_sl(market, key.price_index, is_tp, is_long);
        };
    }

    /// Remove and return full-sized TP/SL
    fun remove_full_sized_tp_sl(state: &mut PendingMarketState, is_tp: bool): option::Option<PendingTpSlKey> {
        if (is_tp) {
            let result = state.tp_reqs.full_sized;
            state.tp_reqs.full_sized = option::none<PendingTpSlKey>();
            result
        } else {
            let result = state.sl_reqs.full_sized;
            state.sl_reqs.full_sized = option::none<PendingTpSlKey>();
            result
        }
    }

    /// Remove full-sized TP/SL by order ID
    fun remove_full_sized_tp_sl_for_order_internal(
        state: &mut PendingMarketState,
        is_tp: bool,
        order_id: order_book_types::OrderIdType
    ): option::Option<PendingTpSlKey> {
        let full_sized = if (is_tp) { &state.tp_reqs.full_sized } else { &state.sl_reqs.full_sized };

        if (option::is_some<PendingTpSlKey>(full_sized)) {
            let key = option::destroy_some<PendingTpSlKey>(*full_sized);
            if (key.order_id == order_id) {
                return remove_full_sized_tp_sl(state, is_tp)
            }
        };

        option::none<PendingTpSlKey>()
    }

    /// Remove fixed-sized TP/SL by order ID
    fun remove_fixed_sized_tp_sl_for_order_internal(
        state: &mut PendingMarketState,
        is_tp: bool,
        order_id: order_book_types::OrderIdType
    ): option::Option<PendingTpSlKey> {
        let tp_sl = if (is_tp) { &mut state.tp_reqs } else { &mut state.sl_reqs };
        let fixed_sized = &tp_sl.fixed_sized;

        let mut found = false;
        let mut found_idx = 0u64;
        let mut i = 0u64;
        let len = vector::length<PendingTpSlKey>(fixed_sized);

        while (i < len) {
            let key = vector::borrow<PendingTpSlKey>(fixed_sized, i);
            if (&key.order_id == &order_id) {
                found = true;
                found_idx = i;
                break
            };
            i = i + 1;
        };

        if (found) {
            return option::some<PendingTpSlKey>(
                vector::swap_remove<PendingTpSlKey>(&mut tp_sl.fixed_sized, found_idx)
            )
        };

        option::none<PendingTpSlKey>()
    }

    /// Increase TP/SL order size
    friend fun increase_tp_sl_size(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        size_increase: u64,
        is_tp: bool,
        is_long: bool
    ) {
        if (!validate_tp_sl(market, is_long, trigger_price, is_tp)) {
            abort error::invalid_argument(E_INVALID_TP_SL)
        };

        let price_index = position_tp_sl_tracker::new_price_index_key(
            trigger_price, account, limit_price, false, builder_code
        );
        position_tp_sl_tracker::increase_pending_tp_sl_size(market, price_index, size_increase, is_tp, is_long);
    }

    /// Remove full-sized TP/SL for specific order
    friend fun remove_full_sized_tp_sl_for_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        is_tp: bool
    ): option::Option<PendingTpSlKey> acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            return option::none<PendingTpSlKey>()
        };

        big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, option::Option<PendingTpSlKey>>(
            iter,
            &mut account_summary.markets,
            |state| remove_full_sized_tp_sl_for_order_internal(state, is_tp, order_id)
        )
    }

    /// Remove fixed-sized TP/SL for specific order
    friend fun remove_fixed_sized_tp_sl_for_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        order_id: order_book_types::OrderIdType,
        is_tp: bool
    ): option::Option<PendingTpSlKey> acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            return option::none<PendingTpSlKey>()
        };

        big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, option::Option<PendingTpSlKey>>(
            iter,
            &mut account_summary.markets,
            |state| remove_fixed_sized_tp_sl_for_order_internal(state, is_tp, order_id)
        )
    }

    // ============================================================================
    // ORDER-BASED TP/SL (Child orders attached to parent limit orders)
    // ============================================================================

    /// Add child TP/SL order count (attached to pending limit order)
    friend fun add_order_based_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        has_tp: bool,
        has_sl: bool
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            // Create new market state
            let mut empty_state = create_empty_pending_market_state();
            if (has_tp) {
                empty_state.tp_reqs.pending_order_based_tp_sl_count =
                    empty_state.tp_reqs.pending_order_based_tp_sl_count + 1;
            };
            if (has_sl) {
                empty_state.sl_reqs.pending_order_based_tp_sl_count =
                    empty_state.sl_reqs.pending_order_based_tp_sl_count + 1;
            };
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, empty_state
            );
        } else {
            let _result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, bool>(
                iter,
                &mut account_summary.markets,
                |state| {
                    if (has_tp) {
                        state.tp_reqs.pending_order_based_tp_sl_count =
                            state.tp_reqs.pending_order_based_tp_sl_count + 1;
                    };
                    if (has_sl) {
                        state.sl_reqs.pending_order_based_tp_sl_count =
                            state.sl_reqs.pending_order_based_tp_sl_count + 1;
                    };
                    true
                }
            );
        };
    }

    /// Remove order-based TP/SL count
    friend fun remove_order_based_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        has_tp: bool,
        has_sl: bool
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let account_summary = table::borrow_mut<address, AccountSummary>(&mut global.summary, account);

        let iter = big_ordered_map::internal_find<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        if (big_ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &iter, &account_summary.markets
        )) {
            abort error::invalid_argument(E_MARKET_NOT_FOUND)
        };

        let _result = big_ordered_map::iter_modify<object::Object<perp_market::PerpMarket>, PendingMarketState, bool>(
            iter,
            &mut account_summary.markets,
            |state| {
                if (has_tp) {
                    if (!(state.tp_reqs.pending_order_based_tp_sl_count > 0)) {
                        abort error::invalid_argument(E_ORDER_BASED_TP_SL_NOT_FOUND)
                    };
                    state.tp_reqs.pending_order_based_tp_sl_count =
                        state.tp_reqs.pending_order_based_tp_sl_count - 1;
                };
                if (has_sl) {
                    if (!(state.sl_reqs.pending_order_based_tp_sl_count > 0)) {
                        abort error::invalid_argument(E_ORDER_BASED_TP_SL_NOT_FOUND)
                    };
                    state.sl_reqs.pending_order_based_tp_sl_count =
                        state.sl_reqs.pending_order_based_tp_sl_count - 1;
                };
                true
            }
        );
    }

    /// Validate order-based TP/SL can be added (check limits)
    friend fun validate_order_based_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        has_tp: bool,
        has_sl: bool
    ): bool acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return true  // No state yet, can add
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        // Check TP limit
        if (has_tp) {
            let tp_count = state.tp_reqs.pending_order_based_tp_sl_count +
                          vector::length<PendingTpSlKey>(&state.tp_reqs.fixed_sized);
            if (tp_count >= MAX_FIXED_TP_SL_ORDERS) {
                return false
            }
        };

        // Check SL limit
        if (has_sl) {
            let sl_count = state.sl_reqs.pending_order_based_tp_sl_count +
                          vector::length<PendingTpSlKey>(&state.sl_reqs.fixed_sized);
            if (sl_count >= MAX_FIXED_TP_SL_ORDERS) {
                return false
            }
        };

        true
    }

    // ============================================================================
    // GETTERS
    // ============================================================================

    /// Get total pending order margin for account (across all markets)
    friend fun get_pending_order_margin(account: address): u64 acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        let mut total_margin = 0u64;

        // Iterate through all markets
        let leaf_iter = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets
        );

        while (!big_ordered_map::internal_leaf_iter_is_end(&leaf_iter)) {
            let (entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                leaf_iter, &account_summary.markets
            );

            let entry_iter = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entries);

            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(&entry_iter, entries)) {
                let child = ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
                let state = big_ordered_map::internal_leaf_borrow_value<PendingMarketState>(child);
                total_margin = total_margin + state.pending_margin;
                entry_iter = ordered_map::iter_next<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
            };

            leaf_iter = next_iter;
        };

        total_margin
    }

    /// Check if account has any pending orders
    friend fun has_any_pending_orders(account: address): bool acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        let mut has_orders = false;

        let leaf_iter = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets
        );

        while (!big_ordered_map::internal_leaf_iter_is_end(&leaf_iter)) {
            let (entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                leaf_iter, &account_summary.markets
            );

            let entry_iter = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entries);

            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(&entry_iter, entries)) {
                let child = ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
                let state = big_ordered_map::internal_leaf_borrow_value<PendingMarketState>(child);

                if (state.pending_longs.size_sum > 0 || state.pending_shorts.size_sum > 0) {
                    has_orders = true;
                };

                entry_iter = ordered_map::iter_next<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
            };

            leaf_iter = next_iter;
        };

        has_orders
    }

    /// Get fixed-sized TP/SL order ID by key
    friend fun get_fixed_sized_tp_sl(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_long: bool
    ): option::Option<order_book_types::OrderIdType> {
        let price_index = position_tp_sl_tracker::new_price_index_key(
            trigger_price, account, limit_price, false, builder_code
        );
        position_tp_sl_tracker::get_pending_order_id(market, price_index, is_tp, is_long)
    }

    /// Get full-sized TP/SL order info
    friend fun get_full_sized_tp_sl_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        is_long: bool
    ): option::Option<PendingTpSlInfo> acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return option::none<PendingTpSlInfo>()
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        let tp_sl = if (is_tp) { &state.tp_reqs } else { &state.sl_reqs };

        if (!option::is_some<PendingTpSlKey>(&tp_sl.full_sized)) {
            return option::none<PendingTpSlInfo>()
        };

        let key = option::destroy_some<PendingTpSlKey>(*&tp_sl.full_sized);
        let (acct, order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
            market, key.price_index, is_tp, is_long
        );
        let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);

        option::some<PendingTpSlInfo>(PendingTpSlInfo {
            order_id: key.order_id,
            trigger_price: trigger,
            account: acct,
            limit_price: lim_price,
            size,
        })
    }

    /// Get all fixed-sized TP/SL orders
    friend fun get_fixed_sized_tp_sl_orders(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        is_long: bool
    ): vector<PendingTpSlInfo> acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return vector::empty<PendingTpSlInfo>()
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        let tp_sl = if (is_tp) { &state.tp_reqs } else { &state.sl_reqs };
        let mut result = vector::empty<PendingTpSlInfo>();

        let mut keys = tp_sl.fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut keys);

        while (vector::length<PendingTpSlKey>(&keys) > 0) {
            let key = vector::pop_back<PendingTpSlKey>(&mut keys);
            let (acct, _order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
                market, key.price_index, is_tp, is_long
            );
            let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);

            let info = PendingTpSlInfo {
                order_id: key.order_id,
                trigger_price: trigger,
                account: acct,
                limit_price: lim_price,
                size,
            };
            vector::push_back<PendingTpSlInfo>(&mut result, info);
        };

        vector::destroy_empty<PendingTpSlKey>(keys);
        result
    }

    /// Get fixed-sized TP/SL info for key
    friend fun get_fixed_sized_tp_sl_for_key(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
        is_long: bool
    ): option::Option<PendingTpSlInfo> acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return option::none<PendingTpSlInfo>()
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        let tp_sl = if (is_tp) { state.tp_reqs } else { state.sl_reqs };
        let target_index = position_tp_sl_tracker::new_price_index_key(
            trigger_price, account, limit_price, false, builder_code
        );

        // Search for matching key
        let mut found_idx: option::Option<u64> = option::none();
        let mut i = 0u64;
        let len = vector::length<PendingTpSlKey>(&tp_sl.fixed_sized);

        while (i < len) {
            let key = vector::borrow<PendingTpSlKey>(&tp_sl.fixed_sized, i);
            if (&key.price_index == &target_index) {
                found_idx = option::some(i);
                break
            };
            i = i + 1;
        };

        if (option::is_none(&found_idx)) {
            return option::none<PendingTpSlInfo>()
        };

        let idx = option::destroy_some(found_idx);
        let key = *vector::borrow<PendingTpSlKey>(&tp_sl.fixed_sized, idx);
        let (acct, _order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
            market, key.price_index, is_tp, is_long
        );
        let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);

        option::some<PendingTpSlInfo>(PendingTpSlInfo {
            order_id: key.order_id,
            trigger_price: trigger,
            account: acct,
            limit_price: lim_price,
            size,
        })
    }

    /// Get fixed-sized TP/SL info by order ID
    friend fun get_fixed_sized_tp_sl_for_order_id(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_tp: bool,
        order_id: order_book_types::OrderIdType,
        is_long: bool
    ): option::Option<PendingTpSlInfo> acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return option::none<PendingTpSlInfo>()
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        let tp_sl = if (is_tp) { state.tp_reqs } else { state.sl_reqs };

        // Search for matching order ID
        let mut found_idx: option::Option<u64> = option::none();
        let mut i = 0u64;
        let len = vector::length<PendingTpSlKey>(&tp_sl.fixed_sized);

        while (i < len) {
            let key = vector::borrow<PendingTpSlKey>(&tp_sl.fixed_sized, i);
            if (&key.order_id == &order_id) {
                found_idx = option::some(i);
                break
            };
            i = i + 1;
        };

        if (option::is_none(&found_idx)) {
            return option::none<PendingTpSlInfo>()
        };

        let idx = option::destroy_some(found_idx);
        let key = *vector::borrow<PendingTpSlKey>(&tp_sl.fixed_sized, idx);
        let (acct, _order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
            market, key.price_index, is_tp, is_long
        );
        let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);

        option::some<PendingTpSlInfo>(PendingTpSlInfo {
            order_id: key.order_id,
            trigger_price: trigger,
            account: acct,
            limit_price: lim_price,
            size,
        })
    }

    // ============================================================================
    // VALIDATION
    // ============================================================================

    /// Validate non-reduce-only order placement
    /// Checks if account has sufficient free collateral
    friend fun validate_non_reduce_only_order_placement(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        price: u64,
        is_long: bool,
        position_size: u64,
        position_is_long: bool,
        leverage: u8,
        free_collateral: u64
    ): bool acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let mut account_summary = table::remove<address, AccountSummary>(&mut global.summary, account);

        // Initialize market state if needed
        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            let empty_state = create_empty_pending_market_state();
            big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &mut account_summary.markets, market, empty_state
            );
        };

        // Get current state and simulate adding this order
        let state = big_ordered_map::get<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );
        let state = option::destroy_some<PendingMarketState>(state);
        let mut pending_longs = state.pending_longs;
        let mut pending_shorts = state.pending_shorts;

        // Simulate adding this order
        let notional = (size as u128) * (price as u128);
        if (is_long) {
            pending_longs.price_size_sum = pending_longs.price_size_sum + notional;
            pending_longs.size_sum = pending_longs.size_sum + size;
        } else {
            pending_shorts.price_size_sum = pending_shorts.price_size_sum + notional;
            pending_shorts.size_sum = pending_shorts.size_sum + size;
        };

        // Calculate required margin for this market
        let pending_notional = pending_price_size_for_market(position_size, position_is_long, &pending_longs, &pending_shorts);
        let size_multiplier = (perp_market_config::get_size_multiplier(market) as u128);
        let leverage_128 = (leverage as u128);
        let divisor = size_multiplier * leverage_128;

        let required_margin = if (pending_notional == 0u128) {
            if (divisor != 0u128) { 0u128 } else { abort error::invalid_argument(E_DIVISION_BY_ZERO) }
        } else {
            (pending_notional - 1u128) / divisor + 1u128
        };

        let simulated_margin = (required_margin as u64);

        // Calculate total margin across all markets
        let mut total_margin = 0u64;

        let leaf_iter = big_ordered_map::internal_leaf_new_begin_iter<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets
        );

        while (!big_ordered_map::internal_leaf_iter_is_end(&leaf_iter)) {
            let (entries, next_iter) = big_ordered_map::internal_leaf_iter_borrow_entries_and_next_leaf_index<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                leaf_iter, &account_summary.markets
            );

            let entry_iter = ordered_map::internal_new_begin_iter<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entries);

            while (!ordered_map::iter_is_end<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(&entry_iter, entries)) {
                let key = ordered_map::iter_borrow_key<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(&entry_iter, entries);
                let child = ordered_map::iter_borrow<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
                let state = big_ordered_map::internal_leaf_borrow_value<PendingMarketState>(child);

                if (key == &market) {
                    total_margin = total_margin + simulated_margin;
                } else {
                    total_margin = total_margin + state.pending_margin;
                };

                entry_iter = ordered_map::iter_next<object::Object<perp_market::PerpMarket>, big_ordered_map::Child<PendingMarketState>>(entry_iter, entries);
            };

            leaf_iter = next_iter;
        };

        table::add<address, AccountSummary>(&mut global.summary, account, account_summary);

        // Check if total margin <= free collateral
        total_margin <= free_collateral
    }

    /// Validate reduce-only order placement
    friend fun validate_reduce_only_order(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool,
        position_size: u64,
        position_is_long: bool
    ): option::Option<string::String> acquires GlobalSummary {
        // Must have a position
        if (position_size == 0) {
            // "Cannot place reduce only order with no position"
            return option::some<string::String>(string::utf8(
                vector[67u8, 97u8, 110u8, 110u8, 111u8, 116u8, 32u8, 112u8, 108u8, 97u8, 99u8, 101u8,
                       32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8,
                       32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 119u8, 105u8, 116u8, 104u8, 32u8,
                       110u8, 111u8, 32u8, 112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8]
            ))
        };

        // Must be opposite direction
        if (is_long == position_is_long) {
            // "Reduce only order direction must be opposite to position direction"
            return option::some<string::String>(string::utf8(
                vector[82u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8, 121u8, 32u8,
                       111u8, 114u8, 100u8, 101u8, 114u8, 32u8, 100u8, 105u8, 114u8, 101u8, 99u8, 116u8,
                       105u8, 111u8, 110u8, 32u8, 109u8, 117u8, 115u8, 116u8, 32u8, 98u8, 101u8, 32u8,
                       111u8, 112u8, 112u8, 111u8, 115u8, 105u8, 116u8, 101u8, 32u8, 116u8, 111u8, 32u8,
                       112u8, 111u8, 115u8, 105u8, 116u8, 105u8, 111u8, 110u8, 32u8, 100u8, 105u8, 114u8,
                       101u8, 99u8, 116u8, 105u8, 111u8, 110u8]
            ))
        };

        // Check order count limit
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
                &account_summary.markets, &market
            );
            if (vector::length<ReduceOnlyOrderInfo>(&state.reduce_only_orders.orders) == MAX_REDUCE_ONLY_ORDERS) {
                // "Maximum allowed number of reduce only orders exceeded for market"
                return option::some<string::String>(string::utf8(
                    vector[77u8, 97u8, 120u8, 105u8, 109u8, 117u8, 109u8, 32u8, 97u8, 108u8, 108u8, 111u8,
                           119u8, 101u8, 100u8, 32u8, 110u8, 117u8, 109u8, 98u8, 101u8, 114u8, 32u8, 111u8,
                           102u8, 32u8, 114u8, 101u8, 100u8, 117u8, 99u8, 101u8, 32u8, 111u8, 110u8, 108u8,
                           121u8, 32u8, 111u8, 114u8, 100u8, 101u8, 114u8, 115u8, 32u8, 101u8, 120u8, 99u8,
                           101u8, 101u8, 100u8, 101u8, 100u8, 32u8, 102u8, 111u8, 114u8, 32u8, 109u8, 97u8,
                           114u8, 107u8, 101u8, 116u8]
                ))
            }
        };

        option::none<string::String>()
    }

    /// Update position info and recalculate margin
    friend fun update_position(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        position_size: u64,
        position_is_long: bool,
        leverage: u8
    ) acquires GlobalSummary {
        let global = borrow_global_mut<GlobalSummary>(@decibel);
        let mut account_summary = table::remove<address, AccountSummary>(&mut global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            table::add<address, AccountSummary>(&mut global.summary, account, account_summary);
            return
        };

        let mut market_state = big_ordered_map::remove<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, &market
        );

        let size_multiplier = perp_market_config::get_size_multiplier(market);
        update_required_margin_for_market(&mut market_state, position_size, position_is_long, leverage, size_multiplier);

        big_ordered_map::add<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &mut account_summary.markets, market, market_state
        );
        table::add<address, AccountSummary>(&mut global.summary, account, account_summary);
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// Create empty pending market state
    fun create_empty_pending_market_state(): PendingMarketState {
        PendingMarketState::V1 {
            pending_margin: 0,
            pending_longs: PendingOrders { price_size_sum: 0u128, size_sum: 0 },
            pending_shorts: PendingOrders { price_size_sum: 0u128, size_sum: 0 },
            reduce_only_orders: ReduceOnlyOrders { total_size: 0, orders: vector::empty<ReduceOnlyOrderInfo>() },
            tp_reqs: PendingTpSLs {
                full_sized: option::none<PendingTpSlKey>(),
                fixed_sized: vector::empty<PendingTpSlKey>(),
                pending_order_based_tp_sl_count: 0,
            },
            sl_reqs: PendingTpSLs {
                full_sized: option::none<PendingTpSlKey>(),
                fixed_sized: vector::empty<PendingTpSlKey>(),
                pending_order_based_tp_sl_count: 0,
            },
        }
    }

    /// Update required margin for a market based on pending orders and position
    ///
    /// The margin calculation considers position offset:
    /// - If position is in same direction as pending orders, no offset
    /// - If position is opposite direction, pending orders up to 2x position size are offset
    fun update_required_margin_for_market(
        state: &mut PendingMarketState,
        position_size: u64,
        position_is_long: bool,
        leverage: u8,
        size_multiplier: u64
    ) {
        let pending_longs = &state.pending_longs;
        let pending_shorts = &state.pending_shorts;

        // Calculate effective notional after position offset
        let effective_notional = pending_price_size_for_market(
            position_size, position_is_long, pending_longs, pending_shorts
        );

        // Calculate margin: notional / (size_multiplier * leverage)
        let divisor = (size_multiplier as u128) * (leverage as u128);

        let required_margin = if (effective_notional == 0u128) {
            if (divisor != 0u128) { 0u128 } else { abort error::invalid_argument(E_DIVISION_BY_ZERO) }
        } else {
            (effective_notional - 1u128) / divisor + 1u128  // Round up
        };

        state.pending_margin = (required_margin as u64);
    }

    /// Calculate effective pending notional after position offset
    ///
    /// For orders in the opposite direction of position:
    /// - Orders up to 2x position size are "free" (no margin required)
    /// - Only orders exceeding 2x position size require margin
    ///
    /// This allows users to close positions and flip direction without extra margin
    fun pending_price_size_for_market(
        position_size: u64,
        position_is_long: bool,
        pending_longs: &PendingOrders,
        pending_shorts: &PendingOrders
    ): u128 {
        if (position_is_long) {
            // Position is long, so short orders can be offset
            // Calculate excess short orders beyond 2x position
            let free_short_size = 2 * position_size;
            let excess_short_size = if (pending_shorts.size_sum > free_short_size) {
                pending_shorts.size_sum - free_short_size
            } else {
                0
            };

            if (pending_shorts.size_sum == 0) {
                return 0u128
            };

            // Calculate average price weighted notional for excess
            let excess_notional = (excess_short_size as u128) * pending_shorts.price_size_sum /
                                 (pending_shorts.size_sum as u128);

            // Return max of long notional and excess short notional
            math128::max(pending_longs.price_size_sum, excess_notional)
        } else {
            // Position is short, so long orders can be offset
            let free_long_size = 2 * position_size;
            let excess_long_size = if (pending_longs.size_sum > free_long_size) {
                pending_longs.size_sum - free_long_size
            } else {
                0
            };

            if (pending_longs.size_sum == 0) {
                return 0u128
            };

            let excess_notional = (excess_long_size as u128) * pending_longs.price_size_sum /
                                 (pending_longs.size_sum as u128);

            math128::max(pending_shorts.price_size_sum, excess_notional)
        }
    }

    /// Get all TP/SL for event emission
    friend fun get_all_tp_sls_for_event(
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        is_long: bool
    ): (option::Option<FullSizedTpSlForEvent>, option::Option<FullSizedTpSlForEvent>, vector<FixedSizedTpSlForEvent>, vector<FixedSizedTpSlForEvent>)
    acquires GlobalSummary {
        let global = borrow_global<GlobalSummary>(@decibel);
        let account_summary = table::borrow<address, AccountSummary>(&global.summary, account);

        if (!big_ordered_map::contains<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        )) {
            return (
                option::none<FullSizedTpSlForEvent>(),
                option::none<FullSizedTpSlForEvent>(),
                vector::empty<FixedSizedTpSlForEvent>(),
                vector::empty<FixedSizedTpSlForEvent>()
            )
        };

        let state = big_ordered_map::borrow<object::Object<perp_market::PerpMarket>, PendingMarketState>(
            &account_summary.markets, &market
        );

        // Get full-sized TP
        let full_tp = if (option::is_some<PendingTpSlKey>(&state.tp_reqs.full_sized)) {
            let key = option::destroy_some<PendingTpSlKey>(*&state.tp_reqs.full_sized);
            let (_acct, order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
                market, key.price_index, true, is_long
            );
            if (option::is_none<u64>(&size)) {
                let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);
                option::some<FullSizedTpSlForEvent>(FullSizedTpSlForEvent {
                    order_id: order_book_types::get_order_id_value(&order_id),
                    trigger_price: trigger,
                    limit_price: lim_price,
                })
            } else {
                abort 10  // Should be full-sized
            }
        } else {
            option::none<FullSizedTpSlForEvent>()
        };

        // Get full-sized SL
        let full_sl = if (option::is_some<PendingTpSlKey>(&state.sl_reqs.full_sized)) {
            let key = option::destroy_some<PendingTpSlKey>(*&state.sl_reqs.full_sized);
            let (_acct, order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
                market, key.price_index, false, is_long
            );
            if (option::is_none<u64>(&size)) {
                let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);
                option::some<FullSizedTpSlForEvent>(FullSizedTpSlForEvent {
                    order_id: order_book_types::get_order_id_value(&order_id),
                    trigger_price: trigger,
                    limit_price: lim_price,
                })
            } else {
                abort 10
            }
        } else {
            option::none<FullSizedTpSlForEvent>()
        };

        // Get fixed-sized TP orders
        let mut fixed_tp = vector::empty<FixedSizedTpSlForEvent>();
        let mut tp_keys = state.tp_reqs.fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut tp_keys);
        while (vector::length<PendingTpSlKey>(&tp_keys) > 0) {
            let key = vector::pop_back<PendingTpSlKey>(&mut tp_keys);
            let (_acct, order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
                market, key.price_index, true, is_long
            );
            if (option::is_some<u64>(&size)) {
                let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);
                let event = FixedSizedTpSlForEvent {
                    order_id: order_book_types::get_order_id_value(&order_id),
                    trigger_price: trigger,
                    limit_price: lim_price,
                    size: option::destroy_some<u64>(size),
                };
                vector::push_back<FixedSizedTpSlForEvent>(&mut fixed_tp, event);
            } else {
                abort 10  // Should be fixed-sized
            }
        };
        vector::destroy_empty<PendingTpSlKey>(tp_keys);

        // Get fixed-sized SL orders
        let mut fixed_sl = vector::empty<FixedSizedTpSlForEvent>();
        let mut sl_keys = state.sl_reqs.fixed_sized;
        vector::reverse<PendingTpSlKey>(&mut sl_keys);
        while (vector::length<PendingTpSlKey>(&sl_keys) > 0) {
            let key = vector::pop_back<PendingTpSlKey>(&mut sl_keys);
            let (_acct, order_id, lim_price, size, _builder) = position_tp_sl_tracker::get_pending_tp_sl(
                market, key.price_index, false, is_long
            );
            if (option::is_some<u64>(&size)) {
                let trigger = position_tp_sl_tracker::get_trigger_price(&key.price_index);
                let event = FixedSizedTpSlForEvent {
                    order_id: order_book_types::get_order_id_value(&order_id),
                    trigger_price: trigger,
                    limit_price: lim_price,
                    size: option::destroy_some<u64>(size),
                };
                vector::push_back<FixedSizedTpSlForEvent>(&mut fixed_sl, event);
            } else {
                abort 10
            }
        };
        vector::destroy_empty<PendingTpSlKey>(sl_keys);

        (full_tp, full_sl, fixed_tp, fixed_sl)
    }
}
