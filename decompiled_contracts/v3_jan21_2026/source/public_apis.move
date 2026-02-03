module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::public_apis {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    public entry fun close_delisted_position(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        perp_engine::close_delisted_position(p0, p1);
    }
    public entry fun trigger_matching(p0: object::Object<perp_market::PerpMarket>, p1: u32) {
        let _v0 = work_unit_utils::get_work_units_from_argument(p1);
        perp_engine::trigger_matching(p0, _v0);
    }
    public entry fun liquidate_positions(p0: vector<address>, p1: object::Object<perp_market::PerpMarket>) {
        perp_engine::liquidate_positions(p0, p1);
    }
    public entry fun liquidate_position(p0: address, p1: object::Object<perp_market::PerpMarket>) {
        let _v0 = 0x1::vector::empty<address>();
        0x1::vector::push_back<address>(&mut _v0, p0);
        perp_engine::liquidate_positions(_v0, p1);
    }
}
