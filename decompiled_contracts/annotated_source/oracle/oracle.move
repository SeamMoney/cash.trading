/// ============================================================================
/// ORACLE - Multi-Source Oracle Aggregation
/// ============================================================================
///
/// This module provides a unified interface for fetching prices from multiple
/// oracle sources (Pyth, Chainlink, Internal). It supports both single-source
/// and composite oracle configurations with deviation detection.
///
/// ORACLE SOURCES:
/// - Internal: Protocol-managed price feeds (e.g., for testnet)
/// - Pyth: Pyth Network price feeds with confidence interval validation
/// - Chainlink: Chainlink Data Streams with staleness checks
///
/// COMPOSITE ORACLES:
/// Composite oracles use two sources and implement deviation detection:
/// - Primary source is used when both are healthy and agree
/// - Falls back to secondary if deviation threshold is exceeded
/// - Tracks consecutive deviation count for circuit breaker
///
/// ORACLE STATUS:
/// - Ok: Oracle is healthy and price is valid
/// - Invalid: Deviation threshold exceeded (consecutive count reached)
/// - Down: Both oracles unhealthy or staleness exceeded
///
/// ============================================================================

module decibel::oracle {
    use std::timestamp;

    use decibel::internal_oracle_state;
    use decibel::math;
    use decibel::chainlink_state;

    // External Pyth dependencies
    use pyth::price_identifier;
    use pyth::price;
    use pyth::i64;
    use pyth::pyth;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::perp_market_config;
    friend decibel::collateral_balance_sheet;
    friend decibel::perp_engine;

    // ============================================================================
    // ORACLE SOURCE TYPES
    // ============================================================================

    /// Chainlink oracle source configuration
    struct ChainlinkSource has copy, drop, store {
        /// Chainlink feed identifier
        feed_id: vector<u8>,
        /// Maximum allowed staleness in seconds
        max_staleness_secs: u64,
        /// Decimal rescaling adjustment
        rescale_decimals: i8,
    }

    /// Internal oracle source configuration
    struct InternalSource has copy, drop, store {
        /// Internal source identifier
        source_id: internal_oracle_state::InternalSourceIdentifier,
        /// Maximum allowed staleness in seconds
        max_staleness_secs: u64,
    }

    /// Pyth oracle source configuration
    struct PythSource has copy, drop, store {
        /// Pyth price feed identifier
        price_identifier: price_identifier::PriceIdentifier,
        /// Maximum allowed staleness in seconds
        max_staleness_secs: u64,
        /// Maximum allowed confidence interval
        confidence_interval_threshold: u64,
        /// Decimal rescaling adjustment
        rescale_decimals: i8,
    }

    /// Single oracle source (one of the supported types)
    enum SingleOracleSource has copy, drop, store {
        Internal {
            _0: InternalSource,
        },
        Pyth {
            _0: PythSource,
        },
        Chainlink {
            _0: ChainlinkSource,
        }
    }

    /// Oracle source configuration (single or composite)
    enum OracleSource has copy, drop, store {
        /// Single source oracle
        Single {
            primary: SingleOracleSource,
        },
        /// Composite oracle with deviation detection
        Composite {
            primary: SingleOracleSource,
            secondary: SingleOracleSource,
            /// Maximum deviation between sources (basis points)
            oracles_deviation_bps: u64,
            /// Required consecutive deviations to trigger Invalid status
            consecutive_deviation_count: u8,
            /// Last recorded primary price
            last_primary_price: u64,
            /// Current count of consecutive deviations
            current_deviation_count: u8,
        }
    }

    // ============================================================================
    // ORACLE DATA TYPES
    // ============================================================================

    /// Oracle status indicator
    enum OracleStatus has copy, drop {
        /// Oracle is healthy and price is valid
        Ok,
        /// Deviation threshold exceeded
        Invalid,
        /// Oracle(s) unhealthy or stale
        Down,
    }

    /// Result of an oracle price query
    struct OracleData has copy, drop {
        /// The price value
        price: u64,
        /// Oracle health status
        status: OracleStatus,
    }

    // ============================================================================
    // ORACLE TYPE CONSTANTS
    // ============================================================================
    // Oracle type identifiers:
    // 0 = Internal single
    // 1 = Pyth single
    // 2 = Chainlink single
    // 3 = Composite (Pyth primary, Internal secondary)
    // 4 = Composite (Chainlink primary, Internal secondary)

    // ============================================================================
    // PRICE GETTERS
    // ============================================================================

    /// Get the price from oracle data
    friend fun get_price(data: &OracleData): u64 {
        data.price
    }

    // ============================================================================
    // DEVIATION CALCULATION
    // ============================================================================

    /// Calculate deviation between two prices in basis points
    ///
    /// # Returns
    /// |price1 - price2| * 10000 / price1
    fun calculate_deviation_bps(price1: u64, price2: u64): u64 {
        // Handle zero prices
        if (price1 == 0 || price2 == 0) {
            return 0
        };

        let diff = if (price1 > price2) {
            price1 - price2
        } else {
            price2 - price1
        };

        diff * 10000 / price1
    }

    /// Check if deviation exceeds threshold and handle counter
    ///
    /// # Returns
    /// true if consecutive_deviation_count has been reached
    fun check_and_handle_deviation(
        price1: u64,
        price2: u64,
        threshold_bps: u64,
        current_count: &mut u8,
        max_count: u8
    ): bool {
        if (calculate_deviation_bps(price1, price2) > threshold_bps) {
            *current_count = *current_count + 1u8;
            if (*current_count >= max_count) {
                return true
            };
        } else {
            // Reset counter if deviation is within bounds
            *current_count = 0u8;
        };
        false
    }

    // ============================================================================
    // PYTH PRICE CONVERSION
    // ============================================================================

    /// Convert a Pyth price to u64 with target precision
    ///
    /// Pyth prices use variable exponents, so we need to adjust to our precision.
    fun convert_pyth_price_to_u64(
        pyth_price: price::Price,
        rescale_decimals: i8,
        target_precision: math::Precision
    ): u64 {
        let exponent = price::get_expo(&pyth_price);
        let price_value = price::get_price(&pyth_price);
        let price_u64 = i64::get_magnitude_if_positive(&price_value);

        // Calculate target decimals
        let target_decimals = (math::get_decimals(&target_precision) as i8) + rescale_decimals;

        // Get Pyth exponent as i8
        let pyth_exp_i8 = if (i64::get_is_negative(&exponent)) {
            -(i64::get_magnitude_if_negative(&exponent) as i8)
        } else {
            i64::get_magnitude_if_positive(&exponent) as i8
        };

        // Calculate decimal adjustment
        let adjustment = target_decimals + pyth_exp_i8;

        if (adjustment < 0i8) {
            // Need to divide
            let precision = math::new_precision((-adjustment) as u8);
            let divisor = math::get_decimals_multiplier(&precision);
            price_u64 = price_u64 / divisor;
        } else if (adjustment > 0i8) {
            // Need to multiply
            let precision = math::new_precision(adjustment as u8);
            let multiplier = math::get_decimals_multiplier(&precision);
            price_u64 = price_u64 * multiplier;
        };

        price_u64
    }

    // ============================================================================
    // SOURCE CONSTRUCTORS
    // ============================================================================

    /// Create a new internal oracle source
    friend fun create_new_internal_oracle_source(
        admin: &signer,
        initial_price: u64,
        max_staleness: u64
    ): SingleOracleSource {
        let source_id = internal_oracle_state::create_new_internal_source(admin, initial_price);
        new_internal_source(source_id, max_staleness)
    }

    /// Create an internal source from existing identifier
    friend fun new_internal_source(
        source_id: internal_oracle_state::InternalSourceIdentifier,
        max_staleness: u64
    ): SingleOracleSource {
        SingleOracleSource::Internal {
            _0: InternalSource { source_id, max_staleness_secs: max_staleness }
        }
    }

    /// Create a Chainlink oracle source
    friend fun new_chainlink_source(
        feed_id: vector<u8>,
        max_staleness: u64,
        rescale_decimals: i8
    ): SingleOracleSource {
        chainlink_state::assert_initialized();
        SingleOracleSource::Chainlink {
            _0: ChainlinkSource { feed_id, max_staleness_secs: max_staleness, rescale_decimals }
        }
    }

    /// Create a Pyth oracle source
    friend fun new_pyth_source(
        price_id_bytes: vector<u8>,
        max_staleness: u64,
        confidence_threshold: u64,
        rescale_decimals: i8
    ): SingleOracleSource {
        SingleOracleSource::Pyth {
            _0: PythSource {
                price_identifier: price_identifier::from_byte_vec(price_id_bytes),
                max_staleness_secs: max_staleness,
                confidence_interval_threshold: confidence_threshold,
                rescale_decimals,
            }
        }
    }

    /// Create a single-source oracle
    friend fun new_single_oracle(source: SingleOracleSource): OracleSource {
        OracleSource::Single { primary: source }
    }

    /// Create a composite oracle with deviation detection
    friend fun new_composite_oracle(
        primary: SingleOracleSource,
        secondary: SingleOracleSource,
        deviation_threshold_bps: u64,
        consecutive_count: u8
    ): OracleSource {
        let composite = OracleSource::Composite {
            primary,
            secondary,
            oracles_deviation_bps: deviation_threshold_bps,
            consecutive_deviation_count: consecutive_count,
            last_primary_price: 0,
            current_deviation_count: 0u8,
        };

        // Validate composite type (must be Pyth+Internal or Chainlink+Internal)
        let oracle_type = get_oracle_type(&composite);
        if (oracle_type != 3u8 && oracle_type != 4u8) {
            abort 2  // Invalid composite configuration
        };

        composite
    }

    // ============================================================================
    // ORACLE DATA RETRIEVAL
    // ============================================================================

    /// Get oracle data with status
    ///
    /// Handles both single and composite oracles, checking health and deviation.
    friend fun get_oracle_data(
        oracle: &mut OracleSource,
        precision: math::Precision
    ): OracleData {
        if (oracle is Single) {
            // Single oracle - just check health and get price
            let primary = &mut oracle.primary;
            let price = get_oracle_price(primary, precision);

            let status = if (!is_oracle_healthy(primary)) {
                OracleStatus::Down {}
            } else {
                OracleStatus::Ok {}
            };

            return OracleData { price, status }
        };

        if (oracle is Composite) {
            let primary = &mut oracle.primary;
            let secondary = &mut oracle.secondary;
            let deviation_threshold = &mut oracle.oracles_deviation_bps;
            let max_consecutive = &mut oracle.consecutive_deviation_count;
            let last_price = &mut oracle.last_primary_price;
            let current_count = &mut oracle.current_deviation_count;

            let primary_healthy = is_oracle_healthy(primary);
            let secondary_healthy = is_oracle_healthy(secondary);

            if (primary_healthy && secondary_healthy) {
                // Both healthy - check deviation
                let primary_price = get_oracle_price(primary, precision);
                let secondary_price = get_oracle_price(secondary, precision);

                if (check_and_handle_deviation(
                    primary_price,
                    secondary_price,
                    *deviation_threshold,
                    current_count,
                    *max_consecutive
                )) {
                    // Deviation threshold exceeded
                    return OracleData { price: primary_price, status: OracleStatus::Invalid {} }
                };

                // Prices agree - use primary
                *last_price = primary_price;
                return OracleData { price: primary_price, status: OracleStatus::Ok {} }
            };

            if (!primary_healthy && secondary_healthy) {
                // Primary down, use secondary
                *current_count = 0u8;
                let secondary_price = get_oracle_price(secondary, precision);
                return OracleData { price: secondary_price, status: OracleStatus::Ok {} }
            };

            if (primary_healthy && !secondary_healthy) {
                // Secondary down, use primary
                *current_count = 0u8;
                let primary_price = get_oracle_price(primary, precision);
                *last_price = primary_price;
                return OracleData { price: primary_price, status: OracleStatus::Ok {} }
            };

            // Both down - use last known price with Down status
            return OracleData { price: *last_price, status: OracleStatus::Down {} }
        };

        abort 14566554180833181697  // Unknown oracle type
    }

    /// Get price from a single oracle source
    fun get_oracle_price(source: &SingleOracleSource, precision: math::Precision): u64 {
        if (source is Internal) {
            let internal = &source._0;
            let (price, _timestamp) = internal_oracle_state::get_internal_source_data(&internal.source_id);
            return price
        };

        if (source is Pyth) {
            return pyth_price_with_precision(&source._0, precision)
        };

        if (source is Chainlink) {
            let chainlink = &source._0;
            let decimals = math::get_decimals(&precision);
            return chainlink_state::get_converted_price(
                chainlink.feed_id,
                chainlink.rescale_decimals,
                decimals
            )
        };

        abort 14566554180833181697  // Unknown source type
    }

    /// Get Pyth price with target precision
    fun pyth_price_with_precision(source: &PythSource, precision: math::Precision): u64 {
        let pyth_price = pyth::get_price_unsafe(source.price_identifier);
        convert_pyth_price_to_u64(pyth_price, source.rescale_decimals, precision)
    }

    // ============================================================================
    // HEALTH CHECKS
    // ============================================================================

    /// Check if a single oracle source is healthy
    fun is_oracle_healthy(source: &SingleOracleSource): bool {
        if (source is Internal) {
            return !is_internal_stale(&source._0)
        };

        if (source is Pyth) {
            let pyth = &source._0;
            if (is_pyth_stale(pyth)) {
                return false
            };
            return !is_pyth_confidence_exceeded(pyth)
        };

        if (source is Chainlink) {
            return !is_chainlink_stale(&source._0)
        };

        abort 14566554180833181697  // Unknown source type
    }

    /// Check if internal oracle is stale
    fun is_internal_stale(source: &InternalSource): bool {
        let (_price, update_time) = internal_oracle_state::get_internal_source_data(&source.source_id);
        let elapsed = timestamp::now_seconds() - update_time;
        elapsed > source.max_staleness_secs
    }

    /// Check if Pyth oracle is stale
    fun is_pyth_stale(source: &PythSource): bool {
        let current_time = timestamp::now_seconds();
        let pyth_price = pyth::get_price_unsafe(source.price_identifier);
        let price_time = price::get_timestamp(&pyth_price);
        let elapsed = current_time - price_time;
        elapsed > source.max_staleness_secs
    }

    /// Check if Pyth confidence interval exceeds threshold
    fun is_pyth_confidence_exceeded(source: &PythSource): bool {
        let pyth_price = pyth::get_price_unsafe(source.price_identifier);
        let confidence = price::get_conf(&pyth_price);
        confidence > source.confidence_interval_threshold
    }

    /// Check if Chainlink oracle is stale
    fun is_chainlink_stale(source: &ChainlinkSource): bool {
        let (_price, update_time) = chainlink_state::get_latest_price(source.feed_id);
        let current_time = timestamp::now_seconds();
        let elapsed = current_time - (update_time as u64);
        elapsed > source.max_staleness_secs
    }

    // ============================================================================
    // STATUS CHECKS
    // ============================================================================

    /// Check if oracle is composite type
    friend fun is_composite(oracle: &OracleSource): bool {
        oracle is Composite
    }

    /// Check if status is Down
    friend fun is_status_down(data: &OracleData): bool {
        &data.status is Down
    }

    /// Check if status is Invalid
    friend fun is_status_invalid(data: &OracleData): bool {
        &data.status is Invalid
    }

    /// Check if status is Ok
    friend fun is_status_ok(data: &OracleData): bool {
        &data.status is Ok
    }

    // ============================================================================
    // TYPE IDENTIFICATION
    // ============================================================================

    /// Get oracle type identifier
    ///
    /// # Returns
    /// - 0: Internal single
    /// - 1: Pyth single
    /// - 2: Chainlink single
    /// - 3: Composite (Pyth + Internal)
    /// - 4: Composite (Chainlink + Internal)
    friend fun get_oracle_type(oracle: &OracleSource): u8 {
        if ((oracle is Single) && (&oracle.primary is Internal)) {
            return 0u8
        };
        if ((oracle is Single) && (&oracle.primary is Pyth)) {
            return 1u8
        };
        if ((oracle is Single) && (&oracle.primary is Chainlink)) {
            return 2u8
        };

        if (oracle is Composite) {
            let primary = &oracle.primary;
            let secondary = &oracle.secondary;

            if ((primary is Pyth) && (secondary is Internal)) {
                return 3u8
            };
            if ((primary is Chainlink) && (secondary is Internal)) {
                return 4u8
            };
        };

        abort 2  // Unknown type
    }

    // ============================================================================
    // PUBLIC VIEW FUNCTIONS
    // ============================================================================

    /// Get primary oracle price directly
    public fun get_primary_oracle_price(oracle: &OracleSource, precision: math::Precision): u64 {
        if (oracle is Single) {
            return get_oracle_price(&oracle.primary, precision)
        };
        if (oracle is Composite) {
            return get_oracle_price(&oracle.primary, precision)
        };
        abort 14566554180833181697
    }

    /// Get secondary oracle price (composite only)
    public fun get_secondary_oracle_price(oracle: &OracleSource, precision: math::Precision): u64 {
        assert!(oracle is Composite, 2);
        get_oracle_price(&oracle.secondary, precision)
    }

    // ============================================================================
    // INTERNAL ORACLE UPDATES
    // ============================================================================

    /// Update internal oracle price
    friend fun update_internal_oracle_price(oracle: &OracleSource, new_price: u64) {
        // Find the internal source
        let internal_source: &SingleOracleSource;

        if (oracle is Single) {
            internal_source = &oracle.primary;
            if (internal_source is Internal) {
                internal_oracle_state::update_internal_source_price(
                    &internal_source._0.source_id,
                    new_price
                );
                return
            };
        };

        if (oracle is Composite) {
            internal_source = &oracle.secondary;
            if (internal_source is Internal) {
                internal_oracle_state::update_internal_source_price(
                    &internal_source._0.source_id,
                    new_price
                );
                return
            };
        };

        abort 0  // No internal source found
    }
}
