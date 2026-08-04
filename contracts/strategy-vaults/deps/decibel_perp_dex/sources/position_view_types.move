/// INTERFACE STUB — `decibel::position_view_types`, the read-only view of an open position.
///
/// Verified against the live ABI of the mainnet package
/// 0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06 on 2026-08-04. Every
/// accessor below appears there with exactly this name and signature:
///
///   public fun get_position_info_size(&PositionViewInfo): u64
///   public fun get_position_info_is_long(&PositionViewInfo): bool
///   public fun get_position_info_market(&PositionViewInfo): Object<PerpMarket>
///   public fun get_position_info_avg_acquire_entry_px(&PositionViewInfo): u64
///   public fun get_position_info_user_leverage(&PositionViewInfo): u8
///   public fun get_position_info_is_isolated(&PositionViewInfo): bool
///   public fun get_position_info_unrealized_funding_amount_before_last_update(&PositionViewInfo): i64
///
/// The funding accessor is the one that matters here: it is the only on-chain read that tells a
/// strategy what its open positions are costing to hold. Two accessors on the live ABI are
/// deliberately NOT mirrored — `entry_px_times_size_sum` and `funding_index_at_last_update` —
/// because the latter returns a `price_management::AccumulativeIndex` we would then have to
/// stub, and neither is needed. Stubs only; never published.
module decibel::position_view_types {
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;

    struct PositionViewInfo has copy, drop, store {}

    public fun get_position_info_size(_p: &PositionViewInfo): u64 { abort 0 }
    public fun get_position_info_is_long(_p: &PositionViewInfo): bool { abort 0 }
    public fun get_position_info_market(_p: &PositionViewInfo): Object<PerpMarket> { abort 0 }
    public fun get_position_info_avg_acquire_entry_px(_p: &PositionViewInfo): u64 { abort 0 }
    public fun get_position_info_user_leverage(_p: &PositionViewInfo): u8 { abort 0 }
    public fun get_position_info_is_isolated(_p: &PositionViewInfo): bool { abort 0 }

    /// Funding accrued on this position and not yet settled, in collateral units.
    ///
    /// SIGN CONVENTION: negative means the position OWES funding — value flowing out of the
    /// account. This is the reading the name implies (an amount attributable to the position,
    /// signed by direction of flow) and the one `portfolio_vault` acts on, but it is an
    /// inference from the ABI, not something the ABI states. `scripts/decibel-funding-canary.ts`
    /// confirms it against a real open position, and that check is a release gate for mainnet —
    /// see docs/DEPLOY-SEALED.md. If the convention turns out to be inverted, the effect is that
    /// the funding force-close fires on profitable carry instead of costly carry: bad, but a
    /// bounded, non-custodial failure that closes positions rather than opening them.
    public fun get_position_info_unrealized_funding_amount_before_last_update(
        _p: &PositionViewInfo,
    ): i64 { abort 0 }
}
