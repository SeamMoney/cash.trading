/// ============================================================================
/// Module: public_apis
/// Description: Public entry points for permissionless operations
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module exposes public entry functions that ANYONE can call.
/// These are permissionless operations that benefit the protocol:
///
/// 1. Liquidations - Anyone can liquidate underwater positions for a reward
/// 2. Delisted position closures - Close positions in delisted markets
/// 3. Order matching - Trigger the matching engine to process orders
///
/// These functions are incentivized via rewards (liquidation bonus, gas rebates)
/// to encourage keepers/bots to maintain protocol health.
/// ============================================================================

module decibel::public_apis {
    use aptos_framework::object::{Self, Object};
    use decibel::perp_market::{Self, PerpMarket};
    use decibel::perp_engine;

    // =========================================================================
    // PUBLIC ENTRY FUNCTIONS
    // =========================================================================

    /// Closes a position in a delisted market
    ///
    /// When a market is delisted (removed from trading), existing positions
    /// must be closed at the final settlement price. Anyone can call this
    /// to help clean up positions.
    ///
    /// # Arguments
    /// * `user_address` - Address of the user whose position to close
    /// * `market` - The delisted perpetual market
    ///
    /// # Effects
    /// - Closes the user's position at settlement price
    /// - Settles any remaining PnL
    /// - May release collateral back to user
    ///
    /// # Permissions
    /// Permissionless - anyone can call this for any user
    public entry fun close_delisted_position(
        user_address: address,
        market: Object<PerpMarket>
    ) {
        perp_engine::close_delisted_position(user_address, market);
    }

    /// Liquidates an underwater position
    ///
    /// When a position's margin ratio falls below maintenance margin,
    /// anyone can liquidate it. The liquidator receives a portion of
    /// the remaining margin as a reward.
    ///
    /// # Arguments
    /// * `user_address` - Address of the user to liquidate
    /// * `market` - The perpetual market where position exists
    ///
    /// # Effects
    /// - Closes the underwater position
    /// - Liquidator receives liquidation reward
    /// - Remaining margin (if any) goes to insurance fund
    /// - Protocol takes liquidation fee
    ///
    /// # Requirements
    /// - Position must be below maintenance margin
    /// - Market must not be in special state (paused, etc.)
    ///
    /// # Permissions
    /// Permissionless - anyone can call (MEV opportunity)
    public entry fun liquidate_position(
        user_address: address,
        market: Object<PerpMarket>
    ) {
        perp_engine::liquidate_position(user_address, market);
    }

    /// Triggers the async matching engine
    ///
    /// The matching engine processes pending orders asynchronously.
    /// Keepers/bots call this to advance order matching and earn
    /// gas rebates or other incentives.
    ///
    /// # Arguments
    /// * `market` - The perpetual market to process
    /// * `max_iterations` - Maximum number of matches to process (gas limit)
    ///
    /// # Effects
    /// - Matches pending orders up to max_iterations
    /// - Executes trades, updates positions
    /// - Emits trade events
    ///
    /// # Permissions
    /// Permissionless - anyone can trigger matching
    ///
    /// # Note
    /// Higher max_iterations = more gas but more orders processed
    /// Keepers typically optimize this based on gas prices
    public entry fun trigger_matching(
        market: Object<PerpMarket>,
        max_iterations: u32
    ) {
        perp_engine::trigger_matching(market, max_iterations);
    }
}
