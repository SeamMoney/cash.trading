module 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_tp_sl_tracker {
    use 0x1::big_ordered_map;
    use 0x1b3fa27b03773a4265a09b292c5059da10b4ae8a3dbd2972245c7504e89f52e7::order_book_types;
    use 0x1::option;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::builder_code_registry;
    use 0x1::object;
    use 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_market;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::pending_order_tracker;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::position_tp_sl;
    friend 0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844::perp_engine;
    enum PendingOrderTracker has key {
        V1 {
            price_move_up_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,
            price_move_down_index: big_ordered_map::BigOrderedMap<PriceIndexKey, PendingRequest>,
        }
    }
    struct PriceIndexKey has copy, drop, store {
        trigger_price: u64,
        account: address,
        limit_price: option::Option<u64>,
        is_full_size: bool,
        builder_code: option::Option<builder_code_registry::BuilderCode>,
    }
    enum PendingRequest has copy, drop, store {
        V1 {
            order_id: order_book_types::OrderIdType,
            account: address,
            limit_price: option::Option<u64>,
            size: option::Option<u64>,
            builder_code: option::Option<builder_code_registry::BuilderCode>,
        }
    }
    friend fun register_market(p0: &signer) {
        let _v0 = big_ordered_map::new_with_config<PriceIndexKey,PendingRequest>(64u16, 32u16, true);
        let _v1 = big_ordered_map::new_with_config<PriceIndexKey,PendingRequest>(64u16, 32u16, true);
        let _v2 = PendingOrderTracker::V1{price_move_up_index: _v0, price_move_down_index: _v1};
        move_to<PendingOrderTracker>(p0, _v2);
    }
    friend fun add_new_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: address, p2: order_book_types::OrderIdType, p3: PriceIndexKey, p4: option::Option<u64>, p5: option::Option<u64>, p6: bool, p7: bool)
        acquires PendingOrderTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        let _v3 = *&(&p3).builder_code;
        let _v4 = PendingRequest::V1{order_id: p2, account: p1, limit_price: p4, size: p5, builder_code: _v3};
        if (p6 == p7) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v5 = big_ordered_map::upsert<PriceIndexKey,PendingRequest>(_v0, p3, _v4);
    }
    friend fun cancel_pending_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool)
        acquires PendingOrderTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        if (p2 == p3) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v3 = &p1;
        let _v4 = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v0, _v3);
    }
    friend fun destroy_pending_request(p0: PendingRequest): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>) {
        let PendingRequest::V1{order_id: _v0, account: _v1, limit_price: _v2, size: _v3, builder_code: _v4} = p0;
        (_v1, _v0, _v2, _v3, _v4)
    }
    friend fun get_account_from_pending_request(p0: &PendingRequest): address {
        *&p0.account
    }
    friend fun get_order_id_from_pending_request(p0: &PendingRequest): order_book_types::OrderIdType {
        *&p0.order_id
    }
    friend fun get_pending_order_id(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool): option::Option<order_book_types::OrderIdType>
        acquires PendingOrderTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global<PendingOrderTracker>(_v1);
        if (p2 == p3) _v0 = &_v2.price_move_up_index else _v0 = &_v2.price_move_down_index;
        let _v3 = &p1;
        let _v4 = big_ordered_map::get<PriceIndexKey,PendingRequest>(_v0, _v3);
        if (option::is_some<PendingRequest>(&_v4)) {
            let _v5 = option::destroy_some<PendingRequest>(_v4);
            return option::some<order_book_types::OrderIdType>(*&(&_v5).order_id)
        };
        option::none<order_book_types::OrderIdType>()
    }
    friend fun get_pending_tp_sl(p0: object::Object<perp_market::PerpMarket>, p1: PriceIndexKey, p2: bool, p3: bool): (address, order_book_types::OrderIdType, option::Option<u64>, option::Option<u64>, option::Option<builder_code_registry::BuilderCode>)
        acquires PendingOrderTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global<PendingOrderTracker>(_v1);
        if (p2 == p3) _v0 = &_v2.price_move_up_index else _v0 = &_v2.price_move_down_index;
        let _v3 = &p1;
        let (_v4,_v5,_v6,_v7,_v8) = destroy_pending_request(*big_ordered_map::borrow<PriceIndexKey,PendingRequest>(_v0, _v3));
        (_v4, _v5, _v6, _v7, _v8)
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
            let PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKey,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_down_index;
            _v3 = big_ordered_map::iter_prev<PriceIndexKey,PendingRequest>(_v3, _v17);
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
            let PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = *big_ordered_map::iter_borrow<PriceIndexKey,PendingRequest>(_v3, _v9);
            let _v15 = *&_v7.builder_code;
            let _v16 = PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            let _v17 = &_v1.price_move_up_index;
            _v3 = big_ordered_map::iter_next<PriceIndexKey,PendingRequest>(_v3, _v17);
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
        acquires PendingOrderTracker
    {
        let _v0;
        let _v1 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v2 = borrow_global_mut<PendingOrderTracker>(_v1);
        if (p3 == p4) _v0 = &mut _v2.price_move_up_index else _v0 = &mut _v2.price_move_down_index;
        let _v3 = &p1;
        let _v4 = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v0, _v3);
        assert!(option::is_some<u64>(&(&_v4).size), 1);
        let _v5 = option::some<u64>(option::destroy_some<u64>(*&(&_v4).size) + p2);
        let _v6 = &mut (&mut _v4).size;
        *_v6 = _v5;
        big_ordered_map::add<PriceIndexKey,PendingRequest>(_v0, p1, _v4);
    }
    friend fun new_price_index_key(p0: u64, p1: address, p2: option::Option<u64>, p3: bool, p4: option::Option<builder_code_registry::BuilderCode>): PriceIndexKey {
        PriceIndexKey{trigger_price: p0, account: p1, limit_price: p2, is_full_size: p3, builder_code: p4}
    }
    friend fun take_ready_price_move_down_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<PendingOrderTracker>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        loop {
            let _v3;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v1.price_move_down_index)) _v3 = false else _v3 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v3) break;
            let (_v4,_v5) = big_ordered_map::borrow_back<PriceIndexKey,PendingRequest>(&_v1.price_move_down_index);
            let _v6 = _v4;
            let _v7 = *&(&_v6).trigger_price;
            if (!(p1 <= _v7)) break;
            let _v8 = &mut _v1.price_move_down_index;
            let _v9 = &_v6;
            let PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v8, _v9);
            let _v15 = *&(&_v6).builder_code;
            let _v16 = PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            continue
        };
        _v2
    }
    friend fun take_ready_price_move_up_orders(p0: object::Object<perp_market::PerpMarket>, p1: u64, p2: u64): vector<PendingRequest>
        acquires PendingOrderTracker
    {
        let _v0 = object::object_address<perp_market::PerpMarket>(&p0);
        let _v1 = borrow_global_mut<PendingOrderTracker>(_v0);
        let _v2 = 0x1::vector::empty<PendingRequest>();
        loop {
            let _v3;
            if (big_ordered_map::is_empty<PriceIndexKey,PendingRequest>(&_v1.price_move_up_index)) _v3 = false else _v3 = 0x1::vector::length<PendingRequest>(&_v2) < p2;
            if (!_v3) break;
            let (_v4,_v5) = big_ordered_map::borrow_front<PriceIndexKey,PendingRequest>(&_v1.price_move_up_index);
            let _v6 = _v4;
            let _v7 = *&(&_v6).trigger_price;
            if (!(p1 >= _v7)) break;
            let _v8 = &mut _v1.price_move_up_index;
            let _v9 = &_v6;
            let PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v14} = big_ordered_map::remove<PriceIndexKey,PendingRequest>(_v8, _v9);
            let _v15 = *&(&_v6).builder_code;
            let _v16 = PendingRequest::V1{order_id: _v10, account: _v11, limit_price: _v12, size: _v13, builder_code: _v15};
            0x1::vector::push_back<PendingRequest>(&mut _v2, _v16);
            continue
        };
        _v2
    }
}
