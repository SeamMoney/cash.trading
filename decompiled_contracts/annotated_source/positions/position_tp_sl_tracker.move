/// ============================================================================
/// POSITION TP/SL TRACKER - Price-Indexed TP/SL Order Storage
/// ============================================================================
///
/// This module provides the underlying storage and price-indexed retrieval
/// for TP/SL orders. It uses BigOrderedMap for efficient price-based ordering
/// and retrieval of triggered orders.
///
/// DATA STRUCTURES:
/// - PendingOrderTracker: Resource stored on each market containing two price indices
/// - PriceIndexKey: Composite key for indexing orders by trigger price
/// - PendingRequest: The actual order data
///
/// TWO PRICE INDICES:
/// - price_move_up_index: Orders triggered when price rises (Long TP, Short SL)
/// - price_move_down_index: Orders triggered when price falls (Long SL, Short TP)
///
/// TRIGGER LOGIC:
/// - Price moving up: Iterate from lowest trigger price upward
/// - Price moving down: Iterate from highest trigger price downward
///
/// This separation allows efficient retrieval of all orders triggered by
/// a price movement without scanning the entire order set.
///
/// ============================================================================

module decibel::position_tp_sl_tracker {
    use std::vector;
    use std::object;
    use std::option;
    use aptos_std::big_ordered_map;

    use decibel::perp_market;
    use decibel::builder_code_registry;
    use econia::order_book_types;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::pending_order_tracker;
    friend decibel::position_tp_sl;
    friend decibel::perp_engine;

    // ============================================================================
    // STRUCTS AND ENUMS
    // ============================================================================

    /// Main tracker resource stored on each market
    /// Contains two price-ordered indices for efficient trigger detection
    enum PendingOrderTracker has key {
        V1 {
            /// Orders triggered by price moving UP (ascending order by trigger price)
            /// Contains: Long TP orders, Short SL orders
            price_move_up_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,

            /// Orders triggered by price moving DOWN (descending order by trigger price)
            /// Contains: Long SL orders, Short TP orders
            price_move_down_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,
        }
    }

    /// Composite key for price-indexed order lookup
    /// Orders are sorted primarily by trigger_price in the BigOrderedMap
    struct PriceIndexKey has copy, drop, store {
        trigger_price: u64,                                    // Primary sort key
        account: address,                                      // Secondary key: owner account
        limit_price: option::Option<u64>,                      // Tertiary key: limit price
        is_full_size: bool,                                    // Whether order closes full position
        builder_code: option::Option<builder_code_registry::BuilderCode>,  // Builder rebate code
    }

    /// Pending TP/SL order request
    enum PendingRequest has copy, drop, store {
        V1 {
            order_id: order_book_types::OrderIdType,
            account: address,
            limit_price: option::Option<u64>,
            size: option::Option<u64>,  // None = full position size
            builder_code: option::Option<builder_code_registry::BuilderCode>,
        }
    }

    // ============================================================================
    // MARKET REGISTRATION
    // ============================================================================

    /// Register a new market's TP/SL tracker
    /// Called during market creation to initialize the price indices
    friend fun register_market(market_signer: &signer) {
        // Create price indices with configuration:
        // - inner_max_degree: 64 (max entries per inner node)
        // - leaf_max_degree: 32 (max entries per leaf node)
        // - rebalance: true (maintain balance on modifications)
        let price_move_up_index = big_ordered_map::new_with_config<PriceIndexKey, PendingRequest>(
            64u16, 32u16, true
        );
        let price_move_down_index = big_ordered_map::new_with_config<PriceIndexKey, PendingRequest>(
            64u16, 32u16, true
        );

        let tracker = PendingOrderTracker::V1 {
            price_move_up_index,
            price_move_down_index,
        };

        move_to<PendingOrderTracker>(market_signer, tracker);
    }

    // ============================================================================
    // ORDER MANAGEMENT
    // ============================================================================

    /// Add a new TP/SL order to the tracker
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `account`: Order owner
    /// - `order_id`: Unique order identifier
    /// - `key`: Price index key for lookup
    /// - `limit_price`: Optional limit price
    /// - `size`: Optional fixed size
    /// - `is_tp`: True for take-profit, false for stop-loss
    /// - `is_long`: True if position is long
    friend fun add_new_tp_sl(
        market: object::Object<perp_market::PerpMarket>,
        account: address,
        order_id: order_book_types::OrderIdType,
        key: PriceIndexKey,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
        is_tp: bool,
        is_long: bool
    ) acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<PendingOrderTracker>(market_addr);

        let builder_code = *&(&key).builder_code;
        let pending_request = PendingRequest::V1 {
            order_id,
            account,
            limit_price,
            size,
            builder_code,
        };

        // Determine which index to use based on position direction and TP/SL type
        // Long TP / Short SL -> price_move_up_index (trigger when price rises)
        // Long SL / Short TP -> price_move_down_index (trigger when price falls)
        let index = if (is_tp == is_long) {
            &mut tracker.price_move_up_index
        } else {
            &mut tracker.price_move_down_index
        };

        // Upsert allows updating existing orders with same key
        let _old = big_ordered_map::upsert<PriceIndexKey, PendingRequest>(index, key, pending_request);
    }

    /// Cancel a pending TP/SL order
    friend fun cancel_pending_tp_sl(
        market: object::Object<perp_market::PerpMarket>,
        key: PriceIndexKey,
        is_tp: bool,
        is_long: bool
    ) acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<PendingOrderTracker>(market_addr);

        // Select correct index based on trigger direction
        let index = if (is_tp == is_long) {
            &mut tracker.price_move_up_index
        } else {
            &mut tracker.price_move_down_index
        };

        let _removed = big_ordered_map::remove<PriceIndexKey, PendingRequest>(index, &key);
    }

    /// Increase the size of an existing TP/SL order
    friend fun increase_pending_tp_sl_size(
        market: object::Object<perp_market::PerpMarket>,
        key: PriceIndexKey,
        size_increase: u64,
        is_tp: bool,
        is_long: bool
    ) acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<PendingOrderTracker>(market_addr);

        let index = if (is_tp == is_long) {
            &mut tracker.price_move_up_index
        } else {
            &mut tracker.price_move_down_index
        };

        // Remove existing order
        let mut pending_request = big_ordered_map::remove<PriceIndexKey, PendingRequest>(index, &key);

        // Ensure it's a fixed-size order (size is Some)
        assert!(option::is_some<u64>(&(&pending_request).size), 1);

        // Calculate new size
        let current_size = option::destroy_some<u64>(*&(&pending_request).size);
        let new_size = option::some<u64>(current_size + size_increase);

        // Update size
        let size_ref = &mut (&mut pending_request).size;
        *size_ref = new_size;

        // Re-add with updated size
        big_ordered_map::add<PriceIndexKey, PendingRequest>(index, key, pending_request);
    }

    // ============================================================================
    // ORDER LOOKUP
    // ============================================================================

    /// Get order ID for a pending TP/SL by key
    friend fun get_pending_order_id(
        market: object::Object<perp_market::PerpMarket>,
        key: PriceIndexKey,
        is_tp: bool,
        is_long: bool
    ): option::Option<order_book_types::OrderIdType> acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<PendingOrderTracker>(market_addr);

        let index = if (is_tp == is_long) {
            &tracker.price_move_up_index
        } else {
            &tracker.price_move_down_index
        };

        let result = big_ordered_map::get<PriceIndexKey, PendingRequest>(index, &key);

        if (option::is_some<PendingRequest>(&result)) {
            let pending = option::destroy_some<PendingRequest>(result);
            return option::some<order_book_types::OrderIdType>(*&(&pending).order_id)
        };

        option::none<order_book_types::OrderIdType>()
    }

    /// Get full details for a pending TP/SL by key
    friend fun get_pending_tp_sl(
        market: object::Object<perp_market::PerpMarket>,
        key: PriceIndexKey,
        is_tp: bool,
        is_long: bool
    ): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>)
    acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<PendingOrderTracker>(market_addr);

        let index = if (is_tp == is_long) {
            &tracker.price_move_up_index
        } else {
            &tracker.price_move_down_index
        };

        let borrowed = big_ordered_map::borrow<PriceIndexKey, PendingRequest>(index, &key);
        destroy_pending_request(*borrowed)
    }

    // ============================================================================
    // TRIGGERED ORDER RETRIEVAL (READ-ONLY)
    // ============================================================================

    /// Get orders triggered by price moving up (without removing them)
    /// Iterates from lowest trigger price upward until price threshold reached
    public fun get_ready_price_move_up_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        max_orders: u64
    ): vector<PendingRequest> acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<PendingOrderTracker>(market_addr);

        let result = vector::empty<PendingRequest>();

        // Start at beginning (lowest trigger price)
        let iter = big_ordered_map::internal_new_begin_iter<PriceIndexKey, PendingRequest>(
            &tracker.price_move_up_index
        );

        loop {
            // Continue while not at end and under max orders
            let should_continue = if (big_ordered_map::iter_is_end<PriceIndexKey, PendingRequest>(
                &iter, &tracker.price_move_up_index
            )) {
                false
            } else {
                vector::length<PendingRequest>(&result) < max_orders
            };

            if (!should_continue) break;

            // Get trigger price for current entry
            let key = big_ordered_map::iter_borrow_key<PriceIndexKey>(&iter);
            let trigger_price = *&key.trigger_price;

            // Stop if trigger price above current price (not yet triggered)
            if (!(current_price >= trigger_price)) break;

            // Add to result (copy the pending request with builder code from key)
            let borrowed = big_ordered_map::iter_borrow<PriceIndexKey, PendingRequest>(
                iter, &tracker.price_move_up_index
            );
            let PendingRequest::V1 { order_id, account, limit_price, size, builder_code: _ } = *borrowed;
            let builder_code_copy = *&key.builder_code;
            let request_copy = PendingRequest::V1 {
                order_id,
                account,
                limit_price,
                size,
                builder_code: builder_code_copy,
            };
            vector::push_back<PendingRequest>(&mut result, request_copy);

            // Move to next entry
            iter = big_ordered_map::iter_next<PriceIndexKey, PendingRequest>(
                iter, &tracker.price_move_up_index
            );
        };

        result
    }

    /// Get orders triggered by price moving down (without removing them)
    /// Iterates from highest trigger price downward until price threshold reached
    public fun get_ready_price_move_down_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        max_orders: u64
    ): vector<PendingRequest> acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global<PendingOrderTracker>(market_addr);

        let result = vector::empty<PendingRequest>();

        // Start at end (highest trigger price)
        let iter = big_ordered_map::internal_new_end_iter<PriceIndexKey, PendingRequest>(
            &tracker.price_move_down_index
        );

        loop {
            // Continue while not at begin and under max orders
            let should_continue = if (big_ordered_map::iter_is_begin<PriceIndexKey, PendingRequest>(
                &iter, &tracker.price_move_down_index
            )) {
                false
            } else {
                vector::length<PendingRequest>(&result) < max_orders
            };

            if (!should_continue) break;

            // Get trigger price for current entry
            let key = big_ordered_map::iter_borrow_key<PriceIndexKey>(&iter);
            let trigger_price = *&key.trigger_price;

            // Stop if trigger price below current price (not yet triggered)
            if (!(current_price <= trigger_price)) break;

            // Add to result
            let borrowed = big_ordered_map::iter_borrow<PriceIndexKey, PendingRequest>(
                iter, &tracker.price_move_down_index
            );
            let PendingRequest::V1 { order_id, account, limit_price, size, builder_code: _ } = *borrowed;
            let builder_code_copy = *&key.builder_code;
            let request_copy = PendingRequest::V1 {
                order_id,
                account,
                limit_price,
                size,
                builder_code: builder_code_copy,
            };
            vector::push_back<PendingRequest>(&mut result, request_copy);

            // Move to previous entry (iterating backwards)
            iter = big_ordered_map::iter_prev<PriceIndexKey, PendingRequest>(
                iter, &tracker.price_move_down_index
            );
        };

        result
    }

    // ============================================================================
    // TRIGGERED ORDER RETRIEVAL (WITH REMOVAL)
    // ============================================================================

    /// Take orders triggered by price moving up (removes them from tracker)
    friend fun take_ready_price_move_up_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        max_orders: u64
    ): vector<PendingRequest> acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<PendingOrderTracker>(market_addr);

        let result = vector::empty<PendingRequest>();

        loop {
            // Continue while index not empty and under max orders
            let should_continue = if (big_ordered_map::is_empty<PriceIndexKey, PendingRequest>(
                &tracker.price_move_up_index
            )) {
                false
            } else {
                vector::length<PendingRequest>(&result) < max_orders
            };

            if (!should_continue) break;

            // Get front entry (lowest trigger price)
            let (key, _value) = big_ordered_map::borrow_front<PriceIndexKey, PendingRequest>(
                &tracker.price_move_up_index
            );
            let trigger_price = *&(&key).trigger_price;

            // Stop if trigger price above current price
            if (!(current_price >= trigger_price)) break;

            // Remove and add to result
            let PendingRequest::V1 { order_id, account, limit_price, size, builder_code: _ } =
                big_ordered_map::remove<PriceIndexKey, PendingRequest>(
                    &mut tracker.price_move_up_index,
                    &key
                );
            let builder_code_copy = *&(&key).builder_code;
            let request = PendingRequest::V1 {
                order_id,
                account,
                limit_price,
                size,
                builder_code: builder_code_copy,
            };
            vector::push_back<PendingRequest>(&mut result, request);
        };

        result
    }

    /// Take orders triggered by price moving down (removes them from tracker)
    friend fun take_ready_price_move_down_orders(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        max_orders: u64
    ): vector<PendingRequest> acquires PendingOrderTracker {
        let market_addr = object::object_address<perp_market::PerpMarket>(&market);
        let tracker = borrow_global_mut<PendingOrderTracker>(market_addr);

        let result = vector::empty<PendingRequest>();

        loop {
            // Continue while index not empty and under max orders
            let should_continue = if (big_ordered_map::is_empty<PriceIndexKey, PendingRequest>(
                &tracker.price_move_down_index
            )) {
                false
            } else {
                vector::length<PendingRequest>(&result) < max_orders
            };

            if (!should_continue) break;

            // Get back entry (highest trigger price)
            let (key, _value) = big_ordered_map::borrow_back<PriceIndexKey, PendingRequest>(
                &tracker.price_move_down_index
            );
            let trigger_price = *&(&key).trigger_price;

            // Stop if trigger price below current price
            if (!(current_price <= trigger_price)) break;

            // Remove and add to result
            let PendingRequest::V1 { order_id, account, limit_price, size, builder_code: _ } =
                big_ordered_map::remove<PriceIndexKey, PendingRequest>(
                    &mut tracker.price_move_down_index,
                    &key
                );
            let builder_code_copy = *&(&key).builder_code;
            let request = PendingRequest::V1 {
                order_id,
                account,
                limit_price,
                size,
                builder_code: builder_code_copy,
            };
            vector::push_back<PendingRequest>(&mut result, request);
        };

        result
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /// Destroy a pending request and extract its fields
    friend fun destroy_pending_request(
        request: PendingRequest
    ): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>) {
        let PendingRequest::V1 { order_id, account, limit_price, size, builder_code } = request;
        (account, order_id, limit_price, size, builder_code)
    }

    /// Get account from pending request
    friend fun get_account_from_pending_request(request: &PendingRequest): address {
        *&request.account
    }

    /// Get order ID from pending request
    friend fun get_order_id_from_pending_request(request: &PendingRequest): order_book_types::OrderIdType {
        *&request.order_id
    }

    /// Get size from pending request (None = full position size)
    friend fun get_size_from_pending_request(request: &PendingRequest): option::Option<u64> {
        *&request.size
    }

    /// Get trigger price from price index key
    friend fun get_trigger_price(key: &PriceIndexKey): u64 {
        *&key.trigger_price
    }

    /// Create a new price index key
    friend fun new_price_index_key(
        trigger_price: u64,
        account: address,
        limit_price: option::Option<u64>,
        is_full_size: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): PriceIndexKey {
        PriceIndexKey {
            trigger_price,
            account,
            limit_price,
            is_full_size,
            builder_code,
        }
    }
}
