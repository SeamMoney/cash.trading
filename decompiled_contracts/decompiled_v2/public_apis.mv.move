module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::public_apis {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
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
