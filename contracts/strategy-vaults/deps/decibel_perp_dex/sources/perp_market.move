/// INTERFACE STUB — `decibel::perp_market`. Only the opaque PerpMarket resource handle is needed
/// (strategy_vault passes it as `Object<PerpMarket>`). Body/layout irrelevant; never published.
module decibel::perp_market {
    struct PerpMarket has key { v: u8 }
}
