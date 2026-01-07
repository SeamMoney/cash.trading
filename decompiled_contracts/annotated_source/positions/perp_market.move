/// ============================================================================
/// Module: perp_market
/// Description: Perpetual market wrapper around the order book
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module wraps the generic order book implementation to create a
/// perpetual futures market. Each PerpMarket is a Move object that contains:
/// - An order book for limit orders
/// - Associated market configuration (in perp_market_config)
/// - Price management state (in price_management)
///
/// The order book uses a generic Market type that handles:
/// - Bid/ask order placement and matching
/// - Trigger orders (stop-loss, take-profit)
/// - Time-based orders (expiring orders)
/// - Bulk order operations
///
/// This module provides the bridge between the order book library and
/// the perp-specific logic like position updates, margin requirements,
/// and liquidations.
/// ============================================================================

module decibel::perp_market {
    use order_book::market_types;
    use decibel::perp_engine_types;
    use aptos_framework::object;
    use order_book::order_book_types;
    use order_book::order_book;
    use aptos_framework::option;
    use order_book::order_operations;
    use order_book::market_bulk_order;
    use order_book::single_order_types;
    use aptos_framework::string;
    use order_book::order_placement;
    use aptos_framework::signer;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Order placement utilities for slippage and limit price calculation
    friend decibel::order_placement_utils;

    /// Async matching engine processes order fills
    friend decibel::async_matching_engine;

    /// Perp engine coordinates trading operations
    friend decibel::perp_engine;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// A perpetual futures market
    ///
    /// This is a Move object (has `key`) that wraps a generic order book
    /// Market type. The Market is parameterized with perp-specific order
    /// metadata that tracks builder codes, reduce-only flags, etc.
    enum PerpMarket has key {
        V1 {
            /// The underlying order book market
            market: market_types::Market<perp_engine_types::OrderMetadata>,
        }
    }

    // =========================================================================
    // PUBLIC VIEW FUNCTIONS
    // =========================================================================

    /// Gets the remaining size of an order
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `order_id` - Order ID to query
    ///
    /// # Returns
    /// Remaining unfilled size of the order
    public fun get_remaining_size(
        market: object::Object<PerpMarket>,
        order_id: order_book_types::OrderIdType
    ): u64 acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global<PerpMarket>(market_addr);
        let order_book = market_types::get_order_book<perp_engine_types::OrderMetadata>(&perp_market.market);
        order_book::get_remaining_size<perp_engine_types::OrderMetadata>(order_book, order_id)
    }

    /// Gets the best ask (lowest sell) price
    ///
    /// # Returns
    /// Some(price) if there are asks, None if order book is empty
    public fun best_ask_price(market: object::Object<PerpMarket>): option::Option<u64>
        acquires PerpMarket
    {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global<PerpMarket>(market_addr);
        market_types::best_ask_price<perp_engine_types::OrderMetadata>(&perp_market.market)
    }

    /// Gets the best bid (highest buy) price
    ///
    /// # Returns
    /// Some(price) if there are bids, None if order book is empty
    public fun best_bid_price(market: object::Object<PerpMarket>): option::Option<u64>
        acquires PerpMarket
    {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global<PerpMarket>(market_addr);
        market_types::best_bid_price<perp_engine_types::OrderMetadata>(&perp_market.market)
    }

    /// Gets both best bid and ask prices
    ///
    /// # Returns
    /// (best_bid, best_ask) - Both are Option<u64>
    public fun get_best_bid_and_ask_price(
        market: object::Object<PerpMarket>
    ): (option::Option<u64>, option::Option<u64>) acquires PerpMarket {
        let best_bid = best_bid_price(market);
        let best_ask = best_ask_price(market);
        (best_bid, best_ask)
    }

    // =========================================================================
    // FRIEND FUNCTIONS - ORDER QUERIES
    // =========================================================================

    /// Gets the slippage price for a given size
    ///
    /// Calculates what price you would get if you market-ordered a given size.
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `is_bid` - True if buying (matching against asks)
    /// * `size` - Size to calculate slippage for
    ///
    /// # Returns
    /// Some(average_price) if enough liquidity, None if insufficient
    friend fun get_slippage_price(
        market: object::Object<PerpMarket>,
        is_bid: bool,
        size: u64
    ): option::Option<u64> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global<PerpMarket>(market_addr);
        let order_book = market_types::get_order_book<perp_engine_types::OrderMetadata>(&perp_market.market);
        order_book::get_slippage_price<perp_engine_types::OrderMetadata>(order_book, is_bid, size)
    }

    /// Checks if an order would be a taker order
    ///
    /// Taker orders are those that match immediately against resting orders.
    /// Maker orders rest on the book waiting to be matched.
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `price` - Order price
    /// * `is_bid` - True if buy order
    /// * `trigger` - Optional trigger condition (for stop/TP orders)
    friend fun is_taker_order(
        market: object::Object<PerpMarket>,
        price: u64,
        is_bid: bool,
        trigger: option::Option<order_book_types::TriggerCondition>
    ): bool acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);
        market_types::is_taker_order<perp_engine_types::OrderMetadata>(
            &perp_market.market,
            price,
            is_bid,
            trigger
        )
    }

    // =========================================================================
    // FRIEND FUNCTIONS - ORDER OPERATIONS
    // =========================================================================

    /// Places an order with a specific order ID
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `owner` - Order owner address
    /// * `price` - Limit price
    /// * `size` - Order size
    /// * `filled_size` - Already filled size (for updates)
    /// * `is_bid` - True for buy order
    /// * `tif` - Time in force (GTC, IOC, etc.)
    /// * `trigger` - Optional trigger condition
    /// * `metadata` - Perp-specific order metadata
    /// * `order_id` - Specific order ID to use
    /// * `client_order_id` - Optional client-assigned ID
    /// * `slippage` - Slippage tolerance in basis points
    /// * `is_reduce_only` - True if order should only reduce position
    /// * `post_only` - True if order should fail if it would match
    /// * `callbacks` - Clearinghouse callbacks for settlement
    ///
    /// # Returns
    /// OrderMatchResult containing match details
    friend fun place_order_with_order_id(
        market: object::Object<PerpMarket>,
        owner: address,
        price: u64,
        size: u64,
        filled_size: u64,
        is_bid: bool,
        tif: order_book_types::TimeInForce,
        trigger: option::Option<order_book_types::TriggerCondition>,
        metadata: perp_engine_types::OrderMetadata,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        slippage: u32,
        is_reduce_only: bool,
        post_only: bool,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ): order_placement::OrderMatchResult<perp_engine_types::OrderMatchingActions> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);
        let maybe_order_id = option::some<order_book_types::OrderIdType>(order_id);

        order_placement::place_order_with_order_id<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            price,
            size,
            filled_size,
            is_bid,
            tif,
            trigger,
            metadata,
            maybe_order_id,
            client_order_id,
            slippage,
            is_reduce_only,
            post_only,
            callbacks
        )
    }

    /// Decreases the size of an existing order
    ///
    /// Used for partial fills or size reductions.
    friend fun decrease_order_size(
        market: object::Object<PerpMarket>,
        owner: address,
        order_id: order_book_types::OrderIdType,
        size_delta: u64,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ) acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        order_operations::decrease_order_size<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            order_id,
            size_delta,
            callbacks
        );
    }

    /// Cancels an order
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `owner` - Order owner address
    /// * `order_id` - Order ID to cancel
    /// * `emit_event` - Whether to emit cancellation event
    /// * `reason` - Reason for cancellation
    /// * `reason_string` - Human-readable reason
    /// * `callbacks` - Clearinghouse callbacks
    ///
    /// # Returns
    /// The cancelled order
    friend fun cancel_order(
        market: object::Object<PerpMarket>,
        owner: address,
        order_id: order_book_types::OrderIdType,
        emit_event: bool,
        reason: market_types::OrderCancellationReason,
        reason_string: string::String,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ): single_order_types::SingleOrder<perp_engine_types::OrderMetadata> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        order_operations::cancel_order<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            order_id,
            emit_event,
            reason,
            reason_string,
            callbacks
        )
    }

    /// Tries to cancel an order (returns None if not found)
    friend fun try_cancel_order(
        market: object::Object<PerpMarket>,
        owner: address,
        order_id: order_book_types::OrderIdType,
        emit_event: bool,
        reason: market_types::OrderCancellationReason,
        reason_string: string::String,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ): option::Option<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        order_operations::try_cancel_order<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            order_id,
            emit_event,
            reason,
            reason_string,
            callbacks
        )
    }

    /// Cancels an order by client order ID
    friend fun cancel_client_order(
        market: object::Object<PerpMarket>,
        user: &signer,
        client_order_id: string::String,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ) acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);
        let owner = signer::address_of(user);
        let reason = market_types::order_cancellation_reason_cancelled_by_user();
        let empty_reason = string::utf8(b"");

        order_operations::cancel_order_with_client_id<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            client_order_id,
            reason,
            empty_reason,
            callbacks
        );
    }

    /// Cancels all orders for a user (bulk cancel)
    friend fun cancel_bulk_order(
        market: object::Object<PerpMarket>,
        user: &signer,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ) acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);
        let reason = market_types::order_cancellation_reason_cancelled_by_user();

        market_bulk_order::cancel_bulk_order<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            user,
            reason,
            callbacks
        );
    }

    /// Places a bulk order (market maker grid)
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `owner` - Owner address
    /// * `num_levels` - Number of price levels
    /// * `sizes` - Sizes at each level
    /// * `prices` - Prices at each level
    /// * `bid_sizes` - Sizes for bid side
    /// * `ask_sizes` - Sizes for ask side
    /// * `metadata` - Order metadata
    /// * `callbacks` - Clearinghouse callbacks
    ///
    /// # Returns
    /// Order ID of the bulk order
    friend fun place_bulk_order(
        market: object::Object<PerpMarket>,
        owner: address,
        num_levels: u64,
        sizes: vector<u64>,
        prices: vector<u64>,
        bid_sizes: vector<u64>,
        ask_sizes: vector<u64>,
        metadata: perp_engine_types::OrderMetadata,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ): order_book_types::OrderIdType acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        market_bulk_order::place_bulk_order<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &mut perp_market.market,
            owner,
            num_levels,
            sizes,
            prices,
            bid_sizes,
            ask_sizes,
            metadata,
            callbacks
        )
    }

    // =========================================================================
    // FRIEND FUNCTIONS - TRIGGER ORDERS
    // =========================================================================

    /// Takes ready price-based trigger orders (stop-loss, take-profit)
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `mark_price` - Current mark price to check triggers against
    /// * `max_count` - Maximum orders to take
    ///
    /// # Returns
    /// Vector of triggered orders ready for execution
    friend fun take_ready_price_based_orders(
        market: object::Object<PerpMarket>,
        mark_price: u64,
        max_count: u64
    ): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        market_types::take_ready_price_based_orders<perp_engine_types::OrderMetadata>(
            &mut perp_market.market,
            mark_price,
            max_count
        )
    }

    /// Takes ready time-based orders (expired orders, scheduled orders)
    ///
    /// # Arguments
    /// * `market` - Market object reference
    /// * `current_time` - Current timestamp
    ///
    /// # Returns
    /// Vector of orders that have reached their time condition
    friend fun take_ready_time_based_orders(
        market: object::Object<PerpMarket>,
        current_time: u64
    ): vector<single_order_types::SingleOrder<perp_engine_types::OrderMetadata>> acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global_mut<PerpMarket>(market_addr);

        market_types::take_ready_time_based_orders<perp_engine_types::OrderMetadata>(
            &mut perp_market.market,
            current_time
        )
    }

    // =========================================================================
    // FRIEND FUNCTIONS - EVENTS
    // =========================================================================

    /// Emits an order event
    friend fun emit_event_for_order(
        market: object::Object<PerpMarket>,
        order_id: order_book_types::OrderIdType,
        client_order_id: option::Option<string::String>,
        owner: address,
        price: u64,
        size: u64,
        filled_size: u64,
        remaining_size: u64,
        is_bid: bool,
        is_reduce_only: bool,
        status: market_types::OrderStatus,
        status_reason: string::String,
        metadata: perp_engine_types::OrderMetadata,
        trigger: option::Option<order_book_types::TriggerCondition>,
        tif: order_book_types::TimeInForce,
        callbacks: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>
    ) acquires PerpMarket {
        let market_addr = object::object_address<PerpMarket>(&market);
        let perp_market = borrow_global<PerpMarket>(market_addr);
        let no_cancellation_reason = option::none<market_types::OrderCancellationReason>();

        market_types::emit_event_for_order<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>(
            &perp_market.market,
            order_id,
            client_order_id,
            owner,
            price,
            size,
            filled_size,
            remaining_size,
            is_bid,
            is_reduce_only,
            status,
            status_reason,
            metadata,
            trigger,
            tif,
            no_cancellation_reason,
            callbacks
        );
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MARKET REGISTRATION
    // =========================================================================

    /// Registers a new perpetual market
    ///
    /// Called during market creation to initialize the PerpMarket object.
    ///
    /// # Arguments
    /// * `market_signer` - Signer for the market object
    /// * `inner_market` - The underlying order book market
    friend fun register_market(
        market_signer: &signer,
        inner_market: market_types::Market<perp_engine_types::OrderMetadata>
    ) {
        let perp_market = PerpMarket::V1 {
            market: inner_market,
        };
        move_to<PerpMarket>(market_signer, perp_market);
    }
}
