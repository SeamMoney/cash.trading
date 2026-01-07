module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::order_placement_utils {
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine_types;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::market_types;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0x1::vector;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::single_order_types;
    use 0x1::string;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_placement;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::liquidation;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::async_matching_engine;
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
                    let _v11 = perp_market::try_cancel_order(p2, _v6, _v7, true, p1);
                } else if (perp_engine_types::is_reduce_order_size_action(&_v8)) {
                    let (_v12,_v13,_v14) = perp_engine_types::destroy_reduce_order_size_action(_v8);
                    _v7 = _v13;
                    _v6 = _v12;
                    perp_market::decrease_order_size(p2, _v6, _v7, _v14, p1)
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
    friend fun place_order_and_trigger_matching_actions(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: u64, p3: u64, p4: u64, p5: bool, p6: order_book_types::TimeInForce, p7: option::Option<order_book_types::TriggerCondition>, p8: perp_engine_types::OrderMetadata, p9: order_book_types::OrderIdType, p10: option::Option<string::String>, p11: bool, p12: &mut u32): (order_book_types::OrderIdType, u64, option::Option<order_placement::OrderCancellationReason>, vector<u64>, u32) {
        let _v0;
        let _v1 = clearinghouse_perp::market_callbacks(p0);
        let _v2 = *p12;
        let _v3 = &_v1;
        let (_v4,_v5,_v6,_v7,_v8,_v9) = order_placement::destroy_order_match_result<perp_engine_types::OrderMatchingActions>(perp_market::place_order_with_order_id(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, _v2, false, p11, _v3));
        let _v10 = _v9;
        let _v11 = _v8;
        let _v12 = _v10 as u64;
        let _v13 = vector::length<u64>(&_v11);
        assert!(_v12 >= _v13, 1);
        if (_v10 == 0u32) {
            _v0 = p12;
            *_v0 = *_v0 - 1u32
        } else {
            _v0 = p12;
            *_v0 = *_v0 - _v10
        };
        let _v14 = &_v1;
        invoke_callback_actions(_v7, _v14, p0);
        (_v4, _v5, _v6, _v11, _v10)
    }
}
