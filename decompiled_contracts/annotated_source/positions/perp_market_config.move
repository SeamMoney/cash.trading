/// ============================================================================
/// Module: perp_market_config
/// Description: Configuration and state for perpetual markets
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module stores and manages configuration for perpetual futures markets.
/// Each market has its own PerpMarketConfig stored at the market's object address.
///
/// Configuration includes:
/// - Market parameters (name, precision, sizes, leverage)
/// - Oracle source for price feeds
/// - Market mode (open, reduce-only, halted, delisting)
/// - Liquidation parameters (fees, slippage tolerances)
///
/// Market Modes:
/// - Open: Normal trading
/// - ReduceOnly: Only position-closing trades allowed (with allowlist exceptions)
/// - AllowlistOnly: Only allowlisted addresses can trade
/// - Halt: No trading (typically due to oracle issues)
/// - Delisting: Market being wound down
/// ============================================================================

module decibel::perp_market_config {
    use aptos_framework::object;
    use decibel::perp_market;
    use aptos_framework::option;
    use aptos_framework::string;
    use decibel::math;
    use decibel::oracle;
    use aptos_framework::vector;
    use aptos_framework::event;
    use aptos_framework::error;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    friend decibel::trading_fees_manager;
    friend decibel::price_management;
    friend decibel::pending_order_tracker;
    friend decibel::perp_positions;
    friend decibel::position_update;
    friend decibel::backstop_liquidator_profit_tracker;
    friend decibel::tp_sl_utils;
    friend decibel::open_interest_tracker;
    friend decibel::clearinghouse_perp;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;
    friend decibel::admin_apis;
    friend decibel::slippage_math;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Error: Minimum size must be greater than 0
    const E_INVALID_MIN_SIZE: u64 = 1;

    /// Error: Lot size must be greater than 0
    const E_INVALID_LOT_SIZE: u64 = 2;

    /// Error: Ticker size must be greater than 0
    const E_INVALID_TICKER_SIZE: u64 = 3;

    /// Error: Size is below minimum
    const E_SIZE_BELOW_MINIMUM: u64 = 4;

    /// Error: Size not a multiple of lot size
    const E_SIZE_NOT_LOT_MULTIPLE: u64 = 5;

    /// Error: Price not a multiple of ticker size
    const E_PRICE_NOT_TICKER_MULTIPLE: u64 = 6;

    /// Error: Allowlist too large (max 100 addresses)
    const E_ALLOWLIST_TOO_LARGE: u64 = 8;

    /// Error: Price must be greater than 0
    const E_PRICE_ZERO: u64 = 10;

    /// Error: Size must be greater than 0
    const E_SIZE_ZERO: u64 = 11;

    /// Error: Notional value exceeds maximum
    const E_NOTIONAL_OVERFLOW: u64 = 12;

    /// Error: Array lengths don't match
    const E_ARRAY_LENGTH_MISMATCH: u64 = 13;

    /// Slippage and margin call fee scale (1,000,000 = 100%)
    const FEE_SCALE: u64 = 1_000_000;

    // =========================================================================
    // TYPES
    // =========================================================================

    /// Reasons why a market might be halted
    enum MarketHaltReason has copy, drop, store {
        /// Oracle price feed is stale
        OracleStale,
        /// Admin manually halted the market
        AdminOperation,
    }

    /// Liquidation configuration for a market
    struct MarketLiquidationConfig has copy, drop, store {
        /// Margin call fee as percentage of notional (in FEE_SCALE units)
        /// 5000 = 0.5%
        margin_call_fee_pct: u64,
        /// Slippage percentages for different liquidation tiers
        /// Used to calculate liquidation prices with slippage
        slippage_pcts: vector<u64>,
    }

    /// Market operating mode
    enum MarketMode has copy, drop, store {
        /// Normal trading mode - all operations allowed
        Open,
        /// Reduce-only mode - only position-closing trades
        /// Allowlist addresses can still open positions
        ReduceOnly {
            allowlist: vector<address>,
        },
        /// Allowlist-only mode - only specific addresses can trade
        AllowlistOnly {
            allowlist: vector<address>,
        },
        /// Halted - no trading allowed
        Halt {
            halt_reason: MarketHaltReason,
        },
        /// Market being delisted - wind down only
        Delisting,
    }

    /// Event emitted when market status changes
    enum MarketStatusChangeEvent has drop, store {
        V1 {
            /// Market whose status changed
            market: object::Object<perp_market::PerpMarket>,
            /// New market mode
            mode: MarketMode,
            /// Optional reason for the change
            reason: option::Option<string::String>,
        }
    }

    /// Configuration for a perpetual market
    enum PerpMarketConfig has key {
        V1 {
            /// Human-readable market name (e.g., "BTC-PERP")
            name: string::String,
            /// Size precision (decimal places for position sizes)
            sz_precision: math::Precision,
            /// Minimum order size
            min_size: u64,
            /// Lot size (size must be multiple of this)
            lot_size: u64,
            /// Ticker size (price must be multiple of this)
            ticker_size: u64,
            /// Maximum allowed leverage (e.g., 50 for 50x)
            max_leverage: u8,
            /// Current market operating mode
            mode: MarketMode,
            /// Previous market mode (for mode restoration)
            previous_market_mode: option::Option<MarketMode>,
            /// Oracle source for price feed
            oracle_source: oracle::OracleSource,
            /// ADL trigger threshold (triggers auto-deleveraging)
            adl_trigger_threshold: u64,
            /// Liquidation-specific configuration
            liquidation_details: MarketLiquidationConfig,
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MARKET REGISTRATION
    // =========================================================================

    /// Registers a new market configuration
    ///
    /// # Arguments
    /// * `market_signer` - Signer for the market object
    /// * `name` - Market name
    /// * `sz_decimals` - Size decimal precision
    /// * `min_size` - Minimum order size
    /// * `lot_size` - Lot size (size granularity)
    /// * `ticker_size` - Ticker size (price granularity)
    /// * `max_leverage` - Maximum leverage
    /// * `oracle_source` - Oracle configuration
    friend fun register_market(
        market_signer: &signer,
        name: string::String,
        sz_decimals: u8,
        min_size: u64,
        lot_size: u64,
        ticker_size: u64,
        max_leverage: u8,
        oracle_source: oracle::OracleSource
    ) {
        // Validate configuration
        assert!(lot_size > 0, E_INVALID_LOT_SIZE);
        assert!(min_size > 0, E_INVALID_MIN_SIZE);
        assert!(min_size % lot_size == 0, E_INVALID_MIN_SIZE);
        assert!(ticker_size > 0, E_INVALID_TICKER_SIZE);

        let sz_precision = math::new_precision(sz_decimals);
        let mode = MarketMode::Open {};
        let previous_mode = option::none<MarketMode>();
        let liq_config = default_market_liquidation_config();

        let config = PerpMarketConfig::V1 {
            name,
            sz_precision,
            min_size,
            lot_size,
            ticker_size,
            max_leverage,
            mode,
            previous_market_mode: previous_mode,
            oracle_source,
            adl_trigger_threshold: 0,
            liquidation_details: liq_config,
        };

        move_to<PerpMarketConfig>(market_signer, config);
    }

    /// Returns default liquidation configuration
    ///
    /// Default values:
    /// - 0.5% margin call fee
    /// - Slippage tiers: 0.5%, 1%, 1.5%
    friend fun default_market_liquidation_config(): MarketLiquidationConfig {
        MarketLiquidationConfig {
            margin_call_fee_pct: 5000,  // 0.5%
            slippage_pcts: vector[5000, 10000, 15000],  // 0.5%, 1%, 1.5%
        }
    }

    // =========================================================================
    // FRIEND FUNCTIONS - GETTERS
    // =========================================================================

    /// Gets market name
    friend fun get_name(market: object::Object<perp_market::PerpMarket>): string::String
        acquires PerpMarketConfig
    {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).name
    }

    /// Gets size precision struct
    friend fun get_sz_precision(
        market: object::Object<perp_market::PerpMarket>
    ): math::Precision acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).sz_precision
    }

    /// Gets size decimal count
    friend fun get_sz_decimals(
        market: object::Object<perp_market::PerpMarket>
    ): u8 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        math::get_decimals(&borrow_global<PerpMarketConfig>(addr).sz_precision)
    }

    /// Gets size multiplier (10^decimals)
    friend fun get_size_multiplier(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let precision = get_sz_precision(market);
        math::get_decimals_multiplier(&precision)
    }

    /// Gets minimum order size
    friend fun get_min_size(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).min_size
    }

    /// Gets lot size (size granularity)
    friend fun get_lot_size(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).lot_size
    }

    /// Gets ticker size (price granularity)
    friend fun get_ticker_size(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).ticker_size
    }

    /// Gets maximum allowed leverage
    friend fun get_max_leverage(
        market: object::Object<perp_market::PerpMarket>
    ): u8 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).max_leverage
    }

    /// Gets current market mode
    friend fun get_market_mode(
        market: object::Object<perp_market::PerpMarket>
    ): MarketMode acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).mode
    }

    /// Gets oracle source
    friend fun get_oracle_source(
        market: object::Object<perp_market::PerpMarket>
    ): oracle::OracleSource acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).oracle_source
    }

    /// Gets ADL trigger threshold
    friend fun get_adl_trigger_threshold(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&borrow_global<PerpMarketConfig>(addr).adl_trigger_threshold
    }

    /// Gets margin call fee percentage
    friend fun get_margin_call_fee_pct(
        market: object::Object<perp_market::PerpMarket>
    ): u64 acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&(&borrow_global<PerpMarketConfig>(addr).liquidation_details).margin_call_fee_pct
    }

    /// Gets slippage percentages for liquidation
    friend fun get_slippage_pcts(
        market: object::Object<perp_market::PerpMarket>
    ): vector<u64> acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        *&(&borrow_global<PerpMarketConfig>(addr).liquidation_details).slippage_pcts
    }

    /// Gets slippage and margin call fee scale constant
    friend fun get_slippage_and_margin_call_fee_scale(): u64 {
        FEE_SCALE
    }

    // =========================================================================
    // FRIEND FUNCTIONS - SETTERS
    // =========================================================================

    /// Sets maximum leverage
    friend fun set_max_leverage(
        market: object::Object<perp_market::PerpMarket>,
        max_leverage: u8
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);
        config.max_leverage = max_leverage;
    }

    /// Sets ADL trigger threshold
    friend fun set_adl_trigger_threshold(
        market: object::Object<perp_market::PerpMarket>,
        threshold: u64
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);
        config.adl_trigger_threshold = threshold;
    }

    /// Sets margin call fee percentage
    friend fun set_margin_call_fee_pct(
        market: object::Object<perp_market::PerpMarket>,
        fee_pct: u64
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);
        (&mut config.liquidation_details).margin_call_fee_pct = fee_pct;
    }

    /// Sets slippage percentages
    friend fun set_slippage_pcts(
        market: object::Object<perp_market::PerpMarket>,
        slippage_pcts: vector<u64>
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);
        (&mut config.liquidation_details).slippage_pcts = slippage_pcts;
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MARKET MODE
    // =========================================================================

    /// Sets market to open mode
    friend fun set_open(
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        let new_mode = MarketMode::Open {};
        set_market_mode(market, new_mode, reason);
    }

    /// Sets market to reduce-only mode
    friend fun set_reduce_only(
        market: object::Object<perp_market::PerpMarket>,
        allowlist: vector<address>,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        let new_mode = MarketMode::ReduceOnly { allowlist };
        set_market_mode(market, new_mode, reason);
    }

    /// Sets market to allowlist-only mode
    friend fun allowlist_only(
        market: object::Object<perp_market::PerpMarket>,
        allowlist: vector<address>,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        assert!(vector::length<address>(&allowlist) <= 100, E_ALLOWLIST_TOO_LARGE);
        let new_mode = MarketMode::AllowlistOnly { allowlist };
        set_market_mode(market, new_mode, reason);
    }

    /// Halts the market
    friend fun halt_market(
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        let new_mode = MarketMode::Halt {
            halt_reason: MarketHaltReason::AdminOperation {}
        };
        set_market_mode(market, new_mode, reason);
    }

    /// Delists the market
    friend fun delist_market(
        market: object::Object<perp_market::PerpMarket>,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);

        let delisting_mode = MarketMode::Delisting {};
        config.mode = delisting_mode;

        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1 {
            market,
            mode: MarketMode::Delisting {},
            reason,
        });
    }

    /// Internal: Sets market mode with event emission
    fun set_market_mode(
        market: object::Object<perp_market::PerpMarket>,
        new_mode: MarketMode,
        reason: option::Option<string::String>
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);

        // Skip if mode unchanged
        if (&config.mode == &new_mode) {
            return
        };

        config.mode = new_mode;

        event::emit<MarketStatusChangeEvent>(MarketStatusChangeEvent::V1 {
            market,
            mode: new_mode,
            reason,
        });
    }

    // =========================================================================
    // FRIEND FUNCTIONS - MODE CHECKS
    // =========================================================================

    /// Checks if market is open
    friend fun is_open(
        market: object::Object<perp_market::PerpMarket>
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        &borrow_global<PerpMarketConfig>(addr).mode is MarketMode::Open
    }

    /// Checks if market is delisted
    friend fun is_market_delisted(
        market: object::Object<perp_market::PerpMarket>
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        &borrow_global<PerpMarketConfig>(addr).mode is MarketMode::Delisting
    }

    /// Checks if user is in reduce-only mode (can only close positions)
    friend fun is_reduce_only(
        market: object::Object<perp_market::PerpMarket>,
        user: address
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let mode = &borrow_global<PerpMarketConfig>(addr).mode;

        if (mode is MarketMode::Open) { return false };
        if (mode is MarketMode::ReduceOnly) {
            let allowlist = &mode.allowlist;
            // If on allowlist, not reduce-only
            return !vector::contains<address>(allowlist, &user)
        };
        if (mode is MarketMode::AllowlistOnly) { return false };
        if (mode is MarketMode::Halt) { return false };
        if (mode is MarketMode::Delisting) { return false };

        false
    }

    /// Checks if a user can place orders
    friend fun can_place_order(
        market: object::Object<perp_market::PerpMarket>,
        user: address
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let mode = &borrow_global<PerpMarketConfig>(addr).mode;

        if (mode is MarketMode::Open) { return true };
        if (mode is MarketMode::ReduceOnly) { return true };
        if (mode is MarketMode::AllowlistOnly) {
            let allowlist = &mode.allowlist;
            return vector::contains<address>(allowlist, &user)
        };
        if (mode is MarketMode::Halt) { return false };
        if (mode is MarketMode::Delisting) { return false };

        false
    }

    /// Checks if an order can be settled between two parties
    friend fun can_settle_order(
        market: object::Object<perp_market::PerpMarket>,
        maker: address,
        taker: address
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let mode = &borrow_global<PerpMarketConfig>(addr).mode;

        if (mode is MarketMode::Open) { return true };
        if (mode is MarketMode::ReduceOnly) { return true };
        if (mode is MarketMode::AllowlistOnly) {
            let allowlist = &mode.allowlist;
            // Both parties must be on allowlist
            if (!vector::contains<address>(allowlist, &maker)) {
                return vector::contains<address>(allowlist, &taker)
            };
            return true
        };
        if (mode is MarketMode::Halt) { return false };
        if (mode is MarketMode::Delisting) { return false };

        false
    }

    /// Checks if oracle can be updated
    friend fun can_update_oracle(
        market: object::Object<perp_market::PerpMarket>
    ): bool acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let mode = &borrow_global<PerpMarketConfig>(addr).mode;

        if (mode is MarketMode::Open) { return true };
        if (mode is MarketMode::ReduceOnly) { return true };
        if (mode is MarketMode::AllowlistOnly) { return true };
        if (mode is MarketMode::Halt) { return false };
        if (mode is MarketMode::Delisting) { return false };

        false
    }

    // =========================================================================
    // FRIEND FUNCTIONS - ORACLE
    // =========================================================================

    /// Gets oracle data
    friend fun get_oracle_data(
        market: object::Object<perp_market::PerpMarket>,
        precision: math::Precision
    ): oracle::OracleData acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global_mut<PerpMarketConfig>(addr);
        oracle::get_oracle_data(&mut config.oracle_source, precision)
    }

    /// Updates internal oracle price (for testing)
    friend fun update_internal_oracle_price(
        market: object::Object<perp_market::PerpMarket>,
        price: u64
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global<PerpMarketConfig>(addr);
        oracle::update_internal_oracle_price(&config.oracle_source, price);
    }

    // =========================================================================
    // FRIEND FUNCTIONS - PRICE/SIZE UTILITIES
    // =========================================================================

    /// Rounds price to nearest ticker multiple
    ///
    /// # Arguments
    /// * `market` - Market reference
    /// * `price` - Price to round
    /// * `round_up` - True to round up, false to round down
    friend fun round_price_to_ticker(
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        round_up: bool
    ): u64 acquires PerpMarketConfig {
        let ticker_size = get_ticker_size(market);

        let rounded = if (round_up) {
            if (price == 0) {
                if (ticker_size != 0) { 0 }
                else { abort error::invalid_argument(E_SIZE_ZERO) }
            } else {
                (price - 1) / ticker_size + 1
            }
        } else {
            price / ticker_size
        };

        rounded * ticker_size
    }

    // =========================================================================
    // FRIEND FUNCTIONS - VALIDATION
    // =========================================================================

    /// Validates price value
    friend fun validate_price(
        market: object::Object<perp_market::PerpMarket>,
        price: u64
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let ticker_size = *&borrow_global<PerpMarketConfig>(addr).ticker_size;

        assert!(price > 0, E_PRICE_ZERO);
        assert!(price % ticker_size == 0, E_PRICE_NOT_TICKER_MULTIPLE);
    }

    /// Validates size value
    friend fun validate_size(
        market: object::Object<perp_market::PerpMarket>,
        size: u64,
        allow_below_min: bool
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global<PerpMarketConfig>(addr);
        let lot_size = *&config.lot_size;
        let min_size = *&config.min_size;

        assert!(size > 0, E_SIZE_ZERO);
        assert!(size % lot_size == 0, E_SIZE_NOT_LOT_MULTIPLE);

        if (!allow_below_min) {
            assert!(size >= min_size, E_SIZE_BELOW_MINIMUM);
        };
    }

    /// Validates price and size together
    friend fun validate_price_and_size(
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        size: u64,
        allow_below_min_size: bool
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global<PerpMarketConfig>(addr);

        let ticker_size = *&config.ticker_size;
        assert!(price > 0, E_PRICE_ZERO);
        assert!(price % ticker_size == 0, E_PRICE_NOT_TICKER_MULTIPLE);

        let lot_size = *&config.lot_size;
        let min_size = *&config.min_size;
        assert!(size > 0, E_SIZE_ZERO);
        assert!(size % lot_size == 0, E_SIZE_NOT_LOT_MULTIPLE);

        if (!allow_below_min_size) {
            assert!(size >= min_size, E_SIZE_BELOW_MINIMUM);
        };

        // Check notional doesn't overflow
        let price_u128 = price as u128;
        let size_u128 = size as u128;
        let notional = price_u128 * size_u128;
        let decimals_multiplier = math::get_decimals_multiplier(&config.sz_precision) as u128;
        let max_notional = 9223372036854775807u128 * decimals_multiplier;  // i64::MAX * decimals

        assert!(notional <= max_notional, E_NOTIONAL_OVERFLOW);
    }

    /// Validates price and size, allowing below minimum size
    friend fun validate_price_and_size_allow_below_min_size(
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        size: u64
    ) acquires PerpMarketConfig {
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global<PerpMarketConfig>(addr);

        let ticker_size = *&config.ticker_size;
        assert!(price > 0, E_PRICE_ZERO);
        assert!(price % ticker_size == 0, E_PRICE_NOT_TICKER_MULTIPLE);

        let lot_size = *&config.lot_size;
        assert!(size > 0, E_SIZE_ZERO);
        assert!(size % lot_size == 0, E_SIZE_NOT_LOT_MULTIPLE);

        // Check notional doesn't overflow
        let price_u128 = price as u128;
        let size_u128 = size as u128;
        let notional = price_u128 * size_u128;
        let decimals_multiplier = math::get_decimals_multiplier(&config.sz_precision) as u128;
        let max_notional = 9223372036854775807u128 * decimals_multiplier;

        assert!(notional <= max_notional, E_NOTIONAL_OVERFLOW);
    }

    /// Validates arrays of prices and sizes (for bulk orders)
    friend fun validate_array_of_price_and_size(
        market: object::Object<perp_market::PerpMarket>,
        prices: &vector<u64>,
        sizes: &vector<u64>
    ) acquires PerpMarketConfig {
        let price_len = vector::length<u64>(prices);
        let size_len = vector::length<u64>(sizes);
        assert!(price_len == size_len, E_ARRAY_LENGTH_MISMATCH);

        let i = 0u64;
        let addr = object::object_address<perp_market::PerpMarket>(&market);
        let config = borrow_global<PerpMarketConfig>(addr);
        let ticker_size = *&config.ticker_size;
        let lot_size = *&config.lot_size;
        let min_size = *&config.min_size;
        let decimals_multiplier = math::get_decimals_multiplier(&config.sz_precision) as u128;

        while (i < price_len) {
            let price = *vector::borrow<u64>(prices, i);
            let size = *vector::borrow<u64>(sizes, i);

            assert!(price > 0, E_PRICE_ZERO);
            assert!(price % ticker_size == 0, E_PRICE_NOT_TICKER_MULTIPLE);
            assert!(size > 0, E_SIZE_ZERO);
            assert!(size % lot_size == 0, E_SIZE_NOT_LOT_MULTIPLE);
            assert!(size >= min_size, E_SIZE_BELOW_MINIMUM);

            let price_u128 = price as u128;
            let size_u128 = size as u128;
            let notional = price_u128 * size_u128;
            let max_notional = 9223372036854775807u128 * decimals_multiplier;
            assert!(notional <= max_notional, E_NOTIONAL_OVERFLOW);

            i = i + 1;
        };
    }
}
