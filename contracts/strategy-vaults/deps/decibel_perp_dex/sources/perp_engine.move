/// INTERFACE STUB — `decibel::perp_engine` public reads used by strategy_vault.
/// Verified against the live testnet module ABI (both `public`, callable cross-module):
///   get_mark_price(Object<PerpMarket>): u64        — oracle/mark price (px decimals, e.g. 1e6)
///   get_account_net_asset_value(address): i64      — account NAV in collateral units
module decibel::perp_engine {
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;

    public fun get_mark_price(_market: Object<PerpMarket>): u64 { abort 0 }
    public fun get_account_net_asset_value(_account: address): i64 { abort 0 }
}
