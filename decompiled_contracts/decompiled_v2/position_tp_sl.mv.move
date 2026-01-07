module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl {
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_positions;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    use 0x1::error;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl_tracker;
    use 0x1::vector;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::tp_sl_utils;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::clearinghouse_perp;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    friend fun add_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderIdType, p3: u64, p4: option::Option<u64>, p5: option::Option<u64>, p6: bool, p7: option::Option<builder_code_registry::BuilderCode>, p8: bool) {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::get_size(&_v0);
        let _v2 = perp_positions::is_long(&_v0);
        pending_order_tracker::add_tp_sl(p0, p1, p2, p3, p4, p5, p6, _v1, _v2, p7, p8);
        perp_positions::emit_position_update_event(&_v0, p0);
    }
    friend fun cancel_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: order_book_types::OrderIdType) {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        let _v2 = pending_order_tracker::cancel_tp_sl(p0, p1, p2, _v1);
        if (!option::is_some<pending_order_tracker::PendingTpSlKey>(&_v2)) {
            let _v3 = error::invalid_argument(16);
            abort _v3
        };
        perp_positions::emit_position_update_event(&_v0, p0);
    }
    friend fun get_fixed_sized_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64, p4: option::Option<u64>, p5: option::Option<builder_code_registry::BuilderCode>): option::Option<order_book_types::OrderIdType> {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::get_fixed_sized_tp_sl(p0, p1, p2, p3, p4, p5, _v1)
    }
    friend fun get_fixed_sized_tp_sl_for_key(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u64, p4: option::Option<u64>, p5: option::Option<builder_code_registry::BuilderCode>): option::Option<pending_order_tracker::PendingTpSlInfo> {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::get_fixed_sized_tp_sl_for_key(p0, p1, p2, p3, p4, p5, _v1)
    }
    friend fun get_fixed_sized_tp_sl_for_order_id(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool, p3: u128): option::Option<pending_order_tracker::PendingTpSlInfo> {
        let _v0 = order_book_types::new_order_id_type(p3);
        let _v1 = perp_positions::must_find_position_copy(p0, p1);
        let _v2 = perp_positions::is_long(&_v1);
        pending_order_tracker::get_fixed_sized_tp_sl_for_order_id(p0, p1, p2, _v0, _v2)
    }
    friend fun get_fixed_sized_tp_sl_orders(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): vector<pending_order_tracker::PendingTpSlInfo> {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::get_fixed_sized_tp_sl_orders(p0, p1, p2, _v1)
    }
    friend fun get_full_sized_tp_sl_order(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: bool): option::Option<pending_order_tracker::PendingTpSlInfo> {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::get_full_sized_tp_sl_order(p0, p1, p2, _v1)
    }
    friend fun increase_tp_sl_size(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: option::Option<u64>, p4: option::Option<builder_code_registry::BuilderCode>, p5: u64, p6: bool) {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::increase_tp_sl_size(p0, p1, p2, p3, p4, p5, p6, _v1);
        perp_positions::emit_position_update_event(&_v0, p0);
    }
    friend fun validate_tp_sl(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: bool): bool {
        let _v0 = perp_positions::must_find_position_copy(p0, p1);
        let _v1 = perp_positions::is_long(&_v0);
        pending_order_tracker::validate_tp_sl(p1, _v1, p2, p3)
    }
    public fun get_sl_order(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<pending_order_tracker::PendingTpSlInfo> {
        get_full_sized_tp_sl_order(p0, p1, false)
    }
    public fun get_tp_order(p0: address, p1: object::Object<perp_market::PerpMarket>): option::Option<pending_order_tracker::PendingTpSlInfo> {
        get_full_sized_tp_sl_order(p0, p1, true)
    }
    friend fun take_ready_tp_sl_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: bool, p3: u64): vector<position_tp_sl_tracker::PendingRequest> {
        let _v0;
        if (p2) _v0 = position_tp_sl_tracker::take_ready_price_move_up_orders(p0, p1, p3) else _v0 = position_tp_sl_tracker::take_ready_price_move_down_orders(p0, p1, p3);
        let _v1 = _v0;
        vector::reverse<position_tp_sl_tracker::PendingRequest>(&mut _v1);
        let _v2 = _v1;
        let _v3 = vector::length<position_tp_sl_tracker::PendingRequest>(&_v2);
        loop {
            let _v4;
            let _v5;
            let _v6;
            let _v7;
            if (!(_v3 > 0)) break;
            let _v8 = vector::pop_back<position_tp_sl_tracker::PendingRequest>(&mut _v2);
            let _v9 = position_tp_sl_tracker::get_account_from_pending_request(&_v8);
            let _v10 = perp_positions::must_find_position_copy(_v9, p0);
            let _v11 = perp_positions::is_long(&_v10);
            if (_v11) _v7 = p2 else _v7 = false;
            if (_v7) _v6 = true else if (_v11) _v6 = false else _v6 = !p2;
            let _v12 = position_tp_sl_tracker::get_size_from_pending_request(&_v8);
            let _v13 = option::is_none<u64>(&_v12);
            let _v14 = position_tp_sl_tracker::get_order_id_from_pending_request(&_v8);
            if (_v13) _v5 = pending_order_tracker::remove_full_sized_tp_sl_for_order(_v9, p0, _v14, _v6) else _v4 = pending_order_tracker::remove_fixed_sized_tp_sl_for_order(_v9, p0, _v14, _v6);
            _v3 = _v3 - 1;
            continue
        };
        vector::destroy_empty<position_tp_sl_tracker::PendingRequest>(_v2);
        _v0
    }
}
