/// INTERFACE STUB — `aptos_experimental::order_book_types`. See deps/decibel-interface/Move.toml.
/// Only the surface used by perp_order / dex_accounts is declared. Bodies abort; never published.
module order_book::order_book_types {
    struct TimeInForce has copy, drop, store { v: u8 }
    struct OrderId has copy, drop, store { v: u128 }
    struct TriggerCondition has copy, drop, store { v: u8 }

    public fun immediate_or_cancel(): TimeInForce { abort 0 }
    public fun good_till_cancelled(): TimeInForce { abort 0 }
    public fun post_only(): TimeInForce { abort 0 }
}
