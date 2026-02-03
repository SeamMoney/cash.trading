module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::tp_sl_utils {
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::option;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::builder_code_registry;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market_config;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::position_tp_sl;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::price_management;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine;
    enum OrderBasedTpSlEvent has copy, drop, store {
        V1 {
            market: object::Object<perp_market::PerpMarket>,
            parent_order_id: order_book_types::OrderId,
            status: TpSlStatus,
            trigger_price: u64,
            limit_price: option::Option<u64>,
            size: u64,
            is_tp: bool,
        }
    }
    enum TpSlStatus has copy, drop, store {
        INACTIVE,
        ACTIVE,
    }
    public fun get_active_tp_sl_status(): TpSlStatus {
        TpSlStatus::ACTIVE{}
    }
    public fun get_inactive_tp_sl_status(): TpSlStatus {
        TpSlStatus::INACTIVE{}
    }
    friend fun place_tp_sl_order_for_position_internal(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: option::Option<u64>, p4: option::Option<u64>, p5: bool, p6: order_book_types::OrderId, p7: option::Option<builder_code_registry::BuilderCode>, p8: bool, p9: bool): order_book_types::OrderId {
        perp_market_config::validate_price(p0, p2);
        let _v0 = option::is_some<u64>(&p4);
        loop {
            let _v1;
            let _v2;
            if (_v0) {
                _v2 = option::destroy_some<u64>(p4);
                if (option::is_some<u64>(&p3)) {
                    let _v3 = *option::borrow<u64>(&p3);
                    perp_market_config::validate_price_and_size(p0, _v3, _v2, p9)
                } else perp_market_config::validate_size(p0, _v2, p9);
                _v1 = position_tp_sl::get_fixed_sized_tp_sl(p1, p0, p5, p2, p3, p7);
                if (!option::is_some<order_book_types::OrderId>(&_v1)) break
            } else if (option::is_some<u64>(&p3)) {
                let _v4 = *option::borrow<u64>(&p3);
                perp_market_config::validate_price(p0, _v4);
                break
            } else break;
            position_tp_sl::increase_tp_sl_size(p1, p0, p2, p3, p7, _v2, p5);
            return option::destroy_some<order_book_types::OrderId>(_v1)
        };
        position_tp_sl::add_tp_sl(p1, p0, p6, p2, p3, p4, p5, p7, p8);
        p6
    }
    friend fun validate_and_get_child_tp_sl_orders(p0: object::Object<perp_market::PerpMarket>, p1: order_book_types::OrderId, p2: bool, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>): (option::Option<perp_engine_types::ChildTpSlOrder>, option::Option<perp_engine_types::ChildTpSlOrder>) {
        let _v0;
        let _v1;
        let _v2 = price_management::get_mark_price(p0);
        let _v3 = option::is_some<u64>(&p4);
        while (_v3) {
            let _v4 = option::destroy_some<u64>(p4);
            perp_market_config::validate_price(p0, _v4);
            assert!(option::is_some<u64>(&p3), 1);
            if (p2) {
                if (option::destroy_some<u64>(p3) > _v2) break;
                abort 1
            };
            if (option::destroy_some<u64>(p3) < _v2) break;
            abort 1
        };
        let _v5 = option::is_some<u64>(&p6);
        while (_v5) {
            let _v6 = option::destroy_some<u64>(p6);
            perp_market_config::validate_price(p0, _v6);
            assert!(option::is_some<u64>(&p5), 1);
            if (p2) {
                if (option::destroy_some<u64>(p5) < _v2) break;
                abort 1
            };
            if (option::destroy_some<u64>(p5) > _v2) break;
            abort 1
        };
        if (option::is_some<u64>(&p3)) _v1 = option::some<perp_engine_types::ChildTpSlOrder>(perp_engine_types::new_child_tp_sl_order(option::destroy_some<u64>(p3), p4, p1)) else _v1 = option::none<perp_engine_types::ChildTpSlOrder>();
        if (option::is_some<u64>(&p5)) _v0 = option::some<perp_engine_types::ChildTpSlOrder>(perp_engine_types::new_child_tp_sl_order(option::destroy_some<u64>(p5), p6, p1)) else _v0 = option::none<perp_engine_types::ChildTpSlOrder>();
        (_v1, _v0)
    }
}
