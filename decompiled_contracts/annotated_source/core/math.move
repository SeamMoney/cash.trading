/// ============================================================================
/// Module: math
/// Description: Decimal precision handling and conversion utilities
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module handles decimal precision conversions between different units:
/// - USDC has 6 decimals
/// - Prices typically have 8+ decimals
/// - Position sizes have market-specific decimals
///
/// The Precision struct encapsulates decimals and their 10^decimals multiplier
/// for efficient conversion between different decimal representations.
/// ============================================================================

module decibel::math {
    use std::error;
    use aptos_std::math64;

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    friend decibel::chainlink_state;       // Oracle price conversions
    friend decibel::oracle;                // Price precision handling
    friend decibel::perp_market_config;    // Market decimal config
    friend decibel::collateral_balance_sheet;  // Balance precision
    friend decibel::position_update;       // Position value calculations
    friend decibel::accounts_collateral;   // Collateral conversions
    friend decibel::perp_engine;           // Core engine calculations

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /// Represents decimal precision with pre-computed multiplier
    /// Example: 6 decimals -> multiplier = 1,000,000
    struct Precision has copy, drop, store {
        decimals: u8,           // Number of decimal places (e.g., 6 for USDC)
        multiplier: u64,        // 10^decimals for efficient multiplication
    }

    // =========================================================================
    // CONSTANTS (inferred)
    // =========================================================================

    const E_DIVISION_BY_ZERO: u64 = 4;

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Converts a value from one decimal precision to another
    ///
    /// # Arguments
    /// * `value` - The value to convert
    /// * `from_precision` - Source precision (e.g., 8 decimals)
    /// * `to_precision` - Target precision (e.g., 6 decimals)
    /// * `round_up` - If true, rounds up; otherwise truncates
    ///
    /// # Returns
    /// The converted value in the target precision
    ///
    /// # Example
    /// Converting 1.5 from 8 decimals to 6 decimals:
    /// - Input: 150000000 (1.5 * 10^8)
    /// - Output: 1500000 (1.5 * 10^6)
    friend fun convert_decimals(
        value: u64,
        from_precision: &Precision,
        to_precision: &Precision,
        round_up: bool
    ): u64 {
        let from_decimals = from_precision.decimals;
        let to_decimals = to_precision.decimals;

        // Same precision - no conversion needed
        if (from_decimals == to_decimals) {
            return value
        };

        // Converting to fewer decimals (divide)
        if (from_decimals > to_decimals) {
            let divisor = from_precision.multiplier / to_precision.multiplier;

            if (round_up) {
                // Ceiling division: (value - 1) / divisor + 1
                // Handle zero case to avoid underflow
                if (value == 0) {
                    if (divisor != 0) {
                        return 0
                    };
                    abort error::invalid_argument(E_DIVISION_BY_ZERO)
                };
                return (value - 1) / divisor + 1
            } else {
                // Floor division (truncate)
                return value / divisor
            }
        };

        // Converting to more decimals (multiply)
        let multiplier = to_precision.multiplier / from_precision.multiplier;
        value * multiplier
    }

    /// Returns the number of decimal places
    friend fun get_decimals(precision: &Precision): u8 {
        precision.decimals
    }

    /// Returns the multiplier (10^decimals)
    friend fun get_decimals_multiplier(precision: &Precision): u64 {
        precision.multiplier
    }

    /// Creates a new Precision struct
    ///
    /// # Arguments
    /// * `decimals` - Number of decimal places
    ///
    /// # Returns
    /// Precision struct with computed multiplier
    friend fun new_precision(decimals: u8): Precision {
        let decimals_u64 = decimals as u64;
        let multiplier = math64::pow(10, decimals_u64);
        Precision {
            decimals: decimals,
            multiplier: multiplier
        }
    }
}
