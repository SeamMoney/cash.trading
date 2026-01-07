/// ============================================================================
/// Module: position_view_types
/// Description: Read-only view types for position data
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module defines read-only view types for position information.
/// These types are used to return position data to external callers
/// without exposing internal mutable state.
///
/// Separation of view types from internal types provides:
/// - Cleaner API boundaries
/// - Protection of internal state
/// - Versioning flexibility
/// ============================================================================

module decibel::position_view_types {
    use aptos_framework::object::{Self, Object};
    use decibel::perp_market::{Self, PerpMarket};

    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================

    /// Only perp_positions can create view info objects
    friend decibel::perp_positions;

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /// Read-only view of a user's position in a market
    ///
    /// # Fields
    /// * `market` - Reference to the perpetual market
    /// * `size` - Position size in market's size decimals
    /// * `is_long` - True if long position, false if short
    /// * `user_leverage` - User's selected leverage (1-40x typically)
    /// * `is_isolated` - True if isolated margin, false if cross margin
    enum PositionViewInfo has drop {
        V1 {
            market: Object<PerpMarket>,    // The market this position is in
            size: u64,                      // Position size (0 = no position)
            is_long: bool,                  // Direction: long (true) or short (false)
            user_leverage: u8,              // Leverage multiplier (e.g., 40)
            is_isolated: bool,              // Margin mode: isolated (true) or cross (false)
        }
    }

    // =========================================================================
    // PUBLIC GETTERS
    // =========================================================================

    /// Returns whether the position uses isolated margin
    ///
    /// # Arguments
    /// * `position_info` - Reference to position view info
    ///
    /// # Returns
    /// True if isolated margin, false if cross margin
    ///
    /// # Margin Modes
    /// - Isolated: Only position's margin at risk, limited loss
    /// - Cross: All account collateral shared, higher capital efficiency
    public fun get_position_info_is_isolated(position_info: &PositionViewInfo): bool {
        position_info.is_isolated
    }

    /// Returns the position direction
    ///
    /// # Arguments
    /// * `position_info` - Reference to position view info
    ///
    /// # Returns
    /// True if long (profit when price rises), false if short
    public fun get_position_info_is_long(position_info: &PositionViewInfo): bool {
        position_info.is_long
    }

    /// Returns the market object for this position
    ///
    /// # Arguments
    /// * `position_info` - Reference to position view info
    ///
    /// # Returns
    /// Object reference to the perpetual market
    public fun get_position_info_market(position_info: &PositionViewInfo): Object<PerpMarket> {
        position_info.market
    }

    /// Returns the position size
    ///
    /// # Arguments
    /// * `position_info` - Reference to position view info
    ///
    /// # Returns
    /// Size in market's decimal precision (0 = no position)
    public fun get_position_info_size(position_info: &PositionViewInfo): u64 {
        position_info.size
    }

    /// Returns the user's selected leverage
    ///
    /// # Arguments
    /// * `position_info` - Reference to position view info
    ///
    /// # Returns
    /// Leverage multiplier (e.g., 40 for 40x)
    public fun get_position_info_user_leverage(position_info: &PositionViewInfo): u8 {
        position_info.user_leverage
    }

    // =========================================================================
    // FRIEND FUNCTIONS
    // =========================================================================

    /// Creates a new position view info (internal use only)
    ///
    /// # Arguments
    /// * `market` - The perpetual market object
    /// * `size` - Position size
    /// * `is_long` - Position direction
    /// * `user_leverage` - Selected leverage
    /// * `is_isolated` - Margin mode
    ///
    /// # Returns
    /// New PositionViewInfo struct
    friend fun new_position_view_info(
        market: Object<PerpMarket>,
        size: u64,
        is_long: bool,
        user_leverage: u8,
        is_isolated: bool
    ): PositionViewInfo {
        PositionViewInfo::V1 {
            market: market,
            size: size,
            is_long: is_long,
            user_leverage: user_leverage,
            is_isolated: is_isolated
        }
    }
}
