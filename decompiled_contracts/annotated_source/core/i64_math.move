/// ============================================================================
/// Module: i64_math
/// Description: Signed 64-bit integer math utilities
/// Contract: 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844
/// ============================================================================
///
/// This module provides friend access for signed integer operations used in:
/// - Price management (mark prices, funding rates)
/// - ADL (Auto-Deleveraging) tracking
/// - Position calculations (PnL can be negative)
/// - Collateral balance tracking (offsets can be negative)
///
/// Note: The actual i64 implementation is likely in a dependency or inline.
/// This module primarily declares friend relationships for access control.
/// ============================================================================

module decibel::i64_math {
    // =========================================================================
    // FRIEND DECLARATIONS
    // =========================================================================
    // These modules are authorized to use signed integer operations

    /// Price management needs signed math for funding rate calculations
    friend decibel::price_management;

    /// ADL tracker uses signed math for profit/loss ranking
    friend decibel::adl_tracker;

    /// Position tracking needs signed math for PnL calculations
    friend decibel::perp_positions;

    /// Position updates involve signed deltas
    friend decibel::position_update;

    /// Backstop liquidator profit can be negative
    friend decibel::backstop_liquidator_profit_tracker;

    /// Account collateral offsets can be negative (unrealized losses)
    friend decibel::accounts_collateral;
}
