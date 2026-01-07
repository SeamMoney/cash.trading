/// ============================================================================
/// SPREAD EMA - Exponential Moving Average for Price Spreads
/// ============================================================================
///
/// This module implements an Exponential Moving Average (EMA) for tracking
/// price spread ratios over time. It's used by the price management system
/// to smooth out price observations and calculate mark prices.
///
/// EMA FORMULA:
/// EMA = alpha * current_observation + (1 - alpha) * previous_ema
/// Where alpha = 1 - exp(-time_elapsed / lookback_window)
///
/// RATIO REPRESENTATION:
/// The spread ratio is stored with 12 decimal places (1e12 = 1.0).
/// - A ratio of 1.0 means the observed price equals the oracle price
/// - Ratio > 1.0 means observed price is higher than oracle
/// - Ratio < 1.0 means observed price is lower than oracle
///
/// BOUNDS:
/// - Ratio is clamped between 0.001 (1e9) and 1000.0 (1e15)
/// - Lookback window: 10 seconds to 1 year
///
/// ============================================================================

module decibel::spread_ema {
    use std::error;
    use std::fixed_point32;
    use std::math_fixed;
    use std::option;

    use decibel::decibel_time;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::price_management;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    /// Base ratio (1.0 with 12 decimal places)
    const RATIO_BASE: u64 = 1000000000000;  // 1e12

    /// Minimum ratio (0.001)
    const MIN_RATIO: u64 = 1000000000;  // 1e9

    /// Maximum ratio (1000.0)
    const MAX_RATIO: u128 = 1000000000000000;  // 1e15

    /// Alpha precision (8 decimal places)
    const ALPHA_PRECISION: u64 = 100000000;  // 1e8

    /// Minimum lookback window (10 seconds)
    const MIN_LOOKBACK: u64 = 10;

    /// Maximum lookback window (1 year)
    const MAX_LOOKBACK: u64 = 31536000;

    // ============================================================================
    // CORE STRUCTURE
    // ============================================================================

    /// Exponential Moving Average tracker for price spreads
    struct SpreadEMA has copy, drop, store {
        /// Current EMA of the price ratio (12 decimal places)
        ratio_ema: u64,
        /// Window size for EMA calculation (seconds)
        lookback_window_seconds: u64,
        /// Timestamp of last observation (seconds)
        last_observation_time: u64,
        /// Number of observations recorded
        observation_count: u64,
    }

    // ============================================================================
    // OBSERVATION FUNCTIONS
    // ============================================================================

    /// Add a new observation to the EMA
    ///
    /// # Parameters
    /// - `oracle_price`: The oracle (reference) price
    /// - `observed_price`: The observed market price
    friend fun add_observation(
        ema: &mut SpreadEMA,
        oracle_price: u64,
        observed_price: u64
    ) {
        let current_time = decibel_time::now_seconds();
        add_observation_with_time(ema, oracle_price, observed_price, current_time);
    }

    /// Add a new observation with explicit timestamp
    ///
    /// # Parameters
    /// - `oracle_price`: The oracle (reference) price
    /// - `observed_price`: The observed market price
    /// - `current_time`: Current timestamp in seconds
    ///
    /// # Calculation
    /// 1. Calculate ratio = observed_price / oracle_price (scaled to 12 decimals)
    /// 2. Clamp ratio to [MIN_RATIO, MAX_RATIO]
    /// 3. Calculate alpha based on time elapsed
    /// 4. Update EMA: new_ema = alpha * ratio + (1 - alpha) * old_ema
    friend fun add_observation_with_time(
        ema: &mut SpreadEMA,
        oracle_price: u64,
        observed_price: u64,
        current_time: u64
    ) {
        // Don't update if time hasn't advanced
        if (ema.observation_count > 0 && current_time <= ema.last_observation_time) {
            return
        };

        // Validate prices
        if (!(oracle_price > 0)) {
            abort error::invalid_argument(5)
        };
        if (!(observed_price > 0)) {
            abort error::invalid_argument(5)
        };

        // Calculate ratio: observed_price / oracle_price * RATIO_BASE
        if (oracle_price == 0) {
            abort error::invalid_argument(4)
        };

        let ratio_u128 = (observed_price as u128) * (RATIO_BASE as u128) / (oracle_price as u128);

        // Clamp ratio to bounds
        let ratio = if (ratio_u128 > MAX_RATIO) {
            (MAX_RATIO as u64)
        } else {
            ratio_u128 as u64
        };

        if (ratio < MIN_RATIO) {
            ratio = MIN_RATIO;
        };

        // First observation - just set the ratio directly
        if (ema.observation_count == 0) {
            ema.ratio_ema = ratio;
        } else {
            // Calculate alpha based on time elapsed
            let time_elapsed = current_time - ema.last_observation_time;
            let alpha = calculate_alpha(ema.lookback_window_seconds, time_elapsed);

            // new_ema = alpha * ratio + (1 - alpha) * old_ema
            let alpha_u128 = alpha as u128;
            let ratio_u128 = ratio as u128;
            let weighted_ratio = ((alpha_u128 * ratio_u128) / (ALPHA_PRECISION as u128)) as u64;

            let one_minus_alpha = ALPHA_PRECISION - alpha;
            let old_ema = ema.ratio_ema;
            let weighted_old = ((one_minus_alpha as u128) * (old_ema as u128) / (ALPHA_PRECISION as u128)) as u64;

            ema.ratio_ema = weighted_ratio + weighted_old;
        };

        ema.last_observation_time = current_time;
        ema.observation_count = ema.observation_count + 1;
    }

    /// Calculate EMA smoothing factor (alpha) based on time elapsed
    ///
    /// # Formula
    /// alpha = 1 - exp(-time_elapsed / lookback_window)
    ///
    /// The longer the time elapsed, the higher alpha (more weight on new observation).
    /// If time elapsed > 18x lookback window, alpha = 1 (full weight on new observation).
    fun calculate_alpha(lookback_window: u64, time_elapsed: u64): u64 {
        // If too much time has passed, use full alpha
        let max_time = 18 * lookback_window;
        if (time_elapsed > max_time) {
            return ALPHA_PRECISION
        };

        // alpha = 1 - exp(-time_elapsed / lookback_window)
        // = 1 - (1 / exp(time_elapsed / lookback_window))
        let exp_result = math_fixed::exp(
            fixed_point32::create_from_rational(time_elapsed, lookback_window)
        );

        let one_over_exp = fixed_point32::divide_u64(ALPHA_PRECISION, exp_result);
        ALPHA_PRECISION - one_over_exp
    }

    // ============================================================================
    // GETTER FUNCTIONS
    // ============================================================================

    /// Get estimated price based on oracle price and current EMA ratio
    ///
    /// # Formula
    /// estimated_price = oracle_price * ratio_ema / RATIO_BASE
    ///
    /// # Returns
    /// The smoothed price estimate (rounded with 0.5 adjustment)
    friend fun get_estimated_px(ema: &SpreadEMA, oracle_price: u64): u64 {
        // If no observations, just return oracle price
        if (ema.observation_count == 0) {
            return oracle_price
        };

        // estimated = oracle_price * ratio / RATIO_BASE
        // Add half of RATIO_BASE for rounding
        let ratio = ema.ratio_ema;
        let result = ((oracle_price as u128) * (ratio as u128) + 500000000000u128) / (RATIO_BASE as u128);
        result as u64
    }

    /// Get timestamp of last observation
    friend fun get_last_observation_time(ema: &SpreadEMA): option::Option<u64> {
        if (ema.observation_count > 0) {
            return option::some<u64>(ema.last_observation_time)
        };
        option::none<u64>()
    }

    /// Get the lookback window in seconds
    friend fun get_lookback_window(ema: &SpreadEMA): u64 {
        ema.lookback_window_seconds
    }

    /// Get total observation count
    friend fun get_observation_count(ema: &SpreadEMA): u64 {
        ema.observation_count
    }

    // ============================================================================
    // CONSTRUCTION
    // ============================================================================

    /// Create a new SpreadEMA tracker
    ///
    /// # Parameters
    /// - `lookback_seconds`: The lookback window for the EMA (10 to 31536000 seconds)
    ///
    /// # Returns
    /// A new SpreadEMA initialized with ratio = 1.0
    friend fun new_ema(lookback_seconds: u64): SpreadEMA {
        if (!(lookback_seconds >= MIN_LOOKBACK)) {
            abort error::invalid_argument(1)
        };
        if (!(lookback_seconds <= MAX_LOOKBACK)) {
            abort error::invalid_argument(1)
        };

        SpreadEMA {
            ratio_ema: RATIO_BASE,  // Initialize to 1.0
            lookback_window_seconds: lookback_seconds,
            last_observation_time: 0,
            observation_count: 0,
        }
    }

    /// Update the lookback window
    friend fun update_lookback_window(ema: &mut SpreadEMA, new_lookback: u64) {
        if (!(new_lookback >= MIN_LOOKBACK)) {
            abort error::invalid_argument(1)
        };
        if (!(new_lookback <= MAX_LOOKBACK)) {
            abort error::invalid_argument(1)
        };

        ema.lookback_window_seconds = new_lookback;
    }
}
