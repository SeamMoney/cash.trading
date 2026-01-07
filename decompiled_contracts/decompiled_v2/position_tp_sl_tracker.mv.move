module 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl_tracker {
    use 0x1::big_ordered_map;
    use 0xb56316c611f8132bae6d5dd2f13dad2289d88134014bd74559c2fda8696f4466::order_book_types;
    use 0x1::option;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::builder_code_registry;
    use 0x1::object;
    use 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_market;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::pending_order_tracker;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::position_tp_sl;
    friend 0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::perp_engine;
    enum PendingOrderTracker has key {
        V1 {
            price_move_up_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,
            price_move_down_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,
        }
    }
    struct PriceIndexKey has copy, drop, store {
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        trigger_price: u64,
        limit_price: option::Option<u64>,
        is_full_size: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    struct PendingRequest has copy, drop, store {
        order_id: order_book_types::OrderIdType,
        account: address,
        limit_price: option::Option<u64>,
        size: option::Option<u64>,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    enum PendingOrderTrackerV2 has key {
        V2 {
            price_move_up_index: big_ordered_map::BigOrderedMap<PriceIndexKeyV2, PendingRequest>,
            price_move_down_index: big_ordered_map::BigOrderedMap<PriceIndexKeyV2, PendingRequest>,
        }
    }
    struct PriceIndexKeyV2 has copy, drop, store {
        trigger_price: u64,
        account: address,
        market: object::Object<perp_market::PerpMarket>,
        limit_price: option::Option<u64>,
        is_full_size: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    friend fun register_market(p0: &signer) {
        let _v0 = big_ordered_map::new_with_config<PriceIndexKey,PendingRequest>(64u16, 32u16, true);
        let _v1 = big_ordered_map::new_with_config<PriceIndexKey,PendingRequest>(64u16, 32u16, true);
        let _v2 = PendingOrderTracker::V1{price_move_up_index: _v0, price_move_down_index: _v1};
        move_to<PendingOrderTracker>(p0, _v2);
        let _v3 = big_ordered_map::new_with_config<PriceIndexKeyV2,PendingRequest>(64u16, 32u16, true);
        let _v4 = big_ordered_map::new_with_config<PriceIndexKeyV2,PendingRequest>(64u16, 32u16, true);
        let _v5 = PendingOrderTrackerV2::V2{price_move_up_index: _v3, price_move_down_index: _v4};
        move_to<PendingOrderTrackerV2>(p0, _v5);
    }
    friend fun add_new_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: PriceIndexKey, p4: option::Option<u64>, p5: option::Option<u64>, p6: bool, p7: bool)
        acquires PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
        let _v3 = *&(&p3).builder_code;
        let _v4 = PendingRequest{order_id: p2, account: p1, limit_price: p4, size: p5, builder_code: _v3};
        if (p6 == p7) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v5 = *&(&p3).trigger_price;
        let _v6 = *&(&p3).account;
        let _v7 = *&(&p3).market;
        let _v8 = *&(&p3).limit_price;
        let _v9 = *&(&p3).is_full_size;
        let _v10 = *&(&p3).builder_code;
        let _v11 = PriceIndexKeyV2{trigger_price: _v5, account: _v6, market: _v7, limit_price: _v8, is_full_size: _v9, builder_code: _v10};
        big_ordered_map::add<PriceIndexKeyV2,PendingRequest>(_v0, _v11, _v4);
    }
    friend fun cancel_pending_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool)
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        let _v3 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
        if (p2 == p3) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v4 = freeze(_v0);
        let _v5 = &p1;
        let _v6 = big_ordered_map::contains<PriceIndexKey,PendingRequest>(_v4, _v5);
        loop {
            let _v7;
            let _v8;
            if (_v6) {
                let _v9 = &p1;
                let _v10 = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v0, _v9);
                return ()
            } else {
                if (p2 == p3) _v8 = &mut _v3.price_move_up_index else _v8 = &mut _v3.price_move_down_index;
                let _v11 = *&(&p1).trigger_price;
                let _v12 = *&(&p1).account;
                let _v13 = *&(&p1).market;
                let _v14 = *&(&p1).limit_price;
                let _v15 = *&(&p1).is_full_size;
                let _v16 = *&(&p1).builder_code;
                _v7 = PriceIndexKeyV2{trigger_price: _v11, account: _v12, market: _v13, limit_price: _v14, is_full_size: _v15, builder_code: _v16};
                let _v17 = freeze(_v8);
                let _v18 = &_v7;
                if (!big_ordered_map::contains<PriceIndexKeyV2,PendingRequest>(_v17, _v18)) break
            };
            let _v19 = &_v7;
            let _v20 = big_ordered_map::remove<PriceIndexKeyV2,PendingRequest>(_v8, _v19);
            return ()
        };
    }
    friend fun destroy_pending_request(p0: PendingRequest): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>) {
        let PendingRequest{order_id: _v0, account: _v1, limit_price: _v2, size: _v3, builder_code: _v4} = p0;
        (_v1, _v0, _v2, _v3, _v4)
    }
    friend fun get_account_from_pending_request(p0: &PendingRequest): address {
        *&p0.account
    }
    friend fun get_order_id_from_pending_request(p0: &PendingRequest): order_book_types::OrderIdType {
        *&p0.order_id
    }
    friend fun get_pending_order_id(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool): option::Option<order_book_types::OrderIdType>
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v3 = borrow_global<PendingOrderTracker>(_v2);
        let _v4 = borrow_global<PendingOrderTrackerV2>(_v2);
        if (p2 == p3) _v1 = &_v3.price_move_up_index else _v1 = &_v3.price_move_down_index;
        if (p2 == p3) _v0 = &_v4.price_move_up_index else _v0 = &_v4.price_move_down_index;
        let _v5 = &p1;
        let _v6 = big_ordered_map::get<PriceIndexKey,PendingRequest>(_v1, _v5);
        let _v7 = option::is_some<PendingRequest>(&_v6);
        loop {
            let _v8;
            if (_v7) {
                let _v9 = option::destroy_some<PendingRequest>(_v6);
                return option::some<order_book_types::OrderIdType>(*&(&_v9).order_id)
            } else {
                let _v10 = *&(&p1).trigger_price;
                let _v11 = *&(&p1).account;
                let _v12 = *&(&p1).market;
                let _v13 = *&(&p1).limit_price;
                let _v14 = *&(&p1).is_full_size;
                let _v15 = *&(&p1).builder_code;
                let _v16 = PriceIndexKeyV2{trigger_price: _v10, account: _v11, market: _v12, limit_price: _v13, is_full_size: _v14, builder_code: _v15};
                let _v17 = &_v16;
                _v8 = big_ordered_map::get<PriceIndexKeyV2,PendingRequest>(_v0, _v17);
                if (!option::is_some<PendingRequest>(&_v8)) break
            };
            let _v18 = option::destroy_some<PendingRequest>(_v8);
            return option::some<order_book_types::OrderIdType>(*&(&_v18).order_id)
        };
        option::none<order_book_types::OrderIdType>()
    }
    friend fun get_pending_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>)
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1;
        let _v2 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v3 = borrow_global<PendingOrderTracker>(_v2);
        if (p2 == p3) _v1 = &_v3.price_move_up_index else _v1 = &_v3.price_move_down_index;
        let _v4 = &p1;
        let _v5 = big_ordered_map::contains<PriceIndexKey,PendingRequest>(_v1, _v4);
        loop {
            if (!_v5) {
                let _v6 = borrow_global<PendingOrderTrackerV2>(_v2);
                if (p2 == p3) {
                    _v0 = &_v6.price_move_up_index;
                    break
                };
                _v0 = &_v6.price_move_down_index;
                break
            };
            let _v7 = &p1;
            let (_v8,_v9,_v10,_v11,_v12) = destroy_pending_request(*big_ordered_map::borrow<PriceIndexKey,PendingRequest>(_v1, _v7));
            return (_v8, _v9, _v10, _v11, _v12)
        };
        let _v13 = *&(&p1).trigger_price;
        let _v14 = *&(&p1).account;
        let _v15 = *&(&p1).market;
        let _v16 = *&(&p1).limit_price;
        let _v17 = *&(&p1).is_full_size;
        let _v18 = *&(&p1).builder_code;
        let _v19 = PriceIndexKeyV2{trigger_price: _v13, account: _v14, market: _v15, limit_price: _v16, is_full_size: _v17, builder_code: _v18};
        let _v20 = &_v19;
        let (_v21,_v22,_v23,_v24,_v25) = destroy_pending_request(*big_ordered_map::borrow<PriceIndexKeyV2,PendingRequest>(_v0, _v20));
        (_v21, _v22, _v23, _v24, _v25)
    }
    public fun get_ready_price_move_down_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PendingOrderTracker>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        let _v3 = big_ordered_map::internal_new_end_iter<PriceIndexKey,PendingRequest>(&_v1.price_move_down_index);
        loop {
            let _v4;
            let _v5 = &_v3;
            let _v6 = &_v1.price_move_down_index;
            if (big_ordered_map::iter_is_begin<PriceIndexKey,PendingRequest>(_v5, _v6)) _v4 = false else _v4 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v4) break;
            let _v7 = big_ordered_map::iter_borrow_key<PriceIndexKey>(&_v3);
            let _v8 = *&_v7.trigger_price;
            if (!(p1 <= _v8)) break;
            let _v9 = &_v1.price_move_down_index;
            let PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKey,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_down_index;
            _v3 = big_ordered_map::iter_prev<PriceIndexKey,PendingRequest>(_v3, _v17);
            continue
        };
        _v2
    }
    public fun get_ready_price_move_down_orders_v2(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTrackerV2
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PendingOrderTrackerV2>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        let _v3 = big_ordered_map::internal_new_end_iter<PriceIndexKeyV2,PendingRequest>(&_v1.price_move_down_index);
        loop {
            let _v4;
            let _v5 = &_v3;
            let _v6 = &_v1.price_move_down_index;
            if (big_ordered_map::iter_is_begin<PriceIndexKeyV2,PendingRequest>(_v5, _v6)) _v4 = false else _v4 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v4) break;
            let _v7 = big_ordered_map::iter_borrow_key<PriceIndexKeyV2>(&_v3);
            let _v8 = *&_v7.trigger_price;
            if (!(p1 <= _v8)) break;
            let _v9 = &_v1.price_move_down_index;
            let PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKeyV2,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_down_index;
            _v3 = big_ordered_map::iter_prev<PriceIndexKeyV2,PendingRequest>(_v3, _v17);
            continue
        };
        _v2
    }
    public fun get_ready_price_move_up_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PendingOrderTracker>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        let _v3 = big_ordered_map::internal_new_begin_iter<PriceIndexKey,PendingRequest>(&_v1.price_move_up_index);
        loop {
            let _v4;
            let _v5 = &_v3;
            let _v6 = &_v1.price_move_up_index;
            if (big_ordered_map::iter_is_end<PriceIndexKey,PendingRequest>(_v5, _v6)) _v4 = false else _v4 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v4) break;
            let _v7 = big_ordered_map::iter_borrow_key<PriceIndexKey>(&_v3);
            let _v8 = *&_v7.trigger_price;
            if (!(p1 >= _v8)) break;
            let _v9 = &_v1.price_move_up_index;
            let PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKey,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_up_index;
            _v3 = big_ordered_map::iter_next<PriceIndexKey,PendingRequest>(_v3, _v17);
            continue
        };
        _v2
    }
    public fun get_ready_price_move_up_orders_v2(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTrackerV2
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global<PendingOrderTrackerV2>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        let _v3 = big_ordered_map::internal_new_begin_iter<PriceIndexKeyV2,PendingRequest>(&_v1.price_move_up_index);
        loop {
            let _v4;
            let _v5 = &_v3;
            let _v6 = &_v1.price_move_up_index;
            if (big_ordered_map::iter_is_end<PriceIndexKeyV2,PendingRequest>(_v5, _v6)) _v4 = false else _v4 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v4) break;
            let _v7 = big_ordered_map::iter_borrow_key<PriceIndexKeyV2>(&_v3);
            let _v8 = *&_v7.trigger_price;
            if (!(p1 >= _v8)) break;
            let _v9 = &_v1.price_move_up_index;
            let PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKeyV2,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_up_index;
            _v3 = big_ordered_map::iter_next<PriceIndexKeyV2,PendingRequest>(_v3, _v17);
            continue
        };
        _v2
    }
    friend fun get_size_from_pending_request(p0: &PendingRequest): option::Option<u64> {
        *&p0.size
    }
    friend fun get_trigger_price(p0: &PriceIndexKey): u64 {
        *&p0.trigger_price
    }
    friend fun increase_pending_tp_sl_size(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: u64, p3: bool, p4: bool)
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        if (p3 == p4) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v3 = freeze(_v0);
        let _v4 = &p1;
        let _v5 = big_ordered_map::contains<PriceIndexKey,PendingRequest>(_v3, _v4);
        'l0: loop {
            let _v6;
            let _v7;
            let _v8;
            'l1: loop {
                let _v9;
                loop {
                    if (_v5) {
                        let _v10 = &p1;
                        _v9 = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v0, _v10);
                        if (option::is_some<u64>(&(&_v9).size)) break;
                        abort 1
                    };
                    let _v11 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
                    if (p3 == p4) _v8 = &mut _v11.price_move_up_index else _v8 = &mut _v11.price_move_down_index;
                    let _v12 = *&(&p1).trigger_price;
                    let _v13 = *&(&p1).account;
                    let _v14 = *&(&p1).market;
                    let _v15 = *&(&p1).limit_price;
                    let _v16 = *&(&p1).is_full_size;
                    let _v17 = *&(&p1).builder_code;
                    _v7 = PriceIndexKeyV2{trigger_price: _v12, account: _v13, market: _v14, limit_price: _v15, is_full_size: _v16, builder_code: _v17};
                    let _v18 = freeze(_v8);
                    let _v19 = &_v7;
                    if (!big_ordered_map::contains<PriceIndexKeyV2,PendingRequest>(_v18, _v19)) break 'l0;
                    let _v20 = &_v7;
                    _v6 = big_ordered_map::remove<PriceIndexKeyV2,PendingRequest>(_v8, _v20);
                    if (option::is_some<u64>(&(&_v6).size)) break 'l1;
                    abort 1
                };
                let _v21 = option::some<u64>(option::destroy_some<u64>(*&(&_v9).size) + p2);
                let _v22 = &mut (&mut _v9).size;
                *_v22 = _v21;
                big_ordered_map::add<PriceIndexKey,PendingRequest>(_v0, p1, _v9);
                return ()
            };
            let _v23 = option::some<u64>(option::destroy_some<u64>(*&(&_v6).size) + p2);
            let _v24 = &mut (&mut _v6).size;
            *_v24 = _v23;
            big_ordered_map::add<PriceIndexKeyV2,PendingRequest>(_v8, _v7, _v6);
            return ()
        };
    }
    friend fun migrate_market(p0: &signer, p1: object::Object<perp_market::PerpMarket>, p2: u64)
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p1);
        if (!exists<PendingOrderTrackerV2>(_v1)) {
            let _v2 = big_ordered_map::new_with_config<PriceIndexKeyV2,PendingRequest>(64u16, 32u16, true);
            let _v3 = big_ordered_map::new_with_config<PriceIndexKeyV2,PendingRequest>(64u16, 32u16, true);
            let _v4 = PendingOrderTrackerV2::V2{price_move_up_index: _v2, price_move_down_index: _v3};
            move_to<PendingOrderTrackerV2>(p0, _v4)
        };
        let _v5 = borrow_global_mut<PendingOrderTracker>(_v1);
        let _v6 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
        let _v7 = 0;
        loop {
            let _v8;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v5.price_move_up_index)) _v8 = false else _v8 = _v7 < p2;
            if (!_v8) break;
            let (_v9,_v10) = big_ordered_map::pop_front<PriceIndexKey,PendingRequest>(&mut _v5.price_move_up_index);
            let _v11 = _v9;
            let _v12 = *&(&_v11).trigger_price;
            let _v13 = *&(&_v11).account;
            let _v14 = *&(&_v11).market;
            let _v15 = *&(&_v11).limit_price;
            let _v16 = *&(&_v11).is_full_size;
            let _v17 = *&(&_v11).builder_code;
            _v0 = PriceIndexKeyV2{trigger_price: _v12, account: _v13, market: _v14, limit_price: _v15, is_full_size: _v16, builder_code: _v17};
            big_ordered_map::add<PriceIndexKeyV2,PendingRequest>(&mut _v6.price_move_up_index, _v0, _v10);
            _v7 = _v7 + 1;
            continue
        };
        loop {
            let _v18;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v5.price_move_down_index)) _v18 = false else _v18 = _v7 < p2;
            if (!_v18) break;
            let (_v19,_v20) = big_ordered_map::pop_front<PriceIndexKey,PendingRequest>(&mut _v5.price_move_down_index);
            let _v21 = _v19;
            let _v22 = *&(&_v21).trigger_price;
            let _v23 = *&(&_v21).account;
            let _v24 = *&(&_v21).market;
            let _v25 = *&(&_v21).limit_price;
            let _v26 = *&(&_v21).is_full_size;
            let _v27 = *&(&_v21).builder_code;
            _v0 = PriceIndexKeyV2{trigger_price: _v22, account: _v23, market: _v24, limit_price: _v25, is_full_size: _v26, builder_code: _v27};
            big_ordered_map::add<PriceIndexKeyV2,PendingRequest>(&mut _v6.price_move_down_index, _v0, _v20);
            _v7 = _v7 + 1;
            continue
        };
    }
    friend fun new_price_index_key(p0: address, p1: object::Object<perp_market::PerpMarket>, p2: u64, p3: option::Option<u64>, p4: bool, p5: option::Option<builder_code_registry::BuilderCode>): PriceIndexKey {
        PriceIndexKey{account: p0, market: p1, trigger_price: p2, limit_price: p3, is_full_size: p4, builder_code: p5}
    }
    friend fun take_ready_price_move_down_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        let _v3 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
        let _v4 = 0x1::vector::empty<PendingRequest>();
        loop {
            let _v5;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v2.price_move_down_index)) _v5 = false else _v5 = 0x1::vector::length<PendingRequest>(&_v4) < p2;
            if (!_v5) break;
            let (_v6,_v7) = big_ordered_map::borrow_back<PriceIndexKey,PendingRequest>(&_v2.price_move_down_index);
            let _v8 = _v6;
            let _v9 = *&(&_v8).trigger_price;
            if (!(p1 <= _v9)) break;
            let _v10 = &mut _v2.price_move_down_index;
            let _v11 = &_v8;
            let PendingRequest{order_id: _v12, account: _v13, limit_price: _v14, size: _v15, builder_code: _v16} = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v10, _v11);
            let _v17 = *&(&_v8).builder_code;
            _v0 = PendingRequest{order_id: _v12, account: _v13, limit_price: _v14, size: _v15, builder_code: _v17};
            0x1::vector::push_back<PendingRequest>(&mut _v4, _v0);
            continue
        };
        loop {
            let _v18;
            if (big_ordered_map::is_empty<PriceIndexKeyV2,PendingRequest>(&_v3.price_move_down_index)) _v18 = false else _v18 = 0x1::vector::length<PendingRequest>(&_v4) < p2;
            if (!_v18) break;
            let (_v19,_v20) = big_ordered_map::borrow_back<PriceIndexKeyV2,PendingRequest>(&_v3.price_move_down_index);
            let _v21 = _v19;
            let _v22 = *&(&_v21).trigger_price;
            if (!(p1 <= _v22)) break;
            let _v23 = &mut _v3.price_move_down_index;
            let _v24 = &_v21;
            let PendingRequest{order_id: _v25, account: _v26, limit_price: _v27, size: _v28, builder_code: _v29} = big_ordered_map::remove<PriceIndexKeyV2,PendingRequest>(_v23, _v24);
            let _v30 = *&(&_v21).builder_code;
            _v0 = PendingRequest{order_id: _v25, account: _v26, limit_price: _v27, size: _v28, builder_code: _v30};
            0x1::vector::push_back<PendingRequest>(&mut _v4, _v0);
            continue
        };
        _v4
    }
    friend fun take_ready_price_move_up_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker, PendingOrderTrackerV2
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        let _v3 = borrow_global_mut<PendingOrderTrackerV2>(_v1);
        let _v4 = 0x1::vector::empty<PendingRequest>();
        loop {
            let _v5;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v2.price_move_up_index)) _v5 = false else _v5 = 0x1::vector::length<PendingRequest>(&_v4) < p2;
            if (!_v5) break;
            let (_v6,_v7) = big_ordered_map::borrow_front<PriceIndexKey,PendingRequest>(&_v2.price_move_up_index);
            let _v8 = _v6;
            let _v9 = *&(&_v8).trigger_price;
            if (!(p1 >= _v9)) break;
            let _v10 = &mut _v2.price_move_up_index;
            let _v11 = &_v8;
            let PendingRequest{order_id: _v12, account: _v13, limit_price: _v14, size: _v15, builder_code: _v16} = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v10, _v11);
            let _v17 = *&(&_v8).builder_code;
            _v0 = PendingRequest{order_id: _v12, account: _v13, limit_price: _v14, size: _v15, builder_code: _v17};
            0x1::vector::push_back<PendingRequest>(&mut _v4, _v0);
            continue
        };
        loop {
            let _v18;
            if (big_ordered_map::is_empty<PriceIndexKeyV2,PendingRequest>(&_v3.price_move_up_index)) _v18 = false else _v18 = 0x1::vector::length<PendingRequest>(&_v4) < p2;
            if (!_v18) break;
            let (_v19,_v20) = big_ordered_map::borrow_front<PriceIndexKeyV2,PendingRequest>(&_v3.price_move_up_index);
            let _v21 = _v19;
            let _v22 = *&(&_v21).trigger_price;
            if (!(p1 >= _v22)) break;
            let _v23 = &mut _v3.price_move_up_index;
            let _v24 = &_v21;
            let PendingRequest{order_id: _v25, account: _v26, limit_price: _v27, size: _v28, builder_code: _v29} = big_ordered_map::remove<PriceIndexKeyV2,PendingRequest>(_v23, _v24);
            let _v30 = *&(&_v21).builder_code;
            _v0 = PendingRequest{order_id: _v25, account: _v26, limit_price: _v27, size: _v28, builder_code: _v30};
            0x1::vector::push_back<PendingRequest>(&mut _v4, _v0);
            continue
        };
        _v4
    }
}
