/// ============================================================================
/// PERP ENGINE - Main Perpetual Trading Engine Coordinator
/// ============================================================================
///
/// This is the central coordinator module for the Decibel perpetual DEX.
/// It serves as the main entry point for:
/// - Market registration and configuration
/// - Order placement and cancellation
/// - Price oracle updates
/// - Position management
/// - Liquidation triggering
/// - Exchange state management (open/closed)
///
/// KEY CONCEPTS:
/// - Global state manages exchange status and all market references
/// - Markets are registered with specific oracle configurations (Pyth, Chainlink, internal)
/// - Order types: market, limit, bulk, TWAP, TP/SL
/// - Price refresh cycle: oracle update -> mark price -> liquidation check -> trigger orders
///
/// ARCHITECTURE:
/// - perp_engine -> perp_market (order book operations)
/// - perp_engine -> accounts_collateral (deposits/withdrawals)
/// - perp_engine -> async_matching_engine (order matching queue)
/// - perp_engine -> perp_positions (position queries)
/// - perp_engine -> price_management (oracle/mark prices)
///
/// ============================================================================

module decibel::perp_engine {
    use aptos_framework::object;
    use aptos_framework::big_ordered_map;
    use decibel::perp_market;
    use aptos_framework::fungible_asset;
    use std::string;
    use decibel::accounts_collateral;
    use aptos_framework::event;
    use aptos_framework::signer;
    use decibel::perp_positions;
    use decibel::clearinghouse_perp;
    use econia::market_types;
    use decibel::perp_engine_types;
    use std::option;
    use decibel::builder_code_registry;
    use econia::order_book_types;
    use econia::single_order_types;
    use decibel::async_matching_engine;
    use decibel::perp_market_config;
    use decibel::price_management;
    use decibel::oracle;
    use decibel::pending_order_tracker;
    use decibel::position_view_types;
    use decibel::open_interest_tracker;
    use std::vector;
    use decibel::position_tp_sl;
    use decibel::math;
    use decibel::backstop_liquidator_profit_tracker;
    use aptos_framework::error;
    use decibel::tp_sl_utils;
    use aptos_std::bcs;
    use decibel::adl_tracker;
    use decibel::position_tp_sl_tracker;
    use decibel::chainlink_state;
    use pyth::pyth;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::admin_apis;
    friend decibel::perp_engine_api;
    friend decibel::public_apis;

    // ============================================================================
    // GLOBAL STATE
    // ============================================================================

    /// Global exchange state stored at contract address
    /// Manages all markets and exchange status
    enum Global has key {
        V1 {
            extend_ref: object::ExtendRef,  // For creating new objects under this module
            market_refs: big_ordered_map::BigOrderedMap<object::Object<perp_market::PerpMarket>, object::ExtendRef>,
            is_exchange_open: bool,          // Master exchange switch
        }
    }

    // ============================================================================
    // EVENTS
    // ============================================================================

    /// Emitted when DEX is initialized
    enum DexRegistrationEvent has drop, store {
        V1 {
            dex: object::Object<object::ObjectCore>,
            collateral_asset: object::Object<fungible_asset::Metadata>,
            collateral_balance_decimals: u8,
        }
    }

    /// Emitted when new market is registered
    enum MarketRegistrationEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            name: string::String,
            sz_decimals: u8,
            max_leverage: u8,
            max_open_interest: u64,
            min_size: u64,
            lot_size: u64,
            ticker_size: u64,
        }
    }

    /// Emitted when market configuration is updated
    enum MarketUpdateEvent has drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            name: string::String,
            sz_decimals: u8,
            max_leverage: u8,
            max_open_interest: u64,
            min_size: u64,
            lot_size: u64,
            ticker_size: u64,
        }
    }

    /// Internal oracle price snapshot for debugging
    enum OracleInternalSnapshot {
        V1 {
            oracle_type: u8,
            primary_price: u64,
            secondary_price: u64,
        }
    }

    /// Reasons for order cancellation by system
    enum PerpOrderCancelationReason {
        MaxOpenInterestViolation,
    }

    // ============================================================================
    // EXCHANGE STATE QUERIES
    // ============================================================================

    /// Check if exchange is open for trading
    public fun is_exchange_open(): bool
        acquires Global
    {
        *&borrow_global<Global>(@decibel).is_exchange_open
    }

    /// Get collateral balance decimals (8 for internal precision)
    public fun collateral_balance_decimals(): u8 {
        let precision = accounts_collateral::collateral_balance_precision();
        math::get_decimals(&precision)
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the perpetual engine with collateral asset
    ///
    /// Called once during DEX deployment to set up:
    /// - Global state object with extend reference
    /// - Market registry
    /// - Accounts collateral system
    ///
    /// Parameters:
    /// - deployer: Deployer signer
    /// - collateral_asset: Primary collateral (e.g., USDC)
    /// - balance_decimals: Decimal precision for balances
    /// - backstop_liquidator: Address of backstop liquidator
    friend fun initialize(
        deployer: &signer,
        collateral_asset: object::Object<fungible_asset::Metadata>,
        balance_decimals: u8,
        backstop_liquidator: address
    ) {
        // Create named object for global state: "GlobalPerpEngine"
        let constructor_ref = object::create_named_object(
            deployer,
            b"GlobalPerpEngine"
        );
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        // Ensure not already initialized
        assert!(!exists<Global>(@decibel), 2);

        // Initialize global state
        let market_refs = big_ordered_map::new();
        move_to(deployer, Global::V1 {
            extend_ref,
            market_refs,
            is_exchange_open: true,
        });

        // Initialize accounts collateral system
        accounts_collateral::initialize(deployer, collateral_asset, balance_decimals, backstop_liquidator);

        // Emit registration event
        event::emit(DexRegistrationEvent::V1 {
            dex: object::object_from_constructor_ref(&constructor_ref),
            collateral_asset,
            collateral_balance_decimals: balance_decimals,
        });
    }

    // ============================================================================
    // DEPOSIT / WITHDRAWAL
    // ============================================================================

    /// Deposit collateral to cross-margin account
    ///
    /// Requirements:
    /// - Exchange must be open
    /// - Asset must be supported collateral
    /// - Amount must be > 0
    /// - User must be initialized
    public fun deposit(user: &signer, asset: fungible_asset::FungibleAsset)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(accounts_collateral::is_asset_supported(fungible_asset::metadata_from_asset(&asset)), 9);
        assert!(fungible_asset::amount(&asset) > 0, 8);
        perp_positions::assert_user_initialized(signer::address_of(user));

        accounts_collateral::deposit(user, asset);
    }

    /// Deposit to isolated position margin
    public fun deposit_to_isolated_position_margin(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        asset: fungible_asset::FungibleAsset
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(accounts_collateral::is_asset_supported(fungible_asset::metadata_from_asset(&asset)), 9);
        assert!(fungible_asset::amount(&asset) > 0, 8);
        perp_positions::assert_user_initialized(signer::address_of(user));

        accounts_collateral::deposit_to_isolated_position_margin(user, market, asset);
    }

    /// Withdraw collateral from cross-margin account
    ///
    /// Checks free collateral before withdrawal
    public fun withdraw_fungible(
        user: &signer,
        metadata: object::Object<fungible_asset::Metadata>,
        amount: u64
    ): fungible_asset::FungibleAsset
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(amount > 0, 8);
        assert!(accounts_collateral::is_asset_supported(metadata), 9);

        let withdrawn = accounts_collateral::withdraw_fungible(user, metadata, amount);
        assert!(fungible_asset::metadata_from_asset(&withdrawn) == metadata, 7);
        withdrawn
    }

    /// Withdraw from isolated position margin
    public fun withdraw_from_isolated_position_margin(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        metadata: object::Object<fungible_asset::Metadata>,
        amount: u64
    ): fungible_asset::FungibleAsset
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(amount > 0, 8);
        assert!(accounts_collateral::is_asset_supported(metadata), 9);

        let withdrawn = accounts_collateral::withdraw_fungible_from_isolated_position_margin(user, market, amount);
        assert!(fungible_asset::metadata_from_asset(&withdrawn) == metadata, 7);
        withdrawn
    }

    /// Transfer margin between cross and isolated positions
    public fun transfer_margin_to_isolated_position(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        from_cross: bool,
        metadata: object::Object<fungible_asset::Metadata>,
        amount: u64
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(amount > 0, 8);
        assert!(accounts_collateral::is_asset_supported(metadata), 9);

        accounts_collateral::transfer_margin_fungible_to_isolated_position(
            signer::address_of(user), market, from_cross, amount
        );
    }

    // ============================================================================
    // ORDER PLACEMENT
    // ============================================================================

    /// Place a market order (immediate or cancel)
    ///
    /// Market orders use extreme prices to ensure fill:
    /// - Buy: price = MAX (9223372036854775807)
    /// - Sell: price = 1 (minimum)
    ///
    /// Supports optional TP/SL orders attached
    public fun place_market_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        size: u64,
        is_buy: bool,
        reduce_only: bool,
        client_order_id: option::Option<string::String>,
        tp_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        tp_limit: option::Option<u64>,
        sl_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        // Market order uses extreme price
        let price = if (is_buy) { 9223372036854775807 } else { 1 };
        perp_market_config::validate_price_and_size(market, price, size, false);

        let user_addr = signer::address_of(user);
        let time_in_force = order_book_types::immediate_or_cancel();

        async_matching_engine::place_order(
            market, user_addr, price, size, is_buy, time_in_force, reduce_only,
            option::none(), client_order_id,
            tp_price, tp_size, tp_limit, sl_price, sl_size, builder_code
        )
    }

    /// Place a limit order with specified price
    ///
    /// Supports various time-in-force options:
    /// - GoodTillCancelled (GTC)
    /// - ImmediateOrCancel (IOC)
    /// - FillOrKill (FOK)
    /// - PostOnly
    public fun place_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        price: u64,
        size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        reduce_only: bool,
        client_order_id: option::Option<string::String>,
        tp_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        tp_limit: option::Option<u64>,
        sl_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_market_config::validate_price_and_size(market, price, size, false);

        let user_addr = signer::address_of(user);

        async_matching_engine::place_order(
            market, user_addr, price, size, is_buy, time_in_force, reduce_only,
            option::none(), client_order_id,
            tp_price, tp_size, tp_limit, sl_price, sl_size, builder_code
        )
    }

    /// Place a bulk order (multiple orders in single tx)
    ///
    /// Used for market makers to submit/update full order book sides
    public fun place_bulk_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        side_bits: u64,              // Bit flags for buy/sell per order
        prices: vector<u64>,
        sizes: vector<u64>,
        reduce_only_bits: vector<u64>,  // Bit flags for reduce-only per order
        post_only_bits: vector<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        let metadata = perp_engine_types::new_bulk_order_metadata(builder_code);
        let user_addr = signer::address_of(user);
        let callbacks = clearinghouse_perp::market_callbacks(market);

        let order_id = perp_market::place_bulk_order(
            market, user_addr, side_bits, prices, sizes, reduce_only_bits, post_only_bits,
            metadata, &callbacks
        );

        trigger_matching(market, 2);
        order_id
    }

    /// Place a TWAP (Time-Weighted Average Price) order
    ///
    /// Splits large orders over time to minimize market impact
    /// Parameters:
    /// - total_size: Total size to execute
    /// - interval_seconds: Time between sub-orders
    /// - num_intervals: Number of sub-orders
    public fun place_twap_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        total_size: u64,
        is_buy: bool,
        reduce_only: bool,
        client_order_id: option::Option<string::String>,
        interval_seconds: u64,
        num_intervals: u64,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): order_book_types::OrderIdType
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(user));

        async_matching_engine::place_twap_order(
            market, user, total_size, is_buy, reduce_only, client_order_id,
            interval_seconds, num_intervals, builder_code
        )
    }

    // ============================================================================
    // TP/SL ORDER MANAGEMENT
    // ============================================================================

    /// Place take-profit and/or stop-loss orders for existing position
    ///
    /// Returns order IDs for both TP and SL (if placed)
    public fun place_tp_sl_order_for_position(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        tp_trigger_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        tp_limit_price: option::Option<u64>,
        sl_trigger_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        sl_limit_price: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): (option::Option<order_book_types::OrderIdType>, option::Option<order_book_types::OrderIdType>)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::assert_user_initialized(signer::address_of(user));

        // Must have a position
        let user_addr = signer::address_of(user);
        assert!(get_position_size(user_addr, market) > 0, 25);

        // At least one of TP or SL must be specified
        assert!(option::is_some(&tp_trigger_price) || option::is_some(&sl_trigger_price), 6);

        // Validate builder code if provided
        if (option::is_some(&builder_code)) {
            let code = option::destroy_some(builder_code);
            builder_code_registry::validate_builder_code(user_addr, &code);
        };

        let tp_order_id = process_tp_sl_order(market, user_addr, tp_trigger_price, tp_size, tp_limit_price, true, builder_code);
        let sl_order_id = process_tp_sl_order(market, user_addr, sl_trigger_price, sl_size, sl_limit_price, false, builder_code);

        (tp_order_id, sl_order_id)
    }

    /// Internal helper to process single TP or SL order
    fun process_tp_sl_order(
        market: object::Object<perp_market::PerpMarket>,
        user: address,
        trigger_price: option::Option<u64>,
        size: option::Option<u64>,
        limit_price: option::Option<u64>,
        is_tp: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    ): option::Option<order_book_types::OrderIdType> {
        if (!option::is_some(&trigger_price)) {
            // No TP/SL - ensure size and limit are also none
            assert!(option::is_none(&size), 6);
            assert!(option::is_none(&limit_price), 6);
            return option::none()
        };

        let trigger = option::destroy_some(trigger_price);
        let order_id = tp_sl_utils::place_tp_sl_order_for_position_internal(
            market, user, trigger, size, limit_price, is_tp,
            option::none(), builder_code, true, false
        );
        option::some(order_id)
    }

    /// Cancel a TP/SL order
    public fun cancel_tp_sl_order_for_position(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        order_id: order_book_types::OrderIdType
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        position_tp_sl::cancel_tp_sl(signer::address_of(user), market, order_id);
    }

    // ============================================================================
    // ORDER CANCELLATION
    // ============================================================================

    /// Cancel a single order by ID
    public fun cancel_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        order_id: order_book_types::OrderIdType
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        let user_addr = signer::address_of(user);
        let reason = market_types::order_cancellation_reason_cancelled_by_user();
        let reason_text = string::utf8(b"");
        let callbacks = clearinghouse_perp::market_callbacks(market);

        perp_market::cancel_order(market, user_addr, order_id, true, reason, reason_text, &callbacks);
        async_matching_engine::trigger_matching(market, 5);
    }

    /// Cancel multiple orders by ID
    public fun cancel_orders(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        order_ids: vector<order_book_types::OrderIdType>
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        vector::reverse(&mut order_ids);
        let len = vector::length(&order_ids);

        while (len > 0) {
            let order_id = vector::pop_back(&mut order_ids);
            let user_addr = signer::address_of(user);
            let reason = market_types::order_cancellation_reason_cancelled_by_user();
            let reason_text = string::utf8(b"");
            let callbacks = clearinghouse_perp::market_callbacks(market);

            perp_market::cancel_order(market, user_addr, order_id, true, reason, reason_text, &callbacks);
            len = len - 1;
        };

        vector::destroy_empty(order_ids);
        async_matching_engine::trigger_matching(market, 5);
    }

    /// Cancel an order by client order ID
    public fun cancel_client_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        client_order_id: string::String
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let callbacks = clearinghouse_perp::market_callbacks(market);
        perp_market::cancel_client_order(market, user, client_order_id, &callbacks);
        async_matching_engine::trigger_matching(market, 5);
    }

    /// Cancel a TWAP order
    public fun cancel_twap_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer,
        order_id: order_book_types::OrderIdType
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::cancel_twap_order(market, user, order_id);
    }

    /// Cancel all bulk orders for user
    public fun cancel_bulk_order(
        market: object::Object<perp_market::PerpMarket>,
        user: &signer
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        let callbacks = clearinghouse_perp::market_callbacks(market);
        perp_market::cancel_bulk_order(market, user, &callbacks);
    }

    // ============================================================================
    // ORDER UPDATES
    // ============================================================================

    /// Update an existing order (cancel + replace)
    public fun update_order(
        user: &signer,
        old_order_id: order_book_types::OrderIdType,
        market: object::Object<perp_market::PerpMarket>,
        new_price: u64,
        new_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        reduce_only: bool,
        tp_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        sl_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        // Cancel old order
        let user_addr = signer::address_of(user);
        let reason = market_types::order_cancellation_reason_cancelled_by_user();
        let reason_text = string::utf8(b"");
        let callbacks = clearinghouse_perp::market_callbacks(market);
        perp_market::cancel_order(market, user_addr, old_order_id, true, reason, reason_text, &callbacks);

        // Place new order
        place_order(market, user, new_price, new_size, is_buy, time_in_force, reduce_only,
            option::none(), option::none(), tp_price, tp_size, sl_price, sl_size, builder_code);
    }

    /// Update order by client order ID
    public fun update_client_order(
        user: &signer,
        client_order_id: string::String,
        market: object::Object<perp_market::PerpMarket>,
        new_price: u64,
        new_size: u64,
        is_buy: bool,
        time_in_force: order_book_types::TimeInForce,
        reduce_only: bool,
        tp_price: option::Option<u64>,
        tp_size: option::Option<u64>,
        sl_price: option::Option<u64>,
        sl_size: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        // Cancel by client ID
        let callbacks = clearinghouse_perp::market_callbacks(market);
        perp_market::cancel_client_order(market, user, client_order_id, &callbacks);

        // Place new order with same client ID
        place_order(market, user, new_price, new_size, is_buy, time_in_force, reduce_only,
            option::some(client_order_id), option::none(), tp_price, tp_size, sl_price, sl_size, builder_code);
    }

    // ============================================================================
    // MATCHING ENGINE
    // ============================================================================

    /// Trigger order matching for a market
    ///
    /// Called after order placement or price updates
    friend fun trigger_matching(market: object::Object<perp_market::PerpMarket>, max_iterations: u32)
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::trigger_matching(market, max_iterations);
    }

    // ============================================================================
    // PRICE MANAGEMENT
    // ============================================================================

    /// Get current oracle price
    public fun get_oracle_price(market: object::Object<perp_market::PerpMarket>): u64 {
        price_management::get_oracle_price(market)
    }

    /// Get current mark price
    public fun get_mark_price(market: object::Object<perp_market::PerpMarket>): u64 {
        price_management::get_mark_price(market)
    }

    /// Get both mark and oracle prices
    public fun get_mark_and_oracle_price(market: object::Object<perp_market::PerpMarket>): (u64, u64) {
        price_management::get_mark_and_oracle_price(market)
    }

    /// Refresh mark price from oracle
    fun refresh_mark_price(
        market: object::Object<perp_market::PerpMarket>,
        input: price_management::MarkPriceRefreshInput
    ) {
        let precision = accounts_collateral::collateral_balance_precision();
        let oracle_price = get_and_check_oracle_price(market, precision);

        let (price_changed, old_price, new_price) = price_management::update_price(market, oracle_price, input);
        if (price_changed) {
            async_matching_engine::schedule_refresh_withdraw_mark_price(market, old_price, new_price);
        };
    }

    /// Get and validate oracle price, handling invalid/stale cases
    friend fun get_and_check_oracle_price(
        market: object::Object<perp_market::PerpMarket>,
        precision: math::Precision
    ): u64 {
        let oracle_data = perp_market_config::get_oracle_data(market, precision);

        // Invalid oracle - set market to reduce-only and use EMA mid price
        if (oracle::is_status_invalid(&oracle_data)) {
            perp_market_config::set_reduce_only(
                market,
                vector::empty(),
                option::some(string::utf8(b"Deviation between sources"))
            );
            return price_management::get_book_mid_ema_px(market)
        };

        // Stale oracle - set market to reduce-only and use book mid price
        if (oracle::is_status_down(&oracle_data)) {
            perp_market_config::set_reduce_only(
                market,
                vector::empty(),
                option::some(string::utf8(b"Oracle stale"))
            );
            return price_management::get_book_mid_px(market)
        };

        oracle::get_price(&oracle_data)
    }

    /// Get internal oracle snapshot for debugging
    public fun get_oracle_internal_snapshot(market: object::Object<perp_market::PerpMarket>): OracleInternalSnapshot {
        let source = perp_market_config::get_oracle_source(market);
        let precision = accounts_collateral::collateral_balance_precision();

        let secondary_price = if (oracle::is_composite(&source)) {
            oracle::get_secondary_oracle_price(&source, precision)
        } else {
            0
        };

        let oracle_type = oracle::get_oracle_type(&source);
        let primary_price = oracle::get_primary_oracle_price(&source, precision);

        OracleInternalSnapshot::V1 {
            oracle_type,
            primary_price,
            secondary_price,
        }
    }

    // ============================================================================
    // PRICE REFRESH + LIQUIDATION + TRIGGER ORDERS
    // ============================================================================

    /// Full refresh cycle: oracle update -> mark price -> liquidate -> trigger orders
    ///
    /// This is the main keeper function called periodically:
    /// 1. Update oracle prices (internal/Chainlink/Pyth)
    /// 2. Refresh mark price
    /// 3. Schedule liquidations for underwater positions
    /// 4. Trigger ADL if needed
    /// 5. Trigger price-based conditional orders (TP/SL)
    /// 6. Trigger TWAP sub-orders
    /// 7. Run matching engine
    friend fun update_oracle_and_mark_price_and_liquidate_and_trigger(
        keeper: &signer,
        market: object::Object<perp_market::PerpMarket>,
        internal_oracle_price: option::Option<u64>,
        chainlink_data: option::Option<vector<u8>>,
        pyth_data: option::Option<vector<u8>>,
        mark_price_input: price_management::MarkPriceRefreshInput,
        liquidatable_users: vector<address>,
        should_trigger_orders: bool
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);

        // Update internal oracle if provided
        if (option::is_some(&internal_oracle_price)) {
            let price = option::destroy_some(internal_oracle_price);
            perp_market_config::update_internal_oracle_price(market, price);
        };

        // Update Chainlink oracle if provided
        if (option::is_some(&chainlink_data)) {
            let data = option::destroy_some(chainlink_data);
            chainlink_state::verify_and_store_single_price(keeper, data);
        };

        // Update Pyth oracle if provided
        if (option::is_some(&pyth_data)) {
            let data = option::destroy_some(pyth_data);
            let price_updates = vector::empty();
            vector::push_back(&mut price_updates, data);
            pyth::update_price_feeds_with_funder(keeper, price_updates);
        };

        // Refresh mark price and trigger liquidations
        refresh_liquidate_and_trigger(market, mark_price_input, liquidatable_users, should_trigger_orders);
    }

    /// Refresh mark price, process liquidations, and trigger orders
    friend fun refresh_liquidate_and_trigger(
        market: object::Object<perp_market::PerpMarket>,
        mark_price_input: price_management::MarkPriceRefreshInput,
        liquidatable_users: vector<address>,
        should_trigger_orders: bool
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        refresh_mark_price(market, mark_price_input);

        // Schedule liquidations
        vector::reverse(&mut liquidatable_users);
        let len = vector::length(&liquidatable_users);
        while (len > 0) {
            let user = vector::pop_back(&mut liquidatable_users);
            async_matching_engine::schedule_liquidation(user, market);
            len = len - 1;
        };
        vector::destroy_empty(liquidatable_users);

        // Add ADL orders if needed
        async_matching_engine::add_adl_to_pending(market);

        // Trigger conditional orders
        if (should_trigger_orders) {
            let mark_price = price_management::get_mark_price(market);
            trigger_position_based_tp_sl(market, mark_price);
            async_matching_engine::trigger_price_based_conditional_orders(market, mark_price);
            async_matching_engine::trigger_twap_orders(market);
            trigger_matching(market, 5);
        };
    }

    /// Trigger TP/SL orders based on current price
    friend fun trigger_position_based_tp_sl(market: object::Object<perp_market::PerpMarket>, mark_price: u64) {
        trigger_position_based_tp_sl_internal(market, mark_price, true);  // Take profits
        trigger_position_based_tp_sl_internal(market, mark_price, false); // Stop losses
    }

    /// Internal implementation for triggering TP/SL orders
    fun trigger_position_based_tp_sl_internal(
        market: object::Object<perp_market::PerpMarket>,
        mark_price: u64,
        is_tp: bool
    ) {
        // Get up to 10 ready TP/SL orders
        let ready_orders = position_tp_sl::take_ready_tp_sl_orders(market, mark_price, is_tp, 10);
        let len = vector::length(&ready_orders);
        let i = 0;

        while (i < len) {
            let order = *vector::borrow(&ready_orders, i);
            let (user, order_id, limit_price_opt, size_opt, builder_code) =
                position_tp_sl_tracker::destroy_pending_request(order);

            // Get position direction (TP/SL is opposite to position)
            let is_buy = !perp_positions::get_position_is_long(user, market);

            // Determine size (use position size if not specified)
            let size = if (option::is_some(&size_opt)) {
                option::destroy_some(size_opt)
            } else {
                perp_positions::get_position_size(user, market)
            };

            if (size == 0) {
                i = i + 1;
                continue
            };

            // Place the order
            if (option::is_some(&limit_price_opt)) {
                // Limit order
                let limit_price = option::destroy_some(limit_price_opt);
                let rounded_price = perp_market_config::round_price_to_ticker(market, limit_price, is_buy);
                perp_market_config::validate_price_and_size_allow_below_min_size(market, rounded_price, size);

                async_matching_engine::place_order(
                    market, user, rounded_price, size, is_buy,
                    order_book_types::good_till_cancelled(), true,
                    option::some(order_id),
                    option::none(), option::none(), option::none(), option::none(),
                    option::none(), option::none(), builder_code
                );
            } else {
                // Market order
                let price = if (is_buy) { 9223372036854775807 } else { 1 };

                async_matching_engine::place_order(
                    market, user, price, size, is_buy,
                    order_book_types::immediate_or_cancel(), true,
                    option::some(order_id),
                    option::none(), option::none(), option::none(), option::none(),
                    option::none(), option::none(), builder_code
                );
            };

            i = i + 1;
        };
    }

    // ============================================================================
    // LIQUIDATION
    // ============================================================================

    /// Schedule liquidation for a position
    friend fun liquidate_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        async_matching_engine::liquidate_position(user, market);
    }

    /// Close position when market is delisted
    friend fun close_delisted_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        assert!(perp_market_config::is_market_delisted(market), 22);
        clearinghouse_perp::close_delisted_position(user, market);
    }

    // ============================================================================
    // POSITION QUERIES
    // ============================================================================

    /// Get position size
    public fun get_position_size(user: address, market: object::Object<perp_market::PerpMarket>): u64 {
        perp_positions::get_position_size(user, market)
    }

    /// Get position direction (long/short)
    public fun get_position_is_long(user: address, market: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::get_position_is_long(user, market)
    }

    /// Check if user has position in market
    public fun has_position(user: address, market: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::has_position(user, market)
    }

    /// Check if position uses isolated margin
    public fun is_position_isolated(user: address, market: object::Object<perp_market::PerpMarket>): bool {
        perp_positions::is_position_isolated(user, market)
    }

    /// Check if position is liquidatable
    public fun is_position_liquidatable(user: address, market: object::Object<perp_market::PerpMarket>): bool {
        accounts_collateral::is_position_liquidatable(user, market, false)
    }

    /// List all positions for a user
    public fun list_positions(user: address): vector<position_view_types::PositionViewInfo> {
        perp_positions::list_positions(user)
    }

    /// View a specific position
    public fun view_position(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): option::Option<position_view_types::PositionViewInfo> {
        perp_positions::view_position(user, market)
    }

    /// Get position status with margin details
    public fun view_position_status(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): perp_positions::AccountStatusDetailed {
        accounts_collateral::position_status(user, market)
    }

    /// Get cross-margin account status
    public fun cross_position_status(user: address): perp_positions::AccountStatusDetailed {
        accounts_collateral::get_cross_position_status(user)
    }

    /// Get position average entry price
    public fun get_position_avg_price(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u64 {
        let entry_sum = perp_positions::get_position_entry_px_times_size_sum(user, market);
        let size = perp_positions::get_position_size(user, market);

        if (size == 0 && entry_sum == 0) {
            return 0
        };

        let size_u128 = size as u128;

        // Round based on direction (conservative)
        if (!perp_positions::get_position_is_long(user, market)) {
            (entry_sum / size_u128) as u64
        } else {
            if (entry_sum == 0 && size_u128 != 0) {
                0
            } else {
                ((entry_sum - 1) / size_u128 + 1) as u64
            }
        }
    }

    /// Get entry price * size sum (for VWAP)
    public fun get_position_entry_price_times_size_sum(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u128 {
        perp_positions::get_position_entry_px_times_size_sum(user, market)
    }

    /// Get unrealized funding cost for position
    public fun get_position_unrealized_funding_cost(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): i64 {
        perp_positions::get_position_unrealized_funding_cost(user, market)
    }

    // ============================================================================
    // USER SETTINGS
    // ============================================================================

    /// Configure leverage and margin mode for a market
    public fun configure_user_settings_for_market(
        user: &signer,
        market: object::Object<perp_market::PerpMarket>,
        is_cross_margin: bool,
        user_leverage: u8
    )
        acquires Global
    {
        assert!(is_exchange_open(), 5);
        perp_positions::configure_user_settings_for_market(user, market, is_cross_margin, user_leverage);
    }

    /// Initialize account status cache (for backstop liquidator)
    public fun init_account_status_cache(user: &signer) {
        let backstop = accounts_collateral::backstop_liquidator();
        assert!(backstop == signer::address_of(user), 26);
        perp_positions::init_account_status_cache(user);
    }

    /// Initialize user if new
    friend fun init_user_if_new(admin: &signer, fee_tracking_addr: address) {
        perp_positions::init_user_if_new(admin, fee_tracking_addr);
    }

    // ============================================================================
    // ACCOUNT QUERIES
    // ============================================================================

    /// Get account collateral balance
    public fun get_account_balance_fungible(user: address): u64 {
        accounts_collateral::get_account_balance_fungible(user)
    }

    /// Get account net asset value (balance + unrealized PnL)
    public fun get_account_net_asset_value_fungible(user: address, apply_haircut: bool): i64 {
        accounts_collateral::get_account_net_asset_value_fungible(user, apply_haircut)
    }

    /// Get isolated position margin
    public fun get_isolated_position_margin(
        user: address,
        market: object::Object<perp_market::PerpMarket>
    ): u64 {
        accounts_collateral::get_isolated_position_margin(user, market)
    }

    /// Get max withdrawable amount
    public fun max_allowed_withdraw_fungible_amount(
        user: address,
        metadata: object::Object<fungible_asset::Metadata>
    ): u64 {
        assert!(accounts_collateral::is_asset_supported(metadata), 9);
        accounts_collateral::max_allowed_withdraw_fungible_amount(user, metadata)
    }

    /// Check if user has any assets or positions
    public fun has_any_assets_or_positions(user: address): bool {
        if (accounts_collateral::has_any_assets_or_positions(user)) {
            return true
        };
        pending_order_tracker::has_any_pending_orders(user)
    }

    // ============================================================================
    // MARKET QUERIES
    // ============================================================================

    /// List all market addresses
    public fun list_markets(): vector<address>
        acquires Global
    {
        let mut result = vector::empty();
        let market_refs = &borrow_global<Global>(@decibel).market_refs;

        if (big_ordered_map::is_empty(market_refs)) {
            return result
        };

        let (first_key, _) = big_ordered_map::borrow_front(market_refs);
        let mut current_key = first_key;

        loop {
            vector::push_back(&mut result, object::object_address(&current_key));

            let next_opt = big_ordered_map::next_key(market_refs, &current_key);
            if (!option::is_some(&next_opt)) {
                break
            };
            current_key = option::destroy_some(next_opt);
        };

        result
    }

    /// Get market mode
    public fun get_market_mode(market: object::Object<perp_market::PerpMarket>): perp_market_config::MarketMode {
        perp_market_config::get_market_mode(market)
    }

    /// Get oracle source configuration
    public fun get_oracle_source(market: object::Object<perp_market::PerpMarket>): oracle::OracleSource {
        perp_market_config::get_oracle_source(market)
    }

    /// Check if market is open
    public fun is_market_open(market: object::Object<perp_market::PerpMarket>): bool {
        perp_market_config::is_open(market)
    }

    /// Get market configuration values
    public fun market_name(market: object::Object<perp_market::PerpMarket>): string::String {
        perp_market_config::get_name(market)
    }

    public fun market_max_leverage(market: object::Object<perp_market::PerpMarket>): u8 {
        perp_market_config::get_max_leverage(market)
    }

    public fun market_sz_decimals(market: object::Object<perp_market::PerpMarket>): u8 {
        perp_market_config::get_sz_decimals(market)
    }

    public fun market_min_size(market: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_min_size(market)
    }

    public fun market_lot_size(market: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_lot_size(market)
    }

    public fun market_ticker_size(market: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_ticker_size(market)
    }

    public fun market_slippage_pcts(market: object::Object<perp_market::PerpMarket>): vector<u64> {
        perp_market_config::get_slippage_pcts(market)
    }

    public fun market_margin_call_fee_pct(market: object::Object<perp_market::PerpMarket>): u64 {
        perp_market_config::get_margin_call_fee_pct(market)
    }

    // ============================================================================
    // OPEN INTEREST
    // ============================================================================

    public fun get_current_open_interest(market: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_current_open_interest(market)
    }

    public fun get_max_notional_open_interest(market: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_notional_open_interest(market)
    }

    public fun get_max_open_interest_delta(market: object::Object<perp_market::PerpMarket>): u64 {
        open_interest_tracker::get_max_open_interest_delta_for_market(market)
    }

    // ============================================================================
    // ORDER QUERIES
    // ============================================================================

    /// Get remaining size for an order
    public fun get_remaining_size_for_order(market: object::Object<perp_market::PerpMarket>, order_id: u128): u64 {
        let typed_id = order_book_types::new_order_id_type(order_id);
        perp_market::get_remaining_size(market, typed_id)
    }

    // ============================================================================
    // COLLATERAL QUERIES
    // ============================================================================

    /// Get primary collateral asset metadata
    public fun primary_asset_metadata(): object::Object<fungible_asset::Metadata> {
        accounts_collateral::primary_asset_metadata()
    }

    /// Check if asset is supported collateral
    public fun is_supported_collateral(metadata: object::Object<fungible_asset::Metadata>): bool {
        accounts_collateral::is_asset_supported(metadata)
    }

    /// Get backstop liquidator address
    public fun backstop_liquidator(): address {
        accounts_collateral::backstop_liquidator()
    }

    /// Get primary store balance
    public fun get_primary_store_balance_in_balance_precision(): u64 {
        accounts_collateral::get_primary_store_balance_in_balance_precision()
    }

    // ============================================================================
    // BACKSTOP LIQUIDATOR PROFIT
    // ============================================================================

    /// Get backstop liquidator PnL for a market
    public fun get_blp_pnl(market: object::Object<perp_market::PerpMarket>): i64 {
        let mark_price = price_management::get_mark_price(market);
        backstop_liquidator_profit_tracker::get_total_pnl(market, mark_price)
    }

    // ============================================================================
    // MARKET REGISTRATION (Admin functions)
    // ============================================================================

    /// Internal market registration with oracle source
    friend fun register_market_internal(
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_open_interest: u64,
        max_leverage: u8,
        enable_async_matching: bool,
        oracle_source: oracle::OracleSource
    ): object::Object<perp_market::PerpMarket>
        acquires Global
    {
        assert!(exists<Global>(@decibel), 3);

        let global = borrow_global_mut<Global>(@decibel);
        let engine_signer = object::generate_signer_for_extending(&global.extend_ref);

        // Create market object
        let seed = bcs::to_bytes(&name);
        let constructor_ref = object::create_named_object(&engine_signer, seed);
        let market_signer = object::generate_signer(&constructor_ref);

        // Register async matching engine
        async_matching_engine::register_market(&market_signer, enable_async_matching);

        // Create order book
        let market_config = market_types::new_market_config(false, true, 5, true, 5);
        let order_book = market_types::new_market<perp_engine_types::OrderMetadata>(
            &engine_signer, &market_signer, market_config
        );
        perp_market::register_market(&market_signer, order_book);

        // Initialize trackers
        adl_tracker::initialize(&market_signer);
        open_interest_tracker::register_open_interest_tracker(&market_signer, max_open_interest);
        perp_market_config::register_market(
            &market_signer, name, sz_decimals, min_size, lot_size, ticker_size, max_leverage, oracle_source
        );
        position_tp_sl_tracker::register_market(&market_signer);

        // Store market reference
        let market = object::object_from_constructor_ref(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);
        big_ordered_map::add(&mut global.market_refs, market, extend_ref);

        // Initialize price management
        let precision = accounts_collateral::collateral_balance_precision();
        let initial_price = get_and_check_oracle_price(market, precision);
        let size_multiplier = perp_market_config::get_size_multiplier(market);
        price_management::register_market(&market_signer, initial_price, size_multiplier, max_leverage);

        // Initialize backstop tracker
        backstop_liquidator_profit_tracker::initialize_market(market);

        // Emit registration event
        event::emit(MarketRegistrationEvent::V1 {
            market,
            name,
            sz_decimals,
            max_leverage,
            max_open_interest,
            min_size,
            lot_size,
            ticker_size,
        });

        market
    }

    /// Register market with internal oracle
    friend fun register_market_with_internal_oracle(
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_open_interest: u64,
        max_leverage: u8,
        enable_async_matching: bool,
        initial_price: u64,
        max_staleness: u64
    )
        acquires Global
    {
        let global = borrow_global<Global>(@decibel);
        let engine_signer = object::generate_signer_for_extending(&global.extend_ref);

        let internal_source = oracle::create_new_internal_oracle_source(&engine_signer, initial_price, max_staleness);
        let oracle_source = oracle::new_single_oracle(internal_source);

        register_market_internal(
            name, sz_decimals, min_size, lot_size, ticker_size,
            max_open_interest, max_leverage, enable_async_matching, oracle_source
        );
    }

    /// Register market with Pyth oracle
    friend fun register_market_with_pyth_oracle(
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_open_interest: u64,
        max_leverage: u8,
        enable_async_matching: bool,
        pyth_price_id: vector<u8>,
        max_staleness: u64,
        max_confidence: u64,
        pyth_decimals: i8
    )
        acquires Global
    {
        let pyth_source = oracle::new_pyth_source(pyth_price_id, max_staleness, max_confidence, pyth_decimals);
        let oracle_source = oracle::new_single_oracle(pyth_source);

        register_market_internal(
            name, sz_decimals, min_size, lot_size, ticker_size,
            max_open_interest, max_leverage, enable_async_matching, oracle_source
        );
    }

    /// Register market with composite oracle (Pyth primary + internal secondary)
    friend fun register_market_with_composite_oracle_primary_pyth(
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_open_interest: u64,
        max_leverage: u8,
        enable_async_matching: bool,
        pyth_price_id: vector<u8>,
        pyth_max_staleness: u64,
        pyth_max_confidence: u64,
        pyth_decimals: i8,
        internal_price: u64,
        internal_max_staleness: u64,
        max_deviation: u64,
        deviation_threshold: u8
    )
        acquires Global
    {
        let global = borrow_global<Global>(@decibel);
        let engine_signer = object::generate_signer_for_extending(&global.extend_ref);

        let pyth_source = oracle::new_pyth_source(
            pyth_price_id, pyth_max_staleness, pyth_max_confidence, pyth_decimals
        );
        let internal_source = oracle::create_new_internal_oracle_source(
            &engine_signer, internal_price, internal_max_staleness
        );
        let oracle_source = oracle::new_composite_oracle(
            pyth_source, internal_source, max_deviation, deviation_threshold
        );

        register_market_internal(
            name, sz_decimals, min_size, lot_size, ticker_size,
            max_open_interest, max_leverage, enable_async_matching, oracle_source
        );
    }

    /// Register market with composite oracle (Chainlink primary + internal secondary)
    friend fun register_market_with_composite_oracle_primary_chainlink(
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_open_interest: u64,
        max_leverage: u8,
        enable_async_matching: bool,
        chainlink_feed_id: vector<u8>,
        chainlink_max_staleness: u64,
        chainlink_decimals: i8,
        internal_price: u64,
        internal_max_staleness: u64,
        max_deviation: u64,
        deviation_threshold: u8
    )
        acquires Global
    {
        let global = borrow_global<Global>(@decibel);
        let engine_signer = object::generate_signer_for_extending(&global.extend_ref);

        let chainlink_source = oracle::new_chainlink_source(
            chainlink_feed_id, chainlink_max_staleness, chainlink_decimals
        );
        let internal_source = oracle::create_new_internal_oracle_source(
            &engine_signer, internal_price, internal_max_staleness
        );
        let oracle_source = oracle::new_composite_oracle(
            chainlink_source, internal_source, max_deviation, deviation_threshold
        );

        register_market_internal(
            name, sz_decimals, min_size, lot_size, ticker_size,
            max_open_interest, max_leverage, enable_async_matching, oracle_source
        );
    }

    // ============================================================================
    // MARKET CONFIGURATION (Admin functions)
    // ============================================================================

    /// Set exchange open/closed
    friend fun set_global_exchange_open(is_open: bool)
        acquires Global
    {
        borrow_global_mut<Global>(@decibel).is_exchange_open = is_open;
    }

    /// Delist a market
    friend fun delist_market(
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) {
        perp_market_config::delist_market(market, reason);
    }

    /// Delist market with specific settlement price
    friend fun delist_market_with_mark_price(
        market: object::Object<perp_market::PerpMarket>,
        settlement_price: u64,
        reason: option::Option<string::String>
    ) {
        perp_market_config::delist_market(market, reason);

        // Update backstop liquidator status cache
        let (old_price, old_index, _, _, _, _) = price_management::get_market_info_for_position_status(market, true);
        price_management::override_mark_price(market, settlement_price);
        let (new_price, new_index, size_mult, haircut, max_lev, _) = price_management::get_market_info_for_position_status(market, true);

        perp_positions::update_account_status_cache_on_price_change(
            accounts_collateral::backstop_liquidator(),
            market, old_price, old_index, new_price, new_index, size_mult, haircut, max_lev
        );
    }

    /// Set market mode
    friend fun set_market_open(market: object::Object<perp_market::PerpMarket>, reason: option::Option<string::String>) {
        perp_market_config::set_open(market, reason);
    }

    friend fun set_market_reduce_only(
        market: object::Object<perp_market::PerpMarket>,
        allowed_users: vector<address>,
        reason: option::Option<string::String>
    ) {
        perp_market_config::set_reduce_only(market, allowed_users, reason);
    }

    friend fun set_market_halted(market: object::Object<perp_market::PerpMarket>, reason: option::Option<string::String>) {
        perp_market_config::halt_market(market, reason);
    }

    friend fun set_market_allowlist_only(
        market: object::Object<perp_market::PerpMarket>,
        allowed_users: vector<address>,
        reason: option::Option<string::String>
    ) {
        perp_market_config::allowlist_only(market, allowed_users, reason);
    }

    /// Set market parameters
    friend fun set_market_max_leverage(market: object::Object<perp_market::PerpMarket>, new_leverage: u8) {
        perp_market_config::set_max_leverage(market, new_leverage);
        price_management::set_max_leverage(market, new_leverage);

        // Emit update event
        event::emit(MarketUpdateEvent::V1 {
            market,
            name: perp_market_config::get_name(market),
            sz_decimals: perp_market_config::get_sz_decimals(market),
            max_leverage: perp_market_config::get_max_leverage(market),
            max_open_interest: open_interest_tracker::get_max_open_interest(market),
            min_size: perp_market_config::get_min_size(market),
            lot_size: perp_market_config::get_lot_size(market),
            ticker_size: perp_market_config::get_ticker_size(market),
        });
    }

    friend fun set_market_open_interest(market: object::Object<perp_market::PerpMarket>, max_oi: u64) {
        open_interest_tracker::set_max_open_interest(market, max_oi);

        event::emit(MarketUpdateEvent::V1 {
            market,
            name: perp_market_config::get_name(market),
            sz_decimals: perp_market_config::get_sz_decimals(market),
            max_leverage: perp_market_config::get_max_leverage(market),
            max_open_interest: open_interest_tracker::get_max_open_interest(market),
            min_size: perp_market_config::get_min_size(market),
            lot_size: perp_market_config::get_lot_size(market),
            ticker_size: perp_market_config::get_ticker_size(market),
        });
    }

    friend fun set_market_notional_open_interest(market: object::Object<perp_market::PerpMarket>, max_notional: u64) {
        open_interest_tracker::set_max_notional_open_interest(market, max_notional);
    }

    friend fun set_market_margin_call_fee_pct(market: object::Object<perp_market::PerpMarket>, fee_pct: u64) {
        assert!(fee_pct < 20000, 24);  // Max 200%
        perp_market_config::set_margin_call_fee_pct(market, fee_pct);
    }

    friend fun set_market_slippage_pcts(market: object::Object<perp_market::PerpMarket>, pcts: vector<u64>) {
        // Validate slippage percentages
        assert!(!vector::is_empty(&pcts), 23);

        let len = vector::length(&pcts);
        let i = 0;
        while (i < len) {
            let pct = *vector::borrow(&pcts, i);
            assert!(pct > 0, 23);
            assert!(pct < 300000, 23);  // Max 3000%

            // Must be increasing
            if (i > 0) {
                assert!(*vector::borrow(&pcts, i - 1) < pct, 23);
            };
            i = i + 1;
        };

        perp_market_config::set_slippage_pcts(market, pcts);
    }

    friend fun set_market_unrealized_pnl_haircut(market: object::Object<perp_market::PerpMarket>, haircut_bps: u64) {
        price_management::set_unrealized_pnl_haircut_bps(market, haircut_bps);
    }

    friend fun set_market_withdrawable_margin_leverage(market: object::Object<perp_market::PerpMarket>, leverage: u8) {
        let max_leverage = perp_market_config::get_max_leverage(market);
        price_management::set_withdrawable_margin_leverage(market, leverage, max_leverage);
    }

    friend fun set_backstop_liquidator_high_watermark(market: object::Object<perp_market::PerpMarket>, watermark: i64) {
        backstop_liquidator_profit_tracker::set_realized_pnl_watermark(market, watermark);
    }

    /// Drain async queue when exchange is closed
    friend fun drain_async_queue(market: object::Object<perp_market::PerpMarket>)
        acquires Global
    {
        // Only allowed when exchange is closed
        assert!(!is_exchange_open(), 4);
        async_matching_engine::drain_async_queue(market);
    }
}
