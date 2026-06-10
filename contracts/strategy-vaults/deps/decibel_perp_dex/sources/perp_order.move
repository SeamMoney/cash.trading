/// INTERFACE STUB — `decibel::perp_order`. Public constructors used to build a perp order request.
/// Signatures verified against ~/decibel-security-research/decompiled/perp_order.mv.move (lines 97-114).
module decibel::perp_order {
    use std::option::Option;
    use std::string::String;
    use order_book::order_book_types::TimeInForce;

    struct PerpOrderRequestCommonArgs has copy, drop, store { v: u8 }
    struct PerpOrderRequestTpSlArgs has copy, drop, store { v: u8 }

    /// new_order_common_args(price, orig_size, is_buy, time_in_force, client_order_id)
    public fun new_order_common_args(
        _price: u64, _orig_size: u64, _is_buy: bool, _tif: TimeInForce, _client_order_id: Option<String>,
    ): PerpOrderRequestCommonArgs { abort 0 }

    public fun new_empty_order_tp_sl_args(): PerpOrderRequestTpSlArgs { abort 0 }

    public fun new_order_tp_sl_args(
        _tp_trigger: Option<u64>, _tp_limit: Option<u64>, _sl_trigger: Option<u64>, _sl_limit: Option<u64>,
    ): PerpOrderRequestTpSlArgs { abort 0 }
}
