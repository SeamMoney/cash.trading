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

    public fun get_mark_price(_market: Object<PerpMarket>): u64 { abort 0 }
    public fun get_account_net_asset_value(_account: address): i64 { abort 0 }
}
