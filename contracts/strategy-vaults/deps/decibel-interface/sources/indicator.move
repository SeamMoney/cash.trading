/// INTERFACE STUB — `indicator_launchpad::indicator` (our own already-deployed on-chain TA engine).
/// strategy_vault only needs to advance the indicator and read its signal. The real module computes
/// SMA/EMA/RSI/MACD/BB/… over a sliding price buffer and exposes get_signal (0=neutral,1=buy,2=sell).
module indicator_launchpad::indicator {
    /// Real module declares this `public entry fun`; callable cross-module since it is public.
    public fun push_price(_keeper: &signer, _indicator_addr: address, _price: u64, _ts: u64) { abort 0 }

    #[view]
    public fun get_signal(_indicator_addr: address): u8 { abort 0 }
}
