/// ============================================================================
/// LIQUIDATION CONFIG - Liquidation Parameters Configuration
/// ============================================================================
///
/// This module defines the configuration parameters for the liquidation system.
/// It controls the margin thresholds that determine when positions become
/// liquidatable and what margins apply to different liquidation types.
///
/// KEY CONCEPTS:
///
/// 1. MAINTENANCE MARGIN:
///    The minimum equity ratio a position must maintain to avoid liquidation.
///    - Default ratio: 1/2 (50% of initial margin)
///    - If equity falls below this, margin call liquidation is triggered
///
/// 2. BACKSTOP MARGIN:
///    A lower threshold that triggers backstop liquidation when margin call fails.
///    - Default ratio: 1/3 (33% of initial margin)
///    - If equity falls below this, backstop liquidator takes over
///
/// 3. BACKSTOP LIQUIDATOR:
///    A designated account that absorbs positions from bankrupt accounts.
///    This prevents bad debt from accumulating in the system.
///
/// MARGIN CALCULATION:
///
/// For a position with initial margin IM:
/// - Liquidation margin = IM * multiplier / divisor
/// - At 1/2 ratio: liquidation_margin = IM / 2
/// - At 1/3 ratio: backstop_margin = IM / 3
///
/// Example with $1000 position at 10x leverage:
/// - Initial margin = $100
/// - Maintenance margin (1/2) = $50
/// - Backstop margin (1/3) = $33.33
///
/// ============================================================================

module decibel::liquidation_config {
    use std::error;

    // ============================================================================
    // Friend Declarations
    // ============================================================================

    friend decibel::perp_positions;
    friend decibel::position_update;
    friend decibel::accounts_collateral;

    // ============================================================================
    // CORE STRUCTURE
    // ============================================================================

    /// Configuration for liquidation thresholds
    enum LiquidationConfig has drop, store {
        V1 {
            /// Address of the backstop liquidator account
            backstop_liquidator: address,
            /// Numerator for maintenance margin calculation
            maintenance_margin_leverage_multiplier: u64,
            /// Denominator for maintenance margin calculation
            maintenance_margin_leverage_divisor: u64,
            /// Numerator for backstop margin calculation
            backstop_margin_maintenance_multiplier: u64,
            /// Denominator for backstop margin calculation
            backstop_margin_maintenance_divisor: u64,
        }
    }

    // ============================================================================
    // GETTER FUNCTIONS
    // ============================================================================

    /// Get the backstop liquidator address
    friend fun backstop_liquidator(config: &LiquidationConfig): address {
        *&config.backstop_liquidator
    }

    /// Get the maintenance margin multiplier (numerator)
    friend fun maintenance_margin_leverage_multiplier(config: &LiquidationConfig): u64 {
        *&config.maintenance_margin_leverage_multiplier
    }

    /// Get the maintenance margin divisor (denominator)
    friend fun maintenance_margin_leverage_divisor(config: &LiquidationConfig): u64 {
        *&config.maintenance_margin_leverage_divisor
    }

    /// Get the backstop margin multiplier (numerator)
    friend fun backstop_margin_maintenance_multiplier(config: &LiquidationConfig): u64 {
        *&config.backstop_margin_maintenance_multiplier
    }

    /// Get the backstop margin divisor (denominator)
    friend fun backstop_margin_maintenance_divisor(config: &LiquidationConfig): u64 {
        *&config.backstop_margin_maintenance_divisor
    }

    // ============================================================================
    // CONSTRUCTION
    // ============================================================================

    /// Create a new liquidation config with default settings
    ///
    /// # Parameters
    /// - `backstop_liquidator_addr`: Address of the backstop liquidator
    ///
    /// # Default Values
    /// - Maintenance margin ratio: 1/2 (50%)
    /// - Backstop margin ratio: 1/3 (33.33%)
    friend fun new_config(backstop_liquidator_addr: address): LiquidationConfig {
        LiquidationConfig::V1 {
            backstop_liquidator: backstop_liquidator_addr,
            maintenance_margin_leverage_multiplier: 1,
            maintenance_margin_leverage_divisor: 2,
            backstop_margin_maintenance_multiplier: 1,
            backstop_margin_maintenance_divisor: 3,
        }
    }

    // ============================================================================
    // MARGIN CALCULATION
    // ============================================================================

    /// Calculate the liquidation margin for a given initial margin
    ///
    /// # Parameters
    /// - `config`: The liquidation configuration
    /// - `initial_margin`: The initial margin amount
    /// - `is_backstop`: Whether to use backstop margin (true) or maintenance margin (false)
    ///
    /// # Returns
    /// The liquidation margin threshold (rounded up)
    ///
    /// # Calculation
    /// For maintenance: initial_margin * maintenance_multiplier / maintenance_divisor
    /// For backstop: initial_margin * backstop_multiplier / backstop_divisor
    friend fun get_liquidation_margin(
        config: &LiquidationConfig,
        initial_margin: u64,
        is_backstop: bool
    ): u64 {
        if (is_backstop) {
            // Backstop margin calculation
            let multiplier = *&config.backstop_margin_maintenance_multiplier;
            let numerator = initial_margin * multiplier;
            let divisor = *&config.backstop_margin_maintenance_divisor;

            if (numerator == 0) {
                if (divisor != 0) {
                    return 0
                };
                abort error::invalid_argument(4)
            };

            // Round up: (numerator - 1) / divisor + 1
            (numerator - 1) / divisor + 1
        } else {
            // Maintenance margin calculation
            let multiplier = *&config.maintenance_margin_leverage_multiplier;
            let numerator = initial_margin * multiplier;
            let divisor = *&config.maintenance_margin_leverage_divisor;

            if (numerator == 0) {
                if (divisor != 0) {
                    return 0
                };
                abort error::invalid_argument(4)
            };

            // Round up: (numerator - 1) / divisor + 1
            (numerator - 1) / divisor + 1
        }
    }

    /// Calculate the liquidation price for a position
    ///
    /// # Parameters
    /// - `config`: The liquidation configuration
    /// - `entry_price`: The entry price of the position
    /// - `leverage`: The leverage multiplier (as u8)
    /// - `is_backstop`: Whether to use backstop margin (true) or maintenance margin (false)
    ///
    /// # Returns
    /// The price at which liquidation would be triggered (rounded up)
    ///
    /// # Calculation
    /// Similar to margin calculation but scales by leverage
    friend fun get_liquidation_price(
        config: &LiquidationConfig,
        entry_price: u64,
        leverage: u8,
        is_backstop: bool
    ): u64 {
        if (is_backstop) {
            // Backstop liquidation price
            let multiplier = *&config.backstop_margin_maintenance_multiplier;
            let numerator = entry_price * multiplier;
            let leverage_u64 = leverage as u64;
            let divisor = *&config.backstop_margin_maintenance_divisor;
            let scaled_divisor = leverage_u64 * divisor;

            if (numerator == 0) {
                if (scaled_divisor != 0) {
                    return 0
                };
                abort error::invalid_argument(4)
            };

            // Round up
            (numerator - 1) / scaled_divisor + 1
        } else {
            // Maintenance liquidation price
            let multiplier = *&config.maintenance_margin_leverage_multiplier;
            let numerator = entry_price * multiplier;
            let leverage_u64 = leverage as u64;
            let divisor = *&config.maintenance_margin_leverage_divisor;
            let scaled_divisor = leverage_u64 * divisor;

            if (numerator == 0) {
                if (scaled_divisor != 0) {
                    return 0
                };
                abort error::invalid_argument(4)
            };

            // Round up
            (numerator - 1) / scaled_divisor + 1
        }
    }
}
