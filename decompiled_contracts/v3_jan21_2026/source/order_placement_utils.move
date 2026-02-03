module 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::order_placement_utils {
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_engine_types;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::market_types;
    use 0x1::object;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_market;
    use 0x1::vector;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_book_types;
    use 0x1::string;
    use 0x1::option;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::single_order_types;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::perp_order;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::work_unit_utils;
    use 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::clearinghouse_perp;
    use 0xa222ce1227d159edf1fe7b8ae08bcf2eb7d914f374eac8bda409cd68da878a80::order_placement;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::liquidation;
    friend 0xd0b2dd565e0f2020d66d581a938e7766b2163db4b8c63410c17578d32b4e9e88::async_matching_engine;
    fun invoke_callback_actions(p0: vector<perp_engine_types::OrderMatchingActions>, p1: &market_types::MarketClearinghouseCallbacks<perp_engine_types::OrderMetadata, perp_engine_types::OrderMatchingActions>, p2: object::Object<perp_market::PerpMarket>) {
        let _v0 = p0;
        vector::reverse<perp_engine_types::OrderMatchingActions>(&mut _v0);
        let _v1 = _v0;
        let _v2 = vector::length<perp_engine_types::OrderMatchingActions>(&_v1);
        while (_v2 > 0) {
            let _v3 = perp_engine_types::destroy_order_matching_actions(vector::pop_back<perp_engine_types::OrderMatchingActions>(&mut _v1));
            vector::reverse<perp_engine_types::SingleOrderAction>(&mut _v3);
            let _v4 = _v3;
            let _v5 = vector::length<perp_engine_types::SingleOrderAction>(&_v4);
            loop {
                let _v6;
                let _v7;
                if (!(_v5 > 0)) break;
                let _v8 = vector::pop_back<perp_engine_types::SingleOrderAction>(&mut _v4);
                if (perp_engine_types::is_cancel_order_action(&_v8)) {
                    let (_v9,_v10) = perp_engine_types::destroy_cancel_order_action(_v8);
                    _v7 = _v10;
                    _v6 = _v9;
                    let _v11 = market_types::order_cancellation_reason_cancelled_by_user();
                    let _v12 = string::utf8(vector[]);
                    let _v13 = perp_market::try_cancel_order(p2, _v6, _v7, true, _v11, _v12, p1);
                } else if (perp_engine_types::is_reduce_order_size_action(&_v8)) {
                    let (_v14,_v15,_v16) = perp_engine_types::destroy_reduce_order_size_action(_v8);
                    _v7 = _v15;
                    _v6 = _v14;
                    perp_market::decrease_order_size(p2, _v6, _v7, _v16, p1)
                };
                _v5 = _v5 - 1;
                continue
            };
            vector::destroy_empty<perp_engine_types::SingleOrderAction>(_v4);
            _v2 = _v2 - 1;
            continue
        };
        vector::destroy_empty<perp_engine_types::OrderMatchingActions>(_v1);
    }
    friend fun place_order_and_trigger_matching_actions(p0: object::Object<perp_market::PerpMarket>, p1: perp_order::PerpOrderRequestExtendedArgs, p2: u64, p3: perp_engine_types::OrderMetadata, p4: bool, p5: &mut work_unit_utils::WorkUnit): (u64, option::Option<market_types::OrderCancellationReason>, vector<u64>, u32) {
        let _v0 = clearinghouse_perp::market_callbacks(p0);
        let _v1 = perp_order::get_order_id(&p1);
        let _v2 = freeze(p5);
        let _v3 = &_v0;
        let (_v4,_v5,_v6,_v7,_v8,_v9) = order_placement::destroy_order_match_result<perp_engine_types::OrderMatchingActions>(perp_market::place_order_with_order_id(p0, p1, p2, p3, _v2, false, p4, _v3));
        let _v10 = _v9;
        let _v11 = _v8;
        assert!(_v4 == _v1, 2);
        let _v12 = _v10 as u64;
        let _v13 = vector::length<u64>(&_v11);
        assert!(_v12 >= _v13, 1);
        work_unit_utils::consume_order_match_work_units(p5, _v10);
        let _v14 = &_v0;
        invoke_callback_actions(_v7, _v14, p0);
        (_v5, _v6, _v11, _v10)
    }
}
