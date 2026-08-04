/// INTERFACE STUB — `decibel::public_read_api`, the PUBLIC read surface of the perp engine.
///
/// Verified against the live ABI of the current package 0xe7da27…b7f on 2026-07-30:
///   public fun get_mark_price(Object<PerpMarket>): u64          — mark price, px decimals (1e6)
///   public fun get_account_net_asset_value(address): i64        — account NAV in collateral units
///
/// These matter because the same two functions on `perp_engine` are `friend`-visible on the
/// current package, so a strategy module cannot call them there. Every mark-price and NAV read
/// must go through this module. Stubs only; never published.
module decibel::public_read_api {
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;
    use decibel::position_view_types::PositionViewInfo;

    public fun get_mark_price(_market: Object<PerpMarket>): u64 { abort 0 }
    public fun get_account_net_asset_value(_account: address): i64 { abort 0 }

    // ── Position reads ────────────────────────────────────────────────────
    // Added 2026-08-04, each verified present on the live mainnet ABI of
    // 0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06 with these exact
    // signatures. A multi-position vault cannot be written without them: it has to know
    // whether a leg is still open, how large it is, and what holding it is costing.

    /// True when the account holds an open position on this market.
    public fun has_position(
        _account: address,
        _market: Object<PerpMarket>,
    ): bool { abort 0 }

    /// Absolute size of the open position, in the market's size units. 0 when flat.
    public fun get_position_size(
        _account: address,
        _market: Object<PerpMarket>,
    ): u64 { abort 0 }

    /// Full view of one position, or none when flat. Carries the funding accrual.
    public fun view_position(
        _account: address,
        _market: Object<PerpMarket>,
    ): std::option::Option<PositionViewInfo> { abort 0 }

    /// Round a price onto the market's tick grid. `round_up` selects the direction.
    ///
    /// Preferred over arithmetic in our own module: the engine owns the grid, and a
    /// hand-rolled rounder that disagrees with it by one tick produces orders the engine
    /// rejects — silently, as a skipped trade.
    public fun get_market_round_price_to_ticker(
        _market: Object<PerpMarket>,
        _price: u64,
        _round_up: bool,
    ): u64 { abort 0 }

    /// Round a size onto the market's lot grid. `round_up` selects the direction.
    public fun get_market_round_size_to_lot(
        _market: Object<PerpMarket>,
        _size: u64,
        _round_up: bool,
    ): u64 { abort 0 }
}
