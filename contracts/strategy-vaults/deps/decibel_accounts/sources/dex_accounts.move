/// INTERFACE STUB — `decibel::dex_accounts`. The public functions a strategy module needs:
/// resolve a vault's subaccount handle, and place a perp order on it (delegated).
///
/// Verified against the live ABI of the CURRENT package 0xe7da27…b7f on 2026-07-30.
/// IMPORTANT: on the current package `primary_subaccount` and `primary_subaccount_object` are
/// `friend`-visible and therefore NOT callable from our module. The `_public` variants below are
/// the public entry points and are what strategy modules must use. The old 0x952535…be9f package
/// exposed the non-suffixed ones as public, which is why the previous stub compiled against it.
module decibel::dex_accounts {
    use std::option::Option;
    use aptos_framework::object::Object;
    use decibel::perp_market::PerpMarket;
    use decibel::perp_order::{PerpOrderRequestCommonArgs, PerpOrderRequestTpSlArgs};
    use decibel::builder_code_registry::BuilderCode;
    use order_book::order_book_types::OrderId;

    struct Subaccount has key { v: u8 }

    /// friend-visible on the current package — retained only so older callers keep resolving.
    /// Do NOT use from strategy modules; use primary_subaccount_public instead.
    public fun primary_subaccount(_owner: address): address { abort 0 }

    public fun primary_subaccount_object(_owner: address): Object<Subaccount> { abort 0 }

    /// The publicly callable accessors on the current package.
    public fun primary_subaccount_public(_owner: address): address { abort 0 }

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
