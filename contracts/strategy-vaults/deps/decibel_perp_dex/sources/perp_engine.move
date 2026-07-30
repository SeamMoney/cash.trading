/// INTERFACE STUB — `decibel::perp_engine`.
///
/// WARNING: on the CURRENT package 0xe7da27…b7f both functions below are `friend`-visible, so a
/// strategy module CANNOT call them (verified 2026-07-30). They were public on the old
/// 0x952535…be9f package. Use `decibel::public_read_api` instead — it exposes both as `public`.
/// This stub is retained so the dependency graph still resolves.
module decibel::perp_engine {
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;

    public fun get_mark_price(_market: Object<PerpMarket>): u64 { abort 0 }
    public fun get_account_net_asset_value(_account: address): i64 { abort 0 }
}
