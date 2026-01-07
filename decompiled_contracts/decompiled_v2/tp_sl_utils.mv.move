module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market_config;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::price_management;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    struct OrderBasedTpSlEvent has copy, drop, store {
        market: object::Object<perp_market::PerpMarket>,
        parent_order_id: order_book_types::OrderIdType,
        status: TpSlStatus,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        size: u64,
        is_tp: bool,
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
    friend fun place_tp_sl_order_for_position_internal(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: option::Option<u64>, p4: option::Option<u64>, p5: bool, p6: option::Option<order_book_types::OrderIdType>, p7: option::Option<builder_code_registry::BuilderCode>, p8: bool, p9: bool): order_book_types::OrderIdType {
        let _v0;
        perp_market_config::validate_price(p0, p2);
        let _v1 = option::is_some<u64>(&p4);
        'l1: loop {
            let _v2;
            let _v3;
            'l0: loop {
                loop {
                    if (_v1) {
                        _v3 = option::destroy_some<u64>(p4);
                        if (option::is_some<u64>(&p3)) {
                            let _v4 = *option::borrow<u64>(&p3);
                            perp_market_config::validate_price_and_size(p0, _v4, _v3, p9)
                        } else perp_market_config::validate_size(p0, _v3, p9);
                        _v2 = position_tp_sl::get_fixed_sized_tp_sl(p1, p0, p5, p2, p3, p7);
                        if (!option::is_some<order_book_types::OrderIdType>(&_v2)) break;
                        break 'l0
                    };
                    if (!option::is_some<u64>(&p3)) break;
                    let _v5 = *option::borrow<u64>(&p3);
                    perp_market_config::validate_price(p0, _v5);
                    break
                };
                if (option::is_none<order_book_types::OrderIdType>(&p6)) {
                    _v0 = order_book_types::next_order_id();
                    break 'l1
                };
                _v0 = option::destroy_some<order_book_types::OrderIdType>(p6);
                break 'l1
            };
            position_tp_sl::increase_tp_sl_size(p1, p0, p2, p3, p7, _v3, p5);
            return option::destroy_some<order_book_types::OrderIdType>(_v2)
        };
        position_tp_sl::add_tp_sl(p1, p0, _v0, p2, p3, p4, p5, p7, p8);
        _v0
    }
    friend fun validate_and_get_child_tp_sl_orders(p0: object::Object<perp_market::PerpMarket>, p1: order_book_types::OrderIdType, p2: bool, p3: option::Option<u64>, p4: option::Option<u64>, p5: option::Option<u64>, p6: option::Option<u64>): (option::Option<perp_engine_types::ChildTpSlOrder>, option::Option<perp_engine_types::ChildTpSlOrder>) {
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
