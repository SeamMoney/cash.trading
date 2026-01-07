module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::public_apis {
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    public entry fun close_delisted_position(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        perp_engine::close_delisted_position(p0, p1);
    }
    public entry fun liquidate_position(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        perp_engine::liquidate_position(p0, p1);
    }
    public entry fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: u32) {
        perp_engine::trigger_matching(p0, p1);
    }
}
