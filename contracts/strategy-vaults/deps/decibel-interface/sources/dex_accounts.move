/// INTERFACE STUB — `decibel::dex_accounts`. The two public functions a strategy module needs:
/// resolve a vault's subaccount handle, and place a perp order on it (delegated).
/// Verified against ~/decibel-security-research/decompiled/dex_accounts.mv.move (lines 584-596).
module decibel::dex_accounts {
    use std::option::Option;
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order::{PerpOrderRequestCommonArgs, PerpOrderRequestTpSlArgs};
    use decibel::builder_code_registry::BuilderCode;
    use order_book::order_book_types::OrderId;

    struct Subaccount has key { v: u8 }

    public fun primary_subaccount_object_public(_owner: address): Object<Subaccount> { abort 0 }

    /// place_perp_order_to_subaccount(signer, subaccount, market, common_args, reduce_only,
    ///   stop_price, tp_sl_args, builder_code) — `public fun` (composable; NOT entry, so absent
    ///   from the on-chain ABI). The delegation check inside authorizes a delegated strategy signer.
    public fun place_perp_order_to_subaccount(
        _trader: &signer,
        _subaccount: Object<Subaccount>,
        _market: Object<PerpMarket>,
        _common: PerpOrderRequestCommonArgs,
        _reduce_only: bool,
        _stop_price: Option<u64>,
        _tpsl: PerpOrderRequestTpSlArgs,
        _builder: Option<BuilderCode>,
    ): OrderId { abort 0 }
}
