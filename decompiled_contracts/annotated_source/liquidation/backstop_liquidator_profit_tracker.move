/// ============================================================================
/// BACKSTOP LIQUIDATOR PROFIT TRACKER - PnL Tracking for ADL Triggers
/// ============================================================================
///
/// This module tracks the profit and loss of the backstop liquidator's positions.
/// When losses exceed a threshold, ADL (Auto-Deleveraging) is triggered to
/// close profitable opposing positions and cover the deficit.
///
/// KEY CONCEPTS:
///
/// 1. BACKSTOP LIQUIDATOR:
///    A system account that absorbs positions from liquidated accounts.
///    It accumulates positions when users' accounts become bankrupt.
///
/// 2. REALIZED PNL:
///    Profit/loss from positions that have been closed.
///    This is actual profit/loss that has been settled.
///
/// 3. UNREALIZED PNL:
///    Profit/loss from open positions based on current mark price.
///    Calculated as: (current_price - avg_entry) * size for longs
///                   (avg_entry - current_price) * size for shorts
///
/// 4. WATERMARK:
///    A reference point for PnL tracking. ADL is triggered when
///    (realized_pnl - watermark + unrealized_pnl) exceeds the threshold.
///
/// 5. ADL TRIGGER:
///    When total losses exceed the ADL trigger threshold, this module
///    calculates the price at which ADL should execute to cover losses.
///
/// POSITION TRACKING:
///
/// The module tracks:
/// - entry_px_times_size_sum: Sum of (entry_price * size) for all positions
/// - liquidation_size: Total size of positions held
/// - is_long: Direction of current net position
///
/// Average entry price = entry_px_times_size_sum / liquidation_size
///
/// ============================================================================

module decibel::backstop_liquidator_profit_tracker {
    use std::signer;
    use std::table;
    use std::object;
    use std::option;

    use decibel::perp_market;
    use decibel::perp_market_config;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::clearinghouse_perp;
    friend decibel::liquidation;
    friend decibel::async_matching_engine;
    friend decibel::perp_engine;

    // ============================================================================
    // ERROR CODES
    // ============================================================================

    /// Module not initialized
    const ENOT_INITIALIZED: u64 = 2;

    // ============================================================================
    // CORE STRUCTURES
    // ============================================================================

    /// Per-market tracking data for backstop liquidator
    struct MarketTrackingData has drop, store {
        /// Realized PnL from closed positions
        realized_pnl: i64,
        /// Watermark for PnL tracking (used for ADL trigger calculation)
        realized_pnl_watermark: i64,
        /// Sum of (entry_price * size) for all open positions
        entry_px_times_size_sum: u128,
        /// Total size of open positions
        liquidation_size: u64,
        /// Direction of current net position
        is_long: bool,
    }

    /// Global tracker storing data for all markets
    enum BackstopLiquidatorProfitTracker has key {
        V1 {
            /// Map of market -> tracking data
            market_data: table::Table<object::Object<perp_market::PerpMarket>, MarketTrackingData>,
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /// Initialize the global profit tracker
    public fun initialize(deployer: &signer) {
        assert!(signer::address_of(deployer) == @decibel, 1);
        let tracker = BackstopLiquidatorProfitTracker::V1 {
            market_data: table::new<object::Object<perp_market::PerpMarket>, MarketTrackingData>(),
        };
        move_to<BackstopLiquidatorProfitTracker>(deployer, tracker);
    }

    /// Initialize tracking for a new market
    friend fun initialize_market(market: object::Object<perp_market::PerpMarket>)
    acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global_mut<BackstopLiquidatorProfitTracker>(@decibel);
        let data = MarketTrackingData {
            realized_pnl: 0i64,
            realized_pnl_watermark: 0i64,
            entry_px_times_size_sum: 0u128,
            liquidation_size: 0,
            is_long: false,
        };
        table::add<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &mut tracker.market_data,
            market,
            data
        );
    }

    // ============================================================================
    // PNL CALCULATION
    // ============================================================================

    /// Calculate PnL for a position
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `entry_px_times_size`: Sum of (entry_price * size)
    /// - `current_price`: Current mark price
    /// - `size`: Position size
    /// - `is_long`: Whether position is long
    ///
    /// # Returns
    /// PnL value (positive for profit, negative for loss)
    fun calculate_pnl(
        market: object::Object<perp_market::PerpMarket>,
        entry_px_times_size: u128,
        current_price: u64,
        size: u64,
        is_long: bool
    ): i64 {
        // Current value = current_price * size
        let size_u128 = size as u128;
        let price_u128 = current_price as u128;
        let current_value = (size_u128 * price_u128) as i128;

        // Entry value = entry_px_times_size (already scaled)
        let entry_value = entry_px_times_size as i128;

        // PnL = (current_value - entry_value) / size_multiplier
        let value_diff = current_value - entry_value;
        let size_multiplier = perp_market_config::get_size_multiplier(market) as i128;
        let pnl = (value_diff / size_multiplier) as i64;

        // For shorts, PnL is inverted
        if (is_long) {
            pnl
        } else {
            -pnl
        }
    }

    /// Handle position netting when position size decreases
    ///
    /// Calculates realized PnL for the closed portion and updates tracker
    fun handle_position_netting(
        market: object::Object<perp_market::PerpMarket>,
        data: &mut MarketTrackingData,
        exit_price: u64,
        size_closed: u64
    ) {
        // Calculate proportional entry value for closed portion
        let total_entry_value = *&data.entry_px_times_size_sum;
        let size_closed_u128 = size_closed as u128;
        let proportion = total_entry_value * size_closed_u128;
        let total_size = (*&data.liquidation_size) as u128;
        let closed_entry_value = proportion / total_size;

        // Calculate realized PnL for this portion
        let is_long = *&data.is_long;
        let pnl = calculate_pnl(market, closed_entry_value, exit_price, size_closed, is_long);

        // Add to realized PnL
        let realized_ref = &mut data.realized_pnl;
        *realized_ref = *realized_ref + pnl;
    }

    // ============================================================================
    // PNL GETTERS
    // ============================================================================

    /// Get realized PnL for a market
    friend fun get_realized_pnl(market: object::Object<perp_market::PerpMarket>): i64
    acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global<BackstopLiquidatorProfitTracker>(@decibel);
        if (!table::contains<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        )) {
            return 0i64
        };

        *&table::borrow<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        ).realized_pnl
    }

    /// Get unrealized PnL for a market at current price
    friend fun get_unrealized_pnl(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64
    ): i64 acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global<BackstopLiquidatorProfitTracker>(@decibel);

        // Check if market has any data
        if (!table::contains<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        )) {
            return 0i64
        };

        let data = table::borrow<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        );

        // No position = no unrealized PnL
        if (*&data.liquidation_size == 0) {
            return 0i64
        };

        // Calculate unrealized PnL
        let entry_sum = *&data.entry_px_times_size_sum;
        let size = *&data.liquidation_size;
        let is_long = *&data.is_long;

        calculate_pnl(market, entry_sum, current_price, size, is_long)
    }

    /// Get total PnL (realized + unrealized)
    friend fun get_total_pnl(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64
    ): i64 acquires BackstopLiquidatorProfitTracker {
        let realized = get_realized_pnl(market);
        let unrealized = get_unrealized_pnl(market, current_price);
        realized + unrealized
    }

    // ============================================================================
    // WATERMARK MANAGEMENT
    // ============================================================================

    /// Set the realized PnL watermark
    ///
    /// The watermark is used as a reference point for ADL trigger calculation.
    /// ADL is triggered based on PnL change since the watermark.
    friend fun set_realized_pnl_watermark(
        market: object::Object<perp_market::PerpMarket>,
        watermark: i64
    ) acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global_mut<BackstopLiquidatorProfitTracker>(@decibel);
        let data = table::borrow_mut<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &mut tracker.market_data,
            market
        );
        let watermark_ref = &mut data.realized_pnl_watermark;
        *watermark_ref = watermark;
    }

    // ============================================================================
    // ADL TRIGGER LOGIC
    // ============================================================================

    /// Check if ADL should be triggered and calculate the execution price
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `current_price`: Current mark price
    /// - `trigger_threshold`: Loss threshold to trigger ADL
    ///
    /// # Returns
    /// Some(adl_price) if ADL should be triggered, None otherwise
    ///
    /// # ADL Trigger Condition
    /// ADL is triggered when:
    /// (realized_pnl - watermark) + unrealized_pnl < -trigger_threshold
    ///
    /// This means the backstop liquidator has accumulated losses beyond
    /// the allowed threshold since the last watermark reset.
    friend fun should_trigger_adl(
        market: object::Object<perp_market::PerpMarket>,
        current_price: u64,
        trigger_threshold: u64
    ): option::Option<u64> acquires BackstopLiquidatorProfitTracker {
        // No ADL with zero threshold
        if (trigger_threshold == 0) {
            return option::none<u64>()
        };

        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);
        let tracker = borrow_global<BackstopLiquidatorProfitTracker>(@decibel);

        // Check if market has data
        if (!table::contains<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        )) {
            return option::none<u64>()
        };

        let data = table::borrow<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &tracker.market_data,
            market
        );

        // No position = no ADL needed
        if (data.liquidation_size == 0) {
            return option::none<u64>()
        };

        // Calculate total PnL since watermark
        let realized = *&data.realized_pnl;
        let watermark = *&data.realized_pnl_watermark;
        let entry_sum = *&data.entry_px_times_size_sum;
        let size = *&data.liquidation_size;
        let is_long = *&data.is_long;

        let unrealized = calculate_pnl(market, entry_sum, current_price, size, is_long);
        let pnl_since_watermark = realized - watermark;
        let total_pnl = pnl_since_watermark + unrealized;

        // Check if losses exceed threshold
        let should_adl: bool;
        if (total_pnl > 0i64) {
            should_adl = true; // Profit, no ADL needed
        } else {
            should_adl = ((-total_pnl) as u64) < trigger_threshold;
        };

        if (should_adl) {
            // No ADL needed
            return option::none<u64>()
        };

        // Calculate ADL price to cover the deficit
        // We need to find a price that makes total PnL = -trigger_threshold
        let size_multiplier = perp_market_config::get_size_multiplier(market);

        // Direction multiplier for calculation
        let direction: i128;
        if (*&data.is_long) {
            direction = -1i128;
        } else {
            direction = 1i128;
        };

        // Target PnL value (at the boundary of threshold)
        let threshold_i64 = trigger_threshold as i64;
        let target_pnl = pnl_since_watermark + threshold_i64;

        // Calculate required value: entry_value + target_pnl * size_multiplier * direction
        let target_pnl_i128 = (target_pnl as i128) * direction;
        let multiplier_i128 = size_multiplier as i128;
        let pnl_scaled = target_pnl_i128 * multiplier_i128;
        let entry_i128 = (*&data.entry_px_times_size_sum) as i128;
        let required_value = pnl_scaled + entry_i128;

        // ADL price = required_value / size
        let size_i128 = (*&data.liquidation_size) as i128;
        let adl_price_i64 = (required_value / size_i128) as i64;

        // Ensure price is at least 1
        let final_price: u64;
        if (adl_price_i64 > 1i64) {
            final_price = adl_price_i64 as u64;
        } else {
            final_price = 1;
        };

        // Adjust price to be at least current price for longs (worse for ADL target)
        // or at most current price for shorts
        let adl_execution_price: u64;
        if (*&data.is_long) {
            // Long backstop position needs to sell, ADL targets are shorts
            // Price should be max(current, calculated) to be worse for shorts
            if (current_price > final_price) {
                adl_execution_price = current_price;
            } else {
                adl_execution_price = final_price;
            };
        } else {
            // Short backstop position needs to buy, ADL targets are longs
            // Price should be min(current, calculated) to be worse for longs
            if (current_price < final_price) {
                adl_execution_price = current_price;
            } else {
                adl_execution_price = final_price;
            };
        };

        // Round to valid tick size
        let is_long_direction = *&data.is_long;
        option::some<u64>(perp_market_config::round_price_to_ticker(
            market,
            adl_execution_price,
            is_long_direction
        ))
    }

    // ============================================================================
    // POSITION TRACKING
    // ============================================================================

    /// Track a position update for the backstop liquidator
    ///
    /// # Parameters
    /// - `market`: The perpetual market
    /// - `price`: Entry/exit price
    /// - `size`: Position size being added/removed
    /// - `is_long`: Direction of the update
    /// - `is_closing`: Whether this is closing (reducing) the position
    friend fun track_position_update(
        market: object::Object<perp_market::PerpMarket>,
        price: u64,
        size: u64,
        is_long: bool,
        is_closing: bool
    ) acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global_mut<BackstopLiquidatorProfitTracker>(@decibel);
        let price_times_size = (price as u128) * (size as u128);

        let data = table::borrow_mut<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &mut tracker.market_data,
            market
        );

        // Check if this is same direction or we have no position
        let same_direction = (*&data.is_long == is_long) || (*&data.liquidation_size == 0);

        if (!same_direction) {
            // Opposite direction - this shouldn't happen in normal operation
            return
        };

        if (!is_closing) {
            // Adding to position
            let entry_ref = &mut data.entry_px_times_size_sum;
            *entry_ref = *entry_ref + price_times_size;

            let size_ref = &mut data.liquidation_size;
            *size_ref = *size_ref + size;

            let long_ref = &mut data.is_long;
            *long_ref = is_long;
        } else {
            // Closing (reducing) position
            let current_size = *&data.liquidation_size;

            if (size > current_size) {
                // Closing more than we have - flip direction
                let remaining_size = size - current_size;

                // First, realize PnL on the full close
                handle_position_netting(market, data, price, current_size);

                // Then start new position in opposite direction
                let new_entry_value = (price as u128) * (remaining_size as u128);
                let entry_ref = &mut data.entry_px_times_size_sum;
                *entry_ref = new_entry_value;

                let size_ref = &mut data.liquidation_size;
                *size_ref = remaining_size;

                let long_ref = &mut data.is_long;
                *long_ref = is_long;
            } else {
                // Partial close
                let remaining_size = *&data.liquidation_size - size;

                // Realize PnL on closed portion
                handle_position_netting(market, data, price, size);

                // Reduce entry value proportionally
                let old_entry = *&data.entry_px_times_size_sum;
                let remaining_u128 = remaining_size as u128;
                let new_entry = old_entry * remaining_u128;
                let old_size = (*&data.liquidation_size) as u128;
                let scaled_entry = new_entry / old_size;

                let entry_ref = &mut data.entry_px_times_size_sum;
                *entry_ref = scaled_entry;

                let size_ref = &mut data.liquidation_size;
                *size_ref = remaining_size;
            };
        };
    }

    /// Track additional profit/loss (e.g., from fees)
    friend fun track_profit(
        market: object::Object<perp_market::PerpMarket>,
        profit: i64
    ) acquires BackstopLiquidatorProfitTracker {
        assert!(exists<BackstopLiquidatorProfitTracker>(@decibel), ENOT_INITIALIZED);

        let tracker = borrow_global_mut<BackstopLiquidatorProfitTracker>(@decibel);
        let data = table::borrow_mut<object::Object<perp_market::PerpMarket>, MarketTrackingData>(
            &mut tracker.market_data,
            market
        );

        let pnl_ref = &mut data.realized_pnl;
        *pnl_ref = *pnl_ref + profit;
    }
}
