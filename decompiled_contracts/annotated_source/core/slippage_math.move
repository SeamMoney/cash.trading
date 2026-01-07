/// ============================================================================
/// Module: slippage_math
/// Description: Calculates limit prices with slippage tolerance
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module computes limit prices that account for slippage tolerance.
/// When placing market orders, users specify a slippage tolerance to protect
/// against adverse price movements during execution.
///
/// For BUY orders: limit_price = oracle_price * (1 + slippage_pct)
/// For SELL orders: limit_price = oracle_price * (1 - slippage_pct)
/// ============================================================================

module decibel::slippage_math {
    use aptos_framework::object::{Self, Object};
    use decibel::perp_market::{Self, PerpMarket};
    use decibel::perp_market_config;
    use std::error;

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// Error: Division by zero in slippage calculation
    const E_DIVISION_BY_ZERO: u64 = 4;

    // =========================================================================
    // PUBLIC FUNCTIONS
    // =========================================================================

    /// Computes a limit price adjusted for slippage tolerance
    ///
    /// # Arguments
    /// * `market` - The perpetual market object
    /// * `oracle_price` - Current oracle price (in price decimals)
    /// * `slippage_bps` - Slippage tolerance in basis points (e.g., 50 = 0.5%)
    /// * `slippage_precision` - Precision denominator (e.g., 10000 for bps)
    /// * `is_buy` - True for buy orders, false for sell orders
    ///
    /// # Returns
    /// The adjusted limit price rounded to market's tick size
    ///
    /// # Logic
    /// - For BUYS: price * (precision + slippage) / precision
    ///   (willing to pay MORE than oracle price)
    /// - For SELLS: price * (precision - slippage) / precision
    ///   (willing to receive LESS than oracle price, rounded UP)
    ///
    /// # Example
    /// Oracle price: $91,000, Slippage: 0.5% (50 bps), Precision: 10000
    /// - BUY limit:  $91,000 * 10050 / 10000 = $91,455
    /// - SELL limit: $91,000 * 9950 / 10000  = $90,545
    public fun compute_limit_price_with_slippage(
        market: Object<PerpMarket>,
        oracle_price: u64,
        slippage_bps: u64,
        slippage_precision: u64,
        is_buy: bool
    ): u64 {
        let adjusted_price: u64;

        if (is_buy) {
            // BUY: Add slippage (willing to pay more)
            let numerator = slippage_precision + slippage_bps;
            let denominator = slippage_precision;

            // Check for division by zero
            assert!(denominator != 0, error::invalid_argument(E_DIVISION_BY_ZERO));

            // Use u128 to prevent overflow: price * (precision + slippage) / precision
            let price_u128 = oracle_price as u128;
            let numerator_u128 = numerator as u128;
            let product = price_u128 * numerator_u128;
            let denominator_u128 = denominator as u128;

            adjusted_price = (product / denominator_u128) as u64;
        } else {
            // SELL: Subtract slippage (willing to receive less)
            let adjusted_slippage = slippage_precision - slippage_bps;

            // Check for division by zero
            assert!(slippage_precision != 0, error::invalid_argument(E_DIVISION_BY_ZERO));

            // Use u128 and ceiling division for sells (round up to be conservative)
            let price_u128 = oracle_price as u128;
            let adjusted_u128 = adjusted_slippage as u128;
            let product = price_u128 * adjusted_u128;
            let denominator_u128 = slippage_precision as u128;

            // Ceiling division: if product is 0, result is 0; otherwise (product - 1) / denom + 1
            let result: u128;
            if (product == 0u128) {
                if (denominator_u128 != 0u128) {
                    result = 0u128;
                } else {
                    abort error::invalid_argument(E_DIVISION_BY_ZERO)
                }
            } else {
                result = (product - 1u128) / denominator_u128 + 1u128;
            };

            adjusted_price = result as u64;
        };

        // Round to market's tick size
        // For buys: round DOWN (don't overpay)
        // For sells: round UP (don't undersell) - hence !is_buy
        perp_market_config::round_price_to_ticker(market, adjusted_price, !is_buy)
    }
}
