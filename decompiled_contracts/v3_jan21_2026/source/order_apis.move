module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_apis {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::string;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    public fun cancel_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer) {
        perp_engine::cancel_bulk_order(p0, p1);
    }
    public fun place_bulk_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: vector<u64>, p4: vector<u64>, p5: vector<u64>, p6: vector<u64>, p7: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId {
        perp_engine::place_bulk_order(p0, p1, p2, p3, p4, p5, p6, p7)
    }
    public fun cancel_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId) {
        perp_engine::cancel_order(p0, p1, p2);
    }
    public fun place_market_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: option::Option<u64>, p7: perp_order::PerpOrderRequestTpSlArgs, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId {
        perp_engine::place_market_order(p0, p1, p2, p3, p4, p5, p6, p7, p8)
    }
    public fun cancel_client_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: string::String) {
        perp_engine::cancel_client_order(p0, p1, p2);
    }
    public fun cancel_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId) {
        perp_engine::cancel_twap_order(p0, p1, p2);
    }
    public fun place_twap_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: u64, p3: bool, p4: bool, p5: option::Option<string::String>, p6: u64, p7: u64, p8: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId {
        perp_engine::place_twap_order(p0, p1, p2, p3, p4, p5, p6, p7, p8)
    }
    public fun cancel_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: order_book_types::OrderId) {
        perp_engine::cancel_tp_sl_order_for_position(p0, p1, p2);
    }
    public fun place_order(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: perp_order::PerpOrderRequestCommonArgs, p3: bool, p4: option::Option<u64>, p5: perp_order::PerpOrderRequestTpSlArgs, p6: option::Option<builder_code_registry::BuilderCode>): order_book_types::OrderId {
        perp_engine::place_order(p0, p1, p2, p3, p4, p5, p6)
    }
    public fun place_tp_sl_order_for_position(p0: object::Object<perp_market::PerpMarket>, p1: &signer, p2: option::Option<u64>, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>, p7: option::Option<u64>, p8: option::Option<builder_code_registry::BuilderCode>): (option::Option<order_book_types::OrderId>, option::Option<order_book_types::OrderId>) {
        let (_v0,_v1) = perp_engine::place_tp_sl_order_for_position(p0, p1, p2, p3, p4, p5, p6, p7, p8);
        (_v0, _v1)
    }
    public fun update_client_order(p0: &signer, p1: string::String, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: perp_order::PerpOrderRequestTpSlArgs, p9: option::Option<builder_code_registry::BuilderCode>) {
        perp_engine::update_client_order(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9);
    }
    public fun update_order(p0: &signer, p1: order_book_types::OrderId, p2: object::Object<perp_market::PerpMarket>, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: bool, p8: perp_order::PerpOrderRequestTpSlArgs, p9: option::Option<builder_code_registry::BuilderCode>) {
        perp_engine::update_order(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9);
    }
}
